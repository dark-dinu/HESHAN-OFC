const fs = require("fs");
const path = require("path");
const express = require("express");
const pino = require("pino");
const mongoose = require("mongoose");
const { 
  makeWASocket, 
  DisconnectReason, 
  makeCacheableSignalKeyStore, 
  Browsers,
  delay,
  downloadMediaMessage 
} = require("@whiskeysockets/baileys");
const { useMongoAuthState } = require("./database/mongoSession");
const config = require("./config");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const commands = new Map();
const aliases = new Map();
let sock = null;

// Global Memory Cache for Status Saver
global.statusCache = global.statusCache || new Map();

// ==========================================
// 1. Plugins Auto-Loader (C++ Modular Structure)
// ==========================================
function loadPlugins() {
  commands.clear();
  aliases.clear();
  const pluginsPath = path.join(__dirname, "plugins");
  
  if (fs.existsSync(pluginsPath)) {
    const files = fs.readdirSync(pluginsPath).filter((f) => f.endsWith(".js"));
    for (const file of files) {
      try {
        delete require.cache[require.resolve(path.join(pluginsPath, file))];
        const cmd = require(path.join(pluginsPath, file));
        if (cmd.name && cmd.execute) {
          commands.set(cmd.name.toLowerCase(), cmd);
          if (cmd.aliases && Array.isArray(cmd.aliases)) {
            cmd.aliases.forEach(alias => aliases.set(alias.toLowerCase(), cmd));
          }
        }
      } catch (err) {
        console.error(`[Plugin Error] ${file}:`, err.message);
      }
    }
    console.log(`Loaded ${commands.size} plugins successfully.`);
  }
}

// ==========================================
// 2. Web UI Pairing Dashboard
// ==========================================
app.get("/", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>𝐇𝐄𝐒𝐇𝐀𝐍 𝐎𝐅𝐂</title>
      <style>
        body { font-family: -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; background: #080c10; color: #fff; margin: 0; }
        .box { background: #0f1622; padding: 2.5rem 2rem; border-radius: 20px; width: 330px; text-align: center; border: 1px solid #1f293d; }
        h1 { margin: 0 0 8px 0; color: #58a6ff; font-size: 1.5rem; }
        input { width: 100%; padding: 12px; margin-bottom: 12px; border: 1px solid #30363d; border-radius: 8px; background: #080c10; color: #fff; box-sizing: border-box; }
        button { width: 100%; padding: 12px; background: #238636; color: #fff; border: none; border-radius: 8px; font-weight: bold; cursor: pointer; }
        #code { margin-top: 20px; font-size: 1.5rem; font-weight: bold; color: #38bdf8; letter-spacing: 3px; font-family: monospace; }
      </style>
    </head>
    <body>
      <div class="box">
        <h1>𝐇𝐄𝐒𝐇𝐀𝐍 𝐎𝐅𝐂</h1>
        <p style="color:#8b949e;font-size:0.85rem;margin-bottom:20px;">System Link Portal</p>
        <input type="password" id="key" placeholder="Enter Secret Key" required />
        <input type="text" id="phone" placeholder="947xxxxxxxx" required />
        <button id="btn" onclick="fetchCode()">Pair WhatsApp</button>
        <div id="code"></div>
      </div>
      <script>
        async function fetchCode() {
          const num = document.getElementById('phone').value.replace(/[^0-9]/g, '');
          const key = document.getElementById('key').value.trim();
          const display = document.getElementById('code');
          const btn = document.getElementById('btn');
          if(!key || !num) return alert('Enter Key & Phone Number');
          display.innerText = 'Connecting...';
          btn.disabled = true;
          try {
            const res = await fetch('/get-code?num=' + num + '&key=' + encodeURIComponent(key));
            const data = await res.json();
            display.innerText = data.code || data.error || 'Failed';
          } catch(e) { display.innerText = 'Server Error'; }
          finally { btn.disabled = false; }
        }
      </script>
    </body>
    </html>
  `);
});

app.get("/get-code", async (req, res) => {
  const { num, key } = req.query;
  if (!key || key !== config.PAIR_KEY) return res.status(403).json({ error: "Access Denied" });
  if (!num) return res.status(400).json({ error: "Missing number" });

  try {
    const { state, saveCreds } = await useMongoAuthState();
    if (sock) { try { sock.end(); } catch (e) {} }

    sock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" }))
      },
      printQRInTerminal: false,
      logger: pino({ level: "silent" }),
      browser: Browsers.macOS("Chrome")
    });

    sock.ev.on("creds.update", saveCreds);

    if (!sock.authState.creds.registered) {
      await delay(2500);
      const code = await sock.requestPairingCode(num);
      const formattedCode = code?.match(/.{1,4}/g)?.join("-") || code;
      initEvents(sock, saveCreds);
      return res.json({ code: formattedCode });
    } else {
      initEvents(sock, saveCreds);
      return res.json({ code: "Already Linked & Online" });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 3. Main Event Engine
// ==========================================
function initEvents(waSock, saveCreds) {
  waSock.ev.on("creds.update", saveCreds);

  // Hook Status Watcher
  try {
    const statusPlugin = require("./plugins/status");
    if (statusPlugin && statusPlugin.initStatusWatcher) {
      statusPlugin.initStatusWatcher(waSock);
    }
  } catch (e) {}

  waSock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === "close") {
      const reason = lastDisconnect?.error?.output?.statusCode;
      if (reason !== DisconnectReason.loggedOut) {
        startBot();
      }
    } else if (connection === "open") {
      console.log(`⚡ ${config.BOT_NAME} Connected & Operational 🟢`);
      try {
        const statusPlugin = require("./plugins/status");
        if (statusPlugin && statusPlugin.initStatusWatcher) {
          statusPlugin.initStatusWatcher(waSock);
        }
      } catch (e) {}
    }
  });

  waSock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    const msg = messages[0];
    if (!msg || !msg.message || !msg.key) return;

    const from = msg.key.remoteJid;

    // Status broadcast messages are handled by status.js background watcher
    if (from === "status@broadcast") return;

    const mType = Object.keys(msg.message)[0];
    const body = (
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      msg.message[mType]?.caption ||
      ""
    ).trim();

    // 1. Status Saver Interceptor (oni, ewanna, dapan, etc.)
    const quotedStanzaId = msg.message.extendedTextMessage?.contextInfo?.stanzaId;
    if (quotedStanzaId) {
      try {
        const statusPlugin = require("./plugins/status");
        if (statusPlugin && statusPlugin.onReply) {
          const handled = await statusPlugin.onReply({
            sock: waSock,
            msg,
            from,
            body,
            quotedStanzaId
          });
          if (handled) return;
        }
      } catch (e) {}
    }

    // 2. Command Authentication (Owner Only)
    const rawSender = msg.key.fromMe 
      ? config.OWNER_NUMBER 
      : (msg.key.participant || from || "");
    const sender = rawSender.split("@")[0].replace(/[^0-9]/g, "");
    const ownerClean = config.OWNER_NUMBER.replace(/[^0-9]/g, "");
    const isOwner = msg.key.fromMe || sender === ownerClean;

    if (!isOwner) return;

    // 3. Command Execution
    const prefix = config.PREFIX || ",";
    if (!body.startsWith(prefix)) return;

    const [cmdTrigger, ...args] = body.slice(prefix.length).trim().split(/\s+/);
    const cmdName = cmdTrigger.toLowerCase();
    const command = commands.get(cmdName) || aliases.get(cmdName);

    if (command) {
      const context = {
        sock: waSock,
        msg,
        args,
        text: args.join(" "),
        body,
        from,
        sender,
        prefix,
        config,
        reply: (text) => waSock.sendMessage(from, { text }, { quoted: msg }),
        react: (emoji) => waSock.sendMessage(from, { react: { text: emoji, key: msg.key } }),
        downloadMedia: () => downloadMediaMessage(msg, "buffer", {}),
        quoted: msg.message.extendedTextMessage?.contextInfo?.quotedMessage || null
      };

      try {
        await command.execute(context);
      } catch (err) {
        console.error(`Command [${cmdName}] Error:`, err.message);
      }
    }
  });
}

// ==========================================
// 4. Bot Startup
// ==========================================
async function startBot() {
  try {
    loadPlugins();
    const { state, saveCreds } = await useMongoAuthState();
    if (state.creds && state.creds.registered) {
      sock = makeWASocket({
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" }))
        },
        printQRInTerminal: false,
        logger: pino({ level: "silent" }),
        browser: Browsers.macOS("Chrome"),
        syncFullHistory: false
      });
      initEvents(sock, saveCreds);
    }
  } catch (e) {
    console.error("StartBot Error:", e.message);
  }
}

const PORT = process.env.PORT || config.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  startBot();
});

const fs = require("fs");
const path = require("path");
const express = require("express");
const pino = require("pino");
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

// 1. Plugins Auto-loader (C++ Modular Structure)
const pluginsPath = path.join(__dirname, "plugins");
if (fs.existsSync(pluginsPath)) {
  const files = fs.readdirSync(pluginsPath).filter((f) => f.endsWith(".js"));
  for (const file of files) {
    try {
      const cmd = require(path.join(pluginsPath, file));
      if (cmd.name && cmd.execute) {
        commands.set(cmd.name.toLowerCase(), cmd);
        if (cmd.aliases && Array.isArray(cmd.aliases)) {
          cmd.aliases.forEach(alias => aliases.set(alias.toLowerCase(), cmd));
        }
      }
    } catch (e) {
      console.error(`Failed to load plugin: ${file}`, e.message);
    }
  }
}

// 2. Minimal Dark Pair Dashboard (𝐇𝐄𝐒𝐇𝐀𝐍 𝐎𝐅𝐂 Vibe with Auth Key)
app.get("/", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>𝐇𝐄𝐒𝐇𝐀𝐍 𝐎𝐅𝐂</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; background: #080c10; color: #f0f6fc; margin: 0; }
        .box { background: #0f1622; padding: 2.5rem 2rem; border-radius: 20px; width: 330px; text-align: center; border: 1px solid #1f293d; box-shadow: 0 15px 35px rgba(0,0,0,0.6); }
        h1 { margin: 0 0 8px 0; font-size: 1.5rem; letter-spacing: 1px; color: #58a6ff; }
        p { font-size: 0.85rem; color: #8b949e; margin-bottom: 24px; }
        input { width: 100%; padding: 13px; margin-bottom: 14px; border: 1px solid #30363d; border-radius: 10px; box-sizing: border-box; background: #080c10; color: #fff; font-size: 1rem; outline: none; }
        button { width: 100%; padding: 13px; background: #238636; color: #fff; border: none; border-radius: 10px; font-weight: 600; cursor: pointer; font-size: 1rem; transition: 0.2s; }
        button:hover { background: #2ea043; }
        #code { margin-top: 24px; font-size: 1.6rem; font-weight: 700; color: #38bdf8; letter-spacing: 4px; font-family: monospace; }
      </style>
    </head>
    <body>
      <div class="box">
        <h1>𝐇𝐄𝐒𝐇𝐀𝐍 𝐎𝐅𝐂</h1>
        <p>Private System Link Interface</p>
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
          if(!key || !num) return alert('Key සහ Phone Number එක ඇතුළත් කරන්න');
          display.innerText = 'Connecting...';
          btn.disabled = true;
          try {
            const res = await fetch('/get-code?num=' + num + '&key=' + encodeURIComponent(key));
            const data = await res.json();
            display.innerText = data.code || data.error || 'Failed';
          } catch(e) {
            display.innerText = 'Server Error';
          } finally {
            btn.disabled = false;
          }
        }
      </script>
    </body>
    </html>
  `);
});

app.get("/get-code", async (req, res) => {
  const { num, key } = req.query;

  if (!key || key !== config.PAIR_KEY) {
    return res.status(403).json({ error: "Access Denied: Invalid Key" });
  }

  if (!num) return res.status(400).json({ error: "Missing number" });

  try {
    const { state, saveCreds } = await useMongoAuthState();
    if (sock) {
      try { sock.end(); } catch (e) {}
    }

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

// 3. Execution Core & Unified Command Engine
function initEvents(waSock, saveCreds) {
  waSock.ev.on("creds.update", saveCreds);

  // Background Services Auto-Initiator (උදා: Status Watcher)
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
      console.log(`${config.BOT_NAME} Live & Synchronized.`);
    }
  });

  waSock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    const msg = messages[0];
    if (!msg?.message) return;

    // Direct sender/jid extraction
    const from = msg.key.remoteJid;
    const isGroup = from.endsWith("@g.us");
    const rawSender = msg.key.fromMe 
      ? config.OWNER_NUMBER 
      : (msg.key.participant || from || "");
    const sender = rawSender.split("@")[0].replace(/[^0-9]/g, "");
    const ownerClean = config.OWNER_NUMBER.replace(/[^0-9]/g, "");
    const isOwner = msg.key.fromMe || sender === ownerClean;

    // Strict Private Guard
    if (!isOwner) return;

    // Extract Message text
    const messageType = Object.keys(msg.message)[0];
    const body = (
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      msg.message[messageType]?.caption ||
      ""
    ).trim();

    const prefix = config.PREFIX || ",";
    if (!body.startsWith(prefix)) return;

    // Split Command Name and Arguments
    const [commandTrigger, ...args] = body.slice(prefix.length).trim().split(/\s+/);
    const cmdName = commandTrigger.toLowerCase();
    const command = commands.get(cmdName) || aliases.get(cmdName);

    if (command) {
      // Powerful Context Helpers (C++ Style Tools Injection)
      const context = {
        sock: waSock,
        msg,
        args,
        text: args.join(" "),
        from,
        sender,
        isGroup,
        isOwner,
        prefix,
        reply: (text) => waSock.sendMessage(from, { text }, { quoted: msg }),
        react: (emoji) => waSock.sendMessage(from, { react: { text: emoji, key: msg.key } }),
        downloadMedia: () => downloadMediaMessage(msg, "buffer", {}),
        quoted: msg.message.extendedTextMessage?.contextInfo?.quotedMessage || null
      };

      try {
        await command.execute(context);
      } catch (err) {
        console.error(`Error in [${cmdName}]:`, err);
        await waSock.sendMessage(from, { text: `⚠️ Exception: ${err.message}` }, { quoted: msg });
      }
    }
  });
}

async function startBot() {
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
}

const PORT = process.env.PORT || config.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Render Service running on port ${PORT}`);
  startBot();
});

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
  downloadMediaMessage,
  generateWAMessageFromContent,
  proto
} = require("@whiskeysockets/baileys");
const { useMongoAuthState } = require("./database/mongoSession");
const config = require("./config");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const commands = new Map();
const aliases = new Map();
let sock = null;
let isStarting = false;
let daemonsInitialized = false;

// Global Memory Cache for Status Saver
global.statusCache = global.statusCache || new Map();

// ==========================================
// 1. Plugins Auto-Loader (Fast In-Memory Map)
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
          if (Array.isArray(cmd.aliases)) {
            cmd.aliases.forEach(alias => aliases.set(alias.toLowerCase(), cmd));
          }
        }
      } catch (err) {
        console.error(`[Plugin Error] ${file}:`, err.message);
      }
    }
    console.log(`⚡ Loaded ${commands.size} plugins cleanly.`);
  }
}

// ==========================================
// 2. Web UI Pairing Dashboard (With Reset Tool)
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
        button { width: 100%; padding: 12px; background: #238636; color: #fff; border: none; border-radius: 8px; font-weight: bold; cursor: pointer; transition: 0.3s; margin-bottom: 10px; }
        button:hover { background: #2ea043; }
        .reset-btn { background: #da3633; }
        .reset-btn:hover { background: #f85149; }
        #code { margin-top: 15px; font-size: 1.4rem; font-weight: bold; color: #38bdf8; letter-spacing: 3px; font-family: monospace; word-break: break-all; }
      </style>
    </head>
    <body>
      <div class="box">
        <h1>𝐇𝐄𝐒𝐇𝐀𝐍 𝐎𝐅𝐂</h1>
        <p style="color:#8b949e;font-size:0.85rem;margin-bottom:20px;">Direct Link Portal</p>
        <input type="text" id="phone" placeholder="947xxxxxxxx" required />
        <button id="btn" onclick="fetchCode()">Pair WhatsApp</button>
        <button class="reset-btn" id="resetBtn" onclick="resetSession()">Reset / Force New Pair</button>
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
          if (!confirm('පරණ Session එක මකා දමා අලුතින් Code එකක් ගන්න අවශ්‍යද?')) return;
          const display = document.getElementById('code');
          display.innerText = 'Clearing Session...';
          try {
            const res = await fetch('/reset-session');
            const data = await res.json();
            display.innerText = data.message || 'Reset Completed!';
            alert('Session cleared! දැන් නැවත Phone Number එක දී Pair WhatsApp ඔබන්න.');
          } catch(e) {
            display.innerText = 'Reset Failed';
          }
        }
      </script>
    </body>
    </html>
  `);
});

// Single-Click Session Clear Route
app.get("/reset-session", async (req, res) => {
  try {
    const AuthModel = mongoose.models.SessionAuth || mongoose.model("SessionAuth");
    await AuthModel.deleteMany({});
    if (sock) {
      try { sock.end(); } catch (e) {}
      sock = null;
    }
    console.log("🧹 [SESSION PURGE] MongoDB Session Cleared Successfully!");
    return res.json({ success: true, message: "Cleared! Ready for new code" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get("/get-code", async (req, res) => {
  const { num } = req.query;
  if (!num) return res.status(400).json({ error: "Missing number" });

  try {
    const { state, saveCreds } = await useMongoAuthState();
    if (sock) { 
      try { sock.end(); } catch (e) {} 
      sock = null;
    }

    sock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }))
      },
      printQRInTerminal: false,
      logger: pino({ level: "fatal" }),
      browser: Browsers.macOS("Chrome"),
      defaultQueryTimeoutMs: 60000
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
// 3. Main Event Engine & Message Router
// ==========================================
function initEvents(waSock, saveCreds) {
  waSock.ev.on("creds.update", saveCreds);

  const initDaemons = () => {
    if (daemonsInitialized) return;
    daemonsInitialized = true;

    try {
      const statusPlugin = require("./plugins/status");
      if (statusPlugin?.initStatusWatcher) statusPlugin.initStatusWatcher(waSock);
    } catch (e) {}

    try {
      const timemgsPlugin = require("./plugins/timemgs");
      if (timemgsPlugin?.startScheduleDaemon) timemgsPlugin.startScheduleDaemon(waSock);
    } catch (e) {}
  };

  waSock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === "close") {
      daemonsInitialized = false;
      const reason = lastDisconnect?.error?.output?.statusCode;
      if (reason !== DisconnectReason.loggedOut) {
        setTimeout(startBot, 3000);
      }
    } else if (connection === "open") {
      console.log(`⚡ ${config.BOT_NAME} Connected & Fully Operational 🟢`);
      initDaemons();
    }
  });

  waSock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    const msg = messages[0];
    if (!msg?.message || !msg?.key) return;

    const from = msg.key.remoteJid;
    if (from === "status@broadcast") return;

    const mType = Object.keys(msg.message)[0];
    const body = (
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      msg.message[mType]?.caption ||
      ""
    ).trim();

    // 1. Direct Status Saver Interceptor
    const quotedStanzaId = msg.message.extendedTextMessage?.contextInfo?.stanzaId;
    if (quotedStanzaId) {
      try {
        const statusPlugin = require("./plugins/status");
        if (statusPlugin?.onReply) {
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

    // 2. Strict Owner Verification
    const myCleanNumber = (waSock.user?.id || config.OWNER_NUMBER).split(":")[0].replace(/[^0-9]/g, "");
    const rawSender = msg.key.fromMe 
      ? myCleanNumber 
      : (msg.key.participant || from || "");
    const sender = rawSender.split("@")[0].split(":")[0].replace(/[^0-9]/g, "");
    const ownerClean = config.OWNER_NUMBER.replace(/[^0-9]/g, "");
    const isOwner = msg.key.fromMe || sender === ownerClean || sender === myCleanNumber;

    if (!isOwner) return;

    // 3. Command Execution Routing
    const prefix = config.PREFIX || ",";
    if (!body.startsWith(prefix)) return;

    const [cmdTrigger, ...args] = body.slice(prefix.length).trim().split(/\s+/);
    const cmdName = cmdTrigger.toLowerCase();
    const command = commands.get(cmdName) || aliases.get(cmdName);

    if (command) {
      const targetPhone = from.split("@")[0].split(":")[0].replace(/[^0-9]/g, "");
      const isSelfChat = from.includes("@s.whatsapp.net") && (targetPhone === ownerClean || targetPhone === myCleanNumber);

      // Safe Message Dispatcher (Bypasses Signal Ratchet Mismatch)
      const reply = async (text) => {
        try {
          if (isSelfChat) {
            const waMsg = generateWAMessageFromContent(
              from,
              proto.Message.fromObject({
                conversation: String(text)
              }),
              { userJid: waSock.user.id }
            );
            return await waSock.relayMessage(from, waMsg.message, {
              messageId: waMsg.key.id
            });
          } else {
            return await waSock.sendMessage(from, { text: String(text) }, { quoted: msg });
          }
        } catch (e) {
          return await waSock.sendMessage(from, { text: String(text) }).catch(() => {});
        }
      };

      // Voice Note Sender Helper (PTT Blue Mic Waveform)
      const sendVoice = async (audioBuffer) => {
        return await waSock.sendMessage(from, {
          audio: audioBuffer,
          mimetype: "audio/mp4",
          ptt: true
        }, isSelfChat ? {} : { quoted: msg });
      };

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
        reply,
        sendVoice,
        react: (emoji) => waSock.sendMessage(from, { react: { text: emoji, key: msg.key } }).catch(() => {}),
        downloadMedia: () => downloadMediaMessage(msg, "buffer", {}),
        quoted: msg.message.extendedTextMessage?.contextInfo?.quotedMessage || null
      };

      try {
        await command.execute(context);
      } catch (err) {
        console.error(`Command [${cmdName}] execution failed:`, err.message);
      }
    }
  });
}

// ==========================================
// 4. Bot Daemon Starter
// ==========================================
async function startBot() {
  if (isStarting) return;
  isStarting = true;

  try {
    loadPlugins();
    const { state, saveCreds } = await useMongoAuthState();
    if (state.creds?.registered) {
      if (sock) {
        try { sock.end(); } catch (e) {}
      }

      sock = makeWASocket({
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }))
        },
        printQRInTerminal: false,
        logger: pino({ level: "fatal" }),
        browser: Browsers.macOS("Chrome"),
        defaultQueryTimeoutMs: 60000,
        markOnlineOnConnect: true,
        emitOwnEvents: true,
        generateHighQualityLinkPreview: true
      });

      initEvents(sock, saveCreds);
    }
  } catch (e) {
    console.error("StartBot fatal:", e.message);
  } finally {
    isStarting = false;
  }
}

const PORT = process.env.PORT || config.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  startBot();
});

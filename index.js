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
const { useMongoAuthState, connectMongo } = require("./database/mongoSession");
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
// 2. Web UI Pairing Dashboard
// ==========================================
app.get("/", (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>𝐇𝐄𝐒𝐇𝐀𝐍 𝐎𝐅𝐂</title>
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
        <h1>𝐇𝐄𝐒𝐇𝐀𝐍 𝐎𝐅𝐂</h1>
        <p>Direct Link Portal</p>
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
            if(data.code) {
              display.innerText = data.code;
            } else {
              display.innerText = data.error || 'Failed';
            }
          } catch(e) { 
            display.innerText = 'Server Error'; 
          } finally { 
            btn.disabled = false; 
          }
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

// Reset Session (Clears MongoDB session collection clean)
app.get("/reset-session", async (req, res) => {
  try {
    await connectMongo();
    const AuthModel = mongoose.models.SessionAuth || mongoose.model("SessionAuth");
    await AuthModel.deleteMany({});
    if (sock) {
      try { sock.end(); } catch (e) {}
      sock = null;
    }
    console.log("🧹 [SESSION PURGE] MongoDB Session Cleared Successfully!");
    return res.json({ success: true, message: "Cleared! Ready for new code" });
  } catch (err) {
    console.error("Reset error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// Single-Thread Safe Pairing Endpoint
app.get("/get-code", async (req, res) => {
  const { num } = req.query;
  if (!num) return res.status(400).json({ error: "Missing number" });

  try {
    const cleanNum = num.replace(/[^0-9]/g, "");
    
    // කලින් ක්‍රියාත්මක socket එකක් ඇත්නම් clean up කිරීම
    if (sock) {
      try { sock.end(); } catch (e) {}
      sock = null;
      await delay(1000);
    }

    const { state, saveCreds } = await useMongoAuthState();

    const pairSock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" }))
      },
      printQRInTerminal: false,
      logger: pino({ level: "silent" }),
      browser: Browsers.macOS("Chrome"),
      defaultQueryTimeoutMs: 60000,
      connectTimeoutMs: 60000
    });

    pairSock.ev.on("creds.update", saveCreds);

    if (!pairSock.authState.creds.registered) {
      await delay(3000); // Socket එක WhatsApp Gateway එකට handshake වීමට delay එක
      const code = await pairSock.requestPairingCode(cleanNum);
      const formattedCode = code?.match(/.{1,4}/g)?.join("-") || code;

      sock = pairSock;
      initEvents(sock, saveCreds);

      return res.json({ code: formattedCode });
    } else {
      sock = pairSock;
      initEvents(sock, saveCreds);
      return res.json({ code: "Already Linked & Online" });
    }
  } catch (err) {
    console.error("Pairing Error Log:", err);
    return res.status(500).json({ error: err.message || "Server Error" });
  }
});

app.get("/health", (req, res) => res.status(200).send("OK"));

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
          keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" }))
        },
        printQRInTerminal: false,
        logger: pino({ level: "silent" }),
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
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🌐 Web UI active on port ${PORT}`);
  startBot();
});

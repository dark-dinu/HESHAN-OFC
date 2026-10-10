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
const { useMongoAuthState } = require("./auth");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const CONFIG = {
  BOT_NAME: "𝐇𝐄𝐒𝐇𝐀𝐍 𝐎𝐅𝐂",
  PREFIX: ",",
  OWNER_NUMBER: "94719845166",
  PORT: process.env.PORT || 3000
};

const commands = new Map();
const aliases = new Map();
const messageStore = new Map(); // Anti "Waiting for this message" Cache
let sock = null;
let isStarting = false;

// ==========================================
// 1. Plugins Auto-Loader
// ==========================================
function loadPlugins() {
  commands.clear();
  aliases.clear();
  const pluginsPath = path.join(__dirname, "plugins");
  
  if (!fs.existsSync(pluginsPath)) {
    fs.mkdirSync(pluginsPath, { recursive: true });
  }

  const files = fs.readdirSync(pluginsPath).filter((f) => f.endsWith(".js"));
  for (const file of files) {
    try {
      const fullPath = path.join(pluginsPath, file);
      delete require.cache[require.resolve(fullPath)];
      const cmd = require(fullPath);
      if (cmd.name && cmd.execute) {
        commands.set(cmd.name.toLowerCase(), cmd);
        if (Array.isArray(cmd.aliases)) {
          cmd.aliases.forEach(alias => aliases.set(alias.toLowerCase(), cmd));
        }
      }
    } catch (err) {
      console.error(`[Plugin Load Error] ${file}:`, err.message);
    }
  }
  console.log(`⚡ [CORE] Loaded ${commands.size} commands cleanly.`);
}

// ==========================================
// 2. High-Speed Web Portal
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

app.get("/reset-session", async (req, res) => {
  try {
    const { clearSession } = await useMongoAuthState();
    await clearSession();
    if (sock) {
      try { sock.end(); } catch (e) {}
      sock = null;
    }
    messageStore.clear();
    return res.json({ success: true, message: "Cleared! Ready for new code" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get("/get-code", async (req, res) => {
  const { num } = req.query;
  if (!num) return res.status(400).json({ error: "Missing number" });

  try {
    const cleanNum = num.replace(/[^0-9]/g, "");
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
      getMessage: async (key) => messageStore.get(key.id) || undefined
    });

    pairSock.ev.on("creds.update", saveCreds);

    if (!pairSock.authState.creds.registered) {
      await delay(3000);
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
    return res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 3. Core Event Engine & Message Router
// ==========================================
function initEvents(waSock, saveCreds) {
  waSock.ev.on("creds.update", saveCreds);

  waSock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === "close") {
      const reason = lastDisconnect?.error?.output?.statusCode;
      if (reason !== DisconnectReason.loggedOut) {
        setTimeout(startBot, 3000);
      }
    } else if (connection === "open") {
      console.log(`⚡ [CONNECTED] ${CONFIG.BOT_NAME} Online & Ready 🟢`);
    }
  });

  waSock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    const msg = messages[0];
    if (!msg?.message || !msg?.key) return;

    // Store message to answer retry queries (Anti Waiting-For-Message)
    if (msg.key.id) {
      messageStore.set(msg.key.id, msg.message);
      if (messageStore.size > 1000) {
        const firstKey = messageStore.keys().next().value;
        messageStore.delete(firstKey);
      }
    }

    const from = msg.key.remoteJid;
    if (from === "status@broadcast") return;

    const mType = Object.keys(msg.message)[0];
    const body = (
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      msg.message[mType]?.caption ||
      ""
    ).trim();

    // Owner Verification
    const myCleanNumber = (waSock.user?.id || CONFIG.OWNER_NUMBER).split(":")[0].replace(/[^0-9]/g, "");
    const rawSender = msg.key.fromMe ? myCleanNumber : (msg.key.participant || from || "");
    const sender = rawSender.split("@")[0].split(":")[0].replace(/[^0-9]/g, "");
    const ownerClean = CONFIG.OWNER_NUMBER.replace(/[^0-9]/g, "");
    const isOwner = msg.key.fromMe || sender === ownerClean || sender === myCleanNumber;

    if (!isOwner) return;

    // Command Check
    const prefix = CONFIG.PREFIX;
    if (!body.startsWith(prefix)) return;

    const [cmdTrigger, ...args] = body.slice(prefix.length).trim().split(/\s+/);
    const cmdName = cmdTrigger.toLowerCase();
    const command = commands.get(cmdName) || aliases.get(cmdName);

    if (command) {
      const targetPhone = from.split("@")[0].split(":")[0].replace(/[^0-9]/g, "");
      const isSelfChat = from.includes("@s.whatsapp.net") && (targetPhone === ownerClean || targetPhone === myCleanNumber);

      // Safe Dispatcher (Self-chat එකේදී crash / waiting නොවී direct යැවීම)
      const reply = async (text) => {
        try {
          const sent = await waSock.sendMessage(from, { text: String(text) }, isSelfChat ? {} : { quoted: msg });
          if (sent?.key?.id) messageStore.set(sent.key.id, sent.message);
          return sent;
        } catch (e) {
          console.error("Reply Error:", e.message);
        }
      };

      // Self-chat එකේදී reaction දැමීමෙන් වළකී (කොළ පාට කොටු නොවෙන්න)
      const react = async (emoji) => {
        if (isSelfChat) return; // Prevent reaction glitch in Message Yourself
        return await waSock.sendMessage(from, { react: { text: emoji, key: msg.key } }).catch(() => {});
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
        reply,
        react,
        isSelfChat,
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
        // Phone එකෙන් message keys retry කළ විට cache එකෙන් ලබාදීම
        getMessage: async (key) => messageStore.get(key.id) || undefined
      });

      initEvents(sock, saveCreds);
    }
  } catch (e) {
    console.error("StartBot fatal:", e.message);
  } finally {
    isStarting = false;
  }
}

app.listen(CONFIG.PORT, "0.0.0.0", () => {
  console.log(`🌐 [SERVER] Web Portal running on port ${CONFIG.PORT}`);
  startBot();
});

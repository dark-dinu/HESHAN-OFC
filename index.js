const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    BufferJSON
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const mongoose = require('mongoose');
const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const { loadSettings } = require('./models/settings');
const { startSchedulerEngine } = require('./models/schedule');
const { registerAllHandlers, messageStore } = require('./handlers');
const { saveSession, getSession, deleteSession, purgeAllUserData } = require('./auth');

const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());

const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://diniduheshan40_db_user:Heshan2007@cluster0.5gazebm.mongodb.net/?appName=Cluster0";
const BOT_NAME = '𝐇𝐄𝐒𝐇𝐀𝐍 𝐎𝐅𝐂';

const devNumbers = ['94719845166', '15947733680169'];
const devs = [
    '94719845166@s.whatsapp.net',
    '15947733680169@lid'
];

const SESSION_DIR = path.join(__dirname, 'session');

let sock = null;
let isStarting = false;
let reconnectTimer = null;
let hasSentBootAlert = false;

// 🛡️ Registered Session එකක් ඇත්නම් පමණක් Restore කිරීම
async function restoreFullSession() {
    try {
        if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

        const credsPath = path.join(SESSION_DIR, 'creds.json');
        if (fs.existsSync(credsPath)) return true;

        const saved = await getSession('main_session');
        if (!saved) return false;

        if (saved.files && typeof saved.files === 'object') {
            for (const [fileName, content] of Object.entries(saved.files)) {
                fs.writeFileSync(path.join(SESSION_DIR, fileName), content, 'utf-8');
            }
            return true;
        }
        return false;
    } catch (e) {
        return false;
    }
}

// 🛡️ Encryption Keys Cloud Storage වෙත සුරැකීම
async function backupFullSession() {
    try {
        if (!fs.existsSync(SESSION_DIR)) return;
        const fileNames = fs.readdirSync(SESSION_DIR);
        if (!fileNames.includes('creds.json')) return;

        const filesMap = {};
        for (const file of fileNames) {
            const filePath = path.join(SESSION_DIR, file);
            if (fs.statSync(filePath).isFile()) {
                filesMap[file] = fs.readFileSync(filePath, 'utf-8');
            }
        }

        if (Object.keys(filesMap).length > 0) {
            await saveSession('main_session', { files: filesMap });
        }
    } catch (e) {}
}

function cleanupSocket() {
    if (sock) {
        try {
            sock.ev.removeAllListeners();
            if (sock.ws) {
                sock.ws.removeAllListeners();
                sock.ws.terminate();
            }
            sock.end(undefined);
        } catch (e) {}
        sock = null;
    }
}

function scheduleReconnect(delayMs = 1000) {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        startBot();
    }, delayMs);
}

async function startBot() {
    if (isStarting) return;
    isStarting = true;

    cleanupSocket();

    try {
        await restoreFullSession();

        const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

        sock = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }))
            },
            printQRInTerminal: false,
            logger: pino({ level: 'fatal' }),
            browser: Browsers.macOS('Desktop'),
            syncFullHistory: false,
            getMessage: async (key) => {
                if (messageStore && key?.id) {
                    const cached = messageStore.get(key.id);
                    if (cached?.message) return cached.message;
                }
                return undefined;
            },
            keepAliveIntervalMs: 25000,
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 60000,
            emitOwnEvents: true,
            markOnlineOnConnect: false
        });

        sock.ev.on('creds.update', saveCreds);

        registerAllHandlers(sock, devs, devNumbers, BOT_NAME);

        sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
            if (connection === 'close') {
                isStarting = false;
                const statusCode = lastDisconnect?.error?.output?.statusCode;

                if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                    console.log('🔴 [AUTH] Logged out. Factory Resetting...');
                    if (fs.existsSync(SESSION_DIR)) fs.rmSync(SESSION_DIR, { recursive: true, force: true });
                    await purgeAllUserData();
                    scheduleReconnect(3000);
                } else if (statusCode === DisconnectReason.restartRequired || statusCode === 515) {
                    console.log('🔄 Restart required (515) - Connecting paired device...');
                    scheduleReconnect(500);
                } else {
                    scheduleReconnect(2000);
                }
            } else if (connection === 'open') {
                isStarting = false;
                console.log(`✅ ${BOT_NAME} Live & Super Fast!`);
                startSchedulerEngine(sock);

                setTimeout(() => backupFullSession(), 3000);

                if (global.botSettings?.alwaysOnline) {
                    sock.sendPresenceUpdate('available').catch(() => {});
                }

                if (!hasSentBootAlert) {
                    hasSentBootAlert = true;
                    setTimeout(async () => {
                        try {
                            const devJid = devs[0];
                            await sock.sendMessage(devJid, { 
                                text: `⚡ *${BOT_NAME}* Online & Ready!\n\n🟢 *Engine Status:* Operational\n⏱️ *Response:* Sub-second Fast\n🔒 *Security:* End-to-End Encrypted` 
                            });
                        } catch (err) {}
                    }, 2000);
                }
            }
        });

    } catch (err) {
        isStarting = false;
        console.error('Engine Init Error:', err.message);
        scheduleReconnect(3000);
    }
}

// 🌐 Pairing Portal UI
app.get('/', (req, res) => res.redirect('/pair'));
app.get('/health', (req, res) => res.status(200).send('OK'));

app.get('/pair', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${BOT_NAME} - Pair Portal</title>
        <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap" rel="stylesheet">
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Poppins', sans-serif; }
            body { background: #0b0e14; color: #fff; display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 20px; }
            .card { background: rgba(255, 255, 255, 0.03); backdrop-filter: blur(15px); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 20px; padding: 35px 25px; max-width: 420px; width: 100%; text-align: center; box-shadow: 0 15px 35px rgba(0,0,0,0.5); }
            h1 { font-size: 24px; color: #00e676; margin-bottom: 6px; font-weight: 700; }
            p { font-size: 13px; color: #8a99ad; margin-bottom: 25px; }
            input { width: 100%; padding: 15px; border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; background: rgba(255,255,255,0.05); color: #fff; font-size: 16px; margin-bottom: 15px; outline: none; text-align: center; }
            input:focus { border-color: #00e676; box-shadow: 0 0 10px rgba(0, 230, 118, 0.2); }
            button { width: 100%; padding: 15px; border: none; border-radius: 12px; background: #00e676; color: #000; font-size: 15px; font-weight: 700; cursor: pointer; transition: 0.2s; }
            button:hover { background: #00c853; transform: translateY(-1px); }
            button:disabled { background: #444; color: #888; cursor: not-allowed; }
            #resultBox { margin-top: 25px; display: none; }
            .code-display { background: rgba(0, 230, 118, 0.08); border: 2px dashed #00e676; padding: 15px; border-radius: 12px; font-size: 28px; font-weight: 700; letter-spacing: 4px; color: #00e676; cursor: pointer; user-select: all; }
            .error-box { background: rgba(255, 68, 68, 0.1); border: 1px solid rgba(255, 68, 68, 0.2); color: #ff5252; padding: 12px; border-radius: 10px; font-size: 13px; margin-top: 15px; display: none; }
        </style>
    </head>
    <body>
        <div class="card">
            <h1>${BOT_NAME}</h1>
            <p>Enter your phone number with country code</p>
            <input type="text" id="phone" placeholder="94719845166" autocomplete="off">
            <button id="btn" onclick="getCode()">Get Pair Code</button>
            <div id="error" class="error-box"></div>
            <div id="resultBox">
                <p style="color: #bbb; margin-bottom: 10px;">Tap code to copy:</p>
                <div class="code-display" id="codeText" onclick="copyCode()"></div>
                <p style="font-size: 12px; color: #00e676; margin-top: 12px;">Enter this code on WhatsApp Linked Devices!</p>
            </div>
        </div>
        <script>
            async function getCode() {
                const phoneInput = document.getElementById('phone');
                const btn = document.getElementById('btn');
                const err = document.getElementById('error');
                const resBox = document.getElementById('resultBox');
                const codeText = document.getElementById('codeText');

                let phone = phoneInput.value.replace(/[^0-9]/g, '');
                if (!phone || phone.length < 10) {
                    err.innerText = "Please enter a valid phone number with country code!";
                    err.style.display = "block";
                    return;
                }

                err.style.display = "none";
                resBox.style.display = "none";
                btn.disabled = true;
                btn.innerText = "Generating Code...";

                try {
                    const response = await fetch('/api/pair?phone=' + phone);
                    const data = await response.json();

                    if (data.status && data.code) {
                        codeText.innerText = data.code;
                        resBox.style.display = "block";
                        btn.style.display = "none";
                        phoneInput.style.display = "none";
                    } else {
                        throw new Error(data.message || "Failed to generate pairing code");
                    }
                } catch (e) {
                    err.innerText = "⚠️ " + e.message;
                    err.style.display = "block";
                    btn.disabled = false;
                    btn.innerText = "Try Again";
                }
            }

            function copyCode() {
                const text = document.getElementById('codeText').innerText;
                navigator.clipboard.writeText(text);
                alert("Copied Pairing Code: " + text);
            }
        </script>
    </body>
    </html>
    `);
});

// ⚡ Ultra-Stable Pairing API (Auto Cleans Broken Unlinked Sessions)
app.get('/api/pair', async (req, res) => {
    let phone = req.query.phone;
    if (!phone) return res.json({ status: false, message: 'Phone number is required' });
    phone = phone.replace(/[^0-9]/g, '');

    try {
        if (!sock) {
            startBot();
            await delay(2000);
        }

        if (sock?.authState?.creds?.registered) {
            return res.json({ status: false, message: 'Bot is already linked to WhatsApp!' });
        }

        // Socket එක disconnected හෝ closed නම් re-init කිරීම
        if (!sock?.ws || sock.ws.readyState !== 1) {
            if (fs.existsSync(SESSION_DIR)) fs.rmSync(SESSION_DIR, { recursive: true, force: true });
            cleanupSocket();
            await startBot();
            await delay(2500);
        }

        await delay(1000);
        let code = await sock.requestPairingCode(phone);
        code = code?.match(/.{1,4}/g)?.join('-') || code;
        return res.json({ status: true, code });
    } catch (err) {
        console.error('[PAIR CODE ERROR]:', err.message);
        // Socket එක stale වී ඇත්නම් clean restart එකක් ලබා දීම
        cleanupSocket();
        if (fs.existsSync(SESSION_DIR)) fs.rmSync(SESSION_DIR, { recursive: true, force: true });
        scheduleReconnect(1000);
        return res.json({ status: false, message: err.message || 'Error generating code. Please click Try Again in 5 seconds.' });
    }
});

// Keep-Alive
setInterval(() => {
    http.get(`http://localhost:${PORT}/health`, () => {}).on('error', () => {});
    const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
    if (RENDER_EXTERNAL_URL) {
        https.get(`${RENDER_EXTERNAL_URL}/health`, () => {}).on('error', () => {});
    }
}, 1000 * 60 * 3);

// Crash Guards
process.on('uncaughtException', (err) => console.error('🛡️ [CRASH GUARD]:', err.message));
process.on('unhandledRejection', (reason) => console.error('🛡️ [REJECTION GUARD]:', reason?.message || reason));

// ⚡ Immediate Port Binding (Render Timeout වීම 100% වළක්වයි)
app.listen(PORT, async () => {
    console.log(`🌐 Web Server running on port ${PORT}`);
    try {
        await mongoose.connect(MONGO_URI);
        console.log('✅ Connected to Database Engine!');
        await loadSettings();
    } catch (err) {
        console.error('❌ DB Error:', err.message);
    }
    startBot();
});

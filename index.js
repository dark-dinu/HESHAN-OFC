const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    delay,
    makeCacheableSignalKeyStore,
    Browsers
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
            browser: Browsers.ubuntu('Chrome'),
            syncFullHistory: false,
            getMessage: async (key) => {
                if (messageStore && key?.id) {
                    const cached = messageStore.get(key.id);
                    if (cached?.message) return cached.message;
                }
                return undefined;
            },
            keepAliveIntervalMs: 30000,
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 60000
        });

        sock.ev.on('creds.update', saveCreds);

        // Handlers Register කිරීම
        registerAllHandlers(sock, devs, devNumbers, BOT_NAME);

        sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
            if (connection === 'close') {
                isStarting = false;
                const statusCode = lastDisconnect?.error?.output?.statusCode;

                if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                    console.log('🔴 [AUTH] Logged out. Performing Factory Reset...');
                    if (fs.existsSync(SESSION_DIR)) fs.rmSync(SESSION_DIR, { recursive: true, force: true });
                    await purgeAllUserData();
                    scheduleReconnect(3000);
                } else if (statusCode === DisconnectReason.restartRequired || statusCode === 515) {
                    console.log('🔄 Restart required (515) - Reconnecting...');
                    scheduleReconnect(500);
                } else {
                    scheduleReconnect(2000);
                }
            } else if (connection === 'open') {
                isStarting = false;
                console.log(`✅ [ENGINE] ${BOT_NAME} Live & Operational!`);
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

// 🌐 Pair Portal
app.get('/', (req, res) => res.redirect('/pair'));
app.get('/health', (req, res) => res.status(200).send('OK'));

app.get('/pair', (req, res) => {
    res.send(`<!DOCTYPE html><html><head><title>${BOT_NAME} - Pair</title><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>body{background:#0b0e14;color:#fff;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;font-family:sans-serif}.card{background:#151a23;padding:30px;border-radius:15px;text-align:center;max-width:380px;width:90%}input{width:100%;padding:12px;margin:15px 0;border-radius:8px;border:1px solid #333;background:#0b0e14;color:#fff;text-align:center;font-size:16px;box-sizing:border-box}button{width:100%;padding:12px;background:#00e676;border:none;border-radius:8px;font-weight:bold;cursor:pointer}#code{margin-top:20px;font-size:24px;color:#00e676;letter-spacing:3px;font-weight:bold;cursor:pointer}</style></head><body><div class="card"><h2>${BOT_NAME}</h2><p>Enter phone number with country code</p><input type="text" id="phone" placeholder="94719845166"><button onclick="getPair()">Get Pair Code</button><div id="code" onclick="navigator.clipboard.writeText(this.innerText);alert('Copied!')"></div></div><script>async function getPair(){const p=document.getElementById('phone').value.replace(/[^0-9]/g,'');if(!p)return alert('Enter number');document.getElementById('code').innerText='Generating...';const res=await fetch('/api/pair?phone='+p);const d=await res.json();if(d.status){document.getElementById('code').innerText=d.code;}else{alert(d.message||'Error');document.getElementById('code').innerText='';}}</script></body></html>`);
});

app.get('/api/pair', async (req, res) => {
    let phone = req.query.phone;
    if (!phone) return res.json({ status: false, message: 'Phone number required' });
    phone = phone.replace(/[^0-9]/g, '');

    try {
        if (sock?.authState?.creds?.registered) {
            return res.json({ status: false, message: 'Bot already linked!' });
        }

        if (fs.existsSync(SESSION_DIR)) fs.rmSync(SESSION_DIR, { recursive: true, force: true });
        await deleteSession('main_session');

        cleanupSocket();
        isStarting = false;
        await startBot();

        let retries = 0;
        while ((!sock || !sock.requestPairingCode) && retries < 20) {
            await delay(500);
            retries++;
        }

        if (!sock || !sock.requestPairingCode) {
            return res.json({ status: false, message: 'Failed to init socket. Try again.' });
        }

        await delay(2000);
        let code = await sock.requestPairingCode(phone);
        code = code?.match(/.{1,4}/g)?.join('-') || code;
        return res.json({ status: true, code });

    } catch (err) {
        return res.json({ status: false, message: err.message });
    }
});

setInterval(() => {
    http.get(`http://localhost:${PORT}/health`, () => {}).on('error', () => {});
    if (process.env.RENDER_EXTERNAL_URL) {
        https.get(`${process.env.RENDER_EXTERNAL_URL}/health`, () => {}).on('error', () => {});
    }
}, 180000);

process.on('uncaughtException', (err) => console.error('🛡️ [CRASH]:', err.message));
process.on('unhandledRejection', (reason) => console.error('🛡️ [REJECT]:', reason?.message || reason));

app.listen(PORT, async () => {
    console.log(`🌐 Server running on port ${PORT}`);
    try {
        await mongoose.connect(MONGO_URI);
        console.log('✅ Connected to Database Engine!');
        await loadSettings();
    } catch (err) {
        console.error('❌ Connection Error:', err.message);
    }
    startBot();
});

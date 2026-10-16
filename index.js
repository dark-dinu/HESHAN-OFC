Const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    fetchLatestBaileysVersion
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
const { saveSession, getSession, deleteSession } = require('./auth');

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

const BOTS = {
    1: { id: 'bot_1', sessionDir: path.join(__dirname, 'session_1'), sock: null, isStarting: false, reconnectTimer: null },
    2: { id: 'bot_2', sessionDir: path.join(__dirname, 'session_2'), sock: null, isStarting: false, reconnectTimer: null }
};

// 🛡️ Multi-Session Cloud Sync
async function restoreSession(botNum) {
    const bot = BOTS[botNum];
    try {
        if (!fs.existsSync(bot.sessionDir)) fs.mkdirSync(bot.sessionDir, { recursive: true });
        const credsPath = path.join(bot.sessionDir, 'creds.json');
        if (fs.existsSync(credsPath)) return true;

        const saved = await getSession(bot.id);
        if (!saved || !saved.files) return false;

        for (const [fileName, content] of Object.entries(saved.files)) {
            fs.writeFileSync(path.join(bot.sessionDir, fileName), content, 'utf-8');
        }
        return true;
    } catch {
        return false;
    }
}

async function backupSession(botNum) {
    const bot = BOTS[botNum];
    try {
        if (!fs.existsSync(bot.sessionDir)) return;
        const fileNames = fs.readdirSync(bot.sessionDir);
        if (!fileNames.includes('creds.json')) return;

        const filesMap = {};
        for (const file of fileNames) {
            const filePath = path.join(bot.sessionDir, file);
            if (fs.statSync(filePath).isFile()) {
                filesMap[file] = fs.readFileSync(filePath, 'utf-8');
            }
        }
        if (Object.keys(filesMap).length > 0) {
            await saveSession(bot.id, { files: filesMap });
        }
    } catch {}
}

function cleanupSocket(botNum) {
    const bot = BOTS[botNum];
    if (bot.sock) {
        try {
            bot.sock.ev.removeAllListeners();
            if (bot.sock.ws) {
                bot.sock.ws.removeAllListeners();
                bot.sock.ws.terminate();
            }
            bot.sock.end(undefined);
        } catch {}
        bot.sock = null;
    }
}

function scheduleReconnect(botNum, delayMs = 1500) {
    const bot = BOTS[botNum];
    if (bot.reconnectTimer) clearTimeout(bot.reconnectTimer);
    bot.reconnectTimer = setTimeout(() => {
        bot.reconnectTimer = null;
        startBotInstance(botNum);
    }, delayMs);
}

async function startBotInstance(botNum) {
    const bot = BOTS[botNum];
    if (bot.isStarting) return;
    bot.isStarting = true;

    cleanupSocket(botNum);

    try {
        await restoreSession(botNum);
        const { state, saveCreds } = await useMultiFileAuthState(bot.sessionDir);
        const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1015901307] }));

        bot.sock = makeWASocket({
            version,
            auth: {
                creds: state.creds,
                // Direct Signal Keys Store (Decryption Loss නොවීමට)
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
            },
            printQRInTerminal: false,
            logger: pino({ level: 'silent' }),
            browser: Browsers.ubuntu('Chrome'),
            syncFullHistory: false,
            generateHighQualityLinkPreview: true,
            // Pre-key / E2EE Retry System
            getMessage: async (key) => {
                if (messageStore && key?.id) {
                    const cached = messageStore.get(key.id);
                    if (cached?.message) return cached.message;
                }
                return { conversation: 'Pong' };
            },
            keepAliveIntervalMs: 25000,
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 60000,
            emitOwnEvents: true
        });

        bot.sock.ev.on('creds.update', async () => {
            await saveCreds();
            backupSession(botNum);
        });

        registerAllHandlers(bot.sock, devs, devNumbers, BOT_NAME, botNum);

        bot.sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
            if (connection === 'close') {
                bot.isStarting = false;
                const statusCode = lastDisconnect?.error?.output?.statusCode;

                if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                    console.log(`🔴 [BOT #${botNum}] Logged out. Clearing Session...`);
                    if (fs.existsSync(bot.sessionDir)) fs.rmSync(bot.sessionDir, { recursive: true, force: true });
                    await deleteSession(bot.id);
                    scheduleReconnect(botNum, 3000);
                } else if (statusCode === DisconnectReason.restartRequired || statusCode === 515) {
                    scheduleReconnect(botNum, 500);
                } else {
                    scheduleReconnect(botNum, 2000);
                }
            } else if (connection === 'open') {
                bot.isStarting = false;
                console.log(`✅ [BOT #${botNum}] Connected & Live!`);
                if (botNum === 1) startSchedulerEngine(bot.sock);
                setTimeout(() => backupSession(botNum), 3000);

                if (global.botSettings?.alwaysOnline) {
                    bot.sock.sendPresenceUpdate('available').catch(() => {});
                }
            }
        });

    } catch (err) {
        bot.isStarting = false;
        console.error(`[BOT #${botNum} INIT ERROR]:`, err.message);
        scheduleReconnect(botNum, 3000);
    }
}

// 🌐 Unified Dual-Bot Pairing Portal
app.get('/', (req, res) => res.redirect('/pair'));
app.get('/health', (req, res) => res.status(200).send('OK'));

app.get('/pair', (req, res) => {
    res.send(`
    <!DOCTYPE html><html><head><title>${BOT_NAME} - Controller</title><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>*{margin:0;padding:0;box-sizing:border-box;font-family:sans-serif;}body{background:#0a0d14;color:#fff;display:flex;justify-content:center;align-items:center;min-height:100vh;padding:20px;}.card{background:#131822;border:1px solid #232b3b;padding:30px 20px;border-radius:20px;text-align:center;max-width:400px;width:100%;}.tabs{display:flex;gap:10px;margin-bottom:20px;}.tab{flex:1;padding:12px;border-radius:10px;background:#1c2433;color:#bbb;font-weight:bold;cursor:pointer;}.tab.active{background:#00e676;color:#000;}input{width:100%;padding:14px;margin-bottom:12px;border-radius:12px;border:1px solid #2e3a4e;background:#0a0d14;color:#fff;text-align:center;font-size:16px;}button{width:100%;padding:14px;border:none;border-radius:12px;font-size:15px;font-weight:bold;cursor:pointer;margin-bottom:10px;}.btn-pair{background:#00e676;color:#000;}.btn-reset{background:rgba(255,68,68,0.15);color:#ff5252;}#codeBox{margin-top:16px;display:none;background:rgba(0,230,118,0.08);border:2px dashed #00e676;border-radius:12px;padding:14px;}#codeText{font-size:26px;font-weight:800;color:#00e676;letter-spacing:4px;cursor:pointer;}</style></head><body><div class="card"><h2 style="color:#00e676;margin-bottom:6px;">${BOT_NAME}</h2><p style="font-size:13px;color:#8899a6;margin-bottom:20px;">Dual Instance Controller</p><div class="tabs"><div class="tab active" id="tab1" onclick="switchBot(1)">🤖 BOT #1</div><div class="tab" id="tab2" onclick="switchBot(2)">🤖 BOT #2</div></div><input type="text" id="phone" placeholder="94719845166"><button class="btn-pair" id="pairBtn" onclick="requestPairCode()">Get Pairing Code</button><button class="btn-reset" onclick="resetSelectedBot()">Unlink & Reset This Bot</button><div id="codeBox"><div style="font-size:12px;color:#aaa;margin-bottom:6px;">Tap Code to Copy:</div><div id="codeText" onclick="navigator.clipboard.writeText(this.innerText);alert('Copied!')"></div></div></div><script>let currentBot=1;function switchBot(n){currentBot=n;document.getElementById('tab1').className=n===1?'tab active':'tab';document.getElementById('tab2').className=n===2?'tab active':'tab';document.getElementById('codeBox').style.display='none';}async function requestPairCode(){const p=document.getElementById('phone').value.replace(/[^0-9]/g,'');if(!p)return alert('Enter number');const btn=document.getElementById('pairBtn');btn.disabled=true;btn.innerText='Connecting...';try{const res=await fetch('/api/pair?bot='+currentBot+'&phone='+p);const d=await res.json();if(d.status){document.getElementById('codeText').innerText=d.code;document.getElementById('codeBox').style.display='block';}else{alert(d.message);}}catch(e){alert('Error');}finally{btn.disabled=false;btn.innerText='Get Pairing Code';}}async function resetSelectedBot(){if(!confirm('Reset Bot #'+currentBot+'? This will fix waiting message error.'))return;const res=await fetch('/api/reset?bot='+currentBot);const d=await res.json();alert(d.message);location.reload();}</script></body></html>
    `);
});

app.get('/api/pair', async (req, res) => {
    const botNum = Number(req.query.bot) === 2 ? 2 : 1;
    let phone = req.query.phone;
    if (!phone) return res.json({ status: false, message: 'Phone number required' });
    phone = phone.replace(/[^0-9]/g, '');

    const bot = BOTS[botNum];
    try {
        if (bot.sock?.authState?.creds?.registered) {
            return res.json({ status: false, message: `Bot #${botNum} is already linked! Use Unlink & Reset first.` });
        }
        if (fs.existsSync(bot.sessionDir)) fs.rmSync(bot.sessionDir, { recursive: true, force: true });
        await deleteSession(bot.id);
        cleanupSocket(botNum);
        bot.isStarting = false;
        await startBotInstance(botNum);

        let retries = 0;
        while ((!bot.sock || !bot.sock.requestPairingCode) && retries < 25) {
            await delay(500);
            retries++;
        }
        if (!bot.sock || !bot.sock.requestPairingCode) {
            return res.json({ status: false, message: 'Timeout. Please click again.' });
        }

        await delay(2000);
        let code = await bot.sock.requestPairingCode(phone);
        code = code?.match(/.{1,4}/g)?.join('-') || code;
        return res.json({ status: true, code });
    } catch (err) {
        return res.json({ status: false, message: err.message });
    }
});

app.get('/api/reset', async (req, res) => {
    const botNum = Number(req.query.bot) === 2 ? 2 : 1;
    const bot = BOTS[botNum];
    try {
        if (fs.existsSync(bot.sessionDir)) fs.rmSync(bot.sessionDir, { recursive: true, force: true });
        await deleteSession(bot.id);
        cleanupSocket(botNum);
        bot.isStarting = false;
        startBotInstance(botNum);
        return res.json({ status: true, message: `Bot #${botNum} reset! Keys purged. Pair freshly now.` });
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
        await loadSettings();
    } catch (err) {
        console.error('❌ Connection Error:', err.message);
    }
    startBotInstance(1);
    setTimeout(() => startBotInstance(2), 2500);
});

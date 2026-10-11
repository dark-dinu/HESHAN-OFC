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
const fs = require('fs');
const path = require('path');
const { saveSession, getSession, deleteSession } = require('./auth');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const MONGO_URI = "mongodb+srv://diniduheshan40_db_user:Heshan2007@cluster0.5gazebm.mongodb.net/?appName=Cluster0";
const BOT_NAME = '𝐇𝐄𝐒𝐇𝐀𝐍 𝐎𝐅𝐂';
const devs = ['94719845166@s.whatsapp.net', '15947733680169@s.whatsapp.net'];

global.botSettings = { mode: 'public' };

// Connect Database
mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ MongoDB Connected to 𝐇𝐄𝐒𝐇𝐀𝐍 𝐎𝐅𝐂!'))
    .catch(err => console.log('❌ DB Error:', err));

let sock = null;
let isPairingInProgress = false; // Code එක confirm කරනකල් restart වීම block කරනවා

// Register Bot Commands
function registerCommands(socket) {
    socket.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message) return;

        const sender = msg.key.remoteJid;
        const isMe = msg.key.fromMe;
        const isDev = devs.includes(msg.participant || sender);

        // Auto Status Seen & React
        if (sender === 'status@broadcast') {
            await socket.readMessages([msg.key]);
            await socket.sendMessage(sender, { react: { text: '🩷', key: msg.key } });
            return;
        }

        if (global.botSettings.mode === 'private' && !isDev && !isMe) return;
        if (global.botSettings.mode === 'group' && !sender.endsWith('@g.us') && !isDev) return;

        const messageType = Object.keys(msg.message)[0];
        const text = msg.message.conversation || msg.message[messageType]?.text || msg.message[messageType]?.caption || '';
        
        if (!text.startsWith('.')) return;

        const args = text.slice(1).trim().split(/ +/);
        const command = args.shift().toLowerCase();

        try {
            const cmdPath = path.join(__dirname, 'commands', `${command}.js`);
            if (fs.existsSync(cmdPath)) {
                const cmd = require(cmdPath);
                await cmd.execute(socket, msg, args, isDev, BOT_NAME);
            }
        } catch (error) {
            console.error(`Error executing ${command}:`, error);
        }
    });
}

// Start Main Bot Engine
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('./session');

    sock = makeWASocket({
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }))
        },
        printQRInTerminal: false,
        logger: pino({ level: 'fatal' }),
        browser: Browsers.ubuntu('Chrome'), // ✅ Chrome Browser identity on Linux
        defaultQueryTimeoutMs: undefined,
        syncFullHistory: false
    });

    sock.ev.on('creds.update', async () => {
        await saveCreds();
        if (fs.existsSync('./session/creds.json')) {
            const creds = JSON.parse(fs.readFileSync('./session/creds.json', 'utf-8'));
            await saveSession('main_session', creds);
        }
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            console.log(`Connection closed with code: ${statusCode}`);

            // Code එක phone එකට ගහන වෙලාවේ socket restart වෙන්න නොදී lock කර තබයි
            if (isPairingInProgress) {
                console.log('⏳ Pairing in progress, waiting for device confirmation...');
                return;
            }

            if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                console.log('❌ Logged Out. Clearing session...');
                if (fs.existsSync('./session')) fs.rmSync('./session', { recursive: true, force: true });
                await deleteSession('main_session');
                setTimeout(startBot, 3000);
            } else {
                setTimeout(startBot, 3000);
            }
        } else if (connection === 'open') {
            console.log(`✅ ${BOT_NAME} Connected & Fully Active!`);
            isPairingInProgress = false;
            registerCommands(sock);
            try {
                await sock.sendMessage(devs[0], { text: `🚀 *${BOT_NAME}* Successfully Connected!` });
            } catch (e) {}
        }
    });
}

// ==========================================
// 🌐 Pairing Web Portal
// ==========================================
app.get('/', (req, res) => res.redirect('/pair'));

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
            button:hover { background: #00c853; }
            button:disabled { background: #444; color: #888; cursor: not-allowed; }
            #resultBox { margin-top: 20px; display: none; }
            .code-display { background: rgba(0, 230, 118, 0.08); border: 2px dashed #00e676; padding: 15px; border-radius: 12px; font-size: 32px; font-weight: 700; letter-spacing: 5px; color: #00e676; cursor: pointer; }
            .error-box { background: rgba(255, 68, 68, 0.1); border: 1px solid rgba(255, 68, 68, 0.2); color: #ff5252; padding: 12px; border-radius: 10px; font-size: 13px; margin-top: 15px; display: none; }
            .footer { margin-top: 25px; font-size: 11px; color: #556270; }
        </style>
    </head>
    <body>
        <div class="card">
            <h1>${BOT_NAME}</h1>
            <p>Enter your phone number to pair with Chrome engine</p>
            
            <input type="text" id="phone" placeholder="94719845166" autocomplete="off">
            <button id="btn" onclick="getCode()">Get Pair Code</button>
            
            <div id="error" class="error-box"></div>

            <div id="resultBox">
                <p style="color: #bbb; margin-bottom: 10px;">Click to copy your code:</p>
                <div class="code-display" id="codeText" onclick="copyCode()"></div>
                <p style="font-size: 12px; color: #00e676; margin-top: 10px;">⚡ Enter on WhatsApp now! Linked automatically.</p>
            </div>

            <div class="footer">© 2026 ${BOT_NAME} • Ultra Fast Pairing</div>
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
                btn.innerText = "Requesting Code...";

                try {
                    const response = await fetch('/api/pair?phone=' + phone);
                    const data = await response.json();

                    if (data.status && data.code) {
                        codeText.innerText = data.code;
                        resBox.style.display = "block";
                        btn.style.display = "none";
                        phoneInput.style.display = "none";
                    } else {
                        throw new Error(data.message || "Failed to generate code");
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
                alert("Code copied: " + text);
            }
        </script>
    </body>
    </html>
    `);
});

// Single Direct Pairing API
app.get('/api/pair', async (req, res) => {
    let phone = req.query.phone;
    if (!phone) return res.json({ status: false, message: 'Phone number is required' });

    phone = phone.replace(/[^0-9]/g, '');

    try {
        if (!sock) {
            return res.json({ status: false, message: 'Bot engine is initializing. Please wait 5s.' });
        }

        if (sock.authState?.creds?.registered) {
            return res.json({ status: false, message: 'Bot is already connected to WhatsApp!' });
        }

        // Lock socket to prevent auto-restart while user is linking
        isPairingInProgress = true;

        let code = await sock.requestPairingCode(phone);
        code = code?.match(/.{1,4}/g)?.join('-') || code;

        // Auto release lock after 60s
        setTimeout(() => { isPairingInProgress = false; }, 60000);

        return res.json({ status: true, code });

    } catch (err) {
        console.error('Pairing Error:', err);
        isPairingInProgress = false;
        return res.json({ status: false, message: 'WhatsApp error. Please try again in 5 seconds.' });
    }
});

// Server Startup
app.listen(PORT, async () => {
    console.log(`🌐 Server running on port ${PORT}`);
    
    const savedCreds = await getSession('main_session');
    if (savedCreds) {
        if (!fs.existsSync('./session')) fs.mkdirSync('./session', { recursive: true });
        fs.writeFileSync('./session/creds.json', JSON.stringify(savedCreds, null, 2));
        console.log('🔑 Session found in MongoDB.');
    }
    
    startBot();
});

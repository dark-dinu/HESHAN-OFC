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
const fs = require('fs');
const path = require('path');
const { saveSession, getSession, deleteSession } = require('./auth');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Mongo URI
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://diniduheshan40_db_user:Heshan2007@cluster0.5gazebm.mongodb.net/?appName=Cluster0";
const BOT_NAME = '𝐇𝐄𝐒𝐇𝐀𝐍 𝐎𝐅𝐂';

// 🔑 Developer & Owner Identifiers (Phone Number, LID සහ JID ආකෘති)
const devNumbers = ['94719845166', '15947733680169'];
const devs = [
    '94719845166@s.whatsapp.net',
    '15947733680169@lid'
];

global.botSettings = { mode: 'public' };

const SESSION_DIR = path.join(__dirname, 'session');

// MongoDB Connection
mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ MongoDB Connected to 𝐇𝐄𝐒𝐇𝐀𝐍 𝐎𝐅𝐂!'))
    .catch(err => console.error('❌ DB Error:', err.message));

let sock = null;

// Command Engine එක Socket එකට එක් කිරීම
function attachMessageListener(socket) {
    socket.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg || !msg.message) return;

        const isMe = Boolean(msg.key.fromMe);
        const remoteJid = msg.key.remoteJid || '';

        // Bot ගේම අංකය ලබාගැනීම
        const botUserNumber = socket.user?.id 
            ? socket.user.id.split(':')[0].split('@')[0].replace(/[^0-9]/g, '') 
            : '';

        // Sender ගේ සැබෑ JID එක (Group, Inbox හෝ Message Yourself අනුව)
        let rawSender = isMe 
            ? (socket.user?.id || socket.user?.lid || remoteJid) 
            : (msg.key.participant || msg.participant || remoteJid);

        // Device suffix (:1, :2) ඉවත් කර පිරිසිදු ID එක වෙන්කර ගැනීම
        const cleanSender = rawSender 
            ? rawSender.split(':')[0].split('@')[0].replace(/[^0-9]/g, '') 
            : '';

        // 🛡️ 100% Developer & Bot Owner Verification:
        // 1. තමන්ගේම එකවුන්ට් එකෙන් මැසේජ් කරද්දී (isMe)
        // 2. අංකය devNumbers (Phone/LID) list එකේ තිබේ නම්
        // 3. rawSender එක devs list එකේ තිබේ නම්
        // 4. Sender අංකය Bot ගේම අංකයට සමාන නම්
        const isDev = isMe || 
                      devNumbers.includes(cleanSender) || 
                      devs.includes(rawSender.split(':')[0] + '@' + rawSender.split('@')[1]) ||
                      (cleanSender && cleanSender === botUserNumber);

        // Auto Status Seen & React
        if (remoteJid === 'status@broadcast') {
            await socket.readMessages([msg.key]);
            await socket.sendMessage(remoteJid, { react: { text: '🩷', key: msg.key } });
            return;
        }

        // Mode Restrictions
        if (global.botSettings.mode === 'private' && !isDev) return;
        if (global.botSettings.mode === 'group' && !remoteJid.endsWith('@g.us') && !isDev) return;

        const messageType = Object.keys(msg.message)[0];
        const text = msg.message.conversation || msg.message[messageType]?.text || msg.message[messageType]?.caption || '';
        
        if (!text.startsWith('.')) return;

        const args = text.slice(1).trim().split(/ +/);
        const command = args.shift().toLowerCase();

        console.log(`[CMD] .${command} | From: ${cleanSender || 'Me'} | isDev: ${isDev}`);

        try {
            const cmdPath = path.join(__dirname, 'commands', `${command}.js`);
            if (fs.existsSync(cmdPath)) {
                const cmd = require(cmdPath);
                // cleanSender අගයද command එකට යවයි
                await cmd.execute(socket, msg, args, isDev, BOT_NAME, cleanSender || botUserNumber);
            }
        } catch (error) {
            console.error(`Error executing ${command}:`, error);
        }
    });
}

// Main Bot Engine
async function startBot() {
    if (!fs.existsSync(SESSION_DIR)) {
        fs.mkdirSync(SESSION_DIR, { recursive: true });
    }

    const credsPath = path.join(SESSION_DIR, 'creds.json');
    if (!fs.existsSync(credsPath)) {
        const savedCreds = await getSession('main_session');
        if (savedCreds) {
            fs.writeFileSync(credsPath, JSON.stringify(savedCreds, BufferJSON.replacer, 2));
            console.log('🔑 Restored credentials from MongoDB.');
        }
    }

    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

    sock = makeWASocket({
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }))
        },
        printQRInTerminal: false,
        logger: pino({ level: 'fatal' }),
        browser: Browsers.ubuntu('Chrome'),
        defaultQueryTimeoutMs: 60000,
        syncFullHistory: false
    });

    attachMessageListener(sock);

    sock.ev.on('creds.update', async () => {
        await saveCreds();
        try {
            if (fs.existsSync(credsPath)) {
                const creds = JSON.parse(fs.readFileSync(credsPath, 'utf-8'), BufferJSON.reviver);
                await saveSession('main_session', creds);
            }
        } catch (err) {
            console.error('Failed to sync creds to DB:', err.message);
        }
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            console.log(`Connection closed with status: ${statusCode}`);

            const shouldReconnect = statusCode !== DisconnectReason.loggedOut && statusCode !== 401;

            if (shouldReconnect) {
                console.log('🔄 Reconnecting in 3 seconds...');
                setTimeout(startBot, 3000);
            } else {
                console.log('❌ Logged out or session expired. Resetting session...');
                if (fs.existsSync(SESSION_DIR)) {
                    fs.rmSync(SESSION_DIR, { recursive: true, force: true });
                }
                await deleteSession('main_session');
                setTimeout(startBot, 3000);
            }
        } else if (connection === 'open') {
            console.log(`✅ ${BOT_NAME} Successfully Connected to WhatsApp!`);
            try {
                await sock.sendMessage('94719845166@s.whatsapp.net', { text: `🚀 *${BOT_NAME}* Successfully Connected!` });
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
            .code-display { background: rgba(0, 230, 118, 0.08); border: 2px dashed #00e676; padding: 15px; border-radius: 12px; font-size: 30px; font-weight: 700; letter-spacing: 4px; color: #00e676; cursor: pointer; }
            .error-box { background: rgba(255, 68, 68, 0.1); border: 1px solid rgba(255, 68, 68, 0.2); color: #ff5252; padding: 12px; border-radius: 10px; font-size: 13px; margin-top: 15px; display: none; }
            .footer { margin-top: 25px; font-size: 11px; color: #556270; }
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
                <p style="color: #bbb; margin-bottom: 10px;">Click code to copy:</p>
                <div class="code-display" id="codeText" onclick="copyCode()"></div>
                <p style="font-size: 12px; color: #00e676; margin-top: 12px;">⚡ Enter code on WhatsApp > Linked Devices!</p>
            </div>

            <div class="footer">© 2026 ${BOT_NAME} • WhatsApp Web Engine</div>
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
                    err.innerText = "Please enter a valid phone number with country code (e.g. 9471XXXXXXX)";
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
                alert("Copied: " + text);
            }
        </script>
    </body>
    </html>
    `);
});

// Pairing Code Generator API
app.get('/api/pair', async (req, res) => {
    let phone = req.query.phone;
    if (!phone) return res.json({ status: false, message: 'Phone number is required' });

    phone = phone.replace(/[^0-9]/g, '');

    try {
        if (!sock) {
            return res.json({ status: false, message: 'Bot engine is starting. Try again in 5s.' });
        }

        if (sock.authState?.creds?.registered) {
            return res.json({ status: false, message: 'Bot is already linked to WhatsApp!' });
        }

        await delay(1500);
        let code = await sock.requestPairingCode(phone);
        code = code?.match(/.{1,4}/g)?.join('-') || code;

        return res.json({ status: true, code });
    } catch (err) {
        console.error('Pairing Error:', err);
        return res.json({ status: false, message: err.message || 'Error generating pair code. Please retry.' });
    }
});

// Run Server
app.listen(PORT, () => {
    console.log(`🌐 Server running on port ${PORT}`);
    startBot();
});

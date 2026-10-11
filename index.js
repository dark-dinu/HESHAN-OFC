const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    Browsers, 
    delay,
    makeCacheableSignalKeyStore 
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const mongoose = require('mongoose');
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Configs
const MONGO_URI = "mongodb+srv://diniduheshan40_db_user:Heshan2007@cluster0.5gazebm.mongodb.net/?appName=Cluster0";
const BOT_NAME = '𝐇𝐄𝐒𝐇𝐀𝐍 𝐎𝐅𝐂';
const devs = ['94719845166@s.whatsapp.net', '15947733680169@s.whatsapp.net'];

global.botSettings = { mode: 'public' };

// 📦 MongoDB Session Schema
const sessionSchema = new mongoose.Schema({
    id: { type: String, default: 'session' },
    creds: { type: Object }
});
const SessionModel = mongoose.model('BotSession', sessionSchema);

// MongoDB Connect
mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ MongoDB Connected to 𝐇𝐄𝐒𝐇𝐀𝐍 𝐎𝐅𝐂!'))
    .catch(err => console.log('❌ MongoDB Connection Error:', err));

// MongoDB Helpers
async function restoreSessionFromDB() {
    try {
        const data = await SessionModel.findOne({ id: 'session' });
        if (data && data.creds) {
            if (!fs.existsSync('./session')) fs.mkdirSync('./session', { recursive: true });
            fs.writeFileSync('./session/creds.json', JSON.stringify(data.creds, null, 2));
            console.log('☁️ Session restored from MongoDB!');
            return true;
        }
    } catch (e) {
        console.error('Session restore error:', e);
    }
    return false;
}

async function backupSessionToDB() {
    try {
        if (fs.existsSync('./session/creds.json')) {
            const creds = JSON.parse(fs.readFileSync('./session/creds.json', 'utf-8'));
            await SessionModel.findOneAndUpdate({ id: 'session' }, { creds }, { upsert: true });
            console.log('☁️ Session backed up to MongoDB successfully!');
        }
    } catch (e) {
        console.error('Session backup error:', e);
    }
}

// 🤖 Attach Message & Status Handlers
function setupBotHandlers(sock) {
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message) return;

        const sender = msg.key.remoteJid;
        const isMe = msg.key.fromMe;
        const isDev = devs.includes(msg.participant || sender);

        // 🩷 Auto Status Seen & React
        if (sender === 'status@broadcast') {
            await sock.readMessages([msg.key]);
            await sock.sendMessage(sender, { react: { text: '🩷', key: msg.key } });
            return;
        }

        // Mode Check
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
                await cmd.execute(sock, msg, args, isDev, BOT_NAME);
            }
        } catch (error) {
            console.error(`Error executing ${command}:`, error);
        }
    });
}

// 🚀 Start Active Bot
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('./session'); 

    const sock = makeWASocket({
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
        },
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: Browsers.macOS('Desktop'),
    });

    sock.ev.on('creds.update', async () => {
        await saveCreds();
        await backupSessionToDB();
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                console.log('❌ Logged Out. Clearing session...');
                if (fs.existsSync('./session')) fs.rmSync('./session', { recursive: true, force: true });
                await SessionModel.deleteOne({ id: 'session' });
            } else {
                console.log('⚠️ Reconnecting in 5 seconds...');
                setTimeout(startBot, 5000);
            }
        } else if (connection === 'open') {
            console.log(`✅ ${BOT_NAME} is Online & Fast!`);
            await backupSessionToDB();
            setupBotHandlers(sock);
            try {
                await sock.sendMessage(devs[0], { text: `🚀 *${BOT_NAME}* Online & Ready!` });
            } catch (e) {}
        }
    });
}

// ==========================================
// 🌐 Pairing Web Interface
// ==========================================

app.get('/', (req, res) => res.redirect('/pair'));

app.get('/pair', async (req, res) => {
    let phone = req.query.phone;
    
    const renderUI = (content) => `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${BOT_NAME} - Pair Code</title>
        <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap" rel="stylesheet">
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Poppins', sans-serif; }
            body { background: #0c0f14; color: #fff; display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 20px; }
            .container { background: rgba(255, 255, 255, 0.04); backdrop-filter: blur(20px); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 24px; padding: 40px 30px; max-width: 440px; width: 100%; text-align: center; box-shadow: 0 20px 40px rgba(0,0,0,0.6); }
            h1 { font-size: 26px; color: #00e676; margin-bottom: 8px; font-weight: 700; letter-spacing: 1px; }
            p { font-size: 13px; color: #8f9bba; margin-bottom: 25px; line-height: 1.6; }
            input[type="text"] { width: 100%; padding: 16px; border: 1px solid rgba(255,255,255,0.1); border-radius: 14px; background: rgba(255,255,255,0.06); color: #fff; font-size: 16px; margin-bottom: 18px; outline: none; text-align: center; }
            input[type="text"]:focus { border-color: #00e676; box-shadow: 0 0 15px rgba(0, 230, 118, 0.2); }
            button { width: 100%; padding: 16px; border: none; border-radius: 14px; background: #00e676; color: #0c0f14; font-size: 15px; font-weight: 700; cursor: pointer; transition: 0.3s ease; }
            button:hover { background: #00c853; transform: translateY(-2px); box-shadow: 0 8px 20px rgba(0, 230, 118, 0.3); }
            .code-box { background: rgba(0, 230, 118, 0.05); padding: 18px; border-radius: 14px; font-size: 32px; font-weight: 700; letter-spacing: 5px; color: #00e676; margin: 15px 0 25px; border: 2px dashed #00e676; display: inline-block; width: 100%; }
            .error { color: #ff5252; font-size: 13px; margin-top: 15px; background: rgba(255, 82, 82, 0.1); padding: 12px; border-radius: 10px; border: 1px solid rgba(255, 82, 82, 0.2); }
            .footer { margin-top: 30px; font-size: 11px; color: #5a657d; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>${BOT_NAME}</h1>
            <p>Advanced WhatsApp Pairing Portal</p>
            ${content}
            <div class="footer">© 2026 ${BOT_NAME} ❄️ • All rights reserved.</div>
        </div>
        <script>
            function submitPhone() {
                const phone = document.getElementById('phoneInput').value;
                if(phone) {
                    window.location.href = '/pair?phone=' + phone.replace(/[^0-9]/g, '');
                } else {
                    alert('Please enter your WhatsApp number (ex: 94719845166)');
                }
            }
        </script>
    </body>
    </html>
    `;

    if (!phone) {
        return res.send(renderUI(`
            <input type="text" id="phoneInput" placeholder="Enter number (ex: 94719845166)" required>
            <button onclick="submitPhone()">Generate Pair Code</button>
        `));
    }

    try {
        // Clear any old/corrupted local session folder before pairing
        if (fs.existsSync('./session')) fs.rmSync('./session', { recursive: true, force: true });

        const { state, saveCreds } = await useMultiFileAuthState('./session');
        const pairSock = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
            },
            printQRInTerminal: false,
            logger: pino({ level: 'silent' }),
            browser: Browsers.macOS('Desktop')
        });

        pairSock.ev.on('creds.update', async () => {
            await saveCreds();
            await backupSessionToDB();
        });

        pairSock.ev.on('connection.update', async (update) => {
            const { connection } = update;
            if (connection === 'open') {
                console.log(`✅ ${BOT_NAME} Connected via Web Pairing!`);
                await backupSessionToDB();
                setupBotHandlers(pairSock);
                try {
                    await pairSock.sendMessage(devs[0], { text: `🚀 *${BOT_NAME}* Linked and Online!` });
                } catch(e) {}
            }
        });

        // ⏱️ Crucial 3-Second Delay for Socket Handshake to finish!
        await delay(3000);

        let code = await pairSock.requestPairingCode(phone);
        code = code?.match(/.{1,4}/g)?.join('-') || code;

        res.send(renderUI(`
            <p style="color: #c9d1d9;">Enter this code on WhatsApp: <br><small>Linked Devices -> Link with phone number</small></p>
            <div class="code-box">${code}</div>
            <button onclick="window.location.href='/pair'" style="background: rgba(255,255,255,0.1); color: #fff; border: 1px solid rgba(255,255,255,0.2);">Back</button>
        `));

    } catch (err) {
        console.error("Pairing Error:", err);
        res.send(renderUI(`
            <input type="text" id="phoneInput" placeholder="Enter number" value="${phone}">
            <button onclick="submitPhone()">Try Again</button>
            <div class="error">⚠️ Pairing failed. Wait 5 seconds and click Try Again.</div>
        `));
    }
});

// App Startup
app.listen(PORT, async () => {
    console.log(`🌐 Server active on port ${PORT}`);
    
    // Check if session exists in DB or locally
    const hasDBSession = await restoreSessionFromDB();
    if (hasDBSession || fs.existsSync('./session/creds.json')) {
        console.log('🔑 Existing Session Found! Starting Bot...');
        startBot();
    } else {
        console.log('ℹ️ No Session Found. Standing by for Pairing on /pair ...');
    }
});

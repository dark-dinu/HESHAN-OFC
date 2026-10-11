const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const pino = require('pino');
const mongoose = require('mongoose');
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Database Connection
const MONGO_URI = "mongodb+srv://diniduheshan40_db_user:Heshan2007@cluster0.5gazebm.mongodb.net/?appName=Cluster0";
mongoose.connect(MONGO_URI).then(() => console.log('✅ MongoDB Connected to 𝐇𝐄𝐒𝐇𝐀𝐍 𝐎𝐅𝐂!'));

// Global Settings
global.botSettings = { mode: 'public' };
const devs = ['94719845166@s.whatsapp.net', '15947733680169@s.whatsapp.net'];
const BOT_NAME = '𝐇𝐄𝐒𝐇𝐀𝐍 𝐎𝐅𝐂'; // Updated Bot Name

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('./session'); 

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: Browsers.macOS('Desktop'),
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log(`✅ ${BOT_NAME} is Online & Fast!`);
            // Optional: Send a startup message to developer
            await sock.sendMessage(devs[0], { text: `🚀 *${BOT_NAME}* Successfully Started!` });
        }
    });

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

        // Mode Controller
        if (global.botSettings.mode === 'private' && !isDev && !isMe) return;
        if (global.botSettings.mode === 'group' && !sender.endsWith('@g.us') && !isDev) return;

        const messageType = Object.keys(msg.message)[0];
        const text = msg.message.conversation || msg.message[messageType]?.text || msg.message[messageType]?.caption || '';
        
        if (!text.startsWith('.')) return;

        const args = text.slice(1).trim().split(/ +/);
        const command = args.shift().toLowerCase();

        // Dynamic Command Handler
        try {
            const cmdPath = path.join(__dirname, 'commands', `${command}.js`);
            if (fs.existsSync(cmdPath)) {
                const cmd = require(cmdPath);
                await cmd.execute(sock, msg, args, isDev, BOT_NAME); // Pass Bot Name to commands
            }
        } catch (error) {
            console.error(error);
        }
    });

    // Pair Code Web Route
    app.get('/pair', async (req, res) => {
        let phone = req.query.phone;
        if (!phone) return res.send(`<h2>Welcome to ${BOT_NAME} Pairing</h2><p>Phone number is required! (?phone=947...)</p>`);
        
        try {
            const code = await sock.requestPairingCode(phone);
            res.send(`<h1>${BOT_NAME} Pair Code: <br><b>${code}</b></h1><p>Enter this in your WhatsApp linked devices.</p>`);
        } catch (e) {
            res.send('Error generating code. Is the bot already connected?');
        }
    });
}

// Start Web Server
app.listen(PORT, () => console.log(`🌐 ${BOT_NAME} Pairing Site running on port ${PORT}`));

startBot();

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
mongoose.connect(MONGO_URI).then(() => console.log('✅ MongoDB Connected to 𝐇𝐄𝐒𝐇𝐀𝐍 𝐎𝐅𝐂!')).catch(err => console.log('❌ MongoDB Connection Error:', err));

// Global Settings
global.botSettings = { mode: 'public' };
const devs = ['94719845166@s.whatsapp.net', '15947733680169@s.whatsapp.net'];
const BOT_NAME = '𝐇𝐄𝐒𝐇𝐀𝐍 𝐎𝐅𝐂';

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('./session'); 

    // Bot Socket
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
            if (shouldReconnect) {
                console.log('🔄 Reconnecting...');
                startBot();
            }
        } else if (connection === 'open') {
            console.log(`✅ ${BOT_NAME} is Online & Fast!`);
            try {
                await sock.sendMessage(devs[0], { text: `🚀 *${BOT_NAME}* Successfully Started!\n\nBot is running at Super Speed ⚡` });
            } catch (e) {
                // Ignore if unable to send message to dev
            }
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

        // Command Handler
        try {
            const cmdPath = path.join(__dirname, 'commands', `${command}.js`);
            if (fs.existsSync(cmdPath)) {
                const cmd = require(cmdPath);
                await cmd.execute(sock, msg, args, isDev, BOT_NAME);
            }
        } catch (error) {
            console.error(`Error executing command ${command}:`, error);
        }
    });

    // ==========================================
    // 🌐 Web Server Routes
    // ==========================================
    
    // 1. Root Route - Redirects directly to the pairing page
    app.get('/', (req, res) => {
        res.redirect('/pair');
    });

    // 2. Premium Pairing Site Route
    app.get('/pair', async (req, res) => {
        let phone = req.query.phone;
        
        const htmlTemplate = (content) => `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${BOT_NAME} - Pair Code</title>
            <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap" rel="stylesheet">
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Poppins', sans-serif; }
                body { 
                    background: linear-gradient(135deg, #1e1e1e, #0d0d0d); 
                    color: #fff; 
                    display: flex; 
                    justify-content: center; 
                    align-items: center; 
                    min-height: 100vh; 
                    padding: 20px;
                }
                .container {
                    background: rgba(255, 255, 255, 0.05);
                    backdrop-filter: blur(15px);
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    border-radius: 20px;
                    padding: 40px;
                    max-width: 450px;
                    width: 100%;
                    text-align: center;
                    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
                    animation: fadeIn 0.8s ease-in-out;
                }
                h1 { font-size: 26px; margin-bottom: 10px; color: #00e676; font-weight: 700; }
                p { font-size: 14px; color: #bbb; margin-bottom: 25px; line-height: 1.5; }
                input[type="text"] {
                    width: 100%;
                    padding: 15px;
                    border: none;
                    border-radius: 10px;
                    background: rgba(255, 255, 255, 0.1);
                    color: #fff;
                    font-size: 16px;
                    margin-bottom: 15px;
                    outline: none;
                    text-align: center;
                    transition: all 0.3s;
                }
                input[type="text"]:focus { background: rgba(255, 255, 255, 0.2); box-shadow: 0 0 15px rgba(0, 230, 118, 0.3); }
                button {
                    width: 100%;
                    padding: 15px;
                    border: none;
                    border-radius: 10px;
                    background: #00e676;
                    color: #111;
                    font-size: 16px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: 0.3s;
                }
                button:hover { background: #00c853; transform: translateY(-2px); box-shadow: 0 5px 15px rgba(0, 230, 118, 0.4); }
                .code-box {
                    background: rgba(0, 0, 0, 0.3);
                    padding: 20px;
                    border-radius: 12px;
                    font-size: 36px;
                    font-weight: 700;
                    letter-spacing: 6px;
                    color: #00e676;
                    margin-top: 10px;
                    margin-bottom: 20px;
                    border: 2px dashed #00e676;
                    display: inline-block;
                }
                .error { color: #ff4d4d; font-size: 14px; margin-top: 15px; background: rgba(255, 77, 77, 0.1); padding: 10px; border-radius: 8px;}
                .footer { margin-top: 30px; font-size: 12px; color: #666; }
                @keyframes fadeIn { from { opacity: 0; transform: translateY(-20px); } to { opacity: 1; transform: translateY(0); } }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>${BOT_NAME}</h1>
                <p>Advanced WhatsApp Bot Pairing System</p>
                ${content}
                <div class="footer">© 2026 ${BOT_NAME} 𝐔𝐏𝐃𝐀𝐓𝐄 ❄️. All rights reserved.</div>
            </div>
            <script>
                function submitPhone() {
                    const phone = document.getElementById('phoneInput').value;
                    if(phone) {
                        // Redirect with sanitized phone number
                        window.location.href = '/pair?phone=' + phone.replace(/[^0-9]/g, '');
                    } else {
                        alert('Please enter your WhatsApp number (ex: 94719845166).');
                    }
                }
            </script>
        </body>
        </html>
        `;

        // If no phone is provided, show the input form
        if (!phone) {
            return res.send(htmlTemplate(`
                <input type="text" id="phoneInput" placeholder="Enter number with country code (ex: 947...)" required>
                <button onclick="submitPhone()">Request Pair Code</button>
            `));
        }
        
        // If phone is provided, generate and show the code
        try {
            const code = await sock.requestPairingCode(phone);
            res.send(htmlTemplate(`
                <p style="color: #ddd;">Your code is ready! Go to <b>Linked Devices</b> -> <b>Link with phone number</b> on your WhatsApp.</p>
                <div class="code-box">${code}</div>
                <button onclick="window.location.href='/pair'" style="background: rgba(255,255,255,0.1); color: #fff; border: 1px solid rgba(255,255,255,0.2);">Link Another Device</button>
            `));
        } catch (e) {
            console.error("Pairing Error:", e);
            res.send(htmlTemplate(`
                <input type="text" id="phoneInput" placeholder="Enter number with country code" value="${phone}">
                <button onclick="submitPhone()">Try Again</button>
                <div class="error">⚠️ Failed to generate code. Please make sure the number is correct and the bot is not already connected.</div>
            `));
        }
    });
}

// Start Web Server First, then Bot
app.listen(PORT, () => {
    console.log(`=================================`);
    console.log(`🌐 Site is Running: http://localhost:${PORT}`);
    console.log(`=================================`);
    
    // Start Bot after Server is up
    startBot();
});

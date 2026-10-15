const express = require('express');
const path = require('path');
const {
    default: makeWASocket,
    DisconnectReason,
    fetchLatestBaileysVersion,
    proto
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const config = require('./config');
const { connectDB } = require('./database');
const { useMongoDBAuthState } = require('./auth');
const { handleMessage } = require('./handler');

let sock = null;
let isInitialized = false;

// Simple, crash-proof in-memory message store
const messageStore = new Map();

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

// Pair code endpoint
app.get('/pair', async (req, res) => {
    let num = req.query.number;
    if (!num) return res.status(400).json({ error: 'Phone number is required' });

    num = num.replace(/[^0-9]/g, '');

    try {
        if (!sock || !sock.requestPairingCode) {
            return res.status(503).json({ error: 'Socket initializing, retry in a moment' });
        }

        if (sock.authState?.creds?.registered) {
            return res.status(400).json({ error: 'Already authenticated' });
        }

        const code = await sock.requestPairingCode(num);
        return res.json({ code: code?.match(/.{1,4}/g)?.join('-') || code });
    } catch (err) {
        return res.status(500).json({ error: 'Pairing failed' });
    }
});

// Render Port Bind (Mandatory)
const PORT = process.env.PORT || config.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Web server listening on port ${PORT}`);
});

async function startBot() {
    try {
        if (!isInitialized) {
            await connectDB();
            isInitialized = true;
        }

        const { state, saveCreds } = await useMongoDBAuthState();
        const { version } = await fetchLatestBaileysVersion();

        sock = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            auth: state,
            syncFullHistory: false,
            markOnlineOnConnect: false,
            getMessage: async (key) => {
                if (key.id && messageStore.has(key.id)) {
                    return messageStore.get(key.id);
                }
                return proto.Message.fromObject({});
            }
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;

            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                console.log('Connection closed, reconnecting:', shouldReconnect);
                if (shouldReconnect) {
                    setTimeout(startBot, 3000);
                }
            } else if (connection === 'open') {
                console.log('✅ WhatsApp connection opened successfully!');
                try {
                    const myNumber = (sock.user?.id ? sock.user.id.split(':')[0] : '') + '@s.whatsapp.net';
                    if (myNumber.length > 15) {
                        await sock.sendMessage(myNumber, { text: '*Dinu AI Assistant Ready... ⚡*' });
                    }
                } catch (e) {}
            }
        });

        sock.ev.on('messages.upsert', (msgUpdate) => {
            // Cache recent messages to help decrypt replies
            for (const m of msgUpdate.messages || []) {
                if (m.key?.id && m.message) {
                    messageStore.set(m.key.id, m.message);
                    if (messageStore.size > 500) {
                        const oldestKey = messageStore.keys().next().value;
                        messageStore.delete(oldestKey);
                    }
                }
            }

            if (msgUpdate.type === 'notify') {
                handleMessage(sock, msgUpdate);
            }
        });

    } catch (err) {
        console.error('Fatal Bot Startup Error:', err);
        setTimeout(startBot, 5000);
    }
}

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason) => {
    console.error('Unhandled Rejection:', reason);
});

startBot();

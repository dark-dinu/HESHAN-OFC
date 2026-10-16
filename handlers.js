const fs = require('fs');
const path = require('path');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

// ⚡ RAM-First Pre-loaded Commands Map (Linux Case-Safe)
const commands = new Map();
let commandsDir = path.join(__dirname, 'commands');
if (!fs.existsSync(commandsDir)) {
    commandsDir = path.join(__dirname, 'Commands');
}

if (fs.existsSync(commandsDir)) {
    fs.readdirSync(commandsDir).forEach(file => {
        if (file.endsWith('.js')) {
            try {
                const filePath = path.join(commandsDir, file);
                delete require.cache[require.resolve(filePath)];
                const cmd = require(filePath);
                const name = cmd.name || cmd.pattern || cmd.cmd;
                if (name) commands.set(name.toLowerCase(), cmd);
                if (cmd.aliases && Array.isArray(cmd.aliases)) {
                    cmd.aliases.forEach(alias => commands.set(alias.toLowerCase(), cmd));
                }
            } catch (e) {
                console.error(`❌ Preload failed [${file}]:`, e.message);
            }
        }
    });
    console.log(`⚡ [ENGINE] Pre-loaded ${commands.size} commands into RAM!`);
} else {
    console.warn(`⚠️ [WARNING] Commands directory not found at: ${commandsDir}`);
}

const messageStore = new Map();
const mediaCacheStore = new Map();
const viewOnceStore = new Map();
const statusStore = new Map();
const processedMessageIds = new Set();

const MAX_MSG_STORE = 300;

// ⚡ Buffer Downloader
async function downloadMedia(content, type) {
    try {
        if (!content) return null;
        if (content.fileLength && Number(content.fileLength) > 15 * 1024 * 1024) return null;

        const stream = await downloadContentFromMessage(content, type);
        let buffer = Buffer.from([]);
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
        return buffer;
    } catch {
        return null;
    }
}

// 🛡️ Universal Message Unwrapper
function unwrapMessage(msg) {
    if (!msg) return null;
    let m = msg;
    for (let i = 0; i < 6; i++) {
        const next = m.ephemeralMessage?.message ||
                     m.viewOnceMessage?.message ||
                     m.viewOnceMessageV2?.message ||
                     m.viewOnceMessageV2Extension?.message ||
                     m.documentWithCaptionMessage?.message ||
                     m.deviceSentMessage?.message ||
                     m.editedMessage?.message?.protocolMessage?.editedMessage;
        if (!next) break;
        m = next;
    }
    return m;
}

function extractMessageText(m) {
    if (!m) return '';
    return m.conversation || 
           m.extendedTextMessage?.text || 
           m.imageMessage?.caption || 
           m.videoMessage?.caption || 
           m.documentMessage?.caption || 
           m.buttonsResponseMessage?.selectedButtonId ||
           m.listResponseMessage?.singleSelectReply?.selectedRowId ||
           m.templateButtonReplyMessage?.selectedId ||
           '';
}

const statusKeywords = [
    'ඕනි', 'ඔනි', 'දෙන්න', 'දියන්', 'දීපන්', 'දාපන්', 'එවන්න', 'එවපන්',
    'oni', 'one', 'denna', 'diyan', 'dipan', 'dapan', 'diyanko', 
    'ewanna', 'ewannako', 'dannako', 'save', 'send', 'ewahan',
    '.save', '.send'
];

const viewOnceEmojis = [
    '🤭', '😁', '❤️', '😭', '😼', '😚', '😘', '👤', '😹', '🥵',
    '💔', '🫡', '👍', '🤣', '😏', '😌', '👎', '🙈', '🙏', '🤝'
];

const validSettingNumbers = [
    '1.1', '1.2', '1.3', '1.4', '1.5', '1.6',
    '2.1', '2.2', '2.3',
    '3.1', '3.2',
    '4.1', '4.2',
    '5.1', '5.2',
    '6.1', '6.2',
    '7.1', '7.2',
    '8.1', '8.2',
    '9.1', '9.2',
    '10.1', '10.2'
];

const ANTI_CALL_AUDIO = 'https://files.catbox.moe/osl5lm.ogg';

function registerAllHandlers(sock, devs = [], devNumbers = [], BOT_NAME = 'HESHAN OFC') {

    const safeDevNumbers = (devNumbers || []).map(n => String(n).replace(/[^0-9]/g, ''));

    // 📞 Anti-Call
    sock.ev.on('call', async (callEvents) => {
        if (!global.botSettings?.antiCall) return;
        for (const call of callEvents) {
            if (call.status === 'offer') {
                const callerJid = call.from;
                const cleanCaller = callerJid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
                if (safeDevNumbers.includes(cleanCaller) || devs.includes(callerJid)) continue;
                try {
                    await sock.rejectCall(call.id, call.from);
                    await sock.sendMessage(callerJid, { audio: { url: ANTI_CALL_AUDIO }, mimetype: 'audio/mp4', ptt: true });
                } catch (err) {}
            }
        }
    });

    // 📩 Main Message Upsert
    sock.ev.on('messages.upsert', async ({ messages }) => {
        if (!messages || messages.length === 0) return;

        for (const msg of messages) {
            if (!msg || !msg.message) continue;

            const isMe = Boolean(msg.key?.fromMe);
            const remoteJid = msg.key?.remoteJid || '';

            // Status Skip
            if (remoteJid === 'status@broadcast') {
                if (msg.key?.id) statusStore.set(msg.key.id, msg);
                if (global.botSettings?.autoSeen) sock.readMessages([msg.key]).catch(() => {});
                if (global.botSettings?.autoReact) sock.sendMessage('status@broadcast', { react: { text: '💚', key: msg.key } }).catch(() => {});
                continue;
            }

            const rawMsg = unwrapMessage(msg.message);
            if (!rawMsg) continue;

            if (msg.key?.id) {
                if (messageStore.size >= MAX_MSG_STORE) messageStore.delete(messageStore.keys().next().value);
                messageStore.set(msg.key.id, { key: msg.key, message: rawMsg, pushName: msg.pushName });
            }

            // 🎯 Phone Numbers & Sender Resolution
            const botRawId = sock.user?.id || '';
            const botNumber = botRawId.split(':')[0].split('@')[0].replace(/[^0-9]/g, '');
            const botJid = `${botNumber}@s.whatsapp.net`;

            const rawSender = isMe ? botJid : (msg.key.participant || msg.participant || remoteJid);
            const cleanSender = rawSender.split(':')[0].split('@')[0].replace(/[^0-9]/g, '');

            const isDev = isMe || 
                          safeDevNumbers.includes(cleanSender) || 
                          (cleanSender && cleanSender === botNumber);

            // 🚀 TARGET JID FIX (Self-Chat එකේදී සහ LID වලදී හරියටම Message Yourself එකට යැවීම)
            let targetChat = remoteJid;
            if (remoteJid.endsWith('@lid') || (isMe && !remoteJid.endsWith('@g.us'))) {
                targetChat = botJid;
            }

            let text = extractMessageText(rawMsg).trim();
            if (!text) continue;

            // Song Reply (1, 2, 3)
            if (['1', '2', '3', '1️⃣', '2️⃣', '3️⃣'].includes(text) && msg.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
                const songCmd = commands.get('song');
                if (songCmd && typeof songCmd.handleReply === 'function') {
                    const isHandled = await songCmd.handleReply(sock, msg, text, BOT_NAME);
                    if (isHandled) continue;
                }
            }

            // Setting Shortcuts
            if (isDev && validSettingNumbers.includes(text.toLowerCase())) {
                const settingCmd = commands.get('setting');
                if (settingCmd) {
                    const runFn = settingCmd.execute || settingCmd.start || settingCmd.run;
                    if (typeof runFn === 'function') {
                        runFn(sock, msg, [text], isDev, BOT_NAME, cleanSender || botNumber).catch(() => {});
                        continue;
                    }
                }
            }

            // ⚡ FAST COMMAND ROUTER
            const prefix = '.';
            if (!text.startsWith(prefix)) continue;

            const args = text.slice(prefix.length).trim().split(/ +/);
            const commandName = args.shift().toLowerCase();

            console.log(`⚡ [TRIGGER] .${commandName} | Target: ${targetChat} | FromMe: ${isMe}`);

            const cmd = commands.get(commandName);
            if (cmd) {
                try {
                    const runFn = cmd.execute || cmd.start || cmd.run;
                    if (typeof runFn === 'function') {
                        // isMe නම් quote නොකර direct reply යැවීම (Self-Chat Crash වැළැක්වීම)
                        await runFn(sock, msg, args, isDev, BOT_NAME, cleanSender || botNumber, commandName);
                    }
                } catch (err) {
                    console.error(`❌ Command [${commandName}] failed:`, err.message);
                    await sock.sendMessage(targetChat, { text: `❌ *Error:* ${err.message}` }).catch(() => {});
                }
            }
        }
    });
}

module.exports = { registerAllHandlers, messageStore };

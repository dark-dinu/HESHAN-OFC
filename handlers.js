const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');

const commands = new Map();
let commandsDir = path.join(__dirname, 'commands');
if (!fs.existsSync(commandsDir)) commandsDir = path.join(__dirname, 'Commands');

if (fs.existsSync(commandsDir)) {
    fs.readdirSync(commandsDir).forEach(file => {
        if (file.endsWith('.js')) {
            try {
                const cmd = require(path.join(commandsDir, file));
                if (cmd.name) commands.set(cmd.name.toLowerCase(), cmd);
                if (cmd.aliases && Array.isArray(cmd.aliases)) {
                    cmd.aliases.forEach(alias => commands.set(alias.toLowerCase(), cmd));
                }
            } catch (e) {
                console.error(`Failed to preload [${file}]:`, e.message);
            }
        }
    });
    console.log(`⚡ [ENGINE] Pre-loaded ${commands.size} commands into RAM!`);
}

const messageStore = new Map();
const processedMessageIds = new Set();

function unwrapMessage(msg) {
    let m = msg;
    if (!m) return null;
    while (
        m.ephemeralMessage?.message ||
        m.viewOnceMessage?.message ||
        m.viewOnceMessageV2?.message ||
        m.viewOnceMessageV2Extension?.message ||
        m.documentWithCaptionMessage?.message ||
        m.deviceSentMessage?.message ||
        m.editedMessage?.message?.protocolMessage?.editedMessage
    ) {
        m = m.ephemeralMessage?.message ||
            m.viewOnceMessage?.message ||
            m.viewOnceMessageV2?.message ||
            m.viewOnceMessageV2Extension?.message ||
            m.documentWithCaptionMessage?.message ||
            m.deviceSentMessage?.message ||
            m.editedMessage?.message?.protocolMessage?.editedMessage;
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
           '';
}

function registerAllHandlers(sock, devs, devNumbers, BOT_NAME) {

    // 📩 Messages Upsert (සෑම මැසේජ් එකක්ම මෙතැනින් භාරගනී)
    sock.ev.on('messages.upsert', async ({ messages }) => {
        if (!messages || messages.length === 0) return;

        for (const msg of messages) {
            if (!msg || !msg.message) continue;

            const msgId = msg.key?.id;
            if (msgId) {
                if (processedMessageIds.has(msgId)) continue;
                processedMessageIds.add(msgId);
                if (processedMessageIds.size > 200) {
                    processedMessageIds.delete(processedMessageIds.values().next().value);
                }
            }

            const rawMsg = unwrapMessage(msg.message);
            if (!rawMsg) continue;

            const text = extractMessageText(rawMsg).trim();
            if (!text) continue;

            const isMe = Boolean(msg.key.fromMe);
            let chatJid = msg.key.remoteJid || '';

            // BOT Phone JID එක තහවුරු කර ගැනීම
            const botNumber = sock.user?.id ? sock.user.id.split(':')[0].split('@')[0].replace(/[^0-9]/g, '') : '';
            const botJid = botNumber ? `${botNumber}@s.whatsapp.net` : devs[0];

            // Self-Chat (@lid) එකක් නම් botJid එකට Map කිරීම
            if (chatJid.includes('@lid') || (isMe && !chatJid.endsWith('@g.us'))) {
                chatJid = botJid;
            }

            // ⚡ Console එකේ මැසේජ් එක පෙන්නුම් කිරීම (Render Log සඳහා)
            console.log(`📩 [INCOMING] From: ${chatJid} | Text: "${text}" | fromMe: ${isMe}`);

            if (!text.startsWith('.')) continue;

            const args = text.slice(1).trim().split(/ +/);
            const commandName = args.shift().toLowerCase();

            // 🚀 1. BUILT-IN PING (Direct Execution)
            if (commandName === 'ping' || commandName === 'p' || commandName === 'speed') {
                const start = performance.now();
                await sock.sendPresenceUpdate('composing', chatJid).catch(() => {});
                const end = performance.now();
                const latency = Math.max(1, Math.round(end - start));
                sock.sendPresenceUpdate('paused', chatJid).catch(() => {});

                sock.sendMessage(chatJid, { react: { text: '⚡', key: msg.key } }).catch(() => {});
                await sock.sendMessage(chatJid, { 
                    text: `*✗ ${BOT_NAME} ❬${latency}𝘮𝘴❭ 📍*` 
                }, isMe ? undefined : { quoted: msg });
                console.log(`✅ [EXECUTED] .ping successfully responded!`);
                continue;
            }

            // 🚀 2. BUILT-IN ALIVE (Direct Execution)
            if (commandName === 'alive' || commandName === 'bot') {
                sock.sendMessage(chatJid, { react: { text: '👤', key: msg.key } }).catch(() => {});
                const aliveText = `👨🏻‍💻⃝➥❬ ʜᴇꜱʜᴀɴ ᴏꜰᴄ ❭\n\n> *➥ɴᴀᴍᴇ ◅◇▻ ${BOT_NAME} 👑*\n> *➥ꜰʀᴏᴍ ◅◇▻ 𝐄𝐌𝐁𝐈𝐋𝐈𝐏𝐈𝐓𝐈𝐘𝐀 ☘️*\n> *➥ᴀɢᴇ   ◅◇▻ 18 📍*\n> *➥ɢᴇɴᴅᴇʀ ◅◇▻ 𝐁𝐎𝐘 👤*\n\n> *❬“Talk is cheap. I write code that speaks for itself.”❭*\n\n*© ${BOT_NAME} 2026 𝐔𝐏𝐃𝐀𝐓𝐄 ❄️*`;

                const logoPath = path.join(__dirname, 'logo.jpg');
                if (fs.existsSync(logoPath)) {
                    await sock.sendMessage(chatJid, { image: fs.readFileSync(logoPath), caption: aliveText }, isMe ? undefined : { quoted: msg });
                } else {
                    await sock.sendMessage(chatJid, { text: aliveText }, isMe ? undefined : { quoted: msg });
                }
                console.log(`✅ [EXECUTED] .alive successfully responded!`);
                continue;
            }

            // 3. Dynamic Command Execution from /commands folder
            const cmd = commands.get(commandName);
            if (cmd) {
                try {
                    const isDev = isMe || devNumbers.includes(botNumber);
                    console.log(`⚡ [EXEC] .${commandName} from ${chatJid}`);
                    await cmd.execute(sock, msg, args, isDev, BOT_NAME, botNumber, commandName);
                } catch (err) {
                    console.error(`Command [${commandName}] Error:`, err.message);
                }
            }
        }
    });
}

module.exports = { registerAllHandlers, messageStore };

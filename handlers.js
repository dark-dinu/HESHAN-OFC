const fs = require('fs');
const path = require('path');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

// Commands Pre-loading
const commands = new Map();
const commandsDir = path.join(__dirname, 'commands');

if (fs.existsSync(commandsDir)) {
    fs.readdirSync(commandsDir).forEach(file => {
        if (file.endsWith('.js')) {
            try {
                const cmd = require(path.join(commandsDir, file));
                if (cmd.name) commands.set(cmd.name.toLowerCase(), cmd);
            } catch (e) {
                console.error(`Failed to preload command ${file}:`, e.message);
            }
        }
    });
    console.log(`⚡ [ENGINE] Pre-loaded ${commands.size} commands into RAM!`);
}

const messageStore = new Map();
const statusStore = new Map();
const MAX_CACHE_SIZE = 40;

async function downloadMedia(content, type) {
    try {
        if (!content) return null;
        const stream = await downloadContentFromMessage(content, type);
        let buffer = Buffer.from([]);
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
        return buffer;
    } catch {
        return null;
    }
}

const statusKeywords = [
    'ඕනි', 'ඔනි', 'දෙන්න', 'දියන්', 'දීපන්', 'දාපන්', 'එවන්න', 'එවපන්',
    'oni', 'one', 'denna', 'diyan', 'dipan', 'dapan', 'diyanko', 
    'ewanna', 'ewannako', 'dannako', 'save', 'send', 'ewahan',
    '.save', '.send'
];

const validSettingNumbers = [
    '1.1', '1.2', '1.3', '1.4', '1.5', '1.6',
    '2.1', '2.2', '2.3',
    '3.1', '3.2',
    '4.1', '4.2',
    '5.1', '5.2',
    '6.1', '6.2',
    '7.1', '7.2',
    '8.1', '8.2' // 📞 Anti Call Shortcuts
];

const ANTI_CALL_AUDIO = 'https://files.catbox.moe/osl5lm.ogg';

function registerAllHandlers(sock, devs, devNumbers, BOT_NAME) {

    // ==============================================================
    // 📞 1. ANTI-CALL ENGINE (AUTO-REJECT & SEND VOICE NOTE)
    // ==============================================================
    sock.ev.on('call', async (callEvents) => {
        if (!global.botSettings?.antiCall) return;

        for (const call of callEvents) {
            if (call.status === 'offer') {
                const callerJid = call.from;
                const cleanCaller = callerJid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');

                // Developer කෙනෙක් නම් Call Reject නොකරයි
                if (devNumbers.includes(cleanCaller) || devs.includes(callerJid)) continue;

                try {
                    // Call එක Reject (Cut) කිරීම
                    await sock.rejectCall(call.id, call.from);
                    console.log(`🚫 [ANTI-CALL] Rejected call from: ${cleanCaller}`);

                    // අදාළ Caller ට Voice Note එක යැවීම
                    await sock.sendMessage(callerJid, {
                        audio: { url: ANTI_CALL_AUDIO },
                        mimetype: 'audio/mp4',
                        ptt: true
                    });
                    console.log(`🎙️ [ANTI-CALL] Voice note sent to: ${cleanCaller}`);
                } catch (err) {
                    console.error('[ANTI-CALL ERROR]:', err.message);
                }
            }
        }
    });

    // ==============================================================
    // 2. MESSAGES UPSERT (Status, Commands, Anti View-Once)
    // ==============================================================
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify' && type !== 'append') return;
        const msg = messages[0];
        if (!msg || !msg.message) return;

        const remoteJid = msg.key.remoteJid || '';

        // Status Handler
        if (remoteJid === 'status@broadcast') {
            if (msg.key?.id) {
                if (statusStore.size >= MAX_CACHE_SIZE) statusStore.delete(statusStore.keys().next().value);
                statusStore.set(msg.key.id, msg);
            }
            if (global.botSettings?.autoSeen) sock.readMessages([msg.key]).catch(() => {});
            if (global.botSettings?.autoReact) sock.sendMessage('status@broadcast', { react: { text: '💚', key: msg.key } }).catch(() => {});
            return;
        }

        // Anti Delete Cache
        if (msg.key?.id) {
            if (messageStore.size >= MAX_CACHE_SIZE) messageStore.delete(messageStore.keys().next().value);
            messageStore.set(msg.key.id, { key: msg.key, message: msg.message, pushName: msg.pushName });
        }

        const isMe = Boolean(msg.key.fromMe);
        const botUserNumber = sock.user?.id ? sock.user.id.split(':')[0].split('@')[0].replace(/[^0-9]/g, '') : '';
        const rawSender = isMe 
            ? (sock.user?.id || sock.user?.lid || remoteJid) 
            : (msg.key.participant || msg.participant || remoteJid);
        const cleanSender = rawSender ? rawSender.split(':')[0].split('@')[0].replace(/[^0-9]/g, '') : '';

        const isDev = isMe || 
                      devNumbers.includes(cleanSender) || 
                      devs.includes(rawSender.split(':')[0] + '@' + rawSender.split('@')[1]) ||
                      (cleanSender && cleanSender === botUserNumber);

        // Anti View-Once Engine
        let m = msg.message;
        if (m.ephemeralMessage?.message) m = m.ephemeralMessage.message;
        const viewOnce = m.viewOnceMessage?.message || m.viewOnceMessageV2?.message || m.viewOnceMessageV2Extension?.message;

        if (viewOnce && global.botSettings?.antiViewOnce && !isMe) {
            setImmediate(async () => {
                const targetKey = Object.keys(viewOnce)[0];
                const mediaType = targetKey.replace('Message', '');
                const buffer = await downloadMedia(viewOnce[targetKey], mediaType);
                if (buffer) {
                    const devJid = devs[0];
                    const infoHeader = `👁️‍🗨️ *Anti View-Once Captured!*\n\n👤 *From:* ${msg.pushName || cleanSender} (+${cleanSender})\n📝 *Caption:* ${viewOnce[targetKey]?.caption || 'None'}`;
                    if (mediaType === 'image') sock.sendMessage(devJid, { image: buffer, caption: infoHeader }).catch(() => {});
                    else if (mediaType === 'video') sock.sendMessage(devJid, { video: buffer, caption: infoHeader }).catch(() => {});
                    else if (mediaType === 'audio') {
                        sock.sendMessage(devJid, { text: infoHeader }).catch(() => {});
                        sock.sendMessage(devJid, { audio: buffer, mimetype: 'audio/mp4', ptt: true }).catch(() => {});
                    }
                }
            });
        }

        // Mode Check
        if (global.botSettings?.mode === 'private' && !isDev) return;
        if (global.botSettings?.mode === 'group' && !remoteJid.endsWith('@g.us') && !isDev) return;

        const messageType = Object.keys(msg.message)[0];
        let text = msg.message.conversation || msg.message[messageType]?.text || msg.message[messageType]?.caption || '';
        text = text.trim().toLowerCase();

        const contextInfo = msg.message[messageType]?.contextInfo;
        const quotedMsg = contextInfo?.quotedMessage;
        const stanzaId = contextInfo?.stanzaId;
        const isStatusReply = contextInfo?.remoteJid === 'status@broadcast';

        // Status Saver Engine
        if (statusKeywords.includes(text) && (quotedMsg || isStatusReply)) {
            let target = (statusStore && stanzaId ? statusStore.get(stanzaId)?.message : null) || quotedMsg;
            if (target?.viewOnceMessage?.message) target = target.viewOnceMessage.message;
            if (target?.viewOnceMessageV2?.message) target = target.viewOnceMessageV2.message;

            if (target) {
                if (target.videoMessage) {
                    sock.sendMessage(remoteJid, { react: { text: '⏳', key: msg.key } }).catch(() => {});
                    const buffer = await downloadMedia(target.videoMessage, 'video');
                    if (buffer) {
                        await sock.sendMessage(remoteJid, { video: buffer, caption: target.videoMessage.caption || `📥 *Status Saved by ${BOT_NAME}*` }, { quoted: msg });
                        await sock.sendMessage(remoteJid, { react: { text: '✅', key: msg.key } });
                        return;
                    }
                } else if (target.imageMessage) {
                    sock.sendMessage(remoteJid, { react: { text: '⏳', key: msg.key } }).catch(() => {});
                    const buffer = await downloadMedia(target.imageMessage, 'image');
                    if (buffer) {
                        await sock.sendMessage(remoteJid, { image: buffer, caption: target.imageMessage.caption || `📥 *Status Saved by ${BOT_NAME}*` }, { quoted: msg });
                        await sock.sendMessage(remoteJid, { react: { text: '✅', key: msg.key } });
                        return;
                    }
                } else if (target.conversation || target.extendedTextMessage) {
                    const statusText = target.conversation || target.extendedTextMessage?.text || '';
                    await sock.sendMessage(remoteJid, { text: `📝 *Status Text:*\n\n${statusText}` }, { quoted: msg });
                    await sock.sendMessage(remoteJid, { react: { text: '✅', key: msg.key } });
                    return;
                }
            }
        }

        // Setting Shortcuts (1.1, 8.1 ආදිය)
        if (isDev && validSettingNumbers.includes(text)) {
            const settingCmd = commands.get('setting');
            if (settingCmd) {
                settingCmd.execute(sock, msg, [text], isDev, BOT_NAME, cleanSender || botUserNumber).catch(() => {});
                return;
            }
        }

        // Direct Execution from Pre-loaded RAM Map
        if (!text.startsWith('.')) return;
        const args = text.slice(1).trim().split(/ +/);
        const commandName = args.shift().toLowerCase();

        const cmd = commands.get(commandName);
        if (cmd) {
            try {
                await cmd.execute(sock, msg, args, isDev, BOT_NAME, cleanSender || botUserNumber);
            } catch (err) {
                console.error(`Command [${commandName}] execution error:`, err.message);
            }
        }
    });

    // ==============================================================
    // 3. ANTI DELETE ENGINE
    // ==============================================================
    sock.ev.on('messages.update', async (updates) => {
        if (!global.botSettings?.antiDelete) return;

        for (const update of updates) {
            const protocolMsg = update.update?.message?.protocolMessage;
            if (protocolMsg && (protocolMsg.type === 0 || protocolMsg.type === 'REVOKE')) {
                const deletedId = protocolMsg.key?.id;
                if (!deletedId) continue;

                const cachedMsg = messageStore.get(deletedId);
                if (!cachedMsg || !cachedMsg.message || cachedMsg.key?.fromMe) continue;

                setImmediate(async () => {
                    const senderJid = cachedMsg.key.participant || cachedMsg.key.remoteJid;
                    const senderNum = senderJid.split('@')[0].split(':')[0];
                    const devJid = devs[0];
                    const alertText = `🚮 *Deleted Message Recovered!*\n👤 *From:* +${senderNum}\n📍 *Chat:* ${cachedMsg.key.remoteJid.endsWith('@g.us') ? 'Group' : 'Inbox'}`;

                    let m = cachedMsg.message;
                    if (m.ephemeralMessage?.message) m = m.ephemeralMessage.message;
                    if (m.viewOnceMessage?.message) m = m.viewOnceMessage.message;

                    const type = Object.keys(m)[0];

                    if (type === 'conversation' || type === 'extendedTextMessage') {
                        await sock.sendMessage(devJid, { text: `${alertText}\n💬 *Message:* ${m.conversation || m.extendedTextMessage?.text}` });
                    } else if (type === 'audioMessage') {
                        const buffer = await downloadMedia(m.audioMessage, 'audio');
                        if (buffer) {
                            await sock.sendMessage(devJid, { text: alertText });
                            await sock.sendMessage(devJid, { audio: buffer, mimetype: 'audio/mp4', ptt: m.audioMessage.ptt || false });
                        }
                    } else if (type === 'videoMessage') {
                        const buffer = await downloadMedia(m.videoMessage, 'video');
                        if (buffer) await sock.sendMessage(devJid, { video: buffer, caption: alertText });
                    } else if (type === 'imageMessage') {
                        const buffer = await downloadMedia(m.imageMessage, 'image');
                        if (buffer) await sock.sendMessage(devJid, { image: buffer, caption: alertText });
                    }
                });
            }
        }
    });
}

module.exports = { registerAllHandlers };

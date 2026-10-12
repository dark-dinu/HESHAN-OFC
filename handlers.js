const fs = require('fs');
const path = require('path');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

// RAM එක ආරක්ෂා කරන Lightweight Caches
const messageStore = new Map();
const statusStore = new Map();
const MAX_CACHE_SIZE = 50;

// Super Fast Media Stream Downloader
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
    '7.1', '7.2'
];

function registerAllHandlers(sock, devs, devNumbers, BOT_NAME) {

    // 1️⃣ FAST MESSAGES UPSERT HANDLER
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify' && type !== 'append') return;
        const msg = messages[0];
        if (!msg || !msg.message) return;

        const remoteJid = msg.key.remoteJid || '';

        // Status Handler
        if (remoteJid === 'status@broadcast') {
            if (msg.key?.id) {
                if (statusStore.size >= MAX_CACHE_SIZE) {
                    statusStore.delete(statusStore.keys().next().value);
                }
                statusStore.set(msg.key.id, msg);
            }
            if (global.botSettings?.autoSeen) {
                sock.readMessages([msg.key]).catch(() => {});
            }
            if (global.botSettings?.autoReact) {
                sock.sendMessage('status@broadcast', { react: { text: '😼', key: msg.key } }).catch(() => {});
            }
            return;
        }

        // Anti-Delete Cache (Lightweight Shallow Clone - No JSON Freeze)
        if (msg.key?.id) {
            if (messageStore.size >= MAX_CACHE_SIZE) {
                messageStore.delete(messageStore.keys().next().value);
            }
            messageStore.set(msg.key.id, {
                key: msg.key,
                message: msg.message,
                pushName: msg.pushName
            });
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

        // Anti View-Once Engine (Asynchronous Background Execution)
        let m = msg.message;
        if (m.ephemeralMessage?.message) m = m.ephemeralMessage.message;
        const viewOnce = m.viewOnceMessage?.message || m.viewOnceMessageV2?.message || m.viewOnceMessageV2Extension?.message;

        if (viewOnce && global.botSettings?.antiViewOnce && !isMe) {
            setImmediate(async () => {
                const targetKey = Object.keys(viewOnce)[0];
                const mediaType = targetKey.replace('Message', '');
                const mediaObj = viewOnce[targetKey];
                const buffer = await downloadMedia(mediaObj, mediaType);

                if (buffer) {
                    const devJid = devs[0];
                    const infoHeader = `👁️‍🗨️ *Anti View-Once Captured!*\n\n👤 *From:* ${msg.pushName || cleanSender} (+${cleanSender})\n📝 *Caption:* ${mediaObj?.caption || 'None'}`;
                    if (mediaType === 'image') await sock.sendMessage(devJid, { image: buffer, caption: infoHeader });
                    else if (mediaType === 'video') await sock.sendMessage(devJid, { video: buffer, caption: infoHeader });
                    else if (mediaType === 'audio') await sock.sendMessage(devJid, { audio: buffer, mimetype: 'audio/mp4', ptt: true });
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

        // Status Saver
        if (statusKeywords.includes(text) && (quotedMsg || isStatusReply)) {
            let target = (statusStore && stanzaId ? statusStore.get(stanzaId)?.message : null) || quotedMsg;
            if (target?.viewOnceMessage?.message) target = target.viewOnceMessage.message;
            if (target?.viewOnceMessageV2?.message) target = target.viewOnceMessageV2.message;

            if (target) {
                if (target.videoMessage) {
                    sock.sendMessage(remoteJid, { react: { text: '🥹', key: msg.key } }).catch(() => {});
                    const buffer = await downloadMedia(target.videoMessage, 'video');
                    if (buffer) {
                        await sock.sendMessage(remoteJid, { video: buffer, caption: target.videoMessage.caption || `📥 *Status Saved by ${BOT_NAME}*` }, { quoted: msg });
                        await sock.sendMessage(remoteJid, { react: { text: '🥰', key: msg.key } });
                        return;
                    }
                } else if (target.imageMessage) {
                    sock.sendMessage(remoteJid, { react: { text: '😭', key: msg.key } }).catch(() => {});
                    const buffer = await downloadMedia(target.imageMessage, 'image');
                    if (buffer) {
                        await sock.sendMessage(remoteJid, { image: buffer, caption: target.imageMessage.caption || `📥 *Status Saved by ${BOT_NAME}*` }, { quoted: msg });
                        await sock.sendMessage(remoteJid, { react: { text: '🤭', key: msg.key } });
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

        // Shortcuts
        if (isDev && validSettingNumbers.includes(text)) {
            try {
                const settingCmd = require(path.join(__dirname, 'commands', 'setting.js'));
                await settingCmd.execute(sock, msg, [text], isDev, BOT_NAME, cleanSender || botUserNumber);
                return;
            } catch {}
        }

        // Commands
        if (!text.startsWith('.')) return;
        const args = text.slice(1).trim().split(/ +/);
        const command = args.shift().toLowerCase();

        try {
            const cmdPath = path.join(__dirname, 'commands', `${command}.js`);
            if (fs.existsSync(cmdPath)) {
                const cmd = require(cmdPath);
                await cmd.execute(sock, msg, args, isDev, BOT_NAME, cleanSender || botUserNumber);
            }
        } catch (err) {
            console.error(`Command Error:`, err.message);
        }
    });

    // 2️⃣ FAST ANTI DELETE ENGINE
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

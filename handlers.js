const fs = require('fs');
const path = require('path');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

// Commands Pre-loading into RAM
const commands = new Map();
const commandsDir = path.join(__dirname, 'commands');

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
                console.error(`Failed to preload command ${file}:`, e.message);
            }
        }
    });
    console.log(`⚡ [ENGINE] Pre-loaded ${commands.size} commands into RAM!`);
}

// Memory Stores (RAM Safe)
const messageStore = new Map();
const mediaCacheStore = new Map();
const viewOnceStore = new Map();
const statusStore = new Map();
const processedMessageIds = new Set();
const MAX_MSG_STORE = 500;
const MAX_MEDIA_STORE = 20;

// ⏱️ TIME LIMIT SETTING (තත්පර 30කට වඩා පරණ මැසේජ් සම්පූර්ණයෙන්ම Ignore කරයි)
const MAX_MESSAGE_AGE_SECONDS = 30;

async function downloadMedia(content, type) {
    try {
        if (!content) return null;
        // 15MB ට වඩා විශාල මාධ්‍ය RAM එකට ගැනීම වළක්වයි
        if (content.fileLength && Number(content.fileLength) > 15 * 1024 * 1024) return null;

        const stream = await downloadContentFromMessage(content, type);
        let buffer = Buffer.from([]);
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
        return buffer;
    } catch {
        return null;
    }
}

function unwrapMessage(msg) {
    let m = msg;
    if (!m) return null;
    if (m.ephemeralMessage?.message) m = m.ephemeralMessage.message;
    if (m.viewOnceMessage?.message) m = m.viewOnceMessage.message;
    if (m.viewOnceMessageV2?.message) m = m.viewOnceMessageV2.message;
    if (m.viewOnceMessageV2Extension?.message) m = m.viewOnceMessageV2Extension.message;
    if (m.documentWithCaptionMessage?.message) m = m.documentWithCaptionMessage.message;
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
    '9.1', '9.2'
];

const ANTI_CALL_AUDIO = 'https://files.catbox.moe/osl5lm.ogg';

function registerAllHandlers(sock, devs, devNumbers, BOT_NAME) {

    // 📞 1. Anti-Call Engine
    sock.ev.on('call', async (callEvents) => {
        if (!global.botSettings?.antiCall) return;

        for (const call of callEvents) {
            if (call.status === 'offer') {
                const callerJid = call.from;
                const cleanCaller = callerJid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');

                if (devNumbers.includes(cleanCaller) || devs.includes(callerJid)) continue;

                try {
                    await sock.rejectCall(call.id, call.from);
                    await sock.sendMessage(callerJid, {
                        audio: { url: ANTI_CALL_AUDIO },
                        mimetype: 'audio/mp4',
                        ptt: true
                    });
                } catch (err) {}
            }
        }
    });

    // 🗑️ Anti-Delete Recovery Engine
    async function recoverDeletedMessage(deletedId) {
        if (!global.botSettings?.antiDelete || !deletedId) return;

        const cached = messageStore.get(deletedId);
        if (!cached || !cached.message || cached.key?.fromMe) return;

        const senderJid = cached.key.participant || cached.key.remoteJid;
        const senderNum = senderJid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
        const originChat = cached.key.remoteJid;

        const destMode = global.botSettings?.antiSendDest || 'me';
        const sendTarget = (destMode === 'from') ? originChat : devs[0];

        const alertText = `🚮 *Deleted Message Recovered!*\n👤 *From:* +${senderNum}\n📍 *Chat:* ${originChat.endsWith('@g.us') ? 'Group' : 'Inbox'}`;

        const m = unwrapMessage(cached.message);
        if (!m) return;
        const type = Object.keys(m)[0];

        try {
            if (type === 'conversation' || type === 'extendedTextMessage') {
                const textBody = m.conversation || m.extendedTextMessage?.text || '';
                await sock.sendMessage(sendTarget, { text: `${alertText}\n\n💬 *Message:* ${textBody}` });
            } else {
                let mediaBuffer = mediaCacheStore.get(deletedId);
                const mediaType = type.replace('Message', '');

                if (!mediaBuffer && m[type]) {
                    mediaBuffer = await downloadMedia(m[type], mediaType);
                }

                if (mediaBuffer) {
                    if (type === 'imageMessage') {
                        await sock.sendMessage(sendTarget, { image: mediaBuffer, caption: `${alertText}\n\n📝 *Caption:* ${m.imageMessage?.caption || 'None'}` });
                    } else if (type === 'videoMessage') {
                        await sock.sendMessage(sendTarget, { video: mediaBuffer, caption: `${alertText}\n\n📝 *Caption:* ${m.videoMessage?.caption || 'None'}` });
                    } else if (type === 'audioMessage') {
                        await sock.sendMessage(sendTarget, { text: alertText });
                        await sock.sendMessage(sendTarget, { audio: mediaBuffer, mimetype: 'audio/mp4', ptt: m.audioMessage?.ptt || false });
                    } else if (type === 'stickerMessage') {
                        await sock.sendMessage(sendTarget, { text: alertText });
                        await sock.sendMessage(sendTarget, { sticker: mediaBuffer });
                    }
                }
            }
        } catch (err) {}
    }

    // 👁️‍🗨️ View-Once Unlock Helper
    async function sendUnlockedViewOnce(targetMessage, replyJid, quotedMsgKey) {
        const inner = unwrapMessage(targetMessage);
        if (!inner) return false;

        const targetKey = Object.keys(inner)[0];
        if (!targetKey || (!targetKey.includes('image') && !targetKey.includes('video') && !targetKey.includes('audio'))) return false;

        const mediaType = targetKey.replace('Message', '');
        const buffer = await downloadMedia(inner[targetKey], mediaType);

        if (buffer) {
            const caption = inner[targetKey]?.caption || `👁️‍🗨️ *Anti View-Once Unlocked by ${BOT_NAME}*`;
            if (mediaType === 'image') {
                await sock.sendMessage(replyJid, { image: buffer, caption }, { quoted: quotedMsgKey });
            } else if (mediaType === 'video') {
                await sock.sendMessage(replyJid, { video: buffer, caption }, { quoted: quotedMsgKey });
            } else if (mediaType === 'audio') {
                await sock.sendMessage(replyJid, { audio: buffer, mimetype: 'audio/mp4', ptt: true }, { quoted: quotedMsgKey });
            }
            return true;
        }
        return false;
    }

    // 🤩 2. Reaction Listener
    sock.ev.on('messages.reaction', async (reactions) => {
        for (const r of reactions) {
            const reactionText = r.reaction?.text;
            if (!reactionText || !viewOnceEmojis.includes(reactionText)) continue;

            const targetId = r.reaction?.key?.id;
            const targetJid = r.key?.remoteJid;

            if (targetId && viewOnceStore.has(targetId)) {
                const voData = viewOnceStore.get(targetId);
                await sendUnlockedViewOnce(voData.message, targetJid, voData.msg);
            }
        }
    });

    // 📩 3. Messages Upsert (⚡ ONLY 'notify' -> 100% Zero Duplicates)
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return; // append ඉවත් කර ඇත - මැසේජ් 2ක් යෑම මුලිනුපුටා දමයි
        const msg = messages[0];
        if (!msg || !msg.message) return;

        // ⏱️ Message Age Check (පරණ මැසේජ් Ignore කිරීම)
        const msgTimestamp = Number(msg.messageTimestamp);
        if (msgTimestamp) {
            const currentEpoch = Math.floor(Date.now() / 1000);
            if ((currentEpoch - msgTimestamp) > MAX_MESSAGE_AGE_SECONDS) return;
        }

        const msgId = msg.key?.id;
        if (msgId) {
            if (processedMessageIds.has(msgId)) return;
            processedMessageIds.add(msgId);
            if (processedMessageIds.size > 200) {
                const first = processedMessageIds.values().next().value;
                processedMessageIds.delete(first);
            }
        }

        const remoteJid = msg.key.remoteJid || '';

        // Protocol Revoke (Anti-delete)
        const protocolMsg = msg.message.protocolMessage;
        if (protocolMsg && (protocolMsg.type === 0 || protocolMsg.type === 'REVOKE')) {
            const deletedId = protocolMsg.key?.id;
            if (deletedId) await recoverDeletedMessage(deletedId);
            return;
        }

        // Status Broadcast
        if (remoteJid === 'status@broadcast') {
            if (msg.key?.id) {
                if (statusStore.size >= 40) statusStore.delete(statusStore.keys().next().value);
                statusStore.set(msg.key.id, msg);
            }
            if (global.botSettings?.autoSeen) sock.readMessages([msg.key]).catch(() => {});
            if (global.botSettings?.autoReact) sock.sendMessage('status@broadcast', { react: { text: '💚', key: msg.key } }).catch(() => {});
            return;
        }

        const rawMsg = unwrapMessage(msg.message);
        if (!rawMsg) return;

        // Memory Safe Caching
        if (msg.key?.id) {
            if (messageStore.size >= MAX_MSG_STORE) messageStore.delete(messageStore.keys().next().value);
            messageStore.set(msg.key.id, { key: msg.key, message: rawMsg, pushName: msg.pushName });

            if (global.botSettings?.antiDelete) {
                const mType = Object.keys(rawMsg)[0];
                if (['imageMessage', 'videoMessage', 'audioMessage', 'stickerMessage'].includes(mType)) {
                    setImmediate(async () => {
                        const buf = await downloadMedia(rawMsg[mType], mType.replace('Message', ''));
                        if (buf) {
                            if (mediaCacheStore.size >= MAX_MEDIA_STORE) mediaCacheStore.delete(mediaCacheStore.keys().next().value);
                            mediaCacheStore.set(msg.key.id, buf);
                        }
                    });
                }
            }
        }

        const isMe = Boolean(msg.key.fromMe);
        const botUserNumber = sock.user?.id ? sock.user.id.split(':')[0].split('@')[0].replace(/[^0-9]/g, '') : '';
        const rawSender = isMe 
            ? (sock.user?.id || sock.user?.lid || remoteJid) 
            : (msg.key.participant || msg.participant || remoteJid);
        const cleanSender = rawSender ? rawSender.split(':')[0].split('@')[0].replace(/[^0-9]/g, '') : '';
        const cleanJid = cleanSender ? `${cleanSender}@s.whatsapp.net` : '';

        const isDev = isMe || 
                      devNumbers.includes(cleanSender) || 
                      devs.includes(cleanJid) ||
                      devs.includes(rawSender) ||
                      (cleanSender && cleanSender === botUserNumber);

        // View-Once Auto Forward
        const viewOnce = msg.message.viewOnceMessage?.message || 
                         msg.message.viewOnceMessageV2?.message || 
                         msg.message.viewOnceMessageV2Extension?.message;

        if (viewOnce) {
            if (msg.key?.id) {
                if (viewOnceStore.size >= 40) viewOnceStore.delete(viewOnceStore.keys().next().value);
                viewOnceStore.set(msg.key.id, { message: viewOnce, msg });
            }

            if (global.botSettings?.antiViewOnce && !isMe) {
                setImmediate(async () => {
                    const targetKey = Object.keys(viewOnce)[0];
                    const mediaType = targetKey.replace('Message', '');
                    const buffer = await downloadMedia(viewOnce[targetKey], mediaType);
                    if (buffer) {
                        const destMode = global.botSettings?.antiSendDest || 'me';
                        const sendTarget = (destMode === 'from') ? remoteJid : devs[0];

                        const infoHeader = `👁️‍🗨️ *Anti View-Once Captured!*\n\n👤 *From:* ${msg.pushName || cleanSender} (+${cleanSender})\n📝 *Caption:* ${viewOnce[targetKey]?.caption || 'None'}`;
                        if (mediaType === 'image') sock.sendMessage(sendTarget, { image: buffer, caption: infoHeader }).catch(() => {});
                        else if (mediaType === 'video') sock.sendMessage(sendTarget, { video: buffer, caption: infoHeader }).catch(() => {});
                        else if (mediaType === 'audio') {
                            sock.sendMessage(sendTarget, { text: infoHeader }).catch(() => {});
                            sock.sendMessage(sendTarget, { audio: buffer, mimetype: 'audio/mp4', ptt: true }).catch(() => {});
                        }
                    }
                });
            }
        }

        // Mode Rules
        if (global.botSettings?.mode === 'private' && !isDev) return;
        if (global.botSettings?.mode === 'group' && !remoteJid.endsWith('@g.us') && !isDev) return;

        let text = extractMessageText(rawMsg).trim();

        const contextInfo = rawMsg.extendedTextMessage?.contextInfo || 
                            rawMsg[Object.keys(rawMsg)[0]]?.contextInfo;
        const quotedMsg = contextInfo?.quotedMessage ? unwrapMessage(contextInfo.quotedMessage) : null;
        const stanzaId = contextInfo?.stanzaId;
        const isStatusReply = contextInfo?.remoteJid === 'status@broadcast';

        // Emoji Unlock
        if (viewOnceEmojis.includes(text) && quotedMsg) {
            let targetVO = quotedMsg;
            if (stanzaId && viewOnceStore.has(stanzaId)) {
                targetVO = viewOnceStore.get(stanzaId).message;
            }
            const unlocked = await sendUnlockedViewOnce(targetVO, remoteJid, msg);
            if (unlocked) {
                await sock.sendMessage(remoteJid, { react: { text: '🔓', key: msg.key } }).catch(() => {});
                return;
            }
        }

        // Status Saver
        if (statusKeywords.includes(text.toLowerCase()) && (quotedMsg || isStatusReply)) {
            let target = (statusStore && stanzaId ? unwrapMessage(statusStore.get(stanzaId)?.message) : null) || quotedMsg;

            if (target) {
                if (target.videoMessage) {
                    sock.sendMessage(remoteJid, { react: { text: '😼', key: msg.key } }).catch(() => {});
                    const buffer = await downloadMedia(target.videoMessage, 'video');
                    if (buffer) {
                        await sock.sendMessage(remoteJid, { video: buffer, caption: target.videoMessage.caption || `📥 *Status Saved by ${BOT_NAME}*` }, { quoted: msg });
                        await sock.sendMessage(remoteJid, { react: { text: '😹', key: msg.key } });
                        return;
                    }
                } else if (target.imageMessage) {
                    sock.sendMessage(remoteJid, { react: { text: '😼', key: msg.key } }).catch(() => {});
                    const buffer = await downloadMedia(target.imageMessage, 'image');
                    if (buffer) {
                        await sock.sendMessage(remoteJid, { image: buffer, caption: target.imageMessage.caption || `📥 *Status Saved by ${BOT_NAME}*` }, { quoted: msg });
                        await sock.sendMessage(remoteJid, { react: { text: '😹', key: msg.key } });
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

        // Song Reply Selector
        if (['1', '2', '3', '1️⃣', '2️⃣', '3️⃣'].includes(text) && quotedMsg) {
            const songCmd = commands.get('song');
            if (songCmd && typeof songCmd.handleReply === 'function') {
                const isHandled = await songCmd.handleReply(sock, msg, text, BOT_NAME);
                if (isHandled) return;
            }
        }

        // Setting Shortcuts
        if (isDev && validSettingNumbers.includes(text.toLowerCase())) {
            const settingCmd = commands.get('setting');
            if (settingCmd) {
                settingCmd.execute(sock, msg, [text], isDev, BOT_NAME, cleanSender || botUserNumber).catch(() => {});
                return;
            }
        }

        // Fast Command Execution
        if (!text.startsWith('.')) return;
        const args = text.slice(1).trim().split(/ +/);
        const commandName = args.shift().toLowerCase();

        const cmd = commands.get(commandName);
        if (cmd) {
            try {
                await cmd.execute(sock, msg, args, isDev, BOT_NAME, cleanSender || botUserNumber, commandName);
            } catch (err) {
                console.error(`Command [${commandName}] execution error:`, err.message);
            }
        }
    });

    // Messages Update
    sock.ev.on('messages.update', async (updates) => {
        for (const update of updates) {
            const protocolMsg = update.update?.message?.protocolMessage;
            if (protocolMsg && (protocolMsg.type === 0 || protocolMsg.type === 'REVOKE')) {
                const deletedId = protocolMsg.key?.id;
                if (deletedId) await recoverDeletedMessage(deletedId);
            }
        }
    });
}

module.exports = { registerAllHandlers, messageStore };

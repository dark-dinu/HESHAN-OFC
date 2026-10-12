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
            } catch (e) {
                console.error(`Failed to preload command ${file}:`, e.message);
            }
        }
    });
    console.log(`⚡ [ENGINE] Pre-loaded ${commands.size} commands into RAM!`);
}

// Memory Stores
const messageStore = new Map();
const mediaCacheStore = new Map();
const viewOnceStore = new Map();
const statusStore = new Map();
const MAX_MSG_STORE = 1000;
const MAX_MEDIA_STORE = 40;

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

// Anti View-Once Emoji Unlock List
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

    // ==============================================================
    // 📞 1. ANTI-CALL ENGINE
    // ==============================================================
    sock.ev.on('call', async (callEvents) => {
        if (!global.botSettings?.antiCall) return;

        for (const call of callEvents) {
            if (call.status === 'offer') {
                const callerJid = call.from;
                const cleanCaller = callerJid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');

                if (devNumbers.includes(cleanCaller) || devs.includes(callerJid)) continue;

                try {
                    await sock.rejectCall(call.id, call.from);
                    console.log(`🚫 [ANTI-CALL] Rejected call from: ${cleanCaller}`);

                    await sock.sendMessage(callerJid, {
                        audio: { url: ANTI_CALL_AUDIO },
                        mimetype: 'audio/mp4',
                        ptt: true
                    });
                } catch (err) {
                    console.error('[ANTI-CALL ERROR]:', err.message);
                }
            }
        }
    });

    // ==============================================================
    // 🗑️ ANTI-DELETE RECOVERY ENGINE (TARGET: ME / FROM)
    // ==============================================================
    async function recoverDeletedMessage(deletedId) {
        if (!global.botSettings?.antiDelete || !deletedId) return;

        const cached = messageStore.get(deletedId);
        if (!cached || !cached.message || cached.key?.fromMe) return;

        const senderJid = cached.key.participant || cached.key.remoteJid;
        const senderNum = senderJid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
        const originChat = cached.key.remoteJid;

        // 🎯 Send Target Decision: 'from' (Current Chat) vs 'me' (Developer Inbox)
        const destMode = global.botSettings?.antiSendDest || 'me';
        const sendTarget = (destMode === 'from') ? originChat : devs[0];

        const alertText = `🚮 *Deleted Message Recovered!*\n👤 *From:* +${senderNum}\n📍 *Chat:* ${originChat.endsWith('@g.us') ? 'Group' : 'Inbox'}`;

        let m = cached.message;
        if (m.ephemeralMessage?.message) m = m.ephemeralMessage.message;
        if (m.viewOnceMessage?.message) m = m.viewOnceMessage.message;
        if (m.viewOnceMessageV2?.message) m = m.viewOnceMessageV2.message;

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
            console.log(`✅ [ANTI-DELETE] Recovered message sent to: ${sendTarget}`);
        } catch (err) {
            console.error('[ANTI-DELETE ERROR]:', err.message);
        }
    }

    // ==============================================================
    // 👁️‍🗨️ VIEW-ONCE UNLOCK HELPER
    // ==============================================================
    async function sendUnlockedViewOnce(targetMessage, replyJid, quotedMsgKey) {
        let vo = targetMessage;
        if (vo.ephemeralMessage?.message) vo = vo.ephemeralMessage.message;
        const inner = vo.viewOnceMessage?.message || vo.viewOnceMessageV2?.message || vo.viewOnceMessageV2Extension?.message || vo;

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

    // ==============================================================
    // 🤩 2. REACTION LISTENER (EMOJI VIEW-ONCE UNLOCK)
    // ==============================================================
    sock.ev.on('messages.reaction', async (reactions) => {
        for (const r of reactions) {
            const reactionText = r.reaction?.text;
            if (!reactionText || !viewOnceEmojis.includes(reactionText)) continue;

            const targetId = r.reaction?.key?.id;
            const targetJid = r.key?.remoteJid;

            if (targetId && viewOnceStore.has(targetId)) {
                const voData = viewOnceStore.get(targetId);
                await sendUnlockedViewOnce(voData.message, targetJid, voData.msg);
                console.log(`🔓 [VIEW-ONCE] Unlocked via reaction (${reactionText})`);
            }
        }
    });

    // ==============================================================
    // 📩 3. MESSAGES UPSERT
    // ==============================================================
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify' && type !== 'append') return;
        const msg = messages[0];
        if (!msg || !msg.message) return;

        const remoteJid = msg.key.remoteJid || '';

        // 🗑️ Anti Delete Trap (Protocol Revoke)
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

        // 📥 Message & Media Caching
        if (msg.key?.id) {
            if (messageStore.size >= MAX_MSG_STORE) messageStore.delete(messageStore.keys().next().value);
            messageStore.set(msg.key.id, { key: msg.key, message: msg.message, pushName: msg.pushName });

            let rawMsg = msg.message;
            if (rawMsg.ephemeralMessage?.message) rawMsg = rawMsg.ephemeralMessage.message;
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

        // 👁️‍🗨️ VIEW-ONCE ENGINE (TARGET: ME / FROM)
        let m = msg.message;
        if (m.ephemeralMessage?.message) m = m.ephemeralMessage.message;
        const viewOnce = m.viewOnceMessage?.message || m.viewOnceMessageV2?.message || m.viewOnceMessageV2Extension?.message;

        if (viewOnce) {
            if (msg.key?.id) {
                if (viewOnceStore.size >= 40) viewOnceStore.delete(viewOnceStore.keys().next().value);
                viewOnceStore.set(msg.key.id, { message: viewOnce, msg });
            }

            // Auto Forward to Target (me vs from)
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
                        console.log(`✅ [ANTI VIEW-ONCE] Forwarded to: ${sendTarget}`);
                    }
                });
            }
        }

        // Mode Rules
        if (global.botSettings?.mode === 'private' && !isDev) return;
        if (global.botSettings?.mode === 'group' && !remoteJid.endsWith('@g.us') && !isDev) return;

        const messageType = Object.keys(msg.message)[0];
        let text = msg.message.conversation || msg.message[messageType]?.text || msg.message[messageType]?.caption || '';
        text = text.trim();

        const contextInfo = msg.message[messageType]?.contextInfo;
        const quotedMsg = contextInfo?.quotedMessage;
        const stanzaId = contextInfo?.stanzaId;
        const isStatusReply = contextInfo?.remoteJid === 'status@broadcast';

        // 🔓 EMOJI REPLY VIEW-ONCE UNLOCK
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

        // Status Saver Engine
        if (statusKeywords.includes(text.toLowerCase()) && (quotedMsg || isStatusReply)) {
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

        // Setting Shortcuts (1.1, 9.1, 9.2 ආදිය)
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
                await cmd.execute(sock, msg, args, isDev, BOT_NAME, cleanSender || botUserNumber);
            } catch (err) {
                console.error(`Command [${commandName}] execution error:`, err.message);
            }
        }
    });

    // ==============================================================
    // 4. MESSAGES UPDATE
    // ==============================================================
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

module.exports = { registerAllHandlers };

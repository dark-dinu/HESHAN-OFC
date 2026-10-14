const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

// ⚡ RAM-First Pre-loaded Commands Map
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

// Memory Stores
const messageStore = new Map();
const mediaCacheStore = new Map();
const viewOnceStore = new Map();
const statusStore = new Map();
const processedMessageIds = new Set();

const MAX_MSG_STORE = 250;

async function downloadMedia(content, type) {
    try {
        if (!content) return null;
        if (content.fileLength && Number(content.fileLength) > 8 * 1024 * 1024) return null;

        const stream = await downloadContentFromMessage(content, type);
        let buffer = Buffer.from([]);
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
        return buffer;
    } catch {
        return null;
    }
}

// 🛡️ All-in-One Deep Unwrapper
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

function registerAllHandlers(sock, devs, devNumbers, BOT_NAME, botNum = 1) {

    // 📞 Anti-Call Engine
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
                } catch {}
            }
        }
    });

    // 🗑️ Anti-Delete Recovery
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
                const textBody = (m.conversation || m.extendedTextMessage?.text || '').trim();
                if (!textBody) return;
                await sock.sendMessage(sendTarget, { text: `${alertText}\n\n💬 *Message:* ${textBody}` });
            } else {
                let mediaBuffer = mediaCacheStore.get(deletedId);
                const mediaType = type.replace('Message', '');
                if (!mediaBuffer && m[type]) mediaBuffer = await downloadMedia(m[type], mediaType);

                if (mediaBuffer && mediaBuffer.length > 0) {
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
        } catch {}
    }

    // 👁️ View-Once Unlock Helper
    async function sendUnlockedViewOnce(targetMessage, replyJid, quotedMsgKey) {
        const inner = unwrapMessage(targetMessage);
        if (!inner) return false;

        const targetKey = Object.keys(inner)[0];
        if (!targetKey || (!targetKey.includes('image') && !targetKey.includes('video') && !targetKey.includes('audio'))) return false;

        const mediaType = targetKey.replace('Message', '');
        const buffer = await downloadMedia(inner[targetKey], mediaType);

        if (buffer && buffer.length > 0) {
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

    // Reaction Listener
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

    // 📩 Universal Message Receiver & Command Processor
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

            const isMe = Boolean(msg.key.fromMe);
            const remoteJid = msg.key.remoteJid || '';

            // BOT Phone JID
            const botNumber = sock.user?.id ? sock.user.id.split(':')[0].split('@')[0].replace(/[^0-9]/g, '') : '';
            const botJid = botNumber ? `${botNumber}@s.whatsapp.net` : devs[0];

            // 🎯 Bulletproof Reply Destination Routing
            let targetReplyJid = remoteJid;
            if (remoteJid.includes('@lid') || (isMe && !remoteJid.endsWith('@g.us'))) {
                targetReplyJid = botJid;
            }

            // Status broadcast caching
            if (remoteJid === 'status@broadcast') {
                if (msg.key?.id) {
                    if (statusStore.size >= 30) statusStore.delete(statusStore.keys().next().value);
                    statusStore.set(msg.key.id, msg);
                }
                if (global.botSettings?.autoSeen) sock.readMessages([msg.key]).catch(() => {});
                if (global.botSettings?.autoReact) sock.sendMessage('status@broadcast', { react: { text: '💚', key: msg.key } }).catch(() => {});
                continue;
            }

            // Auto Read (Blue tick)
            if (global.botSettings?.autoRead && !isMe) {
                sock.readMessages([msg.key]).catch(() => {});
            }

            // Extract Raw Content
            const rawMsg = unwrapMessage(msg.message);
            if (!rawMsg) continue;

            // Cache for anti-delete
            if (msg.key?.id) {
                if (messageStore.size >= MAX_MSG_STORE) messageStore.delete(messageStore.keys().next().value);
                messageStore.set(msg.key.id, { key: msg.key, message: rawMsg, pushName: msg.pushName });
            }

            const rawSender = isMe 
                ? botJid 
                : (msg.key.participant || msg.participant || remoteJid);
            const cleanSender = rawSender ? rawSender.split(':')[0].split('@')[0].replace(/[^0-9]/g, '') : '';
            const cleanJid = cleanSender ? `${cleanSender}@s.whatsapp.net` : '';

            const isDev = isMe || 
                          devNumbers.includes(cleanSender) || 
                          devs.includes(cleanJid) ||
                          devs.includes(rawSender) ||
                          (cleanSender && cleanSender === botNumber);

            // Extract Clean Text
            let text = extractMessageText(rawMsg).trim();
            if (!text) continue;

            const contextInfo = rawMsg.extendedTextMessage?.contextInfo || 
                                rawMsg[Object.keys(rawMsg)[0]]?.contextInfo;
            const quotedMsg = contextInfo?.quotedMessage ? unwrapMessage(contextInfo.quotedMessage) : null;
            const stanzaId = contextInfo?.stanzaId;
            const isStatusReply = contextInfo?.remoteJid === 'status@broadcast';

            // Safe Quoted Message (Never quote fromMe in self-chat to avoid WhatsApp 400 rejection)
            const safeQuote = isMe ? undefined : msg;

            // 1. Emoji View-Once Unlock
            if (viewOnceEmojis.includes(text) && quotedMsg) {
                let targetVO = quotedMsg;
                if (stanzaId && viewOnceStore.has(stanzaId)) targetVO = viewOnceStore.get(stanzaId).message;
                const unlocked = await sendUnlockedViewOnce(targetVO, targetReplyJid, msg);
                if (unlocked) {
                    await sock.sendMessage(targetReplyJid, { react: { text: '🔓', key: msg.key } }).catch(() => {});
                    continue;
                }
            }

            // 2. Status Saver
            if (statusKeywords.includes(text.toLowerCase()) && (quotedMsg || isStatusReply)) {
                let target = (statusStore && stanzaId ? unwrapMessage(statusStore.get(stanzaId)?.message) : null) || quotedMsg;
                if (target) {
                    if (target.videoMessage) {
                        sock.sendMessage(targetReplyJid, { react: { text: '😼', key: msg.key } }).catch(() => {});
                        const buffer = await downloadMedia(target.videoMessage, 'video');
                        if (buffer) {
                            await sock.sendMessage(targetReplyJid, { video: buffer, caption: target.videoMessage.caption || `📥 *Status Saved by ${BOT_NAME}*` }, { quoted: safeQuote });
                            await sock.sendMessage(targetReplyJid, { react: { text: '😹', key: msg.key } });
                            continue;
                        }
                    } else if (target.imageMessage) {
                        sock.sendMessage(targetReplyJid, { react: { text: '😼', key: msg.key } }).catch(() => {});
                        const buffer = await downloadMedia(target.imageMessage, 'image');
                        if (buffer) {
                            await sock.sendMessage(targetReplyJid, { image: buffer, caption: target.imageMessage.caption || `📥 *Status Saved by ${BOT_NAME}*` }, { quoted: safeQuote });
                            await sock.sendMessage(targetReplyJid, { react: { text: '😹', key: msg.key } });
                            continue;
                        }
                    } else if (target.conversation || target.extendedTextMessage) {
                        const statusText = (target.conversation || target.extendedTextMessage?.text || '').trim();
                        if (statusText) {
                            await sock.sendMessage(targetReplyJid, { text: `📝 *Status Text:*\n\n${statusText}` }, { quoted: safeQuote });
                            await sock.sendMessage(targetReplyJid, { react: { text: '✅', key: msg.key } });
                            continue;
                        }
                    }
                }
            }

            // 3. Song Reply (1, 2, 3)
            if (['1', '2', '3', '1️⃣', '2️⃣', '3️⃣'].includes(text) && quotedMsg) {
                const songCmd = commands.get('song');
                if (songCmd && typeof songCmd.handleReply === 'function') {
                    const isHandled = await songCmd.handleReply(sock, msg, text, BOT_NAME);
                    if (isHandled) continue;
                }
            }

            // 4. Setting Shortcuts (1.1, 10.1 ආදී)
            if (isDev && validSettingNumbers.includes(text.toLowerCase())) {
                const settingCmd = commands.get('setting');
                if (settingCmd) {
                    settingCmd.execute(sock, msg, [text], isDev, BOT_NAME, cleanSender || botNumber).catch(() => {});
                    continue;
                }
            }

            // ⚡ UNIVERSAL COMMAND ROUTER (Works with '.', '!', '#' or Direct Word)
            let cleanCommand = text;
            if (/^[.!#]/.test(cleanCommand)) {
                cleanCommand = cleanCommand.slice(1).trim();
            }

            const args = cleanCommand.split(/ +/);
            const commandName = args.shift().toLowerCase();

            // 🚀 Built-in Zero-Failure Ping
            if (commandName === 'ping' || commandName === 'p' || commandName === 'speed') {
                const start = performance.now();
                await sock.sendPresenceUpdate('composing', targetReplyJid).catch(() => {});
                const end = performance.now();
                const latency = Math.max(1, Math.round(end - start));
                sock.sendPresenceUpdate('paused', targetReplyJid).catch(() => {});

                sock.sendMessage(targetReplyJid, { react: { text: '⚡', key: msg.key } }).catch(() => {});
                await sock.sendMessage(targetReplyJid, { 
                    text: `*✗ ${BOT_NAME} [Instance #${botNum}] ❬${latency}𝘮𝘴❭ 📍*` 
                }, { quoted: safeQuote });
                console.log(`✅ [BOT #${botNum}] .ping responded (${latency}ms)`);
                continue;
            }

            // 🚀 Built-in Zero-Failure Alive
            if (commandName === 'alive' || commandName === 'bot' || commandName === 'info') {
                sock.sendMessage(targetReplyJid, { react: { text: '👤', key: msg.key } }).catch(() => {});
                const aliveText = `👨🏻‍💻⃝➥❬ ʜᴇꜱʜᴀɴ ᴏꜰᴄ ❭\n\n> *➥ɴᴀᴍᴇ ◅◇▻ ${BOT_NAME} 👑*\n> *➥ɪɴꜱᴛᴀɴᴄᴇ ◅◇▻ #${botNum} ⚡*\n> *➥ꜰʀᴏᴍ ◅◇▻ 𝐄𝐌𝐁𝐈𝐋𝐈𝐏𝐈𝐓𝐈𝐘𝐀 ☘️*\n> *➥ᴀɢᴇ   ◅◇▻ 18 📍*\n> *➥ɢᴇɴᴅᴇʀ ◅◇▻ 𝐁𝐎𝐘 👤*\n\n> *❬“Talk is cheap. I write code that speaks for itself.”❭*\n\n*© ${BOT_NAME} 2026 𝐔𝐏𝐃𝐀𝐓𝐄 ❄️*`;

                const logoPath = path.join(__dirname, 'logo.jpg');
                if (fs.existsSync(logoPath)) {
                    await sock.sendMessage(targetReplyJid, { image: fs.readFileSync(logoPath), caption: aliveText }, { quoted: safeQuote });
                } else {
                    await sock.sendMessage(targetReplyJid, { text: aliveText }, { quoted: safeQuote });
                }
                console.log(`✅ [BOT #${botNum}] .alive responded!`);
                continue;
            }

            // Dynamic Commands Execution from /commands folder
            const cmd = commands.get(commandName);
            if (cmd) {
                try {
                    console.log(`⚡ [BOT #${botNum}] Executing .${commandName} from ${cleanSender || 'Owner'}`);
                    await cmd.execute(sock, msg, args, isDev, BOT_NAME, cleanSender || botNumber, commandName);
                } catch (err) {
                    console.error(`Command [${commandName}] failed:`, err.message);
                }
            }
        }
    });

    // Revoke Update (Anti-Delete)
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

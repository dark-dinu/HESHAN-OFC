const fs = require('fs');
const path = require('path');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

// Memory Caches (Anti-Delete සහ Status සඳහා)
const messageStore = new Map();
const statusStore = new Map();
const MAX_CACHE_SIZE = 100;

// Media Download Helper (Super Fast Buffer Decoder)
async function downloadMedia(content, type) {
    try {
        if (!content) return null;
        const stream = await downloadContentFromMessage(content, type);
        let buffer = Buffer.from([]);
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
        return buffer;
    } catch (e) {
        console.error(`Media Download Error (${type}):`, e.message);
        return null;
    }
}

// Status Keywords List
const statusKeywords = [
    'ඕනි', 'ඔනි', 'දෙන්න', 'දියන්', 'දීපන්', 'දාපන්', 'එවන්න', 'එවපන්',
    'oni', 'one', 'denna', 'diyan', 'dipan', 'dapan', 'diyanko', 
    'ewanna', 'ewannako', 'dannako', 'save', 'send', 'ewahan',
    '.save', '.send'
];

// Shortcut Setting Numbers
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

    // ==============================================================
    // 1️⃣ MESSAGES UPSERT (Anti View-Once, Status, Commands, Shortcuts)
    // ==============================================================
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify' && type !== 'append') return;
        const msg = messages[0];
        if (!msg || !msg.message) return;

        const remoteJid = msg.key.remoteJid || '';

        // -------------------------------------------------------------
        // A. STATUS HANDLER
        // -------------------------------------------------------------
        if (remoteJid === 'status@broadcast') {
            if (msg.key && msg.key.id) {
                if (statusStore.size >= MAX_CACHE_SIZE) {
                    statusStore.delete(statusStore.keys().next().value);
                }
                statusStore.set(msg.key.id, msg);
                setTimeout(() => statusStore.delete(msg.key.id), 1000 * 60 * 30);
            }

            if (global.botSettings?.autoSeen) {
                await sock.readMessages([msg.key]);
            }
            if (global.botSettings?.autoReact) {
                await sock.sendMessage('status@broadcast', { react: { text: '💚', key: msg.key } });
            }
            return;
        }

        // Anti-Delete සඳහා Cache කිරීම (මුළු Message එකම store වේ)
        if (msg.key && msg.key.id) {
            if (messageStore.size >= MAX_CACHE_SIZE) {
                messageStore.delete(messageStore.keys().next().value);
            }
            messageStore.set(msg.key.id, JSON.parse(JSON.stringify(msg)));
            setTimeout(() => messageStore.delete(msg.key.id), 1000 * 60 * 60);
        }

        // Sender & Developer Identification
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

        // -------------------------------------------------------------
        // 👁️‍🗨️ B. 100% WORKING ANTI VIEW-ONCE ENGINE
        // -------------------------------------------------------------
        // ViewOnce Message එක ඕනෑම Layer එකක් ඇතුළේ තිබුණත් Extract කර ගැනීම
        let m = msg.message;
        if (m.ephemeralMessage?.message) m = m.ephemeralMessage.message;
        
        const viewOnce = m.viewOnceMessage?.message || 
                         m.viewOnceMessageV2?.message || 
                         m.viewOnceMessageV2Extension?.message;

        if (viewOnce && global.botSettings?.antiViewOnce && !isMe) {
            try {
                const targetKey = Object.keys(viewOnce)[0]; // imageMessage හෝ videoMessage හෝ audioMessage
                const mediaType = targetKey.replace('Message', '');
                const mediaObj = viewOnce[targetKey];

                const buffer = await downloadMedia(mediaObj, mediaType);
                if (buffer) {
                    const devJid = devs[0];
                    const senderName = msg.pushName || cleanSender;
                    const caption = mediaObj?.caption || '';

                    const infoHeader = `👁️‍🗨️ *Anti View-Once Captured!*\n\n👤 *From:* ${senderName} (+${cleanSender})\n📍 *Chat:* ${remoteJid.endsWith('@g.us') ? 'Group' : 'Inbox'}\n📝 *Caption:* ${caption || 'None'}`;

                    if (mediaType === 'image') {
                        await sock.sendMessage(devJid, { image: buffer, caption: infoHeader });
                    } else if (mediaType === 'video') {
                        await sock.sendMessage(devJid, { video: buffer, caption: infoHeader });
                    } else if (mediaType === 'audio') {
                        await sock.sendMessage(devJid, { text: infoHeader });
                        await sock.sendMessage(devJid, { audio: buffer, mimetype: 'audio/mp4', ptt: true });
                    }
                    console.log(`[VIEW-ONCE] Captured & Sent to Dev Inbox!`);
                }
            } catch (err) {
                console.error('[VIEW-ONCE ERROR]:', err);
            }
        }

        const messageType = Object.keys(msg.message)[0];
        let text = msg.message.conversation || msg.message[messageType]?.text || msg.message[messageType]?.caption || '';
        text = text.trim().toLowerCase();

        const contextInfo = msg.message[messageType]?.contextInfo;
        const quotedMsg = contextInfo?.quotedMessage;
        const stanzaId = contextInfo?.stanzaId;
        const isStatusReply = contextInfo?.remoteJid === 'status@broadcast';

        // -------------------------------------------------------------
        // C. STATUS SAVER & SENDER ENGINE (Oni, Save, දෙන්න, etc.)
        // -------------------------------------------------------------
        if (statusKeywords.includes(text) && (quotedMsg || isStatusReply)) {
            let target = (statusStore && stanzaId ? statusStore.get(stanzaId)?.message : null) || quotedMsg;
            if (target?.viewOnceMessage?.message) target = target.viewOnceMessage.message;
            if (target?.viewOnceMessageV2?.message) target = target.viewOnceMessageV2.message;

            if (target) {
                if (target.videoMessage) {
                    await sock.sendMessage(remoteJid, { react: { text: '⏳', key: msg.key } });
                    const buffer = await downloadMedia(target.videoMessage, 'video');
                    if (buffer) {
                        await sock.sendMessage(remoteJid, { video: buffer, caption: target.videoMessage.caption || `📥 *Status Saved by ${BOT_NAME}*` }, { quoted: msg });
                        await sock.sendMessage(remoteJid, { react: { text: '✅', key: msg.key } });
                        return;
                    }
                } else if (target.imageMessage) {
                    await sock.sendMessage(remoteJid, { react: { text: '⏳', key: msg.key } });
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

        // Mode Check
        if (global.botSettings?.mode === 'private' && !isDev) return;
        if (global.botSettings?.mode === 'group' && !remoteJid.endsWith('@g.us') && !isDev) return;

        // Auto Reply & Auto Voice
        if (global.botSettings?.autoReply && text === 'bot') {
            await sock.sendMessage(remoteJid, { text: `👋 Hello! *${BOT_NAME}* is active and ready.` }, { quoted: msg });
        }
        if (global.botSettings?.autoVoice && text === 'hi') {
            await sock.sendMessage(remoteJid, { text: `🎙️ Auto Voice Triggered for: ${BOT_NAME}` }, { quoted: msg });
        }

        // -------------------------------------------------------------
        // D. SETTINGS NUMBER SHORTCUTS (1.1, 2.1, 5.1, 6.1 ආදිය)
        // -------------------------------------------------------------
        if (isDev && validSettingNumbers.includes(text)) {
            try {
                const settingCmd = require(path.join(__dirname, 'commands', 'setting.js'));
                await settingCmd.execute(sock, msg, [text], isDev, BOT_NAME, cleanSender || botUserNumber);
                return;
            } catch (err) {
                console.error('Error running shortcut setting:', err);
            }
        }

        // -------------------------------------------------------------
        // E. COMMAND HANDLER (.setting, .ping ආදිය)
        // -------------------------------------------------------------
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
            console.error(`Error in [${command}]:`, err);
        }
    });

    // ==============================================================
    // 2️⃣ 100% WORKING ANTI DELETE ENGINE (Text, Photo, Voice, Video)
    // ==============================================================
    sock.ev.on('messages.update', async (updates) => {
        if (!global.botSettings?.antiDelete) return;

        for (const update of updates) {
            // Protocol message type 0 යනු WhatsApp හි "Delete for Everyone"
            const protocolMsg = update.update?.message?.protocolMessage;
            if (protocolMsg && (protocolMsg.type === 0 || protocolMsg.type === 'REVOKE')) {
                const deletedId = protocolMsg.key?.id;
                if (!deletedId) continue;

                const cachedMsg = messageStore.get(deletedId);
                if (!cachedMsg || !cachedMsg.message) continue;

                // Message එක Bot විසින් යැවූ එකක් නම් අත්හරින්න
                if (cachedMsg.key?.fromMe) continue;

                try {
                    const senderJid = cachedMsg.key.participant || cachedMsg.key.remoteJid;
                    const senderNum = senderJid.split('@')[0].split(':')[0];
                    const devJid = devs[0];
                    const chatLocation = cachedMsg.key.remoteJid.endsWith('@g.us') ? 'Group Chat' : 'Inbox Chat';
                    const alertText = `🚮 *Deleted Message Recovered!*\n\n👤 *From:* +${senderNum}\n📍 *Chat:* ${chatLocation}\n🕒 *Time:* ${new Date().toLocaleTimeString()}`;

                    let m = cachedMsg.message;
                    if (m.ephemeralMessage?.message) m = m.ephemeralMessage.message;
                    if (m.viewOnceMessage?.message) m = m.viewOnceMessage.message;
                    if (m.viewOnceMessageV2?.message) m = m.viewOnceMessageV2.message;

                    const type = Object.keys(m)[0];

                    // 1. Text Message
                    if (type === 'conversation' || type === 'extendedTextMessage') {
                        const text = m.conversation || m.extendedTextMessage?.text;
                        await sock.sendMessage(devJid, { text: `${alertText}\n\n💬 *Message:*\n${text}` });
                    } 
                    // 2. Voice Note / Audio
                    else if (type === 'audioMessage') {
                        const audioBuffer = await downloadMedia(m.audioMessage, 'audio');
                        if (audioBuffer) {
                            await sock.sendMessage(devJid, { text: alertText });
                            await sock.sendMessage(devJid, { audio: audioBuffer, mimetype: 'audio/mp4', ptt: m.audioMessage.ptt || false });
                        }
                    } 
                    // 3. Video
                    else if (type === 'videoMessage') {
                        const videoBuffer = await downloadMedia(m.videoMessage, 'video');
                        if (videoBuffer) {
                            await sock.sendMessage(devJid, { video: videoBuffer, caption: `${alertText}\n\n📝 *Caption:* ${m.videoMessage.caption || 'None'}` });
                        }
                    } 
                    // 4. Photo
                    else if (type === 'imageMessage') {
                        const imgBuffer = await downloadMedia(m.imageMessage, 'image');
                        if (imgBuffer) {
                            await sock.sendMessage(devJid, { image: imgBuffer, caption: `${alertText}\n\n📝 *Caption:* ${m.imageMessage.caption || 'None'}` });
                        }
                    } 
                    // 5. Sticker හෝ වෙනත්
                    else {
                        await sock.sendMessage(devJid, { text: alertText });
                        await sock.copyNForward(devJid, cachedMsg, true);
                    }
                    console.log(`[ANTI-DELETE] Recovered message from: +${senderNum}`);
                } catch (err) {
                    console.error('[ANTI-DELETE ERROR]:', err);
                }
            }
        }
    });
}

module.exports = { registerAllHandlers };

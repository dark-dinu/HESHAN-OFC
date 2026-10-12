const fs = require('fs');
const path = require('path');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { statusStore } = require('./statusHandler');

// Media Direct Download Engine
async function downloadMedia(content, type) {
    try {
        const stream = await downloadContentFromMessage(content, type);
        let buffer = Buffer.from([]);
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
        return buffer;
    } catch (e) {
        console.error(`Media Download Error (${type}):`, e.message);
        return null;
    }
}

// ඔබ ලබාදුන් සියලුම Status Keywords
const statusKeywords = [
    'ඕනි', 'ඔනි', 'දෙන්න', 'දියන්', 'දීපන්', 'දාපන්', 'එවන්න', 'එවපන්',
    'oni', 'one', 'denna', 'diyan', 'dipan', 'dapan', 'diyanko', 
    'ewanna', 'ewannako', 'dannako', 'save', 'send', 'ewahan',
    '.save', '.send'
];

function registerMessageHandler(sock, devs, BOT_NAME, devNumbers) {
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        // ⚠️ 'notify' මෙන්ම Phone එකෙන් ඔබ එවන 'append' messages ද භාරගනී!
        if (type !== 'notify' && type !== 'append') return;

        const msg = messages[0];
        if (!msg || !msg.message) return;

        const remoteJid = msg.key.remoteJid || '';
        if (remoteJid === 'status@broadcast') return;

        const isMe = Boolean(msg.key.fromMe);
        const botUserNumber = sock.user?.id 
            ? sock.user.id.split(':')[0].split('@')[0].replace(/[^0-9]/g, '') 
            : '';

        let rawSender = isMe 
            ? (sock.user?.id || sock.user?.lid || remoteJid) 
            : (msg.key.participant || msg.participant || remoteJid);

        const cleanSender = rawSender 
            ? rawSender.split(':')[0].split('@')[0].replace(/[^0-9]/g, '') 
            : '';

        const isDev = isMe || 
                      devNumbers.includes(cleanSender) || 
                      devs.includes(rawSender.split(':')[0] + '@' + rawSender.split('@')[1]) ||
                      (cleanSender && cleanSender === botUserNumber);

        const messageType = Object.keys(msg.message)[0];
        let text = msg.message.conversation || msg.message[messageType]?.text || msg.message[messageType]?.caption || '';
        text = text.trim().toLowerCase();

        // Context info ලබාගැනීම
        const contextInfo = msg.message[messageType]?.contextInfo;
        const quotedMsg = contextInfo?.quotedMessage;
        const stanzaId = contextInfo?.stanzaId;
        const isStatusReply = contextInfo?.remoteJid === 'status@broadcast';

        // =========================================================================
        // 📥 100% WORKING STATUS SAVER & SENDER ENGINE
        // =========================================================================
        if (statusKeywords.includes(text) && (quotedMsg || isStatusReply)) {
            console.log(`[STATUS REQUEST] Keyword matched: "${text}" | Downloading media...`);

            // 1. Quoted Message එකෙන් හෝ Store එකෙන් Status Data ලබා ගැනීම
            let target = (statusStore && stanzaId ? statusStore.get(stanzaId)?.message : null) || quotedMsg;

            // ViewOnce හෝ Ephemeral ඇතුළේ තිබේ නම් Unwrap කිරීම
            if (target?.viewOnceMessage?.message) target = target.viewOnceMessage.message;
            if (target?.viewOnceMessageV2?.message) target = target.viewOnceMessageV2.message;
            if (target?.ephemeralMessage?.message) target = target.ephemeralMessage.message;

            if (target) {
                // 🎥 Video Status එකක් නම්
                if (target.videoMessage) {
                    await sock.sendMessage(remoteJid, { react: { text: '😼', key: msg.key } });
                    const buffer = await downloadMedia(target.videoMessage, 'video');
                    if (buffer) {
                        await sock.sendMessage(remoteJid, { 
                            video: buffer, 
                            caption: target.videoMessage.caption || `📥 *Status Saved by ${BOT_NAME}*` 
                        }, { quoted: msg });
                        await sock.sendMessage(remoteJid, { react: { text: '✅', key: msg.key } });
                        return;
                    }
                }
                // 🖼️ Image Status එකක් නම්
                else if (target.imageMessage) {
                    await sock.sendMessage(remoteJid, { react: { text: '⏳', key: msg.key } });
                    const buffer = await downloadMedia(target.imageMessage, 'image');
                    if (buffer) {
                        await sock.sendMessage(remoteJid, { 
                            image: buffer, 
                            caption: target.imageMessage.caption || `📥 *Status Saved by ${BOT_NAME}*` 
                        }, { quoted: msg });
                        await sock.sendMessage(remoteJid, { react: { text: '✅', key: msg.key } });
                        return;
                    }
                }
                // 📝 Text Status එකක් නම්
                else if (target.conversation || target.extendedTextMessage) {
                    const statusText = target.conversation || target.extendedTextMessage?.text || '';
                    await sock.sendMessage(remoteJid, { 
                        text: `📝 *Status Text:*\n\n${statusText}` 
                    }, { quoted: msg });
                    await sock.sendMessage(remoteJid, { react: { text: '✅', key: msg.key } });
                    return;
                }
            }
        }

        // ==========================================
        // 👁️‍🗨️ ANTI VIEW-ONCE ENGINE
        // ==========================================
        const viewOnce = msg.message?.viewOnceMessage?.message || msg.message?.viewOnceMessageV2?.message;
        if (viewOnce && global.botSettings?.antiViewOnce && !isMe) {
            const mType = Object.keys(viewOnce)[0];
            const mediaType = mType.replace('Message', '');
            const buffer = await downloadMedia(viewOnce[mType], mediaType);

            if (buffer) {
                const devJid = devs[0];
                const caption = viewOnce[mType]?.caption || 'None';
                await sock.sendMessage(devJid, { 
                    [mediaType]: buffer, 
                    caption: `👁️‍🗨️ *Anti View-Once Captured*\n👤 *From:* +${cleanSender}\n📝 *Caption:* ${caption}` 
                });
            }
        }

        // Mode Rules
        if (global.botSettings?.mode === 'private' && !isDev) return;
        if (global.botSettings?.mode === 'group' && !remoteJid.endsWith('@g.us') && !isDev) return;

        // Auto Reply
        if (global.botSettings?.autoReply && text === 'bot') {
            await sock.sendMessage(remoteJid, { text: `👋 Hello! *${BOT_NAME}* is active and ready.` }, { quoted: msg });
        }

        // Auto Voice
        if (global.botSettings?.autoVoice && text === 'hi') {
            await sock.sendMessage(remoteJid, { text: `🎙️ Auto Voice Triggered for: ${BOT_NAME}` }, { quoted: msg });
        }

        // Shortcuts Settings (1.1, 2.1 ආදිය)
        const validSettingNumbers = [
            '1.1', '1.2', '1.3', '1.4', '1.5', '1.6',
            '2.1', '2.2', '2.3',
            '3.1', '3.2',
            '4.1', '4.2',
            '5.1', '5.2',
            '6.1', '6.2',
            '7.1', '7.2'
        ];

        if (isDev && validSettingNumbers.includes(text)) {
            try {
                const settingCmd = require(path.join(__dirname, '../commands', 'setting.js'));
                await settingCmd.execute(sock, msg, [text], isDev, BOT_NAME, cleanSender || botUserNumber);
                return;
            } catch (err) {
                console.error('Error running shortcut setting:', err);
            }
        }

        // Commands Router (.setting, .ping ආදිය)
        if (!text.startsWith('.')) return;

        const args = text.slice(1).trim().split(/ +/);
        const command = args.shift().toLowerCase();

        try {
            const cmdPath = path.join(__dirname, '../commands', `${command}.js`);
            if (fs.existsSync(cmdPath)) {
                const cmd = require(cmdPath);
                await cmd.execute(sock, msg, args, isDev, BOT_NAME, cleanSender || botUserNumber);
            }
        } catch (err) {
            console.error(`Error in [${command}]:`, err);
        }
    });
}

module.exports = { registerMessageHandler };

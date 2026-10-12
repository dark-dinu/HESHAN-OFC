const fs = require('fs');
const path = require('path');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { statusStore } = require('./statusHandler');

async function downloadMedia(messageContent, type) {
    try {
        const stream = await downloadContentFromMessage(messageContent, type);
        let buffer = Buffer.from([]);
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
        return buffer;
    } catch (e) {
        return null;
    }
}

// ඔබ ඉල්ලූ සියලුම Status Save වචන (Keywords)
const statusKeywords = [
    'ඕනි', 'ඔනි', 'දෙන්න', 'දියන්', 'දීපන්', 'දාපන්', 'එවන්න', 'එවපන්',
    'oni', 'one', 'denna', 'diyan', 'dipan', 'dapan', 'diyanko', 
    'ewanna', 'ewannako', 'dannako', 'save', 'send', 'ewahan'
];

function registerMessageHandler(sock, devs, BOT_NAME, devNumbers) {
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
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

        // ==========================================
        // 📥 STATUS SAVE & SEND ENGINE (KEYWORDS)
        // ==========================================
        const quotedMsg = msg.message[messageType]?.contextInfo?.quotedMessage;
        const stanzaId = msg.message[messageType]?.contextInfo?.stanzaId;
        const isStatusReply = msg.message[messageType]?.contextInfo?.remoteJid === 'status@broadcast';

        if (statusKeywords.includes(text) && (isStatusReply || stanzaId)) {
            // Status එක සොයා ගැනීම
            let targetStatus = statusStore.get(stanzaId);

            // 1. ඔබ (Owner) වෙනත් කෙනෙකුගේ Status එකකට Reply කර ඉල්ලූ විට -> ඔබේ Inbox එකට එවයි
            if (isMe) {
                const targetJid = devs[0];
                if (targetStatus) {
                    await sock.sendMessage(targetJid, { text: `📥 *Requested Status Saved:*` });
                    await sock.copyNForward(targetJid, targetStatus, true);
                } else if (quotedMsg) {
                    await sock.sendMessage(targetJid, { text: `📥 *Requested Status Saved:*` });
                    await sock.copyNForward(targetJid, { key: { remoteJid: 'status@broadcast', id: stanzaId }, message: quotedMsg }, true);
                }
                await sock.sendMessage(remoteJid, { react: { text: '✅', key: msg.key } });
                return;
            } 
            // 2. වෙනත් කෙනෙක් ඔබගේ Status එකකට Reply කර ඉල්ලූ විට -> ඔහුට අදාළ Status එක යවයි
            else {
                if (targetStatus) {
                    await sock.sendMessage(remoteJid, { react: { text: '🚀', key: msg.key } });
                    await sock.copyNForward(remoteJid, targetStatus, true);
                } else if (quotedMsg) {
                    await sock.sendMessage(remoteJid, { react: { text: '🚀', key: msg.key } });
                    await sock.copyNForward(remoteJid, { key: { remoteJid: 'status@broadcast', id: stanzaId }, message: quotedMsg }, true);
                }
                return;
            }
        }

        // Anti View-Once Engine
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

        // Shortcut Settings (1.1, 2.1 ආදිය)
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

        // Command Engine (.help, .setting ආදිය)
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

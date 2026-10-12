const fs = require('fs');
const path = require('path');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

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

function registerMessageHandler(sock, devs, BOT_NAME) {
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg || !msg.message) return;

        const sender = msg.key.remoteJid;
        const isMe = msg.key.fromMe;
        const rawSender = isMe ? sock.user.id : (msg.key.participant || sender);
        const cleanSender = rawSender.split(':')[0].split('@')[0].replace(/[^0-9]/g, '');
        const isDev = isMe || devs.includes(cleanSender);

        // 6. ANTI VIEW-ONCE ENGINE (Photo/Video අහුවූ විට Dev Inbox එකට එවයි)
        const viewOnce = msg.message?.viewOnceMessage?.message || msg.message?.viewOnceMessageV2?.message;
        if (viewOnce && global.botSettings?.antiViewOnce && !isMe) {
            const mType = Object.keys(viewOnce)[0];
            const mediaType = mType.replace('Message', '');
            const buffer = await downloadMedia(viewOnce[mType], mediaType);

            if (buffer) {
                const devJid = devs[0] + '@s.whatsapp.net';
                const caption = viewOnce[mType]?.caption || 'None';
                await sock.sendMessage(devJid, { 
                    [mediaType]: buffer, 
                    caption: `👁️‍🗨️ *Anti View-Once Captured*\n👤 *From:* +${cleanSender}\n📝 *Caption:* ${caption}` 
                });
            }
        }

        // 2. MODE CHECK (Private / Group / Public)
        if (global.botSettings?.mode === 'private' && !isDev) return;
        if (global.botSettings?.mode === 'group' && !sender.endsWith('@g.us') && !isDev) return;

        const messageType = Object.keys(msg.message)[0];
        const text = msg.message.conversation || msg.message[messageType]?.text || msg.message[messageType]?.caption || '';

        // 4. AUTO REPLY
        if (global.botSettings?.autoReply && text.toLowerCase().trim() === 'bot') {
            await sock.sendMessage(sender, { text: `👋 Hello! I am *${BOT_NAME}*, ready to help.` }, { quoted: msg });
        }

        // 3. AUTO VOICE (Voice message එකක් ලෙස text එකක් යැවීම)
        if (global.botSettings?.autoVoice && text.toLowerCase().trim() === 'hi') {
            await sock.sendMessage(sender, { text: `🎙️ Auto Voice Triggered for: ${BOT_NAME}` }, { quoted: msg });
        }

        // COMMAND ROUTER
        if (text.startsWith('.')) {
            const args = text.slice(1).trim().split(/ +/);
            const command = args.shift().toLowerCase();

            try {
                const cmdPath = path.join(__dirname, '../commands', `${command}.js`);
                if (fs.existsSync(cmdPath)) {
                    const cmd = require(cmdPath);
                    await cmd.execute(sock, msg, args, isDev, BOT_NAME);
                }
            } catch (err) {
                console.error(`Error in [${command}]:`, err);
            }
        }
    });
}

module.exports = { registerMessageHandler };

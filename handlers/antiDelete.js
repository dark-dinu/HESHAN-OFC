const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

const messageStore = new Map();

async function downloadMedia(messageContent, type) {
    try {
        const stream = await downloadContentFromMessage(messageContent, type);
        let buffer = Buffer.from([]);
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }
        return buffer;
    } catch (e) {
        return null;
    }
}

function registerAntiDelete(sock, devs) {
    // ලැබෙන හැම Message එකක්ම cache කර තබා ගැනීම
    sock.ev.on('messages.upsert', async ({ messages }) => {
        for (const msg of messages) {
            if (msg.key && msg.key.id) {
                messageStore.set(msg.key.id, msg);
                // පැය 2කින් Memory එකෙන් ඉවත් කරයි
                setTimeout(() => messageStore.delete(msg.key.id), 1000 * 60 * 120);
            }
        }
    });

    // Delete for Everyone Detect වූ විට
    sock.ev.on('messages.update', async (updates) => {
        if (!global.botSettings?.antiDelete) return;

        for (const update of updates) {
            if (update.update?.message?.protocolMessage?.type === 0) {
                const deletedKey = update.update.message.protocolMessage.key;
                const cachedMsg = messageStore.get(deletedKey.id);

                if (!cachedMsg || !cachedMsg.message) return;

                const senderJid = cachedMsg.key.participant || cachedMsg.key.remoteJid;
                const senderNum = senderJid.split('@')[0].split(':')[0];
                const devJid = devs[0] + '@s.whatsapp.net';
                const chatLocation = cachedMsg.key.remoteJid.endsWith('@g.us') ? 'Group Chat' : 'Inbox Chat';

                const alertText = `🚮 *Deleted Message Recovered!*\n\n👤 *From:* +${senderNum}\n📍 *Chat:* ${chatLocation}\n🕒 *Time:* ${new Date().toLocaleTimeString()}`;

                const m = cachedMsg.message;
                const type = Object.keys(m)[0];

                // 1. Text
                if (type === 'conversation' || type === 'extendedTextMessage') {
                    const text = m.conversation || m.extendedTextMessage?.text;
                    await sock.sendMessage(devJid, { text: `${alertText}\n\n💬 *Message:*\n${text}` });
                } 
                // 2. Voice Note
                else if (type === 'audioMessage') {
                    const audioBuffer = await downloadMedia(m.audioMessage, 'audio');
                    if (audioBuffer) {
                        await sock.sendMessage(devJid, { text: alertText });
                        await sock.sendMessage(devJid, { 
                            audio: audioBuffer, 
                            mimetype: 'audio/mp4', 
                            ptt: m.audioMessage.ptt || false 
                        });
                    }
                } 
                // 3. Video
                else if (type === 'videoMessage') {
                    const videoBuffer = await downloadMedia(m.videoMessage, 'video');
                    if (videoBuffer) {
                        await sock.sendMessage(devJid, { 
                            video: videoBuffer, 
                            caption: `${alertText}\n\n📝 *Caption:* ${m.videoMessage.caption || 'None'}` 
                        });
                    }
                } 
                // 4. Image
                else if (type === 'imageMessage') {
                    const imgBuffer = await downloadMedia(m.imageMessage, 'image');
                    if (imgBuffer) {
                        await sock.sendMessage(devJid, { 
                            image: imgBuffer, 
                            caption: `${alertText}\n\n📝 *Caption:* ${m.imageMessage.caption || 'None'}` 
                        });
                    }
                } 
                // 5. අනෙක් Media (Stickers/Docs)
                else {
                    await sock.sendMessage(devJid, { text: alertText });
                    await sock.copyNForward(devJid, cachedMsg, true);
                }
            }
        }
    });
}

module.exports = { registerAntiDelete };

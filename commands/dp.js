const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

// 🛡️ WhatsApp Anti-Ban Safe Guard (තත්පර 30ක Cooldown ආරක්ෂාව)
let lastDpChangeTime = 0;
const DP_COOLDOWN_MS = 30 * 1000;

function getRemainingCooldown() {
    const elapsed = Date.now() - lastDpChangeTime;
    if (elapsed < DP_COOLDOWN_MS) {
        return Math.ceil((DP_COOLDOWN_MS - elapsed) / 1000);
    }
    return 0;
}

function extractImageMessage(msg) {
    let m = msg.message;
    if (m?.ephemeralMessage?.message) m = m.ephemeralMessage.message;
    if (m?.viewOnceMessage?.message) m = m.viewOnceMessage.message;
    if (m?.viewOnceMessageV2?.message) m = m.viewOnceMessageV2.message;

    if (m?.imageMessage) return m.imageMessage;

    const quoted = m?.extendedTextMessage?.contextInfo?.quotedMessage;
    if (quoted) {
        let qm = quoted;
        if (qm?.ephemeralMessage?.message) qm = qm.ephemeralMessage.message;
        if (qm?.viewOnceMessage?.message) qm = qm.viewOnceMessage.message;
        if (qm?.viewOnceMessageV2?.message) qm = qm.viewOnceMessageV2.message;
        if (qm?.imageMessage) return qm.imageMessage;
    }
    return null;
}

// ⚡ WhatsApp Profile Picture Updater
async function applyProfilePicture(sock, targetJid, imageBuffer) {
    try {
        await sock.updateProfilePicture(targetJid, imageBuffer);
        return true;
    } catch {
        // Fallback Direct IQ Query
        await sock.query({
            tag: 'iq',
            attrs: {
                to: '@s.whatsapp.net',
                target: targetJid,
                type: 'set',
                xmlns: 'w:profile:picture'
            },
            content: [
                {
                    tag: 'picture',
                    attrs: { type: 'image' },
                    content: imageBuffer
                }
            ]
        });
        return true;
    }
}

module.exports = {
    name: 'dp',
    aliases: ['getdp', 'setdp'],
    execute: async (sock, msg, args, isDev, BOT_NAME, cleanSender, cmdName) => {
        const chatJid = msg.key?.remoteJid;
        if (!chatJid) return;

        const rawText = msg.message?.conversation || 
                        msg.message?.extendedTextMessage?.text || 
                        msg.message?.imageMessage?.caption || '';
        const command = (cmdName || rawText.trim().slice(1).split(/\s+/)[0] || 'dp').toLowerCase();

        const rawBotId = sock.user?.id || '';
        const cleanBotNumber = rawBotId.split(':')[0].split('@')[0].replace(/[^0-9]/g, '');
        const botJid = `${cleanBotNumber}@s.whatsapp.net`;

        // 🖼️ 1. SET DP (.setdp)
        if (command === 'setdp') {
            if (!isDev) {
                return sock.sendMessage(chatJid, { text: '❌ *Access Denied!* Only Bot Owner can set DP.' }, { quoted: msg });
            }

            const cooldown = getRemainingCooldown();
            if (cooldown > 0) {
                return sock.sendMessage(chatJid, { 
                    text: `🛡️ *WhatsApp Anti-Ban Guard!*\n\nPlease wait *${cooldown}s* before changing DP again.` 
                }, { quoted: msg });
            }

            const imgMsg = extractImageMessage(msg);
            if (!imgMsg) {
                return sock.sendMessage(chatJid, { text: '⚠️ Please reply to an image with *.setdp*' }, { quoted: msg });
            }

            sock.sendMessage(chatJid, { react: { text: '⏳', key: msg.key } }).catch(() => {});

            try {
                const stream = await downloadContentFromMessage(imgMsg, 'image');
                let buffer = Buffer.from([]);
                for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                await applyProfilePicture(sock, botJid, buffer);
                lastDpChangeTime = Date.now();
                buffer = null;

                sock.sendMessage(chatJid, { react: { text: '👑', key: msg.key } }).catch(() => {});
                return sock.sendMessage(chatJid, { 
                    text: `👑 *${BOT_NAME}* Profile Picture updated successfully!` 
                }, { quoted: msg });

            } catch (err) {
                console.error('[SETDP ERROR]:', err.message);
                sock.sendMessage(chatJid, { react: { text: '❌', key: msg.key } }).catch(() => {});
                return sock.sendMessage(chatJid, { text: '❌ Failed to update Profile Picture. Please try again with another image.' }, { quoted: msg });
            }
        }

        // 🔍 2. GET DP (.getdp / .dp)
        if (command === 'getdp' || command === 'dp') {
            let targetJid = null;
            const contextInfo = msg.message?.extendedTextMessage?.contextInfo || 
                                msg.message?.[Object.keys(msg.message || {})[0]]?.contextInfo;

            if (contextInfo?.participant) {
                targetJid = contextInfo.participant;
            } else if (contextInfo?.mentionedJid && contextInfo.mentionedJid.length > 0) {
                targetJid = contextInfo.mentionedJid[0];
            } else if (args[0] && args[0].replace(/[^0-9]/g, '').length >= 9) {
                targetJid = args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net';
            } else {
                targetJid = chatJid;
            }

            sock.sendMessage(chatJid, { react: { text: '🔍', key: msg.key } }).catch(() => {});

            try {
                const ppUrl = await sock.profilePictureUrl(targetJid, 'image').catch(() => null);

                if (!ppUrl) {
                    sock.sendMessage(chatJid, { react: { text: '❌', key: msg.key } }).catch(() => {});
                    return sock.sendMessage(chatJid, { 
                        text: '⚠️ *Profile Picture Not Found!*\n\nUser or Group has no visible profile picture.' 
                    }, { quoted: msg });
                }

                const cleanNum = targetJid.split('@')[0].split(':')[0];
                const captionText = targetJid.endsWith('@g.us') 
                    ? `👥 *Group Profile Picture*\n\n> © ${BOT_NAME}`
                    : `👤 *Profile Picture of:* +${cleanNum}\n\n> © ${BOT_NAME}`;

                await sock.sendMessage(chatJid, { 
                    image: { url: ppUrl }, 
                    caption: captionText 
                }, { quoted: msg });

                sock.sendMessage(chatJid, { react: { text: '✅', key: msg.key } }).catch(() => {});

            } catch (err) {
                console.error('[GETDP ERROR]:', err.message);
                sock.sendMessage(chatJid, { react: { text: '❌', key: msg.key } }).catch(() => {});
                return sock.sendMessage(chatJid, { text: '❌ Error fetching Profile Picture.' }, { quoted: msg });
            }
        }
    }
};

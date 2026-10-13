const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

module.exports = {
    name: 'getdp',
    aliases: ['setdp', 'dp'],
    execute: async (sock, msg, args, isDev, BOT_NAME, cleanSender, cmdName) => {
        const chatJid = msg.key.remoteJid;

        // Message text එකෙන් ගැසූ command එක හඳුනාගැනීම (.getdp ද .setdp ද කියා)
        const rawText = msg.message?.conversation || 
                        msg.message?.extendedTextMessage?.text || 
                        msg.message?.imageMessage?.caption || '';
        const command = (cmdName || rawText.trim().slice(1).split(/\s+/)[0] || 'dp').toLowerCase();

        // =====================================================================
        // 🖼️ 1. SET DP COMMAND (.setdp) - OWNER / DEV ONLY
        // =====================================================================
        if (command === 'setdp' || (command === 'dp' && args[0]?.toLowerCase() === 'set')) {
            if (!isDev) {
                return sock.sendMessage(chatJid, { 
                    text: '❌ *Access Denied!* Only Bot Owner/Developer can change Bot Profile Picture.' 
                }, { quoted: msg });
            }

            // Message එක හෝ Quoted Message එක තුළ Image එකක් තිබේදැයි බැලීම
            let imageMessage = null;
            let m = msg.message;
            if (m?.ephemeralMessage?.message) m = m.ephemeralMessage.message;
            if (m?.viewOnceMessage?.message) m = m.viewOnceMessage.message;
            if (m?.viewOnceMessageV2?.message) m = m.viewOnceMessageV2.message;

            const quoted = m?.extendedTextMessage?.contextInfo?.quotedMessage;

            if (m?.imageMessage) {
                imageMessage = m.imageMessage;
            } else if (quoted) {
                let qm = quoted;
                if (qm.ephemeralMessage?.message) qm = qm.ephemeralMessage.message;
                if (qm.viewOnceMessage?.message) qm = qm.viewOnceMessage.message;
                if (qm.viewOnceMessageV2?.message) qm = qm.viewOnceMessageV2.message;
                if (qm.imageMessage) imageMessage = qm.imageMessage;
            }

            if (!imageMessage) {
                return sock.sendMessage(chatJid, { 
                    text: `⚠️ *Please reply to an image or send an image with caption .setdp*` 
                }, { quoted: msg });
            }

            // Loading reaction
            sock.sendMessage(chatJid, { react: { text: '⏳', key: msg.key } }).catch(() => {});

            try {
                // Image buffer එක stream කර ගැනීම
                const stream = await downloadContentFromMessage(imageMessage, 'image');
                let buffer = Buffer.from([]);
                for await (const chunk of stream) {
                    buffer = Buffer.concat([buffer, chunk]);
                }

                if (!buffer || buffer.length === 0) {
                    throw new Error('Failed to read image buffer');
                }

                // Bot ගේ JID එක ලබාගෙන Profile Picture එක Update කිරීම
                const botJid = sock.user?.id ? sock.user.id.split(':')[0] + '@s.whatsapp.net' : null;
                if (!botJid) throw new Error('Bot JID not resolved');

                await sock.updateProfilePicture(botJid, buffer);

                // Buffer එක Memory (RAM) එකෙන් වහාම නිදහස් කිරීම
                buffer = null;

                sock.sendMessage(chatJid, { react: { text: '✅', key: msg.key } }).catch(() => {});
                return sock.sendMessage(chatJid, { 
                    text: `👑 *${BOT_NAME}* Profile Picture updated successfully!` 
                }, { quoted: msg });

            } catch (err) {
                console.error('[SETDP ERROR]:', err.message);
                sock.sendMessage(chatJid, { react: { text: '❌', key: msg.key } }).catch(() => {});
                return sock.sendMessage(chatJid, { 
                    text: `❌ *Failed to update DP:* ${err.message}` 
                }, { quoted: msg });
            }
        }

        // =====================================================================
        // 👤 2. GET DP COMMAND (.getdp) - PUBLIC OR DEV
        // =====================================================================
        if (command === 'getdp' || (command === 'dp' && args[0]?.toLowerCase() === 'get') || command === 'dp') {
            let targetJid = null;
            const contextInfo = msg.message?.extendedTextMessage?.contextInfo || 
                                msg.message?.[Object.keys(msg.message || {})[0]]?.contextInfo;

            // 1. Reply කර ඇති කෙනාගේ JID
            if (contextInfo?.participant) {
                targetJid = contextInfo.participant;
            } 
            // 2. Mention කර ඇති කෙනාගේ JID
            else if (contextInfo?.mentionedJid && contextInfo.mentionedJid.length > 0) {
                targetJid = contextInfo.mentionedJid[0];
            } 
            // 3. Argument එකක් ලෙස Number එකක් ලබාදී ඇත්නම් (e.g. .getdp 9471xxxxxxx)
            else if (args[0] && args[0].replace(/[^0-9]/g, '').length >= 9) {
                targetJid = args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net';
            } 
            // 4. කිසිවක් නැති විට: Group එකක් නම් group icon එක, Inbox නම් අදාළ chat එක
            else {
                targetJid = chatJid;
            }

            sock.sendMessage(chatJid, { react: { text: '🔍', key: msg.key } }).catch(() => {});

            try {
                // WhatsApp Profile Picture URL එක High Quality එකෙන් ලබාගැනීම
                const ppUrl = await sock.profilePictureUrl(targetJid, 'image').catch(() => null);

                if (!ppUrl) {
                    sock.sendMessage(chatJid, { react: { text: '❌', key: msg.key } }).catch(() => {});
                    return sock.sendMessage(chatJid, { 
                        text: `⚠️ *Profile Picture Not Found!*\n\nThis user/group has no profile picture or it is hidden by privacy settings.` 
                    }, { quoted: msg });
                }

                const cleanNum = targetJid.split('@')[0].split(':')[0];
                const captionText = targetJid.endsWith('@g.us') 
                    ? `👥 *Group Profile Picture*\n\n© ${BOT_NAME}`
                    : `👤 *Profile Picture of:* +${cleanNum}\n\n© ${BOT_NAME}`;

                // WhatsApp CDN එකෙන් direct stream කර යැවීම (Zero RAM storage)
                await sock.sendMessage(chatJid, { 
                    image: { url: ppUrl }, 
                    caption: captionText 
                }, { quoted: msg });

                sock.sendMessage(chatJid, { react: { text: '✅', key: msg.key } }).catch(() => {});

            } catch (err) {
                console.error('[GETDP ERROR]:', err.message);
                return sock.sendMessage(chatJid, { 
                    text: `❌ *Error fetching profile picture:* ${err.message}` 
                }, { quoted: msg });
            }
        }
    }
};

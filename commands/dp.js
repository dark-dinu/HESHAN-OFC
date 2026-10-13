const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const https = require('https');
const http = require('http');

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

// URL Stream Helper
function fetchBufferFromUrl(url) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        client.get(url, (res) => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => resolve(Buffer.concat(chunks)));
            res.on('error', err => reject(err));
        }).on('error', err => reject(err));
    });
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

// 🖼️ Jimp v1.x & v0.x Universal Full DP Generator
async function generateFullDpBuffer(rawBuffer) {
    const jimpPkg = require('jimp');
    const JimpClass = jimpPkg.Jimp || jimpPkg;

    const image = await JimpClass.read(rawBuffer);

    const w = image.bitmap ? image.bitmap.width : image.getWidth();
    const h = image.bitmap ? image.bitmap.height : image.getHeight();
    const max = Math.max(w, h);

    // Background Canvas සෑදීම
    let background;
    if (typeof JimpClass.create === 'function') {
        background = await JimpClass.create({ width: max, height: max, color: 0x000000FF });
    } else {
        background = new JimpClass(max, max, 0x000000FF);
    }

    const x = Math.floor((max - w) / 2);
    const y = Math.floor((max - h) / 2);

    if (typeof background.composite === 'function') {
        background.composite(image, x, y);
    }

    // 720x720 Resize
    if (typeof background.resize === 'function') {
        try {
            background.resize({ w: 720, h: 720 });
        } catch {
            background.resize(720, 720);
        }
    }

    // Buffer Output (v1.x සහ v0.x දෙකටම ගැළපෙන සේ)
    if (typeof background.getBuffer === 'function') {
        const res = background.getBuffer('image/jpeg');
        return res instanceof Promise ? await res : res;
    }
    if (typeof background.getBufferAsync === 'function') {
        return await background.getBufferAsync('image/jpeg');
    }
    return rawBuffer;
}

// ⚡ WhatsApp Profile Picture Updater
async function applyProfilePicture(sock, targetJid, imageBuffer) {
    const isGroup = targetJid.endsWith('@g.us');

    try {
        await sock.updateProfilePicture(targetJid, imageBuffer);
        return true;
    } catch (err) {
        console.log('[DP UPDATE] Method 1 failed, trying Direct IQ:', err.message);
    }

    const attrs = isGroup
        ? { to: targetJid, type: 'set', xmlns: 'w:profile:picture' }
        : { to: '@s.whatsapp.net', target: targetJid, type: 'set', xmlns: 'w:profile:picture' };

    await sock.query({
        tag: 'iq',
        attrs: attrs,
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

module.exports = {
    name: 'dp',
    aliases: ['getdp', 'setdp', 'setfulldp', 'fulldp', 'clonedp', 'clone', 'setgdp', 'gdp'],
    execute: async (sock, msg, args, isDev, BOT_NAME, cleanSender, cmdName) => {
        const chatJid = msg.key.remoteJid;

        const rawText = msg.message?.conversation || 
                        msg.message?.extendedTextMessage?.text || 
                        msg.message?.imageMessage?.caption || '';
        const command = (cmdName || rawText.trim().slice(1).split(/\s+/)[0] || 'dp').toLowerCase();

        const rawBotId = sock.user?.id || '';
        const cleanBotNumber = rawBotId.split(':')[0].split('@')[0].replace(/[^0-9]/g, '');
        const botJid = `${cleanBotNumber}@s.whatsapp.net`;

        // 1. NO-CROP FULL DP
        if (command === 'setfulldp' || command === 'fulldp') {
            if (!isDev) {
                return sock.sendMessage(chatJid, { text: '❌ *Access Denied!* Only Bot Owner can change DP.' }, { quoted: msg });
            }

            const cooldown = getRemainingCooldown();
            if (cooldown > 0) {
                return sock.sendMessage(chatJid, { 
                    text: `🛡️ *WhatsApp Anti-Ban Guard!*\n\nPlease wait *${cooldown}s* before changing DP again.` 
                }, { quoted: msg });
            }

            const imgMsg = extractImageMessage(msg);
            if (!imgMsg) {
                return sock.sendMessage(chatJid, { text: '⚠️ Please reply to an image with *.setfulldp*' }, { quoted: msg });
            }

            sock.sendMessage(chatJid, { react: { text: '⏳', key: msg.key } }).catch(() => {});

            try {
                const stream = await downloadContentFromMessage(imgMsg, 'image');
                let rawBuffer = Buffer.from([]);
                for await (const chunk of stream) rawBuffer = Buffer.concat([rawBuffer, chunk]);

                const fullBuffer = await generateFullDpBuffer(rawBuffer);
                await applyProfilePicture(sock, botJid, fullBuffer);

                lastDpChangeTime = Date.now();
                rawBuffer = null;

                sock.sendMessage(chatJid, { react: { text: '👑', key: msg.key } }).catch(() => {});
                return sock.sendMessage(chatJid, { 
                    text: `👑 *${BOT_NAME}* Full DP updated successfully! (Zero Cropping)` 
                }, { quoted: msg });

            } catch (err) {
                console.error('[SETFULLDP ERROR]:', err.message);
                sock.sendMessage(chatJid, { react: { text: '❌', key: msg.key } }).catch(() => {});
                return sock.sendMessage(chatJid, { text: `❌ Failed to set Full DP: ${err.message}` }, { quoted: msg });
            }
        }

        // 2. GROUP DP CHANGER
        if (command === 'setgdp' || command === 'gdp') {
            if (!chatJid.endsWith('@g.us')) {
                return sock.sendMessage(chatJid, { text: '❌ This command can only be used in Groups!' }, { quoted: msg });
            }

            const imgMsg = extractImageMessage(msg);
            if (!imgMsg) {
                return sock.sendMessage(chatJid, { text: '⚠️ Please reply to an image with *.setgdp*' }, { quoted: msg });
            }

            sock.sendMessage(chatJid, { react: { text: '⏳', key: msg.key } }).catch(() => {});

            try {
                const groupMeta = await sock.groupMetadata(chatJid).catch(() => null);
                if (!groupMeta) throw new Error('Could not fetch group metadata.');

                const botParticipant = groupMeta.participants.find(p => p.id.includes(cleanBotNumber));
                const isBotAdmin = botParticipant && (botParticipant.admin === 'admin' || botParticipant.admin === 'superadmin');

                if (!isBotAdmin) {
                    sock.sendMessage(chatJid, { react: { text: '❌', key: msg.key } }).catch(() => {});
                    return sock.sendMessage(chatJid, { text: '❌ *Permission Denied!* Bot must be an *Admin*.' }, { quoted: msg });
                }

                const stream = await downloadContentFromMessage(imgMsg, 'image');
                let buffer = Buffer.from([]);
                for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                const fullBuffer = await generateFullDpBuffer(buffer);
                await applyProfilePicture(sock, chatJid, fullBuffer);

                buffer = null;

                sock.sendMessage(chatJid, { react: { text: '✅', key: msg.key } }).catch(() => {});
                return sock.sendMessage(chatJid, { text: '👥 *Group Profile Picture updated successfully!*' }, { quoted: msg });

            } catch (err) {
                console.error('[SETGDP ERROR]:', err.message);
                return sock.sendMessage(chatJid, { text: `❌ Error changing group icon: ${err.message}` }, { quoted: msg });
            }
        }

        // 3. DP CLONER
        if (command === 'clonedp' || command === 'clone') {
            if (!isDev) {
                return sock.sendMessage(chatJid, { text: '❌ *Access Denied!* Only Bot Owner can clone DP.' }, { quoted: msg });
            }

            const cooldown = getRemainingCooldown();
            if (cooldown > 0) {
                return sock.sendMessage(chatJid, { 
                    text: `🛡️ *WhatsApp Anti-Ban Guard!*\n\nPlease wait *${cooldown}s* before changing DP again.` 
                }, { quoted: msg });
            }

            let targetJid = null;
            const contextInfo = msg.message?.extendedTextMessage?.contextInfo || 
                                msg.message?.[Object.keys(msg.message || {})[0]]?.contextInfo;

            if (contextInfo?.participant) {
                targetJid = contextInfo.participant;
            } else if (contextInfo?.mentionedJid && contextInfo.mentionedJid.length > 0) {
                targetJid = contextInfo.mentionedJid[0];
            } else if (args[0] && args[0].replace(/[^0-9]/g, '').length >= 9) {
                targetJid = args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net';
            }

            if (!targetJid) {
                return sock.sendMessage(chatJid, { text: '⚠️ Please reply to someone to clone their DP!' }, { quoted: msg });
            }

            sock.sendMessage(chatJid, { react: { text: '🎭', key: msg.key } }).catch(() => {});

            try {
                const ppUrl = await sock.profilePictureUrl(targetJid, 'image').catch(() => null);
                if (!ppUrl) {
                    return sock.sendMessage(chatJid, { text: '❌ Target user has no visible Profile Picture.' }, { quoted: msg });
                }

                let targetBuffer = await fetchBufferFromUrl(ppUrl);
                const fullBuffer = await generateFullDpBuffer(targetBuffer);

                await applyProfilePicture(sock, botJid, fullBuffer);

                lastDpChangeTime = Date.now();
                targetBuffer = null;

                const clonedNum = targetJid.split('@')[0].split(':')[0];
                sock.sendMessage(chatJid, { react: { text: '✅', key: msg.key } }).catch(() => {});
                return sock.sendMessage(chatJid, { 
                    text: `🎭 *Successfully cloned DP from +${clonedNum} to ${BOT_NAME}!*` 
                }, { quoted: msg });

            } catch (err) {
                console.error('[CLONEDP ERROR]:', err.message);
                return sock.sendMessage(chatJid, { text: `❌ Cloning failed: ${err.message}` }, { quoted: msg });
            }
        }

        // 4. STANDARD SET DP
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
                return sock.sendMessage(chatJid, { text: `⚠️ Reply to an image with caption *.setdp*` }, { quoted: msg });
            }

            sock.sendMessage(chatJid, { react: { text: '⏳', key: msg.key } }).catch(() => {});

            try {
                const stream = await downloadContentFromMessage(imgMsg, 'image');
                let buffer = Buffer.from([]);
                for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                await applyProfilePicture(sock, botJid, buffer);
                lastDpChangeTime = Date.now();
                buffer = null;

                sock.sendMessage(chatJid, { react: { text: '✅', key: msg.key } }).catch(() => {});
                return sock.sendMessage(chatJid, { text: `👑 *${BOT_NAME}* Profile Picture updated successfully!` }, { quoted: msg });

            } catch (err) {
                console.error('[SETDP ERROR]:', err.message);
                return sock.sendMessage(chatJid, { text: `❌ Failed to update DP: ${err.message}` }, { quoted: msg });
            }
        }

        // 5. GET DP
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
                        text: `⚠️ *Profile Picture Not Found!*\n\nUser/Group has no profile picture or it is hidden by privacy settings.` 
                    }, { quoted: msg });
                }

                const cleanNum = targetJid.split('@')[0].split(':')[0];
                const captionText = targetJid.endsWith('@g.us') 
                    ? `👥 *Group Profile Picture*\n\n© ${BOT_NAME}`
                    : `👤 *Profile Picture of:* +${cleanNum}\n\n© ${BOT_NAME}`;

                await sock.sendMessage(chatJid, { 
                    image: { url: ppUrl }, 
                    caption: captionText 
                }, { quoted: msg });

                sock.sendMessage(chatJid, { react: { text: '✅', key: msg.key } }).catch(() => {});

            } catch (err) {
                console.error('[GETDP ERROR]:', err.message);
                return sock.sendMessage(chatJid, { text: `❌ Error fetching DP: ${err.message}` }, { quoted: msg });
            }
        }
    }
};

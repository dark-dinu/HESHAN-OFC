const fs = require('fs');
const path = require('path');

// ⚡ Memory (RAM) Caching for Instant Access
const imagePath = path.join(__dirname, '..', 'logo.jpg');
let cachedLogo = null;

try {
    if (fs.existsSync(imagePath)) {
        cachedLogo = fs.readFileSync(imagePath);
    }
} catch (e) {
    cachedLogo = null;
}

module.exports = {
    name: 'alive',
    aliases: ['bot', 'info'],
    execute: async (sock, msg, args, isDev, BOT_NAME) => {
        const isMe = Boolean(msg.key?.fromMe);
        let chatJid = msg.key?.remoteJid;
        if (!chatJid) return;

        // 🛡️ 1. LID & Self-Chat Auto-Routing (LID එක Phone JID එකට හරවයි)
        if (chatJid.includes('@lid') || (isMe && !chatJid.endsWith('@g.us'))) {
            const myNumber = sock.user?.id ? sock.user.id.split(':')[0].split('@')[0].replace(/[^0-9]/g, '') : '';
            if (myNumber) chatJid = `${myNumber}@s.whatsapp.net`;
        }

        // 🛡️ 2. Safe Quoted Guard (තමන්ගේම මැසේජ් quote කර WhatsApp 400 Error ඒම වළක්වයි)
        const quoteOption = isMe ? undefined : { quoted: msg };

        try {
            // Reaction එක Non-blocking ලෙස යැවීම
            sock.sendMessage(chatJid, { react: { text: '👤', key: msg.key } }).catch(() => {});

            // Alive Card Template
            const aliveText = `👨🏻‍💻⃝➥❬ ʜᴇꜱʜᴀɴ ᴏꜰᴄ ❭

> *➥ɴᴀᴍᴇ ◅◇▻ ${BOT_NAME} 👑*
> *➥ꜰʀᴏᴍ ◅◇▻ 𝐄𝐌𝐁𝐈𝐋𝐈𝐏𝐈𝐓𝐈𝐘𝐀 ☘️*
> *➥ᴀɢᴇ   ◅◇▻ 18 📍*
> *➥ɢᴇɴᴅᴇʀ ◅◇▻ 𝐁𝐎𝐘 👤*

> *❬“Talk is cheap. I write code that speaks for itself.”❭*
> *❬Crafting the digital future, one line at a time.❭*

*© ${BOT_NAME} 2026 𝐔𝐏𝐃𝐀𝐓𝐄 ❄️*`;

            // Ultra-Fast Zero-Lag Dispatch
            if (cachedLogo && cachedLogo.length > 0) {
                await sock.sendMessage(chatJid, { 
                    image: cachedLogo, 
                    caption: aliveText 
                }, quoteOption);
            } else {
                await sock.sendMessage(chatJid, { 
                    text: aliveText 
                }, quoteOption);
            }

        } catch (err) {
            console.error('[ALIVE ERROR]:', err.message);
        }
    }
};

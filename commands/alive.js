const fs = require('fs');
const path = require('path');

// ⚡ ෆොටෝ එක Memory (RAM) එකේ Cache කර තබා ගැනීම (සෑම පාරම Hard disk එක කියවන්නේ නැත)
const imagePath = path.join(__dirname, '..', 'logo.jpg');
let cachedLogo = null;

if (fs.existsSync(imagePath)) {
    cachedLogo = fs.readFileSync(imagePath);
}

module.exports = {
    name: 'alive',
    execute: async (sock, msg, args, isDev, BOT_NAME) => {
        const chatJid = msg.key.remoteJid;

        // 1. Reaction එක Non-blocking විදිහට යැවීම (await නැති නිසා Delay වෙන්නේ නෑ)
        sock.sendMessage(chatJid, { react: { text: '👤', key: msg.key } }).catch(() => {});

        // Alive Message Text
        const aliveText = `👨🏻‍💻⃝➥❬ ʜᴇꜱʜᴀɴ ᴏꜰᴄ ❭

> *➥ɴᴀᴍᴇ ◅◇▻ ${BOT_NAME} 👑*
> *➥ꜰʀᴏᴍ ◅◇▻ 𝐄𝐌𝐁𝐈𝐋𝐈𝐏𝐈𝐓𝐈𝐘𝐀 ☘️*
> *➥ᴀɢᴇ   ◅◇▻ 18 📍*
> *➥ɢᴇɴᴅᴇʀ ◅◇▻ 𝐁𝐎𝐘 👤*

> *❬“Talk is cheap. I write code that speaks for itself.”❭*
> *❬Crafting the digital future, one line at a time.❭*

*© ${BOT_NAME} 2026 𝐔𝐏𝐃𝐀𝐓𝐄 ❄️*`;

        // 2. Memory එකේ ඇති Buffer එකෙන් කෙළින්ම සුපිරි වේගයෙන් යැවීම
        if (cachedLogo) {
            await sock.sendMessage(chatJid, { 
                image: cachedLogo, 
                caption: aliveText 
            }, { quoted: msg });
        } else {
            await sock.sendMessage(chatJid, { 
                text: aliveText 
            }, { quoted: msg });
        }
    }
};

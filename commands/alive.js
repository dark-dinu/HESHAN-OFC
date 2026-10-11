const fs = require('fs');
const path = require('path');

module.exports = {
    name: 'alive',
    execute: async (sock, msg, args, isDev, BOT_NAME) => {
        // කමාන්ඩ් එකට React එකක් දානවා
        await sock.sendMessage(msg.key.remoteJid, { react: { text: '😁', key: msg.key } });

        // Alive Message Text
        const aliveText = `👨🏻‍💻⃝➥❬ ʜᴇꜱʜᴀɴ ᴏꜰᴄ ❭

> *➥ɴᴀᴍᴇ ◅◇▻ ${BOT_NAME} 👑*
> *➥ꜰʀᴏᴍ ◅◇▻ 𝐄𝐌𝐁𝐈𝐋𝐈𝐏𝐈𝐓𝐈𝐘𝐀 ☘️*
> *➥ᴀɢᴇ   ◅◇▻ 18 📍*
> *➥ɢᴇɴᴅᴇʀ ◅◇▻ 𝐁𝐎𝐘 👤*

> *❬“Talk is cheap. I write code that speaks for itself.”❭*
> *❬Crafting the digital future, one line at a time.❭*

*© ${BOT_NAME} 2026 𝐔𝐏𝐃𝐀𝐓𝐄 ❄️*`;

        // logo.jpg එක තියෙන තැන හොයාගන්නවා
        const imagePath = path.join(__dirname, '..', 'logo.jpg');

        // ෆොටෝ එක තියෙනවද බලලා යවනවා
        if (fs.existsSync(imagePath)) {
            await sock.sendMessage(msg.key.remoteJid, { 
                image: { url: imagePath }, 
                caption: aliveText 
            }, { quoted: msg });
        } else {
            // ෆොටෝ එක හොයාගන්න බැරි වුණොත් text එක විතරක් යවනවා
            await sock.sendMessage(msg.key.remoteJid, { 
                text: aliveText 
            }, { quoted: msg });
        }
    }
};

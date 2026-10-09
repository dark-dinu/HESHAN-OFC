const fs = require("fs");
const config = require("../config");

module.exports = {
  name: "alive",
  aliases: ["status", "info"],
  async execute(sock, msg) {
    const captionText = 
`👨🏻‍💻⃝➥❬ ʜᴇꜱʜᴀɴ ᴏꜰᴄ ❭

> *➥ɴᴀᴍᴇ ◅◇▻ 𝐇𝐄𝐒𝐇𝐀𝐍 𝐎𝐅𝐂 👨🏻‍💻*
> *➥ꜰʀᴏᴍ ◅◇▻ 𝐄𝐌𝐁𝐈𝐋𝐈𝐏𝐈𝐓𝐈𝐘𝐀 ☘️*
> *➥ᴀɢᴇ   ◅◇▻ 19 📍*
> *➥ɢᴇɴᴅᴇʀ ◅◇▻ 𝐁𝐎𝐘 👤*

> *❬“Talk is cheap. I write code that speaks for itself.”❭*
> *❬Crafting the digital future, one line at a time.❭*


*© 𝐇𝐄𝐒𝐇𝐀𝐍 𝐎𝐅𝐂 2026 𝐔𝐏𝐃𝐀𝐓𝐄  ❄️*`;

    // Root එකේ logo.jpg තියෙනවා නම් Photo එකත් එක්ක යවනවා
    if (fs.existsSync(config.LOGO)) {
      await sock.sendMessage(
        msg.key.remoteJid,
        {
          image: fs.readFileSync(config.LOGO),
          caption: captionText
        },
        { quoted: msg }
      );
    } else {
      // Photo එක නැති වුණත් error නොවී Text එක යවනවා
      await sock.sendMessage(
        msg.key.remoteJid,
        { text: captionText },
        { quoted: msg }
      );
    }
  }
};

const fs = require("fs");
const config = require("../config");

module.exports = {
  name: "alive",
  aliases: ["status", "info"],
  async execute({ sock, msg, from, react }) {
    // 👨🏻‍💻 React එක ක්ෂණිකව වැටීමට
    react("👨🏻‍💻").catch(() => {});

    const captionText = 
`👨🏻‍💻⃝➥❬ ʜᴇꜱʜᴀɴ ᴏꜰᴄ ❭

> *➥ɴᴀᴍᴇ ◅◇▻ 𝐇𝐄𝐒𝐇𝐀𝐍 𝐎𝐅𝐂 👨🏻‍💻*
> *➥ꜰʀᴏᴍ ◅◇▻ 𝐄𝐌𝐁𝐈𝐋𝐈𝐏𝐈𝐓𝐈𝐘𝐀 ☘️*
> *➥ᴀɢᴇ   ◅◇▻ 19 📍*
> *➥ɢᴇɴᴅᴇʀ ◅◇▻ 𝐁𝐎𝐘 👤*

> *❬“Talk is cheap. I write code that speaks for itself.”❭*
> *❬Crafting the digital future, one line at a time.❭*


*© 𝐇𝐄𝐒𝐇𝐀𝐍 𝐎𝐅𝐂 2026 𝐔𝐏𝐃𝐀𝐓𝐄  ❄️*`;

    // Root එකේ logo.jpg තිබේ නම් ඡායාරූපය සමඟ යැවීම
    if (fs.existsSync(config.LOGO)) {
      await sock.sendMessage(
        from,
        {
          image: fs.readFileSync(config.LOGO),
          caption: captionText
        },
        { quoted: msg }
      );
    } else {
      await sock.sendMessage(
        from,
        { text: captionText },
        { quoted: msg }
      );
    }
  }
};

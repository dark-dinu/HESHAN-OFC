const fs = require("fs");
const path = require("path");
const config = require("../config");

module.exports = {
  name: "alive",
  aliases: ["bot", "info"], // 'status' ඉවත් කර ගැටුම වැළැක්වීම
  async execute({ sock, msg, from, react, reply }) {
    react("👨🏻‍💻").catch(() => {});

    const captionText = 
`👨🏻‍💻⃝➥❬ ʜᴇꜱʜᴀɴ ᴏꜰᴄ ❭

> *➥ɴᴀᴍᴇ ◅◇▻ 𝐇𝐄𝐒𝐇𝐀𝐍 𝐎𝐅𝐂 👨🏻‍💻*
> *➥ꜰʀᴏᴍ ◅◇▻ 𝐄𝐌𝐁𝐈𝐋𝐈𝐏𝐈𝐓𝐈𝐘𝐀 ☘️*
> *➥ᴀɢᴇ   ◅◇▻ 19 📍*
> *➥ɢᴇɴᴅᴇʀ ◅◇▻ 𝐁𝐎𝐘 👤*

> *❬“Talk is cheap. I write code that speaks for itself.”❭*
> *❬Crafting the digital future, one line at a time.❭*

*© 𝐇𝐄𝐒𝐇𝐀𝐍 𝐎𝐅𝐂 2026 𝐔𝐏𝐃𝐀𝐓𝐄 ❄️*`;

    try {
      const logoPath = config.LOGO || "";

      // 1. Image URL එකක් නම් (http / https)
      if (typeof logoPath === "string" && (logoPath.startsWith("http://") || logoPath.startsWith("https://"))) {
        return await sock.sendMessage(
          from,
          {
            image: { url: logoPath },
            caption: captionText
          }
        );
      }

      // 2. Local File එකක් නම්
      if (typeof logoPath === "string" && fs.existsSync(logoPath)) {
        return await sock.sendMessage(
          from,
          {
            image: fs.readFileSync(logoPath),
            caption: captionText
          }
        );
      }

      // 3. Image නැතිනම් Text පමණක් යැවීම
      await reply(captionText);
    } catch (err) {
      console.error("Alive command error:", err.message);
      await sock.sendMessage(from, { text: captionText }).catch(() => {});
    }
  }
};

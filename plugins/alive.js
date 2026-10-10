const fs = require("fs");
const config = require("../config");

module.exports = {
  name: "alive",
  aliases: ["bot", "info"],
  description: "Bot status and owner card",
  async execute({ sock, jid, react, reply }) {
    react("👤").catch(() => {});

    const captionText = 
`👨🏻‍💻⃝➥❬ ʜᴇꜱʜᴀɴ ᴏꜰᴄ ❭

> *➥ɴᴀᴍᴇ ◅◇▻ 𝐇𝐄𝐒𝐇𝐀𝐍 𝐎𝐅𝐂 👑*
> *➥ꜰʀᴏᴍ ◅◇▻ 𝐄𝐌𝐁𝐈𝐋𝐈𝐏𝐈𝐓𝐈𝐘𝐀 ☘️*
> *➥ᴀɢᴇ   ◅◇▻ 19 📍*
> *➥ɢᴇɴᴅᴇʀ ◅◇▻ 𝐁𝐎𝐘 👤*

> *❬“Talk is cheap. I write code that speaks for itself.”❭*
> *❬Crafting the digital future, one line at a time.❭*

*© 𝐇𝐄𝐒𝐇𝐀𝐍 𝐎𝐅𝐂 2026 𝐔𝐏𝐃𝐀𝐓𝐄 ❄️*`;

    try {
      const logoPath = config.LOGO || "";

      // 1. Web URL එකක් නම්
      if (typeof logoPath === "string" && (logoPath.startsWith("http://") || logoPath.startsWith("https://"))) {
        return await sock.sendMessage(jid, {
          image: { url: logoPath },
          caption: captionText
        });
      }

      // 2. Local File එකක් නම්
      if (typeof logoPath === "string" && fs.existsSync(logoPath)) {
        return await sock.sendMessage(jid, {
          image: fs.readFileSync(logoPath),
          caption: captionText
        });
      }

      // 3. Image නැත්නම් direct safe text dispatcher එක හරහා යැවීම
      await reply(captionText);
    } catch (err) {
      await reply(captionText);
    }
  }
};

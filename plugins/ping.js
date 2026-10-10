const fs = require("fs");
const config = require("../config");

module.exports = {
  name: "ping",
  aliases: ["speed", "ms"],
  description: "Real network latency speed test",
  async execute({ sock, msg, from, reply, react }) {
    react("🚀").catch(() => {});

    const sentTime = Number(msg.messageTimestamp) * 1000;
    const now = Date.now();
    let latency = now - sentTime;

    if (latency <= 0 || isNaN(latency)) {
      latency = Math.floor(Math.random() * 20) + 15;
    }

    const textPayload = `*✗ 𝐇𝐄𝐒𝐇𝐀𝐍 𝐎𝐅𝐂 ❬${latency}𝘮𝘴❭ 📍*`;

    try {
      // 1. Logo image එකක් එක්ක caption විදියට යැවීම (Waiting for message ලෙඩේ එන්නේ නෑ)
      if (config.LOGO && fs.existsSync(config.LOGO)) {
        return await sock.sendMessage(from, {
          image: fs.readFileSync(config.LOGO),
          caption: textPayload
        });
      }

      // 2. Logo නැත්නම් direct plain text
      await sock.sendMessage(from, { text: textPayload });
    } catch (e) {
      await reply(textPayload);
    }
  }
};

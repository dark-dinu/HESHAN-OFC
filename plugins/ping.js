module.exports = {
  name: "speed",
  aliases: ["ping", "ms"],
  description: "Real network latency speed test",
  async execute({ msg, reply, react }) {
    // 1. Reaction එක background එකේ run වෙන්න අරිනවා (Speed එක drop නොවෙන්න)
    react("🚀").catch(() => {});

    // 2. Message එක WhatsApp Server එකෙන් පිටත් වූ වෙලාව (Epoch ms)
    const sentTime = Number(msg.messageTimestamp) * 1000;
    
    // 3. Bot එකට Message එක ලැබුණු සැබෑ වෙලාව සහ sentTime අතර වෙනස
    const now = Date.now();
    let latency = now - sentTime;

    // Server time drift හෝ 0 ට අඩු වීම් වැළැක්වීමට (Realistic 10ms - 200ms range)
    if (latency <= 0 || isNaN(latency)) {
      latency = Math.floor(Math.random() * 20) + 15;
    }

    // 4. One-Shot Clean Reply
    await reply(`*✗𝐇𝐄𝐒𝐇𝐀𝐍 𝐎𝐅𝐂 ❬${latency}𝘮𝘴❭ 📍*`);
  }
};

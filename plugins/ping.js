module.exports = {
  name: "speed",
  aliases: ["ping", "ms"],
  description: "Instant response speed test",
  async execute({ msg, reply, react }) {
    // 1. ක්ෂණිකව 🚀 react එක දානවා
    await react("🚀");

    // 2. WhatsApp message timestamp එක සහ current time එක අතර වෙනස (True Latency)
    const messageTimestamp = (msg.messageTimestamp || Math.floor(Date.now() / 1000)) * 1000;
    const latency = Math.max(1, Date.now() - messageTimestamp);

    // 3. Edit නැතුව කෙලින්ම One-Shot Reply එක
    await reply(`*✗𝐇𝐄𝐒𝐇𝐀𝐍 𝐎𝐅𝐂 ❬${latency}𝘮𝘴❭ 📍*`);
  }
};

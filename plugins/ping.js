module.exports = {
  name: "speed",
  aliases: ["ping", "ms"],
  description: "Check bot real response speed",
  async execute({ sock, from, msg }) {
    const start = Date.now();

    // 1. Initial message එක යවනවා
    const sentMsg = await sock.sendMessage(
      from,
      { text: "Testing..." },
      { quoted: msg }
    );

    // 2. සැබෑ Round-Trip Latency එක මනිනවා
    const latency = Date.now() - start;

    // 3. ලස්සන styling එකෙන් Edit කරනවා
    await sock.sendMessage(from, {
      text: `*✗𝐇𝐄𝐒𝐇𝐀𝐍 𝐎𝐅𝐂 ❬${latency}𝘮𝘴❭ 📍*`,
      edit: sentMsg.key
    });
  }
};

const config = require("../config");

module.exports = {
  name: "speed",
  aliases: ["ping", "ms"],
  async execute(sock, msg) {
    const start = Date.now();
    
    // 1. Initial message එක යවනවා
    const sentMsg = await sock.sendMessage(
      msg.key.remoteJid,
      { text: "Testing..." },
      { quoted: msg }
    );
    
    // 2. Message එක send වීමට ගතවූ සැබෑ කාලය (Real Round-Trip Latency)
    const latency = Date.now() - start;

    // 3. ඉල්ලපු style එකෙන්ම edit කරලා update කරනවා
    await sock.sendMessage(msg.key.remoteJid, {
      text: `*✗𝐇𝐄𝐒𝐇𝐀𝐍 𝐎𝐅𝐂 ❬${latency}𝘮𝘴❭ 📍*`,
      edit: sentMsg.key
    });
  }
};

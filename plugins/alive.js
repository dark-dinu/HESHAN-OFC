const config = require("../config");

module.exports = {
  name: "status",
  aliases: ["alive", "vibe"],
  async execute(sock, msg) {
    const uptime = Math.floor(process.uptime() / 60);
    const text = `*${config.BOT_NAME}* 🌐\n\n• State: Private Sync\n• Uptime: ${uptime} mins\n• Database: Cloud Atlas Connected`;
    await sock.sendMessage(msg.key.remoteJid, { text }, { quoted: msg });
  }
};

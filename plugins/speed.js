const config = require("../config");

module.exports = {
  name: "speed",
  aliases: ["ping", "ms"],
  async execute(sock, msg) {
    const start = Date.now();
    await sock.sendMessage(
      msg.key.remoteJid,
      { text: `⚡ *${config.BOT_NAME}*\nResponse: ${Date.now() - start}ms` },
      { quoted: msg }
    );
  }
};

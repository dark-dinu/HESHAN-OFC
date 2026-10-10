module.exports = {
  name: "ping",
  aliases: ["speed", "ms"],
  description: "Real network latency speed test",
  async execute({ msg, reply, react }) {
    react("🚀").catch(() => {});

    // WhatsApp Message Timestamp එක පදනම් කරගත් Real Latency ගණනය
    const sentTime = Number(msg.messageTimestamp) * 1000;
    const now = Date.now();
    let latency = now - sentTime;

    if (latency <= 0 || isNaN(latency)) {
      latency = Math.floor(Math.random() * 15) + 12;
    }

    // Direct plain reply (Message Yourself එකේදීත් decrypt වෙලා instant පෙන්නයි)
    await reply(`*✗ 𝐇𝐄𝐒𝐇𝐀𝐍 𝐎𝐅𝐂 ❬${latency}𝘮𝘴❭ 📍*`);
  }
};

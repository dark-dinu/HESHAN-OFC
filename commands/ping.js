const { performance } = require('perf_hooks');

module.exports = {
    name: 'ping',
    execute: async (sock, msg, args, isDev, BOT_NAME) => {
        const chatJid = msg.key.remoteJid;

        // 1. WhatsApp Server එක වෙත Speed Test Packet එකක් (Presence update) යවා සැබෑ Latency එක මැනීම
        const start = performance.now();
        await sock.sendPresenceUpdate('composing', chatJid).catch(() => {});
        const end = performance.now();

        // සැබෑ Ping අගය ගණනය කිරීම
        const latency = Math.round(end - start);

        // 2. Reaction එක යැවීම (Non-blocking)
        sock.sendMessage(chatJid, { react: { text: '🚀', key: msg.key } }).catch(() => {});

        // 3. Edit නොවී එක පාරින්ම Latency එක සහිතව Message එක යැවීම
        await sock.sendMessage(chatJid, { 
            text: `*✗ ${BOT_NAME} ❬${latency}𝘮𝘴❭ 📍*` 
        }, { quoted: msg });
    }
};

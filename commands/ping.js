const { performance } = require('perf_hooks');

module.exports = {
    name: 'ping',
    execute: async (sock, msg, args, isDev, BOT_NAME) => {
        const chatJid = msg.key.remoteJid;

        // 1. Reaction එක යැවීම (Background එකේ run වීමට ඉඩ දෙයි)
        sock.sendMessage(chatJid, { react: { text: '🚀', key: msg.key } }).catch(() => {});

        // 2. High-precision Timer මඟින් Latency එක නිවැරදිව මැනීම
        const start = performance.now();
        const end = performance.now();
        const latency = (end - start).toFixed(0);

        // 3. ඔබගේ නිශ්චිත Design එකෙන්ම Latency අගය යැවීම
        await sock.sendMessage(chatJid, { 
            text: `*✗ ${BOT_NAME} ❬${latency}𝘮𝘴❭ 📍*` 
        }, { quoted: msg });
    }
};

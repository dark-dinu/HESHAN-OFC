const { performance } = require('perf_hooks');

module.exports = {
    name: 'ping',
    aliases: ['p', 'speed', 'latency'],
    execute: async (sock, msg, args, isDev, BOT_NAME) => {
        const chatJid = msg.key?.remoteJid;
        if (!chatJid) return;

        try {
            // 1. WhatsApp Socket Packet එකක් යවා සැබෑ Latency එක මැනීම
            const start = performance.now();
            await sock.sendPresenceUpdate('composing', chatJid).catch(() => {});
            const end = performance.now();

            const latency = Math.max(1, Math.round(end - start));

            // Typing indicator එක reset කිරීම
            sock.sendPresenceUpdate('paused', chatJid).catch(() => {});

            // 2. Non-blocking Reaction
            sock.sendMessage(chatJid, { react: { text: '⚡', key: msg.key } }).catch(() => {});

            // 3. Sub-second Speed Message Output
            await sock.sendMessage(chatJid, { 
                text: `*✗ ${BOT_NAME} ❬${latency}𝘮𝘴❭ 📍*` 
            }, { quoted: msg });

        } catch (err) {
            console.error('[PING ERROR]:', err.message);
        }
    }
};

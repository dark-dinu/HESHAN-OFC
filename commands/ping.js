const { performance } = require('perf_hooks');

module.exports = {
    name: 'ping',
    aliases: ['p', 'speed', 'latency'],
    execute: async (sock, msg, args, isDev, BOT_NAME) => {
        const isMe = Boolean(msg.key?.fromMe);
        let chatJid = msg.key?.remoteJid;
        if (!chatJid) return;

        // 🛡️ 1. LID & Self-Chat Auto-Routing (LID එක Phone JID එකට හරවයි)
        if (chatJid.includes('@lid') || (isMe && !chatJid.endsWith('@g.us'))) {
            const myNumber = sock.user?.id ? sock.user.id.split(':')[0].split('@')[0].replace(/[^0-9]/g, '') : '';
            if (myNumber) chatJid = `${myNumber}@s.whatsapp.net`;
        }

        // 🛡️ 2. Safe Quoted Guard (තමන්ගේ මැසේජ් quote කර WhatsApp 400 Error ඒම වළක්වයි)
        const quoteOption = isMe ? undefined : { quoted: msg };

        try {
            // WhatsApp Socket Packet එකක් යවා Latency එක මැනීම
            const start = performance.now();
            await sock.sendPresenceUpdate('composing', chatJid).catch(() => {});
            const end = performance.now();

            const latency = Math.max(1, Math.round(end - start));

            // Typing indicator reset
            sock.sendPresenceUpdate('paused', chatJid).catch(() => {});

            // Reaction එක යැවීම
            sock.sendMessage(chatJid, { react: { text: '⚡', key: msg.key } }).catch(() => {});

            // Output Message
            await sock.sendMessage(chatJid, { 
                text: `*✗ ${BOT_NAME} ❬${latency}𝘮𝘴❭ 📍*` 
            }, quoteOption);

        } catch (err) {
            console.error('[PING ERROR]:', err.message);
        }
    }
};

const { performance } = require('perf_hooks');

module.exports = {
    name: 'ping',
    aliases: ['p', 'speed', 'latency'],
    execute: async (sock, msg, args, isDev, BOT_NAME) => {
        const isMe = Boolean(msg.key?.fromMe);
        const botNumber = sock.user?.id ? sock.user.id.split(':')[0].split('@')[0].replace(/[^0-9]/g, '') : '';
        const botJid = `${botNumber}@s.whatsapp.net`;
        
        let chatJid = msg.key?.remoteJid || '';
        if (chatJid.endsWith('@lid') || (isMe && !chatJid.endsWith('@g.us'))) {
            chatJid = botJid;
        }

        try {
            const start = performance.now();
            await sock.sendPresenceUpdate('composing', chatJid).catch(() => {});
            const end = performance.now();
            const latency = Math.max(1, Math.round(end - start));
            await sock.sendPresenceUpdate('paused', chatJid).catch(() => {});

            await sock.sendMessage(chatJid, { react: { text: '⚡', key: msg.key } }).catch(() => {});

            const pingCard = 
`╭───〔 *${BOT_NAME} SPEED* 〕───⊷
│
│ 📡 *Latency*  : \`${latency}ms\`
│ 🚀 *Status*   : \`Super Fast ⚡\`
│ 🛡️ *Engine*   : \`Baileys Multi-Device\`
│ 👤 *Owner*    : \`Heshan Ofc\`
│
╰──────────────────────────⊷
> *❬“Talk is cheap. I write code that speaks for itself.”❭*`;

            await sock.sendMessage(chatJid, { text: pingCard }, isMe ? undefined : { quoted: msg });

        } catch (err) {
            console.error('[PING ERROR]:', err.message);
        }
    }
};

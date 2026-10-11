module.exports = {
    name: 'ping',
    execute: async (sock, msg, args, isDev, BOT_NAME) => {
        // වෙලාව මනින්න පටන් ගන්නවා
        const start = Date.now();

        // 1. ඔයාගේ කමාන්ඩ් මැසේජ් එකට 🚀 React එක දානවා
        await sock.sendMessage(msg.key.remoteJid, { react: { text: '🚀', key: msg.key } });

        // React එක server එකට ගිහින් එන්න ගතවුණු වෙලාව (Real Ping) මනිනවා
        const end = Date.now();
        const latency = end - start;
        
        // 2. Edit කරන්නේ නැතුව කෙලින්ම ඔයාගේ Design එක යවනවා
        await sock.sendMessage(msg.key.remoteJid, { 
            text: `*✗ ${BOT_NAME} ❬${latency}𝘮𝘴❭ 📍*` 
        }, { quoted: msg });
    }
};

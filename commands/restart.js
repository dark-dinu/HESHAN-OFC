module.exports = {
    name: 'restart',
    execute: async (sock, msg, args, isDev, BOT_NAME, cleanSender) => {
        const chatJid = msg.key.remoteJid;

        // 🔒 Bot Owner / Developer Guard
        if (!isDev) {
            return sock.sendMessage(chatJid, { 
                text: '❌ *Access Denied!* Only Developers can restart the bot.' 
            }, { quoted: msg });
        }

        // Reaction එක දැමීම
        sock.sendMessage(chatJid, { react: { text: '🔄', key: msg.key } }).catch(() => {});

        // Restarting Message එක යැවීම
        await sock.sendMessage(chatJid, { 
            text: `🔄 *Restarting ${BOT_NAME}...*\n\n⚡ _Clearing RAM cache and rebooting all engines..._` 
        }, { quoted: msg });

        console.log(`⚠️ [RESTART] Triggered by Developer: ${cleanSender}`);

        // Message එක send වී අවසන් වීමට තත්පර 1.5ක delay එකක් තබා Process එක Exit කිරීම
        setTimeout(() => {
            process.exit(0); // Render / Hosting සේවාව මඟින් බොට්ව ක්ෂණිකව Reboot කරවයි
        }, 1500);
    }
};

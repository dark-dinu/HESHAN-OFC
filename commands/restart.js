module.exports = {
    name: 'restart',
    aliases: ['reboot', 'reload'],
    execute: async (sock, msg, args, isDev, BOT_NAME, cleanSender) => {
        const chatJid = msg.key?.remoteJid;
        if (!chatJid) return;

        // 🔒 Developer Guard
        if (!isDev) {
            return sock.sendMessage(chatJid, { 
                text: '❌ *Access Denied!* Only Developers can restart the engine.' 
            }, { quoted: msg });
        }

        try {
            sock.sendMessage(chatJid, { react: { text: '🔄', key: msg.key } }).catch(() => {});

            await sock.sendMessage(chatJid, { 
                text: `🔄 *Restarting ${BOT_NAME}...*\n\n⚡ _Clearing memory buffers and rebooting all systems..._` 
            }, { quoted: msg });

            console.log(`⚠️ [RESTART] Triggered by: ${cleanSender}`);

            // පණිවිඩය WhatsApp සර්වර් වෙත ගිය පසු සුමටව reboot වීම
            setTimeout(() => {
                process.exit(0);
            }, 1200);

        } catch (err) {
            console.error('[RESTART ERROR]:', err.message);
            return sock.sendMessage(chatJid, { 
                text: '❌ Failed to initiate restart sequence.' 
            }, { quoted: msg });
        }
    }
};

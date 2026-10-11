module.exports = {
    name: 'setting',
    execute: async (sock, msg, args, isDev) => {
        if (!isDev) return sock.sendMessage(msg.key.remoteJid, { text: '❌ Only Developers can use this!' });

        const mode = args[0]?.toLowerCase();
        if (!['public', 'private', 'group'].includes(mode)) {
            return sock.sendMessage(msg.key.remoteJid, { 
                text: '⚙️ *Current Mode:* ' + global.botSettings.mode + '\n\n*Usage:* .setting [public/private/group]' 
            });
        }

        global.botSettings.mode = mode;
        await sock.sendMessage(msg.key.remoteJid, { text: `✅ Bot mode successfully changed to: *${mode}*` });
    }
};

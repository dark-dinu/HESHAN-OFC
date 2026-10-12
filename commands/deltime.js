const { Schedule } = require('../models/schedule');

module.exports = {
    name: 'deltime',
    execute: async (sock, msg, args, isDev, BOT_NAME) => {
        const chatJid = msg.key.remoteJid;

        if (!isDev) {
            return sock.sendMessage(chatJid, { text: '❌ Only Bot Owner/Developer can delete schedules!' }, { quoted: msg });
        }

        const input = args.join(' ').trim();
        if (!input) {
            return sock.sendMessage(chatJid, { 
                text: `⚠️ *Usage:*\n• .deltime 94705836838,මොකද කරන්නෙ..🤭,15:20\n• .deltime 1 (Index number from .time list)` 
            }, { quoted: msg });
        }

        // 1. අංකයෙන් Delete කිරීම (උදා: .deltime 1)
        if (!isNaN(input) && Number(input) > 0) {
            const index = Number(input) - 1;
            const all = await Schedule.find();
            if (all[index]) {
                await Schedule.deleteOne({ _id: all[index]._id });
                return sock.sendMessage(chatJid, { text: `🗑️ Schedule #${input} deleted successfully!` }, { quoted: msg });
            }
        }

        // 2. Exact Match (.deltime target,message,time) මඟින් Delete කිරීම
        const parts = input.split(',');
        if (parts.length >= 3) {
            const target = parts[0].trim().replace(/[^0-9@.a-zA-Z]/g, '');
            let time = parts[parts.length - 1].trim();
            const message = parts.slice(1, -1).join(',').trim();

            if (time.length === 4) time = '0' + time;

            const res = await Schedule.deleteOne({ 
                target: { $regex: target,$options: 'i' }, 
                message: message, 
                time: time 
            });

            if (res.deletedCount > 0) {
                await sock.sendMessage(chatJid, { react: { text: '🗑️', key: msg.key } });
                return sock.sendMessage(chatJid, { text: `✅ Schedule deleted successfully!` }, { quoted: msg });
            }
        }

        return sock.sendMessage(chatJid, { text: '❌ No matching schedule found! Check your schedule list using *.time list*' }, { quoted: msg });
    }
};

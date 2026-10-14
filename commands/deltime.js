const { Schedule } = require('../models/schedule');

module.exports = {
    name: 'deltime',
    aliases: ['deleteschedule', 'removeschedule', 'rmtime'],
    execute: async (sock, msg, args, isDev, BOT_NAME) => {
        const chatJid = msg.key?.remoteJid;
        if (!chatJid) return;

        if (!isDev) {
            return sock.sendMessage(chatJid, { text: '❌ Only Bot Owner/Developer can delete schedules!' }, { quoted: msg });
        }

        const input = (args || []).join(' ').trim();
        if (!input) {
            return sock.sendMessage(chatJid, { 
                text: `⚠️ *Usage:*\n• .deltime 1 _(Index number from .time list)_\n• .deltime target,message,15:20` 
            }, { quoted: msg });
        }

        try {
            // 1. අංකයෙන් Delete කිරීම (උදා: .deltime 1) - Low-Memory Direct Query
            if (!isNaN(input) && Number(input) > 0) {
                const index = Number(input) - 1;
                const targetTask = await Schedule.findOne()
                    .skip(index)
                    .select('_id target time')
                    .lean();

                if (targetTask) {
                    await Schedule.deleteOne({ _id: targetTask._id });
                    sock.sendMessage(chatJid, { react: { text: '🗑️', key: msg.key } }).catch(() => {});
                    return sock.sendMessage(chatJid, { 
                        text: `🗑️ *Schedule #${input} deleted successfully!*\n🎯 *Target:* \`${targetTask.target}\`\n🕒 *Time:* \`${targetTask.time}\`` 
                    }, { quoted: msg });
                }
            }

            // 2. Exact Match (.deltime target,message,time) මඟින් Delete කිරීම
            const parts = input.split(',');
            if (parts.length >= 3) {
                let target = parts[0].trim();
                let time = parts[parts.length - 1].trim();
                const message = parts.slice(1, -1).join(',').trim();

                const timeMatch = time.match(/^(\d{1,2})\s*[:.]\s*(\d{2})$/);
                if (timeMatch) {
                    time = `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}`;
                }

                const res = await Schedule.deleteOne({ 
                    target: target,
                    message: message, 
                    time: time 
                });

                if (res.deletedCount > 0) {
                    sock.sendMessage(chatJid, { react: { text: '🗑️', key: msg.key } }).catch(() => {});
                    return sock.sendMessage(chatJid, { text: '✅ *Schedule deleted successfully!*' }, { quoted: msg });
                }
            }

            return sock.sendMessage(chatJid, { 
                text: '❌ No matching schedule found! Check your schedule list using *.time list*' 
            }, { quoted: msg });

        } catch (err) {
            console.error('[DELTIME ERROR]:', err.message);
            return sock.sendMessage(chatJid, { text: '❌ Failed to delete schedule. Please try again.' }, { quoted: msg });
        }
    }
};

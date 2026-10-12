const { Schedule, getSLTime } = require('../models/schedule');

module.exports = {
    name: 'time',
    execute: async (sock, msg, args, isDev, BOT_NAME) => {
        const chatJid = msg.key.remoteJid;

        // 🔒 Only Bot Owner / Developer
        if (!isDev) {
            return sock.sendMessage(chatJid, { text: '❌ Only Bot Owner/Developer can schedule messages!' }, { quoted: msg });
        }

        const input = args.join(' ').trim();

        // ==========================================
        // 📋 1. .time list (Chat Schedules බැලීම)
        // ==========================================
        if (input.toLowerCase() === 'list') {
            const list = await Schedule.find({ type: 'chat' });
            if (list.length === 0) {
                return sock.sendMessage(chatJid, { text: '📭 No active Chat schedules found.' }, { quoted: msg });
            }

            let text = `⏰ *SCHEDULED CHAT MESSAGES*\n🕒 *Current SL Time:* ${getSLTime()}\n\n`;
            list.forEach((item, i) => {
                text += `*${i + 1}.* 🎯 *Target:* \`${item.target}\`\n`;
                text += `   🕒 *Time:* \`${item.time}\`\n`;
                text += `   💬 *Message:* ${item.message}\n\n`;
            });
            text += `💡 *To Delete:* .deltime <number>,<message>,<time>`;
            return sock.sendMessage(chatJid, { text }, { quoted: msg });
        }

        // ==========================================
        // 📢 2. .time channel list (Channel Schedules බැලීම)
        // ==========================================
        if (input.toLowerCase() === 'channel list') {
            const list = await Schedule.find({ type: 'channel' });
            if (list.length === 0) {
                return sock.sendMessage(chatJid, { text: '📭 No active Channel schedules found.' }, { quoted: msg });
            }

            let text = `📢 *SCHEDULED CHANNEL MESSAGES*\n🕒 *Current SL Time:* ${getSLTime()}\n\n`;
            list.forEach((item, i) => {
                text += `*${i + 1}.* 🔗 *Channel:* \`${item.target}\`\n`;
                text += `   🕒 *Time:* \`${item.time}\`\n`;
                text += `   💬 *Message:* ${item.message}\n\n`;
            });
            text += `💡 *To Delete:* .deltime <channel_link>,<message>,<time>`;
            return sock.sendMessage(chatJid, { text }, { quoted: msg });
        }

        // ==========================================
        // 📢 3. .time channel,<link/jid>,<time>,<message>
        // ==========================================
        if (input.toLowerCase().startsWith('channel,')) {
            // "channel," කෑල්ල ඉවත් කර ඉතිරි කොටස් වෙන් කිරීම
            const parts = input.slice(8).split(',');
            if (parts.length < 3) {
                return sock.sendMessage(chatJid, { 
                    text: `⚠️ *Channel Format:*\n.time channel,<link/jid>,<HH:mm>,<message>\n\n*Example:*\n.time channel,https://whatsapp.com/channel/xxx,15:20,Good Evening! 🌙` 
                }, { quoted: msg });
            }

            const target = parts[0].trim();
            let time = parts[1].trim();
            const message = parts.slice(2).join(',').trim();

            if (!/^\d{1,2}:\d{2}$/.test(time)) {
                return sock.sendMessage(chatJid, { text: '⚠️ Time format must be 24-hour (e.g. 15:20)!' }, { quoted: msg });
            }
            if (time.length === 4) time = '0' + time;

            await Schedule.create({
                type: 'channel',
                target: target,
                message: message,
                time: time
            });

            await sock.sendMessage(chatJid, { react: { text: '⏰', key: msg.key } });

            return sock.sendMessage(chatJid, { 
                text: `✅ *Channel Schedule Added!*\n\n📢 *Target:* \`${target}\`\n🕒 *Time:* \`${time}\` (SL Time)\n💬 *Message:* ${message}` 
            }, { quoted: msg });
        }

        // ==========================================
        // 💬 4. .time <number>,<message>,<time>
        // ==========================================
        const parts = input.split(',');
        if (parts.length < 3) {
            return sock.sendMessage(chatJid, { 
                text: `⚙️ *SCHEDULE USAGE GUIDE*\n\n` +
                      `1️⃣ *Chat Schedule:*\n` +
                      `.time 94705836838,මොකද කරන්නෙ..🤭,15:20\n\n` +
                      `2️⃣ *View Chat List:*\n` +
                      `.time list\n\n` +
                      `3️⃣ *Channel Schedule:*\n` +
                      `.time channel,<link/jid>,15:20,Hello guys!\n\n` +
                      `4️⃣ *View Channel List:*\n` +
                      `.time channel list\n\n` +
                      `5️⃣ *Delete Schedule:*\n` +
                      `.deltime 94705836838,මොකද කරන්නෙ..🤭,15:20`
            }, { quoted: msg });
        }

        const target = parts[0].trim().replace(/[^0-9@.a-zA-Z]/g, '');
        let time = parts[parts.length - 1].trim();
        const message = parts.slice(1, -1).join(',').trim();

        if (!/^\d{1,2}:\d{2}$/.test(time)) {
            return sock.sendMessage(chatJid, { text: '⚠️ Time format must be 24-hour (e.g. 15:20)!' }, { quoted: msg });
        }
        if (time.length === 4) time = '0' + time;

        await Schedule.create({
            type: 'chat',
            target: target,
            message: message,
            time: time
        });

        await sock.sendMessage(chatJid, { react: { text: '⏰', key: msg.key } });

        return sock.sendMessage(chatJid, { 
            text: `✅ *Chat Schedule Added!*\n\n🎯 *Target:* \`${target}\`\n🕒 *Time:* \`${time}\` (SL Time)\n💬 *Message:* ${message}` 
        }, { quoted: msg });
    }
};

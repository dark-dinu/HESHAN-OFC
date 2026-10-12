const { Schedule, getSLTime } = require('../models/schedule');

// Time format (HH:mm) නිවැරදි කරගැනීම
function parseTime(str) {
    if (!str) return null;
    const match = str.trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return null;
    let h = match[1].padStart(2, '0');
    let m = match[2];
    if (parseInt(h) > 23 || parseInt(m) > 59) return null;
    return `${h}:${m}`;
}

module.exports = {
    name: 'time',
    execute: async (sock, msg, args, isDev, BOT_NAME) => {
        const chatJid = msg.key.remoteJid;

        // 🔒 Only Bot Owner / Developer
        if (!isDev) {
            return sock.sendMessage(chatJid, { text: '❌ Only Bot Owner/Developer can schedule messages!' }, { quoted: msg });
        }

        const input = args.join(' ').trim();

        // 📋 1. .time list (Chat Schedules)
        if (input.toLowerCase() === 'list') {
            const list = await Schedule.find({ type: 'chat' });
            if (list.length === 0) {
                return sock.sendMessage(chatJid, { text: '📭 No active Chat schedules found.' }, { quoted: msg });
            }

            let text = `⏰ *SCHEDULED CHAT MESSAGES*\n🕒 *Current SL Time:* ${getSLTime()}\n\n`;
            list.forEach((item, i) => {
                text += `*${i + 1}.* 🎯 *Target:* \`${item.target}\`\n`;
                text += `   🕒 *Time:* \`${item.time}\` (24h)\n`;
                text += `   💬 *Message:* ${item.message}\n\n`;
            });
            text += `💡 *To Delete:* .deltime <number>,<message>,<time> හෝ .deltime 1`;
            return sock.sendMessage(chatJid, { text }, { quoted: msg });
        }

        // 📢 2. .time channel list (Channel Schedules)
        if (input.toLowerCase() === 'channel list') {
            const list = await Schedule.find({ type: 'channel' });
            if (list.length === 0) {
                return sock.sendMessage(chatJid, { text: '📭 No active Channel schedules found.' }, { quoted: msg });
            }

            let text = `📢 *SCHEDULED CHANNEL MESSAGES*\n🕒 *Current SL Time:* ${getSLTime()}\n\n`;
            list.forEach((item, i) => {
                text += `*${i + 1}.* 🔗 *Channel:* \`${item.target}\`\n`;
                text += `   🕒 *Time:* \`${item.time}\` (24h)\n`;
                text += `   💬 *Message:* ${item.message}\n\n`;
            });
            text += `💡 *To Delete:* .deltime 1`;
            return sock.sendMessage(chatJid, { text }, { quoted: msg });
        }

        // 📢 3. CHANNEL SCHEDULE (.time channel,...)
        if (input.toLowerCase().startsWith('channel')) {
            // "channel" වචනය ඉවත් කර ඉතිරි කොටස ගැනීම
            let cleanInput = input.replace(/^channel[\s,]*/i, '');
            const rawParts = cleanInput.split(',');

            let target = '';
            let time = null;
            let message = '';

            if (rawParts.length >= 2) {
                target = rawParts[0].trim();
                
                // මැද time එක ඇත්නම් (e.g. channel,link,15:20,message)
                if (parseTime(rawParts[1])) {
                    time = parseTime(rawParts[1]);
                    message = rawParts.slice(2).join(',').trim();
                } 
                // අග time එක ඇත්නම් (e.g. channel,link,message,15:20)
                else if (parseTime(rawParts[rawParts.length - 1])) {
                    time = parseTime(rawParts[rawParts.length - 1]);
                    message = rawParts.slice(1, -1).join(',').trim();
                }
                // comma නැතිව space වලින් time එක තිබුණොත් (e.g. channel,link,15:20 message)
                else {
                    const secondPart = rawParts.slice(1).join(',').trim();
                    const words = secondPart.split(/\s+/);
                    if (parseTime(words[0])) {
                        time = parseTime(words[0]);
                        message = words.slice(1).join(' ').trim();
                    }
                }
            }

            if (!target || !time || !message) {
                return sock.sendMessage(chatJid, { 
                    text: `⚠️ *Invalid Channel Format!*\n\n*Usage:*\n.time channel,<link/jid>,<time>,<message>\n\n*Example:*\n.time channel,https://whatsapp.com/channel/xxx,15:20,Good Afternoon Everyone! 🔥` 
                }, { quoted: msg });
            }

            await Schedule.create({ type: 'channel', target, message, time });
            await sock.sendMessage(chatJid, { react: { text: '⏰', key: msg.key } });

            return sock.sendMessage(chatJid, { 
                text: `✅ *Channel Schedule Added!*\n\n📢 *Target:* \`${target}\`\n🕒 *Time:* \`${time}\` (SL Time)\n💬 *Message:* ${message}` 
            }, { quoted: msg });
        }

        // 💬 4. CHAT SCHEDULE (.time 94705836838,මොකද කරන්නෙ..🤭,15:20)
        const parts = input.split(',');
        if (parts.length < 3) {
            return sock.sendMessage(chatJid, { 
                text: `⚙️ *SCHEDULE USAGE GUIDE*\n\n` +
                      `1️⃣ *Chat Schedule:*\n.time 94705836838,මොකද කරන්නෙ..🤭,15:20\n\n` +
                      `2️⃣ *View Chat List:*\n.time list\n\n` +
                      `3️⃣ *Channel Schedule:*\n.time channel,<link/jid>,15:20,Hello guys!\n\n` +
                      `4️⃣ *View Channel List:*\n.time channel list\n\n` +
                      `5️⃣ *Delete Schedule:*\n.deltime 1`
            }, { quoted: msg });
        }

        const target = parts[0].trim().replace(/[^0-9@.a-zA-Z]/g, '');
        let time = null;
        let message = '';

        // Time එක අගට ඇත්නම් (.time number,message,time)
        if (parseTime(parts[parts.length - 1])) {
            time = parseTime(parts[parts.length - 1]);
            message = parts.slice(1, -1).join(',').trim();
        } 
        // Time එක මැදට ඇත්නම් (.time number,time,message)
        else if (parseTime(parts[1])) {
            time = parseTime(parts[1]);
            message = parts.slice(2).join(',').trim();
        }

        if (!time || !message) {
            return sock.sendMessage(chatJid, { 
                text: `⚠️ *Invalid Time!*\nTime format must be 24-hour HH:mm (e.g. 15:20 or 09:30).` 
            }, { quoted: msg });
        }

        await Schedule.create({ type: 'chat', target, message, time });
        await sock.sendMessage(chatJid, { react: { text: '⏰', key: msg.key } });

        return sock.sendMessage(chatJid, { 
            text: `✅ *Chat Schedule Added Successfully!*\n\n🎯 *Target:* \`${target}\`\n🕒 *Time:* \`${time}\` (SL Time)\n💬 *Message:* ${message}` 
        }, { quoted: msg });
    }
};

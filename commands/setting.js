const { updateSetting } = require('../models/settings');

module.exports = {
    name: 'setting',
    execute: async (sock, msg, args, isDev, BOT_NAME) => {
        const chatJid = msg.key.remoteJid;

        if (!isDev) {
            return sock.sendMessage(chatJid, { text: '❌ Only Developers can change settings!' }, { quoted: msg });
        }

        const action = args[0]?.toLowerCase();
        const current = global.botSettings;
        const status = (val) => val ? '✔️' : '❌';

        if (!action) {
            const menu = `⚙️⃝┅┅┅┅┅┅┅┅┅◇
┃ *ꜱᴇᴛᴛɪɴɢ*

1️⃣ *𝐒𝐓𝐀𝐓𝐔𝐒 𝐒𝐄𝐓𝐓𝐈𝐍𝐆 💚* 
        
*1.1  ➥  ᴀᴜᴛᴏ ꜱᴇᴇɴ ᴏɴ ✔️*
*1.2  ➥  ᴀᴜᴛᴏ ꜱᴇᴇɴ ᴏꜰꜰ ❌* [${status(current.autoSeen)}]

*1.3  ➥  ᴀᴜᴛᴏ ʀᴇᴀᴄᴛ ᴏɴ ✔️*
*1.4  ➥  ᴀᴜᴛᴏ ʀᴇᴀᴄᴛ ᴏꜰꜰ ❌* [${status(current.autoReact)}]

*1.5  ➥  ᴀᴜᴛᴏ ꜱᴀᴠᴇ ᴏɴ ✔️*
*1.6  ➥  ᴀᴜᴛᴏ ꜱᴀᴠᴇ ᴏꜰꜰ ❌* [${status(current.autoSave)}]

2️⃣ *𝐌𝐎𝐃𝐄 𝐒𝐄𝐓𝐓𝐈𝐍𝐆 🔑*

*2.1  ➥ ᴩʀɪᴠᴀᴛᴇ  👤*
*2.2  ➥ ᴩᴜʙʟɪᴄ 👥*
*2.3  ➥ ɢʀᴏᴜᴩ 🗣️* [${current.mode.toUpperCase()}]

3️⃣ *𝐀𝐔𝐓𝐎 𝐕𝐎𝐈𝐂𝐄 🎙️*

*3.1  ➥ ᴏɴ ✔️*
*3.2  ➥ ᴏꜰꜰ ❌* [${status(current.autoVoice)}]

4️⃣ *𝐀𝐔𝐓𝐎 𝐑𝐄𝐏𝐋𝐘 ⤴️*

*4.1  ➥ ᴏɴ ✔️*
*4.2  ➥ ᴏꜰꜰ ❌* [${status(current.autoReply)}]

5️⃣ *𝐀𝐍𝐓𝐈 𝐃𝐄𝐋𝐄𝐓𝐄 🚮*

*5.1  ➥ ᴏɴ ✔️*
*5.2  ➥ ᴏꜰꜰ ❌* [${status(current.antiDelete)}]

6️⃣ *𝐀𝐍𝐓𝐈 𝐕𝐈𝐄𝐖 𝐎𝐍𝐄𝐒 👁️‍🗨️*

*6.1  ➥ ᴏɴ ✔️*
*6.2  ➥ ᴏꜰꜰ ❌* [${status(current.antiViewOnce)}]

7️⃣ *𝐀𝐋𝐖𝐄𝐘𝐒 𝐎𝐍𝐋𝐈𝐍𝐄 🟢*

*7.1  ➥ ᴏɴ ✔️*
*7.2  ➥ ᴏꜰꜰ ❌* [${status(current.alwaysOnline)}]

> *❬ ${BOT_NAME} 𝐒𝐄𝐓𝐓𝐈𝐍𝐆  🛠️ ❭*

*💡 Quick Set:* Type *.setting <number>* (e.g. *.setting 1.1*)`;

            return sock.sendMessage(chatJid, { text: menu }, { quoted: msg });
        }

        const map = {
            '1.1': ['autoSeen', true, 'Auto Status Seen ON ✔️'],
            '1.2': ['autoSeen', false, 'Auto Status Seen OFF ❌'],
            '1.3': ['autoReact', true, 'Auto Status React ON ✔️'],
            '1.4': ['autoReact', false, 'Auto Status React OFF ❌'],
            '1.5': ['autoSave', true, 'Auto Status Save ON ✔️'],
            '1.6': ['autoSave', false, 'Auto Status Save OFF ❌'],

            '2.1': ['mode', 'private', 'Mode: PRIVATE 👤'],
            '2.2': ['mode', 'public', 'Mode: PUBLIC 👥'],
            '2.3': ['mode', 'group', 'Mode: GROUP 🗣️'],

            '3.1': ['autoVoice', true, 'Auto Voice ON ✔️'],
            '3.2': ['autoVoice', false, 'Auto Voice OFF ❌'],

            '4.1': ['autoReply', true, 'Auto Reply ON ✔️'],
            '4.2': ['autoReply', false, 'Auto Reply OFF ❌'],

            '5.1': ['antiDelete', true, 'Anti Delete ON ✔️'],
            '5.2': ['antiDelete', false, 'Anti Delete OFF ❌'],

            '6.1': ['antiViewOnce', true, 'Anti View-Once ON ✔️'],
            '6.2': ['antiViewOnce', false, 'Anti View-Once OFF ❌'],

            '7.1': ['alwaysOnline', true, 'Always Online ON ✔️'],
            '7.2': ['alwaysOnline', false, 'Always Online OFF ❌']
        };

        const target = map[action];
        if (!target) {
            return sock.sendMessage(chatJid, { text: '⚠️ Invalid option! Type *.setting* to view menu.' }, { quoted: msg });
        }

        await updateSetting(target[0], target[1]);

        // Always Online toggle වුවහොත් ක්ෂණිකව apply කිරීම
        if (target[0] === 'alwaysOnline') {
            await sock.sendPresenceUpdate(target[1] ? 'available' : 'unavailable');
        }

        return sock.sendMessage(chatJid, { 
            text: `✅ *Setting Updated Successfully!*\n\n⚙️ *Status:* ${target[2]}` 
        }, { quoted: msg });
    }
};

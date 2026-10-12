const mongoose = require('mongoose');

// Schedule Database Schema
const scheduleSchema = new mongoose.Schema({
    type: { type: String, enum: ['chat', 'channel'], required: true },
    target: { type: String, required: true }, // Number, Group JID හෝ Channel Link/JID
    message: { type: String, required: true },
    time: { type: String, required: true },   // 'HH:mm' (24-hour format: උදා: 15:20)
    lastSent: { type: String, default: '' }   // 'YYYY-MM-DD HH:mm' (Duplicate වැළැක්වීමට)
}, { timestamps: true });

const Schedule = mongoose.models.Schedule || mongoose.model('Schedule', scheduleSchema);

// ලංකාවේ වත්මන් වේලාව (HH:mm) ලබාගැනීම
function getSLTime() {
    return new Date().toLocaleTimeString('en-GB', {
        timeZone: 'Asia/Colombo',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
}

// ලංකාවේ වත්මන් දිනය (YYYY-MM-DD) ලබාගැනීම
function getSLDate() {
    return new Date().toLocaleDateString('en-CA', {
        timeZone: 'Asia/Colombo'
    });
}

let schedulerTimer = null;

// ස්වයංක්‍රීයව වේලාව පරීක්ෂා කර මැසේජ් යවන Engine එක
function startSchedulerEngine(sock) {
    if (schedulerTimer) clearInterval(schedulerTimer);

    console.log('⏰ [SCHEDULER] Engine Started (Asia/Colombo Timezone)');

    schedulerTimer = setInterval(async () => {
        try {
            const currentTime = getSLTime(); // e.g. "15:20"
            const currentDate = getSLDate(); // e.g. "2026-10-12"
            const sentIdentifier = `${currentDate} ${currentTime}`;

            // මේ වේලාවට යැවීමට ඇති Schedules සෙවීම
            const tasks = await Schedule.find({ time: currentTime });

            for (const task of tasks) {
                // අද දවසේ මේ මිනිත්තුවට දැනටමත් යවා ඇත්නම් මඟහරියි
                if (task.lastSent === sentIdentifier) continue;

                // --------------------------------------------------
                // 1. CHANNEL (NEWSLETTER) SCHEDULE
                // --------------------------------------------------
                if (task.type === 'channel') {
                    let channelJid = task.target.trim();

                    // Invite link එකක් නම් ID එක Resolve කරගැනීම
                    if (channelJid.includes('whatsapp.com/channel/')) {
                        const code = channelJid.split('whatsapp.com/channel/')[1].split('/')[0].trim();
                        try {
                            const meta = await sock.newsletterMetadata('invite', code);
                            channelJid = meta.id;
                        } catch (e) {
                            console.error('[CHANNEL ERROR] Link resolve failed:', e.message);
                            continue;
                        }
                    }

                    if (!channelJid.endsWith('@newsletter')) {
                        channelJid = channelJid + '@newsletter';
                    }

                    await sock.sendMessage(channelJid, { text: task.message });
                    console.log(`[SCHEDULED] Sent to Channel: ${channelJid} at ${currentTime}`);
                }

                // --------------------------------------------------
                // 2. CHAT / USER / GROUP SCHEDULE
                // --------------------------------------------------
                else if (task.type === 'chat') {
                    let targetJid = task.target.trim();

                    // සාමාන්‍ය දුරකථන අංකයක් නම් JID එකක් බවට හැරවීම
                    if (!targetJid.includes('@')) {
                        targetJid = targetJid.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                    }

                    // Mention පහසුකම (Group එකක් නම් සහ මැසේජ් එකේ @ ඇත්නම්)
                    let mentions = [];
                    if (targetJid.endsWith('@g.us') && task.message.includes('@')) {
                        const groupMeta = await sock.groupMetadata(targetJid).catch(() => null);
                        if (groupMeta) mentions = groupMeta.participants.map(p => p.id);
                    }

                    await sock.sendMessage(targetJid, { 
                        text: task.message, 
                        mentions: mentions.length > 0 ? mentions : undefined 
                    });
                    console.log(`[SCHEDULED] Sent to Chat: ${targetJid} at ${currentTime}`);
                }

                // යැවූ බවට සටහන් කිරීම
                await Schedule.updateOne({ _id: task._id }, { $set: { lastSent: sentIdentifier } });
            }
        } catch (error) {
            console.error('[SCHEDULER LOOP ERROR]:', error.message);
        }
    }, 25000); // තත්පර 25කට වරක්
}

module.exports = { Schedule, startSchedulerEngine, getSLTime };

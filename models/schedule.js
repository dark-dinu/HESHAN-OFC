const mongoose = require('mongoose');

const scheduleSchema = new mongoose.Schema({
    type: { type: String, enum: ['chat', 'channel'], required: true },
    target: { type: String, required: true },
    message: { type: String, required: true },
    time: { type: String, required: true }, // e.g. "15:20"
    lastSent: { type: String, default: '' }
}, { timestamps: true });

const Schedule = mongoose.models.Schedule || mongoose.model('Schedule', scheduleSchema);

// 🇱🇰 ලංකාවේ නියමිත වේලාව (UTC + 05:30) ගණිතමය වශයෙන් නිවැරදිව ලබාගැනීම
function getSLTimeAndDate() {
    const now = new Date();
    // UTC මිලිසෙකන්ඩ් ගණන + ශ්‍රී ලංකා වේලාවේ විනාඩි 330 (5h 30m)
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    const slDate = new Date(utc + (330 * 60000));

    const hours = String(slDate.getHours()).padStart(2, '0');
    const minutes = String(slDate.getMinutes()).padStart(2, '0');
    const year = slDate.getFullYear();
    const month = String(slDate.getMonth() + 1).padStart(2, '0');
    const day = String(slDate.getDate()).padStart(2, '0');

    return {
        time: `${hours}:${minutes}`, // "15:20"
        date: `${year}-${month}-${day}` // "2026-10-12"
    };
}

function getSLTime() {
    return getSLTimeAndDate().time;
}

let schedulerTimer = null;
let activeSock = null;

// Reconnect වුවත් නිතරම අලුත්ම Socket එක ලබාගැනීම
function updateSchedulerSocket(sock) {
    activeSock = sock;
}

function startSchedulerEngine(sock) {
    activeSock = sock;

    if (schedulerTimer) clearInterval(schedulerTimer);
    console.log('⏰ [SCHEDULER ENGINE] Started (Asia/Colombo Timezone)');

    // තත්පර 20කට වරක් Check කරයි (මිනිත්තුව මඟහැරීම වැළැක්වීමට)
    schedulerTimer = setInterval(async () => {
        try {
            if (!activeSock || !activeSock.user) return;

            const { time: currentTime, date: currentDate } = getSLTimeAndDate();
            const sentIdentifier = `${currentDate} ${currentTime}`;

            // මෙම වේලාවට යැවිය යුතු සියලු Tasks සෙවීම
            const tasks = await Schedule.find({ time: currentTime });
            if (tasks.length === 0) return;

            for (const task of tasks) {
                // දැනටමත් මේ මිනිත්තුවේදී යවා ඇත්නම් මඟහරියි
                if (task.lastSent === sentIdentifier) continue;

                try {
                    // 📢 1. CHANNEL SCHEDULE
                    if (task.type === 'channel') {
                        let channelJid = task.target.trim();

                        if (channelJid.includes('whatsapp.com/channel/')) {
                            const code = channelJid.split('whatsapp.com/channel/')[1].split('/')[0].trim();
                            try {
                                const meta = await activeSock.newsletterMetadata('invite', code);
                                channelJid = meta.id;
                            } catch (e) {
                                console.error('[SCHEDULER] Channel invite link resolve failed:', e.message);
                            }
                        }

                        if (!channelJid.endsWith('@newsletter')) {
                            channelJid += '@newsletter';
                        }

                        await activeSock.sendMessage(channelJid, { text: task.message });
                        console.log(`[SCHEDULE SENT] Channel: ${channelJid} at ${currentTime}`);
                    } 
                    // 💬 2. CHAT / USER / GROUP SCHEDULE
                    else if (task.type === 'chat') {
                        let targetJid = task.target.trim();

                        if (!targetJid.includes('@')) {
                            targetJid = targetJid.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                        }

                        let mentions = [];
                        if (targetJid.endsWith('@g.us') && task.message.includes('@')) {
                            const groupMeta = await activeSock.groupMetadata(targetJid).catch(() => null);
                            if (groupMeta) mentions = groupMeta.participants.map(p => p.id);
                        }

                        await activeSock.sendMessage(targetJid, { 
                            text: task.message, 
                            mentions: mentions.length > 0 ? mentions : undefined 
                        });
                        console.log(`[SCHEDULE SENT] Chat: ${targetJid} at ${currentTime}`);
                    }

                    // යැවූ බවට සටහන් කිරීම
                    await Schedule.updateOne({ _id: task._id }, { $set: { lastSent: sentIdentifier } });
                } catch (taskErr) {
                    console.error(`[SCHEDULE TASK FAILED] ID: ${task._id} -`, taskErr.message);
                }
            }
        } catch (error) {
            console.error('[SCHEDULER LOOP ERROR]:', error.message);
        }
    }, 20000);
}

module.exports = { Schedule, startSchedulerEngine, updateSchedulerSocket, getSLTime };

const mongoose = require('mongoose');

const scheduleSchema = new mongoose.Schema({
    type: { type: String, enum: ['chat', 'channel'], required: true },
    target: { type: String, required: true },
    message: { type: String, required: true },
    time: { type: String, required: true }, // e.g. "18:30"
    lastSentDate: { type: String, default: '' } // අද දවසේ යැව්වාද කියා සටහන් කරගනී
}, { timestamps: true });

const Schedule = mongoose.models.Schedule || mongoose.model('Schedule', scheduleSchema);

// ලංකාවේ වත්මන් වේලාව (HH:mm) සහ දිනය ලබාගැනීම
function getSLTimeAndDate() {
    const now = new Date();
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    const slDate = new Date(utc + (330 * 60000)); // +05:30

    const hours = String(slDate.getHours()).padStart(2, '0');
    const minutes = String(slDate.getMinutes()).padStart(2, '0');
    const year = slDate.getFullYear();
    const month = String(slDate.getMonth() + 1).padStart(2, '0');
    const day = String(slDate.getDate()).padStart(2, '0');

    return {
        time: `${hours}:${minutes}`,
        date: `${year}-${month}-${day}`
    };
}

function getSLTime() {
    return getSLTimeAndDate().time;
}

let schedulerTimer = null;

function startSchedulerEngine(sock) {
    if (schedulerTimer) clearInterval(schedulerTimer);

    console.log('⏰ [SCHEDULER ENGINE] Live and Running!');

    // තත්පර 15න් 15ට Active වී පරීක්ෂා කරයි
    schedulerTimer = setInterval(async () => {
        try {
            if (!sock || !sock.user) return;

            const { time: currentTime, date: currentDate } = getSLTimeAndDate();

            // මේ වේලාවට යැවිය යුතු Schedules සෙවීම
            const tasks = await Schedule.find({ time: currentTime });

            for (const task of tasks) {
                // අද දිනයට මේ Task එක දැනටමත් යවා ඇත්නම් නැවත යවන්නේ නැත
                if (task.lastSentDate === currentDate) continue;

                console.log(`[TRIGGER] Executing Schedule ID: ${task._id} at ${currentTime}`);

                // 1. Channel Schedule
                if (task.type === 'channel') {
                    let channelJid = task.target.trim();

                    if (channelJid.includes('whatsapp.com/channel/')) {
                        const code = channelJid.split('whatsapp.com/channel/')[1].split('/')[0].trim();
                        try {
                            const meta = await sock.newsletterMetadata('invite', code);
                            if (meta?.id) channelJid = meta.id;
                        } catch (err) {
                            console.error('[CHANNEL META FAIL]:', err.message);
                        }
                    }

                    if (!channelJid.endsWith('@newsletter')) channelJid += '@newsletter';

                    await sock.sendMessage(channelJid, { text: task.message }).catch(e => console.error('Channel send error:', e.message));
                } 
                // 2. Chat / Group Schedule
                else {
                    let targetJid = task.target.trim();

                    if (!targetJid.includes('@')) {
                        targetJid = targetJid.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                    }

                    await sock.sendMessage(targetJid, { text: task.message }).catch(e => console.error('Chat send error:', e.message));
                }

                // යැවූ බවට සටහන් කිරීම
                await Schedule.updateOne({ _id: task._id }, { $set: { lastSentDate: currentDate } });
                console.log(`✅ [SUCCESS] Scheduled Message Delivered to: ${task.target}`);
            }
        } catch (err) {
            console.error('[SCHEDULER LOOP ERROR]:', err.message);
        }
    }, 15000);
}

module.exports = { Schedule, startSchedulerEngine, getSLTime };

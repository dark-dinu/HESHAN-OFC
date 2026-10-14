const mongoose = require('mongoose');

const scheduleSchema = new mongoose.Schema({
    type: { type: String, enum: ['chat', 'channel'], required: true },
    target: { type: String, required: true },
    message: { type: String, required: true },
    time: { type: String, required: true, index: true }, // e.g. "18:30"
    lastSentTimestamp: { type: String, default: '' }     // "YYYY-MM-DD HH:mm"
}, { timestamps: true });

// ⚡ Fast Compound Index for High-Performance Queries
scheduleSchema.index({ time: 1, lastSentTimestamp: 1 });

const Schedule = mongoose.models.Schedule || mongoose.model('Schedule', scheduleSchema);

// ශ්‍රී ලංකා වේලාව (+05:30) සහ දිනය ලබා ගැනීම
function getSLTimeAndDate() {
    const now = new Date();
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    const sl = new Date(utc + (330 * 60000));

    const hours = String(sl.getHours()).padStart(2, '0');
    const minutes = String(sl.getMinutes()).padStart(2, '0');
    const year = sl.getFullYear();
    const month = String(sl.getMonth() + 1).padStart(2, '0');
    const day = String(sl.getDate()).padStart(2, '0');

    return {
        time: `${hours}:${minutes}`,
        date: `${year}-${month}-${day}`
    };
}

function getSLTime() {
    return getSLTimeAndDate().time;
}

function normalizeTime(t) {
    const m = String(t || '').match(/(\d{1,2})\s*[:.]\s*(\d{2})/);
    if (!m) return null;
    return `${m[1].padStart(2, '0')}:${m[2]}`;
}

let schedulerTimer = null;
const inFlightTasks = new Set(); // Concurrency Lock (දෙවරක් යැවීම 100% වළක්වයි)

function startSchedulerEngine(sock) {
    if (schedulerTimer) clearInterval(schedulerTimer);

    console.log('⏰ [SCHEDULER ENGINE] Live and Running!');

    // සෑම තත්පර 15කට වරක් Check කරයි
    schedulerTimer = setInterval(async () => {
        try {
            if (!sock || !sock.user) return;

            const { time: currentTime, date: currentDate } = getSLTimeAndDate();
            const currentSlot = `${currentDate} ${currentTime}`;

            // ⚡ Optimized DB Query (අදාළ වේලාව සහ තවම නොයැවූ tasks පමණක් DB එකෙන් ලබාගනී)
            const tasks = await Schedule.find({
                time: currentTime,
                lastSentTimestamp: { $ne: currentSlot }
            }).lean();

            if (!tasks || tasks.length === 0) return;

            for (const task of tasks) {
                const taskId = String(task._id);
                if (inFlightTasks.has(taskId)) continue;
                inFlightTasks.add(taskId);

                console.log(`[TRIGGER] Executing Schedule ID: ${taskId} at ${currentTime}`);

                let sentSuccessfully = false;

                try {
                    // 1. Channel Schedule
                    if (task.type === 'channel') {
                        let channelJid = task.target.trim();

                        if (channelJid.includes('whatsapp.com/channel/')) {
                            const code = channelJid.split('whatsapp.com/channel/')[1]?.split(/[\/?#]/)[0]?.trim();
                            if (code) {
                                try {
                                    const meta = await sock.newsletterMetadata('invite', code);
                                    if (meta?.id) channelJid = meta.id;
                                } catch (e) {
                                    console.error('[CHANNEL RESOLVE ERROR]:', e.message);
                                }
                            }
                        }

                        if (!channelJid.includes('@')) {
                            channelJid = `${channelJid}@newsletter`;
                        }

                        await sock.sendMessage(channelJid, { text: task.message });
                        sentSuccessfully = true;
                    } 
                    // 2. Chat Schedule
                    else {
                        let targetJid = task.target.trim();

                        if (!targetJid.includes('@')) {
                            targetJid = targetJid.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                        }

                        let mentions = [];
                        if (targetJid.endsWith('@g.us') && task.message.includes('@')) {
                            const groupMeta = await sock.groupMetadata(targetJid).catch(() => null);
                            if (groupMeta?.participants) {
                                mentions = groupMeta.participants.map(p => p.id);
                            }
                        }

                        await sock.sendMessage(targetJid, { 
                            text: task.message, 
                            mentions: mentions.length > 0 ? mentions : undefined 
                        });
                        sentSuccessfully = true;
                    }

                    if (sentSuccessfully) {
                        await Schedule.updateOne({ _id: task._id }, { $set: { lastSentTimestamp: currentSlot } });
                        console.log(`✅ [SUCCESS] Scheduled Message Delivered to: ${task.target}`);
                    }
                } catch (err) {
                    console.error(`❌ [SEND FAIL] ${task.target}:`, err.message);
                } finally {
                    inFlightTasks.delete(taskId);
                }
            }
        } catch (err) {
            console.error('[SCHEDULER LOOP ERROR]:', err.message);
        }
    }, 15000);
}

module.exports = { Schedule, startSchedulerEngine, getSLTime, getSLTimeAndDate, normalizeTime };

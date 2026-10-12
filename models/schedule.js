const mongoose = require('mongoose');

const scheduleSchema = new mongoose.Schema({
    type: { type: String, enum: ['chat', 'channel'], required: true },
    target: { type: String, required: true },
    message: { type: String, required: true },
    time: { type: String, required: true }, // e.g. "18:30"
    lastSentDate: { type: String, default: '' }
}, { timestamps: true });

const Schedule = mongoose.models.Schedule || mongoose.model('Schedule', scheduleSchema);

// ලංකාවේ වේලාව (server timezone එක මොකක් වුණත් නිවැරදියි)
function getSLTimeAndDate() {
    const p = Object.fromEntries(
        new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Colombo',
            hourCycle: 'h23',
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit'
        }).formatToParts(new Date()).map(x => [x.type, x.value])
    );
    return {
        time: `${p.hour}:${p.minute}`,
        date: `${p.year}-${p.month}-${p.day}`
    };
}

function getSLTime() {
    return getSLTimeAndDate().time;
}

// "6:30", "06.30", "18:30" ඕනෑම විදිහක් "HH:mm" බවට හරවයි
function normalizeTime(t) {
    const m = String(t || '').match(/(\d{1,2})\s*[:.]\s*(\d{2})/);
    if (!m) return null;
    return `${m[1].padStart(2, '0')}:${m[2]}`;
}

let schedulerTimer = null;

function startSchedulerEngine(sock) {
    if (schedulerTimer) clearInterval(schedulerTimer);

    console.log('⏰ [SCHEDULER ENGINE] Live and Running!');

    schedulerTimer = setInterval(async () => {
        try {
            if (!sock || !sock.user) return;

            const { time: currentTime, date: currentDate } = getSLTimeAndDate();

            // අද තවම යවලා නැති ඒවා පමණක් ගෙන, වේලාව normalize කර ගැලපීම
            const pending = await Schedule.find({ lastSentDate: { $ne: currentDate } });
            const tasks = pending.filter(t => normalizeTime(t.time) === currentTime);

            for (const task of tasks) {
                // Atomic claim: දෙවරක් යැවීම වැළැක්වීම
                const claimed = await Schedule.findOneAndUpdate(
                    { _id: task._id, lastSentDate: { $ne: currentDate } },
                    { $set: { lastSentDate: currentDate } }
                );
                if (!claimed) continue;

                console.log(`[TRIGGER] Executing Schedule ID: ${task._id} at ${currentTime}`);

                try {
                    if (task.type === 'channel') {
                        let channelJid = task.target.trim();

                        if (channelJid.includes('whatsapp.com/channel/')) {
                            const code = channelJid.split('whatsapp.com/channel/')[1].split('/')[0].trim();
                            const meta = await sock.newsletterMetadata('invite', code);
                            if (meta?.id) channelJid = meta.id;
                        }

                        if (!channelJid.endsWith('@newsletter')) channelJid += '@newsletter';

                        await sock.sendMessage(channelJid, { text: task.message });
                    } else {
                        let targetJid = task.target.trim();

                        if (!targetJid.includes('@')) {
                            targetJid = targetJid.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                        }

                        await sock.sendMessage(targetJid, { text: task.message });
                    }

                    console.log(`✅ [SUCCESS] Scheduled Message Delivered to: ${task.target}`);
                } catch (err) {
                    // යැවීම අසාර්ථක නම් නැවත උත්සාහ කිරීමට අයින් කරයි
                    console.error(`❌ [SEND FAIL] ${task.target}:`, err.message);
                    await Schedule.updateOne({ _id: task._id }, { $set: { lastSentDate: '' } });
                }
            }
        } catch (err) {
            console.error('[SCHEDULER LOOP ERROR]:', err.message);
        }
    }, 15000);
}

module.exports = { Schedule, startSchedulerEngine, getSLTime };

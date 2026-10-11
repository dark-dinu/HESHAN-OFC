const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    data: { type: Object, required: true }
}, { timestamps: true });

const Session = mongoose.models.Session || mongoose.model('Session', sessionSchema);

async function saveSession(sessionId, credsData) {
    try {
        await Session.findOneAndUpdate(
            { id: sessionId },
            { data: credsData },
            { upsert: true, new: true }
        );
        return true;
    } catch (e) {
        console.error('❌ MongoDB Save Error:', e.message);
        return false;
    }
}

async function getSession(sessionId) {
    try {
        const found = await Session.findOne({ id: sessionId });
        return found ? found.data : null;
    } catch (e) {
        console.error('❌ MongoDB Read Error:', e.message);
        return null;
    }
}

async function deleteSession(sessionId) {
    try {
        await Session.deleteOne({ id: sessionId });
        return true;
    } catch (e) {
        return false;
    }
}

module.exports = { saveSession, getSession, deleteSession };

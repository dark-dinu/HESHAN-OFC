const mongoose = require('mongoose');
const { BufferJSON } = require('@whiskeysockets/baileys');

const sessionSchema = new mongoose.Schema(
    {
        id: {
            type: String,
            required: true,
            unique: true,
            index: true
        },
        data: {
            type: String,
            required: true
        }
    },
    {
        timestamps: true
    }
);

const Session = mongoose.models.Session || mongoose.model('Session', sessionSchema);

// 🛡️ Session සහ Signal Encryption Keys සුරැකීම
async function saveSession(sessionId, credsData) {
    try {
        if (!sessionId || !credsData) return false;
        const serialized = JSON.stringify(credsData, BufferJSON.replacer);

        await Session.updateOne(
            { id: String(sessionId) },
            { $set: { data: serialized } },
            { upsert: true }
        );
        return true;
    } catch (error) {
        console.error('[AUTH SAVE ERROR]:', error.message);
        return false;
    }
}

// 🔑 Session සහ Signal Encryption Keys ලබා ගැනීම
async function getSession(sessionId) {
    try {
        if (!sessionId) return null;
        const doc = await Session.findOne({ id: String(sessionId) }).select('data').lean();
        if (!doc || !doc.data) return null;

        return JSON.parse(doc.data, BufferJSON.reviver);
    } catch (error) {
        console.error('[AUTH READ ERROR]:', error.message);
        return null;
    }
}

// 🗑️ Session එක පමණක් මකා දැමීම
async function deleteSession(sessionId) {
    try {
        if (!sessionId) return false;
        await Session.deleteOne({ id: String(sessionId) });
        return true;
    } catch (error) {
        console.error('[AUTH DELETE ERROR]:', error.message);
        return false;
    }
}

// ⚡ FACTORY RESET ENGINE: Logout වූ විට පැරණි සියලුම දත්ත මුලිනුපුටා දැමීම (Clean Wipe)
async function purgeAllUserData() {
    try {
        await Session.deleteMany({});
        
        // Settings Collection එක Clean කිරීම
        if (mongoose.connection.collections['settings']) {
            await mongoose.connection.collections['settings'].deleteMany({});
        }
        
        // Schedules Collection එක Clean කිරීම
        if (mongoose.connection.collections['schedules']) {
            await mongoose.connection.collections['schedules'].deleteMany({});
        }
        
        console.log('🧹 [FACTORY RESET] All user sessions, settings, and schedules wiped successfully!');
        return true;
    } catch (error) {
        console.error('[PURGE ERROR]:', error.message);
        return false;
    }
}

module.exports = {
    saveSession,
    getSession,
    deleteSession,
    purgeAllUserData,
    Session
};

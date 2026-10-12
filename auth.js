const mongoose = require("mongoose");
const { BufferJSON } = require("@whiskeysockets/baileys");

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

const Session = mongoose.models.Session || mongoose.model("Session", sessionSchema);

async function saveSession(sessionId, credsData) {
    try {
        if (!sessionId || !credsData) return false;
        const serialized = JSON.stringify(credsData, BufferJSON.replacer);

        await Session.findOneAndUpdate(
            { id: String(sessionId) },
            { $set: { data: serialized } },
            { upsert: true, new: true }
        );
        return true;
    } catch (error) {
        console.error("[SESSION SAVE ERROR]:", error.message);
        return false;
    }
}

async function getSession(sessionId) {
    try {
        if (!sessionId) return null;
        const session = await Session.findOne({ id: String(sessionId) }).lean();
        if (!session || !session.data) return null;

        return JSON.parse(session.data, BufferJSON.reviver);
    } catch (error) {
        console.error("[SESSION READ ERROR]:", error.message);
        return null;
    }
}

async function deleteSession(sessionId) {
    try {
        if (!sessionId) return false;
        await Session.deleteOne({ id: String(sessionId) });
        return true;
    } catch (error) {
        console.error("[SESSION DELETE ERROR]:", error.message);
        return false;
    }
}

module.exports = {
    saveSession,
    getSession,
    deleteSession,
    Session
};

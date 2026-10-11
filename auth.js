const mongoose = require("mongoose");

const sessionSchema = new mongoose.Schema(
    {
        id: {
            type: String,
            required: true,
            unique: true,
            index: true
        },
        data: {
            type: mongoose.Schema.Types.Mixed,
            required: true
        }
    },
    {
        timestamps: true,
        minimize: false
    }
);

const Session =
    mongoose.models.Session ||
    mongoose.model("Session", sessionSchema);

async function waitForMongo() {
    if (mongoose.connection.readyState === 1) {
        return true;
    }

    if (mongoose.connection.readyState === 2) {
        await mongoose.connection.asPromise();
        return true;
    }

    throw new Error(
        "MongoDB is not connected. Check your MONGO_URI or MONGODB_URL."
    );
}

async function saveSession(sessionId, credsData) {
    try {
        if (!sessionId) {
            throw new Error("Session ID is missing.");
        }

        if (
            credsData === undefined ||
            credsData === null
        ) {
            throw new Error("Session data is empty.");
        }

        await waitForMongo();

        await Session.findOneAndUpdate(
            { id: String(sessionId) },
            {
                $set: {
                    data: credsData
                }
            },
            {
                upsert: true,
                new: true,
                runValidators: true,
                setDefaultsOnInsert: true
            }
        );

        return true;
    } catch (error) {
        console.error(
            "[SESSION SAVE ERROR]",
            error.message
        );

        return false;
    }
}

async function getSession(sessionId) {
    try {
        if (!sessionId) {
            throw new Error("Session ID is missing.");
        }

        await waitForMongo();

        const session = await Session.findOne({
            id: String(sessionId)
        }).lean();

        if (!session) {
            return null;
        }

        return session.data ?? null;
    } catch (error) {
        console.error(
            "[SESSION READ ERROR]",
            error.message
        );

        return null;
    }
}

async function deleteSession(sessionId) {
    try {
        if (!sessionId) {
            throw new Error("Session ID is missing.");
        }

        await waitForMongo();

        await Session.deleteOne({
            id: String(sessionId)
        });

        return true;
    } catch (error) {
        console.error(
            "[SESSION DELETE ERROR]",
            error.message
        );

        return false;
    }
}

module.exports = {
    saveSession,
    getSession,
    deleteSession,
    Session
};

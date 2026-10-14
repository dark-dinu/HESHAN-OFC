const mongoose = require('mongoose');

const defaultSettings = {
    autoSeen: false,
    autoReact: false,
    autoSave: false,
    mode: 'public',
    autoVoice: false,
    autoReply: false,
    antiDelete: true,
    antiViewOnce: true,
    antiSendDest: 'me', // 'me' (Private Inbox) හෝ 'from' (Current Chat)
    alwaysOnline: false,
    antiCall: true,
    autoRead: false // ⚡ Auto Read (Chat Messages)
};

const settingsSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    autoSeen: { type: Boolean, default: false },
    autoReact: { type: Boolean, default: false },
    autoSave: { type: Boolean, default: false },
    mode: { type: String, default: 'public' },
    autoVoice: { type: Boolean, default: false },
    autoReply: { type: Boolean, default: false },
    antiDelete: { type: Boolean, default: true },
    antiViewOnce: { type: Boolean, default: true },
    antiSendDest: { type: String, default: 'me' },
    alwaysOnline: { type: Boolean, default: false },
    antiCall: { type: Boolean, default: true },
    autoRead: { type: Boolean, default: false } // ⚡ Auto Read DB Field
}, { timestamps: true });

const Settings = mongoose.models.Settings || mongoose.model('Settings', settingsSchema);

// Memory RAM Cache (Instant Access for Handlers)
global.botSettings = { ...defaultSettings };

async function loadSettings() {
    try {
        let current = await Settings.findOne({ key: 'main_settings' }).lean();
        if (!current) {
            current = await Settings.create({ key: 'main_settings', ...defaultSettings });
            current = current.toObject();
        }
        global.botSettings = { ...defaultSettings, ...current };
        console.log('⚙️ Bot Settings Loaded from MongoDB.');
    } catch (err) {
        console.error('Failed to load settings from DB, using defaults:', err.message);
        global.botSettings = { ...defaultSettings };
    }
}

async function updateSetting(field, value) {
    global.botSettings[field] = value;
    try {
        await Settings.updateOne(
            { key: 'main_settings' }, 
            { $set: { [field]: value } }, 
            { upsert: true }
        );
    } catch (err) {
        console.error(`Failed to persist setting [${field}]:`, err.message);
    }
}

module.exports = { Settings, loadSettings, updateSetting };

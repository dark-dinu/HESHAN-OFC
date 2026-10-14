const mongoose = require('mongoose');

const defaultSettings = Object.freeze({
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
    autoRead: false     // ⚡ Auto Read (Chat Messages Blue Tick)
});

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
    autoRead: { type: Boolean, default: false }
}, { timestamps: true });

const Settings = mongoose.models.Settings || mongoose.model('Settings', settingsSchema);

// ⚡ In-Memory Fast Cache (Handlers වෙත Zero Delay Access)
global.botSettings = { ...defaultSettings };

async function loadSettings() {
    try {
        let current = await Settings.findOne({ key: 'main_settings' }).lean();
        if (!current) {
            current = await Settings.create({ key: 'main_settings', ...defaultSettings });
            current = current.toObject();
        }
        global.botSettings = { ...defaultSettings, ...current };
        console.log('⚙️ Bot Settings Loaded & Synchronized.');
    } catch (err) {
        console.error('Failed to load settings, using defaults:', err.message);
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

// 🧹 Factory Reset වූ විට Settings මුල සිට යළි සකසන ශ්‍රිතය
async function resetSettingsToDefault() {
    global.botSettings = { ...defaultSettings };
    try {
        await Settings.deleteMany({});
        await Settings.create({ key: 'main_settings', ...defaultSettings });
        console.log('⚙️ Settings restored to factory defaults.');
    } catch (err) {
        console.error('Failed to reset settings:', err.message);
    }
}

module.exports = { 
    Settings, 
    loadSettings, 
    updateSetting, 
    resetSettingsToDefault,
    defaultSettings 
};

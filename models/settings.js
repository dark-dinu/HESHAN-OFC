const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    autoSeen: { type: Boolean, default: false },
    autoReact: { type: Boolean, default: false },
    autoSave: { type: Boolean, default: false },
    mode: { type: String, default: 'public' },
    autoVoice: { type: Boolean, default: false },
    autoReply: { type: Boolean, default: false },
    antiDelete: { type: Boolean, default: true },
    antiDeleteDest: { type: String, default: 'me' }, // 🎯 'me' (Private Inbox) හෝ 'from' (Current Chat)
    antiViewOnce: { type: Boolean, default: true },
    alwaysOnline: { type: Boolean, default: false },
    antiCall: { type: Boolean, default: true }
}, { timestamps: true });

const Settings = mongoose.models.Settings || mongoose.model('Settings', settingsSchema);

global.botSettings = {
    autoSeen: false,
    autoReact: false,
    autoSave: false,
    mode: 'public',
    autoVoice: false,
    autoReply: false,
    antiDelete: true,
    antiDeleteDest: 'me',
    antiViewOnce: true,
    alwaysOnline: false,
    antiCall: true
};

async function loadSettings() {
    try {
        let current = await Settings.findOne({ key: 'main_settings' });
        if (!current) {
            current = await Settings.create({ key: 'main_settings' });
        }
        global.botSettings = current.toObject();
        console.log('⚙️ Bot Settings Loaded from MongoDB.');
    } catch (err) {
        console.error('Failed to load settings:', err.message);
    }
}

async function updateSetting(field, value) {
    global.botSettings[field] = value;
    await Settings.updateOne({ key: 'main_settings' }, { $set: { [field]: value } }, { upsert: true });
}

module.exports = { Settings, loadSettings, updateSetting };

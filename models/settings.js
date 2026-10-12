const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema({
    id: { type: String, default: 'bot_settings', unique: true },
    autoSeen: { type: Boolean, default: true },
    autoReact: { type: Boolean, default: true },
    autoSave: { type: Boolean, default: false },
    mode: { type: String, default: 'public' }, // 'public', 'private', 'group'
    autoVoice: { type: Boolean, default: false },
    autoReply: { type: Boolean, default: false },
    antiDelete: { type: Boolean, default: true },
    antiViewOnce: { type: Boolean, default: true },
    alwaysOnline: { type: Boolean, default: true }
});

const Settings = mongoose.models.Settings || mongoose.model('Settings', settingsSchema);

async function loadSettings() {
    let config = await Settings.findOne({ id: 'bot_settings' });
    if (!config) {
        config = await Settings.create({ id: 'bot_settings' });
    }
    global.botSettings = config.toObject();
    return global.botSettings;
}

async function updateSetting(key, value) {
    const updated = await Settings.findOneAndUpdate(
        { id: 'bot_settings' },
        { $set: { [key]: value } },
        { new: true, upsert: true }
    );
    global.botSettings = updated.toObject();
    return global.botSettings;
}

module.exports = { Settings, loadSettings, updateSetting };

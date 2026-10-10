const mongoose = require("mongoose");

const SettingsSchema = new mongoose.Schema({
  id: { type: String, default: "bot_settings", unique: true },
  
  // Status Settings
  statusSeen: { type: Boolean, default: true },
  statusReact: { type: Boolean, default: true },
  reactEmoji: { type: String, default: "😘" },
  
  // Audio & Voice Engine Settings
  voiceNoteMode: { type: Boolean, default: true }, // Sends audio as playable PTT voice notes
  
  // Access Architecture
  workType: { type: String, default: "private" }
});

const SettingsModel = mongoose.models.BotSettings || mongoose.model("BotSettings", SettingsSchema);

// In-Memory Fast Cache (DB hit latency අඩු කිරීමට)
let cachedSettings = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 60 * 1000; // තත්පර 60ක් cache කර තබා ගනී

async function getSettings() {
  const now = Date.now();
  if (cachedSettings && (now - lastFetchTime) < CACHE_TTL_MS) {
    return cachedSettings;
  }

  try {
    let settings = await SettingsModel.findOne({ id: "bot_settings" });
    if (!settings) {
      settings = await SettingsModel.create({ id: "bot_settings" });
    }
    cachedSettings = settings;
    lastFetchTime = now;
    return settings;
  } catch (err) {
    console.error("Database settings fetch error:", err.message);
    if (cachedSettings) return cachedSettings;

    return {
      statusSeen: true,
      statusReact: true,
      reactEmoji: "😘",
      voiceNoteMode: true,
      workType: "private",
      save: async () => {}
    };
  }
}

// Settings update වූ සැණින් cache එක flush කිරීමේ helper එක
function invalidateSettingsCache() {
  cachedSettings = null;
  lastFetchTime = 0;
}

module.exports = { SettingsModel, getSettings, invalidateSettingsCache };

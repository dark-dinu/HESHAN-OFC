const mongoose = require("mongoose");

const SettingsSchema = new mongoose.Schema({
  id: { type: String, default: "bot_settings", unique: true },
  
  // Status Settings
  statusSeen: { type: Boolean, default: true },
  statusReact: { type: Boolean, default: true },
  reactEmoji: { type: String, default: "😘" },
  
  // Private Bot Architecture
  workType: { type: String, default: "private" }
});

const SettingsModel = mongoose.models.BotSettings || mongoose.model("BotSettings", SettingsSchema);

async function getSettings() {
  try {
    let settings = await SettingsModel.findOne({ id: "bot_settings" });
    if (!settings) {
      settings = await SettingsModel.create({ id: "bot_settings" });
    }
    return settings;
  } catch (err) {
    console.error("Database settings fetch error:", err.message);
    // MongoDB connection ප්‍රමාද වුවහොත් bot එක crash නොවීමට default object එකක් ලබා දීම
    return {
      statusSeen: true,
      statusReact: true,
      reactEmoji: "😘",
      workType: "private",
      save: async () => {}
    };
  }
}

module.exports = { SettingsModel, getSettings };

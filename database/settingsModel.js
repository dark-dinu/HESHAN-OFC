const mongoose = require("mongoose");

const SettingsSchema = new mongoose.Schema({
  id: { type: String, default: "bot_settings", unique: true },
  
  // Status Settings
  statusSeen: { type: Boolean, default: false },
  statusReact: { type: Boolean, default: false },
  reactEmoji: { type: String, default: "🥰" },
  
  // ඉස්සරහට එන ඕනෑම setting එකක් මෙතනට ලේසියෙන්ම add කරන්න පුළුවන්
  workType: { type: String, default: "private" } // private or public
});

const SettingsModel = mongoose.models.BotSettings || mongoose.model("BotSettings", SettingsSchema);

// Setting එකක් ගන්න හෝ අලුතින් හදන්න helper function එක
async function getSettings() {
  let settings = await SettingsModel.findOne({ id: "bot_settings" });
  if (!settings) {
    settings = await SettingsModel.create({ id: "bot_settings" });
  }
  return settings;
}

module.exports = { SettingsModel, getSettings };

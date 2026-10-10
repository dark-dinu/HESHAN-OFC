const mongoose = require("mongoose");

const ScheduleSchema = new mongoose.Schema({
  targetJid: { type: String, required: true },
  targetName: { type: String, default: "" },
  targetType: { type: String, default: "chat" }, // chat | group | channel
  message: { type: String, default: "" },
  targetTime: { type: String, required: true }, // Format "HH:mm" (e.g. "10:00")
  mediaBuffer: { type: String, default: null }, // Base64 encoded media
  mediaType: { type: String, default: null },   // image | video | audio | document
  caption: { type: String, default: "" },
  lastExecutedDate: { type: String, default: "" }, // Prevents duplicate sends
  createdAt: { type: Date, default: Date.now }
});

const ScheduleModel = mongoose.models.ScheduleMessages || mongoose.model("ScheduleMessages", ScheduleSchema);

module.exports = ScheduleModel;

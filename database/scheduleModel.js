const mongoose = require("mongoose");

const ScheduleSchema = new mongoose.Schema({
  targetJid: { type: String, required: true, index: true },
  targetName: { type: String, default: "" },
  targetType: { type: String, default: "chat" }, // chat | group | channel
  message: { type: String, default: "" },
  targetTime: { type: String, required: true, index: true }, // Format "HH:mm" (e.g. "10:00")
  mediaBuffer: { type: String, default: null }, // Base64 encoded media
  mediaType: { type: String, default: null },   // image | video | audio | document
  caption: { type: String, default: "" },
  isPtt: { type: Boolean, default: false },     // Voice Note (Push to Talk / Waveform) flag
  lastExecutedDate: { type: String, default: "" }, // Prevents duplicate sends
  createdAt: { type: Date, default: Date.now }
});

// Single-minute lookup latency එක අවම කිරීමට compound index එකක් එක් කිරීම
ScheduleSchema.index({ targetTime: 1, lastExecutedDate: 1 });

const ScheduleModel = mongoose.models.ScheduleMessages || mongoose.model("ScheduleMessages", ScheduleSchema);

module.exports = ScheduleModel;

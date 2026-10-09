const mongoose = require("mongoose");
const { downloadMediaMessage } = require("@whiskeysockets/baileys");
const config = require("../config");

// Database Model
const StatusSchema = new mongoose.Schema({
  id: { type: String, default: "status_config", unique: true },
  autoRead: { type: Boolean, default: false },
  autoReact: { type: Boolean, default: false },
  emoji: { type: String, default: "🥰" }
});

const StatusModel = mongoose.models.StatusSettings || mongoose.model("StatusSettings", StatusSchema);

async function getConfig() {
  let conf = await StatusModel.findOne({ id: "status_config" });
  if (!conf) conf = await StatusModel.create({ id: "status_config" });
  return conf;
}

const statusCache = new Map();
const SAVE_TRIGGERS = [
  "oni", "ona", "ewanna", "evanna", "denna", "send", "save", 
  "dapan", "ewapan", "evapan", "one", "දාපන්", "එවන්න", "දෙන්න", "ඕනි", "ඕන"
];

const RANDOM_EMOJIS = ["❤️", "🔥", "🥰", "😍", "✨", "💯", "👏", "🤍"];
let isListenerActive = false;

function initStatusWatcher(sock) {
  if (isListenerActive || !sock) return;
  isListenerActive = true;
  console.log("✅ [STATUS SERVICE] Started");

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    const msg = messages[0];
    if (!msg || !msg.message || !msg.key) return;

    const from = msg.key.remoteJid;

    // 1. Status Broadcast Handling (Auto Seen & React)
    if (from === "status@broadcast") {
      const statusId = msg.key.id;
      const sender = msg.key.participant;

      // Status එක memory එකේ තබා ගැනීම (පැය 24ක්)
      if (statusId) {
        statusCache.set(statusId, msg);
        setTimeout(() => statusCache.delete(statusId), 24 * 60 * 60 * 1000);
      }

      if (msg.key.fromMe) return;

      try {
        const conf = await getConfig();

        // Auto Seen (නිවැරදි Baileys Status Mark)
        if (conf.autoRead) {
          await sock.readMessages([
            {
              remoteJid: "status@broadcast",
              id: statusId,
              participant: sender
            }
          ]);
        }

        // Auto React
        if (conf.autoReact && statusId && sender) {
          let selectedEmoji = conf.emoji;
          if (selectedEmoji.toLowerCase() === "random") {
            selectedEmoji = RANDOM_EMOJIS[Math.floor(Math.random() * RANDOM_EMOJIS.length)];
          }

          await sock.sendMessage(
            "status@broadcast",
            {
              react: {
                text: selectedEmoji,
                key: msg.key
              }
            },
            { statusJidList: [sender] }
          );
        }
      } catch (err) {
        console.error("Status Seen/React error:", err.message);
      }
      return;
    }

    // 2. Status Saver (oni, ewanna, etc.)
    const msgType = Object.keys(msg.message)[0];
    const msgText = (
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      msg.message[msgType]?.caption ||
      ""
    ).trim().toLowerCase();

    if (!msgText) return;

    const isTrigger = SAVE_TRIGGERS.some(trig => msgText === trig || msgText.startsWith(trig + " "));
    if (!isTrigger) return;

    const contextInfo = msg.message.extendedTextMessage?.contextInfo;
    const quotedMsgId = contextInfo?.stanzaId;

    if (quotedMsgId && statusCache.has(quotedMsgId)) {
      const targetStatus = statusCache.get(quotedMsgId);
      const isMyStatus = targetStatus.key.fromMe;
      const myJid = sock.user.id.split(":")[0] + "@s.whatsapp.net";
      const senderJid = msg.key.remoteJid;

      try {
        const sm = targetStatus.message;
        const sType = Object.keys(sm)[0];

        // Destination එක තීරණය කිරීම (මම ඉල්ලුවොත් මට, වෙන කෙනෙක් මගෙන් ඉල්ලුවොත් එයාට)
        const sendTo = isMyStatus ? senderJid : myJid;

        if (sType === "imageMessage") {
          const buffer = await downloadMediaMessage(targetStatus, "buffer", {});
          await sock.sendMessage(sendTo, { image: buffer, caption: sm.imageMessage.caption || "" });
        } else if (sType === "videoMessage") {
          const buffer = await downloadMediaMessage(targetStatus, "buffer", {});
          await sock.sendMessage(sendTo, { video: buffer, caption: sm.videoMessage.caption || "" });
        } else if (sType === "extendedTextMessage" || sType === "conversation") {
          const textContent = sm.extendedTextMessage?.text || sm.conversation || "";
          await sock.sendMessage(sendTo, { text: textContent });
        }
      } catch (err) {
        console.error("Status Save Error:", err.message);
      }
    }
  });
}

module.exports = {
  name: "st",
  aliases: ["react"],
  initStatusWatcher,
  async execute({ sock, msg, text, prefix, reply }) {
    initStatusWatcher(sock);

    const rawText = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();
    const cleanText = rawText.startsWith(prefix) ? rawText.slice(prefix.length).trim() : rawText;
    const parts = cleanText.split(/\s+/);
    const trigger = parts[0].toLowerCase();
    const param = parts.slice(1).join(" ").trim();

    let conf = await getConfig();

    if (trigger === "react") {
      if (!param) {
        return reply(`*Status React Config* ⚙️\n• Emoji: ${conf.emoji}\n• Auto React: ${conf.autoReact ? "ON 🟢" : "OFF 🔴"}`);
      } else if (param.toLowerCase() === "off") {
        conf.autoReact = false;
        await conf.save();
        return reply("Auto React: *OFF 🔴*");
      } else {
        conf.emoji = param;
        conf.autoReact = true;
        await conf.save();
        return reply(`Status React: *${param}* (Auto React ON 🟢)`);
      }
    } else if (trigger === "st") {
      if (param.toLowerCase() === "on") {
        conf.autoRead = true;
        await conf.save();
        return reply("Status Auto Seen: *ON 🟢*");
      } else if (param.toLowerCase() === "off") {
        conf.autoRead = false;
        await conf.save();
        return reply("Status Auto Seen: *OFF 🔴*");
      } else {
        return reply(`*${config.BOT_NAME} - STATUS CONFIG* ⚙️\n\n• Auto Seen: ${conf.autoRead ? "ON 🟢" : "OFF 🔴"}\n• Auto React: ${conf.autoReact ? "ON 🟢" : "OFF 🔴"}\n• React Emoji: ${conf.emoji}`);
      }
    }
  }
};

const mongoose = require("mongoose");
const { downloadMediaMessage } = require("@whiskeysockets/baileys");
const config = require("../config");

// 1. Database Model
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
  console.log("Status Watcher Service Started 🚀");

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    const msg = messages[0];
    if (!msg?.message || !msg?.key) return;

    // A. Status පැමිණි විට
    if (msg.key.remoteJid === "status@broadcast") {
      if (msg.key.id) {
        statusCache.set(msg.key.id, msg);
        setTimeout(() => statusCache.delete(msg.key.id), 24 * 60 * 60 * 1000);
      }

      if (msg.key.fromMe) return;

      try {
        const conf = await getConfig();

        // 1. Status Auto Seen (Correct Baileys format)
        if (conf.autoRead) {
          await sock.readMessages([
            {
              remoteJid: "status@broadcast",
              id: msg.key.id,
              participant: msg.key.participant
            }
          ]);
        }

        // 2. Status Auto React
        if (conf.autoReact && msg.key.id) {
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
            { statusJidList: [msg.key.participant] }
          );
        }
      } catch (err) {
        console.error("Status Seen/React Error:", err.message);
      }
      return;
    }

    // B. Status Reply / Saver Trigger Logic
    const msgText = (
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      ""
    ).trim().toLowerCase();

    const isTrigger = SAVE_TRIGGERS.some(trig => msgText === trig || msgText.startsWith(trig + " "));
    if (!isTrigger) return;

    const contextInfo = msg.message.extendedTextMessage?.contextInfo;
    const quotedMsgId = contextInfo?.stanzaId;

    if (quotedMsgId && statusCache.has(quotedMsgId)) {
      const targetStatus = statusCache.get(quotedMsgId);
      const isMyStatus = targetStatus.key.fromMe;
      const senderJid = msg.key.participant || msg.key.remoteJid;
      const ownerJid = config.OWNER_NUMBER.replace(/[^0-9]/g, "") + "@s.whatsapp.net";

      try {
        const m = targetStatus.message;
        const msgType = Object.keys(m)[0];

        // Photo Status
        if (msgType === "imageMessage") {
          const buffer = await downloadMediaMessage(targetStatus, "buffer", {});
          const caption = m.imageMessage.caption || "";

          if (isMyStatus) {
            await sock.sendMessage(senderJid, { image: buffer, caption }, { quoted: msg });
          } else if (msg.key.fromMe) {
            await sock.sendMessage(ownerJid, { image: buffer, caption });
          }
        }
        // Video Status
        else if (msgType === "videoMessage") {
          const buffer = await downloadMediaMessage(targetStatus, "buffer", {});
          const caption = m.videoMessage.caption || "";

          if (isMyStatus) {
            await sock.sendMessage(senderJid, { video: buffer, caption }, { quoted: msg });
          } else if (msg.key.fromMe) {
            await sock.sendMessage(ownerJid, { video: buffer, caption });
          }
        }
        // Text Status
        else if (msgType === "extendedTextMessage" || msgType === "conversation") {
          const statusText = m.extendedTextMessage?.text || m.conversation || "";

          if (isMyStatus) {
            await sock.sendMessage(senderJid, { text: statusText }, { quoted: msg });
          } else if (msg.key.fromMe) {
            await sock.sendMessage(ownerJid, { text: statusText });
          }
        }
      } catch (err) {
        console.error("Status Send/Save Error:", err.message);
      }
    }
  });
}

module.exports = {
  name: "st",
  aliases: ["react"],
  initStatusWatcher,
  async execute(sock, msg, args) {
    const prefix = config.PREFIX || ",";
    const rawText = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();
    const cleanText = rawText.startsWith(prefix) ? rawText.slice(prefix.length).trim() : rawText;
    const parts = cleanText.split(/\s+/);
    const trigger = parts[0].toLowerCase();
    const param = parts.slice(1).join(" ").trim();

    let conf = await getConfig();
    let reply = "";

    if (trigger === "react") {
      if (!param) {
        reply = `*Status React Config*\n• Emoji: ${conf.emoji}\n• Auto React: ${conf.autoReact ? "ON 🟢" : "OFF 🔴"}`;
      } else if (param.toLowerCase() === "off") {
        conf.autoReact = false;
        await conf.save();
        reply = "Auto React: *OFF 🔴*";
      } else {
        conf.emoji = param;
        conf.autoReact = true;
        await conf.save();
        reply = `Status React: *${param}* (Auto React ON 🟢)`;
      }
    } else if (trigger === "st") {
      if (param.toLowerCase() === "on") {
        conf.autoRead = true;
        await conf.save();
        reply = "Status Auto Seen: *ON 🟢*";
      } else if (param.toLowerCase() === "off") {
        conf.autoRead = false;
        await conf.save();
        reply = "Status Auto Seen: *OFF 🔴*";
      } else {
        reply = `*STATUS CONFIG* ⚙️\n• Auto Seen: ${conf.autoRead ? "ON 🟢" : "OFF 🔴"}\n• Auto React: ${conf.autoReact ? "ON 🟢" : "OFF 🔴"}\n• Emoji: ${conf.emoji}`;
      }
    }

    if (reply) {
      await sock.sendMessage(msg.key.remoteJid, { text: reply }, { quoted: msg });
    }
  }
};

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

// Memory Cache: Status messages තාවකාලිකව තබා ගැනීම (Save / Send සඳහා)
const statusCache = new Map();

// Triggers List (Status Saver සඳහා)
const SAVE_TRIGGERS = [
  "oni", "ona", "ewanna", "evanna", "denna", "send", "save", 
  "dapan", "ewapan", "evapan", "one", "දාපන්", "එවන්න", "දෙන්න", "ඕනි", "ඕන"
];

let isListenerActive = false;

function initStatusWatcher(sock) {
  if (isListenerActive) return;
  isListenerActive = true;

  const RANDOM_EMOJIS = ["❤️", "🔥", "🥰", "😍", "✨", "💯", "👏", "🤍"];

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    const msg = messages[0];
    if (!msg?.message) return;

    // A. Status පැමිණි විට Cache එකට එක් කිරීම සහ Auto Read / Auto React ක්‍රියාත්මක වීම
    if (msg.key.remoteJid === "status@broadcast") {
      if (msg.key.id) {
        statusCache.set(msg.key.id, msg);
        setTimeout(() => statusCache.delete(msg.key.id), 24 * 60 * 60 * 1000);
      }

      if (msg.key.fromMe) return;

      try {
        const conf = await getConfig();

        // Auto Seen (Read)
        if (conf.autoRead) {
          await sock.readMessages([msg.key]);
        }

        // Auto React
        if (conf.autoReact && msg.key.id) {
          let selectedEmoji = conf.emoji;
          if (selectedEmoji.toLowerCase() === "random") {
            selectedEmoji = RANDOM_EMOJIS[Math.floor(Math.random() * RANDOM_EMOJIS.length)];
          }

          await sock.sendMessage(
            "status@broadcast",
            { react: { text: selectedEmoji, key: msg.key } },
            { statusJidList: [msg.key.participant] }
          );
        }
      } catch (e) {}
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

      try {
        const m = targetStatus.message;
        const msgType = Object.keys(m)[0];

        // 1. Photo Status
        if (msgType === "imageMessage") {
          const buffer = await downloadMediaMessage(targetStatus, "buffer", {});
          const caption = m.imageMessage.caption || "";

          if (isMyStatus) {
            await sock.sendMessage(senderJid, { image: buffer, caption: caption });
          } else if (msg.key.fromMe) {
            const myJid = sock.user.id.split(":")[0] + "@s.whatsapp.net";
            await sock.sendMessage(myJid, { image: buffer, caption: caption });
          }
        }
        // 2. Video Status
        else if (msgType === "videoMessage") {
          const buffer = await downloadMediaMessage(targetStatus, "buffer", {});
          const caption = m.videoMessage.caption || "";

          if (isMyStatus) {
            await sock.sendMessage(senderJid, { video: buffer, caption: caption });
          } else if (msg.key.fromMe) {
            const myJid = sock.user.id.split(":")[0] + "@s.whatsapp.net";
            await sock.sendMessage(myJid, { video: buffer, caption: caption });
          }
        }
        // 3. Text Status
        else if (msgType === "extendedTextMessage" || msgType === "conversation") {
          const statusText = m.extendedTextMessage?.text || m.conversation || "";

          if (isMyStatus) {
            await sock.sendMessage(senderJid, { text: statusText });
          } else if (msg.key.fromMe) {
            const myJid = sock.user.id.split(":")[0] + "@s.whatsapp.net";
            await sock.sendMessage(myJid, { text: statusText });
          }
        }
      } catch (err) {
        console.error("Status Send/Save Error:", err.message);
      }
    }
  });
}

// 3. Control Command (Prefix සහිතව ක්‍රියාත්මක වේ: ,st / ,react)
module.exports = {
  name: "st",
  aliases: ["react"],
  async execute(sock, msg, args) {
    initStatusWatcher(sock);

    const prefix = config.PREFIX || ",";
    const rawText = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();
    
    // Prefix ඉවත් කර arguments වෙන් කර ගැනීම
    const cleanText = rawText.startsWith(prefix) ? rawText.slice(prefix.length).trim() : rawText;
    const parts = cleanText.split(/\s+/);
    const trigger = parts[0].toLowerCase();
    const param = parts.slice(1).join(" ").trim();

    let conf = await getConfig();
    let reply = "";

    if (trigger === "react") {
      if (!param) {
        reply = `*Status React Config* ⚙️\n• Emoji: ${conf.emoji}\n• Auto React: ${conf.autoReact ? "ON 🟢" : "OFF 🔴"}\n\n_Use: ${prefix}react <emoji> or ${prefix}react off_`;
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
        reply = `*${config.BOT_NAME} - STATUS CONFIG* ⚙️\n\n• Auto Seen: ${conf.autoRead ? "ON 🟢" : "OFF 🔴"}\n• Auto React: ${conf.autoReact ? "ON 🟢" : "OFF 🔴"}\n• React Emoji: ${conf.emoji}\n• Status Saver: *ACTIVE ⚡*\n\n_Commands:_\n• ${prefix}st on / off\n• ${prefix}react <emoji> / off`;
      }
    }

    if (reply) {
      await sock.sendMessage(msg.key.remoteJid, { text: reply }, { quoted: msg });
    }
  }
};

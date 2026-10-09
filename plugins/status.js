const mongoose = require("mongoose");
const { downloadMediaMessage } = require("@whiskeysockets/baileys");

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

// Memory Cache: Status messages තාවකාලිකව තියාගන්න (Save / Send කරගන්න)
const statusCache = new Map();

// Triggers List (ඕනෑම අකුරකින් ආවත් අහුවෙන්න)
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

    // A. Status ආවම Cache එකට දාගැනීම සහ Auto Read / Auto React වීම
    if (msg.key.remoteJid === "status@broadcast") {
      // Status එක memory cache එකට දාගන්නවා
      if (msg.key.id) {
        statusCache.set(msg.key.id, msg);
        // Cache එක ඕනවට වඩා ලොකු නොවෙන්න පැය 24කට පසු clear වෙනවා
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

    // Trigger එකක්දැයි බැලීම
    const isTrigger = SAVE_TRIGGERS.some(trig => msgText === trig || msgText.startsWith(trig + " "));
    if (!isTrigger) return;

    const contextInfo = msg.message.extendedTextMessage?.contextInfo;
    const quotedMsgId = contextInfo?.stanzaId;

    // Status එකකට reply එකක් නම් පමණක් වැඩ කිරීම
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
            // වෙන කෙනෙක් මගේ status එකක් ඉල්ලුවම -> ඒ කෙනාට යවන්න
            await sock.sendMessage(senderJid, { image: buffer, caption: caption });
          } else if (msg.key.fromMe) {
            // මම වෙන කෙනෙක්ගේ status එකක් ඉල්ලුවම -> මගේ inbox එකට දාගන්න
            await sock.sendMessage(sock.user.id.split(":")[0] + "@s.whatsapp.net", { image: buffer, caption: caption });
          }
        }
        // 2. Video Status
        else if (msgType === "videoMessage") {
          const buffer = await downloadMediaMessage(targetStatus, "buffer", {});
          const caption = m.videoMessage.caption || "";

          if (isMyStatus) {
            await sock.sendMessage(senderJid, { video: buffer, caption: caption });
          } else if (msg.key.fromMe) {
            await sock.sendMessage(sock.user.id.split(":")[0] + "@s.whatsapp.net", { video: buffer, caption: caption });
          }
        }
        // 3. Text Status
        else if (msgType === "extendedTextMessage" || msgType === "conversation") {
          const statusText = m.extendedTextMessage?.text || m.conversation || "";

          if (isMyStatus) {
            await sock.sendMessage(senderJid, { text: statusText });
          } else if (msg.key.fromMe) {
            await sock.sendMessage(sock.user.id.split(":")[0] + "@s.whatsapp.net", { text: statusText });
          }
        }
      } catch (err) {
        console.error("Status Send/Save Error:", err.message);
      }
    }
  });
}

// 3. Control Command (Settings manage කරන්න)
module.exports = {
  name: "st",
  aliases: ["react"],
  async execute(sock, msg, args) {
    initStatusWatcher(sock);

    const rawText = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();
    const parts = rawText.split(/\s+/);
    const trigger = parts[0].toLowerCase();
    const param = parts.slice(1).join(" ").trim();

    let conf = await getConfig();
    let reply = "";

    if (trigger === "react") {
      if (!param) {
        reply = `Emoji: ${conf.emoji} | Auto React: ${conf.autoReact ? "ON 🟢" : "OFF 🔴"}`;
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
        reply = `*Status System* ⚙️\n• Auto Seen: ${conf.autoRead ? "ON 🟢" : "OFF 🔴"}\n• Auto React: ${conf.autoReact ? "ON 🟢" : "OFF 🔴"}\n• React Emoji: ${conf.emoji}\n• Status Saver & Auto Sender: *ACTIVE ⚡*`;
      }
    }

    if (reply) {
      await sock.sendMessage(msg.key.remoteJid, { text: reply }, { quoted: msg });
    }
  }
};

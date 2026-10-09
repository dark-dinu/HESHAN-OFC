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
  console.log("✅ [STATUS SERVICE] Active & Listening...");

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    const msg = messages[0];
    if (!msg || !msg.message || !msg.key) return;

    const from = msg.key.remoteJid;

    // ==========================================
    // A. STATUS BROADCAST (Seen & React)
    // ==========================================
    if (from === "status@broadcast") {
      const statusId = msg.key.id;
      const sender = msg.key.participant;

      // Status එක Cache එකට දාගැනීම
      if (statusId) {
        statusCache.set(statusId, msg);
        setTimeout(() => statusCache.delete(statusId), 24 * 60 * 60 * 1000);
      }

      // තමන් දාපු status නම් seen/react නොකර අත්හරින්න
      if (msg.key.fromMe) return;

      try {
        const conf = await getConfig();

        // 1. AUTO SEEN (READ)
        if (conf.autoRead) {
          await sock.readMessages([msg.key]);
          console.log(`👁️ Status Seen: ${sender.split("@")[0]}`);
        }

        // 2. AUTO REACT
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
          console.log(`❤️ Status Reacted [${selectedEmoji}] to ${sender.split("@")[0]}`);
        }
      } catch (err) {
        console.error("❌ Status Action Error:", err.message);
      }
      return;
    }

    // ==========================================
    // B. STATUS SAVER / SENDER (oni, ewanna, etc.)
    // ==========================================
    const msgType = Object.keys(msg.message)[0];
    const msgText = (
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      msg.message[msgType]?.caption ||
      ""
    ).trim().toLowerCase();

    if (!msgText) return;

    // Trigger එකක්දැයි පරීක්ෂා කිරීම
    const isTrigger = SAVE_TRIGGERS.some(trig => msgText === trig || msgText.startsWith(trig + " "));
    if (!isTrigger) return;

    // Quoted message එකක් තියෙනවද බැලීම
    const contextInfo = msg.message.extendedTextMessage?.contextInfo;
    const quotedMsgId = contextInfo?.stanzaId;

    if (quotedMsgId && statusCache.has(quotedMsgId)) {
      const targetStatus = statusCache.get(quotedMsgId);
      const isMyStatus = targetStatus.key.fromMe;
      const targetChat = msg.key.remoteJid;
      const ownerJid = config.OWNER_NUMBER.replace(/[^0-9]/g, "") + "@s.whatsapp.net";

      try {
        const sm = targetStatus.message;
        const sType = Object.keys(sm)[0];

        // 1. Photo Status
        if (sType === "imageMessage") {
          const buffer = await downloadMediaMessage(targetStatus, "buffer", {});
          const caption = sm.imageMessage.caption || "";

          if (isMyStatus) {
            await sock.sendMessage(targetChat, { image: buffer, caption }, { quoted: msg });
          } else if (msg.key.fromMe) {
            await sock.sendMessage(ownerJid, { image: buffer, caption });
          }
        }
        // 2. Video Status
        else if (sType === "videoMessage") {
          const buffer = await downloadMediaMessage(targetStatus, "buffer", {});
          const caption = sm.videoMessage.caption || "";

          if (isMyStatus) {
            await sock.sendMessage(targetChat, { video: buffer, caption }, { quoted: msg });
          } else if (msg.key.fromMe) {
            await sock.sendMessage(ownerJid, { video: buffer, caption });
          }
        }
        // 3. Text Status
        else if (sType === "extendedTextMessage" || sType === "conversation") {
          const statusText = sm.extendedTextMessage?.text || sm.conversation || "";

          if (isMyStatus) {
            await sock.sendMessage(targetChat, { text: statusText }, { quoted: msg });
          } else if (msg.key.fromMe) {
            await sock.sendMessage(ownerJid, { text: statusText });
          }
        }
        console.log("📥 Status Saver/Sender executed successfully!");
      } catch (err) {
        console.error("❌ Status Saver Error:", err.message);
      }
    }
  });
}

// ==========================================
// C. COMMAND CONTROL (,st on / ,react 🥰)
// ==========================================
module.exports = {
  name: "st",
  aliases: ["react"],
  initStatusWatcher,
  async execute({ sock, msg, text, args, prefix, reply }) {
    initStatusWatcher(sock);

    const rawText = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();
    const cleanText = rawText.startsWith(prefix) ? rawText.slice(prefix.length).trim() : rawText;
    const parts = cleanText.split(/\s+/);
    const trigger = parts[0].toLowerCase();
    const param = parts.slice(1).join(" ").trim();

    let conf = await getConfig();

    if (trigger === "react") {
      if (!param) {
        return reply(`*Status React Config* ⚙️\n• Emoji: ${conf.emoji}\n• Auto React: ${conf.autoReact ? "ON 🟢" : "OFF 🔴"}\n\n_Use: ${prefix}react <emoji> or ${prefix}react off_`);
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
        return reply(`*${config.BOT_NAME} - STATUS CONFIG* ⚙️\n\n• Auto Seen: ${conf.autoRead ? "ON 🟢" : "OFF 🔴"}\n• Auto React: ${conf.autoReact ? "ON 🟢" : "OFF 🔴"}\n• React Emoji: ${conf.emoji}\n• Status Saver: *ACTIVE ⚡*\n\n_Commands:_\n• ${prefix}st on / off\n• ${prefix}react <emoji> / off`);
      }
    }
  }
};

const { downloadMediaMessage } = require("@whiskeysockets/baileys");
const { getSettings } = require("../database/settingsModel");
const config = require("../config");

// Save triggers
const SAVE_TRIGGERS = [
  "ඔනි", "ඕනි", "එවන්න", "දෙන්න", "දීපන්", "දාපන්",
  "oni", "ona", "ewanna", "evanna", "danna", "dapan", "ewapan", "diyan", 
  "save", "ewannako", "dannako", "send", "denna", "one"
];

// Status message cache (පැය 24ක් තබා ගනී)
if (!global.statusCache) {
  global.statusCache = new Map();
}

let isWatcherInitialized = false;

function initStatusWatcher(sock) {
  if (isWatcherInitialized || !sock) return;
  isWatcherInitialized = true;
  console.log("⚡ [STATUS ENGINE] 100% Synchronized & Running");

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    const msg = messages[0];
    if (!msg?.message || !msg?.key) return;

    const from = msg.key.remoteJid;

    // ==========================================
    // 1. STATUS BROADCAST (Seen & Auto React)
    // ==========================================
    if (from === "status@broadcast") {
      const statusId = msg.key.id;
      const participant = msg.key.participant;

      if (!statusId || !participant) return;

      // Cache the status
      global.statusCache.set(statusId, msg);
      setTimeout(() => global.statusCache.delete(statusId), 24 * 60 * 60 * 1000);

      // තමන් දාන status නම් skip
      if (msg.key.fromMe) return;

      try {
        const settings = await getSettings();

        // A. AUTO SEEN
        if (settings.statusSeen) {
          await sock.readMessages([
            {
              remoteJid: "status@broadcast",
              id: statusId,
              participant: participant
            }
          ]);
          console.log(`👁️ [SEEN] Status from ${participant.split("@")[0]}`);
        }

        // B. AUTO REACT (😘)
        if (settings.statusReact) {
          const emoji = settings.reactEmoji || "😘";
          await sock.sendMessage(
            "status@broadcast",
            {
              react: {
                text: emoji,
                key: {
                  remoteJid: "status@broadcast",
                  id: statusId,
                  participant: participant,
                  fromMe: false
                }
              }
            },
            { statusJidList: [participant] }
          );
          console.log(`😘 [REACT] Reacted ${emoji} to${participant.split("@")[0]}`);
        }
      } catch (err) {
        console.error("❌ Status seen/react error:", err.message);
      }
      return;
    }

    // ==========================================
    // 2. STATUS SAVER & SENDER (oni, ewanna, etc.)
    // ==========================================
    const mType = Object.keys(msg.message)[0];
    const text = (
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      msg.message[mType]?.caption ||
      ""
    ).trim().toLowerCase();

    if (!text) return;

    // Check Trigger
    const isTrigger = SAVE_TRIGGERS.some(trig => text === trig || text.startsWith(trig + " "));
    if (!isTrigger) return;

    const contextInfo = msg.message.extendedTextMessage?.contextInfo;
    if (!contextInfo || !contextInfo.quotedMessage) return;

    const quotedId = contextInfo.stanzaId;
    const quotedParticipant = contextInfo.participant;
    const quotedMsg = contextInfo.quotedMessage;

    // Status එකකට reply කර ඇති බව තහවුරු කර ගැනීම
    const isStatusQuoted = 
      contextInfo.remoteJid === "status@broadcast" || 
      (quotedParticipant && !from.endsWith("@g.us") && !quotedParticipant.endsWith("@s.whatsapp.net")) ||
      global.statusCache.has(quotedId);

    // Media Object එක නිවැරදිව සකස් කිරීම
    const rawTarget = global.statusCache.get(quotedId);
    const downloadTarget = rawTarget || {
      key: {
        remoteJid: "status@broadcast",
        id: quotedId,
        participant: quotedParticipant
      },
      message: quotedMsg
    };

    const targetType = Object.keys(downloadTarget.message)[0];
    const myCleanNumber = config.OWNER_NUMBER.replace(/[^0-9]/g, "");
    const myJid = `${myCleanNumber}@s.whatsapp.net`;
    const senderNumber = (msg.key.participant || from).split("@")[0].replace(/[^0-9]/g, "");
    const isOwnerAsking = msg.key.fromMe || senderNumber === myCleanNumber;

    // Destination:
    // මම ඉල්ලුවොත් ➔ මගේ Chat එකට (Saved messages / self chat)
    // වෙන කෙනෙක් මගෙන් ඉල්ලුවොත් ➔ ඒ කෙනාගේ Chat එකට
    const destination = isOwnerAsking ? myJid : from;

    try {
      if (targetType === "imageMessage") {
        const buffer = await downloadMediaMessage(downloadTarget, "buffer", {});
        await sock.sendMessage(
          destination,
          {
            image: buffer,
            caption: downloadTarget.message.imageMessage?.caption || ""
          },
          !isOwnerAsking ? { quoted: msg } : {}
        );
        console.log(`✅ [SAVER] Image status sent to ${destination}`);
      } else if (targetType === "videoMessage") {
        const buffer = await downloadMediaMessage(downloadTarget, "buffer", {});
        await sock.sendMessage(
          destination,
          {
            video: buffer,
            caption: downloadTarget.message.videoMessage?.caption || ""
          },
          !isOwnerAsking ? { quoted: msg } : {}
        );
        console.log(`✅ [SAVER] Video status sent to ${destination}`);
      } else if (targetType === "extendedTextMessage" || targetType === "conversation") {
        const str = downloadTarget.message.extendedTextMessage?.text || downloadTarget.message.conversation || "";
        await sock.sendMessage(
          destination,
          { text: str },
          !isOwnerAsking ? { quoted: msg } : {}
        );
        console.log(`✅ [SAVER] Text status sent to ${destination}`);
      }
    } catch (err) {
      console.error("❌ Status media download/send failed:", err.message);
    }
  });
}

// ==========================================
// 3. COMMAND INTERFACE (.st seen on/off)
// ==========================================
module.exports = {
  name: "st",
  aliases: ["status"],
  initStatusWatcher,
  async execute({ sock, reply, args, prefix, react }) {
    initStatusWatcher(sock);
    react("⚙️").catch(() => {});

    const sub = (args[0] || "").toLowerCase();
    const val = (args[1] || "").toLowerCase();
    const settings = await getSettings();

    if (sub === "seen") {
      if (val === "on") {
        settings.statusSeen = true;
        await settings.save();
        return reply("Status Auto Seen: *ON 🟢* (Saved Permanently)");
      } else if (val === "off") {
        settings.statusSeen = false;
        await settings.save();
        return reply("Status Auto Seen: *OFF 🔴* (Saved Permanently)");
      }
      return reply(`භාවිතය: *${prefix}st seen on* හෝ *${prefix}st seen off*`);
    }

    if (sub === "react") {
      if (val === "on") {
        settings.statusReact = true;
        await settings.save();
        return reply(`Status Auto React: *ON 🟢* (Emoji: ${settings.reactEmoji})`);
      } else if (val === "off") {
        settings.statusReact = false;
        await settings.save();
        return reply("Status Auto React: *OFF 🔴* (Saved Permanently)");
      } else if (args[1]) {
        settings.reactEmoji = args[1];
        settings.statusReact = true;
        await settings.save();
        return reply(`Status Auto React Emoji: *${args[1]}* (ON 🟢)`);
      }
      return reply(`භාවිතය: *${prefix}st react on* හෝ *${prefix}st react off*`);
    }

    return reply(
`*❬ 𝐇𝐄𝐒𝐇𝐀𝐍 𝐎𝐅𝐂 - STATUS SYSTEM ❭* ⚙️

> *Auto Seen*  : ${settings.statusSeen ? "ON 🟢" : "OFF 🔴"}
> *Auto React* : ${settings.statusReact ? "ON 🟢" : "OFF 🔴"}
> *React Emoji*: ${settings.reactEmoji}
> *Status Saver*: ACTIVE ⚡

*Settings Commands:*
• \`${prefix}st seen on / off\`
• \`${prefix}st react on / off\`
• \`${prefix}st react <emoji>\``
    );
  }
};

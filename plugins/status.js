const { downloadMediaMessage } = require("@whiskeysockets/baileys");
const { getSettings } = require("../database/settingsModel");
const config = require("../config");

// Triggers list
const SAVE_TRIGGERS = [
  "ඔනි", "ඕනි", "එවන්න", "දෙන්න", "දීපන්", "දාපන්",
  "oni", "ewanna", "danna", "dapan", "ewapan", "diyan", 
  "save", "ewannako", "dannako", "send", "denna", "one"
];

// Status Caching Map (පැය 24ක් memory එකේ තබා ගනී)
if (!global.statusCache) {
  global.statusCache = new Map();
}

let isWatcherInitialized = false;

function initStatusWatcher(sock) {
  if (isWatcherInitialized || !sock) return;
  isWatcherInitialized = true;

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    const msg = messages[0];
    if (!msg?.message || !msg?.key) return;

    const from = msg.key.remoteJid;

    // ==========================================
    // A. STATUS BROADCAST (Seen & React)
    // ==========================================
    if (from === "status@broadcast") {
      const statusId = msg.key.id;
      const participant = msg.key.participant;

      // Status එක Cache එකට එකතු කිරීම
      if (statusId) {
        global.statusCache.set(statusId, msg);
        setTimeout(() => global.statusCache.delete(statusId), 24 * 60 * 60 * 1000);
      }

      // තමන් දාපු status නම් bypass
      if (msg.key.fromMe) return;

      try {
        const settings = await getSettings();

        // 1. Auto Seen
        if (settings.statusSeen) {
          await sock.readMessages([
            {
              remoteJid: "status@broadcast",
              id: statusId,
              participant: participant
            }
          ]);
        }

        // 2. Auto React (😘)
        if (settings.statusReact && statusId && participant) {
          const emoji = settings.reactEmoji || "😘";
          await sock.sendMessage(
            "status@broadcast",
            {
              react: {
                text: emoji,
                key: msg.key
              }
            },
            { statusJidList: [participant] }
          );
        }
      } catch (err) {}
      return;
    }

    // ==========================================
    // B. STATUS SAVER & AUTO SENDER
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

    // Quoted context පරීක්ෂාව
    const contextInfo = msg.message.extendedTextMessage?.contextInfo;
    const quotedId = contextInfo?.stanzaId;

    if (quotedId && global.statusCache.has(quotedId)) {
      const targetStatus = global.statusCache.get(quotedId);
      const isMyStatus = targetStatus.key.fromMe;
      const myJid = sock.user.id.split(":")[0] + "@s.whatsapp.net";
      const senderJid = msg.key.remoteJid;

      // මම ඉල්ලුවොත් මගේ Inbox එකට, වෙන කෙනෙක් මගෙන් ඉල්ලුවොත් එයාගේ Chat එකට
      const destination = isMyStatus ? senderJid : myJid;

      try {
        const sMsg = targetStatus.message;
        const sType = Object.keys(sMsg)[0];

        // 1. Photo Status
        if (sType === "imageMessage") {
          const buffer = await downloadMediaMessage(targetStatus, "buffer", {});
          await sock.sendMessage(
            destination, 
            { image: buffer, caption: sMsg.imageMessage.caption || "" },
            isMyStatus ? { quoted: msg } : {}
          );
        }
        // 2. Video Status
        else if (sType === "videoMessage") {
          const buffer = await downloadMediaMessage(targetStatus, "buffer", {});
          await sock.sendMessage(
            destination, 
            { video: buffer, caption: sMsg.videoMessage.caption || "" },
            isMyStatus ? { quoted: msg } : {}
          );
        }
        // 3. Text Status
        else if (sType === "extendedTextMessage" || sType === "conversation") {
          const caption = sMsg.extendedTextMessage?.text || sMsg.conversation || "";
          await sock.sendMessage(
            destination, 
            { text: caption },
            isMyStatus ? { quoted: msg } : {}
          );
        }
      } catch (err) {
        console.error("Status Forward Error:", err.message);
      }
    }
  });
}

// ==========================================
// C. COMMAND CONTROL (.st seen on/off)
// ==========================================
module.exports = {
  name: "st",
  aliases: ["status"],
  initStatusWatcher,
  async execute({ sock, reply, args, prefix, react }) {
    initStatusWatcher(sock);
    react("⚙️").catch(() => {});

    const subCmd = (args[0] || "").toLowerCase();
    const value = (args[1] || "").toLowerCase();
    const settings = await getSettings();

    // 1. Seen On/Off
    if (subCmd === "seen") {
      if (value === "on") {
        settings.statusSeen = true;
        await settings.save();
        return reply("Status Auto Seen: *ON 🟢* (Saved)");
      } else if (value === "off") {
        settings.statusSeen = false;
        await settings.save();
        return reply("Status Auto Seen: *OFF 🔴* (Saved)");
      } else {
        return reply(`භාවිතය: *${prefix}st seen on* හෝ *${prefix}st seen off*`);
      }
    }

    // 2. React On/Off
    if (subCmd === "react") {
      if (value === "on") {
        settings.statusReact = true;
        await settings.save();
        return reply(`Status Auto React: *ON 🟢* (Emoji: ${settings.reactEmoji})`);
      } else if (value === "off") {
        settings.statusReact = false;
        await settings.save();
        return reply("Status Auto React: *OFF 🔴* (Saved)");
      } else if (args[1]) {
        settings.reactEmoji = args[1];
        settings.statusReact = true;
        await settings.save();
        return reply(`Status Auto React Emoji: *${args[1]}* (ON 🟢)`);
      } else {
        return reply(`භාවිතය: *${prefix}st react on* හෝ *${prefix}st react off*`);
      }
    }

    // Status Overview Panel
    return reply(
`*❬ 𝐇𝐄𝐒𝐇𝐀𝐍 𝐎𝐅𝐂 - STATUS CONFIG ❭* ⚙️

> *Auto Seen*  : ${settings.statusSeen ? "ON 🟢" : "OFF 🔴"}
> *Auto React* : ${settings.statusReact ? "ON 🟢" : "OFF 🔴"}
> *React Emoji*: ${settings.reactEmoji}
> *Auto Saver* : ACTIVE ⚡

*Commands:*
• \`${prefix}st seen on / off\`
• \`${prefix}st react on / off\`
• \`${prefix}st react <emoji>\``
    );
  }
};

const { downloadMediaMessage } = require("@whiskeysockets/baileys");
const { getSettings } = require("../database/settingsModel");

const SAVE_TRIGGERS = [
  "ඔනි", "ඕනි", "එවන්න", "දෙන්න", "දීපන්", "දාපන්",
  "oni", "ona", "ewanna", "evanna", "danna", "dapan", "ewapan", "diyan", 
  "save", "ewannako", "dannako", "send", "denna", "one"
];

if (!global.statusCache) {
  global.statusCache = new Map();
}

let isWatcherInitialized = false;

function initStatusWatcher(sock) {
  if (isWatcherInitialized || !sock) return;
  isWatcherInitialized = true;
  console.log("Status Watcher Service Running...");

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

      if (statusId) {
        global.statusCache.set(statusId, msg);
        setTimeout(() => global.statusCache.delete(statusId), 24 * 60 * 60 * 1000);
      }

      if (msg.key.fromMe) return;

      try {
        const settings = await getSettings();

        // Auto Seen
        if (settings.statusSeen) {
          await sock.readMessages([
            {
              remoteJid: "status@broadcast",
              id: statusId,
              participant: participant
            }
          ]);
        }

        // Auto React (😘)
        if (settings.statusReact && statusId && participant) {
          const emoji = settings.reactEmoji || "😘";
          await sock.sendMessage(
            "status@broadcast",
            { react: { text: emoji, key: msg.key } },
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

    const isTrigger = SAVE_TRIGGERS.some(trig => text === trig || text.startsWith(trig + " "));
    if (!isTrigger) return;

    const contextInfo = msg.message.extendedTextMessage?.contextInfo;
    if (!contextInfo) return;

    const quotedId = contextInfo.stanzaId;
    const quotedParticipant = contextInfo.participant;

    // Status එකකට reply කර ඇත්නම් පමණක් (remoteJid status@broadcast විය යුතුයි)
    const isStatusReply = contextInfo.remoteJid === "status@broadcast" || quotedParticipant?.includes("@s.whatsapp.net");
    if (!isStatusReply) return;

    // Cache එකෙන් ගන්නවා, නැත්නම් QuotedMessage එකෙන් කෙලින්ම ගන්නවා
    let targetStatus = global.statusCache.get(quotedId);
    let targetMsgObj = targetStatus || {
      key: {
        remoteJid: "status@broadcast",
        id: quotedId,
        participant: quotedParticipant
      },
      message: contextInfo.quotedMessage
    };

    if (!targetMsgObj?.message) return;

    const myJid = sock.user.id.split(":")[0] + "@s.whatsapp.net";
    const isMyStatus = targetMsgObj.key?.fromMe || quotedParticipant?.split("@")[0] === sock.user.id.split(":")[0];
    const destination = isMyStatus ? from : myJid;

    try {
      const sm = targetMsgObj.message;
      const sType = Object.keys(sm)[0];

      // 1. Photo Status
      if (sType === "imageMessage") {
        const buffer = await downloadMediaMessage(targetMsgObj, "buffer", {});
        await sock.sendMessage(
          destination, 
          { image: buffer, caption: sm.imageMessage?.caption || "" },
          isMyStatus ? { quoted: msg } : {}
        );
      }
      // 2. Video Status
      else if (sType === "videoMessage") {
        const buffer = await downloadMediaMessage(targetMsgObj, "buffer", {});
        await sock.sendMessage(
          destination, 
          { video: buffer, caption: sm.videoMessage?.caption || "" },
          isMyStatus ? { quoted: msg } : {}
        );
      }
      // 3. Text Status
      else if (sType === "extendedTextMessage" || sType === "conversation") {
        const caption = sm.extendedTextMessage?.text || sm.conversation || "";
        await sock.sendMessage(
          destination, 
          { text: caption },
          isMyStatus ? { quoted: msg } : {}
        );
      }
    } catch (err) {
      console.error("Status download error:", err.message);
    }
  });
}

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

    if (subCmd === "seen") {
      if (value === "on") {
        settings.statusSeen = true;
        await settings.save();
        return reply("Status Auto Seen: *ON 🟢* (Saved)");
      } else if (value === "off") {
        settings.statusSeen = false;
        await settings.save();
        return reply("Status Auto Seen: *OFF 🔴* (Saved)");
      }
    }

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
      }
    }

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

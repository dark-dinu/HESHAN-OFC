const { downloadMediaMessage } = require("@whiskeysockets/baileys");
const { getSettings } = require("../database/settingsModel");

// Global Status Cache සහ Processed Messages Tracker
global.statusCache = global.statusCache || new Map();
global.processedStatusRequests = global.processedStatusRequests || new Set();
global.statusHookedSockets = global.statusHookedSockets || new WeakSet();

// බොට් start වූ වෙලාව (බොට් run වෙන්න කලින් ආපු පරණ messages skip කිරීමට)
const BOT_BOOT_TIME = Math.floor(Date.now() / 1000);

// 1. Status Automation Watcher
function attachStatusWatcher(sock) {
  if (!sock || global.statusHookedSockets.has(sock)) return;
  global.statusHookedSockets.add(sock);

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    for (const m of messages) {
      if (!m?.message || !m?.key) continue;

      const from = m.key.remoteJid;

      // Status Broadcast Messages පමණක් අල්ලා ගැනීම
      if (from === "status@broadcast") {
        const statusId = m.key.id;
        const participant = m.key.participant || m.participant;

        if (statusId) {
          global.statusCache.set(statusId, m);
          // Status එක සාමාන්‍ය ලෙස පැය 12කට පසු auto delete වීම
          setTimeout(() => global.statusCache.delete(statusId), 12 * 60 * 60 * 1000);
        }

        if (m.key.fromMe || !participant) continue;

        try {
          const settings = await getSettings();

          // Auto Seen
          if (settings.statusSeen !== false) {
            await sock.readMessages([
              {
                remoteJid: "status@broadcast",
                id: statusId,
                participant: participant
              }
            ]).catch(() => {});
          }

          // Auto React
          if (settings.statusReact !== false) {
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
            ).catch(() => {});
          }
        } catch (err) {}
      }
    }
  });
}

// 2. Status Media Delivery Helper (Auto-Clean එක්ක)
async function deliverStatusMedia(sock, msg, from, targetStatusMsg, reqKey) {
  try {
    const statusObj = targetStatusMsg.message;
    const isImage = Boolean(statusObj.imageMessage);
    const isVideo = Boolean(statusObj.videoMessage);
    const isAudio = Boolean(statusObj.audioMessage);

    const defaultCaption = "> *✗ ʜᴇꜱʜᴀɴ ᴏꜰᴄ ✗*";

    if (isImage || isVideo || isAudio) {
      const buffer = await downloadMediaMessage(
        targetStatusMsg,
        "buffer",
        {},
        { reuploadRequest: sock.updateMediaMessage }
      );

      if (!buffer || buffer.length === 0) return false;

      if (isImage) {
        const cap = statusObj.imageMessage.caption 
          ? `${statusObj.imageMessage.caption}\n\n${defaultCaption}` 
          : defaultCaption;
        await sock.sendMessage(from, { image: buffer, caption: cap });
      } else if (isVideo) {
        const cap = statusObj.videoMessage.caption 
          ? `${statusObj.videoMessage.caption}\n\n${defaultCaption}` 
          : defaultCaption;
        await sock.sendMessage(from, { video: buffer, caption: cap });
      } else if (isAudio) {
        await sock.sendMessage(from, { audio: buffer, mimetype: "audio/mp4", ptt: false });
      }
    } else {
      const textStatus = statusObj.conversation || statusObj.extendedTextMessage?.text || "";
      await sock.sendMessage(from, {
        text: `📝 *STATUS TEXT:*\n\n${textStatus}\n\n${defaultCaption}`
      });
    }

    // Media එක එවූ පසු status cache එකෙන් එම status එක තත්පර 15කින් memory එකෙන් auto clear කිරීම
    const statusId = targetStatusMsg.key?.id;
    if (statusId) {
      setTimeout(() => {
        global.statusCache.delete(statusId);
      }, 15 * 1000); // තත්පර 15කින් සම්පූර්ණයෙන් clean වේ
    }

    return true;
  } catch (err) {
    return false;
  }
}

// 3. Command Module
module.exports = {
  name: "st",
  aliases: ["status", "stseen", "stract"],
  initStatusWatcher: attachStatusWatcher,

  async execute({ sock, msg, from, args, prefix }) {
    attachStatusWatcher(sock);

    const settings = await getSettings();
    const subCmd = (args[0] || "").toLowerCase();
    const value = (args[1] || "").toLowerCase();

    if (subCmd === "seen") {
      if (value === "on") {
        settings.statusSeen = true;
        await settings.save();
        return await sock.sendMessage(from, { text: "Status Auto Seen: *ON 🟢*" });
      } else if (value === "off") {
        settings.statusSeen = false;
        await settings.save();
        return await sock.sendMessage(from, { text: "Status Auto Seen: *OFF 🔴*" });
      }
    }

    if (subCmd === "react") {
      if (value === "on") {
        settings.statusReact = true;
        await settings.save();
        return await sock.sendMessage(from, { text: `Status Auto React: *ON 🟢* (${settings.reactEmoji})` });
      } else if (value === "off") {
        settings.statusReact = false;
        await settings.save();
        return await sock.sendMessage(from, { text: "Status Auto React: *OFF 🔴*" });
      } else if (args[1]) {
        settings.reactEmoji = args[1].trim();
        settings.statusReact = true;
        await settings.save();
        return await sock.sendMessage(from, { text: `Status React Emoji: *${settings.reactEmoji}* (ON 🟢)` });
      }
    }

    return await sock.sendMessage(from, {
      text: `*STATUS AUTOMATION PANEL*\n\nAuto Seen: ${settings.statusSeen ? "ON 🟢" : "OFF 🔴"}\nAuto React: ${settings.statusReact ? "ON 🟢" : "OFF 🔴"}\nReact Emoji: ${settings.reactEmoji}\n\n*Commands:*\n• ${prefix}st seen on / off\n• ${prefix}st react on / off\n• ${prefix}st react <emoji>`
    });
  },

  // 4. Interactive Reply Saver (Duplicate Loop Blocks & Auto Cleaning)
  async onReply({ sock, msg, from, body, quotedStanzaId }) {
    // A. Update/Restart වෙන්න කලින් ආපු පරණ messages නොසලකා හැරීම
    const msgTime = Number(msg.messageTimestamp || 0);
    if (msgTime && msgTime < BOT_BOOT_TIME) return false;

    // B. එකම request එක දෙපාරක් execute වීම වැළැක්වීම
    const requestKey = `${from}_${quotedStanzaId}_${msg.key.id}`;
    if (global.processedStatusRequests.has(requestKey)) return false;

    const rawWord = body.trim().toLowerCase();
    const triggers = ["oni", "ona", "ewanna", "දෙන්න", "ඕනි", "ඔනි", "send", "save", "දාපන්", "dapan", "danna"];
    if (!triggers.includes(rawWord)) return false;

    // මෙම request එක process වූ බව සටහන් කර ගැනීම
    global.processedStatusRequests.add(requestKey);
    setTimeout(() => global.processedStatusRequests.delete(requestKey), 60 * 1000);

    const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    const target = global.statusCache.get(quotedStanzaId) || (quotedMsg ? {
      key: { remoteJid: "status@broadcast", id: quotedStanzaId },
      message: quotedMsg
    } : null);

    if (!target) return false;

    return await deliverStatusMedia(sock, msg, from, target, requestKey);
  }
};

const { downloadMediaMessage } = require("@whiskeysockets/baileys");
const { getSettings } = require("../database/settingsModel");

global.statusCache = global.statusCache || new Map();
global.statusHookedSockets = global.statusHookedSockets || new WeakSet();

function attachStatusWatcher(sock) {
  if (!sock || global.statusHookedSockets.has(sock)) return;
  global.statusHookedSockets.add(sock);

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    for (const m of messages) {
      if (!m?.message || !m?.key) continue;

      const from = m.key.remoteJid;

      // Status Broadcast Messages පමණක් ගැනීම
      if (from === "status@broadcast") {
        const statusId = m.key.id;
        const participant = m.key.participant || m.participant;

        if (statusId) {
          global.statusCache.set(statusId, m);
          if (global.statusCache.size > 2000) {
            const firstKey = global.statusCache.keys().next().value;
            global.statusCache.delete(firstKey);
          }
        }

        if (m.key.fromMe || !participant) continue;

        try {
          const settings = await getSettings();

          // A. 100% Official WhatsApp Protocol Status Seen
          if (settings.statusSeen !== false) {
            await sock.readMessages([
              {
                remoteJid: "status@broadcast",
                id: statusId,
                participant: participant
              }
            ]);
          }

          // B. 100% Status Auto React
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
            );
          }
        } catch (err) {}
      }
    }
  });
}

async function deliverStatusMedia(sock, msg, from, targetStatusMsg) {
  try {
    const statusObj = targetStatusMsg.message;
    const isImage = Boolean(statusObj.imageMessage);
    const isVideo = Boolean(statusObj.videoMessage);
    const isAudio = Boolean(statusObj.audioMessage);

    const defaultCaption = "> *⚡ 𝐇𝐄𝐒𝐇𝐀𝐍 𝐎𝐅𝐂 𝐒𝐓𝐀𝐓𝐔𝐒 𝐒𝐀𝐕𝐄𝐑 ❄️*";

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
    return true;
  } catch (err) {
    return false;
  }
}

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
        return await sock.sendMessage(from, { text: `Status React: *${settings.reactEmoji}* (ON 🟢)` });
      }
    }

    return await sock.sendMessage(from, {
      text: `*STATUS AUTOMATION PANEL*\n\nAuto Seen: ${settings.statusSeen ? "ON 🟢" : "OFF 🔴"}\nAuto React: ${settings.statusReact ? "ON 🟢" : "OFF 🔴"}\nReact Emoji: ${settings.reactEmoji}\n\n*Commands:*\n• ${prefix}st seen on / off\n• ${prefix}st react on / off\n• ${prefix}st react <emoji>`
    });
  },

  async onReply({ sock, msg, from, body, quotedStanzaId }) {
    const rawWord = body.trim().toLowerCase();
    const triggers = ["oni", "ona", "ewanna", "දෙන්න", "ඕනි", "ඔනි", "send", "save", "දාපන්"];
    if (!triggers.includes(rawWord)) return false;

    const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    const target = global.statusCache.get(quotedStanzaId) || (quotedMsg ? {
      key: { remoteJid: "status@broadcast", id: quotedStanzaId },
      message: quotedMsg
    } : null);

    if (!target) return false;
    return await deliverStatusMedia(sock, msg, from, target);
  }
};

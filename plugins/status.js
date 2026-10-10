const { downloadMediaMessage } = require("@whiskeysockets/baileys");
const { getSettings } = require("../database/settingsModel");

// Global Cache & Hook Tracker
global.statusCache = global.statusCache || new Map();
global.statusHookedSockets = global.statusHookedSockets || new WeakSet();

// 1. Status Automation Watcher (Auto Seen & Auto React)
function attachStatusWatcher(sock) {
  if (!sock || global.statusHookedSockets.has(sock)) return;
  global.statusHookedSockets.add(sock);
  console.log("⚡ [STATUS ENGINE] Watcher Successfully Hooked & Active");

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    // Upsert type එක notify හෝ append දෙකෙන්ම status එන්න පුළුවන්
    for (const m of messages) {
      if (!m?.message || !m?.key) continue;

      const from = m.key.remoteJid;

      // Status Broadcast Messages පමණක් අල්ලා ගැනීම
      if (from === "status@broadcast") {
        const statusId = m.key.id;
        const participant = m.key.participant || m.participant;

        // Status Message එක Cache කිරීම
        if (statusId) {
          global.statusCache.set(statusId, m);
          if (global.statusCache.size > 2000) {
            const firstKey = global.statusCache.keys().next().value;
            global.statusCache.delete(firstKey);
          }
        }

        // තමන්ගේම Status නම් Auto Seen / React නොකරන්න
        if (m.key.fromMe || !participant) continue;

        try {
          const settings = await getSettings();

          // A. 100% STATUS AUTO SEEN (WhatsApp Web Official Protocol)
          if (settings.statusSeen !== false) {
            await sock.readMessages([
              {
                remoteJid: "status@broadcast",
                id: statusId,
                participant: participant
              }
            ]);
            console.log(`👁️ [SEEN] Marked status from: ${participant.split("@")[0]}`);
          }

          // B. 100% STATUS AUTO REACT (😘)
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
              {
                statusJidList: [participant]
              }
            );
            console.log(`😘 [REACT] Sent ${emoji} to:${participant.split("@")[0]}`);
          }
        } catch (err) {
          console.error("❌ [STATUS ACTION ERROR]:", err.message);
        }
      }
    }
  });
}

// 2. Status Media Delivery Helper
async function deliverStatusMedia(sock, msg, from, targetStatusMsg) {
  try {
    await sock.sendMessage(from, { react: { text: "⏳", key: msg.key } }).catch(() => {});

    const statusObj = targetStatusMsg.message;
    const isImage = Boolean(statusObj.imageMessage);
    const isVideo = Boolean(statusObj.videoMessage);
    const isAudio = Boolean(statusObj.audioMessage);

    const defaultCaption = "> *ʜᴇꜱʜᴀɴ ᴏꜰᴄ ✗*";

    if (isImage || isVideo || isAudio) {
      const buffer = await downloadMediaMessage(
        targetStatusMsg,
        "buffer",
        {},
        { reuploadRequest: sock.updateMediaMessage }
      );

      if (!buffer || buffer.length === 0) throw new Error("Media buffer empty");

      if (isImage) {
        const cap = statusObj.imageMessage.caption 
          ? `${statusObj.imageMessage.caption}\n\n${defaultCaption}` 
          : defaultCaption;
        await sock.sendMessage(from, { image: buffer, caption: cap }, { quoted: msg });
      } else if (isVideo) {
        const cap = statusObj.videoMessage.caption 
          ? `${statusObj.videoMessage.caption}\n\n${defaultCaption}` 
          : defaultCaption;
        await sock.sendMessage(from, { video: buffer, caption: cap }, { quoted: msg });
      } else if (isAudio) {
        await sock.sendMessage(from, { audio: buffer, mimetype: "audio/mp4", ptt: false }, { quoted: msg });
      }
    } else {
      const textStatus = statusObj.conversation || statusObj.extendedTextMessage?.text || "";
      await sock.sendMessage(from, {
        text: `📝 *STATUS TEXT:*\n\n${textStatus}\n\n${defaultCaption}`
      }, { quoted: msg });
    }

    await sock.sendMessage(from, { react: { text: "✅", key: msg.key } }).catch(() => {});
    return true;
  } catch (err) {
    console.error("[STATUS DELIVER ERROR]:", err.message);
    await sock.sendMessage(from, { react: { text: "❌", key: msg.key } }).catch(() => {});
    return false;
  }
}

// 3. Command Module Export
module.exports = {
  name: "st",
  aliases: ["status", "stseen", "stract", "ssave"],
  initStatusWatcher: attachStatusWatcher,

  async execute({ sock, msg, from, args, prefix, react }) {
    attachStatusWatcher(sock);

    const settings = await getSettings();
    const subCmd = (args[0] || "").toLowerCase();
    const value = (args[1] || "").toLowerCase();

    // A. Seen On/Off
    if (subCmd === "seen") {
      if (value === "on") {
        settings.statusSeen = true;
        await settings.save();
        react("🟢").catch(() => {});
        return await sock.sendMessage(from, { text: "Status Auto Seen: *ON 🟢* (Saved)" }, { quoted: msg });
      } else if (value === "off") {
        settings.statusSeen = false;
        await settings.save();
        react("🔴").catch(() => {});
        return await sock.sendMessage(from, { text: "Status Auto Seen: *OFF 🔴* (Saved)" }, { quoted: msg });
      }
      return await sock.sendMessage(from, { text: `⚠️ භාවිතය: \`${prefix}st seen on\` හෝ \`${prefix}st seen off\`` }, { quoted: msg });
    }

    // B. React On/Off
    if (subCmd === "react") {
      if (value === "on") {
        settings.statusReact = true;
        await settings.save();
        react("🟢").catch(() => {});
        return await sock.sendMessage(from, { text: `Status Auto React: *ON 🟢* (Emoji: ${settings.reactEmoji})` }, { quoted: msg });
      } else if (value === "off") {
        settings.statusReact = false;
        await settings.save();
        react("🔴").catch(() => {});
        return await sock.sendMessage(from, { text: "Status Auto React: *OFF 🔴* (Saved)" }, { quoted: msg });
      } else if (args[1]) {
        settings.reactEmoji = args[1].trim();
        settings.statusReact = true;
        await settings.save();
        react(settings.reactEmoji).catch(() => {});
        return await sock.sendMessage(from, { text: `Status React Emoji Updated: *${settings.reactEmoji}* (ON 🟢)` }, { quoted: msg });
      }
      return await sock.sendMessage(from, { text: `⚠️ භාවිතය: \`${prefix}st react on\` හෝ \`${prefix}st react <emoji>\`` }, { quoted: msg });
    }

    // C. Reply Saver via Command
    const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    const quotedId = msg.message?.extendedTextMessage?.contextInfo?.stanzaId;

    if (quoted) {
      const cached = global.statusCache.get(quotedId) || {
        key: { remoteJid: "status@broadcast", id: quotedId },
        message: quoted
      };
      return await deliverStatusMedia(sock, msg, from, cached);
    }

    // D. Settings Menu
    return await sock.sendMessage(from, {
      text: `╔══════════════════════╗
   👨🏻‍💻 𝐇 𝐄 𝐒 𝐇 𝐀 𝐍  𝐎 𝐅 𝐂 👨🏻‍💻
╚══════════════════════╝

┌─〔 📺 *STATUS AUTOMATION* 〕
├─▸ 👁️ *Auto Seen*  : ${settings.statusSeen ? "🟢 ON" : "🔴 OFF"}
├─▸ 💖 *Auto React* : ${settings.statusReact ? "🟢 ON" : "🔴 OFF"}
├─▸ 🎭 *React Emoji*: ${settings.reactEmoji}
└───────────────────────

📌 *පාලනය කිරීමට:*
• \`${prefix}st seen on\` / \`off\`
• \`${prefix}st react on\` / \`off\`
• \`${prefix}st react <emoji>\`

📥 *Status එකක් ලබාගැනීමට:*
Status එකකට Reply කර *oni*, *ewanna*, *දෙන්න*, *දාපන්* ලෙස යවන්න.`
    }, { quoted: msg });
  },

  // 4. Trigger Words Saver
  async onReply({ sock, msg, from, body, quotedStanzaId }) {
    const rawWord = body.trim().toLowerCase();

    const triggerWords = [
      "oni", "ඔනි", "ඕනි", "one", 
      "ewanna", "එවන්න", "ewapan", "එවපන්", "ewahan", "එවහන්",
      "dapan", "දාපන්", "danna", "දාන්න", "denna", "දෙන්න", "diyan", "දීපන්",
      "send", "sendme", "save", "saveme"
    ];

    if (!triggerWords.includes(rawWord)) return false;

    const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    const target = global.statusCache.get(quotedStanzaId) || (quotedMsg ? {
      key: { remoteJid: "status@broadcast", id: quotedStanzaId },
      message: quotedMsg
    } : null);

    if (!target) return false;

    return await deliverStatusMedia(sock, msg, from, target);
  }
};

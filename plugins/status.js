const { downloadMediaMessage } = require("@whiskeysockets/baileys");
const { getSettings } = require("../database/settingsModel");
const config = require("../config");

// Global Cache & Socket Tracker
global.statusCache = global.statusCache || new Map();
global.statusHookedSockets = global.statusHookedSockets || new WeakSet();

// 1. Status Automation Watcher (Auto Seen & Auto React)
function attachStatusWatcher(sock) {
  if (!sock || global.statusHookedSockets.has(sock)) return;
  global.statusHookedSockets.add(sock);
  console.log("⚡ [STATUS ENGINE] Watcher Successfully Hooked");

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    for (const m of messages) {
      if (!m?.message || !m?.key) continue;

      // Status Broadcast Messages පමණක් අල්ලා ගැනීම
      if (m.key.remoteJid === "status@broadcast") {
        const statusId = m.key.id;
        const participant = m.key.participant || m.participant;

        // Status Message එක Memory Cache කිරීම (Save/Send requests සඳහා)
        if (statusId) {
          global.statusCache.set(statusId, m);
          if (global.statusCache.size > 2000) {
            const firstKey = global.statusCache.keys().next().value;
            global.statusCache.delete(firstKey);
          }
        }

        // තමන්ගේම Status නම් Auto Seen / React නොකරන්න
        if (m.key.fromMe) continue;

        try {
          const settings = await getSettings();

          // A. 100% Status Auto Seen (Read Receipt)
          if (settings.statusSeen) {
            await sock.readMessages([m.key]).catch(() => {});
          }

          // B. Auto React (😘)
          if (settings.statusReact && participant) {
            const emoji = settings.reactEmoji || "😘";
            await sock.sendMessage(
              "status@broadcast",
              {
                react: {
                  text: emoji,
                  key: m.key
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

// 2. Status Media Delivery Engine (Photo, Video, Audio, Text)
async function deliverStatusMedia(sock, msg, from, targetStatusMsg) {
  try {
    await sock.sendMessage(from, { react: { text: "⏳", key: msg.key } }).catch(() => {});

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
      // Text Status
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

// 3. Status Command Export (𝐇𝐄𝐒𝐇𝐀𝐍 𝐎𝐅𝐂 Standards)
module.exports = {
  name: "st",
  aliases: ["status", "stseen", "stract", "ssave"],
  category: "utility",
  description: "Status automation controls and interactive status saver",
  initStatusWatcher: attachStatusWatcher,

  async execute({ sock, msg, from, args, prefix, react }) {
    attachStatusWatcher(sock);

    const settings = await getSettings();
    const subCmd = (args[0] || "").toLowerCase();
    const value = (args[1] || "").toLowerCase();

    // A. Seen On/Off (.st seen on / off)
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

    // B. React On/Off / Emoji (.st react on / off / <emoji>)
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

    // C. Quoted Status Save via Command (.st reply කර ගැසූ විට)
    const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    const quotedId = msg.message?.extendedTextMessage?.contextInfo?.stanzaId;

    if (quoted) {
      const cached = global.statusCache.get(quotedId) || {
        key: { remoteJid: "status@broadcast", id: quotedId },
        message: quoted
      };
      return await deliverStatusMedia(sock, msg, from, cached);
    }

    // D. Main Dashboard Status Panel
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
• \`${prefix}st seen on / off\`
• \`${prefix}st react on / off\`
• \`${prefix}st react <emoji>\`

📥 *Status එකක් ලබාගැනීමට:*
Status එකකට Reply කර *oni*, *ewanna*, *දෙන්න*, *දාපන්* ලෙස යවන්න.`
    }, { quoted: msg });
  },

  // 4. Interactive Reply Saver (oni, ewanna, dapan, etc.)
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

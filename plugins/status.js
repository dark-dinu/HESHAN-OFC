const { downloadMediaMessage } = require("@whiskeysockets/baileys");

// Bot Session Settings & Memory Cache
global.statusSettings = global.statusSettings || new Map();
global.statusCache = global.statusCache || new Map();
global.processedStatusRequests = global.processedStatusRequests || new Set();

const BOT_BOOT_TIME = Math.floor(Date.now() / 1000);

function getBotPhone(sock) {
  const userJid = sock.user?.id || "";
  return userJid.split(":")[0].replace(/[^0-9]/g, "");
}

function getSettings(botPhone, dbSettings) {
  if (!global.statusSettings.has(botPhone)) {
    global.statusSettings.set(botPhone, {
      seen: dbSettings?.get ? (dbSettings.get("autostatusseen") ?? true) : true,
      react: dbSettings?.get ? (dbSettings.get("autostatusreact") ?? true) : true,
      emoji: (dbSettings?.get ? dbSettings.get("statusEmoji") : null) || "😼"
    });
  }
  return global.statusSettings.get(botPhone);
}

// Status Media Sender Helper
async function deliverStatusMedia(sock, msg, from, targetStatusMsg) {
  try {
    await sock.sendMessage(from, { react: { text: "😒", key: msg.key } }).catch(() => {});

    const statusObj = targetStatusMsg.message;
    if (!statusObj) return false;

    const isImage = Boolean(statusObj.imageMessage);
    const isVideo = Boolean(statusObj.videoMessage);
    const isAudio = Boolean(statusObj.audioMessage);

    const defaultCaption = "> *ʜᴇꜱʜᴀɴ ᴏꜰᴄ 👑*";

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

    await sock.sendMessage(from, { react: { text: "😘", key: msg.key } }).catch(() => {});
    return true;
  } catch (err) {
    console.error("[STATUS DELIVER ERROR]:", err.message);
    await sock.sendMessage(from, { react: { text: "🥹", key: msg.key } }).catch(() => {});
    return false;
  }
}

module.exports = {
  name: "status",
  aliases: ["stseen", "stract", "setst", "statussave", "ssave"],
  category: "utility",
  description: "Status automation controls and interactive status saver",

  // 1. Core Event Hook (index.js එකෙන් status එකක් ආපු ගමන් call වේ)
  async onStatus({ sock, msg, settings }) {
    try {
      const statusId = msg.key?.id;
      const participant = msg.key?.participant || msg.participant;
      if (!statusId) return;

      // Status Cache
      global.statusCache.set(statusId, msg);
      setTimeout(() => global.statusCache.delete(statusId), 12 * 60 * 60 * 1000);

      if (msg.key.fromMe || !participant) return;

      const botPhone = getBotPhone(sock);
      const st = getSettings(botPhone, settings);

      // A. Auto Seen
      if (st.seen) {
        await sock.readMessages([{
          remoteJid: "status@broadcast",
          id: statusId,
          participant: participant
        }]).catch(() => {});
      }

      // B. Auto React
      if (st.react && st.emoji) {
        await sock.sendMessage(
          "status@broadcast",
          {
            react: {
              text: st.emoji,
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
  },

  // 2. Command Handlers (.status, .stseen, .stract, .setst)
  async execute({ sock, msg, from, args, body, prefix, isOwner, settings, reply }) {
    const botPhone = getBotPhone(sock);
    const st = getSettings(botPhone, settings);

    const firstWord = body.trim().slice(prefix.length).split(/ +/)[0].toLowerCase();

    // A. .setst react <emoji>
    if (firstWord === "setst") {
      if (!isOwner) return await reply("⛔ මෙය වෙනස් කළ හැක්කේ Bot Owner හට පමණි.");

      const subAction = args[0]?.toLowerCase();
      const newEmoji = (subAction === "react" ? args[1] : args[0])?.trim();

      if (!newEmoji) {
        return await reply(`⚠️ කරුණාකර Emoji එකක් ලබාදෙන්න.\n*භාවිතය:* \`${prefix}setst react 🥺\``);
      }

      st.emoji = newEmoji;
      global.statusSettings.set(botPhone, st);
      if (settings?.set) settings.set("statusEmoji", newEmoji);

      return await reply(`✅ *Status React Emoji යාවත්කාලීන විය:*\nනව Emoji: ${newEmoji}`);
    }

    // B. .stseen on/off
    if (firstWord === "stseen") {
      if (!isOwner) return await reply("⛔ මෙය වෙනස් කළ හැක්කේ Bot Owner හට පමණි.");

      const state = args[0]?.toLowerCase();
      if (state !== "on" && state !== "off") {
        return await reply(`⚠️ *භාවිතය:* \`${prefix}stseen on\` හෝ \`${prefix}stseen off\``);
      }

      const isTurnOn = state === "on";
      st.seen = isTurnOn;
      global.statusSettings.set(botPhone, st);
      if (settings?.set) settings.set("autostatusseen", isTurnOn);

      return await reply(`╔══════════════════════╗
   🕷️ 𝐇 𝐄 𝐒 𝐇 𝐀 𝐍  𝐎 𝐅 𝐂 🕷️
╚══════════════════════╝

┌─〔 ⚙️ *STATUS SEEN SETTINGS* 〕
├─▸ 🤖 *Bot Node* : +${botPhone}
├─▸ 🎯 *Feature*  : Auto Seen
├─▸ ⚡ *Status*   : ${isTurnOn ? "🟢 ON" : "🔴 OFF"}
└───────────────────────`);
    }

    // C. .stract on/off
    if (firstWord === "stract") {
      if (!isOwner) return await reply("⛔ මෙය වෙනස් කළ හැක්කේ Bot Owner හට පමණි.");

      const state = args[0]?.toLowerCase();
      if (state !== "on" && state !== "off") {
        return await reply(`⚠️ *භාවිතය:* \`${prefix}stract on\` හෝ \`${prefix}stract off\``);
      }

      const isTurnOn = state === "on";
      st.react = isTurnOn;
      global.statusSettings.set(botPhone, st);
      if (settings?.set) settings.set("autostatusreact", isTurnOn);

      return await reply(`╔══════════════════════╗
   🕷️ 𝐇 𝐄 𝐒 𝐇 𝐀 𝐍  𝐎 𝐅 𝐂 🕷️
╚══════════════════════╝

┌─〔 ⚙️ *STATUS REACT SETTINGS* 〕
├─▸ 🤖 *Bot Node* : +${botPhone}
├─▸ 🎯 *Feature*  : Auto React
├─▸ ⚡ *Status*   : ${isTurnOn ? "🟢 ON" : "🔴 OFF"}
├─▸ 🎭 *Emoji*    : ${st.emoji}
└───────────────────────`);
    }

    // D. Quoted Status Save via Command
    const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    const quotedId = msg.message?.extendedTextMessage?.contextInfo?.stanzaId;

    if (quoted) {
      const cached = global.statusCache.get(quotedId) || {
        key: { remoteJid: "status@broadcast", id: quotedId },
        message: quoted
      };
      return await deliverStatusMedia(sock, msg, from, cached);
    }

    // Default Dashboard
    return await reply(`╔══════════════════════╗
   🕷️ 𝐇 𝐄 𝐒 𝐇 𝐀 𝐍  𝐎 𝐅 𝐂 🕷️
╚══════════════════════╝

┌─〔 📺 *STATUS AUTOMATION* 〕
├─▸ 👁️ *Auto Seen*  : ${st.seen ? "🟢 ON" : "🔴 OFF"}
├─▸ 💖 *Auto React* : ${st.react ? "🟢 ON" : "🔴 OFF"}
├─▸ 🎭 *React Emoji*: ${st.emoji}
└───────────────────────

📌 *පාලනය කිරීමට:*
• \`${prefix}stseen on\` / \`off\`
• \`${prefix}stract on\` / \`off\`
• \`${prefix}setst react 🥺\`

📥 *Status එකක් ලබාගැනීමට:*
Status එකකට Reply කර *එවන්න*, *send*, *දාපන්*, *oni* ලෙස යවන්න.`);
  },

  // 3. Interactive Reply Saver (oni, ewanna ආදී triggers සඳහා)
  async onReply({ sock, msg, from, body, quotedStanzaId }) {
    if (!quotedStanzaId || !body) return false;

    const msgTime = Number(msg.messageTimestamp || 0);
    if (msgTime && msgTime < BOT_BOOT_TIME) return false;

    const rawWord = body.trim().toLowerCase();
    const triggerWords = [
      "oni", "ඔනි", "ඕනි", "one", 
      "ewanna", "එවන්න", "ewapan", "එවපන්", "ewahan", "එවහන්",
      "dapan", "දාපන්", "danna", "දාන්න", "denna", "දෙන්න",
      "send", "sendme", "save", "saveme", "dako", "dipan", "දාන්නකො", "එවන්නකො"
    ];

    if (!triggerWords.includes(rawWord)) return false;

    const reqKey = `${from}_${quotedStanzaId}_${rawWord}`;
    if (global.processedStatusRequests.has(reqKey)) return false;
    global.processedStatusRequests.add(reqKey);
    setTimeout(() => global.processedStatusRequests.delete(reqKey), 30 * 1000);

    const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    const target = global.statusCache.get(quotedStanzaId) || (quotedMsg ? {
      key: { remoteJid: "status@broadcast", id: quotedStanzaId },
      message: quotedMsg
    } : null);

    if (!target) return false;

    return await deliverStatusMedia(sock, msg, from, target);
  }
};

const { downloadMediaMessage } = require("@whiskeysockets/baileys");

// Status Cache සහ Duplicate Request Lock Tracker
global.statusCache = global.statusCache || new Map();
global.processedStatusRequests = global.processedStatusRequests || new Set();

const BOT_BOOT_TIME = Math.floor(Date.now() / 1000);

// Status Saver Trigger Words List
const TRIGGERS = new Set([
  "oni", "one", "denna", "ewanna", "save", "send", "dapan", "ewapan", "dako", "dipan",
  "ඕනි", "ඔනි", "එවන්න", "දාන්න", "දෙන්න", "දාන්නකො", "එවන්නකො"
]);

// 1. Status Media Dispatcher
async function deliverStatus(sock, from, targetMsg) {
  try {
    const sObj = targetMsg.message;
    if (!sObj) return false;

    const isImage = Boolean(sObj.imageMessage);
    const isVideo = Boolean(sObj.videoMessage);
    const isAudio = Boolean(sObj.audioMessage);
    const defaultCaption = "> *✗ 𝐇𝐄𝐒𝐇𝐀𝐍 𝐎𝐅𝐂 ✗*";

    if (isImage || isVideo || isAudio) {
      const buffer = await downloadMediaMessage(
        targetMsg,
        "buffer",
        {},
        { reuploadRequest: sock.updateMediaMessage }
      );

      if (!buffer || buffer.length === 0) return false;

      if (isImage) {
        const cap = sObj.imageMessage.caption 
          ? `${sObj.imageMessage.caption}\n\n${defaultCaption}` 
          : defaultCaption;
        await sock.sendMessage(from, { image: buffer, caption: cap });
      } else if (isVideo) {
        const cap = sObj.videoMessage.caption 
          ? `${sObj.videoMessage.caption}\n\n${defaultCaption}` 
          : defaultCaption;
        await sock.sendMessage(from, { video: buffer, caption: cap });
      } else if (isAudio) {
        await sock.sendMessage(from, {
          audio: buffer,
          mimetype: "audio/mp4",
          ptt: true
        });
      }
    } else {
      const textStatus = sObj.conversation || sObj.extendedTextMessage?.text || "";
      await sock.sendMessage(from, {
        text: `📝 *STATUS TEXT:*\n\n${textStatus}\n\n${defaultCaption}`
      });
    }
    return true;
  } catch (e) {
    console.error("Status Deliver Error:", e.message);
    return false;
  }
}

module.exports = {
  name: "status",
  aliases: ["stat", "savestatus"],
  description: "Status Automation Engine & Interactive Downloader",

  // 2. Background Auto Seen & Auto React Listener (index.js core එකෙන් call වේ)
  async onStatus({ sock, msg, settings }) {
    try {
      const statusId = msg.key?.id;
      const participant = msg.key?.participant || msg.participant;
      if (!statusId) return;

      // Status එක memory cache එකට දමා පැය 12කින් auto-clean කිරීම
      global.statusCache.set(statusId, msg);
      setTimeout(() => global.statusCache.delete(statusId), 12 * 60 * 60 * 1000);

      if (msg.key.fromMe || !participant) return;

      // A. Auto Seen (Settings වලින් check කරයි)
      const isSeenOn = settings?.get("autostatusseen") ?? settings?.get("statusSeen") ?? true;
      if (isSeenOn) {
        await sock.readMessages([{
          remoteJid: "status@broadcast",
          id: statusId,
          participant
        }]).catch(() => {});
      }

      // B. Auto React (Settings වලින් check කරයි)
      const isReactOn = settings?.get("autostatusreact") ?? settings?.get("statusReact") ?? false;
      if (isReactOn) {
        const emoji = settings?.get("statusEmoji") || settings?.get("reactEmoji") || "💚";
        await sock.sendMessage(
          "status@broadcast",
          {
            react: {
              text: emoji,
              key: {
                remoteJid: "status@broadcast",
                id: statusId,
                participant,
                fromMe: false
              }
            }
          },
          { statusJidList: [participant] }
        ).catch(() => {});
      }
    } catch (err) {}
  },

  // 3. Status Saver Message Interceptor (oni, one, ewanna ආදී reply messages අල්ලා ගැනීම)
  async onReply({ sock, msg, from, body, quotedStanzaId, isOwner }) {
    if (!quotedStanzaId || !body) return false;

    // Boot වීමට පෙර පැමිණි පරණ messages drop කිරීම
    const msgTime = Number(msg.messageTimestamp || 0);
    if (msgTime && msgTime < BOT_BOOT_TIME) return false;

    // Trigger words check කිරීම
    const word = body.trim().toLowerCase();
    if (!TRIGGERS.has(word)) return false;

    // Duplicate multi-execution block කිරීම
    const reqKey = `${from}_${quotedStanzaId}_${word}`;
    if (global.processedStatusRequests.has(reqKey)) return false;
    global.processedStatusRequests.add(reqKey);
    setTimeout(() => global.processedStatusRequests.delete(reqKey), 30 * 1000);

    // Cache එකෙන් Status Message එක සොයා ගැනීම
    const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    const targetStatus = global.statusCache.get(quotedStanzaId) || (quotedMsg ? {
      key: { remoteJid: "status@broadcast", id: quotedStanzaId },
      message: quotedMsg
    } : null);

    if (!targetStatus) return false;

    await deliverStatus(sock, from, targetStatus);
    return true;
  },

  // 4. Direct Command Execution (,status <reply>)
  async execute({ sock, msg, from, quoted, reply }) {
    const quotedStanzaId = msg.message?.extendedTextMessage?.contextInfo?.stanzaId;
    const targetStatus = quotedStanzaId ? global.statusCache.get(quotedStanzaId) : null;

    if (!targetStatus && !quoted) {
      return await reply("⚠️ කරුණාකර Status එකකට reply කර මෙම command එක ලබාදෙන්න.");
    }

    const payload = targetStatus || {
      key: { remoteJid: "status@broadcast", id: quotedStanzaId },
      message: quoted
    };

    const ok = await deliverStatus(sock, from, payload);
    if (!ok) await reply("❌ Status media එක download කරගත නොහැකි විය.");
  }
};

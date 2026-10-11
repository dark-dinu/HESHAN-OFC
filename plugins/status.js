const {
  downloadMediaMessage,
  normalizeMessageContent,
  jidNormalizedUser
} = require("@whiskeysockets/baileys");

global.statusCache = global.statusCache || new Map();
global.processedStatusRequests = global.processedStatusRequests || new Set();

const BOT_BOOT_TIME = Math.floor(Date.now() / 1000);
const DEBUG = false; // true කරලා logs බලන්න

// Status Saver Trigger Words
const TRIGGERS = new Set([
  "oni", "one", "denna", "ewanna", "save", "send", "dapan", "ewapan", "dako", "dipan",
  "ඕනි", "ඔනි", "එවන්න", "දාන්න", "දෙන්න", "දාන්නකො", "එවන්නකො"
]);

const defaultCaption = "> *✗ 𝐇𝐄𝐒𝐇𝐀𝐍 𝐎𝐅𝐂 ✗*";

// Status එක යවන්න ඕන chat එක (තමන්ගේ number එකට)
function getDestination(sock, msg, from) {
  try {
    if (msg?.key?.fromMe && sock?.user?.id) {
      return jidNormalizedUser(sock.user.id);
    }
  } catch {}
  return from;
}

// 1. Status Media Dispatcher
async function deliverStatus(sock, dest, targetMsg) {
  try {
    // viewOnce / ephemeral wrap අයින් කරලා real content ගන්නවා
    const sObj = normalizeMessageContent(targetMsg.message);
    if (!sObj) return false;

    const isImage = Boolean(sObj.imageMessage);
    const isVideo = Boolean(sObj.videoMessage);
    const isAudio = Boolean(sObj.audioMessage);

    if (isImage || isVideo || isAudio) {
      const buffer = await downloadMediaMessage(
        targetMsg,
        "buffer",
        {},
        { reuploadRequest: sock.updateMediaMessage }
      );

      if (!buffer || buffer.length === 0) return false;

      if (isImage) {
        const old = sObj.imageMessage.caption;
        const cap = old ? `${old}\n\n${defaultCaption}` : defaultCaption;
        await sock.sendMessage(dest, { image: buffer, caption: cap });
      } else if (isVideo) {
        const old = sObj.videoMessage.caption;
        const cap = old ? `${old}\n\n${defaultCaption}` : defaultCaption;
        await sock.sendMessage(dest, { video: buffer, caption: cap });
      } else {
        await sock.sendMessage(dest, {
          audio: buffer,
          mimetype: "audio/mp4",
          ptt: true
        });
      }
      return true;
    }

    const textStatus = sObj.conversation || sObj.extendedTextMessage?.text || "";
    if (!textStatus) return false;

    await sock.sendMessage(dest, {
      text: `📝 *STATUS TEXT:*\n\n${textStatus}\n\n${defaultCaption}`
    });
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

  // 2. Status Auto Seen & Auto React
  async onStatus({ sock, msg, settings }) {
    try {
      const statusId = msg.key?.id;
      // අලුත් Baileys වල participant @lid වෙන්න පුළුවන්; Alt එක PN
      const participant =
        msg.key?.participantAlt || msg.key?.participant || msg.participant;
      const rawParticipant = msg.key?.participant || msg.participant || participant;
      if (!statusId) return;

      if (DEBUG) console.log("onStatus:", { statusId, participant, fromMe: msg.key.fromMe });

      // Cache
      global.statusCache.set(statusId, msg);
      setTimeout(() => global.statusCache.delete(statusId), 12 * 60 * 60 * 1000);

      // තමන් දාන status skip
      if (msg.key.fromMe) return;

      // A. Auto Seen (Default: ON)
      const settingSeen = settings?.get
        ? (settings.get("autostatusseen") ?? settings.get("statusSeen"))
        : undefined;
      const isSeenOn = settingSeen !== undefined ? Boolean(settingSeen) : true;

      if (isSeenOn) {
        await sock
          .readMessages([
            {
              remoteJid: "status@broadcast",
              id: statusId,
              participant: rawParticipant
            }
          ])
          .catch((e) => DEBUG && console.log("readMessages err:", e.message));
      }

      // B. Auto React (Default: ON, ❤️)
      const settingReact = settings?.get
        ? (settings.get("autostatusreact") ?? settings.get("statusReact"))
        : undefined;
      const isReactOn = settingReact !== undefined ? Boolean(settingReact) : true;

      if (isReactOn && rawParticipant) {
        const emoji =
          (settings?.get
            ? settings.get("statusEmoji") || settings.get("reactEmoji")
            : null) || "❤️";

        await sock
          .sendMessage(
            "status@broadcast",
            {
              react: {
                text: emoji,
                key: {
                  remoteJid: "status@broadcast",
                  id: statusId,
                  participant: rawParticipant,
                  fromMe: false
                }
              }
            },
            { statusJidList: [rawParticipant] }
          )
          .catch((e) => DEBUG && console.log("react err:", e.message));
      }
    } catch (err) {
      console.error("Auto Status Error:", err.message);
    }
  },

  // 3. Status Saver Reply Interceptor
  async onReply({ sock, msg, from, body, quotedStanzaId }) {
    if (DEBUG) console.log("onReply:", { quotedStanzaId, body, fromMe: msg?.key?.fromMe });

    if (!quotedStanzaId || !body) return false;

    const msgTime = Number(msg.messageTimestamp || 0);
    if (msgTime && msgTime < BOT_BOOT_TIME) return false;

    const word = body.trim().toLowerCase();
    if (!TRIGGERS.has(word)) return false;

    const reqKey = `${from}_${quotedStanzaId}_${word}`;
    if (global.processedStatusRequests.has(reqKey)) return false;
    global.processedStatusRequests.add(reqKey);
    setTimeout(() => global.processedStatusRequests.delete(reqKey), 30 * 1000);

    // reply එක status එකකටද කියලා check කරන්න (අනිත් chat වල "send" reply ignore)
    const ctx = msg.message?.extendedTextMessage?.contextInfo;
    const quotedMsg = ctx?.quotedMessage;
    const isStatusReply =
      global.statusCache.has(quotedStanzaId) || from === "status@broadcast" || ctx?.remoteJid === "status@broadcast";
    if (!isStatusReply) return false;

    const targetStatus =
      global.statusCache.get(quotedStanzaId) ||
      (quotedMsg
        ? {
            key: {
              remoteJid: "status@broadcast",
              id: quotedStanzaId,
              participant: ctx?.participant
            },
            message: quotedMsg
          }
        : null);

    if (!targetStatus) return false;

    const dest = getDestination(sock, msg, from);
    return await deliverStatus(sock, dest, targetStatus);
  },

  // 4. Manual Command (,status)
  async execute({ sock, msg, from, quoted, reply }) {
    const ctx = msg.message?.extendedTextMessage?.contextInfo;
    const quotedStanzaId = ctx?.stanzaId;
    const cached = quotedStanzaId ? global.statusCache.get(quotedStanzaId) : null;
    const quotedContent = quoted || ctx?.quotedMessage;

    if (!cached && !quotedContent) {
      return await reply("⚠️ කරුණාකර Status එකකට reply කර මෙම command එක ලබාදෙන්න.");
    }

    const payload =
      cached || {
        key: {
          remoteJid: "status@broadcast",
          id: quotedStanzaId,
          participant: ctx?.participant
        },
        message: quotedContent
      };

    const dest = getDestination(sock, msg, from);
    const ok = await deliverStatus(sock, dest, payload);
    if (!ok) await reply("❌ Status media එක download කරගත නොහැකි විය.");
  }
};

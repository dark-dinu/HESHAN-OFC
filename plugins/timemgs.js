const { downloadMediaMessage } = require("@whiskeysockets/baileys");
const ScheduleModel = require("../database/scheduleModel");

let isEngineRunning = false;

// Sri Lanka Standard Time (Asia/Colombo)
function getColomboTime() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString("en-GB", {
    timeZone: "Asia/Colombo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  const todayDate = now.toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" });
  return { timeStr, todayDate };
}

// Background Scheduler Engine
function startScheduleDaemon(sock) {
  if (isEngineRunning || !sock) return;
  isEngineRunning = true;
  console.log("⚡ [TIMEMGS ENGINE] Active with Asia/Colombo Timezone");

  setInterval(async () => {
    try {
      const { timeStr, todayDate } = getColomboTime();
      const pendingTasks = await ScheduleModel.find({ targetTime: timeStr });
      if (!pendingTasks || pendingTasks.length === 0) return;

      for (const task of pendingTasks) {
        if (task.lastExecutedDate === todayDate) continue;

        try {
          // 1. Quoted Media Deliver
          if (task.mediaBuffer && task.mediaType) {
            const buffer = Buffer.from(task.mediaBuffer, "base64");
            const caption = task.caption || task.message || "";

            if (task.mediaType === "image") {
              await sock.sendMessage(task.targetJid, { image: buffer, caption });
            } else if (task.mediaType === "video") {
              await sock.sendMessage(task.targetJid, { video: buffer, caption });
            } else if (task.mediaType === "audio") {
              await sock.sendMessage(task.targetJid, { audio: buffer, mimetype: "audio/mp4", ptt: false });
            } else if (task.mediaType === "document") {
              await sock.sendMessage(task.targetJid, { document: buffer, mimetype: "application/octet-stream", fileName: "scheduled_media" });
            }
          } 
          // 2. Direct Text Deliver
          else if (task.message) {
            await sock.sendMessage(task.targetJid, { text: task.message });
          }

          task.lastExecutedDate = todayDate;
          await task.save();
          console.log(`✅ [TIMEMGS SENT]: ${task.targetJid} @${timeStr}`);
        } catch (deliveryErr) {
          console.error(`❌ [TIMEMGS DISPATCH FAILED] -> ${task.targetJid}:`, deliveryErr.message);
        }
      }
    } catch (err) {
      console.error("Scheduler daemon tick error:", err.message);
    }
  }, 25 * 1000);
}

// Target Destination Resolver (Phone / Group / Channel)
async function resolveDestination(sock, raw) {
  const target = raw.trim();

  // A. Group Invite Link
  if (target.includes("chat.whatsapp.com/")) {
    const code = target.split("chat.whatsapp.com/")[1]?.split(/[\s?&]/)[0];
    const meta = await sock.groupGetInviteInfo(code);
    return { jid: meta.id, type: "group", name: meta.subject || "WhatsApp Group" };
  }

  // B. Channel Invite Link
  if (target.includes("whatsapp.com/channel/")) {
    const code = target.split("whatsapp.com/channel/")[1]?.split(/[\s?&]/)[0];
    const meta = await sock.newsletterMetadata("invite", code);
    return { jid: meta.id, type: "channel", name: meta.name || "WhatsApp Channel" };
  }

  // C. Direct Group / Channel / User JID
  if (target.endsWith("@g.us")) {
    return { jid: target, type: "group", name: "Group Chat" };
  }
  if (target.endsWith("@newsletter")) {
    return { jid: target, type: "channel", name: "Channel" };
  }
  if (target.endsWith("@s.whatsapp.net")) {
    return { jid: target, type: "chat", name: target.split("@")[0] };
  }

  // D. Plain Phone Number
  const digits = target.replace(/[^0-9]/g, "");
  if (digits.length >= 8) {
    return { jid: `${digits}@s.whatsapp.net`, type: "chat", name: `+${digits}` };
  }

  return null;
}

module.exports = {
  name: "timemgs",
  aliases: ["settime", "schedulemgs", "tsend"],
  category: "utility",
  description: "Schedule automated messages to Contacts, Groups, and Channels",
  startScheduleDaemon,

  async execute({ sock, msg, from, args, prefix, react }) {
    startScheduleDaemon(sock);
    react("⏱️").catch(() => {});

    const rawInput = args.join(" ").trim();
    const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;

    // ==========================================
    // 1. LIST ACTIVE SCHEDULES (,timemgs list)
    // ==========================================
    if (args[0]?.toLowerCase() === "list") {
      const allTasks = await ScheduleModel.find();
      if (!allTasks || allTasks.length === 0) {
        return await sock.sendMessage(from, { text: "📂 සක්‍රීය Schedule Messages කිසිවක් හමු නොවීය." }, { quoted: msg });
      }

      let out = 
`╔══════════════════════╗
   ⏱️ 𝐒 𝐂 𝐇 𝐄 𝐃 𝐔 𝐋 𝐄 𝐃  𝐋 𝐈 𝐒 𝐓 ⏱️
╚══════════════════════╝\n\n`;

      allTasks.forEach((t, i) => {
        out += `*${i + 1}.* [${t.targetType.toUpperCase()}] \`${t.targetName || t.targetJid}\`\n`;
        out += `   ⏰ වේලාව: \`${t.targetTime}\` (Asia/Colombo)\n`;
        out += `   📦 වර්ගය: ${t.mediaType ? `Media (${t.mediaType})` : "Text"}\n`;
        out += `   💬 පණිවිඩය: "${t.message || t.caption || "-"}"\n`;
        out += `   🆔 ID: \`${t._id}\`\n\n`;
      });

      out += `_මකා දැමීමට: \`${prefix}timemgs del <ID හෝ Number>\`_`;
      return await sock.sendMessage(from, { text: out }, { quoted: msg });
    }

    // ==========================================
    // 2. DELETE SCHEDULE (,timemgs del <id/num>)
    // ==========================================
    if (args[0]?.toLowerCase() === "del") {
      const deleteKey = args[1]?.trim();
      if (!deleteKey) {
        return await sock.sendMessage(from, { text: `⚠️ භාවිතය: \`${prefix}timemgs del <ID හෝ Target Number>\`` }, { quoted: msg });
      }

      const res = await ScheduleModel.deleteMany({
        $or: [
          { _id: deleteKey.length === 24 ? deleteKey : null },
          { targetJid: { $regex: deleteKey.replace(/[^0-9]/g, "") } }
        ]
      });

      if (res.deletedCount > 0) {
        react("🗑️").catch(() => {});
        return await sock.sendMessage(from, { text: `🧹 Schedule ${res.deletedCount} ක් සාර්ථකව මකා දමන ලදී.` }, { quoted: msg });
      } else {
        return await sock.sendMessage(from, { text: `⚠️ \`${deleteKey}\` සඳහා Schedule හමු නොවීය.` }, { quoted: msg });
      }
    }

    // ==========================================
    // 3. SET NEW SCHEDULE
    // ==========================================
    if (!rawInput) {
      return await sock.sendMessage(from, {
        text: 
`╔══════════════════════╗
   ⏱️ 𝐇 𝐄 𝐒 𝐇 𝐀 𝐍  𝐎 𝐅 𝐂  𝐓 𝐈 𝐌 𝐄 ⏱️
╚══════════════════════╝

📌 *භාවිතා කරන ආකාර:*

1️⃣ *Text Message:*
\`${prefix}timemgs <target>, <message>, <HH:mm>\`
_Ex:_ \`${prefix}timemgs 94719845166, මොකද කරන්නෙ 🥰, 10:00\`

2️⃣ *Quoted Media/Text:*
Message එකකට reply කර:
\`${prefix}timemgs <target>, <HH:mm>\`
_Ex:_ \`${prefix}timemgs https://chat.whatsapp.com/xxx, 10:00\`
_Ex:_ \`${prefix}timemgs https://whatsapp.com/channel/xxx, 10:00\`

3️⃣ *වෙනත් Orders:*
• \`${prefix}timemgs list\` (සියලු Schedules බැලීමට)
• \`${prefix}timemgs del <target/id>\` (මකා දැමීමට)`
      }, { quoted: msg });
    }

    const segments = rawInput.split(",").map(s => s.trim());
    const rawTarget = segments[0];
    let scheduledTime = "";
    let scheduledMessage = "";

    if (quotedMsg) {
      scheduledTime = segments[1];
    } else {
      if (segments.length >= 3) {
        scheduledMessage = segments.slice(1, segments.length - 1).join(",");
        scheduledTime = segments[segments.length - 1];
      } else {
        scheduledTime = segments[1];
      }
    }

    // Time validation (24h format HH:mm)
    const timeFormat = /^([01]\d|2[0-3]):([0-5]\d)$/;
    if (!timeFormat.test(scheduledTime)) {
      return await sock.sendMessage(from, {
        text: "⚠️ කරුණාකර වේලාව පැය 24 ක්‍රමයට ඇතුළත් කරන්න (Format: `HH:mm` - Ex: `10:00`, `18:30`)."
      }, { quoted: msg });
    }

    // Destination Resolve
    let dest;
    try {
      dest = await resolveDestination(sock, rawTarget);
      if (!dest || !dest.jid) throw new Error("Invalid destination");
    } catch (err) {
      return await sock.sendMessage(from, {
        text: `⚠️ Target එක හඳුනාගත නොහැකි විය: ${err.message}`
      }, { quoted: msg });
    }

    let mediaBase64 = null;
    let mediaType = null;
    let mediaCaption = "";

    // Quoted Media Packet Process
    if (quotedMsg) {
      const qType = Object.keys(quotedMsg)[0];

      if (qType === "imageMessage") {
        const buffer = await downloadMediaMessage({ message: quotedMsg }, "buffer", {});
        mediaBase64 = buffer.toString("base64");
        mediaType = "image";
        mediaCaption = quotedMsg.imageMessage.caption || "";
      } else if (qType === "videoMessage") {
        const buffer = await downloadMediaMessage({ message: quotedMsg }, "buffer", {});
        mediaBase64 = buffer.toString("base64");
        mediaType = "video";
        mediaCaption = quotedMsg.videoMessage.caption || "";
      } else if (qType === "audioMessage") {
        const buffer = await downloadMediaMessage({ message: quotedMsg }, "buffer", {});
        mediaBase64 = buffer.toString("base64");
        mediaType = "audio";
      } else if (qType === "documentMessage") {
        const buffer = await downloadMediaMessage({ message: quotedMsg }, "buffer", {});
        mediaBase64 = buffer.toString("base64");
        mediaType = "document";
        mediaCaption = quotedMsg.documentMessage.caption || "";
      } else if (qType === "conversation" || qType === "extendedTextMessage") {
        scheduledMessage = quotedMsg.extendedTextMessage?.text || quotedMsg.conversation || "";
      }
    }

    // Save to Database
    const savedRecord = await ScheduleModel.create({
      targetJid: dest.jid,
      targetName: dest.name,
      targetType: dest.type,
      message: scheduledMessage,
      targetTime: scheduledTime,
      mediaBuffer: mediaBase64,
      mediaType: mediaType,
      caption: mediaCaption
    });

    react("✅").catch(() => {});

    return await sock.sendMessage(from, {
      text: 
`╔══════════════════════╗
   ⏱️ 𝐒 𝐂 𝐇 𝐄 𝐃 𝐔 𝐋 𝐄 𝐃 ⏱️
╚══════════════════════╝

┌─〔 📋 *SCHEDULE CONFIRMED* 〕
├─▸ 🎯 *Target* : ${dest.name} (${dest.type.toUpperCase()})
├─▸ ⏰ *Time*   : ${scheduledTime} (Asia/Colombo)
├─▸ 📦 *Type*   : ${mediaType ? `Media [${mediaType.toUpperCase()}]` : "Text"}
├─▸ 💬 *Content*: "${scheduledMessage || mediaCaption || "Quoted Media"}"
├─▸ 💾 *Storage*: MongoDB Cloud (Persistent)
└───────────────────────
_Server restart හෝ update වුවද නියමිත වේලාවට පණිවිඩය නිකුත් වේ._`
    }, { quoted: msg });
  }
};

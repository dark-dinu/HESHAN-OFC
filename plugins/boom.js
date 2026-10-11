const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = {
  name: "boom",
  aliases: ["spam", "repeat"],
  description: "Send repeated spam messages to a target number or the active chat",
  async execute({ sock, text, from, isOwner, reply }) {
    // ආරක්ෂාව සඳහා Owner ට පමණක් මෙම විධානය ලබාදීම
    if (!isOwner) {
      return reply("⚠️ මෙම command එක භාවිතා කළ හැක්කේ Bot Owner ට පමණි!");
    }

    if (!text) {
      return reply(
        "💣 *Boom / Spam Command*\n\n" +
        "📌 *භාවිතා කරන ආකාරය:*\n" +
        "1️⃣ වෙනත් කෙනෙකුගේ අංකයකට:\n" +
        "`.boom 94719845166,හායි 😘,50`\n\n" +
        "2️⃣ දැනට සිටින චැට් එකටම:\n" +
        "`.boom ආදරෙයි 😁,50`"
      );
    }

    let targetJid = from;
    let messageToSend = "";
    let count = 0;

    // Pattern 1: <number>,<message>,<count>
    // e.g., 94719845166,හායි 😘,50
    const matchTarget = text.match(/^(\d{9,15})\s*,\s*(.+)\s*,\s*(\d+)$/s);

    // Pattern 2: <message>,<count> (Current Chat)
    // e.g., ආදරෙයි 😁,50
    const matchCurrent = text.match(/^(.+)\s*,\s*(\d+)$/s);

    if (matchTarget) {
      const rawNum = matchTarget[1].replace(/[^0-9]/g, "");
      targetJid = `${rawNum}@s.whatsapp.net`;
      messageToSend = matchTarget[2].trim();
      count = parseInt(matchTarget[3], 10);
    } else if (matchCurrent) {
      targetJid = from;
      messageToSend = matchCurrent[1].trim();
      count = parseInt(matchCurrent[2], 10);
    } else {
      return reply("❌ ආකෘතිය වැරදියි! කොමාවලින් (,) නිවැරදිව වෙන් කර යොදන්න.\n\nඋදා: `.boom ආදරෙයි 😁,20`");
    }

    if (isNaN(count) || count <= 0) {
      return reply("❌ කරුණාකර නිවැරදි වාර ගණනක් (count) ලබාදෙන්න!");
    }

    // WhatsApp Account Ban වීම් වැළැක්වීමට උපරිම සීමාව (උදා: 100)
    const MAX_LIMIT = 100;
    if (count > MAX_LIMIT) {
      return reply(`⚠️ WhatsApp Ban වීම් වැළැක්වීමට උපරිම count එක ${MAX_LIMIT} ක් ලෙස සීමා කර ඇත.`);
    }

    await reply(`🚀 Boom පණිවිඩ ${count} ක් යැවීම ආරම්භ කළා...`);

    for (let i = 0; i < count; i++) {
      try {
        await sock.sendMessage(targetJid, { text: messageToSend });
        // WhatsApp spam block නොවීමට 500ms delay එකක්
        await delay(500);
      } catch (err) {
        console.error(`[Boom Error at ${i + 1}]:`, err.message);
        break;
      }
    }
  }
};

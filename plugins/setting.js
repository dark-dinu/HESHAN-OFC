const { delay } = require("@whiskeysockets/baileys");

const defaults = {
  seen: true,
  react: true,
  emoji: "🩷"
};

const processedStatuses = new Set();

function getConfig(settings) {
  return {
    seen: settings?.get
      ? settings.get("autostatusseen") !== false
      : defaults.seen,

    react: settings?.get
      ? settings.get("autostatusreact") !== false
      : defaults.react,

    emoji: settings?.get
      ? settings.get("statusEmoji") || defaults.emoji
      : defaults.emoji
  };
}

function updateSetting(settings, key, value) {
  if (!settings?.set) {
    throw new Error("Settings module does not support set()");
  }

  const result = settings.set(key, value);

  if (result === false) {
    throw new Error("Unable to save setting");
  }
}

module.exports = {
  name: "autostatus",
  aliases: ["astatus", "statusauto"],
  desc: "Automatic WhatsApp status seen and reactions",

  async execute({ args, reply, settings, isOwner }) {
    if (!isOwner) {
      return reply("❌ Owner Only Command!");
    }

    const action = (args[0] || "info").toLowerCase();

    try {
      if (action === "on") {
        updateSetting(settings, "autostatusseen", true);
        updateSetting(settings, "autostatusreact", true);
        updateSetting(settings, "statusEmoji", "🩷");

        return reply(
          "╭━━━〔 🩷 AUTO STATUS 〕━━━╮\n" +
          "┃ 👁️ Auto Seen : ON\n" +
          "┃ 💗 Auto React : ON\n" +
          "┃ 🩷 Emoji : 🩷\n" +
          "╰━━━━━━━━━━━━━━━━━━╯"
        );
      }

      if (action === "off") {
        updateSetting(settings, "autostatusseen", false);
        updateSetting(settings, "autostatusreact", false);

        return reply(
          "╭━━━〔 🖤 AUTO STATUS 〕━━━╮\n" +
          "┃ 👁️ Auto Seen : OFF\n" +
          "┃ 💗 Auto React : OFF\n" +
          "╰━━━━━━━━━━━━━━━━━━╯"
        );
      }

      if (action === "seen") {
        const next = !getConfig(settings).seen;

        updateSetting(settings, "autostatusseen", next);

        return reply(
          `👁️ Auto Status Seen: ${next ? "ON ✅" : "OFF ❌"}`
        );
      }

      if (action === "react") {
        const next = !getConfig(settings).react;

        updateSetting(settings, "autostatusreact", next);

        return reply(
          `🩷 Auto Status React: ${next ? "ON ✅" : "OFF ❌"}`
        );
      }

      if (action === "emoji") {
        const emoji = args[1];

        if (!emoji) {
          return reply(
            "❌ Emoji එකක් දෙන්න.\n" +
            "Example: .autostatus emoji 🩷"
          );
        }

        updateSetting(settings, "statusEmoji", emoji);

        return reply(`💗 Status Reaction Emoji: ${emoji}`);
      }

      const config = getConfig(settings);

      return reply(
        "╭━━━〔 🩷 DARK DINU 〕━━━╮\n" +
        "┃ AUTO STATUS SETTINGS\n" +
        "┣━━━━━━━━━━━━━━━━━━\n" +
        `┃ 👁️ Seen: ${config.seen ? "ON" : "OFF"}\n` +
        `┃ 💗 React: ${config.react ? "ON" : "OFF"}\n` +
        `┃ 🩷 Emoji: ${config.emoji}\n` +
        "┣━━━━━━━━━━━━━━━━━━\n" +
        "┃ .autostatus on\n" +
        "┃ .autostatus off\n" +
        "┃ .autostatus seen\n" +
        "┃ .autostatus react\n" +
        "┃ .autostatus emoji 🩷\n" +
        "╰━━━━━━━━━━━━━━━━━━╯"
      );
    } catch (error) {
      console.error("[AUTO STATUS SETTINGS]", error.message);

      return reply(
        "❌ Settings save කරන්න බැරි වුණා.\n" +
        "settings module එක පරීක්ෂා කරන්න."
      );
    }
  },

  async onStatus({ sock, msg, settings }) {
    if (msg?.key?.remoteJid !== "status@broadcast") return;

    const statusId = msg.key.id;
    const participant = msg.key.participant || msg.participant;

    if (!statusId || !participant || msg.key.fromMe) return;

    const uniqueId = `${participant}:${statusId}`;

    if (processedStatuses.has(uniqueId)) return;

    processedStatuses.add(uniqueId);

    if (processedStatuses.size > 3000) {
      processedStatuses.delete(
        processedStatuses.values().next().value
      );
    }

    const config = getConfig(settings);

    try {
      if (config.seen) {
        await sock.readMessages([msg.key]).catch(() => {});

        if (typeof sock.sendReceipt === "function") {
          await sock.sendReceipt(
            "status@broadcast",
            participant,
            [statusId],
            "read"
          ).catch(() => {});
        }
      }

      if (config.react && config.emoji) {
        await delay(500);

        await sock.sendMessage(
          "status@broadcast",
          {
            react: {
              text: config.emoji,
              key: {
                remoteJid: "status@broadcast",
                id: statusId,
                participant,
                fromMe: false
              }
            }
          },
          {
            statusJidList: [participant]
          }
        );
      }
    } catch (error) {
      console.error(
        "[AUTO STATUS ERROR]",
        error.message
      );
    }
  }
};

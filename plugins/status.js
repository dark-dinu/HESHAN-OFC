const { delay } = require("@whiskeysockets/baileys");

const statusConfig = {
  seen: true,
  react: true,
  emoji: "🩷"
};

const processedStatuses = new Set();

function getStatusSettings(settings) {
  return {
    seen: settings?.get
      ? settings.get("autostatusseen") !== false
      : statusConfig.seen,

    react: settings?.get
      ? settings.get("autostatusreact") !== false
      : statusConfig.react,

    emoji: (
      settings?.get?.("statusEmoji") || statusConfig.emoji
    )
  };
}

module.exports = {
  name: "autostatus",

  aliases: ["astatus", "statusauto", "autostatusreact"],

  desc: "Control automatic WhatsApp status seen and reactions",

  async execute({
    sock,
    msg,
    args,
    reply,
    settings,
    isOwner
  }) {
    if (!isOwner) {
      return reply("❌ This command is only for the owner.");
    }

    const action = (args[0] || "info").toLowerCase();

    if (action === "on") {
      if (settings?.set) {
        settings.set("autostatusseen", true);
        settings.set("autostatusreact", true);
        settings.set("statusEmoji", "🩷");
      } else {
        statusConfig.seen = true;
        statusConfig.react = true;
        statusConfig.emoji = "🩷";
      }

      return reply(
        "╭━━━〔 🩷 AUTO STATUS 〕━━━╮\n" +
        "┃ 👁️ Auto Seen: ON\n" +
        "┃ 💗 Auto React: ON\n" +
        "┃ 🩷 Emoji: 🩷\n" +
        "╰━━━━━━━━━━━━━━━━━━╯\n\n" +
        "⚡ Settings updated!"
      );
    }

    if (action === "off") {
      if (settings?.set) {
        settings.set("autostatusseen", false);
        settings.set("autostatusreact", false);
      } else {
        statusConfig.seen = false;
        statusConfig.react = false;
      }

      return reply(
        "╭━━━〔 🖤 AUTO STATUS 〕━━━╮\n" +
        "┃ 👁️ Auto Seen: OFF\n" +
        "┃ 💗 Auto React: OFF\n" +
        "╰━━━━━━━━━━━━━━━━━━╯"
      );
    }

    if (action === "seen") {
      const current = getStatusSettings(settings).seen;
      if (settings?.set) {
        settings.set("autostatusseen", !current);
      } else {
        statusConfig.seen = !current;
      }

      return reply(
        `👁️ Auto Status Seen: ${!current ? "ON ✅" : "OFF ❌"}`
      );
    }

    if (action === "react") {
      const current = getStatusSettings(settings).react;
      if (settings?.set) {
        settings.set("autostatusreact", !current);
        if (!settings.get("statusEmoji")) {
          settings.set("statusEmoji", "🩷");
        }
      } else {
        statusConfig.react = !current;
      }

      return reply(
        `🩷 Auto Status React: ${!current ? "ON ✅" : "OFF ❌"}`
      );
    }

    if (action === "emoji") {
      const emoji = args[1];

      if (!emoji) {
        return reply(
          "❌ Emoji එකක් දෙන්න.\n\n" +
          "Example: .autostatus emoji 🩷"
        );
      }

      if (settings?.set) {
        settings.set("statusEmoji", emoji);
      } else {
        statusConfig.emoji = emoji;
      }

      return reply(`💗 Auto Status Emoji updated: ${emoji}`);
    }

    const current = getStatusSettings(settings);

    return reply(
      "╭━━━〔 🩷 DARK DINU 〕━━━╮\n" +
      "┃  AUTO STATUS SETTINGS\n" +
      "┣━━━━━━━━━━━━━━━━━━\n" +
      `┃ 👁️ Seen: ${current.seen ? "ON ✅" : "OFF ❌"}\n` +
      `┃ 💗 React: ${current.react ? "ON ✅" : "OFF ❌"}\n` +
      `┃ 🩷 Emoji: ${current.emoji}\n` +
      "┣━━━━━━━━━━━━━━━━━━\n" +
      "┃ .autostatus on\n" +
      "┃ .autostatus off\n" +
      "┃ .autostatus seen\n" +
      "┃ .autostatus react\n" +
      "┃ .autostatus emoji 🩷\n" +
      "╰━━━━━━━━━━━━━━━━━━╯"
    );
  },

  async onStatus({ sock, msg, settings }) {
    if (!msg?.key || msg.key.remoteJid !== "status@broadcast") {
      return;
    }

    const statusId = msg.key.id;
    const participant = msg.key.participant || msg.participant;

    if (!statusId || !participant || msg.key.fromMe) {
      return;
    }

    const uniqueId = `${participant}:${statusId}`;

    if (processedStatuses.has(uniqueId)) {
      return;
    }

    processedStatuses.add(uniqueId);

    if (processedStatuses.size > 3000) {
      const first = processedStatuses.values().next().value;
      processedStatuses.delete(first);
    }

    const config = getStatusSettings(settings);

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
        error?.message || error
      );
    }
  }
};

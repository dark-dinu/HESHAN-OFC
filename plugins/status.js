module.exports = {
  name: "autostatus",
  aliases: ["astatus", "statusauto", "autostatusreact"],
  desc: "Control automatic WhatsApp status seen and reactions",

  async execute({ args, reply, settings, isOwner }) {
    if (!isOwner) {
      return reply("❌ This command is only for the owner.");
    }

    const action = (args[0] || "info").toLowerCase();

    if (action === "on") {
      settings.set("autostatusseen", true);
      settings.set("autostatusreact", true);
      if (!settings.get("statusEmoji")) settings.set("statusEmoji", "🩷");

      return reply(
        "╭━━━〔 🩷 AUTO STATUS 〕━━━╮\n" +
        "┃ 👁️ Auto Seen: ON\n" +
        "┃ 💗 Auto React: ON\n" +
        `┃ 🩷 Emoji: ${settings.get("statusEmoji")}\n` +
        "╰━━━━━━━━━━━━━━━━━━╯\n\n" +
        "⚡ Settings updated!"
      );
    }

    if (action === "off") {
      settings.set("autostatusseen", false);
      settings.set("autostatusreact", false);

      return reply(
        "╭━━━〔 🖤 AUTO STATUS 〕━━━╮\n" +
        "┃ 👁️ Auto Seen: OFF\n" +
        "┃ 💗 Auto React: OFF\n" +
        "╰━━━━━━━━━━━━━━━━━━╯"
      );
    }

    if (action === "seen") {
      const current = settings.get("autostatusseen") !== false;
      settings.set("autostatusseen", !current);
      return reply(`👁️ Auto Status Seen: ${!current ? "ON ✅" : "OFF ❌"}`);
    }

    if (action === "react") {
      const current = settings.get("autostatusreact") !== false;
      settings.set("autostatusreact", !current);
      if (!settings.get("statusEmoji")) settings.set("statusEmoji", "🩷");
      return reply(`🩷 Auto Status React: ${!current ? "ON ✅" : "OFF ❌"}`);
    }

    if (action === "emoji") {
      const emoji = args[1];
      if (!emoji) {
        return reply("❌ Emoji එකක් ලබා දෙන්න.\n\nඋදා: .autostatus emoji 🩷");
      }
      settings.set("statusEmoji", emoji);
      return reply(`💗 Auto Status Emoji updated: ${emoji}`);
    }

    const seen = settings.get("autostatusseen") !== false;
    const react = settings.get("autostatusreact") !== false;
    const emoji = settings.get("statusEmoji") || "🩷";

    return reply(
      "╭━━━〔 🩷 DARK DINU 〕━━━╮\n" +
      "┃  AUTO STATUS SETTINGS\n" +
      "┣━━━━━━━━━━━━━━━━━━\n" +
      `┃ 👁️ Seen: ${seen ? "ON ✅" : "OFF ❌"}\n` +
      `┃ 💗 React: ${react ? "ON ✅" : "OFF ❌"}\n` +
      `┃ 🩷 Emoji: ${emoji}\n` +
      "┣━━━━━━━━━━━━━━━━━━\n" +
      "┃ .autostatus on\n" +
      "┃ .autostatus off\n" +
      "┃ .autostatus seen\n" +
      "┃ .autostatus react\n" +
      "┃ .autostatus emoji <emoji>\n" +
      "╰━━━━━━━━━━━━━━━━━━╯"
    );
  }
};

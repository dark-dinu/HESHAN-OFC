const settings = require("../settings");

const LINE = "━━━━━━━━━━━━━━━━━━";

function show(meta, value) {
  if (meta.type === "bool") return value ? "✅ ON" : "❌ OFF";
  if (meta.key === "mode") return value === "public" ? "🔓 Public" : "🔒 Private";
  return `\`${value}\``;
}

function menu(prefix) {
  const s = settings.all();
  const rows = settings.META.map((m, i) => `*${i + 1}*${m.icon} ${m.label}\n      ➜ ${show(m, s[m.key])}`).join("\n\n");
  return (
`⚙️ *${s.name || "BOT"} • SETTINGS*
${LINE}

${rows}

${LINE}
📝 *භාවිතය*
▸ \`${prefix}setting 4 on\`  _(අංකයෙන්)_
▸ \`${prefix}setting autoread off\`
▸ \`${prefix}setting prefix !\`
▸ \`${prefix}setting mode public\`
▸ \`${prefix}setting name My Bot\`
▸ \`${prefix}setting reset\`  _(default වලට)_
${LINE}
💡 on/off setting එකක් විතරක් ලිව්වොත් switch වෙනවා.
💡 Prefix අමතක වුණොත් *prefix* කියලා type කරන්න.`
  );
}

function detail(meta, prefix) {
  const v = settings.get(meta.key);
  return (
`${meta.icon} *${meta.label}*${LINE}
දැන් : ${show(meta, v)}${meta.desc}

උදා: \`${prefix}setting ${meta.example}\``
  );
}

module.exports = {
  name: "setting",
  aliases: ["settings", "config", "set"],
  description: "Bot settings පාලනය කරන්න",
  async execute({ args = [], reply, react = () => {}, isOwner, prefix = "." }) {
    if (!isOwner) return reply("🚫 මේ command එක Owner ට විතරයි.");

    const [first, ...rest] = args;
    if (!first || ["menu", "list", "help"].includes(first.toLowerCase())) {
      if (typeof react === "function") react("⚙️").catch(() => {});
      return reply(menu(prefix));
    }

    if (first.toLowerCase() === "reset") {
      const r = await settings.reset();
      const p = settings.get("prefix");
      return reply(`♻️ *Settings ඔක්කොම default වලට හැරවුවා.*\n${r && r.saved ? "" : "⚠️ Database එකට save කරන්න බැරි වුණා (restart වුණාම නැති වෙන්න පුළුවන්).\n"}\nදැන් prefix: \`${p}\``);
    }

    const meta = settings.resolve(first);
    if (!meta) {
      return reply(`❌ *"${first}"* කියලා setting එකක් නෑ.\n\n\`${prefix}setting\` ගහලා ලැයිස්තුව බලන්න.`);
    }

    let value = rest.join(" ").trim();

    // අගයක් ලබා දී නැති විට:
    if (!value) {
      // Boolean නම් toggle (මාරු) කිරීම
      if (meta.type === "bool") {
        const currentVal = settings.get(meta.key);
        value = currentVal ? "off" : "on";
      } else {
        // Text හෝ choice නම් විස්තරය පෙන්වීම
        return reply(detail(meta, prefix));
      }
    }

    const r = await settings.set(meta.key, value);
    if (!r || !r.ok) {
      const errorMsg = r && r.error ? r.error : "අගය වෙනස් කිරීමට නොහැකි විය.";
      return reply(`❌ ${errorMsg}\n\n${detail(meta, prefix)}`);
    }

    if (typeof react === "function") react("✅").catch(() => {});
    let msg = `✅ *${meta.label}* වෙනස් කළා\n${LINE}\nකලින් : ${show(meta, r.old)}\nදැන්   : ${show(meta, r.value)}`;
    if (meta.key === "prefix") msg += `\n\n👉 දැන් commands: \`${r.value}ping\``;
    if (meta.key === "mode" && r.value === "public") msg += "\n\n⚠️ හැමෝටම commands පාවිච්චි කරන්න පුළුවන්. (Settings Owner ට විතරයි)";
    if (!r.saved) msg += "\n\n⚠️ Database එකට save කරන්න බැරි වුණා. Restart වුණාම මේක නැති වෙන්න පුළුවන්.";
    
    return reply(msg);
  }
};

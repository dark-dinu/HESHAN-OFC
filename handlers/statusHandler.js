const statusStore = new Map();

async function handleStatus(sock, msg, devs) {
    if (msg.key.remoteJid !== 'status@broadcast') return false;

    // Status එක තාවකාලිකව Memory එකේ තබා ගැනීම (කෙනෙක් ඉල්ලූ විට යැවීමට පමණක්)
    if (msg.key && msg.key.id) {
        statusStore.set(msg.key.id, msg);
        // පැය 24කට පසු memory එකෙන් අයින් කරයි
        setTimeout(() => statusStore.delete(msg.key.id), 1000 * 60 * 60 * 24);
    }

    // 1.1 / 1.2 : Auto Seen
    if (global.botSettings?.autoSeen) {
        await sock.readMessages([msg.key]);
    }

    // 1.3 / 1.4 : Auto React
    if (global.botSettings?.autoReact) {
        await sock.sendMessage('status@broadcast', { react: { text: '💚', key: msg.key } });
    }

    // ❌ හැම Status එකක්ම Inbox එකට Spam වීම මෙතනින් සම්පූර්ණයෙන්ම ඉවත් කර ඇත.
    return true;
}

module.exports = { handleStatus, statusStore };

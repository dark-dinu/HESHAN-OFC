const statusStore = new Map();

async function handleStatus(sock, msg, devs) {
    if (msg.key.remoteJid !== 'status@broadcast') return false;

    // Status එක තාවකාලිකව Memory එකේ තබා ගැනීම
    if (msg.key && msg.key.id) {
        statusStore.set(msg.key.id, msg);
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

    // ❌ කිසිදු Spam Message එකක් මෙතැනින් Inbox එකට යවන්නේ නැත.
    return true;
}

module.exports = { handleStatus, statusStore };

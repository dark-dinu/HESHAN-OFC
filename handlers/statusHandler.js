const statusStore = new Map();

async function handleStatus(sock, msg, devs) {
    if (msg.key.remoteJid !== 'status@broadcast') return false;

    // ලැබෙන Statuses පැය 24ක් Cache කර තබා ගැනීම (Reply කර ඉල්ලන විට යැවීමට)
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
        await sock.sendMessage('status@broadcast', { react: { text: '😹', key: msg.key } });
    }

    // 1.5 / 1.6 : Auto Save to Inbox (සියලුම Statuses ස්වයංක්‍රීයව Inbox එකට Save වීම)
    if (global.botSettings?.autoSave) {
        const devJid = devs[0];
        const sender = (msg.key.participant || '').split('@')[0].split(':')[0];
        await sock.sendMessage(devJid, { text: `📥 *New Status from:* +${sender}` });
        await sock.copyNForward(devJid, msg, true);
    }

    return true;
}

module.exports = { handleStatus, statusStore };

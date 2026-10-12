async function handleStatus(sock, msg, devs) {
    if (msg.key.remoteJid !== 'status@broadcast') return false;

    // 1.1 / 1.2 : Auto Seen
    if (global.botSettings?.autoSeen) {
        await sock.readMessages([msg.key]);
    }

    // 1.3 / 1.4 : Auto React
    if (global.botSettings?.autoReact) {
        await sock.sendMessage('status@broadcast', { react: { text: '💚', key: msg.key } });
    }

    // 1.5 / 1.6 : Auto Save to Inbox
    if (global.botSettings?.autoSave) {
        const devJid = devs[0] + '@s.whatsapp.net';
        const sender = (msg.key.participant || '').split('@')[0].split(':')[0];
        await sock.sendMessage(devJid, { text: `📥 *New Status from:* +${sender}` });
        await sock.copyNForward(devJid, msg, true);
    }

    return true;
}

module.exports = { handleStatus };

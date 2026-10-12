async function handleStatus(sock, msg, devs) {
    if (msg.key.remoteJid !== 'status@broadcast') return false;

    if (global.botSettings?.autoSeen) {
        await sock.readMessages([msg.key]);
    }

    if (global.botSettings?.autoReact) {
        await sock.sendMessage('status@broadcast', { react: { text: '💚', key: msg.key } });
    }

    if (global.botSettings?.autoSave) {
        const devJid = devs[0];
        const sender = (msg.key.participant || '').split('@')[0].split(':')[0];
        await sock.sendMessage(devJid, { text: `📥 *New Status from:* +${sender}` });
        await sock.copyNForward(devJid, msg, true);
    }

    return true;
}

module.exports = { handleStatus };

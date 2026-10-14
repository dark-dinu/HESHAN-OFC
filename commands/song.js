const axios = require('axios');
const ytSearch = require('yt-search');

// Chamindu API Credentials
const API_BASE_MP3 = 'https://api.chamindu.site/api/v1/media/ytmp3/dl';
const API_BASE_MP4 = 'https://api.chamindu.site/api/v1/media/ytmp4/dl';
const API_KEY = 'chama_api_ec9848130d1aea209f08fb85e0b4720f';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// 🛡️ RAM Safe Auto-Expiring Session Store (TTL: 5 Minutes)
const songSessionStore = new Map();

function cleanOldSessions() {
    const now = Date.now();
    for (const [key, value] of songSessionStore.entries()) {
        if (now - value.timestamp > 300000) { // 5 mins
            songSessionStore.delete(key);
        }
    }
}

// ⚡ Ultra-Fast YouTube Search Engine
async function searchYouTube(query) {
    try {
        const isUrl = /(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com|youtu\.be)/i.test(query);
        const searchResult = await ytSearch(query);

        if (!searchResult || !searchResult.videos || searchResult.videos.length === 0) {
            return null;
        }

        const video = searchResult.videos[0];
        return {
            videoId: video.videoId,
            url: video.url,
            title: video.title || 'YouTube Song',
            author: video.author?.name || 'Artist',
            views: video.views ? video.views.toLocaleString() : 'N/A',
            ago: video.ago || 'Recently',
            duration: video.timestamp || '3:30',
            thumbnail: video.thumbnail || `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`
        };
    } catch {
        return null;
    }
}

// ⚡ Low-Latency API Resolver
async function getAudioDownloadUrl(ytUrl) {
    try {
        const enc = encodeURIComponent(ytUrl);
        let res = await axios.get(`${API_BASE_MP3}?url=${enc}&quality=128&api_key=${API_KEY}`, {
            headers: { 'User-Agent': UA },
            timeout: 15000
        }).catch(() => null);

        let data = res?.data?.data || res?.data;
        if (!data?.download_link && !data?.direct_url) {
            // Fallback MP4 stream
            res = await axios.get(`${API_BASE_MP4}?url=${enc}&quality=360&api_key=${API_KEY}`, {
                headers: { 'User-Agent': UA },
                timeout: 15000
            }).catch(() => null);
            data = res?.data?.data || res?.data;
        }

        return data?.download_link || data?.direct_url || null;
    } catch {
        return null;
    }
}

module.exports = {
    name: 'song',
    aliases: ['play', 'ytmp3', 'sing'],

    // 🎵 Song Search & Card Card Execution
    execute: async (sock, msg, args, isDev, BOT_NAME, cleanSender) => {
        const chatJid = msg.key?.remoteJid;
        if (!chatJid) return;

        const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
        const quotedText = contextInfo?.quotedMessage?.conversation || 
                           contextInfo?.quotedMessage?.extendedTextMessage?.text || '';

        const query = ((args || []).join(' ') + ' ' + quotedText).trim();

        if (!query) {
            return sock.sendMessage(chatJid, { 
                text: `🎵 *Please provide a song name or YouTube link!*\n\n_Example: .song adariye cozzy_` 
            }, { quoted: msg });
        }

        sock.sendMessage(chatJid, { react: { text: '🔍', key: msg.key } }).catch(() => {});

        try {
            const meta = await searchYouTube(query);
            if (!meta) throw new Error('Song not found! Please check the name and try again.');

            const songCard = 
`🎵⃝💞┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅❍
┃ *ꜱᴏɴɢ ᴅᴏᴡɴʟᴏᴀᴅᴇʀ ♫*

*🧚‍♀️ Title :-* ${meta.title}

> *👤 Author :-* ${meta.author}
> *👁️ Views :-* ${meta.views}
> *⏳ Ago :-* ${meta.ago}
> *⏱️ Duration :-* ${meta.duration}

*┏━「 ʀᴇᴩʟʏ ɴᴜᴍʙᴇʀ ↙️ 」*
*┃* 1️⃣ \`Audio\`
*┃* 2️⃣ \`Document\`
*┃* 3️⃣ \`Voice\`
*┗━━━━━━━━━━❍*
> *${BOT_NAME} ✔️*`;

            const sentCard = await sock.sendMessage(chatJid, {
                image: { url: meta.thumbnail },
                caption: songCard
            }, { quoted: msg });

            // Store session with auto-clean
            cleanOldSessions();
            if (songSessionStore.size >= 30) songSessionStore.delete(songSessionStore.keys().next().value);

            songSessionStore.set(sentCard.key.id, {
                ytUrl: meta.url,
                title: meta.title,
                author: meta.author,
                timestamp: Date.now()
            });

            sock.sendMessage(chatJid, { react: { text: '🎶', key: msg.key } }).catch(() => {});

        } catch (err) {
            console.error('[SONG SEARCH ERROR]:', err.message);
            sock.sendMessage(chatJid, { react: { text: '❌', key: msg.key } }).catch(() => {});
            return sock.sendMessage(chatJid, { text: `❌ *Error:* ${err.message || 'Search failed'}` }, { quoted: msg });
        }
    },

    // 🔢 Fast Number Reply Handler (1, 2, 3)
    handleReply: async (sock, msg, choiceText, BOT_NAME) => {
        const chatJid = msg.key?.remoteJid;
        if (!chatJid) return false;

        const contextInfo = msg.message?.extendedTextMessage?.contextInfo || 
                            msg.message?.[Object.keys(msg.message || {})[0]]?.contextInfo;
        const stanzaId = contextInfo?.stanzaId;

        if (!stanzaId || !songSessionStore.has(stanzaId)) return false;

        const session = songSessionStore.get(stanzaId);
        const choice = choiceText.trim().replace(/[^1-3]/g, '');

        if (!['1', '2', '3'].includes(choice)) return false;

        sock.sendMessage(chatJid, { react: { text: '⬇️', key: msg.key } }).catch(() => {});

        try {
            const downloadUrl = await getAudioDownloadUrl(session.ytUrl);
            if (!downloadUrl) throw new Error('Could not retrieve media stream link');

            const safeTitle = (session.title || 'Song')
                .replace(/[\/\\?%*:|"<>]/g, '')
                .slice(0, 40)
                .trim();

            // ⚡ Zero-RAM Direct URL Stream Send
            // 1️⃣ AUDIO
            if (choice === '1') {
                await sock.sendMessage(chatJid, {
                    audio: { url: downloadUrl },
                    mimetype: 'audio/mp4',
                    ptt: false,
                    fileName: `${safeTitle}.mp3`
                }, { quoted: msg });
            } 
            // 2️⃣ DOCUMENT
            else if (choice === '2') {
                await sock.sendMessage(chatJid, {
                    document: { url: downloadUrl },
                    mimetype: 'audio/mpeg',
                    fileName: `${safeTitle}.mp3`,
                    caption: `🎵 *${session.title}*\n> © ${BOT_NAME}`
                }, { quoted: msg });
            } 
            // 3️⃣ VOICE NOTE (PTT)
            else if (choice === '3') {
                await sock.sendMessage(chatJid, {
                    audio: { url: downloadUrl },
                    mimetype: 'audio/ogg; codecs=opus',
                    ptt: true
                }, { quoted: msg });
            }

            // Clean RAM memory immediately
            songSessionStore.delete(stanzaId);
            sock.sendMessage(chatJid, { react: { text: '✅', key: msg.key } }).catch(() => {});
            return true;

        } catch (err) {
            console.error('[SONG DOWNLOAD ERROR]:', err.message);
            sock.sendMessage(chatJid, { react: { text: '❌', key: msg.key } }).catch(() => {});
            sock.sendMessage(chatJid, { text: `❌ *Download Failed:* ${err.message || 'Stream unavailable'}` }, { quoted: msg });
            return true;
        }
    }
};

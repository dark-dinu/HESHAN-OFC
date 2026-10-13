const https = require('https');
const http = require('http');

// Chamindu API Credentials
const API_BASE_MP3 = 'https://api.chamindu.site/api/v1/media/ytmp3/dl';
const API_BASE_MP4 = 'https://api.chamindu.site/api/v1/media/ytmp4/dl';
const API_KEY = 'chama_api_ec9848130d1aea209f08fb85e0b4720f';

// RAM Safe Selection Store
const songSessionStore = new Map();

function fetchJson(url) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        client.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(new Error('Invalid API JSON'));
                }
            });
            res.on('error', err => reject(err));
        }).on('error', err => reject(err));
    });
}

function formatViews(viewsStr) {
    if (!viewsStr) return 'N/A';
    const num = parseInt(viewsStr.replace(/[^0-9]/g, ''));
    if (isNaN(num)) return viewsStr;
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
}

function scrapeYouTubeMeta(query) {
    return new Promise((resolve) => {
        const isUrl = /(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com|youtu\.be)/i.test(query);
        const searchUrl = isUrl ? query : `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;

        https.get(searchUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        }, (res) => {
            let html = '';
            res.on('data', chunk => html += chunk);
            res.on('end', () => {
                try {
                    const jsonMatch = html.match(/ytInitialData\s*=\s*({.+?});<\/script>/);
                    if (!jsonMatch) return resolve(null);

                    const data = JSON.parse(jsonMatch[1]);
                    const contents = data.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents[0]?.itemSectionRenderer?.contents;
                    
                    if (!contents) return resolve(null);

                    for (const item of contents) {
                        const vr = item.videoRenderer;
                        if (vr && vr.videoId) {
                            return resolve({
                                videoId: vr.videoId,
                                url: `https://www.youtube.com/watch?v=${vr.videoId}`,
                                title: vr.title?.runs?.[0]?.text || 'YouTube Song',
                                author: vr.ownerText?.runs?.[0]?.text || 'Official Artist',
                                views: formatViews(vr.viewCountText?.simpleText || vr.shortViewCountText?.simpleText || ''),
                                ago: vr.publishedTimeText?.simpleText || 'Recently',
                                duration: vr.lengthText?.simpleText || '3:30',
                                thumbnail: `https://i.ytimg.com/vi/${vr.videoId}/hqdefault.jpg`
                            });
                        }
                    }
                    resolve(null);
                } catch {
                    resolve(null);
                }
            });
        }).on('error', () => resolve(null));
    });
}

async function getAudioDownloadUrl(ytUrl) {
    let res = await fetchJson(`${API_BASE_MP3}?url=${encodeURIComponent(ytUrl)}&quality=128&api_key=${API_KEY}`).catch(() => null);
    if (!res || !res.status || (!res.data?.download_link && !res.data?.direct_url && !res.download_link)) {
        res = await fetchJson(`${API_BASE_MP4}?url=${encodeURIComponent(ytUrl)}&quality=360&api_key=${API_KEY}`).catch(() => null);
    }
    const info = res?.data || res;
    return info?.download_link || info?.direct_url || null;
}

module.exports = {
    name: 'song',
    aliases: ['play', 'ytmp3'],
    
    // 🎵 Card එක යැවීම
    execute: async (sock, msg, args, isDev, BOT_NAME, cleanSender) => {
        const chatJid = msg.key.remoteJid;
        const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
        const quotedText = contextInfo?.quotedMessage?.conversation || 
                           contextInfo?.quotedMessage?.extendedTextMessage?.text || '';

        const query = (args.join(' ') + ' ' + quotedText).trim();

        if (!query) {
            return sock.sendMessage(chatJid, { 
                text: `🎵 *Please provide a song name or YouTube link!*\n\n_Example: .song adariye cozzy_` 
            }, { quoted: msg });
        }

        sock.sendMessage(chatJid, { react: { text: '🔍', key: msg.key } }).catch(() => {});

        try {
            const meta = await scrapeYouTubeMeta(query);
            if (!meta) throw new Error('Song not found on YouTube!');

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

            if (songSessionStore.size >= 40) songSessionStore.delete(songSessionStore.keys().next().value);
            songSessionStore.set(sentCard.key.id, {
                ytUrl: meta.url,
                title: meta.title,
                author: meta.author
            });

            sock.sendMessage(chatJid, { react: { text: '🎶', key: msg.key } }).catch(() => {});

        } catch (err) {
            console.error('[SONG SEARCH ERROR]:', err.message);
            sock.sendMessage(chatJid, { react: { text: '❌', key: msg.key } }).catch(() => {});
            return sock.sendMessage(chatJid, { text: `❌ *Error:* ${err.message}` }, { quoted: msg });
        }
    },

    // 🔢 1, 2, 3 Reply හසුරුවන කොටස
    handleReply: async (sock, msg, choiceText, BOT_NAME) => {
        const chatJid = msg.key.remoteJid;
        const contextInfo = msg.message?.extendedTextMessage?.contextInfo || 
                            msg.message?.[Object.keys(msg.message || {})[0]]?.contextInfo;
        const stanzaId = contextInfo?.stanzaId;

        if (!stanzaId || !songSessionStore.has(stanzaId)) return false;

        const session = songSessionStore.get(stanzaId);
        const choice = choiceText.trim().replace(/[^1-3]/g, '');

        if (!['1', '2', '3'].includes(choice)) return false;

        sock.sendMessage(chatJid, { react: { text: '⏳', key: msg.key } }).catch(() => {});

        try {
            const downloadUrl = await getAudioDownloadUrl(session.ytUrl);
            if (!downloadUrl) throw new Error('Could not generate download link');

            const cleanTitle = session.title.replace(/[^a-zA-Z0-9 ]/g, '').slice(0, 30).trim() || 'Song';

            // 1️⃣ PURE AUDIO (කිසිදු Link Box / Card එකක් නැති පිරිසිදු Audio එක)
            if (choice === '1') {
                await sock.sendMessage(chatJid, {
                    audio: { url: downloadUrl },
                    mimetype: 'audio/mpeg',
                    ptt: false,
                    fileName: `${cleanTitle}.mp3`
                }, { quoted: msg });
            } 
            // 2️⃣ DOCUMENT
            else if (choice === '2') {
                await sock.sendMessage(chatJid, {
                    document: { url: downloadUrl },
                    mimetype: 'audio/mpeg',
                    fileName: `${cleanTitle}.mp3`,
                    caption: `🎵 *${session.title}*\n> © ${BOT_NAME}`
                }, { quoted: msg });
            } 
            // 3️⃣ VOICE NOTE (PTT)
            else if (choice === '3') {
                await sock.sendMessage(chatJid, {
                    audio: { url: downloadUrl },
                    mimetype: 'audio/mp4',
                    ptt: true,
                    waveform: Buffer.from([0, 15, 35, 60, 80, 95, 70, 50, 30, 15, 0, 20, 45, 75, 90, 80, 50, 20, 0, 10, 30, 60, 95, 100, 75, 45, 20, 0])
                }, { quoted: msg });
            }

            sock.sendMessage(chatJid, { react: { text: '✅', key: msg.key } }).catch(() => {});
            return true;

        } catch (err) {
            console.error('[SONG DOWNLOAD ERROR]:', err.message);
            sock.sendMessage(chatJid, { react: { text: '❌', key: msg.key } }).catch(() => {});
            sock.sendMessage(chatJid, { text: `❌ *Download Failed:* ${err.message}` }, { quoted: msg });
            return true;
        }
    }
};

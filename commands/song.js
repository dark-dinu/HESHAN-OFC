const https = require('https');
const http = require('http');

// Chamindu API Credentials
const API_BASE_MP3 = 'https://api.chamindu.site/api/v1/media/ytmp3/dl';
const API_BASE_MP4 = 'https://api.chamindu.site/api/v1/media/ytmp4/dl';
const API_KEY = 'chama_api_ec9848130d1aea209f08fb85e0b4720f';

// Native JSON Fetcher
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
                    reject(new Error('Invalid JSON response'));
                }
            });
            res.on('error', err => reject(err));
        }).on('error', err => reject(err));
    });
}

// YouTube Search Engine
function searchYouTube(query) {
    return new Promise((resolve) => {
        const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
        const req = https.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                const match = data.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
                resolve(match ? `https://www.youtube.com/watch?v=${match[1]}` : null);
            });
        });
        req.on('error', () => resolve(null));
        req.setTimeout(6000, () => { req.destroy(); resolve(null); });
    });
}

function extractYouTubeUrl(text) {
    const match = text.match(/(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/i);
    return match ? match[0] : null;
}

// Title එකේ ඇති Hashtags සහ අනවශ්‍ය Tags අයින් කර පිරිසිදු කිරීම
function cleanSongTitle(rawTitle) {
    if (!rawTitle) return 'YouTube Song';
    return rawTitle
        .replace(/#\S+/g, '') // Remove #hashtags
        .replace(/[\(\[](?:Official\vert{}Music Video\vert{}Video\vert{}Audio\vert{}Lyrics\vert{}4K\vert{}HD\vert{}Remastered)[\)\]]/gi, '') // Remove video tags
        .replace(/\s+/g, ' ')
        .trim();
}

module.exports = {
    name: 'song',
    aliases: ['play', 'ytmp3', 'mp3'],
    execute: async (sock, msg, args, isDev, BOT_NAME, cleanSender) => {
        const chatJid = msg.key.remoteJid;

        const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
        const quotedText = contextInfo?.quotedMessage?.conversation || 
                           contextInfo?.quotedMessage?.extendedTextMessage?.text || '';

        const fullInput = (args.join(' ') + ' ' + quotedText).trim();

        if (!fullInput) {
            return sock.sendMessage(chatJid, { 
                text: `🎵 *Please provide a song name or link!*\n\n_Example: .song adariye cozzy_` 
            }, { quoted: msg });
        }

        // ක්ෂණික Reaction දැමීම
        sock.sendMessage(chatJid, { react: { text: '🎵', key: msg.key } }).catch(() => {});

        try {
            let ytUrl = extractYouTubeUrl(fullInput);
            if (!ytUrl) {
                ytUrl = await searchYouTube(fullInput);
                if (!ytUrl) throw new Error('Song not found on YouTube');
            }

            // Chamindu API Endpoint
            let res = await fetchJson(`${API_BASE_MP3}?url=${encodeURIComponent(ytUrl)}&quality=128&api_key=${API_KEY}`).catch(() => null);

            if (!res || !res.status || (!res.data?.download_link && !res.data?.direct_url && !res.download_link)) {
                res = await fetchJson(`${API_BASE_MP4}?url=${encodeURIComponent(ytUrl)}&quality=360&api_key=${API_KEY}`);
            }

            if (!res || (!res.data && !res.download_link)) {
                throw new Error(res?.message || 'Download link unavailable');
            }

            const info = res.data || res;
            const cleanTitle = cleanSongTitle(info.title);
            const channel = info.channel || 'Official Artist';
            const downloadUrl = info.download_link || info.direct_url;

            // WhatsApp එකට ගැලපෙන High-Quality Standard JPG Thumbnail එකක් සකස් කිරීම (Black Box හැදීම වළක්වයි)
            const videoId = info.video_id || (ytUrl.match(/v=([a-zA-Z0-9_-]{11})/) || [])[1];
            const cleanThumb = videoId 
                ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
                : (info.thumbnail || 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');

            if (!downloadUrl) throw new Error('Audio stream link not found');

            // 🎶 තනි Audio පණිවිඩය පමණක් යැවීම (No clutter, No black box, Clean Player Card)
            await sock.sendMessage(chatJid, {
                audio: { url: downloadUrl },
                mimetype: 'audio/mpeg',
                ptt: false,
                fileName: `${cleanTitle.slice(0, 30)}.mp3`,
                contextInfo: {
                    externalAdReply: {
                        title: cleanTitle,
                        body: `${channel} • MP3 Audio`,
                        thumbnailUrl: cleanThumb,
                        sourceUrl: ytUrl,
                        mediaType: 2,
                        renderLargerThumbnail: false // ලොකු කළු කොටුව සම්පූර්ණයෙන්ම නැති කරයි
                    }
                }
            }, { quoted: msg });

            sock.sendMessage(chatJid, { react: { text: '✅', key: msg.key } }).catch(() => {});

        } catch (err) {
            console.error('[SONG ERROR]:', err.message);
            sock.sendMessage(chatJid, { react: { text: '❌', key: msg.key } }).catch(() => {});
            return sock.sendMessage(chatJid, { text: `❌ *Error:* ${err.message}` }, { quoted: msg });
        }
    }
};

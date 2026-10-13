const https = require('https');
const http = require('http');

// Chamindu API Credentials
const API_BASE_MP3 = 'https://api.chamindu.site/api/v1/media/ytmp3/dl';
const API_BASE_MP4 = 'https://api.chamindu.site/api/v1/media/ytmp4/dl';
const API_KEY = 'chama_api_ec9848130d1aea209f08fb85e0b4720f';

// Fast JSON Fetcher
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
                    reject(new Error('Invalid JSON received from API'));
                }
            });
            res.on('error', err => reject(err));
        }).on('error', err => reject(err));
    });
}

// Fast YouTube Search (නමෙන් Link එක සෙවීම)
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
                if (match) {
                    resolve(`https://www.youtube.com/watch?v=${match[1]}`);
                } else {
                    resolve(null);
                }
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
                text: `⚠️ *Please provide a song name or YouTube link!*\n\n*Usage:* .song <song name or link>\n*Example:* .song Neth Manema` 
            }, { quoted: msg });
        }

        // Reaction දැමීම
        sock.sendMessage(chatJid, { react: { text: '🎵', key: msg.key } }).catch(() => {});

        try {
            let ytUrl = extractYouTubeUrl(fullInput);
            if (!ytUrl) {
                ytUrl = await searchYouTube(fullInput);
                if (!ytUrl) throw new Error('No search results found on YouTube.');
            }

            // Chamindu API
            let res = await fetchJson(`${API_BASE_MP3}?url=${encodeURIComponent(ytUrl)}&quality=128&api_key=${API_KEY}`).catch(() => null);

            if (!res || !res.status || (!res.data?.download_link && !res.data?.direct_url && !res.download_link)) {
                res = await fetchJson(`${API_BASE_MP4}?url=${encodeURIComponent(ytUrl)}&quality=360&api_key=${API_KEY}`);
            }

            if (!res || (!res.data && !res.download_link)) {
                throw new Error(res?.message || 'Failed to generate download link from API.');
            }

            const info = res.data || res;
            const title = info.title || 'YouTube Audio';
            const channel = info.channel || 'Official Artist';
            const downloadUrl = info.download_link || info.direct_url;
            const thumbnail = info.thumbnail || 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg';
            const engine = info.engine || 'SaveTube High Speed 10Gbps CDN';

            if (!downloadUrl) throw new Error('Audio download link is missing.');

            // 🎵 Audio Player Card
            const cardCaption = 
`🎵⃝🎧┅┅┅┅┅┅┅┅┅┅┅┅┅▣
┃ 𝐘𝐎𝐔𝐓𝐔𝐁𝐄 𝐀𝐔𝐃𝐈𝐎 𝐏𝐋𝐀𝐘𝐄𝐑
> *📌 ᴛɪᴛʟᴇ:* ${title}
> *👤 ᴄʜᴀɴɴᴇʟ:* ${channel}
> *💽 ǫᴜᴀʟɪᴛʏ:* 320kbps Pure MP3
> *⚡ ᴇɴɢɪɴᴇ:* ${engine}
> *❬  ${BOT_NAME}  ❭*`;

            await sock.sendMessage(chatJid, {
                image: { url: thumbnail },
                caption: cardCaption
            }, { quoted: msg });

            // 🎶 Pure MP3 Audio File (Never Voice Note)
            await sock.sendMessage(chatJid, {
                audio: { url: downloadUrl },
                mimetype: 'audio/mpeg',
                ptt: false,
                fileName: `${title.replace(/[^a-zA-Z0-9 ]/g, '').slice(0, 30)}.mp3`,
                contextInfo: {
                    externalAdReply: {
                        title: title,
                        body: channel,
                        thumbnailUrl: thumbnail,
                        mediaType: 1,
                        renderLargerThumbnail: true
                    }
                }
            }, { quoted: msg });

            sock.sendMessage(chatJid, { react: { text: '✅', key: msg.key } }).catch(() => {});

        } catch (err) {
            console.error('[SONG ERROR]:', err.message);
            sock.sendMessage(chatJid, { react: { text: '❌', key: msg.key } }).catch(() => {});
            return sock.sendMessage(chatJid, { text: `❌ *Failed to fetch song:* ${err.message}` }, { quoted: msg });
        }
    }
};

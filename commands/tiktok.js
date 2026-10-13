const https = require('https');
const http = require('http');

// Chamindu API Credentials
const API_BASE = 'https://api.chamindu.site/api/v1/tiktok';
const API_KEY = 'chama_api_ec9848130d1aea209f08fb85e0b4720f';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Redirects හසුරුවන Native JSON Fetcher
function fetchJson(url) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        const req = client.get(url, { headers: { 'User-Agent': UA } }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return fetchJson(res.headers.location).then(resolve).catch(reject);
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(new Error('Invalid JSON response from server'));
                }
            });
            res.on('error', err => reject(err));
        });
        req.on('error', err => reject(err));
        req.setTimeout(30000, () => { req.destroy(); reject(new Error('API request timeout')); });
    });
}

// Format numbers (e.g. 591294 -> 591.3K)
function formatCount(num) {
    if (!num && num !== 0) return '0';
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
}

// Extract TikTok URL from text
function extractTikTokUrl(text) {
    const match = text.match(/https?:\/\/(?:www\.|vm\.|vt\.|t\.)?tiktok\.com\/[^\s]+/i);
    return match ? match[0] : null;
}

module.exports = {
    name: 'tiktok',
    aliases: ['tt', 'ttdl', 'tiktokdl'],
    execute: async (sock, msg, args, isDev, BOT_NAME, cleanSender, cmdName) => {
        const chatJid = msg.key.remoteJid;

        // Quoted message එකෙහි link එකක් ඇත්නම් එයද ලබාගැනීම
        const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
        const quotedText = contextInfo?.quotedMessage?.conversation || 
                           contextInfo?.quotedMessage?.extendedTextMessage?.text || '';

        const fullInput = (args || []).join(' ') + ' ' + quotedText;
        const tiktokUrl = extractTikTokUrl(fullInput);

        if (!tiktokUrl) {
            return sock.sendMessage(chatJid, { 
                text: `⚠️ *Please provide a valid TikTok video URL!*\n\n*Usage:*\n.tt <tiktok_link>\n.tt mp3 <tiktok_link> _(Audio only)_\n\n*Example:*\n.tt https://vt.tiktok.com/ZSxxxxxx/` 
            }, { quoted: msg });
        }

        const isAudioOnly = args[0]?.toLowerCase() === 'mp3' || args[0]?.toLowerCase() === 'audio';

        sock.sendMessage(chatJid, { react: { text: '🎥', key: msg.key } }).catch(() => {});

        try {
            const endpoint = `${API_BASE}?url=${encodeURIComponent(tiktokUrl)}&api_key=${API_KEY}`;
            const res = await fetchJson(endpoint);

            if (!res || !res.status || !res.data) {
                throw new Error(res?.message || 'Could not fetch TikTok media from API.');
            }

            const item = res.data;
            const title = item.title ? item.title.trim() : 'No Title';
            const authorName = item.author?.nickname || item.author?.unique_id || 'TikTok User';
            const authorUser = item.author?.unique_id ? `@${item.author.unique_id}` : '';
            const duration = item.duration || 0;

            const views = formatCount(item.stats?.views);
            const likes = formatCount(item.stats?.likes);
            const comments = formatCount(item.stats?.comments);
            const shares = formatCount(item.stats?.shares);

            // 🎵 1. Audio-only download (.tt mp3 <url>)
            const audioUrl = item.downloads?.audio || item.music_info?.play_url;
            if (isAudioOnly && audioUrl) {
                await sock.sendMessage(chatJid, {
                    audio: { url: audioUrl },
                    mimetype: 'audio/mp4',
                    ptt: false,
                    fileName: `${(item.music_info?.title || title).slice(0, 30)}.mp3`
                }, { quoted: msg });

                sock.sendMessage(chatJid, { react: { text: '🎵', key: msg.key } }).catch(() => {});
                return;
            }

            // 📸 2. Photo Slide post එකක් නම් images ලෙස යැවීම
            if (item.images && Array.isArray(item.images) && item.images.length > 0) {
                for (const imgUrl of item.images.slice(0, 5)) {
                    await sock.sendMessage(chatJid, { image: { url: imgUrl } });
                }
                sock.sendMessage(chatJid, { react: { text: '✅', key: msg.key } }).catch(() => {});
                return;
            }

            // 🎬 3. Video Direct Download
            const videoUrl = item.downloads?.no_watermark_hd || 
                             item.downloads?.no_watermark || 
                             item.downloads?.no_watermark_sd || 
                             item.downloads?.with_watermark;

            if (!videoUrl) {
                throw new Error('Video download URL not found in API response.');
            }

            const captionCard = 
`🎶⃝💞┅┅┅┅┅┅┅┅┅┅┅┅┅▣
┃ ᴛɪᴋᴛᴏᴋ ᴅᴏᴡɴʟᴏᴀᴅ

> *📌 ᴛɪᴛʟᴇ:* ${title}
> *👤 ᴜꜱᴇʀ:* ${authorName} (${authorUser})
> *⏱️ ᴛɪᴍᴇ:* ${duration}s
> *👁️ ᴠɪᴇᴡꜱ:* ${views} | *❤️ ʟɪᴋᴇꜱ:* ${likes}
> *💬 ᴄᴏᴍᴍᴇɴᴛꜱ:* ${comments} | *🔁 ꜱʜᴀʀᴇꜱ:* ${shares}

> *❬  ❄️ ${BOT_NAME}  ❭*`;

            await sock.sendMessage(chatJid, {
                video: { url: videoUrl },
                caption: captionCard,
                mimetype: 'video/mp4'
            }, { quoted: msg });

            sock.sendMessage(chatJid, { react: { text: '✅', key: msg.key } }).catch(() => {});

        } catch (err) {
            console.error('[TIKTOK DL ERROR]:', err.message);
            sock.sendMessage(chatJid, { react: { text: '❌', key: msg.key } }).catch(() => {});
            return sock.sendMessage(chatJid, { 
                text: `❌ *TikTok Download Failed!*\n\n*Error:* ${err.message}` 
            }, { quoted: msg });
        }
    }
};

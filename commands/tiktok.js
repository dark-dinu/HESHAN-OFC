const axios = require('axios');

// Chamindu API Credentials
const API_BASE = 'https://api.chamindu.site/api/v1/tiktok';
const API_KEY = 'chama_api_ec9848130d1aea209f08fb85e0b4720f';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Format numbers (e.g. 591294 -> 591.3K)
function formatCount(num) {
    if (!num && num !== 0) return '0';
    const n = Number(num);
    if (isNaN(n)) return '0';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return n.toString();
}

// Extract TikTok URL from text
function extractTikTokUrl(text) {
    if (!text) return null;
    const match = text.match(/https?:\/\/(?:www\.|vm\.|vt\.|t\.)?tiktok\.com\/[^\s]+/i);
    return match ? match[0] : null;
}

module.exports = {
    name: 'tiktok',
    aliases: ['tt', 'ttdl', 'tiktokdl'],
    execute: async (sock, msg, args, isDev, BOT_NAME, cleanSender, cmdName) => {
        const chatJid = msg.key?.remoteJid;
        if (!chatJid) return;

        // Quoted message එකෙහි link එකක් ඇත්නම් එයද ලබාගැනීම
        const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
        const quotedText = contextInfo?.quotedMessage?.conversation || 
                           contextInfo?.quotedMessage?.extendedTextMessage?.text || 
                           contextInfo?.quotedMessage?.imageMessage?.caption ||
                           contextInfo?.quotedMessage?.videoMessage?.caption || '';

        const fullInput = ((args || []).join(' ') + ' ' + quotedText).trim();
        const tiktokUrl = extractTikTokUrl(fullInput);

        if (!tiktokUrl) {
            return sock.sendMessage(chatJid, { 
                text: `⚠️ *Please provide a valid TikTok URL!*\n\n*Usage:*\n.tt <tiktok_link>\n.tt mp3 <tiktok_link> _(Audio only)_\n\n*Example:*\n.tt https://vt.tiktok.com/ZSxxxxxx/` 
            }, { quoted: msg });
        }

        const isAudioOnly = (args[0] || '').toLowerCase() === 'mp3' || (args[0] || '').toLowerCase() === 'audio';

        sock.sendMessage(chatJid, { react: { text: '🎥', key: msg.key } }).catch(() => {});

        try {
            const endpoint = `${API_BASE}?url=${encodeURIComponent(tiktokUrl)}&api_key=${API_KEY}`;
            const { data: res } = await axios.get(endpoint, {
                headers: { 'User-Agent': UA },
                timeout: 15000
            });

            if (!res || !res.status || !res.data) {
                throw new Error(res?.message || 'Could not fetch TikTok media.');
            }

            const item = res.data;
            const title = (item.title || 'TikTok Media').trim();
            const authorName = item.author?.nickname || item.author?.unique_id || 'TikTok User';
            const authorUser = item.author?.unique_id ? `@${item.author.unique_id}` : '';
            const duration = item.duration || 0;

            const views = formatCount(item.stats?.views);
            const likes = formatCount(item.stats?.likes);
            const comments = formatCount(item.stats?.comments);
            const shares = formatCount(item.stats?.shares);

            const captionCard = 
`🎶⃝💞┅┅┅┅┅┅┅┅┅┅┅┅┅▣
┃ ᴛɪᴋᴛᴏᴋ ᴅᴏᴡɴʟᴏᴀᴅ

> *📌 ᴛɪᴛʟᴇ:* ${title}
> *👤 ᴜꜱᴇʀ:* ${authorName} ${authorUser ? `(${authorUser})` : ''}
> *⏱️ ᴛɪᴍᴇ:* ${duration}s
> *👁️ ᴠɪᴇᴡꜱ:* ${views} | *❤️ ʟɪᴋᴇꜱ:* ${likes}
> *💬 ᴄᴏᴍᴍᴇɴᴛꜱ:* ${comments} | *🔁 ꜱʜᴀʀᴇꜱ:* ${shares}

> *❬  ❄️ ${BOT_NAME}  ❭*`;

            // 🎵 1. Audio-only download (.tt mp3 <url>)
            const audioUrl = item.downloads?.audio || item.music_info?.play_url;
            if (isAudioOnly) {
                if (!audioUrl) throw new Error('Audio track not available for this post.');

                await sock.sendMessage(chatJid, {
                    audio: { url: audioUrl },
                    mimetype: 'audio/mp4',
                    ptt: false,
                    fileName: `${title.slice(0, 30).replace(/[^a-zA-Z0-9]/g, '_')}.mp3`
                }, { quoted: msg });

                sock.sendMessage(chatJid, { react: { text: '🎵', key: msg.key } }).catch(() => {});
                return;
            }

            // 📸 2. Photo Slide post එකක් නම් images ලෙස යැවීම (උපරිම 5කට සීමා කර ඇත - RAM Guard)
            if (item.images && Array.isArray(item.images) && item.images.length > 0) {
                const imgList = item.images.slice(0, 5);
                for (let i = 0; i < imgList.length; i++) {
                    const imgUrl = imgList[i];
                    await sock.sendMessage(chatJid, { 
                        image: { url: imgUrl },
                        caption: i === 0 ? captionCard : undefined
                    }, i === 0 ? { quoted: msg } : undefined);
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
                throw new Error('Video download URL not found.');
            }

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
                text: `❌ *TikTok Download Failed!*\n\n*Error:* ${err.message || 'Media unavailable or network timeout'}` 
            }, { quoted: msg });
        }
    }
};

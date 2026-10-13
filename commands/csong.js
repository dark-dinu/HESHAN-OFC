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

// YouTube Fast Search
function searchYouTube(query) {
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
                                title: vr.title?.runs?.[0]?.text || 'Channel Song',
                                author: vr.ownerText?.runs?.[0]?.text || 'Artist',
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

// Clean Title Helper
function cleanTitle(raw) {
    if (!raw) return 'Song';
    return raw
        .replace(/#\S+/g, '')
        .replace(/[\(\[](?:Official|Music Video|Video|Audio|Lyrics|4K|HD|Remastered)[\)\]]/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
}

module.exports = {
    name: 'csong',
    aliases: ['channelsong', 'cvoice'],
    execute: async (sock, msg, args, isDev, BOT_NAME, cleanSender) => {
        const currentChat = msg.key.remoteJid;
        const rawInput = args.join(' ').trim();

        if (!rawInput) {
            return sock.sendMessage(currentChat, {
                text: `📻 *Channel Song Poster*\n\n*Usage:*\n• \`.csong <channel_link>, <song_name>\`\n• \`.csong <song_name>\` _(if used inside channel)_\n\n*Example:*\n\`.csong https://whatsapp.com/channel/0029Va..., adariye cozzy\``
            }, { quoted: msg });
        }

        // Reaction දැමීම
        sock.sendMessage(currentChat, { react: { text: '🎙️', key: msg.key } }).catch(() => {});

        let targetJid = currentChat;
        let songQuery = rawInput;

        // Channel Link එකක් තිබේදැයි පරීක්ෂා කිරීම
        const channelLinkMatch = rawInput.match(/https?:\/\/(?:www\.)?whatsapp\.com\/channel\/([a-zA-Z0-9_-]+)/i);

        if (channelLinkMatch) {
            const inviteCode = channelLinkMatch[1];
            try {
                // Newsletter (Channel) Metadata Resolve කිරීම
                const metadata = await sock.newsletterMetadata('invite', inviteCode);
                if (metadata && metadata.id) {
                    targetJid = metadata.id; // e.g. 120363xxx@newsletter
                }
            } catch (err) {
                console.error('[CSONG] Channel resolution failed:', err.message);
                sock.sendMessage(currentChat, { react: { text: '❌', key: msg.key } }).catch(() => {});
                return sock.sendMessage(currentChat, { 
                    text: `❌ *Invalid Channel Link or Bot has no permission to access this channel!*` 
                }, { quoted: msg });
            }

            // Link එක ඉවත් කර සින්දුවේ නම පමණක් ලබාගැනීම
            songQuery = rawInput
                .replace(channelLinkMatch[0], '')
                .replace(/^[\s,]+|[\s,]+$/g, '')
                .trim();
        }

        if (!songQuery) {
            return sock.sendMessage(currentChat, { 
                text: `⚠️ *Please provide a song name after the channel link!*\n\n_Example: .csong https://whatsapp.com/channel/xxx, adariye cozzy_` 
            }, { quoted: msg });
        }

        try {
            // YouTube Search
            const meta = await searchYouTube(songQuery);
            if (!meta) throw new Error('Song not found on YouTube');

            // Chamindu API Endpoint
            let res = await fetchJson(`${API_BASE_MP3}?url=${encodeURIComponent(meta.url)}&quality=128&api_key=${API_KEY}`).catch(() => null);
            if (!res || !res.status || (!res.data?.download_link && !res.data?.direct_url && !res.download_link)) {
                res = await fetchJson(`${API_BASE_MP4}?url=${encodeURIComponent(meta.url)}&quality=360&api_key=${API_KEY}`).catch(() => null);
            }

            const info = res?.data || res;
            const downloadUrl = info?.download_link || info?.direct_url;
            if (!downloadUrl) throw new Error('Download stream link unavailable');

            const cTitle = cleanTitle(meta.title);

            // 🎶 Channel එකට ගැළපෙන Mini Aesthetic Card එක
            const miniChannelCard = 
`🎶⃝📻 ━━━━━━━━━━━━━━━━━ ⌑
┃ ✦ *${cTitle}*
┃ 👤 *Artist:* ${meta.author}
┃ 🎧 *Channel Exclusive Track*
┗━━━━━━━━━━━━━━━━━ ⌑
> *© ${BOT_NAME}*`;

            // 1. Thumbnail Image එක Mini Caption එක සමඟ Channel එකට යැවීම
            await sock.sendMessage(targetJid, {
                image: { url: meta.thumbnail },
                caption: miniChannelCard
            });

            // 2. 🎙️ Original WhatsApp Microphone Waveform සහිත Voice Note එක
            await sock.sendMessage(targetJid, {
                audio: { url: downloadUrl },
                mimetype: 'audio/mp4',
                ptt: true,
                waveform: Buffer.from([0, 18, 38, 65, 88, 100, 82, 58, 35, 18, 0, 22, 50, 78, 98, 88, 58, 28, 0, 15, 38, 70, 95, 100, 82, 48, 18, 0])
            });

            // තමන් command එක ගැසූ chat එකට සාර්ථක වූ බවට reaction එක සහ confirm message එක
            sock.sendMessage(currentChat, { react: { text: '✅', key: msg.key } }).catch(() => {});
            
            if (targetJid !== currentChat) {
                await sock.sendMessage(currentChat, { 
                    text: `✅ *Track successfully posted to the Channel!* 📻\n\n📌 *Title:* ${cTitle}` 
                }, { quoted: msg });
            }

        } catch (err) {
            console.error('[CSONG ERROR]:', err.message);
            sock.sendMessage(currentChat, { react: { text: '❌', key: msg.key } }).catch(() => {});
            return sock.sendMessage(currentChat, { text: `❌ *Error:* ${err.message}` }, { quoted: msg });
        }
    }
};

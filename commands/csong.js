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

// ⚡ CDN Buffer Downloader (CDN Block වීම් සහ Stream Failure 100% වළක්වයි)
function fetchBuffer(url) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        client.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return fetchBuffer(res.headers.location).then(resolve).catch(reject);
            }
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => resolve(Buffer.concat(chunks)));
            res.on('error', err => reject(err));
        }).on('error', err => reject(err));
    });
}

// Fast YouTube Search
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

function cleanTitle(raw) {
    if (!raw) return 'Song';
    return raw
        .replace(/#\S+/g, '')
        .replace(/[\(\[](?:Official|Music Video|Video|Audio|Lyrics|4K|HD|Remastered)[\)\]]/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
}

// Channel URL එකෙන් නියම Invite Code එක පමණක් වෙන් කර ගැනීම (අග ඇති /392 වැනි post IDs ඉවත් කරයි)
function extractChannelInviteCode(url) {
    const match = url.match(/whatsapp\.com\/channel\/([a-zA-Z0-9]{20,24})/i);
    return match ? match[1] : null;
}

module.exports = {
    name: 'csong',
    aliases: ['channelsong', 'cvoice'],
    execute: async (sock, msg, args, isDev, BOT_NAME, cleanSender) => {
        const currentChat = msg.key.remoteJid;
        const rawInput = args.join(' ').trim();

        if (!rawInput) {
            return sock.sendMessage(currentChat, {
                text: `🎙️ *Channel Voice Note Poster*\n\n*Usage:*\n.csong <channel_link>, <song_name>\n\n*Example:*\n.csong https://whatsapp.com/channel/0029VbAQYhXDZ4Lfo9K5gh1V, sadawathiye`
            }, { quoted: msg });
        }

        sock.sendMessage(currentChat, { react: { text: '⏳', key: msg.key } }).catch(() => {});

        let targetJid = null;
        let songQuery = rawInput;

        // 1. Channel JID එක සොයා ගැනීම
        const inviteCode = extractChannelInviteCode(rawInput);

        if (inviteCode) {
            try {
                const metadata = await sock.newsletterMetadata('invite', inviteCode);
                if (!metadata || !metadata.id) throw new Error('Channel ID not found');
                targetJid = metadata.id; // e.g. 120363421906774107@newsletter
            } catch (err) {
                console.error('[CSONG RESOLVE ERROR]:', err.message);
                sock.sendMessage(currentChat, { react: { text: '❌', key: msg.key } }).catch(() => {});
                return sock.sendMessage(currentChat, { 
                    text: `❌ *Channel එක සොයාගත නොහැකි විය!*\n\n*Error:* ${err.message}` 
                }, { quoted: msg });
            }

            // Link එක ඉවත් කර සින්දුවේ නම වෙන් කිරීම
            songQuery = rawInput
                .replace(/https?:\/\/(?:www\.)?whatsapp\.com\/channel\/[a-zA-Z0-9_\-\/]+/i, '')
                .replace(/^[\s,]+|[\s,]+$/g, '')
                .trim();
        } else if (currentChat.endsWith('@newsletter')) {
            targetJid = currentChat;
        }

        if (!targetJid) {
            sock.sendMessage(currentChat, { react: { text: '⚠️', key: msg.key } }).catch(() => {});
            return sock.sendMessage(currentChat, { 
                text: `⚠️ *Channel Link එක හඳුනාගත නොහැකි විය!*\n\n.csong https://whatsapp.com/channel/xxx, <song_name>` 
            }, { quoted: msg });
        }

        if (!songQuery) {
            sock.sendMessage(currentChat, { react: { text: '⚠️', key: msg.key } }).catch(() => {});
            return sock.sendMessage(currentChat, { 
                text: `⚠️ *කරුණාකර සින්දුවේ නම ලබාදෙන්න!*\n\nඋදා: .csong https://whatsapp.com/channel/xxx, sadawathiye` 
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
            if (!downloadUrl) throw new Error('Audio download stream link is missing');

            const cTitle = cleanTitle(meta.title);

            // 🎶 Channel Mini Aesthetic Poster Card
            const miniChannelCard = 
`🎶⃝📻 ━━━━━━━━━━━━━━━━━ ⌑
┃ ✦ *${cTitle}*
┃ 👤 *Artist:* ${meta.author}
┃ 🎙️ *Channel Exclusive Voice Note*
┗━━━━━━━━━━━━━━━━━ ⌑
> *© ${BOT_NAME}*`;

            // ⚡ Buffer Downloads (Zero CDN blocking)
            const [thumbBuffer, audioBuffer] = await Promise.all([
                fetchBuffer(meta.thumbnail).catch(() => null),
                fetchBuffer(downloadUrl)
            ]);

            // 1. Thumbnail Image එක Mini Caption එක සමඟ Channel එකට Post කිරීම
            if (thumbBuffer) {
                await sock.sendMessage(targetJid, {
                    image: thumbBuffer,
                    caption: miniChannelCard
                });
            }

            // 2. 🎙️ නියම Voice Note එකක් (PTT) ලෙස Channel එකට Post කිරීම
            await sock.sendMessage(targetJid, {
                audio: audioBuffer,
                mimetype: 'audio/mp4',
                ptt: true
            });

            sock.sendMessage(currentChat, { react: { text: '✅', key: msg.key } }).catch(() => {});
            
            if (targetJid !== currentChat) {
                await sock.sendMessage(currentChat, { 
                    text: `✅ *Voice Note successfully posted to the Channel!* 🎙️\n\n📌 *Song:* ${cTitle}\n📍 *Channel:* \`${targetJid}\`` 
                }, { quoted: msg });
            }

        } catch (err) {
            console.error('[CSONG EXECUTION ERROR]:', err);
            sock.sendMessage(currentChat, { react: { text: '❌', key: msg.key } }).catch(() => {});
            return sock.sendMessage(currentChat, { 
                text: `❌ *Channel එකට දැමීම අසාර්ථක විය!*\n\n*Error:* ${err.message}` 
            }, { quoted: msg });
        }
    }
};

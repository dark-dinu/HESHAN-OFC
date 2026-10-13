const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');

const API_KEY = 'chama_api_ec9848130d1aea209f08fb85e0b4720f';

// ⚡ Helper: FFmpeg මඟින් ඕනෑම Audio Buffer එකක් නියම WhatsApp Voice Note (OGG Opus) බවට පත් කිරීම
function convertToWhatsAppVoice(inputBuffer) {
    return new Promise((resolve) => {
        const tempId = Date.now() + '_' + Math.random().toString(36).substring(7);
        const tempInput = path.join(os.tmpdir(), `input_${tempId}.mp3`);
        const tempOutput = path.join(os.tmpdir(), `output_${tempId}.opus`);

        fs.writeFile(tempInput, inputBuffer, (err) => {
            if (err) return resolve(inputBuffer);

            // WhatsApp Voice Note Codec: libopus, 48kHz, 1 channel (mono)
            const cmd = `ffmpeg -y -i "${tempInput}" -c:a libopus -b:a 64k -vbr on -compression_level 10 -ar 48000 -ac 1 "${tempOutput}"`;

            exec(cmd, (error) => {
                try { if (fs.existsSync(tempInput)) fs.unlinkSync(tempInput); } catch (e) {}

                if (error) {
                    console.warn('[FFMPEG WARN]:', error.message);
                    return resolve(inputBuffer); // FFmpeg නැතිනම් fallback
                }

                try {
                    if (fs.existsSync(tempOutput)) {
                        const outputBuffer = fs.readFileSync(tempOutput);
                        fs.unlinkSync(tempOutput);
                        return resolve(outputBuffer);
                    }
                } catch (readErr) {}

                resolve(inputBuffer);
            });
        });
    });
}

// Native JSON Fetcher
function fetchJson(url) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        client.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('Invalid JSON')); }
            });
            res.on('error', err => reject(err));
        }).on('error', err => reject(err));
    });
}

// Redirect-aware Buffer Downloader
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

// Fast YouTube Scraper (No extra npm needed)
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
                                duration: vr.lengthText?.simpleText || '4:00',
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

module.exports = {
    name: 'csong',
    aliases: ['channelsong', 'cvoice', 'cplay'],
    execute: async (sock, msg, args, isDev, BOT_NAME, cleanSender) => {
        const from = msg.key.remoteJid;
        const fullText = args.join(' ').trim();

        if (!fullText) {
            return sock.sendMessage(from, {
                text: `⚠️ *භාවිතය:*\n*.csong <channel_link> , <song_name>*\n\n*උදාහරණ:*\n.csong https://whatsapp.com/channel/0029VbAQYhXDZ4Lfo9K5gh1V , sadawathiye`
            }, { quoted: msg });
        }

        let channelLink = '';
        let songName = '';

        if (fullText.includes(',')) {
            const parts = fullText.split(',');
            channelLink = parts[0].trim();
            songName = parts.slice(1).join(',').trim();
        } else {
            const match = fullText.match(/https?:\/\/(?:www\.)?whatsapp\.com\/channel\/[^\s]+/i);
            if (match) {
                channelLink = match[0];
                songName = fullText.replace(match[0], '').trim();
            } else {
                return sock.sendMessage(from, {
                    text: `⚠️ කරුණාකර Channel Link එක සහ සින්දුවේ නම කොමාවකින් (,) වෙන් කර ලබාදෙන්න!`
                }, { quoted: msg });
            }
        }

        // 🎯 පරණ කේතයේ ක්‍රමයට Invite Code එකෙන් /392 වැනි post IDs ඉවත් කිරීම
        const inviteCode = channelLink.split("whatsapp.com/channel/")[1]?.split("/")[0]?.split("?")[0]?.trim();
        if (!inviteCode) {
            return sock.sendMessage(from, { text: '❌ වලංගු WhatsApp Channel Link එකක් ලබාදෙන්න!' }, { quoted: msg });
        }

        sock.sendMessage(from, { react: { text: '⏳', key: msg.key } }).catch(() => {});

        try {
            const channelMeta = await sock.newsletterMetadata('invite', inviteCode);
            const channelJid = channelMeta?.id;

            if (!channelJid) {
                sock.sendMessage(from, { react: { text: '❌', key: msg.key } }).catch(() => {});
                return sock.sendMessage(from, { text: '❌ Channel එක සොයාගත නොහැකි විය. Link එක පරීක්ෂා කරන්න.' }, { quoted: msg });
            }

            // 1. YouTube Search
            const video = await searchYouTube(songName);
            if (!video) {
                sock.sendMessage(from, { react: { text: '❌', key: msg.key } }).catch(() => {});
                return sock.sendMessage(from, { text: '❌ සින්දුව සොයාගත නොහැකි විය.' }, { quoted: msg });
            }

            // 2. Chamindu API හරහා Direct Download URL ලබා ගැනීම
            let audioDownloadUrl = null;
            const endpoints = [
                `https://api.chamindu.site/api/v1/youtube/download?url=${encodeURIComponent(video.url)}&quality=128kbps&format=mp3&api_key=${API_KEY}`,
                `https://api.chamindu.site/api/v1/media/ytmp3/dl?url=${encodeURIComponent(video.url)}&quality=128&api_key=${API_KEY}`,
                `https://api.chamindu.site/api/v1/media/ytmp4/dl?url=${encodeURIComponent(video.url)}&quality=360&api_key=${API_KEY}`
            ];

            for (const ep of endpoints) {
                try {
                    const res = await fetchJson(ep);
                    audioDownloadUrl = res?.data?.direct_url || res?.data?.download_url || res?.data?.download_link || res?.download_link;
                    if (audioDownloadUrl) break;
                } catch (e) {}
            }

            if (!audioDownloadUrl) {
                throw new Error('Audio Download link ලබාගැනීමට නොහැකි විය.');
            }

            // Audio Buffer කර ගැනීම
            const rawBuffer = await fetchBuffer(audioDownloadUrl);

            // 3. Local FFmpeg මඟින් Original WhatsApp Voice Note (OGG Opus) බවට Convert කිරීම
            const voiceBuffer = await convertToWhatsAppVoice(rawBuffer);

            // 4. STEP 1: ලස්සන Mini Card Banner එක Channel එකට යැවීම
            const cardCaption = 
`🎶 *“ ${video.title} ”*

0:00 ◁◁  II  ▷▷ ${video.duration}

Use Headphones For Best Experience.... 🎧🎵

| ⚡ *${BOT_NAME}*`;

            await sock.sendMessage(channelJid, {
                image: { url: video.thumbnail },
                caption: cardCaption
            });

            // 5. STEP 2: Real Playable Voice Note එක (OGG Opus) Channel එකට යැවීම
            await sock.sendMessage(channelJid, {
                audio: voiceBuffer,
                mimetype: 'audio/ogg; codecs=opus',
                ptt: true
            });

            sock.sendMessage(from, { react: { text: '✅', key: msg.key } }).catch(() => {});
            return sock.sendMessage(from, {
                text: `✅ *"${video.title}"*\nChannel එකට Original Voice Note එකක් ලෙස සාර්ථකව Post කරන ලදී! 🎙️🔥`
            }, { quoted: msg });

        } catch (err) {
            console.error('[CSONG ERROR]:', err);
            sock.sendMessage(from, { react: { text: '❌', key: msg.key } }).catch(() => {});
            return sock.sendMessage(from, { text: `❌ Error: ${err.message || 'Failed to post voice note to channel'}` }, { quoted: msg });
        }
    }
};

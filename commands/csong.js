const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');
const { exec } = require('child_process');

// 🔑 Chamindu Official API Key
const API_KEY = process.env.CHAMINDU_API_KEY || 'chama_api_ec9848130d1aea209f08fb85e0b4720f';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// ── Native JSON Fetcher (Axios නැතත් වැඩ කරයි) ──
function fetchJson(url) {
    return new Promise((resolve) => {
        const client = url.startsWith('https') ? https : http;
        const req = client.get(url, { headers: { 'User-Agent': UA } }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return fetchJson(res.headers.location).then(resolve);
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); } catch (e) { resolve(null); }
            });
        });
        req.on('error', () => resolve(null));
        req.setTimeout(25000, () => { req.destroy(); resolve(null); });
    });
}

// ── Native Buffer Downloader ──
function downloadBuffer(url) {
    return new Promise((resolve) => {
        const client = url.startsWith('https') ? https : http;
        const req = client.get(url, { headers: { 'User-Agent': UA } }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return downloadBuffer(res.headers.location).then(resolve);
            }
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => resolve(Buffer.concat(chunks)));
        });
        req.on('error', () => resolve(null));
        req.setTimeout(60000, () => { req.destroy(); resolve(null); });
    });
}

// ── FFmpeg WhatsApp Voice Note (OGG Opus) Converter ──
function convertToWhatsAppVoice(inputBuffer) {
    return new Promise((resolve) => {
        let ffmpegBinary = 'ffmpeg';
        try {
            ffmpegBinary = require('@ffmpeg-installer/ffmpeg').path;
        } catch (e) {
            ffmpegBinary = 'ffmpeg';
        }

        const tempId = Date.now() + '_' + Math.random().toString(36).substring(7);
        const tempInput = path.join(os.tmpdir(), `in_${tempId}.mp3`);
        const tempOutput = path.join(os.tmpdir(), `out_${tempId}.opus`);

        fs.writeFile(tempInput, inputBuffer, (err) => {
            if (err) return resolve({ buffer: inputBuffer, isOpus: false });

            const cmd = `"${ffmpegBinary}" -y -i "${tempInput}" -c:a libopus -b:a 64k -vbr on -compression_level 10 -ar 48000 -ac 1 "${tempOutput}"`;

            exec(cmd, (error) => {
                try { if (fs.existsSync(tempInput)) fs.unlinkSync(tempInput); } catch (e) {}

                if (!error && fs.existsSync(tempOutput)) {
                    try {
                        const outBuf = fs.readFileSync(tempOutput);
                        fs.unlinkSync(tempOutput);
                        return resolve({ buffer: outBuf, isOpus: true });
                    } catch (e) {}
                }

                // FFmpeg නැතිනම් raw buffer එකෙන් වැඩ කරයි (Crash වෙන්නේ නෑ)
                resolve({ buffer: inputBuffer, isOpus: false });
            });
        });
    });
}

// ── Fast YouTube Search Scraper ──
function searchYouTube(query) {
    return new Promise((resolve) => {
        const isUrl = /(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com|youtu\.be)/i.test(query);
        const searchUrl = isUrl ? query : `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;

        https.get(searchUrl, {
            headers: {
                'User-Agent': UA,
                'Accept-Language': 'en-US,en;q=0.9'
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

// ── Chamindu API Stream Link Resolver ──
async function getAudioDownloadUrl(videoUrl) {
    const enc = encodeURIComponent(videoUrl);
    const endpoints = [
        `https://api.chamindu.site/api/v1/youtube/download?url=${enc}&quality=128kbps&format=mp3&api_key=${API_KEY}`,
        `https://api.chamindu.site/api/v1/media/ytmp3/dl?url=${enc}&quality=128&api_key=${API_KEY}`,
        `https://api.chamindu.site/api/v1/media/ytmp4/dl?url=${enc}&quality=360&api_key=${API_KEY}`
    ];

    for (const ep of endpoints) {
        const res = await fetchJson(ep);
        if (res) {
            const link = res.data?.direct_url || res.data?.download_url || res.data?.download_link 
                      || res.direct_url || res.download_url || res.download_link;
            if (typeof link === 'string' && /^https?:\/\//i.test(link)) return link;
        }
    }
    return null;
}

module.exports = {
    name: 'csong',
    aliases: ['channelsong', 'cvoice', 'cplay'],
    execute: async (sock, msg, args, isDev, BOT_NAME, cleanSender) => {
        const from = msg.key.remoteJid;
        const botName = BOT_NAME || '𝐇𝐄𝐒𝐇𝐀𝐍 𝐎𝐅𝐂';
        const fullText = (args || []).join(' ').trim();
        const react = (emoji) => sock.sendMessage(from, { react: { text: emoji, key: msg.key } }).catch(() => {});

        if (!fullText) {
            return sock.sendMessage(from, {
                text: `⚠️ *භාවිතය:*\n*.csong <channel_link> , <song_name>*\n\n*උදාහරණ:*\n.csong https://whatsapp.com/channel/0029VbAQYhXDZ4Lfo9K5gh1V , sadawathiye`
            }, { quoted: msg });
        }

        // Link සහ සින්දුවේ නම වෙන් කිරීම
        const linkMatch = fullText.match(/https?:\/\/(?:www\.)?whatsapp\.com\/channel\/[^\s,]+/i);
        let channelLink = '';
        let songName = '';

        if (linkMatch) {
            channelLink = linkMatch[0];
            songName = fullText.replace(linkMatch[0], '').replace(/^[\s,]+|[\s,]+$/g, '').trim();
        } else {
            return sock.sendMessage(from, {
                text: `⚠️ කරුණාකර Channel Link එක සහ සින්දුවේ නම කොමාවකින් (,) වෙන් කර ලබාදෙන්න!`
            }, { quoted: msg });
        }

        if (!songName) {
            return sock.sendMessage(from, { text: '⚠️ සින්දුවේ නම ලබාදෙන්න!' }, { quoted: msg });
        }

        // /392 වැනි post IDs ඉවත් කර Invite Code එක පමණක් ගැනීම[span_0](start_span)[span_0](end_span)[span_1](start_span)[span_1](end_span)
        const inviteCode = channelLink.split('whatsapp.com/channel/')[1]?.split(/[\/?#]/)[0]?.trim();
        if (!inviteCode) {
            return sock.sendMessage(from, { text: '❌ වලංගු WhatsApp Channel Link එකක් ලබාදෙන්න!' }, { quoted: msg });
        }

        react('⏳');

        try {
            // 1. Channel JID එක ලබා ගැනීම
            let channelJid = null;
            try {
                const meta = await sock.newsletterMetadata('invite', inviteCode);
                channelJid = meta?.id;
            } catch (e) {
                console.error('[CSONG NEWSLETTER ERROR]:', e.message);
            }

            if (!channelJid) {
                react('❌');
                return sock.sendMessage(from, { text: '❌ Channel එක සොයාගත නොහැකි විය. Link එක පරීක්ෂා කරන්න.' }, { quoted: msg });
            }

            // 2. YouTube Search
            const video = await searchYouTube(songName);
            if (!video) {
                react('❌');
                return sock.sendMessage(from, { text: '❌ සින්දුව සොයාගත නොහැකි විය.' }, { quoted: msg });
            }

            // 3. Audio Download Stream ලබා ගැනීම
            const audioUrl = await getAudioDownloadUrl(video.url);
            if (!audioUrl) {
                react('❌');
                return sock.sendMessage(from, { text: '❌ Audio Download link එක ලබාගැනීමට නොහැකි විය.' }, { quoted: msg });
            }

            const rawBuffer = await downloadBuffer(audioUrl);
            if (!rawBuffer || rawBuffer.length < 5000) {
                react('❌');
                return sock.sendMessage(from, { text: '❌ Audio file එක download කරගැනීම අසාර්ථක විය.' }, { quoted: msg });
            }

            // 4. Voice Note බවට Convert කිරීම
            const voice = await convertToWhatsAppVoice(rawBuffer);

            // 5. Thumbnail Card එක සකස් කිරීම
            const thumbBuffer = await downloadBuffer(video.thumbnail);

            const cardCaption = 
`🥰⃝🎶 *“ ${video.title} ”*

0:00 ◁◁  II  ▷▷ ${video.duration}

Use Headphones For Best Experience.... 🧚‍♀️🎵

| ☘️ *${botName}*`;

            // 6. Channel එකට Card එක යැවීම
            if (thumbBuffer && thumbBuffer.length > 1000) {
                await sock.sendMessage(channelJid, { image: thumbBuffer, caption: cardCaption });
            } else {
                await sock.sendMessage(channelJid, { text: cardCaption });
            }

            // 7. Channel එකට Original Voice Note එක යැවීම
            await sock.sendMessage(channelJid, {
                audio: voice.buffer,
                mimetype: voice.isOpus ? 'audio/ogg; codecs=opus' : 'audio/mp4',
                ptt: true
            });

            react('✅');
            return sock.sendMessage(from, {
                text: `✅ *"${video.title}"*\nChannel එකට Voice Note එකක් ලෙස සාර්ථකව Post කරන ලදී! 🎙️🔥`
            }, { quoted: msg });

        } catch (err) {
            console.error('[CSONG MAIN ERROR]:', err);
            react('❌');
            return sock.sendMessage(from, { text: `❌ Error: ${err.message || 'Failed to post'}` }, { quoted: msg });
        }
    }
};

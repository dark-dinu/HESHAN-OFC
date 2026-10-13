const axios = require('axios');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

// ───────────── FFmpeg path ─────────────
let ffmpegPath = 'ffmpeg';
try {
    ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
} catch (e) {
    ffmpegPath = 'ffmpeg';
}

// ⚠️ පරණ key එක public වුණා. අලුත් key එකක් generate කරලා Render > Environment එකේ CHAMINDU_API_KEY ලෙස දාන්න.
const API_KEY = process.env.CHAMINDU_API_KEY || 'PUT_NEW_KEY_HERE';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const MAX_DURATION_SEC = 15 * 60; // තත්පර 900 ට වැඩි සින්දු skip

// ───────────── Helpers ─────────────
function parseDuration(text) {
    if (!text) return 0;
    const p = String(text).split(':').map(Number);
    if (p.some(isNaN)) return 0;
    return p.reduce((acc, n) => acc * 60 + n, 0);
}

function formatDuration(sec) {
    sec = Math.max(0, Math.round(sec));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const ss = String(s).padStart(2, '0');
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

function cleanup(...files) {
    for (const f of files) {
        try { if (f && fs.existsSync(f)) fs.unlinkSync(f); } catch (e) {}
    }
}

function runFfmpeg(args) {
    return new Promise((resolve) => {
        execFile(ffmpegPath, args, { timeout: 120000, maxBuffer: 20 * 1024 * 1024 }, (error, stdout, stderr) => {
            resolve({ error, stderr: stderr || '' });
        });
    });
}

// ffmpeg output එකෙන් duration (තත්පර) ගැනීම
function parseFfmpegDuration(stderr) {
    const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (!m) return 0;
    return Math.round(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]));
}

// Audio buffer → WhatsApp voice note (OGG Opus). Fail වුණොත් error throw කරනවා (වැරදි file එකක් යවන්නේ නෑ)
async function convertToWhatsAppVoice(inputBuffer) {
    const id = Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    const tempInput = path.join(os.tmpdir(), `csong_in_${id}.bin`);
    const tempOutput = path.join(os.tmpdir(), `csong_out_${id}.ogg`);

    try {
        fs.writeFileSync(tempInput, inputBuffer);

        const { error, stderr } = await runFfmpeg([
            '-y', '-i', tempInput,
            '-vn',
            '-c:a', 'libopus',
            '-b:a', '64k',
            '-vbr', 'on',
            '-ar', '48000',
            '-ac', '1',
            '-f', 'ogg',
            tempOutput
        ]);

        if (error || !fs.existsSync(tempOutput) || fs.statSync(tempOutput).size < 1000) {
            console.error('[FFMPEG ERROR]:', (stderr || '').slice(-500));
            throw new Error('FFmpeg convert කිරීම අසාර්ථකයි (ffmpeg install වෙලාද බලන්න: npm i @ffmpeg-installer/ffmpeg)');
        }

        const buffer = fs.readFileSync(tempOutput);

        // Duration ලබා ගැනීම
        const probe = await runFfmpeg(['-i', tempOutput]);
        const seconds = parseFfmpegDuration(probe.stderr);

        return { buffer, seconds };
    } finally {
        cleanup(tempInput, tempOutput);
    }
}

// Object tree එකේ videoRenderer සොයන recursive function
function findVideoRenderer(node) {
    if (!node || typeof node !== 'object') return null;
    if (node.videoRenderer && node.videoRenderer.videoId) return node.videoRenderer;
    for (const key of Object.keys(node)) {
        const found = findVideoRenderer(node[key]);
        if (found) return found;
    }
    return null;
}

function extractVideoId(text) {
    const m = text.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/i);
    return m ? m[1] : null;
}

// ───────────── YouTube Search ─────────────
async function searchYouTube(query) {
    // 1. YouTube link එකක් නම්
    const directId = extractVideoId(query);
    if (directId) {
        const url = `https://www.youtube.com/watch?v=${directId}`;
        let title = 'Channel Song';
        try {
            const r = await axios.get(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`, { timeout: 10000 });
            title = r.data?.title || title;
        } catch (e) {}
        return { videoId: directId, url, title, durationSec: 0, thumbnail: `https://i.ytimg.com/vi/${directId}/hqdefault.jpg` };
    }

    // 2. yt-search package (install කරලා තිබ්බොත් වඩාත් ස්ථාවරයි)
    try {
        const yts = require('yt-search');
        const r = await yts(query);
        const v = r.videos && r.videos[0];
        if (v) {
            return {
                videoId: v.videoId,
                url: v.url,
                title: v.title,
                durationSec: v.seconds || 0,
                thumbnail: `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`
            };
        }
    } catch (e) {
        // package නැත්නම් scraper එකට යනවා
    }

    // 3. Manual scraper
    try {
        const res = await axios.get('https://www.youtube.com/results', {
            params: { search_query: query, hl: 'en' },
            timeout: 15000,
            maxRedirects: 5,
            headers: {
                'User-Agent': UA,
                'Accept-Language': 'en-US,en;q=0.9',
                'Cookie': 'CONSENT=YES+1; SOCS=CAI'
            }
        });
        const html = String(res.data);
        const m = html.match(/var ytInitialData\s*=\s*({.+?});\s*<\/script>/s)
            || html.match(/ytInitialData"\]\s*=\s*({.+?});\s*<\/script>/s)
            || html.match(/ytInitialData\s*=\s*({.+?});/s);
        if (!m) return null;

        const data = JSON.parse(m[1]);
        const vr = findVideoRenderer(data);
        if (!vr) return null;

        return {
            videoId: vr.videoId,
            url: `https://www.youtube.com/watch?v=${vr.videoId}`,
            title: vr.title?.runs?.[0]?.text || 'Channel Song',
            durationSec: parseDuration(vr.lengthText?.simpleText),
            thumbnail: `https://i.ytimg.com/vi/${vr.videoId}/hqdefault.jpg`
        };
    } catch (e) {
        console.error('[YT SEARCH ERROR]:', e.message);
        return null;
    }
}

// ───────────── Download URL ලබා ගැනීම ─────────────
async function getAudioDownloadUrl(videoUrl) {
    const enc = encodeURIComponent(videoUrl);
    const endpoints = [
        `https://api.chamindu.site/api/v1/youtube/download?url=${enc}&quality=128kbps&format=mp3&api_key=${API_KEY}`,
        `https://api.chamindu.site/api/v1/media/ytmp3/dl?url=${enc}&quality=128&api_key=${API_KEY}`,
        `https://api.chamindu.site/api/v1/media/ytmp4/dl?url=${enc}&quality=360&api_key=${API_KEY}`
    ];

    for (const ep of endpoints) {
        try {
            const res = await axios.get(ep, { timeout: 25000 });
            const d = res.data || {};
            const inner = d.data || d.result || {};
            const link = inner.direct_url || inner.download_url || inner.url || inner.link
                || d.direct_url || d.download_url || d.download_link || d.url;
            if (typeof link === 'string' && /^https?:\/\//i.test(link)) return link;
            console.log('[EP NO LINK]', ep.split('?')[0], JSON.stringify(d).slice(0, 200));
        } catch (e) {
            console.log('[EP FAIL]', ep.split('?')[0], e.response?.status || '', e.message);
        }
    }
    return null;
}

async function downloadBuffer(url, timeout = 60000) {
    const res = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout,
        maxRedirects: 5,
        maxContentLength: 60 * 1024 * 1024,
        headers: { 'User-Agent': UA }
    });
    return Buffer.from(res.data);
}

// ───────────── Command ─────────────
module.exports = {
    name: 'csong',
    aliases: ['channelsong', 'cvoice', 'cplay'],
    execute: async (sock, msg, args, isDev, BOT_NAME, cleanSender) => {
        const from = msg.key.remoteJid;
        const botName = BOT_NAME || 'Bot';
        const fullText = (args || []).join(' ').trim();
        const react = (emoji) => sock.sendMessage(from, { react: { text: emoji, key: msg.key } }).catch(() => {});

        if (!fullText) {
            return sock.sendMessage(from, {
                text: `⚠️ *භාවිතය:*\n*.csong <channel_link> , <song_name>*\n\n*උදාහරණ:*\n.csong https://whatsapp.com/channel/0029VbAQYhXDZ4Lfo9K5gh1V , sadawathiye`
            }, { quoted: msg });
        }

        // ── Link සහ නම වෙන් කිරීම ──
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

        const inviteCode = channelLink.split('whatsapp.com/channel/')[1]?.split(/[\/?#]/)[0]?.trim();
        if (!inviteCode) {
            return sock.sendMessage(from, { text: '❌ වලංගු WhatsApp Channel Link එකක් ලබාදෙන්න!' }, { quoted: msg });
        }

        react('⏳');

        try {
            // 1. Channel JID
            let channelJid;
            try {
                const meta = await sock.newsletterMetadata('invite', inviteCode);
                channelJid = meta?.id;
            } catch (e) {
                console.error('[NEWSLETTER META ERROR]:', e.message);
            }
            if (!channelJid) {
                react('❌');
                return sock.sendMessage(from, { text: '❌ Channel එක සොයාගත නොහැකි විය. Link එක පරීක්ෂා කරන්න.' }, { quoted: msg });
            }

            // 2. YouTube search
            const video = await searchYouTube(songName);
            if (!video) {
                react('❌');
                return sock.sendMessage(from, { text: '❌ සින්දුව සොයාගත නොහැකි විය.' }, { quoted: msg });
            }

            if (video.durationSec > MAX_DURATION_SEC) {
                react('❌');
                return sock.sendMessage(from, { text: `❌ සින්දුව ඉතා දිගයි (${formatDuration(video.durationSec)}). විනාඩි ${MAX_DURATION_SEC / 60} ට අඩු එකක් තෝරන්න.` }, { quoted: msg });
            }

            // 3. Download
            const audioUrl = await getAudioDownloadUrl(video.url);
            if (!audioUrl) throw new Error('Audio Download link එක ලබාගැනීමට නොහැකි විය (API key / API එක පරීක්ෂා කරන්න).');

            const rawBuffer = await downloadBuffer(audioUrl, 90000);
            if (rawBuffer.length < 5000) throw new Error('Download වුණ audio file එක නිවැරදි නැහැ.');

            // 4. Convert (card එක යවන්න කලින්, fail වුණොත් card එකක් විතරක් post වෙන්නේ නෑ)
            const voice = await convertToWhatsAppVoice(rawBuffer);
            const seconds = voice.seconds || video.durationSec || 0;
            const durationText = formatDuration(seconds);

            // 5. Thumbnail buffer
            let thumbBuffer = null;
            for (const q of ['hqdefault', 'mqdefault', 'default']) {
                try {
                    thumbBuffer = await downloadBuffer(`https://i.ytimg.com/vi/${video.videoId}/${q}.jpg`, 15000);
                    if (thumbBuffer.length > 1000) break;
                    thumbBuffer = null;
                } catch (e) {
                    thumbBuffer = null;
                }
            }

            const cardCaption =
`🥰⃝🎶 *“ ${video.title} ”*

0:00 ◁◁  II  ▷▷ ${durationText}

Use Headphones For Best Experience.... 🧚‍♀️🎵

| ☘️ *${botName}*`;

            // 6. Card → Channel
            if (thumbBuffer) {
                await sock.sendMessage(channelJid, { image: thumbBuffer, caption: cardCaption });
            } else {
                await sock.sendMessage(channelJid, { text: cardCaption });
            }

            // 7. Voice note → Channel
            await sock.sendMessage(channelJid, {
                audio: voice.buffer,
                mimetype: 'audio/ogg; codecs=opus',
                ptt: true,
                seconds: seconds || undefined
            });

            react('✅');
            return sock.sendMessage(from, {
                text: `✅ *"${video.title}"*\nChannel එකට Voice Note එකක් ලෙස සාර්ථකව Post කරන ලදී! 🎙️🔥`
            }, { quoted: msg });

        } catch (err) {
            console.error('[CSONG ERROR]:', err);
            react('❌');

            let reason = err.message || 'Failed to post voice note to channel';
            if (/forbidden|not-authorized|401|403/i.test(reason)) {
                reason = 'Channel එකට post කිරීමට අවසර නැහැ. Bot ගේ number එක channel එකේ Owner/Admin විය යුතුයි.';
            }
            return sock.sendMessage(from, { text: `❌ Error: ${reason}` }, { quoted: msg });
        }
    }
};

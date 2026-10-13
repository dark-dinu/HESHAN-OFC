const axios = require('axios');
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { exec } = require('child_process');

// ⚡ Render.com Linux Environment එකට ගැළපෙන Automatic FFmpeg Binary Path Configuration
let ffmpegPath = 'ffmpeg';
try {
    const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
    ffmpegPath = ffmpegInstaller.path;
} catch (e) {
    ffmpegPath = 'ffmpeg';
}

const API_KEY = 'chama_api_ec9848130d1aea209f08fb85e0b4720f';

// 🎙️ Helper: MP3 Buffer එක WhatsApp Channels වලට සහය දක්වන Real OGG Opus Voice Note එකක් බවට පත් කිරීම
function convertToWhatsAppVoice(inputBuffer) {
    return new Promise((resolve, reject) => {
        const tempId = Date.now() + '_' + Math.random().toString(36).substring(7);
        const tempInput = path.join(os.tmpdir(), `input_${tempId}.mp3`);
        const tempOutput = path.join(os.tmpdir(), `output_${tempId}.opus`);

        fs.writeFileSync(tempInput, inputBuffer);

        // WhatsApp Real Voice Note Codec: libopus, 48kHz, mono
        const cmd = `"${ffmpegPath}" -y -i "${tempInput}" -c:a libopus -b:a 64k -vbr on -compression_level 10 -ar 48000 -ac 1 "${tempOutput}"`;

        exec(cmd, (error) => {
            try { if (fs.existsSync(tempInput)) fs.unlinkSync(tempInput); } catch (e) {}

            if (error) {
                console.warn('[FFMPEG CONVERT ERROR]:', error.message);
                return resolve(inputBuffer);
            }

            try {
                const outputBuffer = fs.readFileSync(tempOutput);
                if (fs.existsSync(tempOutput)) fs.unlinkSync(tempOutput);
                resolve(outputBuffer);
            } catch (readErr) {
                resolve(inputBuffer);
            }
        });
    });
}

// YouTube Search Scraper
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
                                duration: vr.lengthText?.simpleText || '3:45',
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

        // 🎯 Link එක අග ඇති /392 වැනි Post ID ඉවත් කර නියම Invite Code එක පමණක් ගැනීම
        const inviteCode = channelLink.split('whatsapp.com/channel/')[1]?.split('/')[0]?.split('?')[0]?.trim();
        if (!inviteCode) {
            return sock.sendMessage(from, { text: '❌ වලංගු WhatsApp Channel Link එකක් ලබාදෙන්න!' }, { quoted: msg });
        }

        sock.sendMessage(from, { react: { text: '⏳', key: msg.key } }).catch(() => {});

        try {
            // Channel JID එක ලබා ගැනීම
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
                    const res = await axios.get(ep, { timeout: 15000 });
                    audioDownloadUrl = res.data?.data?.direct_url || res.data?.data?.download_url || res.data?.direct_url || res.data?.download_link;
                    if (audioDownloadUrl) break;
                } catch (e) {}
            }

            if (!audioDownloadUrl) {
                throw new Error('Audio Download stream link ලබාගැනීමට නොහැකි විය.');
            }

            // 3. Audio Buffer කරගෙන FFmpeg මඟින් OGG Opus බවට Convert කිරීම
            const rawRes = await axios.get(audioDownloadUrl, {
                responseType: 'arraybuffer',
                timeout: 45000,
                headers: { 'User-Agent': 'Mozilla/5.0' }
            });
            const rawBuffer = Buffer.from(rawRes.data);
            const voiceBuffer = await convertToWhatsAppVoice(rawBuffer);

            // 4. STEP 1: ලස්සන Mini Aesthetic Card එක Channel එකට යැවීම
            const cardCaption = 
`🥰⃝🎶 *“ ${video.title} ”*

0:00 ◁◁  II  ▷▷ ${video.duration}

Use Headphones For Best Experience.... 🧚‍♀️🎵

| ☘️ *${BOT_NAME}*`;

            await sock.sendMessage(channelJid, {
                image: { url: video.thumbnail },
                caption: cardCaption
            });

            // 5. STEP 2: Real Playable Voice Note (OGG Opus) එක Channel එකට යැවීම
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

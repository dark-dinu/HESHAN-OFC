Const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const axios = require('axios');
const ytSearch = require('yt-search');

const API_KEY = process.env.CHAMINDU_API_KEY || 'chama_api_ec9848130d1aea209f08fb85e0b4720f';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// ── Native Buffer Downloader with 15MB Safety Cap ──
async function downloadBuffer(url) {
    try {
        const res = await axios.get(url, {
            responseType: 'arraybuffer',
            headers: { 'User-Agent': UA },
            timeout: 30000,
            maxContentLength: 15 * 1024 * 1024 // 15MB Max
        });
        return Buffer.from(res.data);
    } catch {
        return null;
    }
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

        const tempId = `${Date.now()}_${Math.random().toString(36).substring(7)}`;
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

                // Fallback to raw buffer
                resolve({ buffer: inputBuffer, isOpus: false });
            });
        });
    });
}

// ── Ultra-Fast YouTube Search Engine ──
async function searchYouTube(query) {
    try {
        const res = await ytSearch(query);
        if (!res || !res.videos || res.videos.length === 0) return null;

        const video = res.videos[0];
        return {
            videoId: video.videoId,
            url: video.url,
            title: video.title || 'Channel Song',
            duration: video.timestamp || '3:30',
            thumbnail: video.thumbnail || `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`
        };
    } catch {
        return null;
    }
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
        try {
            const res = await axios.get(ep, { headers: { 'User-Agent': UA }, timeout: 12000 });
            const data = res.data;
            if (data) {
                const link = data.data?.direct_url || data.data?.download_url || data.data?.download_link 
                          || data.direct_url || data.download_url || data.download_link;
                if (typeof link === 'string' && /^https?:\/\//i.test(link)) return link;
            }
        } catch {}
    }
    return null;
}

module.exports = {
    name: 'csong',
    aliases: ['channelsong', 'cvoice', 'cplay'],
    execute: async (sock, msg, args, isDev, BOT_NAME, cleanSender) => {
        const from = msg.key?.remoteJid;
        if (!from) return;

        const botName = BOT_NAME || '𝐇𝐄𝐒𝐇𝐀𝐍 𝐎𝐅𝐂';
        const fullText = (args || []).join(' ').trim();
        const react = (emoji) => sock.sendMessage(from, { react: { text: emoji, key: msg.key } }).catch(() => {});

        if (!fullText) {
            return sock.sendMessage(from, {
                text: `⚠️ *Usage:*\n*.csong <channel_link> , <song_name>*\n\n*Example:*\n.csong https://whatsapp.com/channel/0029VbAQYhXDZ4Lfo9K5gh1V , sadawathiye`
            }, { quoted: msg });
        }

        // Link සහ సින්දුවේ නම වෙන් කිරීම (Post ID /392 වැනි දෑ සම්පූර්ණයෙන්ම හසුරුවයි)
        const linkMatch = fullText.match(/https?:\/\/(?:www\.)?whatsapp\.com\/channel\/[a-zA-Z0-9_\-\/]+/i);
        let channelLink = '';
        let songName = '';

        if (linkMatch) {
            channelLink = linkMatch[0];
            songName = fullText.replace(channelLink, '').replace(/^[\s,]+|[\s,]+$/g, '').trim();
        } else {
            return sock.sendMessage(from, {
                text: `⚠️ කරුණාකර Channel Link එක සහ සින්දුවේ නම කොමාවකින් (,) වෙන් කර ලබාදෙන්න!`
            }, { quoted: msg });
        }

        if (!songName) {
            return sock.sendMessage(from, { text: '⚠️ කරුණාකර සින්දුවේ නම ලබාදෙන්න!' }, { quoted: msg });
        }

        // Invite code එක පිරිසිදුව ලබා ගැනීම
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

            if (!channelJid.includes('@')) {
                channelJid = `${channelJid}@newsletter`;
            }

            // 2. YouTube Search
            const video = await searchYouTube(songName);
            if (!video) {
                react('❌');
                return sock.sendMessage(from, { text: '❌ සින්දුව සොයාගත නොහැකි විය.' }, { quoted: msg });
            }

            // 3. Audio Stream Link එක ලබා ගැනීම
            const audioUrl = await getAudioDownloadUrl(video.url);
            if (!audioUrl) {
                react('❌');
                return sock.sendMessage(from, { text: '❌ Audio Download stream එක ලබාගැනීමට නොහැකි විය.' }, { quoted: msg });
            }

            const rawBuffer = await downloadBuffer(audioUrl);
            if (!rawBuffer || rawBuffer.length < 5000) {
                react('❌');
                return sock.sendMessage(from, { text: '❌ Audio file එක download කරගැනීම අසාර්ථක විය.' }, { quoted: msg });
            }

            // 4. Voice Note බවට Convert කිරීම
            const voice = await convertToWhatsAppVoice(rawBuffer);

            // 5. Card Caption
            const cardCaption = 
`🥰⃝🎶 *“ ${video.title} ”*

0:00 ◁◁  II  ▷▷ ${video.duration}

Use Headphones For Best Experience.... 🧚‍♀️🎵

| ☘️ *${botName}*`;

            // 6. Channel එකට Thumbnail Card එක යැවීම
            if (video.thumbnail) {
                await sock.sendMessage(channelJid, { 
                    image: { url: video.thumbnail }, 
                    caption: cardCaption 
                });
            } else {
                await sock.sendMessage(channelJid, { text: cardCaption });
            }

            // 7. Channel එකට Voice Note එක යැවීම
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
            console.error('[CSONG MAIN ERROR]:', err.message);
            react('❌');
            return sock.sendMessage(from, { text: `❌ Error: ${err.message || 'Failed to post to channel'}` }, { quoted: msg });
        }
    }
};


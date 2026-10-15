const axios = require('axios');
const ytSearch = require('yt-search');

const API_KEY = process.env.CHAMINDU_API_KEY || 'chama_api_ec9848130d1aea209f08fb85e0b4720f';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

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

// ── Low-Latency Stream Resolver ──
async function getAudioDownloadUrl(videoUrl) {
    const enc = encodeURIComponent(videoUrl);
    const endpoints = [
        `https://api.chamindu.site/api/v1/media/ytmp3/dl?url=${enc}&quality=128&api_key=${API_KEY}`,
        `https://api.chamindu.site/api/v1/youtube/download?url=${enc}&quality=128kbps&format=mp3&api_key=${API_KEY}`,
        `https://api.chamindu.site/api/v1/media/ytmp4/dl?url=${enc}&quality=360&api_key=${API_KEY}`
    ];

    for (const ep of endpoints) {
        try {
            const res = await axios.get(ep, { headers: { 'User-Agent': UA }, timeout: 8000 });
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
        const isMe = Boolean(msg.key?.fromMe);
        let from = msg.key?.remoteJid;
        if (!from) return;

        // 🛡️ 1. LID & Self-Chat Auto Routing
        if (from.includes('@lid') || (isMe && !from.endsWith('@g.us'))) {
            const myNum = sock.user?.id ? sock.user.id.split(':')[0].split('@')[0].replace(/[^0-9]/g, '') : '';
            if (myNum) from = `${myNum}@s.whatsapp.net`;
        }

        const botName = BOT_NAME || '𝐇𝐄𝐒𝐇𝐀𝐍 𝐎𝐅𝐂';
        const fullText = (args || []).join(' ').trim();
        const safeQuote = isMe ? undefined : { quoted: msg };

        if (!fullText) {
            return sock.sendMessage(from, {
                text: `⚠️ *භාවිතය:*\n*.csong <channel_link> , <song_name>*\n\n*උදාහරණ:*\n.csong https://whatsapp.com/channel/0029VbAQYhXDZ4Lfo9K5gh1V , sadawathiye`
            }, safeQuote);
        }

        // Link සහ සින්දුවේ නම වෙන් කිරීම
        const linkMatch = fullText.match(/https?:\/\/(?:www\.)?whatsapp\.com\/channel\/[a-zA-Z0-9_\-\/]+/i);
        let channelLink = '';
        let songName = '';

        if (linkMatch) {
            channelLink = linkMatch[0];
            songName = fullText.replace(channelLink, '').replace(/^[\s,]+|[\s,]+$/g, '').trim();
        } else {
            return sock.sendMessage(from, {
                text: `⚠️ කරුණාකර Channel Link එක සහ සින්දුවේ නම කොමාවකින් (,) වෙන් කර ලබාදෙන්න!`
            }, safeQuote);
        }

        if (!songName) {
            return sock.sendMessage(from, { text: '⚠️ කරුණාකර සින්දුවේ නම ලබාදෙන්න!' }, safeQuote);
        }

        // Invite code එක ලබා ගැනීම
        const inviteCode = channelLink.split('whatsapp.com/channel/')[1]?.split(/[\/?#]/)[0]?.trim();
        if (!inviteCode) {
            return sock.sendMessage(from, { text: '❌ වලංගු WhatsApp Channel Link එකක් ලබාදෙන්න!' }, safeQuote);
        }

        // Reaction එක යැවීම
        sock.sendMessage(from, { react: { text: '⚡', key: msg.key } }).catch(() => {});

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
                sock.sendMessage(from, { react: { text: '❌', key: msg.key } }).catch(() => {});
                return sock.sendMessage(from, { text: '❌ Channel එක සොයාගත නොහැකි විය. Link එක පරීක්ෂා කරන්න.' }, safeQuote);
            }

            if (!channelJid.includes('@')) {
                channelJid = `${channelJid}@newsletter`;
            }

            // 2. YouTube Search
            const video = await searchYouTube(songName);
            if (!video) {
                sock.sendMessage(from, { react: { text: '❌', key: msg.key } }).catch(() => {});
                return sock.sendMessage(from, { text: '❌ සින්දුව සොයාගත නොහැකි විය.' }, safeQuote);
            }

            // 3. Audio Download Stream URL
            const audioUrl = await getAudioDownloadUrl(video.url);
            if (!audioUrl) {
                sock.sendMessage(from, { react: { text: '❌', key: msg.key } }).catch(() => {});
                return sock.sendMessage(from, { text: '❌ Audio stream link එක ලබාගැනීමට නොහැකි විය.' }, safeQuote);
            }

            // 4. Card Caption
            const cardCaption = 
`🥰⃝🎶 *“ ${video.title} ”*

0:00 ◁◁  II  ▷▷ ${video.duration}

Use Headphones For Best Experience.... 🧚‍♀️🎵

| ☘️ *${botName}*`;

            // 5. Channel එකට Thumbnail Card එක යැවීම
            if (video.thumbnail) {
                await sock.sendMessage(channelJid, { 
                    image: { url: video.thumbnail }, 
                    caption: cardCaption 
                });
            } else {
                await sock.sendMessage(channelJid, { text: cardCaption });
            }

            // 6. Direct Stream එකෙන් තත්පර 2කින් Voice Note එක Channel එකට යැවීම (Zero RAM & Zero Lag)
            await sock.sendMessage(channelJid, {
                audio: { url: audioUrl },
                mimetype: 'audio/mp4',
                ptt: true
            });

            sock.sendMessage(from, { react: { text: '✅', key: msg.key } }).catch(() => {});
            return sock.sendMessage(from, {
                text: `✅ *"${video.title}"*\nChannel එකට Voice Note එකක් ලෙස සාර්ථකව Post කරන ලදී! 🎙️⚡`
            }, safeQuote);

        } catch (err) {
            console.error('[CSONG MAIN ERROR]:', err.message);
            sock.sendMessage(from, { react: { text: '❌', key: msg.key } }).catch(() => {});
            return sock.sendMessage(from, { text: `❌ දෝෂයක් සිදු විය: ${err.message || 'Failed to post'}` }, safeQuote);
        }
    }
};

const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// --- Global Config & Session ---
const CONFIG = {
    YTMP3_AS: {
        BASE: 'https://app.ytmp3.as/',
        INIT: 'https://gamma.gammacloud.net/api/v1/init',
        HEADERS: {
            'Accept': '*/*',
            'Origin': 'https://app.ytmp3.as',
            'Referer': 'https://app.ytmp3.as/',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
    },
    CNV: {
        KEY_URL: 'https://cnv.cx/v2/sanity/key',
        CONV_URL: 'https://cnv.cx/v2/converter',
        HEADERS: {
            'origin': 'https://iframe.y2meta-uk.com',
            'referer': 'https://iframe.y2meta-uk.com/',
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
    },
    Y2MATE: {
        API_KEY: 'dfcb6d76f2f6a9894gjkege8a4ab232222',
        ENDPOINTS: ['p.lbserver.xyz', 'p.savenow.to'],
        HEADERS: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://y2mate.yt/'
        }
    }
};

let activeSession = {
    auth: 'F1HY0PEK41OoQsZbEJsXSPVVuDBwkJV5',
    param: 'e',
    lastUpdate: 0
};

// --- Helpers ---
function extractVideoId(url) {
    if (!url) return null;
    const match = url.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/|youtube\.com\/shorts\/)([^"&?\/\s]{11})/);
    return match ? match[1] : null;
}

// Fallback logic for Y2Mate/Savenow
async function callY2MateApi(path, params) {
    let lastError;
    for (const domain of CONFIG.Y2MATE.ENDPOINTS) {
        try {
            const response = await axios.get(`https://${domain}${path}`, {
                params: { ...params, api: CONFIG.Y2MATE.API_KEY },
                headers: CONFIG.Y2MATE.HEADERS,
                timeout: 10000
            });
            return response.data;
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError;
}

async function refreshYtmp3Session() {
    if (Date.now() - activeSession.lastUpdate < 3600000) return;
    try {
        const { data: html } = await axios.get(CONFIG.YTMP3_AS.BASE, { headers: CONFIG.YTMP3_AS.HEADERS, timeout: 5000 });
        const jsonMatch = html.match(/var json = JSON\.parse\('([^']+)'\);/);
        if (jsonMatch) {
            const json = JSON.parse(jsonMatch[1]);
            let e = "";
            for (let t = 0; t < json[0].length; t++) e += String.fromCharCode(json[0][t] - json[2][json[2].length - (t + 1)]);
            if (json[1]) e = e.split("").reverse().join("");
            activeSession.auth = e.length > 32 ? e.substring(0, 32) : e;
            activeSession.param = String.fromCharCode(json[6]);
            activeSession.lastUpdate = Date.now();
            console.log("YTMP3 Session Refreshed:", activeSession.auth);
        }
    } catch (e) {
        console.error("Session Refresh Failed:", e.message);
    }
}

// --- Provider 1: Cnv.cx (Engine: Alpha, Speed: 10/10) ---
async function cnvConvert(videoId) {
    try {
        const url = `https://www.youtube.com/watch?v=${videoId}`;
        const { data: k } = await axios.get(CONFIG.CNV.KEY_URL, { headers: CONFIG.CNV.HEADERS, timeout: 5000 });
        const { data: c } = await axios.post(CONFIG.CNV.CONV_URL,
            new URLSearchParams({ link: url, format: 'mp3', audioBitrate: '320' }).toString(),
            { headers: { ...CONFIG.CNV.HEADERS, 'key': k.key, 'content-type': 'application/x-www-form-urlencoded' }, timeout: 12000 }
        );
        return c?.url || null;
    } catch (e) { return null; }
}

// --- Provider 4: Y2Down (Engine: Loader.to/Savenow, Speed: 6/10) ---
async function y2DownConvert(videoId, format = 'mp3') {
    try {
        const targetUrl = `https://www.youtube.com/watch?v=${videoId}`;

        // Init via fallback helper
        const init = await callY2MateApi('/ajax/download.php', {
            copyright: 0,
            format: format,
            url: targetUrl
        });

        if (!init || !init.id) return null;

        // Poll via fallback helper
        for (let i = 0; i < 30; i++) {
            const prog = await callY2MateApi('/api/progress', { id: init.id });
            if ((prog.success == 1 || prog.text === 'Finished') && prog.download_url) return prog.download_url;
            if (prog.text === 'Error') return null;
            await new Promise(r => setTimeout(r, 2000));
        }
    } catch (e) {
        console.error("Y2Down Error:", e.message);
        return null;
    }
    return null;
}

// --- Provider 2: YTMP3.as (Engine: Cloud, Speed: 7/10) ---
async function ytmp3asConvert(videoId) {
    try {
        await refreshYtmp3Session();
        const ts = Math.floor(Date.now() / 1000);
        const { data: init } = await axios.get(`${CONFIG.YTMP3_AS.INIT}?${activeSession.param}=${activeSession.auth}&t=${ts}`, { headers: CONFIG.YTMP3_AS.HEADERS, timeout: 6000 });
        if (!init || init.error) return null;

        const { data: conv } = await axios.get(`${init.convertURL}&v=${videoId}&f=mp3&t=${ts}`, { headers: CONFIG.YTMP3_AS.HEADERS, timeout: 8000 });
        if (!conv || conv.error) return null;

        if (conv.progressURL) {
            for (let i = 0; i < 20; i++) {
                const { data: st } = await axios.get(`${conv.progressURL}&t=${Math.floor(Date.now() / 1000)}`, { headers: CONFIG.YTMP3_AS.HEADERS, timeout: 5000 });
                if (st.progress >= 3) return conv.downloadURL;
                if (st.error) break;
                await new Promise(r => setTimeout(r, 2000));
            }
        }
        return conv.downloadURL || null;
    } catch (e) { return null; }
}

// --- Provider 3: YtMp3.gg (Engine: Scraper, Speed: 8/10) ---
async function ytmp3ggConvert(videoId) {
    try {
        const { data: conv } = await axios.post('https://ytmp3.gg/api/converter',
            new URLSearchParams({ url: `https://www.youtube.com/watch?v=${videoId}`, format: 'mp3', quality: '320' }).toString(),
            { headers: { 'User-Agent': CONFIG.YTMP3_AS.HEADERS['User-Agent'], 'Referer': 'https://ytmp3.gg/' }, timeout: 10000 }
        );
        return conv?.status === 'success' ? conv.url : null;
    } catch (e) { return null; }
}

// --- API Router ---

app.get('/', (req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Antigravity Elite Hybrid API</title>
    <style>
        body { font-family: 'Inter', system-ui, sans-serif; background: #08101b; color: #f1f5f9; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; }
        .container { background: #111a2e; padding: 3rem; border-radius: 2rem; box-shadow: 0 35px 60px -15px rgba(0,0,0,0.9); width: 100%; max-width: 680px; border: 1px solid #1e293b; position: relative; overflow: hidden; }
        .container::before { content: ''; position: absolute; top: -50%; left: -50%; width: 200%; height: 200%; background: radial-gradient(circle, rgba(56,189,248,0.08) 0%, transparent 70%); pointer-events: none; }
        h1 { margin: 0 0 1.5rem; font-size: 2.25rem; color: #38bdf8; text-align: center; font-weight: 900; letter-spacing: -0.05em; }
        .badge { display: inline-block; background: #075985; color: #bae6fd; font-size: 0.75rem; padding: 0.4rem 1rem; border-radius: 9999px; font-weight: 800; margin-bottom: 2rem; text-transform: uppercase; letter-spacing: 0.1em; }
        .section-title { font-size: 0.85rem; color: #64748b; font-weight: 800; margin: 2rem 0 1rem; text-transform: uppercase; letter-spacing: 0.12em; border-bottom: 1px solid #1e293b; padding-bottom: 0.5rem; }
        .endpoint { background: #0f172a; padding: 1.5rem; border-radius: 1.25rem; border: 1px solid #334155; margin-bottom: 1.25rem; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); }
        .endpoint:hover { transform: translateY(-4px); border-color: #38bdf8; box-shadow: 0 10px 20px -5px rgba(56,189,248,0.2); }
        code { color: #f472b6; font-family: 'JetBrains Mono', 'Fira Code', monospace; font-size: 0.95rem; word-break: break-all; }
        .desc { color: #94a3b8; font-size: 0.85rem; margin-top: 1rem; line-height: 1.7; }
        .providers { display: flex; gap: 0.75rem; margin-top: 2.5rem; justify-content: center; align-items: center; }
        .dot { width: 10px; height: 10px; background: #10b981; border-radius: 50%; box-shadow: 0 0 15px #10b981; }
        .status-text { font-size: 0.8rem; color: #10b981; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; }
        span.method { color: #10b981; font-weight: 900; margin-right: 8px; }
        .grid { display: grid; grid-template-columns: 1fr; gap: 12px; }
    </style>
</head>
<body>
    <div class="container">
        <center><div class="badge">V8.0 TURBO HYBRID CORE</div></center>
        <h1>Antigravity Elite API</h1>
        
        <div class="section-title">Ultra High-Speed Endpoints</div>
        <div class="grid">
            <div class="endpoint">
                <code><span class="method">GET</span>/api/song?url={YT_URL}</code>
                <div class="desc">Engine: Hybrid Turbo. Instant extraction with redundant high-speed conversion nodes.</div>
            </div>

            <div class="endpoint">
                <code><span class="method">GET</span>/api/mp3?url={YT_URL}</code>
                <div class="desc">Integrated Speed Chain. Direct 320kbps delivery with zero-wait conversion technology.</div>
            </div>

            <div class="endpoint">
                <code><span class="method">GET</span>/api/ytmp3?url={YT_URL}</code>
                <div class="desc">Y2 Turbo Optimized. Redesigned for maximum speed using high-speed provider bypass.</div>
            </div>
        </div>

        <div class="section-title">Video Endpoints</div>
        <div class="grid">
            <div class="endpoint">
                <code><span class="method">GET</span>/api/ytmp4?url={YT_URL}</code>
                <div class="desc">Fast-Stream MP4. Returns optimized 360p video for instant playback.</div>
            </div>
        </div>

        <div class="providers">
            <div class="dot"></div>
            <span class="status-text">All Global Clusters: Synchronized & Online</span>
        </div>
    </div>
</body>
</html>`);
});

// Helper for Hybrid MP3 Speed
async function getHybridMp3(videoId) {
    console.log(`[TURBO-CORE] High-Speed Chain: ${videoId}`);

    // 1. Cnv.cx (King of Speed)
    try {
        const link = await cnvConvert(videoId);
        if (link) return link;
    } catch (e) { }

    // 2. YtMp3.gg (High reliability + Speed)
    try {
        const link = await ytmp3ggConvert(videoId);
        if (link) return link;
    } catch (e) { }

    // 3. YTMP3.as (Cloud Engine)
    try {
        const link = await ytmp3asConvert(videoId);
        if (link) return link;
    } catch (e) { }

    // 4. Fallback: Y2Down (Slow Polling)
    try {
        const link = await y2DownConvert(videoId, 'mp3');
        if (link) return link;
    } catch (e) { }

    return null;
}

app.get('/api/song', async (req, res) => {
    const videoId = extractVideoId(req.query.url);
    if (!videoId) return res.status(400).send("Invalid YouTube URL");
    const link = await getHybridMp3(videoId);
    if (link) return res.redirect(link);
    res.status(500).send("Engine busy.");
});

app.get('/api/mp3', async (req, res) => {
    const videoId = extractVideoId(req.query.url);
    if (!videoId) return res.status(400).send("Invalid YouTube URL");
    const link = await getHybridMp3(videoId);
    if (link) return res.redirect(link);
    res.status(500).send("Engines busy.");
});

app.get('/api/ytmp3', async (req, res) => {
    const videoId = extractVideoId(req.query.url);
    if (!videoId) return res.status(400).send("Invalid YouTube URL");
    console.log(`[TURBO-Y2] Speed-Optimized MP3: ${videoId}`);
    const link = await getHybridMp3(videoId);
    if (link) return res.redirect(link);
    res.status(500).send("Y2Mate Turbo Fallback failed.");
});

app.get('/api/ytmp4', async (req, res) => {
    const videoId = extractVideoId(req.query.url);
    if (!videoId) return res.status(400).send("Invalid YouTube URL");

    console.log(`[VIDEO] 360p Optimization: ${videoId}`);
    const link = await y2DownConvert(videoId, '360');
    if (link) return res.redirect(link);
    res.status(500).send(`360p Video Engine failed.`);
});

// Admin/System Endpoints
app.get('/api/init', async (req, res) => {
    try {
        const data = await callY2MateApi('/ajax/download.php', { copyright: 0, format: req.query.format, url: req.query.url });
        res.json(data);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/progress', async (req, res) => {
    try {
        const data = await callY2MateApi('/api/progress', { id: req.query.id });
        res.json(data);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(port, () => {
    console.log(`[ANTIGRAVITY] V8.0 Turbo Live on ${port}`);
});

module.exports = app;

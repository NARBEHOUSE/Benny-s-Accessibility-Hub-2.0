/**
 * Benny's Hub - Electron Main Process
 * 
 * Handles all backend operations:
 * - File I/O for keyboard predictions, journal entries
 * - Launching external Python apps (messenger, search)
 * - Window management
 * - Streaming platform automation
 * - Local HTTP server for YouTube embeds and other HTTP-dependent features
 */

const { app, BrowserWindow, ipcMain, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const { spawn, exec } = require('child_process');

// Paths
const APP_DIR = __dirname;
const BENNYSHUB_DIR = path.join(APP_DIR, 'bennyshub');
const DATA_DIR = path.join(APP_DIR, 'data');
const APPS_DIR = path.join(BENNYSHUB_DIR, 'apps', 'tools');

// Data file paths
const KEYBOARD_PREDICTIONS_PATH = path.join(BENNYSHUB_DIR, 'shared', 'predictive_ngrams.json');
const JOURNAL_ENTRIES_PATH = path.join(APPS_DIR, 'journal', 'entries.json');
const JOURNAL_QUESTIONS_PATH = path.join(APPS_DIR, 'journal', 'questions.json');
const STREAMING_DIR = path.join(APPS_DIR, 'streaming');
const STREAMING_DATA_DIR = path.join(STREAMING_DIR, 'data');
const STREAMING_DATA_JSON_PATH = path.join(STREAMING_DIR, 'data.json');
const STREAMING_EPISODES_PATH = path.join(STREAMING_DIR, 'episodes.json');
const STREAMING_LAST_WATCHED_PATH = path.join(STREAMING_DATA_DIR, 'last_watched.json');
const STREAMING_SEARCH_HISTORY_PATH = path.join(STREAMING_DIR, 'search_history.json');
const RT_CONVO_CONTEXT_PATH = path.join(APPS_DIR, 'rt-convo', 'context.json');
const RT_CONVO_STT_KEY_PATH = path.join(APPS_DIR, 'rt-convo', 'google-credentials.json');

// Shared settings paths
const VOICE_SETTINGS_PATH = path.join(BENNYSHUB_DIR, 'shared', 'voice-settings.json');

// External Python scripts
const SEARCH_SCRIPT = path.join(APPS_DIR, 'search', 'narbe_scan_browser.py');
const CONTROL_BAR_SCRIPT = path.join(APPS_DIR, 'streaming', 'utils', 'control_bar.py');
const YTSEARCH_SERVER_SCRIPT = path.join(APPS_DIR, 'ytsearch', 'server.py');
const AI_BRIDGE_SCRIPT = path.join(APPS_DIR, 'ai-messenger', 'bridge.py');

// New HTML5 Electron messenger (replaces the old PySide6 ben_discord_app.py).
// Launched as its own Electron process; main.js spawns the python backend itself.
const MESSENGER_APP_MAIN = path.join(APPS_DIR, 'messenger', 'main.js');
const ELECTRON_BIN = path.join(__dirname, 'node_modules', 'electron', 'dist', 'electron.exe');

// Messenger run INSIDE the hub as an iframe (preferred). The hub spawns the
// python WebSocket backend itself and the frontend (index.html) loads in the
// hub's app iframe like every other tool, so the hub stops scanning in the
// background and the iframe keeps focus.
const MESSENGER_DIR = path.join(APPS_DIR, 'messenger');
const MESSENGER_BACKEND_SCRIPT = path.join(MESSENGER_DIR, 'backend.py');
const MESSENGER_WS_PORT = 8777;

// ── Search in-iframe backend ──────────────────────────────────────────────────
const SEARCH_DIR            = path.join(APPS_DIR, 'search');
const SEARCH_BACKEND_SCRIPT = path.join(SEARCH_DIR, 'backend.py');
const SEARCH_WS_PORT        = 8778;
const SEARCH_HISTORY_FILE   = path.join(SEARCH_DIR, 'search_history.json');

// Chrome path
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

// HARDWARE ACCELERATION - Enabled for WebGL games (Dice, Basketball, Bowling)
// Only disable if non-3D games are crashing
// app.disableHardwareAcceleration();
// app.commandLine.appendSwitch('disable-gpu');
// app.commandLine.appendSwitch('disable-software-rasterizer');

let mainWindow;
let ytsearchServerProcess = null;
let hubServer = null;
let hubServerPort = 8765;
let speechProcess = null;
let speechBuffer = '';
let toolWindows = {};  // BrowserWindows opened for specific tools (e.g. rt-convo)
let messengerBackendProc = null;  // python WebSocket backend for the in-iframe messenger
let searchBackendProc    = null;  // python WebSocket backend for the in-iframe search

// Send a message to every frame in the main window AND to any open tool windows
function broadcastToAllFrames(channel, ...args) {
  if (mainWindow) {
    try {
      mainWindow.webContents.getAllFrames().forEach(frame => {
        try { frame.send(channel, ...args); } catch {}
      });
    } catch {}
  }
  Object.values(toolWindows).forEach(win => {
    if (win && !win.isDestroyed()) {
      try { win.webContents.send(channel, ...args); } catch {}
    }
  });
}

// Windows SAPI speech recognition via PowerShell — no API key required
function startSpeechProcess() {
  if (speechProcess) return;
  const script = [
    'Add-Type -AssemblyName System.Speech',
    'try {',
    '  $r = New-Object System.Speech.Recognition.SpeechRecognitionEngine',
    '  $r.SetInputToDefaultAudioDevice()',
    '  $g = New-Object System.Speech.Recognition.DictationGrammar',
    '  $r.LoadGrammar($g)',
    '  $null = Register-ObjectEvent -InputObject $r -EventName SpeechRecognized -Action {',
    '    $t = $Event.SourceEventArgs.Result.Text',
    '    if ($t) { [Console]::Out.WriteLine($t); [Console]::Out.Flush() }',
    '  }',
    '  $r.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)',
    '  while ($true) { [System.Threading.Thread]::Sleep(500) }',
    '} catch {',
    '  [Console]::Error.WriteLine($_.Exception.Message)',
    '  exit 1',
    '}'
  ].join('\r\n');
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  speechProcess = spawn('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    stdio: ['ignore', 'pipe', 'pipe']
  });
  speechBuffer = '';
  speechProcess.stdout.on('data', (data) => {
    speechBuffer += data.toString();
    const lines = speechBuffer.split('\n');
    speechBuffer = lines.pop(); // keep incomplete last chunk
    lines.forEach(line => {
      const text = line.trim();
      if (text) {
        console.log('[SPEECH]', text);
        broadcastToAllFrames('speech:result', text);
      }
    });
  });
  speechProcess.stderr.on('data', (data) => {
    const msg = data.toString().trim();
    if (msg) console.warn('[SPEECH-ERR]', msg);
  });
  speechProcess.on('close', (code) => {
    console.log('[SPEECH] Process closed, code:', code);
    speechProcess = null;
    if (code !== 0 && code !== null) {
      broadcastToAllFrames('speech:error', 'unavailable');
    }
  });
  console.log('[SPEECH] Started Windows SAPI recognition');
}

function stopSpeechProcess() {
  if (speechProcess) {
    speechProcess.kill();
    speechProcess = null;
  }
}

// Ensure data directories exist
function ensureDataDirs() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(STREAMING_DATA_DIR)) {
    fs.mkdirSync(STREAMING_DATA_DIR, { recursive: true });
  }

  // predictive_ngrams.json is real per-user typed data and is never
  // committed (see .gitignore) - seed it from the tracked, generic starter
  // dataset on first run so the keyboard has decent predictions out of the
  // box, without ever letting real usage data end up in the repo.
  const PREDICTIONS_SEED_PATH = path.join(BENNYSHUB_DIR, 'shared', 'predictive_ngrams.seed.json');
  if (!fs.existsSync(KEYBOARD_PREDICTIONS_PATH) && fs.existsSync(PREDICTIONS_SEED_PATH)) {
    try {
      fs.copyFileSync(PREDICTIONS_SEED_PATH, KEYBOARD_PREDICTIONS_PATH);
    } catch (e) {
      console.error('Failed to seed predictive_ngrams.json:', e.message);
    }
  }
}

// ============ LOCAL HTTP SERVER ============
// Serves the hub via localhost so YouTube embeds and other HTTP features work properly

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.webp': 'image/webp'
};

// API Proxy configuration for external services (bypass CORS)
const API_PROXY_SERVICES = {
  'tmdb': 'https://api.themoviedb.org',
  'opensymbols': 'https://www.opensymbols.org/api/v1',
  'freesound': 'https://api.freesound.org',
  'freesound-proxy': 'https://aged-thunder-a674.narbehousellc.workers.dev'
};

// Handle streaming data save endpoint
function handleSaveStreamingData(req, res) {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    try {
      const data = JSON.parse(body);
      const dataPath = path.join(STREAMING_DIR, 'data.json');
      fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ success: true }));
      console.log('[HUB-SERVER] Saved streaming data.json');
    } catch (error) {
      console.error('[HUB-SERVER] Error saving streaming data:', error);
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: error.message }));
    }
  });
}

// Handle streaming genres save endpoint
function handleSaveStreamingGenres(req, res) {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    try {
      const data = JSON.parse(body);
      const genresPath = path.join(STREAMING_DIR, 'genres.json');
      fs.writeFileSync(genresPath, JSON.stringify(data, null, 2), 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ success: true }));
      console.log('[HUB-SERVER] Saved streaming genres.json');
    } catch (error) {
      console.error('[HUB-SERVER] Error saving streaming genres:', error);
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: error.message }));
    }
  });
}

// Handle API proxy requests
function handleApiProxy(req, res, urlPath, queryString) {
  const https = require('https');
  
  // Parse path: /api/proxy/<service>/<path>
  const parts = urlPath.split('/').filter(p => p);
  if (parts.length < 3) {
    res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ error: 'Invalid proxy URL. Use /api/proxy/<service>/<path>' }));
    return;
  }
  
  const service = parts[2].toLowerCase();
  const apiPath = parts.slice(3).join('/');
  
  const baseUrl = API_PROXY_SERVICES[service];
  if (!baseUrl) {
    res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ error: `Unknown service: ${service}. Supported: tmdb, opensymbols, freesound, freesound-proxy` }));
    return;
  }
  
  let targetUrl = `${baseUrl}/${apiPath}`;
  if (queryString) {
    targetUrl += `?${queryString}`;
  }
  
  console.log(`[API-PROXY] ${req.method} ${service} -> ${targetUrl}`);
  
  const parsedUrl = new URL(targetUrl);
  const options = {
    hostname: parsedUrl.hostname,
    port: 443,
    path: parsedUrl.pathname + parsedUrl.search,
    method: req.method,
    headers: {
      'User-Agent': 'BennysHub/1.0',
      'Accept': 'application/json'
    },
    rejectUnauthorized: false // Allow self-signed certs
  };
  
  const proxyReq = https.request(options, (proxyRes) => {
    const chunks = [];
    proxyRes.on('data', chunk => chunks.push(chunk));
    proxyRes.on('end', () => {
      const body = Buffer.concat(chunks);
      res.writeHead(proxyRes.statusCode, {
        'Content-Type': proxyRes.headers['content-type'] || 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      });
      res.end(body);
    });
  });
  
  proxyReq.on('error', (err) => {
    console.error('[API-PROXY] Error:', err.message);
    res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ error: `Proxy error: ${err.message}` }));
  });
  
  // Forward POST body if present
  if (req.method === 'POST' || req.method === 'PUT') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      if (body) {
        proxyReq.setHeader('Content-Type', req.headers['content-type'] || 'application/json');
        proxyReq.setHeader('Content-Length', Buffer.byteLength(body));
        proxyReq.write(body);
      }
      proxyReq.end();
    });
  } else {
    proxyReq.end();
  }
}

// Authenticated AI API proxy — forwards requests with custom auth headers to AI providers
function handleAiCall(req, res) {
  const https = require('https');
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    try {
      const { url, headers: fwdHeaders, body: aiBody } = JSON.parse(body);
      if (!url || !url.startsWith('https://')) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: 'Invalid target URL' }));
        return;
      }
      const parsedUrl = new URL(url);
      const bodyBuf = Buffer.from(aiBody || '');
      const options = {
        hostname: parsedUrl.hostname,
        port: 443,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'POST',
        headers: { ...fwdHeaders, 'Content-Length': bodyBuf.length }
      };
      console.log(`[AI-CALL] Proxying POST to ${parsedUrl.hostname}`);
      const proxyReq = https.request(options, (proxyRes) => {
        const chunks = [];
        proxyRes.on('data', chunk => chunks.push(chunk));
        proxyRes.on('end', () => {
          if (res.headersSent) return; // the timeout below may have already answered
          res.writeHead(proxyRes.statusCode, {
            'Content-Type': proxyRes.headers['content-type'] || 'application/json',
            'Access-Control-Allow-Origin': '*'
          });
          res.end(Buffer.concat(chunks));
        });
      });
      proxyReq.on('error', (err) => {
        if (res.headersSent) return;
        console.error('[AI-CALL] Error:', err.message);
        res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: err.message }));
      });
      // Same reasoning as the ai:call IPC handler: a slow/silent provider
      // should not hang the renderer's fetch() forever.
      proxyReq.setTimeout(45000, () => {
        proxyReq.destroy();
        if (res.headersSent) return;
        res.writeHead(504, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: 'The AI request timed out. Try again in a moment.' }));
      });
      if (bodyBuf.length) proxyReq.write(bodyBuf);
      proxyReq.end();
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}

// ============ GOOGLE CLOUD SPEECH-TO-TEXT ============

let gcloudToken = null;
let gcloudTokenExpiry = 0;

function getGoogleAccessToken() {
  return new Promise((resolve, reject) => {
    const now = Date.now();
    if (gcloudToken && now < gcloudTokenExpiry - 60000) { resolve(gcloudToken); return; }
    let keyData;
    try { keyData = JSON.parse(fs.readFileSync(RT_CONVO_STT_KEY_PATH, 'utf8')); }
    catch (e) { reject(new Error('STT key file missing: ' + e.message)); return; }
    const crypto = require('crypto');
    const iat = Math.floor(now / 1000);
    const exp = iat + 3600;
    const hdr = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const pay = Buffer.from(JSON.stringify({
      iss: keyData.client_email,
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      aud: 'https://oauth2.googleapis.com/token',
      exp, iat
    })).toString('base64url');
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(`${hdr}.${pay}`);
    const sig = sign.sign(keyData.private_key, 'base64url');
    const jwt = `${hdr}.${pay}.${sig}`;
    const postBody = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`;
    const opts = {
      hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(postBody) }
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (!parsed.access_token) { reject(new Error(parsed.error_description || 'No access token')); return; }
          gcloudToken = parsed.access_token;
          gcloudTokenExpiry = now + (parsed.expires_in || 3600) * 1000;
          console.log('[GOOGLE-STT] Access token acquired');
          resolve(gcloudToken);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(postBody);
    req.end();
  });
}

function handleGoogleSTT(req, res) {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', async () => {
    try {
      const { audio, sampleRate } = JSON.parse(body);
      if (!audio) throw new Error('No audio data');
      const token = await getGoogleAccessToken();
      const sttBody = JSON.stringify({
        config: {
          encoding: 'LINEAR16',
          sampleRateHertz: Math.round(sampleRate),
          languageCode: 'en-US',
          model: 'latest_long',
          useEnhanced: true,
          enableAutomaticPunctuation: true
        },
        audio: { content: audio }
      });
      const sttOpts = {
        hostname: 'speech.googleapis.com',
        path: '/v1/speech:recognize',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(sttBody)
        }
      };
      const sttReq = https.request(sttOpts, (sttRes) => {
        const chunks = [];
        sttRes.on('data', c => chunks.push(c));
        sttRes.on('end', () => {
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString());
            const text = (data.results || [])
              .flatMap(r => r.alternatives?.[0]?.transcript || '')
              .join(' ').trim();
            console.log('[GOOGLE-STT]', text || '(empty)');
            res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ text: text || '' }));
          } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ error: e.message }));
          }
        });
      });
      sttReq.on('error', (err) => {
        console.error('[GOOGLE-STT] Request error:', err.message);
        res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: err.message }));
      });
      sttReq.write(sttBody);
      sttReq.end();
    } catch (err) {
      console.error('[GOOGLE-STT] Handler error:', err.message);
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}

function startHubServer() {
  return new Promise((resolve, reject) => {
    hubServer = http.createServer((req, res) => {
      // Parse URL and decode it
      const urlParts = req.url.split('?');
      let urlPath = decodeURIComponent(urlParts[0]);
      const queryString = urlParts[1] || '';
      
      // Handle CORS preflight
      if (req.method === 'OPTIONS') {
        res.writeHead(200, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        });
        res.end();
        return;
      }
      
      // Handle AI API proxy (authenticated requests to Anthropic/OpenAI/Google)
      if (urlPath === '/api/ai-call' && req.method === 'POST') {
        handleAiCall(req, res);
        return;
      }

      // Handle API proxy requests
      if (urlPath.startsWith('/api/proxy/')) {
        handleApiProxy(req, res, urlPath, queryString);
        return;
      }
      
      // Handle streaming editor save endpoints
      if (urlPath === '/api/save-data' && req.method === 'POST') {
        handleSaveStreamingData(req, res);
        return;
      }
      
      if (urlPath === '/api/save-genres' && req.method === 'POST') {
        handleSaveStreamingGenres(req, res);
        return;
      }

      if (urlPath === '/api/rt-convo/stt' && req.method === 'POST') {
        handleGoogleSTT(req, res);
        return;
      }

      if (urlPath === '/api/rt-convo/load' && req.method === 'GET') {
        const data = loadJSON(RT_CONVO_CONTEXT_PATH, null);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(data));
        return;
      }

      // Image proxy — fetches any image server-side with browser-like headers,
      // bypassing hotlink protection and CORS. Used by the search app for GIFs.
      if (urlPath === '/api/imgproxy' && req.method === 'GET') {
        const targetUrl = new URLSearchParams(queryString).get('url');
        if (!targetUrl) { res.writeHead(400); res.end(); return; }

        // Follow redirects server-side. Many GIF CDNs (Giphy/Tenor/Imgur/Wikimedia)
        // answer with a 301/302/307 to a CDN host; without following them here the
        // browser <img> receives a bodiless 3xx and shows nothing. referer===null
        // means "send default Referer", '' means "send none" (hotlink 403 retry).
        const fetchImg = (rawUrl, referer, hops) => {
          if (hops > 5) { try { res.writeHead(502); res.end(); } catch (_) {} return; }
          let tp;
          try { tp = new URL(rawUrl); } catch (_) { try { res.writeHead(400); res.end(); } catch (_) {} return; }
          // Unwrap Bing thumbnail-proxy wrappers (/th/id/OGC...?rurl=<real>) to the true
          // origin so we fetch the genuine animated gif rather than a preview frame.
          if (/(^|\.)bing\.com$/i.test(tp.hostname) && /\/th\//i.test(tp.pathname)) {
            const rurl = tp.searchParams.get('rurl');
            if (rurl) { try { tp = new URL(rurl); rawUrl = tp.href; } catch (_) {} }
          }
          const proto = tp.protocol === 'https:' ? require('https') : require('http');
          const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept': 'image/gif,image/webp,image/apng,image/*,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
          };
          if (referer === null) headers['Referer'] = tp.origin + '/';
          else if (referer)     headers['Referer'] = referer;
          const proxyReq = proto.request({
            hostname: tp.hostname,
            port: tp.port || (tp.protocol === 'https:' ? 443 : 80),
            path: tp.pathname + tp.search,
            method: 'GET',
            headers,
          }, (proxyRes) => {
            const status = proxyRes.statusCode || 0;
            // Redirect — re-request the Location target (resolved against current URL).
            if (status >= 300 && status < 400 && proxyRes.headers.location) {
              proxyRes.resume();
              let next;
              try { next = new URL(proxyRes.headers.location, tp).href; }
              catch (_) { try { res.writeHead(502); res.end(); } catch (_) {} return; }
              fetchImg(next, tp.origin + '/', hops + 1);
              return;
            }
            // Hotlink protection sometimes 403s only when a Referer is present — retry bare once.
            if (status === 403 && referer !== '') {
              proxyRes.resume();
              fetchImg(rawUrl, '', hops + 1);
              return;
            }
            const hdrs = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'max-age=300' };
            // Force the Content-Type from the file's magic bytes. Search engines/CDNs often
            // mislabel gifs (octet-stream/text), which can make the browser <img> show a
            // single static frame instead of animating. Sniffing guarantees image/gif.
            let sniffed = false;
            proxyRes.once('data', (chunk) => {
              sniffed = true;
              let ct = proxyRes.headers['content-type'] || '';
              const b = chunk;
              if (b.length >= 3 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) ct = 'image/gif';            // GIF87a/89a
              else if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) ct = 'image/png';
              else if (b.length >= 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) ct = 'image/jpeg';
              else if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') ct = 'image/webp';
              if (ct) hdrs['Content-Type'] = ct;
              res.writeHead(status === 200 ? 200 : status, hdrs);
              res.write(chunk);
              proxyRes.pipe(res);
            });
            proxyRes.once('end', () => {
              if (!sniffed) { try { res.writeHead(status === 200 ? 200 : status, hdrs); res.end(); } catch (_) {} }
            });
          });
          proxyReq.on('error', () => { try { res.writeHead(502); res.end(); } catch (_) {} });
          proxyReq.setTimeout(8000, () => { proxyReq.destroy(); });
          proxyReq.end();
        };

        try {
          fetchImg(targetUrl, null, 0);
        } catch (e) {
          console.error('[IMGPROXY]', e.message);
          try { res.writeHead(500); res.end(); } catch (_) {}
        }
        return;
      }

      if (urlPath === '/api/rt-convo/save' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          try {
            const data = JSON.parse(body);
            saveJSON(RT_CONVO_CONTEXT_PATH, data);
            res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ success: true }));
            console.log('[RT-CONVO] Saved context.json');
          } catch (error) {
            console.error('[RT-CONVO] Error saving context:', error);
            res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ error: error.message }));
          }
        });
        return;
      }
      
      if (urlPath === '/') urlPath = '/index.html';
      
      // Security: prevent directory traversal
      const safePath = path.normalize(urlPath).replace(/^(\.\.[\/\\])+/, '');
      const filePath = path.join(BENNYSHUB_DIR, safePath);
      
      // Check if file exists
      if (!fs.existsSync(filePath)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found');
        return;
      }
      
      // Check if it's a directory
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        const indexPath = path.join(filePath, 'index.html');
        if (fs.existsSync(indexPath)) {
          serveFile(indexPath, res);
        } else {
          res.writeHead(403, { 'Content-Type': 'text/plain' });
          res.end('403 Forbidden');
        }
        return;
      }
      
      serveFile(filePath, res);
    });
    
    function serveFile(filePath, res) {
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      
      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('500 Internal Server Error');
          return;
        }
        
        res.writeHead(200, { 
          'Content-Type': contentType,
          'Access-Control-Allow-Origin': '*'
        });
        res.end(data);
      });
    }
    
    // Try to start on preferred port, fall back to alternatives
    const tryPort = (port) => {
      hubServer.once('error', (err) => {
        if (err.code === 'EADDRINUSE' && port < 8800) {
          console.log(`[HUB-SERVER] Port ${port} in use, trying ${port + 1}`);
          tryPort(port + 1);
        } else {
          reject(err);
        }
      });
      
      hubServer.listen(port, '127.0.0.1', () => {
        hubServerPort = port;
        console.log(`[HUB-SERVER] Running at http://127.0.0.1:${hubServerPort}`);
        resolve(hubServerPort);
      });
    };
    
    tryPort(hubServerPort);
  });
}

// ============ WINDOW MANAGEMENT ============

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    fullscreen: true,
    frame: false,
    backgroundColor: '#1a1a2e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      // Allow preload script to work in iframes (same origin)
      nodeIntegrationInSubFrames: false,
      // This allows iframes to access the parent's electronAPI
      sandbox: false,
      // Allow mixed content for YouTube embeds
      allowRunningInsecureContent: true,
      // Let the YouTube embed start without a user gesture.
      autoplayPolicy: 'no-user-gesture-required'
    }
  });

  // Grant all permissions for media playback (YouTube embeds)
  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowedPermissions = ['media', 'mediaKeySystem', 'fullscreen', 'geolocation', 'notifications', 'midi', 'midiSysex', 'pointerLock', 'openExternal'];
    if (allowedPermissions.includes(permission)) {
      callback(true);
    } else {
      console.log(`[PERMISSION] Denied: ${permission}`);
      callback(false);
    }
  });

  // Also handle permission checks (synchronous)
  mainWindow.webContents.session.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    // Allow all media-related permissions, especially for YouTube
    if (permission === 'media' || permission === 'mediaKeySystem' || permission === 'fullscreen') {
      return true;
    }
    // Allow for localhost and YouTube domains
    if (requestingOrigin.includes('127.0.0.1') || requestingOrigin.includes('youtube.com') || requestingOrigin.includes('googlevideo.com')) {
      return true;
    }
    return true; // Allow all by default
  });

  // Inject preload into all frames (including iframes)
  mainWindow.webContents.on('did-attach-webview', (event, webContents) => {
    webContents.session.setPreloads([path.join(__dirname, 'preload.js')]);
  });

  // Load via localhost server for YouTube embeds to work
  // This gives us a proper HTTP origin instead of file://
  const serverUrl = `http://127.0.0.1:${hubServerPort}/index.html`;
  console.log(`[HUB] Loading main window from: ${serverUrl}`);
  mainWindow.loadURL(serverUrl);
  
  // CRASH HANDLERS - Log renderer crashes
  mainWindow.webContents.on('render-process-gone', (event, details) => {
    console.error('!!! RENDERER CRASHED !!!');
    console.error('Reason:', details.reason);
    console.error('Exit code:', details.exitCode);
    // Write to file for persistence
    const crashLog = `[${new Date().toISOString()}] Renderer crashed: ${details.reason} (exit: ${details.exitCode})\n`;
    fs.appendFileSync(path.join(__dirname, 'crash.log'), crashLog);
  });

  mainWindow.webContents.on('crashed', (event, killed) => {
    console.error('!!! WEBCONTENTS CRASHED !!!', killed ? '(killed)' : '');
  });

  mainWindow.webContents.on('unresponsive', () => {
    console.error('!!! RENDERER UNRESPONSIVE !!!');
  });

  // Focus window ONLY on initial startup - use 'once' to prevent stealing focus later
  // This prevents focus issues when apps run in iframes (editors, games, etc.)
  let initialLoadComplete = false;
  mainWindow.webContents.once('did-finish-load', () => {
    if (initialLoadComplete) return;
    initialLoadComplete = true;
    
    const focusWindow = () => {
      if (mainWindow && !initialLoadComplete) return; // Double-check flag
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
        mainWindow.setFullScreen(true);
        // Don't focus webContents - let the page handle its own focus
      }
    };
    
    // Immediate focus on startup
    focusWindow();
    
    // A few delayed attempts for startup only, then stop
    const timeouts = [
      setTimeout(focusWindow, 500),
      setTimeout(focusWindow, 1000),
      setTimeout(focusWindow, 2000)
    ];
    
    // Clear all focus attempts after 3 seconds to prevent interference
    setTimeout(() => {
      timeouts.forEach(t => clearTimeout(t));
    }, 3000);
  });

  // Note: Removed aggressive blur handler - it was causing focus fighting
  // with external Python apps (messenger, search). The window will stay
  // minimized when external apps are running, and restore when they close.

  // Handle window close
  mainWindow.on('closed', () => {
    mainWindow = null;
    // Clean up the messenger backend (Discord connection + TTS)
    stopMessengerBackend();
  });

  // Open DevTools in development (disabled for production)
  // mainWindow.webContents.openDevTools();
}

app.whenReady().then(async () => {
  ensureDataDirs();
  
  // Start the local HTTP server FIRST - this is required for YouTube embeds to work
  try {
    await startHubServer();
    console.log('[HUB] Local server started successfully');
  } catch (err) {
    console.error('[HUB] Failed to start local server:', err);
    // Continue anyway - app will work but YouTube embeds may not
  }
  
  // Configure Content Security Policy to allow CDN resources for games
  // This allows Three.js, Cannon.js, YouTube player, localhost servers, search APIs, and other external libraries
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    // Don't modify headers for YouTube-related domains - let them handle their own CSP.
    // NOTE: 'youtube-nocookie.com' must be listed explicitly — it does NOT contain the
    // substring 'youtube.com', so without it the embed document inherits the hub CSP
    // whose connect-src omits *.googlevideo.com, blocking the MSE media stream (endless spinner).
    const youtubeUrls = ['youtube.com', 'youtube-nocookie.com', 'ytimg.com', 'googlevideo.com', 'google.com', 'gstatic.com', 'ggpht.com'];
    const url = details.url.toLowerCase();
    if (youtubeUrls.some(domain => url.includes(domain))) {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }
    
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' data: blob: http://localhost:* http://127.0.0.1:*; " +
          "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' https://cdnjs.cloudflare.com https://unpkg.com https://cdn.jsdelivr.net https://www.googletagmanager.com https://www.google-analytics.com https://www.youtube.com https://s.ytimg.com https://www.google.com https://challenges.cloudflare.com http://localhost:* http://127.0.0.1:* blob:; " +
          "script-src-elem 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' https://cdnjs.cloudflare.com https://unpkg.com https://cdn.jsdelivr.net https://www.youtube.com https://s.ytimg.com https://www.google.com https://challenges.cloudflare.com http://localhost:* http://127.0.0.1:* blob:; " +
          "connect-src 'self' https://unpkg.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://www.google-analytics.com https://*.googleapis.com https://*.workers.dev https://www.youtube.com https://www.google.com https://challenges.cloudflare.com https://api.duckduckgo.com https://*.wikipedia.org https://api.open-meteo.com https://geocoding-api.open-meteo.com https://huggingface.co https://*.huggingface.co http://localhost:* http://127.0.0.1:* wss: ws:; " +
          "img-src * data: blob:; " +
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com http://localhost:* http://127.0.0.1:*; " +
          "font-src 'self' data: https://fonts.gstatic.com; " +
          "worker-src 'self' blob:; " +
          "media-src * data: blob:; " +
          "frame-src 'self' blob: https://www.youtube.com https://www.youtube-nocookie.com https://rumble.com https://www.dailymotion.com https://challenges.cloudflare.com http://localhost:* http://127.0.0.1:*;"
        ]
      }
    });
  });
  
  await createWindow();

  // Start the messenger backend (Discord connection + TTS) in the background so
  // Ben gets spoken notifications hub-wide, even when the Messenger tool isn't
  // open. The Messenger tool's own startup call to this is idempotent.
  startMessengerBackend();

  // Start navigation signal watcher for control bar communication
  startNavSignalWatcher();
  
  // Start Start Menu auto-closer to prevent accidental activation
  startStartMenuWatcher();
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // Kill tracked Python processes
  if (ytsearchServerProcess) {
    ytsearchServerProcess.kill();
    ytsearchServerProcess = null;
  }
  if (editorServerProcess) {
    editorServerProcess.kill();
    editorServerProcess = null;
  }
  if (startMenuCloserProcess) {
    startMenuCloserProcess.kill();
    startMenuCloserProcess = null;
  }
  stopMessengerBackend();
  stopSearchBackend();
  stopSpeechProcess();
  Object.values(toolWindows).forEach(win => { try { if (!win.isDestroyed()) win.close(); } catch {} });
  toolWindows = {};

  // Close the hub server
  if (hubServer) {
    hubServer.close();
    hubServer = null;
  }
  
  // Force kill any remaining Python processes
  if (process.platform === 'win32') {
    exec('taskkill /F /IM python.exe', () => {});
  }
  
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// ============ HELPER FUNCTIONS ============

function loadJSON(filePath, defaultValue = {}) {
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.error(`Error loading ${filePath}:`, e);
  }
  return defaultValue;
}

function saveJSON(filePath, data) {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error(`Error saving ${filePath}:`, e);
    return false;
  }
}

// ============ DAY HUB NEWS (RSS via HTTPS, main process — no renderer CORS) ============
const NEWS_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

function newsFetchHttpsText(urlString, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(urlString);
    } catch (e) {
      reject(new Error('Invalid URL'));
      return;
    }
    if (url.protocol !== 'https:') {
      reject(new Error('Only HTTPS'));
      return;
    }
    const req = https.request(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method: 'GET',
        headers: {
          'User-Agent': NEWS_UA,
          Accept: 'application/rss+xml, application/xml, text/xml, application/atom+xml, */*'
        }
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
          const next = new URL(res.headers.location, urlString).href;
          newsFetchHttpsText(next, redirectsLeft - 1).then(resolve).catch(reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      }
    );
    req.on('error', reject);
    req.setTimeout(8000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.end();
  });
}

function newsDecodeXmlEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function newsCleanTitle(raw) {
  let t = String(raw).trim();
  t = t.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1');
  t = t.replace(/<[^>]+>/g, '');
  t = newsDecodeXmlEntities(t);
  t = t.replace(/\s+/g, ' ').trim();
  if (t.length > 220) t = `${t.slice(0, 217)}…`;
  return t;
}

function newsParseFeedTitles(xml, limit) {
  if (!xml || typeof xml !== 'string' || limit <= 0) return [];
  const titles = [];
  const seen = new Set();
  const push = (raw) => {
    const t = newsCleanTitle(raw);
    if (t.length < 4) return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    titles.push(t);
  };

  if (/<entry[\s>]/i.test(xml)) {
    const parts = xml.split(/<entry[\s>]/i);
    for (let i = 1; i < parts.length && titles.length < limit; i++) {
      const m = parts[i].match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      if (m) push(m[1]);
    }
    return titles;
  }

  const itemParts = xml.split(/<item[\s>]/i);
  for (let i = 1; i < itemParts.length && titles.length < limit; i++) {
    const m = itemParts[i].match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (m) push(m[1]);
  }
  return titles;
}

async function newsFetchHighlightsForDayHub(localLabel) {
  const label =
    typeof localLabel === 'string' && localLabel.trim() ? localLabel.trim() : 'United States';
  const localUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(label)}&hl=en-US&gl=US&ceid=US:en`;
  const nationalUrl = 'https://feeds.npr.org/1001/rss.xml';
  const worldUrl = 'https://feeds.bbci.co.uk/news/world/rss.xml';
  const LOCAL_MAX = 4;
  const NATIONAL_MAX = 4;
  const WORLD_MAX = 4;

  const [localR, nationalR, worldR] = await Promise.allSettled([
    newsFetchHttpsText(localUrl).then((xml) => newsParseFeedTitles(xml, LOCAL_MAX)),
    newsFetchHttpsText(nationalUrl).then((xml) => newsParseFeedTitles(xml, NATIONAL_MAX)),
    newsFetchHttpsText(worldUrl).then((xml) => newsParseFeedTitles(xml, WORLD_MAX))
  ]);

  const local = localR.status === 'fulfilled' ? localR.value : [];
  const national = nationalR.status === 'fulfilled' ? nationalR.value : [];
  const world = worldR.status === 'fulfilled' ? worldR.value : [];

  if (local.length === 0 && national.length === 0 && world.length === 0) {
    const err =
      localR.status === 'rejected'
        ? localR.reason && localR.reason.message
        : nationalR.status === 'rejected'
          ? nationalR.reason && nationalR.reason.message
          : worldR.status === 'rejected'
            ? worldR.reason && worldR.reason.message
            : '';
    return {
      ok: false,
      error: err
        ? `News feeds failed (${err}). Check your internet connection.`
        : 'Could not read any news feeds. Check your internet connection.'
    };
  }

  return {
    ok: true,
    local,
    national,
    world,
    localLabel: label,
    localSource: 'Google News',
    nationalSource: 'NPR',
    worldSource: 'BBC News'
  };
}

// ============ CALENDAR API ============
// Fetches and parses iCal data from Google Calendar

const CALENDAR_SETTINGS_PATH = path.join(DATA_DIR, 'calendar-settings.json');

const DEFAULT_CALENDAR_SETTINGS = {
  icalUrl: ''
};

function parseICalDate(str, originalLine) {
  // Parse iCal date formats: YYYYMMDD or YYYYMMDDTHHMMSS or YYYYMMDDTHHMMSSZ
  // Z suffix means UTC time, otherwise it's local or has TZID
  if (!str) return null;
  
  const isUTC = str.endsWith('Z');
  const cleanStr = str.replace(/[^0-9T]/g, '');
  
  if (cleanStr.length >= 8) {
    const year = parseInt(cleanStr.substring(0, 4));
    const month = parseInt(cleanStr.substring(4, 6)) - 1;
    const day = parseInt(cleanStr.substring(6, 8));
    let hours = 0, minutes = 0, seconds = 0;
    
    if (cleanStr.length >= 15) {
      hours = parseInt(cleanStr.substring(9, 11));
      minutes = parseInt(cleanStr.substring(11, 13));
      seconds = parseInt(cleanStr.substring(13, 15));
    }
    
    if (isUTC) {
      // Create UTC date and convert to local
      return new Date(Date.UTC(year, month, day, hours, minutes, seconds));
    } else {
      // Already local time
      return new Date(year, month, day, hours, minutes, seconds);
    }
  }
  return null;
}

function parseICalEvents(icalText) {
  const events = [];
  const lines = icalText.replace(/\r\n /g, '').replace(/\r\n\t/g, '').split(/\r?\n/);
  let currentEvent = null;
  
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      currentEvent = {};
    } else if (line === 'END:VEVENT' && currentEvent) {
      if (currentEvent.summary && (currentEvent.dtstart || currentEvent.dtend)) {
        events.push(currentEvent);
      }
      currentEvent = null;
    } else if (currentEvent) {
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0) {
        let key = line.substring(0, colonIdx).split(';')[0].toLowerCase();
        const value = line.substring(colonIdx + 1);
        if (key === 'summary') {
          currentEvent.summary = value;
        } else if (key === 'dtstart') {
          currentEvent.dtstart = parseICalDate(value);
          // Check if all-day event (date only, no time component)
          currentEvent.allDay = value.length === 8 || line.includes('VALUE=DATE');
        } else if (key === 'dtend') {
          currentEvent.dtend = parseICalDate(value);
        } else if (key === 'location') {
          currentEvent.location = value;
        } else if (key === 'description') {
          currentEvent.description = value;
        }
      }
    }
  }
  return events;
}

async function calendarFetchWeek() {
  const settings = loadJSON(CALENDAR_SETTINGS_PATH, DEFAULT_CALENDAR_SETTINGS);
  
  if (!settings.icalUrl || !settings.icalUrl.trim()) {
    return { ok: false, error: 'No calendar URL configured. Set it in Day Hub settings.' };
  }
  
  const url = settings.icalUrl.trim();
  
  return new Promise((resolve) => {
    const client = url.startsWith('https') ? https : http;
    
    const req = client.get(url, { timeout: 15000 }, (res) => {
      if (res.statusCode !== 200) {
        resolve({ ok: false, error: `Calendar fetch failed (${res.statusCode})` });
        return;
      }
      
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const events = parseICalEvents(data);
          
          // Filter to next 7 days
          const now = new Date();
          const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          const endOfWeek = new Date(startOfToday);
          endOfWeek.setDate(endOfWeek.getDate() + 7);
          
          const weekEvents = events
            .filter(e => {
              const eventDate = e.dtstart || e.dtend;
              return eventDate >= startOfToday && eventDate < endOfWeek;
            })
            .sort((a, b) => (a.dtstart || a.dtend) - (b.dtstart || b.dtend));
          
          // Group by day
          const byDay = {};
          for (const event of weekEvents) {
            const eventDate = event.dtstart || event.dtend;
            const dayKey = eventDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
            if (!byDay[dayKey]) byDay[dayKey] = [];
            
            let timeStr = '';
            if (!event.allDay && event.dtstart) {
              timeStr = event.dtstart.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
            }
            
            byDay[dayKey].push({
              summary: event.summary,
              time: timeStr,
              allDay: event.allDay,
              location: event.location
            });
          }
          
          resolve({ ok: true, events: byDay, totalCount: weekEvents.length });
        } catch (parseErr) {
          console.error('[CALENDAR] Parse error:', parseErr);
          resolve({ ok: false, error: 'Could not parse calendar data' });
        }
      });
    });
    
    req.on('error', (err) => {
      console.error('[CALENDAR] Fetch error:', err);
      resolve({ ok: false, error: `Calendar fetch failed: ${err.message}` });
    });
    
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'Calendar request timed out' });
    });
  });
}

ipcMain.handle('calendar:getSettings', async () => {
  return loadJSON(CALENDAR_SETTINGS_PATH, DEFAULT_CALENDAR_SETTINGS);
});

ipcMain.handle('calendar:saveSettings', async (event, settings) => {
  return saveJSON(CALENDAR_SETTINGS_PATH, settings);
});

ipcMain.handle('calendar:fetchWeek', async () => {
  return await calendarFetchWeek();
});

// Navigation signal file path - control_bar.py writes here to request navigation
const NAV_SIGNAL_PATH = path.join(BENNYSHUB_DIR, 'nav_signal.json');
let lastNavTimestamp = 0;

function startNavSignalWatcher() {
  // Poll the navigation signal file every 300ms
  setInterval(() => {
    try {
      if (fs.existsSync(NAV_SIGNAL_PATH)) {
        const data = fs.readFileSync(NAV_SIGNAL_PATH, 'utf8');
        const signal = JSON.parse(data);
        
        if (signal.timestamp && signal.timestamp > lastNavTimestamp) {
          lastNavTimestamp = signal.timestamp;
          console.log('[NAV-SIGNAL] Received:', signal);
          
          // Restore and focus the main window, ensure fullscreen
          if (mainWindow && !mainWindow.isDestroyed()) {
            try {
              mainWindow.restore();
              mainWindow.focus();
              mainWindow.show();
              mainWindow.setFullScreen(true);  // Always restore fullscreen

              // Send navigation event to renderer
              mainWindow.webContents.send('nav-signal', signal);
            } catch (e) {
              console.error('[NAV-SIGNAL] Failed to apply signal to mainWindow:', e);
            }
          } else {
            console.error('[NAV-SIGNAL] mainWindow missing/destroyed, could not deliver signal:', signal);
          }

          // Delete the signal file after processing
          try {
            fs.unlinkSync(NAV_SIGNAL_PATH);
          } catch (e) {
            // Ignore deletion errors
          }
        }
      }
    } catch (e) {
      console.error('[NAV-SIGNAL] Error reading/parsing signal file:', e);
    }
  }, 300);
}

// ============ START MENU AUTO-CLOSER ============
// Automatically closes the Windows Start Menu if it opens (prevents accidental activation)

let startMenuCloserProcess = null;

function startStartMenuWatcher() {
  // Use a persistent PowerShell process that monitors for Start Menu
  const script = `
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type @"
      using System;
      using System.Runtime.InteropServices;
      public class User32 {
        [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int count);
        [DllImport("user32.dll")] public static extern int GetClassName(IntPtr hWnd, System.Text.StringBuilder lpClassName, int nMaxCount);
      }
"@
    while ($true) {
      Start-Sleep -Milliseconds 300
      $fg = [User32]::GetForegroundWindow()
      $className = New-Object System.Text.StringBuilder 256
      [User32]::GetClassName($fg, $className, 256) | Out-Null
      $class = $className.ToString()
      if ($class -eq "Windows.UI.Core.CoreWindow") {
        $title = New-Object System.Text.StringBuilder 256
        [User32]::GetWindowText($fg, $title, 256) | Out-Null
        if ($title.ToString() -match "Start|Search") {
          [System.Windows.Forms.SendKeys]::SendWait('{ESC}')
        }
      }
    }
  `;
  
  startMenuCloserProcess = spawn('powershell', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', script], {
    windowsHide: true,
    detached: false
  });
  
  startMenuCloserProcess.on('error', (err) => {
    console.error('[START-MENU-CLOSER] Error:', err);
  });
  
  console.log('[START-MENU-CLOSER] Started');
}

// ============ VOICE SETTINGS API ============
// Provides centralized voice settings storage that syncs across all apps

const DEFAULT_VOICE_SETTINGS = {
  ttsEnabled: true,
  voiceIndex: 0,
  voiceName: null,
  rate: 1.0,
  pitch: 1.0,
  volume: 1.0
};

ipcMain.handle('voice:getSettings', async () => {
  return loadJSON(VOICE_SETTINGS_PATH, DEFAULT_VOICE_SETTINGS);
});

ipcMain.handle('voice:saveSettings', async (event, settings) => {
  const result = saveJSON(VOICE_SETTINGS_PATH, settings);
  
  // Broadcast to all windows/webContents
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('voice-settings-changed', settings);
    
    // Also send to all iframes
    mainWindow.webContents.executeJavaScript(`
      (function() {
        const iframes = document.querySelectorAll('iframe');
        iframes.forEach(iframe => {
          try {
            if (iframe.contentWindow) {
              iframe.contentWindow.postMessage({
                type: 'narbe-voice-settings-changed',
                settings: ${JSON.stringify(settings)}
              }, '*');
            }
          } catch(e) {}
        });
      })();
    `).catch(() => {});
  }
  
  return result;
});

// ============ KEYBOARD API ============

const NGRAM_LIMITS = { frequent_words: 60000, bigrams: 80000, trigrams: 40000 };

function pruneNgrams(data) {
  for (const [key, limit] of Object.entries(NGRAM_LIMITS)) {
    if (!data[key]) continue;
    const entries = Object.entries(data[key]);
    if (entries.length <= limit) continue;
    entries.sort((a, b) => b[1].count - a[1].count);
    data[key] = Object.fromEntries(entries.slice(0, limit));
  }
  return data;
}

ipcMain.handle('keyboard:getPredictions', async () => {
  return loadJSON(KEYBOARD_PREDICTIONS_PATH, { frequent_words: {}, bigrams: {}, trigrams: {} });
});

ipcMain.handle('keyboard:savePrediction', async (event, { word, timestamp }) => {
  const data = loadJSON(KEYBOARD_PREDICTIONS_PATH, { frequent_words: {}, bigrams: {}, trigrams: {} });

  if (!data.frequent_words) data.frequent_words = {};
  if (!data.frequent_words[word]) {
    data.frequent_words[word] = { count: 0 };
  }
  data.frequent_words[word].count++;
  data.frequent_words[word].last_used = timestamp;

  return saveJSON(KEYBOARD_PREDICTIONS_PATH, pruneNgrams(data));
});

ipcMain.handle('keyboard:saveNgram', async (event, { context, next_word, timestamp }) => {
  const data = loadJSON(KEYBOARD_PREDICTIONS_PATH, { frequent_words: {}, bigrams: {}, trigrams: {} });

  const words = context.trim().split(/\s+/).filter(w => w);
  const nextUpper = next_word.toUpperCase();

  if (words.length >= 1) {
    if (!data.bigrams) data.bigrams = {};
    const bigramKey = `${words[words.length - 1].toUpperCase()} ${nextUpper}`;
    if (!data.bigrams[bigramKey]) {
      data.bigrams[bigramKey] = { count: 0 };
    }
    data.bigrams[bigramKey].count++;
    data.bigrams[bigramKey].last_used = timestamp;
  }

  if (words.length >= 2) {
    if (!data.trigrams) data.trigrams = {};
    const trigramKey = `${words.slice(-2).join(' ').toUpperCase()} ${nextUpper}`;
    if (!data.trigrams[trigramKey]) {
      data.trigrams[trigramKey] = { count: 0 };
    }
    data.trigrams[trigramKey].count++;
    data.trigrams[trigramKey].last_used = timestamp;
  }

  return saveJSON(KEYBOARD_PREDICTIONS_PATH, pruneNgrams(data));
});

ipcMain.handle('keyboard:clearPredictions', async () => {
  const defaultData = { frequent_words: {}, bigrams: {}, trigrams: {} };
  return saveJSON(KEYBOARD_PREDICTIONS_PATH, defaultData);
});

// ============ JOURNAL API ============

ipcMain.handle('journal:getEntries', async () => {
  return loadJSON(JOURNAL_ENTRIES_PATH, { entries: [] });
});

ipcMain.handle('journal:saveEntries', async (event, data) => {
  return saveJSON(JOURNAL_ENTRIES_PATH, data);
});

ipcMain.handle('journal:getQuestions', async () => {
  return loadJSON(JOURNAL_QUESTIONS_PATH, { questions: [] });
});

// ============ STREAMING API ============

// Episode cache (loaded from episodes.json)
let episodeCache = null;

function loadEpisodeCache() {
  if (episodeCache !== null) return episodeCache;
  
  try {
    // Load from episodes.json
    episodeCache = loadJSON(STREAMING_EPISODES_PATH, {});
    const showCount = Object.keys(episodeCache).length;
    let episodeCount = 0;
    for (const show of Object.keys(episodeCache)) {
      for (const season of Object.keys(episodeCache[show])) {
        episodeCount += episodeCache[show][season].length;
      }
    }
    console.log(`[STREAMING] Loaded ${episodeCount} episodes for ${showCount} shows from episodes.json`);
  } catch (e) {
    console.error('[STREAMING] Error loading episodes:', e);
    episodeCache = {};
  }
  
  return episodeCache || {};
}

ipcMain.handle('streaming:getData', async () => {
  return loadJSON(STREAMING_DATA_JSON_PATH, []);
});

ipcMain.handle('streaming:getEpisodes', async (event, showTitle) => {
  const cache = loadEpisodeCache();
  if (showTitle) {
    const key = showTitle.toLowerCase().trim();
    return cache[key] || {};
  }
  return cache;
});

ipcMain.handle('streaming:getLastWatched', async (event, showTitle) => {
  const data = loadJSON(STREAMING_LAST_WATCHED_PATH, {});
  if (showTitle) {
    const key = showTitle.toLowerCase().trim();
    return data[key] || null;
  }
  return data;
});

ipcMain.handle('streaming:saveProgress', async (event, { show, season, episode, url }) => {
  const data = loadJSON(STREAMING_LAST_WATCHED_PATH, {});
  const key = show.toLowerCase().trim();
  data[key] = { season, episode, url, timestamp: Date.now() };
  return saveJSON(STREAMING_LAST_WATCHED_PATH, data);
});

// Drop the saved resume URL from one entry, leaving the key and timestamp in place.
// last_watched.json doubles as the Recently Watched list, so deleting the whole entry
// would make the show vanish from that grid. Without a url, showModal falls back to the
// base link from data.json (or continueShow falls back to the first episode).
function stripSavedUrl(entry) {
  if (entry && typeof entry === 'object') {
    delete entry.url;
    entry.season = -1;
    entry.episode = -1;
    return entry;
  }
  // Legacy entries were a bare URL string with no timestamp - keep it that way
  return { season: -1, episode: -1 };
}

ipcMain.handle('streaming:resetProgress', async (event, showTitle) => {
  if (!showTitle) return { success: false, error: 'No show title given' };
  const data = loadJSON(STREAMING_LAST_WATCHED_PATH, {});
  const key = showTitle.toLowerCase().trim();
  if (!(key in data)) return { success: true, cleared: false };
  data[key] = stripSavedUrl(data[key]);
  saveJSON(STREAMING_LAST_WATCHED_PATH, data);
  console.log(`[STREAMING] Reset progress for: ${key}`);
  return { success: true, cleared: true };
});

ipcMain.handle('streaming:clearAllProgress', async () => {
  const data = loadJSON(STREAMING_LAST_WATCHED_PATH, {});
  let count = 0;
  for (const key of Object.keys(data)) {
    const entry = data[key];
    if (typeof entry === 'string' || (entry && entry.url)) count++;
    data[key] = stripSavedUrl(entry);
  }
  saveJSON(STREAMING_LAST_WATCHED_PATH, data);
  console.log(`[STREAMING] Cleared saved URLs for ${count} show(s)`);
  return { success: true, count };
});

ipcMain.handle('streaming:getSearchHistory', async () => {
  return loadJSON(STREAMING_SEARCH_HISTORY_PATH, []);
});

ipcMain.handle('streaming:saveSearch', async (event, term) => {
  let history = loadJSON(STREAMING_SEARCH_HISTORY_PATH, []);
  term = term.trim();
  if (term) {
    // Remove existing duplicate
    history = history.filter(h => h.toLowerCase() !== term.toLowerCase());
    // Add to front
    history.unshift(term);
    // Keep max 50
    history = history.slice(0, 50);
    saveJSON(STREAMING_SEARCH_HISTORY_PATH, history);
  }
  return history;
});

ipcMain.handle('streaming:clearSearchHistory', async () => {
  return saveJSON(STREAMING_SEARCH_HISTORY_PATH, []);
});

ipcMain.handle('streaming:launch', async (event, { url, title, type, showTitle, saveUrl }) => {
  try {
    // showTitle is the base show name (e.g. "Breaking Bad"), title may include S#E# suffix
    const controlBarTitle = showTitle || title;
    // saveUrl is the URL to save in last_watched (for Plex shows, this is the default show URL)
    const urlToSave = saveUrl || url;
    console.log(`[STREAMING] Launching: ${title} | ${url} | ${type} | controlBar: ${controlBarTitle} | saveUrl: ${urlToSave}`);
    
    // SAVE URL TO LAST_WATCHED.JSON IMMEDIATELY
    // This ensures we always have the URL saved, even if exit methods fail
    try {
      const showKey = controlBarTitle.toLowerCase().trim();
      let lastWatched = {};
      if (fs.existsSync(STREAMING_LAST_WATCHED_PATH)) {
        lastWatched = JSON.parse(fs.readFileSync(STREAMING_LAST_WATCHED_PATH, 'utf8'));
      }
      
      // Remove existing entry so new one goes to end (most recent)
      delete lastWatched[showKey];
      
      lastWatched[showKey] = {
        season: -1,
        episode: -1,
        url: urlToSave,
        timestamp: Date.now()
      };
      
      fs.writeFileSync(STREAMING_LAST_WATCHED_PATH, JSON.stringify(lastWatched, null, 2));
      console.log(`[STREAMING] Saved URL to last_watched: ${showKey} -> ${url.substring(0, 60)}...`);
    } catch (saveErr) {
      console.error(`[STREAMING] Failed to save URL: ${saveErr.message}`);
    }
    
    // Launch Chrome with the URL and remote debugging for control_bar.py automation
    // --autoplay-policy=no-user-gesture-required ensures audio isn't muted on Disney+ etc
    // --enable-features=HardwareMediaKeyHandling enables global media key support (required for Plex)
    // --disable-background-mode prevents Chrome from running in background after window closes
    // --disable-backgrounding-occluded-windows helps Chrome close cleanly
    const args = [
      '--new-window',
      '--start-fullscreen', 
      '--remote-debugging-port=9222', 
      '--autoplay-policy=no-user-gesture-required', 
      '--enable-features=HardwareMediaKeyHandling',
      '--disable-background-mode',
      '--disable-backgrounding-occluded-windows',
      url
    ];
    
    const chromeProcess = spawn(CHROME_PATH, args, {
      detached: true,
      stdio: 'ignore'
    });
    chromeProcess.unref();
    
    // Minimize Electron window so Chrome takes focus
    if (mainWindow) {
      mainWindow.minimize();
    }
    
    // Determine delay for control bar based on platform
    // Control bar launches early for user interaction, then sends automation keys after 3s
    let delay = 5000; // Default - page should be loading
    if (url.includes('plex.tv') || url.includes('plex.direct') || url.includes(':32400')) {
      delay = 10000; // Plex needs more time to load
    } else if (url.includes('pluto.tv')) {
      delay = 12000; // PlutoTV is slow
    } else if (url.includes('youtube.com') || url.includes('youtu.be')) {
      delay = 6000; // YouTube loads faster
    }
    
    // Launch control bar after delay - it handles automation via _bootstrap_once()
    // Use controlBarTitle (base show name) so it can find the URL in last_watched.json
    setTimeout(() => {
      launchControlBar('basic', controlBarTitle);
    }, delay);
    
    return { success: true };
  } catch (e) {
    console.error('[STREAMING] Launch error:', e);
    return { success: false, error: e.message };
  }
});

function launchControlBar(mode, showTitle) {
  if (fs.existsSync(CONTROL_BAR_SCRIPT)) {
    const args = [CONTROL_BAR_SCRIPT, '--mode', mode, '--app-title', 'Streaming Hub'];
    if (showTitle) {
      args.push('--show', showTitle);
    }
    
    console.log(`[CONTROL-BAR] Launching: python ${args.join(' ')}`);
    console.log(`[CONTROL-BAR] Script exists: ${fs.existsSync(CONTROL_BAR_SCRIPT)}`);
    console.log(`[CONTROL-BAR] Script path: ${CONTROL_BAR_SCRIPT}`);
    
    const proc = spawn('python', args, {
      cwd: path.dirname(CONTROL_BAR_SCRIPT),
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe']  // Capture stdout/stderr
    });
    
    // Log output from control bar
    proc.stdout.on('data', (data) => {
      console.log(`[CONTROL-BAR] ${data.toString().trim()}`);
    });
    proc.stderr.on('data', (data) => {
      console.error(`[CONTROL-BAR-ERR] ${data.toString().trim()}`);
    });
    proc.on('error', (err) => {
      console.error(`[CONTROL-BAR] Failed to start: ${err.message}`);
    });
    proc.on('exit', (code) => {
      console.log(`[CONTROL-BAR] Exited with code: ${code}`);
    });
    
    proc.unref();
    console.log(`[CONTROL-BAR] Process started with PID: ${proc.pid}`);
  } else {
    console.error(`[CONTROL-BAR] Script not found: ${CONTROL_BAR_SCRIPT}`);
  }
}

// ============ EXTERNAL APP LAUNCHERS ============

ipcMain.handle('launch:messenger', async () => {
  try {
    // Launch the new HTML5 Electron messenger as its own process. Its main.js
    // spawns the python backend and opens the fullscreen scan UI.
    if (fs.existsSync(MESSENGER_APP_MAIN) && fs.existsSync(ELECTRON_BIN)) {
      spawn(ELECTRON_BIN, [MESSENGER_APP_MAIN], {
        cwd: path.dirname(MESSENGER_APP_MAIN),
        detached: true,
        stdio: 'ignore'
      }).unref();
      return { success: true };
    }
    return { success: false, error: 'Messenger app not found' };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ============ IN-IFRAME MESSENGER (preferred) ============
// The messenger frontend runs inside the hub's app iframe. These handlers give
// it the same capabilities its standalone Electron preload (benAPI) provided:
// a python WebSocket backend, file IO for keyboard predictions, config, and
// external video playback. The frontend reaches them via the electron bridge
// (messenger.* namespace) which proxies postMessage to the hub.

// Spawn the python WebSocket backend if it is not already running. Idempotent.
function startMessengerBackend() {
  if (messengerBackendProc && messengerBackendProc.exitCode === null) {
    return true; // already running
  }
  if (!fs.existsSync(MESSENGER_BACKEND_SCRIPT)) {
    console.error('[MESSENGER] backend.py not found:', MESSENGER_BACKEND_SCRIPT);
    return false;
  }
  try {
    messengerBackendProc = spawn('python', [MESSENGER_BACKEND_SCRIPT], {
      cwd: MESSENGER_DIR,
      env: Object.assign({}, process.env, { NEW_MSG_WS_PORT: String(MESSENGER_WS_PORT) }),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    messengerBackendProc.stdout.on('data', (d) => process.stdout.write('[msg-backend] ' + d));
    messengerBackendProc.stderr.on('data', (d) => process.stderr.write('[msg-backend] ' + d));
    messengerBackendProc.on('exit', (code) => {
      console.log('[MESSENGER] backend exited with code', code);
      messengerBackendProc = null;
    });
    console.log('[MESSENGER] backend started, PID', messengerBackendProc.pid);
    return true;
  } catch (e) {
    console.error('[MESSENGER] failed to start backend:', e.message);
    messengerBackendProc = null;
    return false;
  }
}

function stopMessengerBackend() {
  if (messengerBackendProc) {
    try { messengerBackendProc.kill(); } catch (_) {}
    messengerBackendProc = null;
  }
}

ipcMain.handle('messenger:start-backend', async () => {
  const ok = startMessengerBackend();
  return { success: ok, wsPort: MESSENGER_WS_PORT };
});

// ── Search in-iframe backend IPC ──────────────────────────────────────────────
function startSearchBackend() {
  if (searchBackendProc && searchBackendProc.exitCode === null) return true;
  if (!fs.existsSync(SEARCH_BACKEND_SCRIPT)) {
    console.error('[SEARCH] backend.py not found:', SEARCH_BACKEND_SCRIPT);
    return false;
  }
  try {
    searchBackendProc = spawn('python', [SEARCH_BACKEND_SCRIPT], {
      cwd: SEARCH_DIR,
      env: Object.assign({}, process.env, { SEARCH_WS_PORT: String(SEARCH_WS_PORT) }),
    });
    searchBackendProc.stdout.on('data', (d) => process.stdout.write('[search-backend] ' + d));
    searchBackendProc.stderr.on('data', (d) => process.stderr.write('[search-backend] ' + d));
    searchBackendProc.on('exit', (code) => {
      console.log('[SEARCH] backend exited with code', code);
      searchBackendProc = null;
    });
    console.log('[SEARCH] backend started, PID', searchBackendProc.pid);
    return true;
  } catch (e) {
    console.error('[SEARCH] failed to start backend:', e.message);
    searchBackendProc = null;
    return false;
  }
}

function stopSearchBackend() {
  if (searchBackendProc) {
    try { searchBackendProc.kill(); } catch (_) {}
    searchBackendProc = null;
  }
}

ipcMain.handle('search:start-backend', async () => {
  const ok = startSearchBackend();
  return { success: ok, wsPort: SEARCH_WS_PORT };
});

ipcMain.handle('search:get-config', () => ({ appDir: SEARCH_DIR, wsPort: SEARCH_WS_PORT }));

// ── Search: Node.js HTTP helpers (no Python / no pip required) ────────────────
function searchNodeGet(urlStr, extraHeaders) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(urlStr); } catch (e) { return reject(e); }
    const proto = parsed.protocol === 'https:' ? https : require('http');
    const opts  = {
      hostname: parsed.hostname,
      port:     parsed.port ? Number(parsed.port) : (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.pathname + (parsed.search || ''),
      method:   'GET',
      headers: Object.assign({
        'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        'Accept':          'text/html,application/json,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'identity',
      }, extraHeaders || {}),
    };
    const req = proto.request(opts, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let loc = res.headers.location;
        if (loc.startsWith('/')) loc = `${parsed.protocol}//${parsed.hostname}${loc}`;
        resolve(searchNodeGet(loc, extraHeaders));
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => { body += c; });
      res.on('end',  () => resolve({ ok: res.statusCode < 400, status: res.statusCode, text: body }));
      res.on('error', reject);
    });
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
    req.end();
  });
}

// ── Hidden BrowserWindow search (same method as narbe_scan_browser.py) ────────
// Load real search engine pages in a hidden Chromium window, inject JS to scrape
// image/video URLs from the rendered DOM — identical to the Python app approach.

let _searchWin = null;
let _altWin    = null;   // second hidden browser for parallel Rumble searches

// Disable SafeSearch the same way the Python app did — via cookies on the browser
// profile. URL params (adlt=off / kp=-2 / safesearch=off) are widely ignored by the
// engines; the cookie is what actually unlocks adult/NSFW results. Idempotent.
let _searchCookiesInstalled = false;
async function installSearchCookies() {
  if (_searchCookiesInstalled) return;
  _searchCookiesInstalled = true;
  const fiveYears = Math.floor(Date.now() / 1000) + 5 * 365 * 24 * 3600;
  const cookies = [
    // Google: consent + SafeSearch off (PREF f2=8000000 disables SafeSearch)
    { url: 'https://www.google.com', domain: '.google.com', name: 'PREF',       value: 'f2=8000000&hl=en&gl=US' },
    { url: 'https://www.google.com', domain: '.google.com', name: 'CONSENT',    value: 'YES+cb.2024' },
    // YouTube: restricted mode off
    { url: 'https://www.youtube.com', domain: '.youtube.com', name: 'PREF',     value: 'f2=8000000' },
    // Bing: adult filter off
    { url: 'https://www.bing.com', domain: '.bing.com', name: 'SRCHHPGUSR',     value: 'ADLT=OFF' },
    { url: 'https://www.bing.com', domain: '.bing.com', name: 'SRCHUSR',        value: 'ADLT=OFF' },
    { url: 'https://www.bing.com', domain: '.bing.com', name: 'ADLT',           value: 'OFF' },
    // DuckDuckGo: SafeSearch off
    { url: 'https://duckduckgo.com', domain: '.duckduckgo.com', name: 'kp',     value: '-2' },
    // Brave: SafeSearch off
    { url: 'https://search.brave.com', domain: '.search.brave.com', name: 'safesearch', value: 'off' },
  ];
  for (const c of cookies) {
    try {
      await session.defaultSession.cookies.set({
        url: c.url, name: c.name, value: c.value, domain: c.domain,
        path: '/', secure: true, expirationDate: fiveYears,
      });
    } catch (e) { /* non-fatal */ }
  }
}

function _makeScrapeWin() {
  const w = new BrowserWindow({
    show: false, width: 1280, height: 900,
    webPreferences: { nodeIntegration: false, contextIsolation: false,
                      javascript: true, webSecurity: false },
  });
  w.webContents.setAudioMuted(true);
  return w;
}

function _getSearchWin() {
  if (_searchWin && !_searchWin.isDestroyed()) return _searchWin;
  _searchWin = _makeScrapeWin();
  _searchWin.on('closed', () => { _searchWin = null; });
  return _searchWin;
}

function _getAltWin() {
  if (_altWin && !_altWin.isDestroyed()) return _altWin;
  _altWin = _makeScrapeWin();
  _altWin.on('closed', () => { _altWin = null; });
  return _altWin;
}

function _waitLoad(wc, ms) {
  return new Promise(resolve => {
    const t = setTimeout(resolve, ms);
    wc.once('did-finish-load', () => { clearTimeout(t); resolve(); });
  });
}

// Exact image-scraping JS from narbe_scan_browser.py (works on Google, DDG, Bing)
const INJECT_IMAGES_JS = String.raw`(function(){
  function isBad(u){
    try{var url=new URL(u,location.href);var h=(url.hostname||'').toLowerCase();var p=(url.pathname||'').toLowerCase();
    if(/encrypted\-tbn/i.test(h))return true;if(/branding|logo/.test(p))return true;}catch(e){}
    return/^data:/i.test(String(u||""));
  }
  function decodeDDG(u){
    try{var x=new URL(u,location.href);if((x.hostname||'').toLowerCase().indexOf('duckduckgo.com')!==-1&&/\/iu\/?/.test(x.pathname)){var orig=x.searchParams.get('u')||'';if(orig)return decodeURIComponent(orig);}}catch(e){}return u;
  }
  function getOrig(href){
    try{var u=new URL(href,location.href);var c=u.searchParams.get('imgurl')||u.searchParams.get('imgrefurl')||u.searchParams.get('mediaurl')||u.searchParams.get('murl')||u.searchParams.get('imgsrc')||u.searchParams.get('u')||'';if(c)return decodeDDG(c);return href;}catch(e){}return href;
  }
  var out=[],seen={};
  try{var ga=Array.from(document.querySelectorAll('a[href^="/imgres?"]'));for(var i=0;i<ga.length&&out.length<80;i++){var href=ga[i].getAttribute('href')||ga[i].href||'';if(!href)continue;try{var u=new URL(href,location.href);var img=u.searchParams.get('imgurl')||'';if(!img||isBad(img)||seen[img])continue;seen[img]=1;var t='';try{var im=ga[i].querySelector('img');t=(im&&im.getAttribute('alt'))||ga[i].getAttribute('title')||'image';}catch(e){}out.push({img:img,title:t||'image'});}catch(e){}}}catch(e){}
  try{var anchors=Array.from(document.querySelectorAll('a[href*="/iu/"],a[href*="imgurl="],a[href*="mediaurl="],a[href*="murl="]'));for(var i=0;i<anchors.length&&out.length<80;i++){var href=anchors[i].href||anchors[i].getAttribute('href')||'';if(!href)continue;var img=getOrig(href);img=decodeDDG(img);if(!img||isBad(img)||seen[img])continue;seen[img]=1;var t='';try{var im=anchors[i].querySelector('img');t=(im&&im.getAttribute('alt'))||anchors[i].getAttribute('title')||'image';}catch(e){}out.push({img:img,title:t||'image'});}}catch(e){}
  try{var tiles=Array.from(document.querySelectorAll('.iusc,[m]'));for(var i=0;i<tiles.length&&out.length<80;i++){var m=tiles[i].getAttribute('m')||'';if(!m)continue;try{var o=JSON.parse(m);var img=o.murl||o.purl||'';if(!img||isBad(img)||seen[img])continue;seen[img]=1;out.push({img:img,title:o.t||o.tt||'image'});}catch(e){}}}catch(e){}
  if(!out.length){var imgs=Array.from(document.querySelectorAll('img[data-iurl],img[data-src],img[src^="http"],img'));for(var i=0;i<imgs.length&&out.length<80;i++){var el=imgs[i];var big=el.getAttribute('data-iurl')||el.getAttribute('data-src')||el.currentSrc||el.src||'';big=decodeDDG(big);if(!big||isBad(big)||seen[big])continue;try{var w=el.naturalWidth||0,h=el.naturalHeight||0;if(w&&h&&(w<300||h<200))continue;}catch(e){}seen[big]=1;var t=el.getAttribute('alt')||'image';out.push({img:big,title:t});}}
  return JSON.stringify(out.slice(0,80));
})();`;

// Video-scraping JS injected into hidden browser pages.
// Pre-scans ytInitialData for reelWatchEndpoint (YouTube Shorts in search data) so they get
// isShort:1 regardless of whether the DOM Shorts shelf has rendered yet.
const INJECT_VIDEOS_JS = String.raw`(function(){
  var out=[],seen={};
  // Phase 0: collect Shorts videoIds from ytInitialData before push() is called,
  // so they get isShort:1 even when found later by the generic videoId walker.
  var shortsIds={};
  try{(function r(o){if(!o)return;if(Array.isArray(o)){for(var i=0;i<o.length;i++)r(o[i]);return;}if(typeof o==='object'){if(o.reelWatchEndpoint&&o.reelWatchEndpoint.videoId)shortsIds[o.reelWatchEndpoint.videoId]=1;for(var k in o){if(Object.prototype.hasOwnProperty.call(o,k))r(o[k]);}}})(window.ytInitialData);}catch(e){}
  function push(id,title,isShort){if(!id||seen[id])return;seen[id]=1;out.push({videoId:id,title:title||'video',isShort:(isShort||shortsIds[id])?1:0});}
  try{var sh=Array.from(document.querySelectorAll('a[href^="/shorts/"]'));for(var i=0;i<sh.length;i++){var a=sh[i];var m=(a.pathname||'').match(/\/shorts\/([^\/\?\&]+)/);var id=m&&m[1]||'';if(!id)continue;var t=(a.getAttribute('title')||a.textContent||'short').trim().replace(/\s+/g,' ');push(id,t,1);}}catch(e){}
  try{(function walk(o){if(!o)return;if(Array.isArray(o)){for(var i=0;i<o.length;i++)walk(o[i]);return;}if(typeof o==='object'){if(o.videoId&&!o.playlistId){var t='';try{if(o.title&&Array.isArray(o.title.runs))t=o.title.runs.map(function(r){return r.text||'';}).join('');if(!t&&o.title&&o.title.simpleText)t=o.title.simpleText;}catch(e){}push(o.videoId,t||'video',0);}for(var k in o){if(Object.prototype.hasOwnProperty.call(o,k))walk(o[k]);}}})(window.ytInitialData);}catch(e){}
  try{var sels=['a#thumbnail[href*="/watch"]','a#video-title[href*="/watch"]','a.yt-simple-endpoint[href*="/watch"]','ytd-video-renderer a[href*="/watch"]','ytd-rich-item-renderer a[href*="/watch"]','a[href^="/watch?"]'];var anchors=[];for(var s=0;s<sels.length;s++){anchors.push.apply(anchors,Array.from(document.querySelectorAll(sels[s])));}for(var i=0;i<anchors.length;i++){var a=anchors[i];var href=a.href||a.getAttribute('href')||'';if(!href)continue;try{var u=new URL(href,location.href);var id=u.searchParams.get('v')||'';if(!id)continue;var t=(a.getAttribute('title')||(a.querySelector('#video-title')&&a.querySelector('#video-title').textContent)||a.textContent||'video');t=(t||'video').trim().replace(/\s+/g,' ');push(id,t,0);}catch(e){}}}catch(e){}
  return JSON.stringify(out.slice(0,60));
})();`;

// Rumble video scraping — searches rumble.com/search/video, extracts embed IDs
const INJECT_RUMBLE_JS = String.raw`(function(){
  var out=[], seen={};
  var links = Array.from(document.querySelectorAll('a[href]'));
  for (var i=0; i<links.length && out.length<30; i++){
    var href = links[i].getAttribute('href')||'';
    var m = href.match(/^\/(v[a-z0-9]+)-/i);
    if (!m || seen[m[1]]) continue;
    seen[m[1]] = 1;
    var title = '';
    try {
      var card = links[i].closest('[class*="video"],[class*="card"],[class*="listing"],[class*="item"]') || links[i].parentElement;
      var el = (card && card.querySelector('[class*="title"],[class*="heading"],h3,h4')) || links[i];
      title = (el.getAttribute('title')||el.textContent||'').trim().replace(/\s+/g,' ').slice(0,120);
    } catch(e) {}
    if (!title) title = (links[i].getAttribute('title')||links[i].textContent||'video').trim().replace(/\s+/g,' ').slice(0,120);
    var thumb = '';
    try {
      var card2 = links[i].closest('[class*="video"],[class*="card"],[class*="listing"],[class*="item"]') || links[i].parentElement;
      var img = (card2 && card2.querySelector('img[src]')) || links[i].querySelector('img[src]');
      if (img) thumb = img.getAttribute('data-src')||img.src||'';
    } catch(e) {}
    out.push({videoId: m[1], title: title||'video', thumb: thumb});
  }
  return JSON.stringify(out.slice(0,30));
})();`;

async function scrapeImagesWithBrowser(query) {
  await installSearchCookies();
  const wc = _getSearchWin().webContents;
  const qEnc = encodeURIComponent(query);
  // When the user is after gifs, target the engines' animated-gif filters so we surface
  // real animated .gif URLs (which animate natively) instead of static photos/webp.
  // Lead with the permissive engines (Bing adlt=off, DDG kp=-2, Brave safesearch=off)
  // so NSFW results come through like the old Python app — Google filters adult content
  // even with safe=off, and the loop returns on the first engine that yields results.
  const isGif = /\bgifs?\b/i.test(query);
  const urls = isGif ? [
    `https://www.bing.com/images/search?q=${qEnc}&qft=+filterui:photo-animatedgif&FORM=IRFLTR&safeSearch=off&adlt=off`,
    `https://duckduckgo.com/?q=${qEnc}&iar=images&iax=images&ia=images&kp=-2`,
    `https://search.brave.com/images?q=${qEnc}&source=web&spellcheck=1&safesearch=off`,
    `https://www.google.com/search?tbm=isch&q=${qEnc}&safe=off&tbs=itp:animated`,
  ] : [
    `https://www.bing.com/images/search?q=${qEnc}&FORM=HDRSC2&safeSearch=off&adlt=off`,
    `https://duckduckgo.com/?q=${qEnc}&iar=images&iax=images&ia=images&kp=-2`,
    `https://search.brave.com/images?q=${qEnc}&source=web&spellcheck=1&safesearch=off`,
    `https://www.google.com/search?tbm=isch&q=${qEnc}&safe=off`,
  ];
  for (const url of urls) {
    try {
      await wc.loadURL(url);
      await _waitLoad(wc, 6000);
      // Dismiss consent dialogs (same as Python app's CONSENT_JS)
      try { await wc.executeJavaScript(`(function(){var b=Array.from(document.querySelectorAll('button'));for(var i=0;i<b.length;i++){var t=(b[i].innerText||'').trim().toLowerCase();if(['accept all','agree','got it','ok','i agree','accept'].includes(t)){b[i].click();}}})()`); } catch(_) {}
      await new Promise(r => setTimeout(r, 600));
      // Scroll to trigger lazy-load (same as Python app)
      try { await wc.executeJavaScript(`window.scrollBy(0,Math.max(1400,document.body.scrollHeight/1.5));`); } catch(_) {}
      await new Promise(r => setTimeout(r, 600));
      const raw     = await wc.executeJavaScript(INJECT_IMAGES_JS);
      const results = JSON.parse(raw);
      console.log(`[SEARCH] ${url.split('?')[0].split('/').pop()} → ${results.length} images`);
      if (results.length >= 3) {
        return results.slice(0, 25).map(x => ({ type: 'image', url: x.img, thumb: x.img, title: x.title }));
      }
    } catch (e) { console.log('[SEARCH] browser image failed:', e.message); }
  }
  return [];
}

function _ytItem(v) {
  return {
    type: 'video', id: v.videoId, title: v.title || 'Video', source: 'youtube',
    thumb: `https://img.youtube.com/vi/${v.videoId}/hqdefault.jpg`,
    embedUrl: `https://www.youtube-nocookie.com/embed/${v.videoId}?autoplay=1&mute=0&rel=0&controls=1&modestbranding=1`,
  };
}

// Long-form video search via Cloudflare Worker (returns regular YouTube videos, no Shorts).
async function scrapeVideosWithBrowser(query) {
  try {
    await installSearchCookies();
    const wc = _getSearchWin().webContents;
    wc.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
    );

    const qEnc = encodeURIComponent(query);
    await wc.loadURL(`https://www.youtube.com/results?search_query=${qEnc}`);
    await _waitLoad(wc, 9000);
    await new Promise(r => setTimeout(r, 3000));

    // Scroll a few times to surface more results from lazy rendering.
    for (let i = 0; i < 3; i++) {
      try { await wc.executeJavaScript('window.scrollTo(0,document.documentElement.scrollHeight);'); } catch (_) {}
      await new Promise(r => setTimeout(r, 900));
    }

    let raw = [];
    try { raw = JSON.parse(await wc.executeJavaScript(INJECT_VIDEOS_JS) || '[]'); } catch (_) {}

    console.log(`[SEARCH] Video scrape → ${raw.length} total (${raw.filter(v => v.isShort).length} shorts mixed in)`);
    return raw.slice(0, 40).map(_ytItem);
  } catch (err) {
    console.error('[SEARCH] scrapeVideosWithBrowser error:', err.message);
    return [];
  }
}

// Scrape YouTube Shorts — three independent strategies tried in order:
//   A) Channel Shorts tab  (@query/shorts)        — best for channel-name searches
//   B) Search + duration filter (sp=EgIYAQ==)     — all results are short-duration videos
//   C) Search + "shorts" text + isShort DOM filter — fallback text approach
// The hidden browser gets a clean Chrome UA so YouTube doesn't serve consent/bot pages.
async function scrapeShorts(query) {
  try {
    await installSearchCookies();
    const wc = _getSearchWin().webContents;
    // Remove "Electron" from the user-agent — YouTube may serve consent dialogs otherwise.
    wc.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
    );

    async function loadExtract(url, filterShorts) {
      try {
        await wc.loadURL(url);
        await _waitLoad(wc, 9000);
        await new Promise(r => setTimeout(r, 3500));
        try {
          await wc.executeJavaScript(
            'window.scrollBy(0,Math.max(1400,document.body.scrollHeight/1.5));' +
            'setTimeout(function(){window.scrollTo(0,0);},180);'
          );
        } catch (_) {}
        await new Promise(r => setTimeout(r, 2000));
        for (let i = 0; i < 3; i++) {
          try {
            const raw = JSON.parse(await wc.executeJavaScript(INJECT_VIDEOS_JS) || '[]');
            const items = filterShorts ? raw.filter(v => v.isShort) : raw;
            console.log(`[SEARCH] Shorts loadExtract attempt ${i + 1}: ${items.length}/${raw.length} — ${url.slice(0, 55)}`);
            if (items.length > 0) return items;
          } catch (_) {}
          if (i < 2) await new Promise(r => setTimeout(r, 1500));
        }
      } catch (e) { console.error('[SEARCH] Shorts loadExtract error:', e.message); }
      return [];
    }

    const qEnc = encodeURIComponent(query);
    const seen = new Set();
    const all  = [];
    function merge(items) {
      for (const v of items) if (!seen.has(v.videoId)) { seen.add(v.videoId); all.push(v); }
    }

    // Strategy A: channel Shorts tab — guaranteed Shorts for channel-name queries
    merge(await loadExtract(`https://www.youtube.com/@${qEnc}/shorts`, false));
    console.log(`[SEARCH] Shorts after A (channel tab): ${all.length}`);

    // Strategy B: YouTube short-duration search filter — all returned videos are < 4 min;
    // no need to filter by isShort since the URL already limits to short-form content.
    if (all.length < 10) {
      merge(await loadExtract(
        `https://www.youtube.com/results?search_query=${qEnc}&sp=EgIYAQ%3D%3D`, false
      ));
      console.log(`[SEARCH] Shorts after B (sp filter): ${all.length}`);
    }

    // Strategy C: free-text search with "shorts" appended, isShort DOM-tag filter
    if (all.length < 5) {
      merge(await loadExtract(
        `https://www.youtube.com/results?search_query=${encodeURIComponent(query + ' shorts')}`, true
      ));
      console.log(`[SEARCH] Shorts after C (text+isShort): ${all.length}`);
    }

    console.log(`[SEARCH] Shorts final: ${all.length}`);
    return all.slice(0, 50).map(_ytItem);
  } catch (err) {
    console.error('[SEARCH] scrapeShorts error:', err.message);
    return [];
  }
}

async function nodeKenlmPredict(text) {
  try {
    const words  = text.trimEnd().split(/\s+/).filter(Boolean);
    const prefix = text.endsWith(' ') ? '' : (words[words.length - 1] || '');
    const ctx    = text.endsWith(' ') ? words : words.slice(0, -1);
    const qs     = new URLSearchParams({ num: '6', sort: 'logprob', safe: 'true', lang: 'en' });
    if (prefix) qs.set('prefix', prefix);
    if (ctx.length) qs.set('left', ctx.join(' '));
    const res  = await searchNodeGet(
      'https://api.imagineville.org/word/predict?' + qs.toString(),
      { Accept: 'application/json' }
    );
    const raw  = JSON.parse(res.text);
    const list = Array.isArray(raw) ? raw
               : (raw.suggestions || raw.result || raw.results || raw.predictions || raw.words || []);
    return list.map(w => (typeof w === 'string' ? w : (w.text || w.word || w.token || ''))).filter(Boolean).slice(0, 6);
  } catch (_) { return []; }
}

function loadSearchHistoryNode() {
  try {
    if (fs.existsSync(SEARCH_HISTORY_FILE))
      return JSON.parse(fs.readFileSync(SEARCH_HISTORY_FILE, 'utf8'));
  } catch (_) {}
  return [];
}

function appendSearchHistoryNode(query) {
  let h = loadSearchHistoryNode();
  h = h.filter(q => q.toLowerCase() !== query.toLowerCase());
  h.unshift(query);
  try { fs.writeFileSync(SEARCH_HISTORY_FILE, JSON.stringify(h.slice(0, 20), null, 2)); } catch (_) {}
}

ipcMain.handle('search:do-search', async (_, query, mode) => {
  if (!query) return { items: [], mode };
  appendSearchHistoryNode(query);
  let items;
  if (mode === 'video')  items = await scrapeVideosWithBrowser(query);
  else if (mode === 'shorts') items = await scrapeShorts(query);
  else items = await scrapeImagesWithBrowser(query);
  return { items, mode };
});
ipcMain.handle('search:predict',       async (_, text)  => nodeKenlmPredict(text));
ipcMain.handle('search:get-history',   async ()         => loadSearchHistoryNode());
ipcMain.handle('search:save-history',  async (_, query) => appendSearchHistoryNode(query));
ipcMain.handle('search:clear-history', async ()         => {
  try { fs.writeFileSync(SEARCH_HISTORY_FILE, '[]'); } catch (_) {}
});

ipcMain.handle('messenger:get-config', () => ({ appDir: MESSENGER_DIR, wsPort: MESSENGER_WS_PORT }));

ipcMain.handle('messenger:read-file', (_, filePath) => {
  try { return fs.readFileSync(filePath, 'utf8'); } catch (_) { return null; }
});

ipcMain.handle('messenger:write-file', (_, filePath, data) => {
  try {
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, data, 'utf8');
    fs.renameSync(tmp, filePath);
    return true;
  } catch (_) { return false; }
});

// Read-merge-write handler for predictive_ngrams.json. Accepts a delta (only the
// new entries from the current message) so it never clobbers concurrent writes
// from the hub keyboard app. Writes atomically via temp file + rename.
ipcMain.handle('messenger:update-ngrams', (_, filePath, delta) => {
  try {
    let data = { frequent_words: {}, bigrams: {}, trigrams: {} };
    try { data = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (_) {}
    if (!data.frequent_words) data.frequent_words = {};
    if (!data.bigrams)        data.bigrams        = {};
    if (!data.trigrams)       data.trigrams       = {};

    const ts = (delta && delta.timestamp) || new Date().toISOString();
    function merge(target, src) {
      if (!src) return;
      for (const [k, v] of Object.entries(src)) {
        if (!target[k]) target[k] = { count: 0 };
        target[k].count += (v.count || 1);
        target[k].last_used = ts;
      }
    }
    merge(data.frequent_words, delta && delta.frequent_words);
    merge(data.bigrams,        delta && delta.bigrams);
    merge(data.trigrams,       delta && delta.trigrams);

    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, filePath);
    return true;
  } catch (_) { return false; }
});

// Open a video (e.g. YouTube) fullscreen in Chrome with the accessible control
// bar via play_video.py, falling back to the default browser.
ipcMain.handle('messenger:open-video', (_, url) => {
  if (!url) return false;
  try {
    const launcher = path.join(MESSENGER_DIR, 'play_video.py');
    if (fs.existsSync(launcher)) {
      spawn('python', [launcher, url, '--app-title', 'NARBE Benny’s Access Hub'],
        { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } else {
      try { shell.openExternal(url); } catch (_) {}
    }
    return true;
  } catch (e) {
    console.error('[MESSENGER] open-video failed:', e.message);
    return false;
  }
});

ipcMain.handle('launch:ai-bridge', async () => {
  try {
    if (fs.existsSync(AI_BRIDGE_SCRIPT)) {
      spawn('python', [AI_BRIDGE_SCRIPT], {
        cwd: path.dirname(AI_BRIDGE_SCRIPT),
        detached: true,
        stdio: 'ignore'
      });
      return { success: true };
    }
    return { success: false, error: 'Bridge script not found' };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('launch:search', async () => {
  try {
    if (fs.existsSync(SEARCH_SCRIPT)) {
      spawn('python', [SEARCH_SCRIPT], {
        cwd: path.dirname(SEARCH_SCRIPT),
        detached: true,
        stdio: 'ignore'
      });
      return { success: true };
    }
    return { success: false, error: 'Search script not found' };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ============ EDITOR LAUNCHER ============
// Launches editors in Chrome browser via localhost server for proper mouse/keyboard support

const EDITOR_SERVER_SCRIPT = path.join(BENNYSHUB_DIR, 'shared', 'editor_server.py');
let editorServerProcess = null;
let editorServerPort = null;

// Available editors
const EDITOR_PATHS = {
  streaming: { path: 'apps/tools/streaming', file: 'editor.html' },
  triviamaster: { path: 'apps/games/TRIVIAMASTER/trivia editor', file: 'index.html' },
  trivia: { path: 'apps/games/TRIVIAMASTER/trivia editor', file: 'index.html' },
  golf: { path: 'apps/games/BENNYSMINIGOLF/COURSE CREATOR', file: 'index.html' },
  minigolf: { path: 'apps/games/BENNYSMINIGOLF/COURSE CREATOR', file: 'index.html' },
  matchymatch: { path: 'apps/games/BENNYSMATCHYMATCH', file: 'editor.html' },
  matchy: { path: 'apps/games/BENNYSMATCHYMATCH', file: 'editor.html' },
  wordjumble: { path: 'apps/games/BENNYSWORDJUMBLE', file: 'editor.html' },
  jumble: { path: 'apps/games/BENNYSWORDJUMBLE', file: 'editor.html' },
  phraseboard: { path: 'apps/tools/phraseboard', file: 'phrase-builder.html' },
  phrase: { path: 'apps/tools/phraseboard', file: 'phrase-builder.html' },
  peggle: { path: 'apps/games/BENNYSPEGGLE', file: 'editor.html' },
};

// Find a free port
async function findFreePort(start = 8800, end = 8900) {
  const net = require('net');
  for (let port = start; port < end; port++) {
    const available = await new Promise((resolve) => {
      const tester = net.createServer()
        .once('error', () => resolve(false))
        .once('listening', () => {
          tester.close();
          resolve(true);
        })
        .listen(port, '127.0.0.1');
    });
    if (available) return port;
  }
  return null;
}

// Start the editor server (if not already running)
async function startEditorServer() {
  if (editorServerProcess && editorServerPort) {
    // Check if server is still responding
    const net = require('net');
    const isRunning = await new Promise((resolve) => {
      const client = net.createConnection({ port: editorServerPort, host: '127.0.0.1' }, () => {
        client.end();
        resolve(true);
      });
      client.on('error', () => resolve(false));
    });
    
    if (isRunning) {
      console.log(`[EDITOR-SERVER] Already running on port ${editorServerPort}`);
      return editorServerPort;
    }
  }
  
  // Find a free port
  editorServerPort = await findFreePort();
  if (!editorServerPort) {
    console.error('[EDITOR-SERVER] Could not find a free port');
    return null;
  }
  
  // Start the Python server
  if (fs.existsSync(EDITOR_SERVER_SCRIPT)) {
    editorServerProcess = spawn('python', [EDITOR_SERVER_SCRIPT, '--port', editorServerPort.toString(), '--no-browser'], {
      cwd: path.dirname(EDITOR_SERVER_SCRIPT),
      detached: false,
      stdio: 'pipe',
      windowsHide: true
    });
    
    editorServerProcess.on('error', (err) => {
      console.error('[EDITOR-SERVER] Error:', err);
    });
    
    editorServerProcess.stdout.on('data', (data) => {
      console.log(`[EDITOR-SERVER] ${data}`);
    });
    
    editorServerProcess.stderr.on('data', (data) => {
      console.log(`[EDITOR-SERVER] ${data}`);
    });
    
    // Wait for server to start
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log(`[EDITOR-SERVER] Started on port ${editorServerPort}`);
    return editorServerPort;
  }
  
  console.error('[EDITOR-SERVER] Script not found:', EDITOR_SERVER_SCRIPT);
  return null;
}

// Launch an editor in Chrome
ipcMain.handle('launch:editor', async (event, editorName) => {
  try {
    const name = editorName.toLowerCase();
    const editorInfo = EDITOR_PATHS[name];
    
    if (!editorInfo) {
      return { success: false, error: `Unknown editor: ${editorName}` };
    }
    
    // Start the editor server
    const port = await startEditorServer();
    if (!port) {
      return { success: false, error: 'Could not start editor server' };
    }
    
    // Build the URL
    const url = `http://127.0.0.1:${port}/${editorInfo.path}/${editorInfo.file}`;
    console.log(`[EDITOR] Opening ${editorName} at ${url}`);
    
    // Launch Chrome in app mode - creates a clean, consistent window for all editors
    // --app= creates a window without address bar/tabs, like a standalone app
    // --window-size sets a reasonable default size
    const args = ['--app=' + url, '--window-size=1400,900'];
    const chromeProcess = spawn(CHROME_PATH, args, {
      detached: true,
      stdio: 'ignore'
    });
    chromeProcess.unref();
    
    // Don't minimize - let Chrome open on top naturally
    // User can Alt+Tab between them as needed
    
    return { success: true, url };
  } catch (e) {
    console.error('[EDITOR] Launch error:', e);
    return { success: false, error: e.message };
  }
});

// Get list of available editors
ipcMain.handle('editor:list', async () => {
  return Object.keys(EDITOR_PATHS).filter((key, idx, arr) => {
    // Remove aliases (entries where the path matches a previous entry)
    const info = EDITOR_PATHS[key];
    const firstMatch = arr.find(k => EDITOR_PATHS[k].path === info.path && EDITOR_PATHS[k].file === info.file);
    return firstMatch === key;
  });
});

// YouTube Search server launcher - starts a localhost server for YouTube embed to work
ipcMain.handle('launch:ytsearch-server', async () => {
  try {
    // Check if server is already running by checking if port 3000 is in use
    const net = require('net');
    const portInUse = await new Promise((resolve) => {
      const tester = net.createServer()
        .once('error', () => resolve(true))
        .once('listening', () => {
          tester.close();
          resolve(false);
        })
        .listen(3001, '127.0.0.1');
    });
    
    if (portInUse) {
      console.log('[YTSEARCH] Server already running on port 3001');
      return { success: true, url: 'http://localhost:3001' };
    }
    
    if (fs.existsSync(YTSEARCH_SERVER_SCRIPT)) {
      ytsearchServerProcess = spawn('python', [YTSEARCH_SERVER_SCRIPT], {
        cwd: path.dirname(YTSEARCH_SERVER_SCRIPT),
        detached: false,
        stdio: 'ignore',
        windowsHide: true
      });
      
      console.log('[YTSEARCH] Server started on port 3001');
      
      // Wait a moment for the server to start
      await new Promise(resolve => setTimeout(resolve, 500));
      
      return { success: true, url: 'http://localhost:3001' };
    }
    return { success: false, error: 'YTSearch server script not found' };
  } catch (e) {
    console.error('[YTSEARCH] Server launch error:', e);
    return { success: false, error: e.message };
  }
});

// ============ WINDOW CONTROL ============

ipcMain.handle('window:focus', async () => {
  if (mainWindow) {
    mainWindow.restore();
    mainWindow.focus();
    mainWindow.setFullScreen(true);
  }
});

ipcMain.handle('window:minimize', async () => {
  if (mainWindow) {
    mainWindow.minimize();
  }
});

ipcMain.handle('window:close', async () => {
  if (mainWindow) {
    mainWindow.close();
  }
});

ipcMain.handle('window:toggleFullscreen', async () => {
  if (mainWindow) {
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
  }
});

// ============ GAMES SYNC ============
// Games are sourced live from bennyshub.com (github.com/NARBEHOUSE/Narbehouse.github.io)
// so a single copy of each game's code lives in one place. This downloads an offline
// copy into bennyshub/apps/games/ so games still work without an internet connection.
// See README "Games" section for the full picture.
const GAMES_REPO_OWNER = 'NARBEHOUSE';
const GAMES_REPO_NAME = 'Narbehouse.github.io';
const GAMES_REPO_BRANCH = 'main';
const GAMES_REPO_PATH_PREFIX = 'bennyshub/apps/games/';
const GAMES_DIR = path.join(BENNYSHUB_DIR, 'apps', 'games');
const GAMES_SYNC_META_PATH = path.join(GAMES_DIR, '.sync-meta.json');

async function githubFetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'bennys-hub-games-sync' } });
  if (!res.ok) throw new Error(`GitHub API request failed: ${res.status} ${res.statusText}`);
  return res.json();
}

async function downloadGameFile(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, buffer);
}

// Downloads every file under bennyshub/apps/games/ from the live site into the local
// cache, or just one game's folder when `gameId` is given (matches the folder name,
// e.g. "BENNYSFOOTBALL"). Reports progress via 'games:sync-progress' on mainWindow.
ipcMain.handle('games:sync', async (event, gameId) => {
  try {
    const treeUrl = `https://api.github.com/repos/${GAMES_REPO_OWNER}/${GAMES_REPO_NAME}/git/trees/${GAMES_REPO_BRANCH}?recursive=1`;
    const tree = await githubFetchJson(treeUrl);
    if (!tree.tree) throw new Error('Unexpected response from GitHub tree API');

    let files = tree.tree.filter(
      (entry) => entry.type === 'blob' && entry.path.startsWith(GAMES_REPO_PATH_PREFIX)
    );

    if (gameId) {
      const folderPrefix = `${GAMES_REPO_PATH_PREFIX}${gameId}/`;
      files = files.filter((entry) => entry.path.startsWith(folderPrefix));
      if (files.length === 0) {
        return { success: false, error: `No files found for game "${gameId}"` };
      }
    }

    const total = files.length;
    let done = 0;

    for (const entry of files) {
      const relativePath = entry.path.slice(GAMES_REPO_PATH_PREFIX.length);
      const destPath = path.join(GAMES_DIR, relativePath);
      const rawUrl = `https://raw.githubusercontent.com/${GAMES_REPO_OWNER}/${GAMES_REPO_NAME}/${GAMES_REPO_BRANCH}/${entry.path}`;
      await downloadGameFile(rawUrl, destPath);
      done += 1;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('games:sync-progress', { done, total, current: relativePath });
      }
    }

    let meta = {};
    try { meta = JSON.parse(fs.readFileSync(GAMES_SYNC_META_PATH, 'utf8')); } catch (_) {}
    const now = new Date().toISOString();
    meta.games = meta.games || {};
    if (gameId) {
      meta.games[gameId] = now;
    } else {
      files.forEach((entry) => {
        const folder = entry.path.slice(GAMES_REPO_PATH_PREFIX.length).split('/')[0];
        if (folder) meta.games[folder] = now;
      });
      meta.allSyncedAt = now;
    }
    fs.writeFileSync(GAMES_SYNC_META_PATH, JSON.stringify(meta, null, 2), 'utf8');

    return { success: true, filesDownloaded: total };
  } catch (e) {
    console.error('[GAMES-SYNC] Failed:', e.message);
    return { success: false, error: e.message };
  }
});

// Reports which game folders are actually present on disk right now (covers
// both auto-synced games and ones a user manually dropped in themselves) -
// the renderer only trusts a local fallback path when it's in `onDisk`.
ipcMain.handle('games:get-sync-status', async () => {
  let meta = { allSyncedAt: null, games: {} };
  try {
    meta = JSON.parse(fs.readFileSync(GAMES_SYNC_META_PATH, 'utf8'));
  } catch (_) {}

  let onDisk = [];
  try {
    onDisk = fs.readdirSync(GAMES_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch (_) {}

  return { allSyncedAt: meta.allSyncedAt || null, games: meta.games || {}, onDisk };
});

// ============ UTILITY ============

// Get the local server URL for loading apps
ipcMain.handle('getServerUrl', async () => {
  if (hubServer && hubServerPort) {
    return `http://127.0.0.1:${hubServerPort}/`;
  }
  return null;
});

ipcMain.handle('app:getPath', async (event, name) => {
  return app.getPath(name);
});

ipcMain.handle('shell:openExternal', async (event, url) => {
  await shell.openExternal(url);
});

// ── Direct AI call via IPC (bypasses HTTP proxy, works from any BrowserWindow) ──
ipcMain.handle('ai:call', async (event, { url, headers, body }) => {
  const https = require('https');
  return new Promise((resolve) => {
    try {
      if (!url || !url.startsWith('https://')) {
        resolve({ ok: false, error: 'Invalid target URL' });
        return;
      }
      const parsedUrl = new URL(url);
      const bodyBuf = Buffer.from(body || '');
      const options = {
        hostname: parsedUrl.hostname,
        port: 443,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'POST',
        headers: { ...headers, 'Content-Length': bodyBuf.length }
      };
      const req = https.request(options, (res) => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          try {
            const data = JSON.parse(text);
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve({ ok: true, data });
            } else {
              const msg = typeof data?.error === 'string' ? data.error : (data?.error?.message || data?.message || res.statusMessage);
              resolve({ ok: false, error: msg, status: res.statusCode });
            }
          } catch {
            resolve({ ok: false, error: 'Invalid JSON from API', raw: text.slice(0, 200) });
          }
        });
      });
      req.on('error', (err) => resolve({ ok: false, error: err.message }));
      // AI image responses can be ~1.4MB of base64 and slow providers can
      // simply never answer — without this, the renderer's `await` hangs
      // forever with no way back for the user (see editor-ai.js's post()).
      req.setTimeout(45000, () => {
        req.destroy();
        resolve({ ok: false, error: 'The AI request timed out. Try again in a moment.' });
      });
      if (bodyBuf.length) req.write(bodyBuf);
      req.end();
    } catch (err) {
      resolve({ ok: false, error: err.message });
    }
  });
});

// ── Windows SAPI speech recognition ───────────────────────────────
ipcMain.handle('speech:start', async () => {
  startSpeechProcess();
  return { ok: true };
});

ipcMain.handle('speech:stop', async () => {
  stopSpeechProcess();
  return { ok: true };
});

// Open a tool as its own full-screen BrowserWindow (avoids iframe mic/API restrictions)
ipcMain.handle('launch:window', async (event, { id, path: toolPath, title }) => {
  if (toolWindows[id] && !toolWindows[id].isDestroyed()) {
    toolWindows[id].focus();
    return { ok: true };
  }
  const url = `http://127.0.0.1:${hubServerPort}/${toolPath.replace(/^\//, '')}`;
  const { BrowserWindow: BW } = require('electron');
  const win = new BW({
    width: mainWindow ? mainWindow.getBounds().width : 1920,
    height: mainWindow ? mainWindow.getBounds().height : 1080,
    fullscreen: true,
    frame: false,
    show: false,
    backgroundColor: '#1a1a2e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      sandbox: false
    }
  });
  // Grant all permissions (including microphone) for this window
  win.webContents.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(true));
  win.webContents.session.setPermissionCheckHandler(() => true);
  win.once('ready-to-show', () => { win.show(); win.moveTop(); win.focus(); });
  win.loadURL(url);
  toolWindows[id] = win;
  win.on('closed', () => { delete toolWindows[id]; });
  return { ok: true };
});

// Close the tool window that sent this IPC message
ipcMain.handle('toolWindow:close', async (event) => {
  const { BrowserWindow: BW } = require('electron');
  const win = BW.fromWebContents(event.sender);
  if (win && win !== mainWindow && !win.isDestroyed()) {
    win.close();
  }
  return { ok: true };
});

ipcMain.handle('news:fetchHighlights', async (event, payload) => {
  const localLabel = payload && typeof payload.localLabel === 'string' ? payload.localLabel : '';
  try {
    return await newsFetchHighlightsForDayHub(localLabel);
  } catch (e) {
    console.error('[NEWS]', e);
    return { ok: false, error: e.message || 'News fetch failed' };
  }
});

// Kill Chrome browsers (used when returning from streaming)
ipcMain.handle('chrome:close', async () => {
  return new Promise((resolve) => {
    exec('taskkill /F /IM chrome.exe', (error) => {
      resolve({ success: !error });
    });
  });
});

// Kill control bar
ipcMain.handle('controlBar:close', async () => {
  return new Promise((resolve) => {
    exec('taskkill /F /FI "WINDOWTITLE eq Control Bar*"', (error) => {
      // Also try to kill by Python script name
      exec('wmic process where "commandline like \'%control_bar.py%\'" delete', () => {
        resolve({ success: true });
      });
    });
  });
});

// ============ SYSTEM CONTROLS ============

// Volume control using PowerShell and nircmd
ipcMain.handle('system:volumeUp', async () => {
  return new Promise((resolve) => {
    // Use PowerShell to increase volume (5 increments for larger steps)
    exec('powershell -Command "$wsh = New-Object -ComObject WScript.Shell; for($i=0; $i -lt 5; $i++) { $wsh.SendKeys([char]175) }"', (error) => {
      if (error) {
        // Fallback: try nircmd if available (~25% increase = 16383)
        exec('nircmd.exe changesysvolume 16383', (err2) => {
          resolve({ success: !err2 });
        });
      } else {
        resolve({ success: true });
      }
    });
  });
});

ipcMain.handle('system:volumeDown', async () => {
  return new Promise((resolve) => {
    // Use PowerShell to decrease volume (5 increments for larger steps)
    exec('powershell -Command "$wsh = New-Object -ComObject WScript.Shell; for($i=0; $i -lt 5; $i++) { $wsh.SendKeys([char]174) }"', (error) => {
      if (error) {
        // Fallback: try nircmd if available (~25% decrease = -16383)
        exec('nircmd.exe changesysvolume -16383', (err2) => {
          resolve({ success: !err2 });
        });
      } else {
        resolve({ success: true });
      }
    });
  });
});

ipcMain.handle('system:volumeMute', async () => {
  return new Promise((resolve) => {
    exec('powershell -Command "(New-Object -ComObject WScript.Shell).SendKeys([char]173)"', (error) => {
      if (error) {
        exec('nircmd.exe mutesysvolume 2', (err2) => {
          resolve({ success: !err2 });
        });
      } else {
        resolve({ success: true });
      }
    });
  });
});

ipcMain.handle('system:volumeMax', async () => {
  return new Promise((resolve) => {
    // Set volume to 100% using PowerShell
    const ps = `
      $obj = New-Object -ComObject WScript.Shell
      # Press volume up many times to ensure max
      # Loop 50 times with a delay to ensure the system registers each keypress
      for ($i = 0; $i -lt 50; $i++) { $obj.SendKeys([char]175); Start-Sleep -Milliseconds 60 }
    `;
    exec(`powershell -Command "${ps.replace(/\n/g, '; ')}"`, (error) => {
      if (error) {
        exec('nircmd.exe setsysvolume 65535', (err2) => {
          resolve({ success: !err2 });
        });
      } else {
        resolve({ success: true });
      }
    });
  });
});

// Timer-based shutdown
ipcMain.handle('system:shutdownTimer', async (event, minutes) => {
  return new Promise((resolve) => {
    const seconds = minutes * 60;
    exec(`shutdown /s /t ${seconds}`, (error) => {
      resolve({ success: !error, error: error?.message });
    });
  });
});

// Cancel shutdown timer
ipcMain.handle('system:cancelShutdown', async () => {
  return new Promise((resolve) => {
    exec('shutdown /a', (error) => {
      resolve({ success: !error, error: error?.message });
    });
  });
});

// Restart computer
ipcMain.handle('system:restart', async () => {
  return new Promise((resolve) => {
    exec('shutdown /r /t 5', (error) => {
      resolve({ success: !error, error: error?.message });
    });
  });
});

// Shutdown computer immediately
ipcMain.handle('system:shutdown', async () => {
  return new Promise((resolve) => {
    exec('shutdown /s /t 5', (error) => {
      resolve({ success: !error, error: error?.message });
    });
  });
});

// Close app
ipcMain.handle('system:closeApp', async () => {
  // Kill tracked Python processes
  stopMessengerBackend();
  if (ytsearchServerProcess) {
    ytsearchServerProcess.kill();
    ytsearchServerProcess = null;
  }
  if (editorServerProcess) {
    editorServerProcess.kill();
    editorServerProcess = null;
  }
  
  // Close the hub server
  if (hubServer) {
    hubServer.close();
    hubServer = null;
  }
  
  // Force kill any remaining Python processes spawned by this app
  // This ensures DM listener and other background scripts are terminated
  try {
    exec('taskkill /F /IM python.exe', (error) => {
      if (error) {
        console.log('[CLOSE] No Python processes to kill or already terminated');
      } else {
        console.log('[CLOSE] Killed Python processes');
      }
      app.quit();
    });
  } catch (e) {
    console.error('[CLOSE] Error killing Python processes:', e);
    app.quit();
  }
  
  return { success: true };
});

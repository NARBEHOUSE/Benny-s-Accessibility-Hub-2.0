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
const MESSENGER_SCRIPT = path.join(APPS_DIR, 'messenger', 'ben_discord_app.py');
const SEARCH_SCRIPT = path.join(APPS_DIR, 'search', 'narbe_scan_browser.py');
const DM_LISTENER_SCRIPT = path.join(APPS_DIR, 'messenger', 'simple_dm_listener.py');
const CONTROL_BAR_SCRIPT = path.join(APPS_DIR, 'streaming', 'utils', 'control_bar.py');
const YTSEARCH_SERVER_SCRIPT = path.join(APPS_DIR, 'ytsearch', 'server.py');
const AI_BRIDGE_SCRIPT = path.join(APPS_DIR, 'ai-messenger', 'bridge.py');

// New HTML5 Electron messenger (replaces the old PySide6 ben_discord_app.py).
// Launched as its own Electron process; main.js spawns the python backend itself.
const MESSENGER_APP_MAIN = path.join(APPS_DIR, 'messenger', 'main.js');
const ELECTRON_BIN = path.join(__dirname, 'node_modules', 'electron', 'dist', 'electron.exe');

// Chrome path
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

// HARDWARE ACCELERATION - Enabled for WebGL games (Dice, Basketball, Bowling)
// Only disable if non-3D games are crashing
// app.disableHardwareAcceleration();
// app.commandLine.appendSwitch('disable-gpu');
// app.commandLine.appendSwitch('disable-software-rasterizer');

let mainWindow;
let dmListenerProcess = null;
let ytsearchServerProcess = null;
let hubServer = null;
let hubServerPort = 8765;
let speechProcess = null;
let speechBuffer = '';
let toolWindows = {};  // BrowserWindows opened for specific tools (e.g. rt-convo)

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
          res.writeHead(proxyRes.statusCode, {
            'Content-Type': proxyRes.headers['content-type'] || 'application/json',
            'Access-Control-Allow-Origin': '*'
          });
          res.end(Buffer.concat(chunks));
        });
      });
      proxyReq.on('error', (err) => {
        console.error('[AI-CALL] Error:', err.message);
        res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: err.message }));
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
      allowRunningInsecureContent: true
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
    // Clean up DM listener
    if (dmListenerProcess) {
      dmListenerProcess.kill();
    }
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
    // Don't modify headers for YouTube-related domains - let them handle their own CSP
    const youtubeUrls = ['youtube.com', 'ytimg.com', 'googlevideo.com', 'google.com', 'gstatic.com', 'ggpht.com'];
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
          "img-src 'self' data: blob: https: http://localhost:* http://127.0.0.1:*; " +
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com http://localhost:* http://127.0.0.1:*; " +
          "font-src 'self' data: https://fonts.gstatic.com; " +
          "worker-src 'self' blob:; " +
          "media-src 'self' data: blob: https://*.googlevideo.com https://*.youtube.com http://localhost:* http://127.0.0.1:*; " +
          "frame-src 'self' blob: https://www.youtube.com https://www.youtube-nocookie.com https://challenges.cloudflare.com http://localhost:* http://127.0.0.1:*;"
        ]
      }
    });
  });
  
  await createWindow();
  
  // Start DM listener in background
  startDMListener();
  
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
  if (dmListenerProcess) {
    dmListenerProcess.kill();
    dmListenerProcess = null;
  }
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

function startDMListener() {
  if (fs.existsSync(DM_LISTENER_SCRIPT)) {
    try {
      dmListenerProcess = spawn('python', [DM_LISTENER_SCRIPT], {
        cwd: path.dirname(DM_LISTENER_SCRIPT),
        stdio: 'ignore',
        detached: false,
        windowsHide: true
      });
      console.log('[DM-LISTENER] Started');
    } catch (e) {
      console.error('[DM-LISTENER] Failed to start:', e);
    }
  }
}

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
          if (mainWindow) {
            mainWindow.restore();
            mainWindow.focus();
            mainWindow.show();
            mainWindow.setFullScreen(true);  // Always restore fullscreen
            
            // Send navigation event to renderer
            mainWindow.webContents.send('nav-signal', signal);
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
      // Signal file doesn't exist or invalid JSON - that's fine
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

const NGRAM_LIMITS = { frequent_words: 3000, bigrams: 5000, trigrams: 2000 };

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
      // Don't minimize - let the messenger app take focus naturally
      // Electron stays fullscreen in the background
      return { success: true };
    }
    return { success: false, error: 'Messenger app not found' };
  } catch (e) {
    return { success: false, error: e.message };
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
      // Do NOT minimize Electron for search app, as requested
      // This allows it to stay in background and be restored more easily
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
  if (dmListenerProcess) {
    dmListenerProcess.kill();
    dmListenerProcess = null;
  }
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

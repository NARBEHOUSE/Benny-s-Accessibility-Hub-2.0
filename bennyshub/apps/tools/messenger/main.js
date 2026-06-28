// main.js — Electron entry point for Ben's Messenger (new HTML5 app).
//
// Spawns the headless Python backend (backend.py) and opens the fullscreen
// frontend window that talks to it over WebSocket.
//
// Env:
//   NEW_MSG_WS_PORT  WebSocket port (default 8777)
//   NEW_MSG_NO_BACKEND=1  skip spawning python (use an already-running backend)

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const APP_DIR = __dirname;
const WS_PORT = parseInt(process.env.NEW_MSG_WS_PORT || '8777', 10);
// Window title must stay stable so the external control bar (control_bar.py)
// can find and restore this window when the user closes Chrome.
const APP_WINDOW_TITLE = 'Ben — Discord Mirror';

let backendProc = null;
let win = null;

// Use the same interpreter as every other Python app in the hub: plain
// 'python' from the system PATH. This is what the DM listener, search, editor
// server and control bar all do, and it works on every machine. We deliberately
// do NOT use the project .venv — it lives in OneDrive and syncs to other
// machines where its base interpreter is missing, which made the redirector
// python.exe die with exit code 103.
function findPython() {
  return 'python';
}

function startBackend() {
  if (process.env.NEW_MSG_NO_BACKEND === '1') return;
  const py = findPython();
  const script = path.join(APP_DIR, 'backend.py');
  try {
    backendProc = spawn(py, [script], {
      cwd: APP_DIR,
      env: Object.assign({}, process.env, { NEW_MSG_WS_PORT: String(WS_PORT) }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    backendProc.stdout.on('data', (d) => process.stdout.write('[backend] ' + d));
    backendProc.stderr.on('data', (d) => process.stderr.write('[backend] ' + d));
    backendProc.on('exit', (code) => { console.log('[backend] exited with code', code); backendProc = null; });
  } catch (e) {
    console.error('Failed to start backend:', e);
  }
}

function stopBackend() {
  if (backendProc) {
    try { backendProc.kill(); } catch (_) {}
    backendProc = null;
  }
}

function createWindow() {
  // NEW_MSG_WINDOWED=1 runs a normal resizable window (for testing).
  const windowed = process.env.NEW_MSG_WINDOWED === '1';
  win = new BrowserWindow({
    fullscreen: !windowed,
    frame: windowed,
    alwaysOnTop: !windowed,
    width: windowed ? 1100 : undefined,
    height: windowed ? 800 : undefined,
    backgroundColor: '#0b0f14',
    title: APP_WINDOW_TITLE,
    webPreferences: {
      preload: path.join(APP_DIR, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  // Keep the window title fixed (control_bar.py looks it up by exact title).
  win.on('page-title-updated', (e) => { e.preventDefault(); });
  win.setTitle(APP_WINDOW_TITLE);
  win.loadFile(path.join(APP_DIR, 'index.html'));
  if (!windowed) win.setAlwaysOnTop(true, 'screen-saver');
}

app.whenReady().then(() => {
  startBackend();
  createWindow();
});

app.on('window-all-closed', () => { stopBackend(); app.quit(); });
app.on('before-quit', stopBackend);

ipcMain.handle('msg-read-file', (_, filePath) => {
  try { return fs.readFileSync(filePath, 'utf8'); } catch (_) { return null; }
});
ipcMain.handle('msg-write-file', (_, filePath, data) => {
  try {
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, data, 'utf8');
    fs.renameSync(tmp, filePath);
    return true;
  } catch (_) { return false; }
});

// Read-merge-write handler for predictive_ngrams.json.
// Accepts a delta (only the new entries from the current message) so it never
// overwrites changes made by the hub's keyboard app running in a separate
// Electron process.  Writes atomically via a temp file + rename.
ipcMain.handle('msg-update-ngrams', (_, filePath, delta) => {
  try {
    let data = { frequent_words: {}, bigrams: {}, trigrams: {} };
    try { data = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (_) {}
    if (!data.frequent_words) data.frequent_words = {};
    if (!data.bigrams)        data.bigrams        = {};
    if (!data.trigrams)       data.trigrams       = {};

    const ts = delta.timestamp || new Date().toISOString();
    function merge(target, src) {
      if (!src) return;
      for (const [k, v] of Object.entries(src)) {
        if (!target[k]) target[k] = { count: 0 };
        target[k].count += (v.count || 1);
        target[k].last_used = ts;
      }
    }
    merge(data.frequent_words, delta.frequent_words);
    merge(data.bigrams,        delta.bigrams);
    merge(data.trigrams,       delta.trigrams);

    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, filePath);
    return true;
  } catch (_) { return false; }
});

ipcMain.handle('msg-get-config', () => ({ appDir: APP_DIR, wsPort: WS_PORT }));
ipcMain.handle('msg-close', () => { stopBackend(); app.quit(); return true; });

// Open a video (e.g. YouTube) fullscreen in Chrome with the accessible control
// bar, mirroring the old PySide6 app. Embedded YouTube is unreliable from a
// local file:// origin, so we play it natively and give Ben a switch-friendly
// bar to close Chrome and return to the messenger. The actual Chrome launch +
// fullscreen + control bar sequence lives in play_video.py (proven timing).
const { shell } = require('electron');
ipcMain.handle('msg-open-video', (_, url) => {
  if (!url) return false;
  try {
    // Get the messenger out of the way so Chrome is visible.
    if (win) { try { win.setAlwaysOnTop(false); win.minimize(); } catch (_) {} }

    const launcher = path.join(APP_DIR, 'play_video.py');
    if (fs.existsSync(launcher)) {
      spawn(findPython(), [launcher, url, '--app-title', APP_WINDOW_TITLE],
        { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } else {
      try { shell.openExternal(url); } catch (_) {}
    }
    return true;
  } catch (e) {
    console.error('open-video failed:', e);
    return false;
  }
});

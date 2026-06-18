const { app, BrowserWindow, dialog, shell, ipcMain } = require('electron');
const { spawn } = require('child_process');
const http  = require('http');
const path  = require('path');

const PORT = 7471;
let win;
let server;

// ── Python backend ────────────────────────────────────────────────────────────
function portInUse() {
  return new Promise(resolve => {
    const req = http.get(`http://127.0.0.1:${PORT}/`, res => { res.resume(); resolve(true); });
    req.on('error', () => resolve(false));
    req.setTimeout(500, () => { req.destroy(); resolve(false); });
  });
}

async function startBackend() {
  if (await portInUse()) {
    console.log(`[main] port ${PORT} already in use — reusing existing server`);
    return;
  }
  let spawnCmd, spawnArgs, spawnCwd;
  if (app.isPackaged) {
    // Use the bundled server_launch.exe produced by PyInstaller
    spawnCmd = path.join(process.resourcesPath, 'server_dist', 'server_launch.exe');
    spawnArgs = [];
    spawnCwd  = path.join(process.resourcesPath, 'server_dist');
  } else {
    spawnCmd  = process.platform === 'win32' ? 'python' : 'python3';
    spawnArgs = ['-m', 'uvicorn', 'server:app', `--port=${PORT}`, '--log-level=warning'];
    spawnCwd  = __dirname;
  }
  server = spawn(spawnCmd, spawnArgs, {
    cwd: spawnCwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  server.stdout.on('data', d => process.stdout.write('[server] ' + d));
  server.stderr.on('data', d => process.stderr.write('[server] ' + d));
  server.on('error', err => {
    dialog.showErrorBox('Backend error',
      `Could not start Python server:\n${err.message}\n\n` +
      `Make sure Python is on PATH and run:\n  pip install -r requirements.txt`);
    app.quit();
  });
}

function killBackend() {
  if (!server) return;
  const pid = server.pid;
  // Destroy open pipes so Node stops tracking this child (prevents exit hang)
  try { server.stdout.destroy(); } catch (_) {}
  try { server.stderr.destroy(); } catch (_) {}
  server.unref();
  server = null;
  if (process.platform === 'win32') {
    const tk = spawn('taskkill', ['/pid', pid, '/f', '/t'], { windowsHide: true });
    tk.unref();
  } else {
    try { process.kill(pid, 'SIGTERM'); } catch (_) {}
  }
}

// Poll until the server responds (max 60 s)
function waitForServer() {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const check = () => {
      const req = http.get(`http://127.0.0.1:${PORT}/`, res => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (++attempts >= 60) return reject(new Error('Server did not start within 60 s'));
        setTimeout(check, 1000);
      });
      req.setTimeout(800, () => req.destroy());
    };
    check();
  });
}

// ── Window ────────────────────────────────────────────────────────────────────
async function createWindow() {
  await startBackend();

  // Show a splash while waiting
  const splash = new BrowserWindow({
    width: 380, height: 220,
    frame: false, alwaysOnTop: true, resizable: false,
    backgroundColor: '#0a0a0c',
    webPreferences: { nodeIntegration: false },
  });
  splash.loadFile(path.join(__dirname, 'assets', 'splash.html'));

  try {
    await waitForServer();
  } catch (err) {
    splash.close();
    dialog.showErrorBox('Failed to start', err.message);
    app.quit();
    return;
  }

  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    frame: false,          // frameless — top bar acts as drag region
    backgroundColor: '#0a0a0c',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  win.loadURL(`http://127.0.0.1:${PORT}/`);

  win.once('ready-to-show', () => {
    splash.close();
    win.show();
    // inject drag region + window controls CSS/JS after load
    win.webContents.insertCSS(`
      header.top { -webkit-app-region: drag; }
      header.top button,
      header.top input,
      header.top .meter,
      header.top .omnibox { -webkit-app-region: no-drag; }
      .win-controls {
        display: flex; align-items: center; gap: 6px;
        -webkit-app-region: no-drag; padding: 0 8px;
      }
      .win-btn {
        width: 12px; height: 12px; border-radius: 50%;
        border: none; cursor: pointer; outline: none;
      }
      .win-btn.close  { background: #ff5f57; }
      .win-btn.min    { background: #febc2e; }
      .win-btn.max    { background: #28c840; }
    `);
    win.webContents.executeJavaScript(`
      (function() {
        const ctrl = document.createElement('div');
        ctrl.className = 'win-controls';
        ctrl.innerHTML =
          '<button class="win-btn close"  title="Close">'    +
          '<button class="win-btn min"    title="Minimise">' +
          '<button class="win-btn max"    title="Maximise">';
        document.querySelector('header.top')?.prepend(ctrl);
        ctrl.querySelector('.close').onclick = () => window.electronAPI?.close();
        ctrl.querySelector('.min').onclick   = () => window.electronAPI?.minimize();
        ctrl.querySelector('.max').onclick   = () => window.electronAPI?.maximize();
      })();
    `);
  });

  win.on('closed', () => { win = null; });

  // Open external links in browser, not Electron
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// ── IPC (window controls from renderer) ──────────────────────────────────────
ipcMain.on('win:close',    () => win?.close());
ipcMain.on('win:minimize', () => win?.minimize());
ipcMain.on('win:maximize', () => win?.isMaximized() ? win.unmaximize() : win.maximize());

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  killBackend();
  app.exit(0);
});

app.on('before-quit', killBackend);

app.on('activate', () => {
  if (!win) createWindow();
});

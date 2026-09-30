// A closed parent console makes stdout a broken pipe. console.log then
// throws EPIPE and Electron shows an uncaught-exception dialog. Ignore
// only that write failure; any other stream error still throws.
function ignoreBrokenPipe(stream) {
  if (!stream || typeof stream.on !== 'function') return;
  stream.on('error', (err) => {
    if (err && err.code === 'EPIPE') return;
    throw err;
  });
}
ignoreBrokenPipe(process.stdout);
ignoreBrokenPipe(process.stderr);

console.log('Starting Brutus Desktop...');
console.log('App is ready, creating window...');
const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, shell, desktopCapturer, safeStorage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');
const { autoUpdater } = require('electron-updater');
const { clipLilBrutusToMascot } = require('./lil-brutus-shape');
const { createIntentStore, resolveDisplayMedia } = require('./displayMediaIntent');
const { createMonitoringController } = require('./monitoringController');

// Dev builds can run beside the installed app (which holds the single-instance
// lock on the shared userData folder) by pointing at their own profile.
if (!app.isPackaged && process.env.BRUTUS_USER_DATA) {
  app.setPath('userData', path.resolve(process.env.BRUTUS_USER_DATA));
}

const store = new Store();

// Fix GPU crash issues
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-software-rasterizer');
// DirectComposition ignores a window region, so the mascot's black plate
// stays painted. Without it, SetWindowRgn can drop that plate while the
// opaque character pixels still paint. A transparent BrowserWindow does not.
app.commandLine.appendSwitch('disable-direct-composition');

let mainWindow = null;
let overlayWindow = null;
let mascotWindow = null;
let overlayGesture = null;
let mascotGesture = null;
let mascotWanted = false;
let appIsQuitting = false;
let tray = null;
let overlayReady = false;
let quitAfterStop = false;
const captureIntents = createIntentStore();

// Paper chat decal (09/16/11): 168×95. The floating window matches that box.
const LIL_BRUTUS_W = 168;
const LIL_BRUTUS_H = 95;

// Helper to get icon path (returns null if doesn't exist)
function getIconPath(filename) {
  const iconPath = path.join(__dirname, '../assets', filename);
  return fs.existsSync(iconPath) ? iconPath : null;
}

// Create a simple colored placeholder icon
function createPlaceholderIcon() {
  const size = 16;
  const canvas = Buffer.alloc(size * size * 4);
  
  for (let i = 0; i < size * size; i++) {
    canvas[i * 4] = 255;     // R
    canvas[i * 4 + 1] = 80;  // G
    canvas[i * 4 + 2] = 80;  // B
    canvas[i * 4 + 3] = 255; // A
  }
  
  return nativeImage.createFromBuffer(canvas, { width: size, height: size });
}

// ==================== MAIN WINDOW (Web UI) ====================

function createMainWindow() {
  mainWindow = new BrowserWindow({
    // The web UI is a 1440x900 desktop design with a 224px sidebar. It draws no
    // title bar of its own, so the window uses native frame/chrome.
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    frame: true,
    backgroundColor: '#000000',
    icon: path.join(__dirname, '../assets/icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
      // webSecurity enabled (default) — backend CORS allows null origin from Electron
    }
  });

  // The desktop window is the app itself: the same screens as the web app,
  // shipped in renderer/app. It does not open the public website.
  mainWindow.loadFile(path.join(__dirname, '../renderer/app/index.html'));

  // https links (Stripe, downloads, target=_blank) leave the bundled UI.
  // Opening them in the system browser keeps this window on the local app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (typeof url === 'string' && url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (typeof url !== 'string' || url.startsWith('file:')) return;
    event.preventDefault();
    if (url.startsWith('https://')) shell.openExternal(url);
  });

  // DevTools keyboard shortcuts (F12 and Ctrl+Shift+I)
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' ||
        (input.control && input.shift && input.key === 'I')) {
      mainWindow.webContents.toggleDevTools();
    }
  });

  mainWindow.on('closed', () => {
    destroyLilBrutus();
    mainWindow = null;
  });

  mainWindow.on('hide', () => {
    concealLilBrutus();
  });

  mainWindow.on('show', () => {
    if (mascotWanted) showLilBrutus();
  });

  mainWindow.on('minimize', () => {
    // minimize to taskbar normally
  });
}

// Tray Settings opens the Settings page in the main window.
function openInAppSettings() {
  if (!mainWindow || mainWindow.isDestroyed()) createMainWindow();
  const win = mainWindow;
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  const reveal = () => {
    if (!win || win.isDestroyed()) return;
    win.webContents.executeJavaScript(
      "document.getElementById('nav-settings')?.click()"
    ).catch((err) => {
      console.error('[settings]', err?.message || err);
    });
  };
  const contents = win.webContents;
  if (contents.isLoading() || !contents.getURL()) {
    contents.once('did-finish-load', reveal);
  } else {
    reveal();
  }
}

// ==================== OVERLAY WINDOW (Live Coaching) ====================

function createOverlayWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  
  overlayWindow = new BrowserWindow({
    width: 380,
    height: 620,
    x: width - 400,
    y: 100,
    frame: false,
    backgroundColor: '#000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    movable: true,
    minimizable: false,
    maximizable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
      preload: path.join(__dirname, 'preload.js')
      // webSecurity enabled (default) — backend CORS allows null origin from Electron
    }
  });

  // Keeps the coaching panel out of screen shares and out of the screenshots
  // Brutus takes itself.
  overlayWindow.setContentProtection(true);
  overlayWindow.setMinimumSize(OVERLAY_MIN_W, OVERLAY_MIN_H);
  // Re-apply after the window is actually on screen. setOpacity before the
  // first show is ignored on Windows, which left every session fully opaque.
  overlayWindow.on('ready-to-show', () => {
    applyOverlayOpacity();
  });
  overlayWindow.on('show', () => {
    applyOverlayOpacity();
  });

  overlayWindow.webContents.on('did-start-loading', () => {
    overlayReady = false;
    endOverlayGesture();
  });
  overlayWindow.webContents.on('render-process-gone', (event, details) => {
    console.error('[overlay] renderer gone:', details && details.reason);
    overlayReady = false;
    endOverlayGesture();
    monitoring.onOverlayGone();
    // A dead renderer cannot be reused; the next Start builds a fresh overlay.
    const dead = overlayWindow;
    overlayWindow = null;
    if (dead && !dead.isDestroyed()) dead.destroy();
  });

  overlayWindow.loadFile(path.join(__dirname, '../renderer/overlay.html'));
  overlayWindow.setIgnoreMouseEvents(false);

  // Only what the overlay asked for right before this request is granted
  // (see displayMediaIntent.js). No intent, no capture.
  const carrierSourceId = overlayWindow.getMediaSourceId();
  overlayWindow.webContents.session.setDisplayMediaRequestHandler((request, callback) => {
    const intent = captureIntents.take();
    if (!intent) {
      callback({});
      return;
    }
    desktopCapturer.getSources({ types: ['screen', 'window'] }).then((sources) => {
      callback(resolveDisplayMedia(intent, sources, carrierSourceId));
    }).catch(() => {
      callback({});
    });
  }, { useSystemPicker: false });

  // DevTools keyboard shortcuts (F12 and Ctrl+Shift+I)
  overlayWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' ||
        (input.control && input.shift && input.key === 'I')) {
      overlayWindow.webContents.toggleDevTools();
    }
  });

  overlayWindow.on('minimize', () => {
    // Prevent minimizing — restore immediately
    overlayWindow.restore();
  });

  // Alt+F4 (or anything else closing the frameless overlay) must not drop a
  // live call: end it properly and keep the window around, hidden, for reuse.
  overlayWindow.on('close', (event) => {
    if (appIsQuitting) return;
    event.preventDefault();
    if (monitoring.needsStop()) {
      monitoring.requestStop({ reason: 'overlay-closed' }).finally(hideOverlay);
    } else {
      hideOverlay();
    }
  });

  overlayWindow.on('closed', () => {
    endOverlayGesture();
    overlayReady = false;
    overlayWindow = null;
  });

  applyOverlayOpacity();
}

function showOverlay() {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    createOverlayWindow();
  }
  applyOverlayOpacity();
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.show();
    overlayWindow.focus();
  }
}

function hideOverlay() {
  endOverlayGesture();
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.hide();
  }
}

// ==================== SYSTEM TRAY ====================

function createTray() {
  let trayIcon;
  
  try {
    const trayIconPath = getIconPath('tray-icon.png');
    if (trayIconPath) {
      trayIcon = nativeImage.createFromPath(trayIconPath);
      if (trayIcon.isEmpty()) {
        trayIcon = createPlaceholderIcon();
      }
    } else {
      trayIcon = createPlaceholderIcon();
    }
  } catch (e) {
    console.error('Failed to load tray icon:', e);
    trayIcon = createPlaceholderIcon();
  }
  
  tray = new Tray(trayIcon);
  
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open Brutus',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
        } else {
          createMainWindow();
        }
      }
    },
  ]);

  tray.setToolTip('Brutus AI - Sales Coach');
  tray.setContextMenu(contextMenu);
  updateTrayMenu();

  tray.on('click', () => {
    if (mainWindow) {
      mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
    } else {
      createMainWindow();
    }
  });
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) createMainWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function updateTrayMenu() {
  if (!tray) return;
  const current = monitoring.state();
  const template = [
    { label: 'Open Brutus', click: showMainWindow }
  ];
  if (current === 'live') {
    template.push({ label: 'Show Overlay', click: () => showOverlay() });
  }
  template.push(
    {
      label: current === 'live' ? 'Stop Monitoring' : current === 'stopping' ? 'Saving call…' : 'Start Monitoring',
      enabled: current !== 'stopping',
      click: () => {
        if (monitoring.state() === 'live') stopMonitoring();
        else startMonitoring();
      }
    },
    { label: 'Settings', click: () => openInAppSettings() },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  );
  tray.setContextMenu(Menu.buildFromTemplate(template));
}

// ==================== MONITORING CONTROL ====================

function readAuthToken() {
  return decryptToken(store.get('authToken')) ?? memoryToken;
}

// Used only when the overlay renderer died mid-call and cannot end its own
// session. Whatever audio already reached the server is kept.
async function endSessionFromMain(sessionId) {
  const token = readAuthToken();
  if (!token || !sessionId) return;
  const apiUrl = String(readSettings().apiUrl || 'https://api.brutusai.coach').replace(/\/+$/, '');
  try {
    await fetch(`${apiUrl}/live/end`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'X-Brutus-Client': 'brutus-desktop'
      },
      body: JSON.stringify({ sessionId })
    });
  } catch (err) {
    console.error('[monitoring] could not end session after overlay crash:', err?.message || err);
  }
}

function sendToMainWindow(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

const monitoring = createMonitoringController({
  showOverlay,
  sendToOverlay: (channel, payload) => {
    if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.webContents.send(channel, payload);
  },
  isOverlayReady: () => !!(overlayReady && overlayWindow && !overlayWindow.isDestroyed()),
  hasAuth: () => !!readAuthToken(),
  endSessionRemote: endSessionFromMain,
  onChange: (state) => {
    updateTrayMenu();
    sendToMainWindow(state === 'live' ? 'monitoring-started' : 'monitoring-stopped');
  },
  onFinished: (info) => {
    sendToMainWindow('monitoring-finished', info || {});
    showPendingUpdatePrompt();
  }
});

function startMonitoring() {
  const result = monitoring.start();
  if (!result.ok && result.reason === 'signed_out') {
    // Tray Start while signed out: bring up the window so they can log in.
    showMainWindow();
  }
  return result;
}

function stopMonitoring(reason) {
  return monitoring.requestStop({ reason: reason || 'user' });
}

// ==================== AUTH TOKEN ENCRYPTION ====================

// In-memory fallback for environments where OS-backed storage is unavailable.
// Survives for the process lifetime only — cleared on app quit or explicit logout.
let memoryToken = null;

function encryptToken(token) {
  if (!safeStorage.isEncryptionAvailable()) return null; // refuse to store plaintext on disk
  return safeStorage.encryptString(token).toString('base64');
}

function decryptToken(stored) {
  if (!safeStorage.isEncryptionAvailable()) return null;
  if (!stored) return null;
  try {
    return safeStorage.decryptString(Buffer.from(stored, 'base64'));
  } catch {
    // Corrupted or encrypted by a different key — force re-login
    store.delete('authToken');
    return null;
  }
}

// ==================== IPC HANDLERS ====================

ipcMain.handle('get-auth', () => {
  return {
    token: readAuthToken(),
    user: store.get('user')
  };
});

ipcMain.handle('set-auth', (event, { token, user }) => {
  const encrypted = encryptToken(token);
  if (encrypted === null) {
    // Secure storage unavailable — hold token in memory for this session only
    memoryToken = token;
    store.delete('authToken');
  } else {
    memoryToken = null;
    store.set('authToken', encrypted);
  }
  store.set('user', user);
  return true;
});

ipcMain.handle('clear-auth', async () => {
  // Normally the renderer already ended monitoring (end-monitoring) before
  // revoking its token; this covers any path that did not.
  if (monitoring.needsStop()) await monitoring.requestStop({ reason: 'signed-out' });
  memoryToken = null;
  store.delete('authToken');
  store.delete('user');
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.webContents.send('auth-cleared');
  return true;
});

ipcMain.handle('minimize-window', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.handle('close-window', () => {
  if (mainWindow) mainWindow.hide();
});

ipcMain.handle('quit-app', () => {
  app.quit();
});

ipcMain.handle('start-monitoring', () => {
  return startMonitoring();
});

// Returns as soon as the stop is requested. The overlay calls this for stops
// it starts itself, so it must never wait on its own completion.
ipcMain.handle('stop-monitoring', () => {
  stopMonitoring();
  return true;
});

// Ends monitoring and waits until the overlay has closed the session (or the
// timeout passes). Logout and account deletion call this before touching auth.
ipcMain.handle('end-monitoring', async (event, options) => {
  const opts = options && typeof options === 'object' ? options : {};
  const reason = typeof opts.reason === 'string' ? opts.reason : 'user';
  await monitoring.requestStop({ reason, mode: opts.mode === 'cancel' ? 'cancel' : 'end' });
  return true;
});

ipcMain.handle('is-monitoring', () => {
  return monitoring.isActive();
});

ipcMain.handle('get-monitoring-state', () => {
  return monitoring.state();
});

// Overlay handshake: its listeners exist, so a pending start can be delivered.
ipcMain.on('overlay-ready', (event) => {
  if (!overlaySender(event)) return;
  overlayReady = true;
  monitoring.overlayReady();
});

ipcMain.on('capture-state', (event, state) => {
  if (!overlaySender(event)) return;
  monitoring.onCaptureState(state);
});

ipcMain.on('overlay-stopped', (event, info) => {
  if (!overlaySender(event)) return;
  monitoring.onOverlayStopped(info && typeof info === 'object' ? info : {});
});

ipcMain.handle('set-capture-intent', (event, intent) => {
  if (!overlaySender(event)) return false;
  return captureIntents.set(intent);
});

ipcMain.handle('show-overlay', () => {
  if (overlayWindow) {
    overlayWindow.show();
    overlayWindow.focus();
  }
});

ipcMain.handle('get-overlay-bounds', () => {
  if (overlayWindow) {
    const bounds = overlayWindow.getBounds();
    return bounds;
  }
  return { x: 0, y: 0, width: 380, height: 620 };
});

const OVERLAY_MIN_W = 280;
const OVERLAY_MIN_H = 200;
const OVERLAY_EDGES = new Set(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']);

function clampOverlayOpacity(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0.95;
  return Math.min(1, Math.max(0.5, n));
}

function applyOverlayOpacity(value) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  const opacity = clampOverlayOpacity(
    value !== undefined ? value : readSettings().overlayOpacity
  );
  try {
    overlayWindow.setOpacity(opacity);
    // Layered windows (opacity < 1 on Windows) can drop mouse input.
    overlayWindow.setIgnoreMouseEvents(false);
  } catch (err) {
    console.error('[overlayOpacity]', err?.message || err);
  }
}

function clampOverlaySize(width, height) {
  let maxW = 2560;
  let maxH = 1600;
  try {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      const display = screen.getDisplayMatching(overlayWindow.getBounds());
      maxW = Math.max(OVERLAY_MIN_W, display.workAreaSize.width);
      maxH = Math.max(OVERLAY_MIN_H, display.workAreaSize.height);
    }
  } catch (_) { /* keep the fallback cap */ }
  return {
    width: Math.round(Math.min(maxW, Math.max(OVERLAY_MIN_W, Number(width) || OVERLAY_MIN_W))),
    height: Math.round(Math.min(maxH, Math.max(OVERLAY_MIN_H, Number(height) || OVERLAY_MIN_H)))
  };
}

function boundsFromEdge(originBounds, originCursor, point, edge) {
  const dx = point.x - originCursor.x;
  const dy = point.y - originCursor.y;
  let width = originBounds.width;
  let height = originBounds.height;
  if (edge.includes('e')) width += dx;
  if (edge.includes('w')) width -= dx;
  if (edge.includes('s')) height += dy;
  if (edge.includes('n')) height -= dy;
  const size = clampOverlaySize(width, height);
  const x = edge.includes('w')
    ? originBounds.x + (originBounds.width - size.width)
    : originBounds.x;
  const y = edge.includes('n')
    ? originBounds.y + (originBounds.height - size.height)
    : originBounds.y;
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: size.width,
    height: size.height
  };
}

function overlaySender(event) {
  return !!(overlayWindow && !overlayWindow.isDestroyed() && event.sender === overlayWindow.webContents);
}

function endOverlayGesture() {
  if (!overlayGesture) return;
  clearInterval(overlayGesture.timer);
  overlayGesture = null;
}

function tickOverlayGesture(session) {
  if (overlayGesture !== session) return;
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    endOverlayGesture();
    return;
  }
  let point;
  try {
    point = screen.getCursorScreenPoint();
  } catch (_) {
    return;
  }
  if (session.mode === 'move') {
    const x = Math.round(session.originBounds.x + (point.x - session.originCursor.x));
    const y = Math.round(session.originBounds.y + (point.y - session.originCursor.y));
    const current = overlayWindow.getBounds();
    if (current.x !== x || current.y !== y) {
      try { overlayWindow.setPosition(x, y, false); } catch (_) { endOverlayGesture(); }
    }
    return;
  }
  const next = boundsFromEdge(session.originBounds, session.originCursor, point, session.edge);
  const current = overlayWindow.getBounds();
  if (current.x === next.x && current.y === next.y && current.width === next.width && current.height === next.height) {
    return;
  }
  try { overlayWindow.setBounds(next, false); } catch (_) { endOverlayGesture(); }
}

function startOverlayGesture(mode, edge) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  endOverlayGesture();
  let originCursor;
  try {
    originCursor = screen.getCursorScreenPoint();
  } catch (_) {
    return;
  }
  const session = {
    mode,
    edge,
    originCursor,
    originBounds: overlayWindow.getBounds(),
    timer: null
  };
  session.timer = setInterval(() => tickOverlayGesture(session), 16);
  overlayGesture = session;
}

ipcMain.handle('move-overlay', (event, { x, y }) => {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  overlayWindow.setPosition(Math.round(x), Math.round(y), false);
});

ipcMain.handle('hide-overlay', () => {
  hideOverlay();
});

ipcMain.handle('resize-overlay', (event, { width, height, x, y }) => {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  const bounds = overlayWindow.getBounds();
  const size = clampOverlaySize(width, height);
  overlayWindow.setBounds({
    x: Number.isFinite(x) ? Math.round(x) : bounds.x,
    y: Number.isFinite(y) ? Math.round(y) : bounds.y,
    width: size.width,
    height: size.height
  }, false);
});

// Hardware acceleration is disabled, so -webkit-app-region drag never moves
// this frameless window. The overlay header/edges start a cursor follow that
// uses the same setPosition / setBounds path as move-overlay and resize-overlay.
ipcMain.on('overlay-gesture-begin', (event, payload) => {
  if (!overlaySender(event)) return;
  const mode = payload && payload.mode === 'resize' ? 'resize' : 'move';
  const requested = payload && typeof payload.edge === 'string' ? payload.edge : 'se';
  const edge = OVERLAY_EDGES.has(requested) ? requested : 'se';
  startOverlayGesture(mode, edge);
});

ipcMain.on('overlay-gesture-end', (event) => {
  if (!overlaySender(event)) return;
  endOverlayGesture();
});

// ==================== LIL BRUTUS (desktop mascot window) ====================
// Hardware acceleration is off, so -webkit-app-region drag does not move a
// frameless window. This follows the cursor the same way the overlay does.

function mainWindowSender(event) {
  return !!(mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents);
}

function mascotSender(event) {
  return !!(mascotWindow && !mascotWindow.isDestroyed() && event.sender === mascotWindow.webContents);
}

function defaultLilBrutusPosition() {
  let area = { x: 0, y: 0, width: 1280, height: 800 };
  try {
    const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
    const display = win ? screen.getDisplayMatching(win.getBounds()) : screen.getPrimaryDisplay();
    area = display.workArea;
  } catch (_) { /* keep the fallback */ }
  return {
    x: Math.round(area.x + area.width - LIL_BRUTUS_W - 28),
    y: Math.round(area.y + area.height - LIL_BRUTUS_H - 142)
  };
}

function savedLilBrutusPosition() {
  const pos = readSettings().lilBrutusPos;
  if (!pos || !Number.isFinite(Number(pos.x)) || !Number.isFinite(Number(pos.y))) {
    return defaultLilBrutusPosition();
  }
  const x = Math.round(Number(pos.x));
  const y = Math.round(Number(pos.y));
  let displays = [];
  try { displays = screen.getAllDisplays(); } catch (_) {}
  const visible = displays.some((d) => {
    const a = d.bounds;
    return x < a.x + a.width && x + LIL_BRUTUS_W > a.x &&
      y < a.y + a.height && y + LIL_BRUTUS_H > a.y;
  });
  if (!visible && displays.length) return defaultLilBrutusPosition();
  return { x, y };
}

function writeLilBrutusPos(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  const existing = readSettings();
  const next = { x: Math.round(x), y: Math.round(y) };
  const prev = existing.lilBrutusPos;
  if (prev && prev.x === next.x && prev.y === next.y) return;
  store.set('settings', { ...existing, lilBrutusPos: next });
}

function writeLilBrutusVisible(shown) {
  const existing = readSettings();
  const next = !!shown;
  if (existing.lilBrutusVisible === next) return;
  store.set('settings', { ...existing, lilBrutusVisible: next });
}

function returnFocusToMain() {
  if (appIsQuitting) return;
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible() || mainWindow.isMinimized()) return;
  try { mainWindow.focus(); } catch (_) {}
}

function endLilBrutusGesture(save) {
  const had = !!mascotGesture;
  if (mascotGesture) {
    clearInterval(mascotGesture.timer);
    mascotGesture = null;
  }
  if (save && had && mascotWindow && !mascotWindow.isDestroyed()) {
    try {
      const [x, y] = mascotWindow.getPosition();
      writeLilBrutusPos(x, y);
    } catch (_) {}
  }
  if (had) setImmediate(returnFocusToMain);
}

const LIL_FRAMES = new Set([
  'bust.png', 'laptop.png', 'notes.png', 'shadow.png',
  'lap-close.png', 'lap-stand.png', 'lap-behind.png',
  'notes-draw.png', 'fists-rise.png',
  'punch-jab.png', 'punch-cross.png'
]);
let lilBrutusFrameFile = 'bust.png';
let lilRoleplay = false;
let lilMonitoring = false;

function lilBrutusMascotPath() {
  const file = LIL_FRAMES.has(lilBrutusFrameFile) ? lilBrutusFrameFile : 'bust.png';
  return path.join(__dirname, '../renderer/app/mascot-frames', file);
}

function sendLilSession(kind) {
  if (!mascotWindow || mascotWindow.isDestroyed()) return;
  const on = kind === 'roleplay' ? lilRoleplay : lilMonitoring;
  mascotWindow.webContents.send('lil-brutus-session', { kind, on });
}

function replayLilSession() {
  if (lilRoleplay) sendLilSession('roleplay');
  else if (lilMonitoring) sendLilSession('monitoring');
}

// setPosition on Windows is setBounds(x, y, currentWidth, currentHeight).
// At 125% DPI that round-trip adds about a pixel per call, so a held drag
// grows him for as long as the mouse moves. Position changes pass the
// Paper size as literals and never write the live width or height back.
// Call this only while the user is dragging. Idle bob is a translateY
// inside the window and must not change this screen position.
function placeLilBrutus(x, y) {
  if (!mascotWindow || mascotWindow.isDestroyed()) return;
  mascotWindow.setContentBounds({
    x: Math.round(x),
    y: Math.round(y),
    width: LIL_BRUTUS_W,
    height: LIL_BRUTUS_H
  }, false);
}

function lockLilBrutusSize() {
  if (!mascotWindow || mascotWindow.isDestroyed()) return;
  mascotWindow.setResizable(false);
  mascotWindow.setMinimumSize(LIL_BRUTUS_W, LIL_BRUTUS_H);
  mascotWindow.setMaximumSize(LIL_BRUTUS_W, LIL_BRUTUS_H);
  mascotWindow.setContentSize(LIL_BRUTUS_W, LIL_BRUTUS_H, false);
}

function clipLilBrutusPlate() {
  if (!mascotWindow || mascotWindow.isDestroyed()) return;
  try {
    clipLilBrutusToMascot(mascotWindow, lilBrutusMascotPath());
  } catch (err) {
    console.error('[lil-brutus] clip failed', err?.message || err);
  }
}

function tickLilBrutusGesture(session) {
  if (mascotGesture !== session) return;
  if (!mascotWindow || mascotWindow.isDestroyed()) {
    endLilBrutusGesture(false);
    return;
  }
  let point;
  try {
    point = screen.getCursorScreenPoint();
  } catch (_) {
    return;
  }
  const x = Math.round(session.originX + (point.x - session.originCursor.x));
  const y = Math.round(session.originY + (point.y - session.originCursor.y));
  const current = mascotWindow.getContentBounds();
  if (current.x === x && current.y === y) return;
  try {
    placeLilBrutus(x, y);
  } catch (_) {
    endLilBrutusGesture(true);
  }
}

function startLilBrutusGesture() {
  if (!mascotWindow || mascotWindow.isDestroyed()) return;
  endLilBrutusGesture(true);
  let originCursor;
  try {
    originCursor = screen.getCursorScreenPoint();
  } catch (_) {
    return;
  }
  const origin = mascotWindow.getContentBounds();
  const session = {
    originCursor,
    originX: origin.x,
    originY: origin.y,
    timer: null
  };
  session.timer = setInterval(() => tickLilBrutusGesture(session), 16);
  mascotGesture = session;
}

function revealLilBrutus() {
  if (!mascotWanted) return;
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) {
    console.log('[lil-brutus] window not shown, main window hidden');
    return;
  }
  if (!mascotWindow || mascotWindow.isDestroyed()) return;
  try {
    // showInactive alone leaves this window under the focused main window
    // on Windows, so the click looks like it did nothing.
    if (!mascotWindow.isVisible()) mascotWindow.showInactive();
    mascotWindow.setAlwaysOnTop(true, 'screen-saver');
    mascotWindow.moveTop();
    lockLilBrutusSize();
    clipLilBrutusPlate();
    console.log('[lil-brutus] window shown', JSON.stringify(mascotWindow.getBounds()));
  } catch (err) {
    console.error('[lil-brutus] show failed', err?.message || err);
  }
}

function createLilBrutusWindow() {
  if (mascotWindow && !mascotWindow.isDestroyed()) return;
  const pos = savedLilBrutusPosition();
  try {
    // Opaque on purpose. Hardware acceleration is off, and a transparent
    // window is created but never paints, so the click looks like a no-op.
    mascotWindow = new BrowserWindow({
      width: LIL_BRUTUS_W,
      height: LIL_BRUTUS_H,
      x: pos.x,
      y: pos.y,
      useContentSize: true,
      frame: false,
      transparent: false,
      backgroundColor: '#000000',
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      closable: false,
      focusable: true,
      hasShadow: false,
      thickFrame: false,
      roundedCorners: false,
      show: false,
      acceptFirstMouse: true,
      title: 'Lil Brutus',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js')
      }
    });
  } catch (err) {
    console.error('[lil-brutus] create failed', err?.message || err);
    mascotWindow = null;
    return;
  }

  mascotWindow.setAlwaysOnTop(true, 'screen-saver');
  lockLilBrutusSize();
  // A resize edge must not change the Paper box. Drag never writes width
  // or height. A 1px DPI snap (95 -> 96 at 125%) is not growth; correcting
  // it on every resize event loops, so only a real size change is pulled back.
  let lockingLilBrutusSize = false;
  mascotWindow.on('will-resize', (event) => {
    event.preventDefault();
  });
  mascotWindow.on('resize', () => {
    if (lockingLilBrutusSize || !mascotWindow || mascotWindow.isDestroyed()) return;
    const [w, h] = mascotWindow.getContentSize();
    if (Math.abs(w - LIL_BRUTUS_W) <= 2 && Math.abs(h - LIL_BRUTUS_H) <= 2) return;
    lockingLilBrutusSize = true;
    try {
      lockLilBrutusSize();
      clipLilBrutusPlate();
    } finally {
      lockingLilBrutusSize = false;
    }
  });
  mascotWindow.once('ready-to-show', revealLilBrutus);
  mascotWindow.webContents.once('did-finish-load', () => {
    revealLilBrutus();
    replayLilSession();
  });
  mascotWindow.loadFile(path.join(__dirname, '../renderer/lil-brutus.html'));

  mascotWindow.on('closed', () => {
    endLilBrutusGesture(false);
    mascotWindow = null;
  });

  if (process.platform === 'win32') {
    try {
      // Button-up still arrives after SetCapture when the cursor leaves this
      // small window. Ending here keeps a fast flick from sticking to the cursor.
      mascotWindow.hookWindowMessage(0x0202, () => {
        try { endLilBrutusGesture(true); } catch (_) {}
      });
    } catch (_) {}
  }
}

function showLilBrutus() {
  mascotWanted = true;
  writeLilBrutusVisible(true);
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) {
    console.log('[lil-brutus] show deferred, main window hidden');
    return;
  }
  if (!mascotWindow || mascotWindow.isDestroyed()) {
    createLilBrutusWindow();
    return;
  }
  revealLilBrutus();
}

function hideLilBrutus() {
  mascotWanted = false;
  writeLilBrutusVisible(false);
  endLilBrutusGesture(true);
  if (mascotWindow && !mascotWindow.isDestroyed()) mascotWindow.hide();
}

function concealLilBrutus() {
  endLilBrutusGesture(true);
  if (mascotWindow && !mascotWindow.isDestroyed()) mascotWindow.hide();
}

function destroyLilBrutus() {
  endLilBrutusGesture(true);
  if (mascotWindow && !mascotWindow.isDestroyed()) {
    mascotWindow.destroy();
  }
  mascotWindow = null;
}

ipcMain.handle('set-lil-brutus-visible', (event, shown) => {
  const fromMain = mainWindowSender(event);
  console.log('[lil-brutus] toggle', !!shown, 'fromMain', fromMain);
  if (!fromMain) return false;
  if (shown) showLilBrutus();
  else hideLilBrutus();
  const live = mascotWindow && !mascotWindow.isDestroyed();
  console.log('[lil-brutus] toggle done', !!shown, 'visible', live ? mascotWindow.isVisible() : false);
  return true;
});

ipcMain.on('lil-brutus-gesture-begin', (event) => {
  if (!mascotSender(event)) return;
  startLilBrutusGesture();
});

ipcMain.on('lil-brutus-gesture-end', (event) => {
  if (!mascotSender(event)) return;
  endLilBrutusGesture(true);
});

ipcMain.on('lil-brutus-session', (event, session) => {
  if (!mainWindowSender(event) || !session) return;
  if (session.kind === 'roleplay') lilRoleplay = !!session.on;
  else if (session.kind === 'monitoring') lilMonitoring = !!session.on;
  else return;
  sendLilSession(session.kind);
});

ipcMain.on('lil-brutus-clip', (event, file) => {
  if (!mascotSender(event)) return;
  const name = LIL_FRAMES.has(file) ? file : 'bust.png';
  lilBrutusFrameFile = name;
  if (!mascotWindow || mascotWindow.isDestroyed()) return;
  try {
    clipLilBrutusToMascot(mascotWindow, lilBrutusMascotPath());
  } catch (err) {
    console.error('[lil-brutus] clip failed', err?.message || err);
  }
});

const SETTINGS_DEFAULTS = {
  apiUrl: 'https://api.brutusai.coach',
  autoStart: false,
  overlayOpacity: 0.95,
  whiteBackground: false
};

function applyAutoStart(enabled) {
  try {
    app.setLoginItemSettings({ openAtLogin: !!enabled });
  } catch (err) {
    console.error('[autoStart]', err?.message || err);
  }
}

function readSettings() {
  const stored = store.get('settings');
  if (!stored || typeof stored !== 'object') return { ...SETTINGS_DEFAULTS };
  // appUrl was saved by 1.4.0 and earlier. Nothing reads it now.
  const { appUrl, ...rest } = stored;
  return { ...SETTINGS_DEFAULTS, ...rest };
}

ipcMain.handle('get-settings', () => {
  return readSettings();
});

ipcMain.handle('set-settings', async (event, settings) => {
  const existing = readSettings();
  const patch = (settings && typeof settings === 'object') ? settings : {};
  const next = { ...existing, ...patch };
  if (Object.prototype.hasOwnProperty.call(patch, 'overlayOpacity')) {
    next.overlayOpacity = clampOverlayOpacity(patch.overlayOpacity);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'whiteBackground')) {
    next.whiteBackground = !!patch.whiteBackground;
  }
  if (typeof patch.apiUrl === 'string' && patch.apiUrl !== existing.apiUrl) {
    // Backend origin changed. End any live call against the old backend first
    // (it still holds the old token), then drop the token everywhere.
    if (monitoring.needsStop()) await monitoring.requestStop({ reason: 'api-url-changed' });
    memoryToken = null;
    store.delete('authToken');
    store.delete('user');
    if (mainWindow) mainWindow.webContents.send('auth-cleared');
    if (overlayWindow) overlayWindow.webContents.send('auth-cleared');
  }
  store.set('settings', next);
  if (Object.prototype.hasOwnProperty.call(patch, 'autoStart')) {
    applyAutoStart(next.autoStart);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'overlayOpacity')) {
    applyOverlayOpacity(next.overlayOpacity);
  }
  return true;
});

ipcMain.handle('open-dashboard', async () => {
  await shell.openExternal('https://app.brutusai.coach/index.html');
  return true;
});

ipcMain.handle('open-external', async (event, url) => {
  if (typeof url !== 'string' || !url.startsWith('https://')) {
    throw new Error('Only https:// URLs may be opened externally');
  }
  await shell.openExternal(url);
  return true;
});

ipcMain.handle('get-screen-sources', async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 180 }
    });
    // Serialize NativeImage thumbnails to data URLs for IPC transfer
    return sources.map(s => ({
      id: s.id,
      name: s.name,
      display_id: s.display_id,
      thumbnail: s.thumbnail.toDataURL()
    }));
  } catch (error) {
    console.error('[Main Process] Failed to get screen sources:', error.message);
    throw error;
  }
});

// ==================== AUTO UPDATE ====================
// Polls the GitHub Releases for this repo (configured in package.json build.publish)
// for a `latest.yml` with a newer version. Downloads silently in the background;
// prompts the user to restart when an update is ready. Skipped in dev (npm start)
// because the updater requires a packaged app.

let pendingUpdate = null;
let updatePromptOpen = false;

async function promptForUpdate(info) {
  if (updatePromptOpen) return;
  updatePromptOpen = true;
  try {
    const choice = await dialog.showMessageBox({
      type: 'info',
      title: 'Update ready',
      message: `Brutus AI ${info?.version || 'update'} has been downloaded.`,
      detail: 'Restart to install it now, or it installs the next time Brutus quits.',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1
    });
    if (choice.response !== 0) return;
    // A call may have started while the dialog was open.
    if (monitoring.needsStop()) await monitoring.requestStop({ reason: 'update' });
    autoUpdater.quitAndInstall();
  } finally {
    updatePromptOpen = false;
  }
}

function showPendingUpdatePrompt() {
  if (!pendingUpdate || monitoring.needsStop()) return;
  const info = pendingUpdate;
  pendingUpdate = null;
  promptForUpdate(info);
}

function setupAutoUpdate() {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('error', (err) => {
    console.error('[autoUpdater]', err?.message || err);
  });

  autoUpdater.on('update-available', (info) => {
    console.log('[autoUpdater] update available:', info?.version);
  });

  autoUpdater.on('update-downloaded', (info) => {
    // Never pop a dialog over a live call (it would show in a screen share).
    // Ask once the call is over; it also installs on the next normal quit.
    if (monitoring.needsStop()) {
      pendingUpdate = info || {};
      return;
    }
    promptForUpdate(info);
  });

  autoUpdater.checkForUpdatesAndNotify().catch((err) => {
    console.error('[autoUpdater] check failed:', err?.message || err);
  });
}

// ==================== APP LIFECYCLE ====================

app.whenReady().then(() => {
  // Left behind by 1.4.0 and earlier (cold-call/roleplay overlay modes).
  store.delete('sessionMode');
  applyAutoStart(readSettings().autoStart);
  createMainWindow();
  createTray();
  setupAutoUpdate();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // Keep running in tray
});

app.on('before-quit', (event) => {
  // Quitting mid-call ends the call properly first (final audio + /live/end),
  // then quits for real.
  if (!quitAfterStop && monitoring.needsStop()) {
    event.preventDefault();
    quitAfterStop = true;
    monitoring.requestStop({ reason: 'quit' }).finally(() => app.quit());
    return;
  }
  appIsQuitting = true;
  endOverlayGesture();
  endLilBrutusGesture(true);
  destroyLilBrutus();
});

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    } else {
      createMainWindow();
    }
  });
}

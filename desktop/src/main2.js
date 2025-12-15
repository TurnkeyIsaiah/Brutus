const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');

// Fix GPU issues on some Windows machines
app.disableHardwareAcceleration();

const store = new Store();

let mainWindow = null;
let overlayWindow = null;
let tray = null;
let isMonitoring = false;

function getIconPath(filename) {
  const iconPath = path.join(__dirname, '../assets', filename);
  return fs.existsSync(iconPath) ? iconPath : null;
}

function createPlaceholderIcon() {
  const size = 16;
  const canvas = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    canvas[i * 4] = 255;
    canvas[i * 4 + 1] = 80;
    canvas[i * 4 + 2] = 80;
    canvas[i * 4 + 3] = 255;
  }
  return nativeImage.createFromBuffer(canvas, { width: size, height: size });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 450,
    height: 600,
    resizable: false,
    frame: false,
    backgroundColor: '#0a0a12',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/main.html'));
  
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.on('minimize', (event) => {
    event.preventDefault();
    mainWindow.hide();
  });
}

function createOverlayWindow() {
  const { width } = screen.getPrimaryDisplay().workAreaSize;
  
  overlayWindow = new BrowserWindow({
    width: 380,
    height: 450,
    x: width - 400,
    y: 100,
    frame: false,
    backgroundColor: '#0a0a12',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  overlayWindow.loadFile(path.join(__dirname, '../renderer/overlay.html'));
  
  overlayWindow.on('closed', () => {
    overlayWindow = null;
    isMonitoring = false;
  });
}

function showOverlay() {
  if (!overlayWindow) {
    createOverlayWindow();
  } else {
    overlayWindow.show();
  }
}

function hideOverlay() {
  if (overlayWindow) {
    overlayWindow.hide();
  }
}

function createTray() {
  let trayIcon;
  try {
    const trayIconPath = getIconPath('tray-icon.png');
    if (trayIconPath) {
      trayIcon = nativeImage.createFromPath(trayIconPath);
      if (trayIcon.isEmpty()) trayIcon = createPlaceholderIcon();
    } else {
      trayIcon = createPlaceholderIcon();
    }
  } catch (e) {
    trayIcon = createPlaceholderIcon();
  }
  
  tray = new Tray(trayIcon);
  updateTrayMenu();
  tray.setToolTip('Brutus.ai - Sales Coach');
  
  tray.on('click', () => {
    if (mainWindow) {
      mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
    } else {
      createMainWindow();
    }
  });
}

function updateTrayMenu() {
  if (!tray) return;
  
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open Brutus',
      click: () => {
        if (mainWindow) mainWindow.show();
        else createMainWindow();
      }
    },
    {
      label: isMonitoring ? 'Stop Monitoring' : 'Start Monitoring',
      click: () => {
        isMonitoring ? stopMonitoring() : startMonitoring();
      }
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ]);
  
  tray.setContextMenu(contextMenu);
}

function startMonitoring() {
  isMonitoring = true;
  showOverlay();
  updateTrayMenu();
  if (overlayWindow) overlayWindow.webContents.send('monitoring-started');
}

function stopMonitoring() {
  isMonitoring = false;
  hideOverlay();
  updateTrayMenu();
  if (overlayWindow) overlayWindow.webContents.send('monitoring-stopped');
}

// IPC Handlers
ipcMain.handle('get-auth', () => ({
  token: store.get('authToken'),
  user: store.get('user')
}));

ipcMain.handle('set-auth', (event, { token, user }) => {
  store.set('authToken', token);
  store.set('user', user);
  return true;
});

ipcMain.handle('clear-auth', () => {
  store.delete('authToken');
  store.delete('user');
  return true;
});

ipcMain.handle('minimize-window', () => { if (mainWindow) mainWindow.minimize(); });
ipcMain.handle('close-window', () => { if (mainWindow) mainWindow.hide(); });
ipcMain.handle('quit-app', () => app.quit());
ipcMain.handle('start-monitoring', () => { startMonitoring(); return true; });
ipcMain.handle('stop-monitoring', () => { stopMonitoring(); return true; });
ipcMain.handle('is-monitoring', () => isMonitoring);

ipcMain.handle('get-settings', () => store.get('settings', {
  apiUrl: 'http://localhost:3001',
  autoStart: false,
  overlayOpacity: 0.95
}));

ipcMain.handle('set-settings', (event, settings) => {
  store.set('settings', settings);
  return true;
});

// App Lifecycle
app.whenReady().then(() => {
  createMainWindow();
  createTray();
});

app.on('window-all-closed', () => {});

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

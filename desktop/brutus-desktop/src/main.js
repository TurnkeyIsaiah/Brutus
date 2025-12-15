const { app, BrowserWindow, Tray, Menu, ipcMain, screen } = require('electron');
const path = require('path');
const Store = require('electron-store');

const store = new Store();

let mainWindow = null;
let overlayWindow = null;
let tray = null;
let isMonitoring = false;

// ==================== MAIN WINDOW (Login/Settings) ====================

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 450,
    height: 600,
    resizable: false,
    frame: false,
    transparent: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, '../assets/icon.png')
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/main.html'));
  
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Don't show in taskbar when minimized
  mainWindow.on('minimize', (event) => {
    event.preventDefault();
    mainWindow.hide();
  });
}

// ==================== OVERLAY WINDOW (Live Coaching) ====================

function createOverlayWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  
  overlayWindow = new BrowserWindow({
    width: 380,
    height: 450,
    x: width - 400,
    y: 100,
    frame: false,
    transparent: true,
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
  
  // Allow click-through when not hovering
  overlayWindow.setIgnoreMouseEvents(false);
  
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

// ==================== SYSTEM TRAY ====================

function createTray() {
  tray = new Tray(path.join(__dirname, '../assets/tray-icon.png'));
  
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
    {
      label: isMonitoring ? 'Stop Monitoring' : 'Start Monitoring',
      click: () => {
        if (isMonitoring) {
          stopMonitoring();
        } else {
          startMonitoring();
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.quit();
      }
    }
  ]);
  
  tray.setToolTip('Brutus.ai - Sales Coach');
  tray.setContextMenu(contextMenu);
  
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
        if (mainWindow) {
          mainWindow.show();
        } else {
          createMainWindow();
        }
      }
    },
    {
      label: isMonitoring ? '⏹ Stop Monitoring' : '▶ Start Monitoring',
      click: () => {
        if (isMonitoring) {
          stopMonitoring();
        } else {
          startMonitoring();
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.quit();
      }
    }
  ]);
  
  tray.setContextMenu(contextMenu);
}

// ==================== MONITORING CONTROL ====================

function startMonitoring() {
  isMonitoring = true;
  showOverlay();
  updateTrayMenu();
  
  // Notify overlay to start
  if (overlayWindow) {
    overlayWindow.webContents.send('monitoring-started');
  }
}

function stopMonitoring() {
  isMonitoring = false;
  hideOverlay();
  updateTrayMenu();
  
  // Notify overlay to stop
  if (overlayWindow) {
    overlayWindow.webContents.send('monitoring-stopped');
  }
}

// ==================== IPC HANDLERS ====================

// Auth
ipcMain.handle('get-auth', () => {
  return {
    token: store.get('authToken'),
    user: store.get('user')
  };
});

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

// Window controls
ipcMain.handle('minimize-window', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.handle('close-window', () => {
  if (mainWindow) mainWindow.hide();
});

ipcMain.handle('quit-app', () => {
  app.quit();
});

// Monitoring controls
ipcMain.handle('start-monitoring', () => {
  startMonitoring();
  return true;
});

ipcMain.handle('stop-monitoring', () => {
  stopMonitoring();
  return true;
});

ipcMain.handle('is-monitoring', () => {
  return isMonitoring;
});

// Overlay controls
ipcMain.handle('move-overlay', (event, { x, y }) => {
  if (overlayWindow) {
    overlayWindow.setPosition(x, y);
  }
});

ipcMain.handle('resize-overlay', (event, { width, height }) => {
  if (overlayWindow) {
    overlayWindow.setSize(width, height);
  }
});

// Settings
ipcMain.handle('get-settings', () => {
  return store.get('settings', {
    apiUrl: 'http://localhost:3001',
    autoStart: false,
    overlayOpacity: 0.95
  });
});

ipcMain.handle('set-settings', (event, settings) => {
  store.set('settings', settings);
  return true;
});

// ==================== APP LIFECYCLE ====================

app.whenReady().then(() => {
  createMainWindow();
  createTray();
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // Don't quit on macOS - keep in tray
  if (process.platform !== 'darwin') {
    // Actually, keep running in tray on all platforms
    // app.quit();
  }
});

// Prevent multiple instances
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

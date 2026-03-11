console.log('Starting Brutus Desktop...');
console.log('App is ready, creating window...');
const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, shell, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');

const store = new Store();

// Fix GPU crash issues
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-software-rasterizer');

let mainWindow = null;
let overlayWindow = null;
let tray = null;
let isMonitoring = false;
let selectedSourceId = null;

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

// ==================== MAIN WINDOW (Login/Settings) ====================

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
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: false  // Disable CORS for localhost API calls
    }
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/main.html'));

  // DevTools keyboard shortcuts (F12 and Ctrl+Shift+I)
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' ||
        (input.control && input.shift && input.key === 'I')) {
      mainWindow.webContents.toggleDevTools();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

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
    backgroundColor: '#0a0a12',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    minimizable: false,
    maximizable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: false  // Disable CORS for localhost API calls
    }
  });

  overlayWindow.loadFile(path.join(__dirname, '../renderer/overlay.html'));
  overlayWindow.setIgnoreMouseEvents(false);

  // Grant screen capture permission — uses user-selected source if set, else first screen
  overlayWindow.webContents.session.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen', 'window'] }).then((sources) => {
      let source;
      if (selectedSourceId) {
        source = sources.find(s => s.id === selectedSourceId) || sources[0];
        selectedSourceId = null; // reset after use
      } else {
        source = sources[0];
      }
      callback({ video: source, audio: 'loopback' });
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

  overlayWindow.on('hide', () => {
    // If monitoring is still active but the window got hidden (e.g. by Windows), re-show it
    if (isMonitoring) {
      overlayWindow.show();
    }
  });

  overlayWindow.on('minimize', () => {
    // Prevent minimizing — restore immediately
    overlayWindow.restore();
  });

  overlayWindow.on('closed', () => {
    overlayWindow = null;
    isMonitoring = false;
    if (mainWindow) mainWindow.webContents.send('monitoring-stopped');
    updateTrayMenu();
  });

  // Apply stored opacity
  const savedSettings = store.get('settings', { overlayOpacity: 0.95 });
  overlayWindow.setOpacity(savedSettings.overlayOpacity || 0.95);
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
    {
      label: 'Start Monitoring',
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
  
  tray.setContextMenu(contextMenu);
}

// ==================== MONITORING CONTROL ====================

function startMonitoring() {
  isMonitoring = true;
  showOverlay();
  updateTrayMenu();
  
  if (overlayWindow) {
    overlayWindow.webContents.send('monitoring-started');
  }
}

function stopMonitoring() {
  isMonitoring = false;
  hideOverlay();
  updateTrayMenu();

  if (overlayWindow) {
    overlayWindow.webContents.send('monitoring-stopped');
  }
  if (mainWindow) {
    mainWindow.webContents.send('monitoring-stopped');
  }
}

// ==================== IPC HANDLERS ====================

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
  return { x: 0, y: 0, width: 380, height: 450 };
});

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

ipcMain.handle('get-settings', () => {
  return store.get('settings', {
    apiUrl: 'https://api.brutusai.coach',
    autoStart: false,
    overlayOpacity: 0.95
  });
});

ipcMain.handle('set-settings', (event, settings) => {
  store.set('settings', settings);
  if (overlayWindow && settings.overlayOpacity !== undefined) {
    overlayWindow.setOpacity(settings.overlayOpacity);
  }
  return true;
});

ipcMain.handle('open-dashboard', async () => {
  await shell.openExternal('https://app.brutusai.coach/index.html');
  return true;
});

ipcMain.handle('open-external', async (event, url) => {
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

ipcMain.handle('set-selected-source', (event, sourceId) => {
  selectedSourceId = sourceId;
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
  // Keep running in tray
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
    }
  });
}

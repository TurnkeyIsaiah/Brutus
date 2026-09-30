// Loads desktop/src/main.js against fake `electron`, `electron-store` and
// `electron-updater` modules so its IPC handlers can be called directly.
'use strict';

const Module = require('module');
const path = require('path');

const MAIN_PATH = path.resolve(__dirname, '../../src/main.js');

function createFakes() {
  const handlers = new Map();
  const listeners = new Map();
  const appEvents = new Map();
  const windows = [];

  class FakeWebContents {
    constructor(win) {
      this.win = win;
      this.sent = [];
      this.events = new Map();
      this.session = { setDisplayMediaRequestHandler: (fn) => { fakes.displayHandler = fn; } };
    }
    send(channel, payload) { this.sent.push([channel, payload]); }
    on(name, fn) { this.events.set(name, fn); }
    once(name, fn) { this.events.set(name, fn); }
    setWindowOpenHandler(fn) { this.openHandler = fn; }
    isLoading() { return false; }
    getURL() { return 'file:///app/index.html'; }
    executeJavaScript() { return Promise.resolve(); }
    toggleDevTools() {}
  }

  class FakeBrowserWindow {
    constructor(options) {
      this.options = options;
      this.webContents = new FakeWebContents(this);
      this.events = new Map();
      this.destroyed = false;
      this.visible = false;
      this.contentProtection = false;
      windows.push(this);
    }
    loadFile(file) { this.file = file; }
    on(name, fn) { this.events.set(name, fn); }
    once(name, fn) { this.events.set(name, fn); }
    show() { this.visible = true; }
    hide() { this.visible = false; }
    focus() {}
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; }
    isVisible() { return this.visible; }
    isMinimized() { return false; }
    restore() {}
    setContentProtection(v) { this.contentProtection = v; }
    setMinimumSize() {}
    setIgnoreMouseEvents() {}
    setOpacity() {}
    getMediaSourceId() { return 'window:overlay:0'; }
    getBounds() { return { x: 0, y: 0, width: 380, height: 620 }; }
    static getAllWindows() { return windows.filter((w) => !w.destroyed); }
  }

  const fakes = {
    handlers,
    listeners,
    appEvents,
    windows,
    displayHandler: null,
    electron: {
      app: {
        isPackaged: false,
        setPath() {},
        getPath: () => '/tmp',
        disableHardwareAcceleration() {},
        commandLine: { appendSwitch() {} },
        whenReady: () => new Promise(() => {}),
        on: (name, fn) => appEvents.set(name, fn),
        requestSingleInstanceLock: () => true,
        quit() { fakes.quitCalls = (fakes.quitCalls || 0) + 1; },
        setLoginItemSettings() {}
      },
      BrowserWindow: FakeBrowserWindow,
      Tray: class { setToolTip() {} setContextMenu(menu) { fakes.trayMenu = menu; } on() {} },
      Menu: { buildFromTemplate: (template) => template },
      ipcMain: {
        handle: (channel, fn) => handlers.set(channel, fn),
        on: (channel, fn) => listeners.set(channel, fn)
      },
      screen: {
        getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
        getDisplayMatching: () => ({ workAreaSize: { width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
        getAllDisplays: () => [],
        getCursorScreenPoint: () => ({ x: 0, y: 0 })
      },
      nativeImage: { createFromPath: () => ({ isEmpty: () => true }), createFromBuffer: () => ({}) },
      shell: { openExternal: async (url) => { fakes.opened = url; } },
      desktopCapturer: {
        getSources: async () => [
          { id: 'screen:0:0', name: 'Screen', display_id: '1', thumbnail: { toDataURL: () => 'data:' } },
          { id: 'window:7:0', name: 'Zoom', display_id: '', thumbnail: { toDataURL: () => 'data:' } }
        ]
      },
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (s) => Buffer.from(`enc:${s}`),
        decryptString: (b) => Buffer.from(b).toString().replace(/^enc:/, '')
      },
      dialog: { showMessageBox: async () => ({ response: 1 }) }
    },
    storeData: new Map()
  };

  fakes.Store = class {
    get(key, fallback) { return fakes.storeData.has(key) ? fakes.storeData.get(key) : fallback; }
    set(key, value) { fakes.storeData.set(key, value); }
    delete(key) { fakes.storeData.delete(key); }
  };
  return fakes;
}

function loadMain() {
  const fakes = createFakes();
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return fakes.electron;
    if (request === 'electron-store') return fakes.Store;
    if (request === 'electron-updater') return { autoUpdater: { on() {}, checkForUpdatesAndNotify: async () => {} } };
    if (request === './lil-brutus-shape' && parent && parent.filename === MAIN_PATH) {
      return { clipLilBrutusToMascot() {} };
    }
    return originalLoad.apply(this, arguments);
  };
  const silence = console.log;
  console.log = () => {};
  try {
    delete require.cache[MAIN_PATH];
    require(MAIN_PATH);
  } finally {
    Module._load = originalLoad;
    console.log = silence;
  }

  fakes.invoke = (channel, sender, ...args) => {
    const fn = fakes.handlers.get(channel);
    if (!fn) throw new Error(`no handler for ${channel}`);
    return fn({ sender: sender || {} }, ...args);
  };
  fakes.emit = (channel, sender, ...args) => {
    const fn = fakes.listeners.get(channel);
    if (!fn) throw new Error(`no listener for ${channel}`);
    return fn({ sender: sender || {} }, ...args);
  };
  fakes.overlay = () => fakes.windows.find((w) => w.file && w.file.endsWith('overlay.html') && !w.destroyed);
  return fakes;
}

module.exports = { loadMain };

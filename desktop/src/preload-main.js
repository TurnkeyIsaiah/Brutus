// Bridge for the main window (renderer/app). Exposes only what that window uses.
// Sandboxed preloads cannot require local files, so each window's preload is
// self-contained.
const { contextBridge, ipcRenderer } = require('electron');

// The callback gets only the payload (never the IPC event); the return value
// unsubscribes.
function subscribe(channel, callback) {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

function readAppInfo() {
  const arg = process.argv.find((a) => a.startsWith('--brutus-app-info='));
  try {
    const info = JSON.parse(arg.slice('--brutus-app-info='.length));
    return Object.freeze({ packaged: info.packaged === true, version: String(info.version || '') });
  } catch (_) {
    return Object.freeze({ packaged: false, version: '' });
  }
}

contextBridge.exposeInMainWorld('brutus', {
  appInfo: readAppInfo(),

  getAuth: () => ipcRenderer.invoke('get-auth'),
  setAuth: (data) => ipcRenderer.invoke('set-auth', data),
  clearAuth: () => ipcRenderer.invoke('clear-auth'),

  startMonitoring: () => ipcRenderer.invoke('start-monitoring'),
  stopMonitoring: () => ipcRenderer.invoke('stop-monitoring'),
  endMonitoring: (options) => ipcRenderer.invoke('end-monitoring', options || {}),
  isMonitoring: () => ipcRenderer.invoke('is-monitoring'),
  getMonitoringState: () => ipcRenderer.invoke('get-monitoring-state'),
  onMonitoringStarted: (callback) => subscribe('monitoring-started', callback),
  onMonitoringStopped: (callback) => subscribe('monitoring-stopped', callback),
  onMonitoringFinished: (callback) => subscribe('monitoring-finished', callback),
  onAuthCleared: (callback) => subscribe('auth-cleared', callback),

  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSettings: (settings) => ipcRenderer.invoke('set-settings', settings),

  setLilBrutusVisible: (shown) => ipcRenderer.invoke('set-lil-brutus-visible', !!shown),
  setLilBrutusSession: (session) => ipcRenderer.send('lil-brutus-session', session || {}),

  openExternal: (url) => ipcRenderer.invoke('open-external', url)
});

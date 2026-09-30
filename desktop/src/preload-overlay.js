// Bridge for the live coaching overlay. Exposes only what that window uses.
const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('brutus', {
  getAuth: () => ipcRenderer.invoke('get-auth'),
  getSettings: () => ipcRenderer.invoke('get-settings'),

  getScreenSources: () => ipcRenderer.invoke('get-screen-sources'),
  setCaptureIntent: (intent) => ipcRenderer.invoke('set-capture-intent', intent),

  stopMonitoring: () => ipcRenderer.invoke('stop-monitoring'),
  onMonitoringStarted: (callback) => subscribe('monitoring-started', callback),
  onMonitoringStopped: (callback) => subscribe('monitoring-stopped', callback),
  overlayReady: () => ipcRenderer.send('overlay-ready'),
  reportCaptureState: (state) => ipcRenderer.send('capture-state', state || {}),
  overlayStopped: (info) => ipcRenderer.send('overlay-stopped', info || {}),

  hideOverlay: () => ipcRenderer.invoke('hide-overlay'),
  beginOverlayGesture: (mode, edge) => ipcRenderer.send('overlay-gesture-begin', { mode, edge }),
  endOverlayGesture: () => ipcRenderer.send('overlay-gesture-end')
});

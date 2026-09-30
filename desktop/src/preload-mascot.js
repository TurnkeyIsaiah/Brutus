// Bridge for the Lil Brutus window. Exposes only what that window uses.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('brutus', {
  beginLilBrutusGesture: () => ipcRenderer.send('lil-brutus-gesture-begin'),
  endLilBrutusGesture: () => ipcRenderer.send('lil-brutus-gesture-end'),
  clipLilBrutus: (file) => ipcRenderer.send('lil-brutus-clip', String(file || 'bust.png')),
  onLilBrutusSession: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, session) => callback(session);
    ipcRenderer.on('lil-brutus-session', listener);
    return () => ipcRenderer.removeListener('lil-brutus-session', listener);
  }
});

import { contextBridge, ipcRenderer } from 'electron';

// The renderer loads the ordinary web UI over http://localhost:8642, so this bridge is
// the only thing that distinguishes desktop mode from a browser tab.
contextBridge.exposeInMainWorld('viatorDesktop', {
  version: (): Promise<string> => ipcRenderer.invoke('viator:version'),

  /** Fires once an update has been downloaded. Returns an unsubscribe function. */
  onUpdateReady: (callback: (version: string) => void): (() => void) => {
    const listener = (_event: unknown, version: string) => callback(version);
    ipcRenderer.on('viator:update-ready', listener);
    return () => {
      ipcRenderer.removeListener('viator:update-ready', listener);
    };
  },
});

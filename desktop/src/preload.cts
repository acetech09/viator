import { contextBridge, ipcRenderer } from 'electron';

// The renderer loads the ordinary web UI over loopback, so this bridge is the only thing
// that distinguishes desktop mode from a browser tab.
contextBridge.exposeInMainWorld('viatorDesktop', {
  version: (): Promise<string> => ipcRenderer.invoke('viator:version'),

  /**
   * Open a URL in the user's default browser. Used for the EVE SSO login, which deliberately
   * does not run in this window — the callback comes back via the eveauth-viator:// protocol handler.
   * (`window.open` reaches the same place through setWindowOpenHandler, but going through an
   * explicit channel keeps the login flow from depending on that.)
   */
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('viator:open-external', url),

  /** Fires once an update has been downloaded. Returns an unsubscribe function. */
  onUpdateReady: (callback: (version: string) => void): (() => void) => {
    const listener = (_event: unknown, version: string) => callback(version);
    ipcRenderer.on('viator:update-ready', listener);
    return () => {
      ipcRenderer.removeListener('viator:update-ready', listener);
    };
  },
});

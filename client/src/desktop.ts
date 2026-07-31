/**
 * The bridge the Electron shell's preload script exposes. It is absent when the UI is
 * open in an ordinary browser, so every caller has to treat it as optional.
 */
export interface ViatorDesktop {
  version(): Promise<string>;
  /** Fires once an update has been downloaded. Returns an unsubscribe function. */
  onUpdateReady(callback: (version: string) => void): () => void;
}

declare global {
  interface Window {
    viatorDesktop?: ViatorDesktop;
  }
}

export function desktop(): ViatorDesktop | undefined {
  return window.viatorDesktop;
}

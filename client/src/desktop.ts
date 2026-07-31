/**
 * The bridge the Electron shell's preload script exposes. It is absent when the UI is
 * open in an ordinary browser, so every caller has to treat it as optional.
 */
export interface ViatorDesktop {
  version(): Promise<string>;
  /** Opens a URL in the user's default browser instead of this window (used for SSO login). */
  openExternal(url: string): Promise<void>;
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

/**
 * Open a URL outside the app. In the desktop shell that's the system browser; in a browser
 * it's a new tab. Either way the current page stays put, which the SSO flow relies on — it
 * keeps polling for the result while the user logs in elsewhere.
 */
export function openExternal(url: string): void {
  const bridge = desktop();
  if (bridge) void bridge.openExternal(url);
  else window.open(url, '_blank', 'noopener,noreferrer');
}

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Promise-based replacement for `window.confirm`.
 *
 * Native dialogs are not usable here: dismissing one leaves the Electron window's webContents
 * with its focus controller deactivated, so every text field in the app renders as if the
 * window were in the background (inactive grey selection, dead caret) until the user alt-tabs
 * away and back. Rendering the prompt inside the page avoids the native modal entirely — and
 * it matches the theme, which a Windows system dialog never did.
 *
 * `useConfirm()` returns a stable function, so it is safe in effect dependency lists.
 */

export interface ConfirmOptions {
  /** The question. Shown as the dialog body. */
  message: string;
  title?: string;
  confirmLabel?: string;
  /** Styles the confirm button as destructive. Every caller today is a delete, hence the default. */
  danger?: boolean;
}

type ConfirmFn = (options: ConfirmOptions | string) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn>(() => Promise.resolve(false));

export function useConfirm(): ConfirmFn {
  return useContext(ConfirmContext);
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<ConfirmOptions | null>(null);
  const resolveRef = useRef<((ok: boolean) => void) | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  const ask = useCallback<ConfirmFn>((options) => {
    const opts = typeof options === 'string' ? { message: options } : options;
    return new Promise<boolean>((resolve) => {
      // Asking again while one is open would otherwise strand the first promise forever.
      resolveRef.current?.(false);
      resolveRef.current = resolve;
      setPending(opts);
    });
  }, []);

  const settle = useCallback((ok: boolean) => {
    resolveRef.current?.(ok);
    resolveRef.current = null;
    setPending(null);
  }, []);

  // Escape cancels. Enter is deliberately NOT handled here: the confirm button is focused on
  // open, so the browser already activates it on Enter — and a window-level Enter handler
  // would fire *before* the click of a Cancel button the user had tabbed to, confirming an
  // action they were trying to back out of.
  useEffect(() => {
    if (!pending) return;
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') settle(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending, settle]);

  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      {pending && (
        <div className="modal-backdrop" onMouseDown={() => settle(false)}>
          <div
            className="modal confirm-modal"
            role="alertdialog"
            aria-modal="true"
            aria-label={pending.title ?? 'Confirm'}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <div style={{ fontWeight: 600 }}>{pending.title ?? 'Are you sure?'}</div>
            </div>
            <div className="modal-body confirm-message">{pending.message}</div>
            <div className="modal-foot">
              <button className="btn" onClick={() => settle(false)}>
                Cancel
              </button>
              <button
                ref={confirmRef}
                className={`btn ${pending.danger === false ? 'primary' : 'danger'}`}
                onClick={() => settle(true)}
              >
                {pending.confirmLabel ?? 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

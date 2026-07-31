import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { openExternal } from '../desktop';
import { useToast } from '../toast';

/** How often the waiting page asks the server whether the browser half finished. */
const POLL_MS = 1000;

/**
 * Starts an EVE SSO login in the user's **default browser** and waits for it to land.
 *
 * The login deliberately doesn't happen in this window: the browser has the user's password
 * manager and existing EVE session, and in the desktop app the callback returns through the
 * registered `eveauth-viator://` handler rather than a local HTTP port. Neither path can navigate
 * this page to a result, so it polls `/api/sso/status` for the outcome instead.
 */
export function AddCharacterButton({ hasApplication }: { hasApplication: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [starting, setStarting] = useState(false);
  /** The in-flight attempt's `state`, or null when we aren't waiting on one. */
  const [attempt, setAttempt] = useState<string | null>(null);

  useEffect(() => {
    if (!attempt) return;
    let live = true;

    const timer = window.setInterval(async () => {
      let res;
      try {
        res = await api.ssoStatus(attempt);
      } catch {
        return; // Transient failure (the server is busy, say) — keep waiting.
      }
      if (!live || res.status === 'pending') return;
      setAttempt(null);
      if (res.status === 'done') {
        toast(`${res.character.name} authorized`, 'success');
        void qc.invalidateQueries({ queryKey: ['characters'] });
      } else {
        toast(res.message, 'error');
      }
    }, POLL_MS);

    return () => {
      live = false;
      window.clearInterval(timer);
    };
    // `toast` and `qc` are stable (useCallback / React Query), so the poll isn't restarted
    // on every render — which would reset the interval and leave it never firing.
  }, [attempt, qc, toast]);

  async function start() {
    if (!hasApplication) {
      toast('No EVE application configured — add a Client ID first', 'error');
      return;
    }
    setStarting(true);
    try {
      const { state, url } = await api.ssoStart();
      openExternal(url);
      setAttempt(state);
    } catch (err) {
      const known = (err as Error).message === 'no_application';
      toast(known ? 'No EVE application configured — add a Client ID first' : 'Could not start the login', 'error');
    } finally {
      setStarting(false);
    }
  }

  if (attempt) {
    return (
      <div className="sso-waiting">
        <span className="spinner" aria-hidden="true" />
        <span className="muted">Waiting for the login in your browser…</span>
        <button className="btn small" onClick={() => setAttempt(null)}>
          Cancel
        </button>
      </div>
    );
  }

  return (
    <button className="btn" onClick={start} disabled={starting}>
      + Add character
    </button>
  );
}

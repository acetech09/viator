import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { useToast } from '../toast';

/**
 * The ESI asset pull, shared by the "Refresh assets" button (Existing stock tab) and the
 * once-per-session warm-up in `App`. ESI caches assets ~1h server-side, so `status` carries a
 * per-character cooldown the button counts down instead of firing a pointless refetch.
 */
export function useAssetRefresh() {
  const qc = useQueryClient();
  const toast = useToast();

  const characters = useQuery({ queryKey: ['characters'], queryFn: api.characters });
  const hasChars = (characters.data?.length ?? 0) > 0;

  const status = useQuery({
    queryKey: ['asset-status'],
    queryFn: api.assetStatus,
    enabled: hasChars,
    refetchInterval: 30_000,
  });

  const refresh = useMutation({
    mutationFn: api.refreshAssets,
    onSuccess: (rows) => {
      qc.setQueryData(['asset-status'], rows);
      qc.invalidateQueries({ queryKey: ['locations'] });
      qc.invalidateQueries({ queryKey: ['priced'] });
      const errs = rows.filter((r) => r.last_error);
      if (errs.length) toast(`Asset refresh: ${errs.length} character(s) failed`, 'error');
      else toast('Assets refreshed', 'success');
    },
    onError: (e: Error) => toast(`Asset refresh failed: ${e.message}`, 'error'),
  });

  const nextAllowed = Math.max(0, ...(status.data ?? []).map((s) => s.next_allowed_at ?? 0));
  const cooldown = useCountdown(nextAllowed);
  const allInCooldown = (status.data?.length ?? 0) > 0 && status.data!.every((s) => s.in_cooldown);

  return { hasChars, refresh, cooldown, allInCooldown };
}

/**
 * Module-level (not component state) so the warm-up runs once per app load: the button that
 * used to own this effect now lives in a tab that mounts and unmounts as the user navigates.
 */
let autoRefreshed = false;

/** Pull assets once on first load when a character is authorized. Call from `App` only. */
export function useAutoRefreshAssets(): void {
  const { hasChars, refresh } = useAssetRefresh();
  useEffect(() => {
    if (!hasChars || autoRefreshed) return;
    autoRefreshed = true;
    refresh.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasChars]);
}

function useCountdown(target: number): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (target <= now) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [target, now]);
  return Math.max(0, Math.ceil((target - now) / 1000));
}

export function fmtCooldown(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m${s.toString().padStart(2, '0')}s` : `${s}s`;
}

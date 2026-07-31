import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { NavLink, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { useToast } from '../toast';
import logoUrl from '../assets/logo.png';

export function TitleBar() {
  const loc = useLocation();
  const onLists = loc.pathname.startsWith('/lists');
  const onSettings = loc.pathname.startsWith('/settings');
  const toast = useToast();
  const qc = useQueryClient();

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

  // Auto-refresh assets once on first load when characters exist.
  useEffect(() => {
    if (hasChars && !refresh.isPending && refresh.isIdle) refresh.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasChars]);

  const nextAllowed = Math.max(0, ...(status.data ?? []).map((s) => s.next_allowed_at ?? 0));
  const cooldown = useCountdown(nextAllowed);
  const allInCooldown =
    (status.data?.length ?? 0) > 0 && status.data!.every((s) => s.in_cooldown);

  return (
    <div className="titlebar">
      <img className="logo" src={logoUrl} alt="Viator" />
      <span className="brand">VIATOR</span>
      <NavLink to="/lists" className={`tab ${onLists ? 'active' : ''}`}>
        Lists
      </NavLink>
      <NavLink to="/settings" className={`tab ${onSettings ? 'active' : ''}`}>
        Settings
      </NavLink>
      <span className="spacer" />
      {hasChars && (
        <button
          className="btn small"
          disabled={refresh.isPending || allInCooldown}
          onClick={() => refresh.mutate()}
          title="Pull the latest assets from ESI"
        >
          {refresh.isPending ? 'Refreshing…' : allInCooldown && cooldown > 0 ? `Assets (${fmtCooldown(cooldown)})` : 'Refresh assets'}
        </button>
      )}
    </div>
  );
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

function fmtCooldown(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m${s.toString().padStart(2, '0')}s` : `${s}s`;
}

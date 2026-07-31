import { fmtCooldown, useAssetRefresh } from '../../hooks/useAssetRefresh';
import { RefreshIcon } from '../ButtonIcons';

/**
 * "Refresh assets" — the manual ESI asset pull, at the top of the Existing stock tab (it feeds
 * both zones' API filter rows). Renders nothing until a character is authorized; while every
 * character is inside ESI's asset cache window it disables itself and counts the window down.
 */
export function RefreshAssetsButton() {
  const { hasChars, refresh, cooldown, allInCooldown } = useAssetRefresh();
  if (!hasChars) return null;

  const cooling = allInCooldown && cooldown > 0;
  return (
    <div className="row">
      <button
        className="btn ico-btn"
        disabled={refresh.isPending || allInCooldown}
        onClick={() => refresh.mutate()}
        title="Pull the latest assets from ESI"
      >
        <RefreshIcon />
        {refresh.isPending
          ? 'Refreshing…'
          : cooling
            ? `Refresh assets (${fmtCooldown(cooldown)})`
            : 'Refresh assets'}
      </button>
    </div>
  );
}

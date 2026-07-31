import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toMultibuy, type PricedList } from '@viator/shared';
import { api } from '../../api';
import { useToast } from '../../toast';
import { CopyIcon } from '../ButtonIcons';
import { EyeIcon } from '../EyeIcon';
import { CostVolume } from '../CostVolume';
import { FlatEditView } from './FlatEditView';
import { GroupedView } from './GroupedView';
import { MissingView, type HaulingCheck, type MissingRow } from './MissingView';
import { RollupView } from './RollupView';
import { ownedInView, type DeductView } from './shared';

type TopTab = 'edit' | 'purchase' | 'transport' | 'missing';
type PurchaseLayout = 'combined' | 'grouped';

// --- Collapsed-group persistence (per list, localStorage) -----------------------------------
function collapsedKey(listId: number) {
  return `viator:collapsed:${listId}`;
}
function readCollapsed(listId: number): Set<number> {
  try {
    const raw = localStorage.getItem(collapsedKey(listId));
    return new Set<number>(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set<number>();
  }
}

/**
 * The left "final list" panel: three top tabs (Edit always; Purchase/Transport appear once their
 * zone has a stock source) with a Multibuy-copy button at the strip's right edge, a filter box,
 * the active view (flat / rollup / per-group), and the bottom total bar. See client/CLAUDE.md
 * for the full behavior contract.
 *
 * `haulingCheck` (owned by ListDetailPage, set from the right panel's Hauling-check tab) spawns
 * a closable "Missing items" tab that diffs the pasted hauler cargo against the baseline view.
 */
export function ListTable({
  listId,
  haulingCheck,
  onClearHaulingCheck,
}: {
  listId: number;
  haulingCheck: HaulingCheck | null;
  onClearHaulingCheck: () => void;
}) {
  const toast = useToast();
  const [filter, setFilter] = useState('');
  const [topTab, setTopTab] = useState<TopTab>('purchase');
  const [purchaseLayout, setPurchaseLayout] = useState<PurchaseLayout>('combined');
  // Purchase view only: hide rows fully covered by existing stock (nothing left to buy).
  const [showOwned, setShowOwned] = useState(true);

  // Collapsed group/fit ids, persisted per list. Re-read when the list changes.
  const [collapsed, setCollapsed] = useState<Set<number>>(() => readCollapsed(listId));
  useEffect(() => setCollapsed(readCollapsed(listId)), [listId]);
  const toggleCollapse = (groupId: number) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      try {
        localStorage.setItem(collapsedKey(listId), JSON.stringify([...next]));
      } catch {
        /* ignore quota/availability errors — collapse is a convenience, not critical state */
      }
      return next;
    });

  const editable = topTab === 'edit';
  const deducting = topTab === 'purchase' || topTab === 'transport'; // both apply existing stock
  const view: DeductView = topTab === 'transport' ? 'transport' : 'purchase';

  const priced = useQuery<PricedList>({ queryKey: ['priced', listId], queryFn: () => api.pricedList(listId) });

  // Groupless = the list has no add-groups at all; its items are a single flat, ungrouped list.
  // In that state there are no group headers, no multipliers, and the Combined/Grouped split is
  // meaningless (a deducted view is always the flat rollup).
  const groupless = (priced.data?.groups.length ?? 0) === 0;
  const combined = deducting && (groupless || purchaseLayout === 'combined');

  // A deducted view earns a tab as soon as its zone has a stock *source* added — a complete filter
  // row (character + location) or a manual paste — regardless of whether it actually nets anything
  // out. Purchase view ← purchase-location sources; Transport view ← destination sources. (Same
  // query keys as ExistingStockTab, so these share its cache.)
  const purchaseFilters = useQuery({ queryKey: ['filters', listId, 'purchase'], queryFn: () => api.getFilters(listId, 'purchase') });
  const destFilters = useQuery({ queryKey: ['filters', listId, 'destination'], queryFn: () => api.getFilters(listId, 'destination') });
  const purchasePastes = useQuery({ queryKey: ['asset-pastes', listId, 'purchase'], queryFn: () => api.assetPastes(listId, 'purchase') });
  const destPastes = useQuery({ queryKey: ['asset-pastes', listId, 'destination'], queryFn: () => api.assetPastes(listId, 'destination') });

  const hasFilter = (rows: { character_id: number; location_id: number }[] | undefined) =>
    (rows ?? []).some((r) => r.character_id && r.location_id);
  const hasPurchaseStock = hasFilter(purchaseFilters.data) || (purchasePastes.data ?? []).length > 0;
  const hasDestinationStock = hasFilter(destFilters.data) || (destPastes.data ?? []).length > 0;

  // Hauling check → the "Missing items" tab: diff the pasted cargo against the baseline view —
  // Transport when it's available (destination stock is what matters for hauling), else Purchase,
  // else the raw list. Pasted names match rollup lines case-insensitively; pasted lines matching
  // nothing are surfaced separately (typos / extra cargo).
  const missing = useMemo(() => {
    if (!haulingCheck) return null;
    const baseline: DeductView | null = hasDestinationStock ? 'transport' : hasPurchaseStock ? 'purchase' : null;
    const loadedByName = new Map(haulingCheck.loaded.map((l) => [l.name.toLowerCase(), l.quantity]));
    const matched = new Set<string>();
    const rows: MissingRow[] = [];
    for (const it of priced.data?.items ?? []) {
      const key = it.name.toLowerCase();
      const loaded = loadedByName.get(key) ?? 0;
      if (loadedByName.has(key)) matched.add(key);
      const needed = Math.max(0, it.quantity - (baseline ? ownedInView(it, baseline) : 0));
      if (needed - loaded > 0) rows.push({ item: it, needed, loaded, missing: needed - loaded });
    }
    return {
      rows,
      unmatched: haulingCheck.loaded.filter((l) => !matched.has(l.name.toLowerCase())),
      baselineLabel:
        baseline === 'transport' ? 'Transport view' : baseline === 'purchase' ? 'Purchase view' : 'full list',
    };
  }, [haulingCheck, priced.data, hasPurchaseStock, hasDestinationStock]);

  // Every Check press bumps the token — spawn/focus the Missing items tab.
  useEffect(() => {
    if (haulingCheck) setTopTab('missing');
  }, [haulingCheck]);

  // Keep the active tab valid as sources appear/disappear, and pick a sensible default once the
  // source queries have loaded: Purchase if available, else Transport, else Edit. A manual Edit
  // choice always stays valid. Gate on the queries having resolved so the default isn't prematurely
  // knocked down to Edit before the sources are known.
  const sourcesLoaded =
    purchaseFilters.data !== undefined &&
    destFilters.data !== undefined &&
    purchasePastes.data !== undefined &&
    destPastes.data !== undefined;
  useEffect(() => {
    if (!sourcesLoaded) return;
    const ok =
      topTab === 'edit' ||
      (topTab === 'purchase' && hasPurchaseStock) ||
      (topTab === 'transport' && hasDestinationStock) ||
      (topTab === 'missing' && haulingCheck !== null);
    if (!ok) setTopTab(hasPurchaseStock ? 'purchase' : hasDestinationStock ? 'transport' : 'edit');
  }, [sourcesLoaded, hasPurchaseStock, hasDestinationStock, topTab, haulingCheck]);

  const filterText = filter.trim().toLowerCase();

  function copyBlock(lines: Array<{ name: string; quantity: number }>, label: string) {
    const block = toMultibuy(lines);
    if (!block) {
      toast('Nothing to copy', 'info');
      return;
    }
    navigator.clipboard.writeText(block).then(
      () => toast(`Copied ${label} in Multibuy format`, 'success'),
      () => toast('Clipboard blocked by browser', 'error'),
    );
  }

  // Bottom bar reflects the active tab. Purchase/Transport = the owned-deducted rollup for that
  // view; Edit = the raw aggregate of enabled groups (no stock applied — you're building, not
  // buying). Deducted totals are derived here since they differ per view.
  const bottom = useMemo(() => {
    const data = priced.data;
    if (topTab === 'missing') {
      const rows = missing?.rows ?? [];
      let total = 0;
      let totalVolume = 0;
      let hasUnpriced = false;
      for (const r of rows) {
        if (r.item.unit_price === null) hasUnpriced = true;
        else total += r.item.unit_price * r.missing;
        if (r.item.unit_volume !== null) totalVolume += r.item.unit_volume * r.missing;
      }
      return {
        total,
        totalVolume,
        hasUnpriced,
        copyLines: rows.map((r) => ({ name: r.item.name, quantity: r.missing })),
        copyLabel: 'missing items',
      };
    }
    if (editable) {
      const enabled = (data?.groups ?? []).filter((g) => g.enabled);
      if (enabled.length === 0) {
        // Groupless (or every group hidden): the raw item rollup, no stock deduction.
        const items = data?.items ?? [];
        let total = 0;
        let totalVolume = 0;
        let hasUnpriced = false;
        for (const it of items) {
          if (it.unit_price === null) hasUnpriced = true;
          else total += it.unit_price * it.quantity;
          if (it.unit_volume !== null) totalVolume += it.unit_volume * it.quantity;
        }
        return {
          total,
          totalVolume,
          hasUnpriced,
          copyLines: items.map((it) => ({ name: it.name, quantity: it.quantity })),
          copyLabel: 'whole list',
        };
      }
      const agg = new Map<number, { name: string; quantity: number }>();
      for (const g of enabled) {
        for (const it of g.items) {
          const cur = agg.get(it.type_id);
          if (cur) cur.quantity += it.quantity;
          else agg.set(it.type_id, { name: it.name, quantity: it.quantity });
        }
      }
      return {
        total: enabled.reduce((s, g) => s + g.subtotal, 0),
        totalVolume: enabled.reduce((s, g) => s + g.subtotal_volume, 0),
        hasUnpriced: enabled.some((g) => g.has_unpriced),
        copyLines: [...agg.values()],
        copyLabel: 'whole list',
      };
    }
    const items = data?.items ?? [];
    let total = 0;
    let totalVolume = 0;
    let hasUnpriced = false;
    for (const it of items) {
      const displayed = it.quantity - ownedInView(it, view);
      if (displayed <= 0) continue;
      if (it.unit_price === null) hasUnpriced = true;
      else total += it.unit_price * displayed;
      if (it.unit_volume !== null) totalVolume += it.unit_volume * displayed;
    }
    return {
      total,
      totalVolume,
      hasUnpriced,
      copyLines: items.map((it) => ({ name: it.name, quantity: it.quantity - ownedInView(it, view) })),
      copyLabel: 'whole list',
    };
  }, [priced.data, editable, view, topTab, missing]);

  return (
    <div className="panel">
      <div className="subtabs list-view-tabs">
        <button className={`tab ${topTab === 'edit' ? 'active' : ''}`} onClick={() => setTopTab('edit')}>
          Edit view
        </button>
        {hasPurchaseStock && (
          <button className={`tab ${topTab === 'purchase' ? 'active' : ''}`} onClick={() => setTopTab('purchase')}>
            Purchase view
          </button>
        )}
        {hasDestinationStock && (
          <button className={`tab ${topTab === 'transport' ? 'active' : ''}`} onClick={() => setTopTab('transport')}>
            Transport view
          </button>
        )}
        {haulingCheck && (
          <button className={`tab ${topTab === 'missing' ? 'active' : ''}`} onClick={() => setTopTab('missing')}>
            Missing items
            <span
              className="tab-close"
              title="Close the hauling check"
              onClick={(e) => {
                e.stopPropagation();
                onClearHaulingCheck();
              }}
            >
              ✕
            </span>
          </button>
        )}
        <button className="btn ico-btn copy-multibuy" onClick={() => copyBlock(bottom.copyLines, bottom.copyLabel)}>
          <CopyIcon />
          Copy (Multibuy)
        </button>
      </div>

      <div className="list-search-bar row" style={{ gap: 8 }}>
        <input
          type="text"
          placeholder="Filter this list…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ flex: 1 }}
        />
        {deducting && (
          <>
            {/* Combined vs Grouped only makes sense when the list actually has groups. */}
            {!groupless && (
              <div className="segmented" role="group" aria-label="Layout">
                <button
                  className={purchaseLayout === 'combined' ? 'active' : ''}
                  onClick={() => setPurchaseLayout('combined')}
                >
                  Combined
                </button>
                <button
                  className={purchaseLayout === 'grouped' ? 'active' : ''}
                  onClick={() => setPurchaseLayout('grouped')}
                >
                  Grouped
                </button>
              </div>
            )}
            <button
              className="btn small owned-toggle"
              title="Show or hide items already covered by your existing stock"
              onClick={() => setShowOwned((v) => !v)}
            >
              <EyeIcon open={showOwned} />
              {showOwned ? 'Hide owned items' : 'Show owned items'}
            </button>
          </>
        )}
      </div>

      <div className="list-scroll">
        {topTab === 'missing' ? (
          <MissingView
            rows={missing?.rows ?? []}
            unmatched={missing?.unmatched ?? []}
            baselineLabel={missing?.baselineLabel ?? 'list'}
            filterText={filterText}
          />
        ) : groupless && editable ? (
          <FlatEditView listId={listId} priced={priced.data} filterText={filterText} />
        ) : combined ? (
          <RollupView priced={priced.data} filterText={filterText} showOwned={showOwned} view={view} />
        ) : (
          <GroupedView
            listId={listId}
            priced={priced.data}
            filterText={filterText}
            editable={editable}
            showOwned={editable || showOwned}
            view={view}
            collapsed={collapsed}
            onToggleCollapse={toggleCollapse}
            onCopy={copyBlock}
          />
        )}
      </div>

      <div className="list-total-bar">
        <div className="row" style={{ gap: 8 }}>
          {bottom.hasUnpriced && <span className="muted">* some items unpriced</span>}
        </div>
        <div className="row" style={{ gap: 10 }}>
          <span className="muted">
            {editable
              ? 'List total'
              : topTab === 'missing'
                ? 'Missing total'
                : topTab === 'transport'
                  ? 'Transport total'
                  : 'Estimated total'}
          </span>
          <CostVolume isk={bottom.total} volume={bottom.totalVolume} size="lg" />
        </div>
      </div>
    </div>
  );
}

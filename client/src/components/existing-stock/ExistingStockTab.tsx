import { useState } from 'react';
import type { StockZone } from '@viator/shared';
import { ApiAssetSection } from './ApiAssetSection';
import { AssetPasteSection } from './AssetPasteSection';

/**
 * "Existing stock" subtab, split into two zones:
 *   - Purchase Location — netted out of the Purchase view only.
 *   - Destination — netted out of BOTH the Purchase and Transport views.
 * Each zone has its own API asset filter rows and its own collapsible manual-paste box.
 */
export function ExistingStockTab({ listId }: { listId: number }) {
  return (
    <div className="col" style={{ gap: 28 }}>
      <StockSection
        listId={listId}
        zone="purchase"
        title="Existing Stock at Purchase Location"
        tooltip="Select assets to exclude from the purchase view."
      />
      <StockSection
        listId={listId}
        zone="destination"
        title="Existing Stock at Destination"
        tooltip="Select assets to exclude from the purchase AND transport view."
      />
    </div>
  );
}

/** One zone: a heading (with hover tooltip), its API asset table, and a collapsible paste box. */
function StockSection({
  listId,
  zone,
  title,
  tooltip,
}: {
  listId: number;
  zone: StockZone;
  title: string;
  tooltip: string;
}) {
  // The manual-paste entry box is opened by the "Add manual paste filter" button in ApiAssetSection's
  // action row; AssetPasteSection renders the saved pastes (always) and the entry box (when open).
  const [pasteOpen, setPasteOpen] = useState(false);

  return (
    <section className="col" style={{ gap: 12 }}>
      <h3 style={{ margin: 0 }}>
        {title}
        <span className="info-tip" title={tooltip} aria-label={tooltip}>
          ⓘ
        </span>
      </h3>

      <ApiAssetSection listId={listId} zone={zone} onAddManualPaste={() => setPasteOpen(true)} />

      <AssetPasteSection
        listId={listId}
        zone={zone}
        open={pasteOpen}
        onClose={() => setPasteOpen(false)}
      />
    </section>
  );
}

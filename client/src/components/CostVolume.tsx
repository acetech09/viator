/**
 * Unified ISK + cargo-volume display used everywhere a cost and its volume are shown together.
 * Renders `<wallet> <num> ISK`  ⇥  `<cargo> <num> m³` — icon, space, formatted number, space,
 * unit label; the two halves separated by a tab-like gap and sharing one font/weight.
 *
 * Icons scale with the surrounding font-size (`height: 1em` in theme.css `.cv-ico`), so size is
 * driven purely by the container: `size="lg"` matches the list total (18px), the default small
 * size suits group/fit/add rows. `formatVolume` already yields "742 m³", so we only append " ISK".
 * Blank values (null/NaN → "—") drop the icon and unit.
 */
import { formatIsk, formatVolume } from '@viator/shared';
import walletUrl from '../assets/32px-Wallet.png';
import cargoUrl from '../assets/32px-Cargo.png';

const isBlank = (v: number | null | undefined) => v === null || v === undefined || Number.isNaN(v);

export function IskAmount({ value }: { value: number | null | undefined }) {
  if (isBlank(value)) return <span className="cv-amt">—</span>;
  return (
    <span className="cv-amt">
      <img className="cv-ico" src={walletUrl} alt="" aria-hidden />
      {formatIsk(value)} ISK
    </span>
  );
}

export function VolAmount({ value }: { value: number | null | undefined }) {
  if (isBlank(value)) return <span className="cv-amt">—</span>;
  return (
    <span className="cv-amt">
      <img className="cv-ico" src={cargoUrl} alt="" aria-hidden />
      {formatVolume(value)}
    </span>
  );
}

/** ISK amount + cargo volume as one tab-separated pair. `size="lg"` for the main list total. */
export function CostVolume({
  isk,
  volume,
  size = 'sm',
}: {
  isk: number | null | undefined;
  volume: number | null | undefined;
  size?: 'sm' | 'lg';
}) {
  return (
    <span className={`cost-volume${size === 'lg' ? ' cv-lg' : ''}`}>
      <IskAmount value={isk} />
      <VolAmount value={volume} />
    </span>
  );
}

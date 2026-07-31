import { describe, expect, it } from 'vitest';
import { packagedVolumeFor } from './packagedVolumes.js';

describe('packagedVolumeFor', () => {
  it('returns the packaged volume for a ship group', () => {
    expect(packagedVolumeFor(587, 25)).toBe(2500); // Rifter — Frigate
    expect(packagedVolumeFor(638, 27)).toBe(50000); // Raven — Battleship
    expect(packagedVolumeFor(620, 26)).toBe(10000); // Osprey — Cruiser
    expect(packagedVolumeFor(672, 31)).toBe(500); // Caldari Shuttle
  });

  it('applies the per-type override ahead of the group value', () => {
    // Group 941 (Industrial Command Ship) repackages to 500,000 for the Orca…
    expect(packagedVolumeFor(28606, 941)).toBe(500000);
    // …but the Porpoise in the same group is smaller.
    expect(packagedVolumeFor(42244, 941)).toBe(50000);
  });

  it('returns null for non-ship types (caller falls back to assembled volume)', () => {
    expect(packagedVolumeFor(34, 18)).toBeNull(); // Tritanium (Mineral)
    expect(packagedVolumeFor(2048, 60)).toBeNull(); // a module group
  });
});

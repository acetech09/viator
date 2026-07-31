import { describe, expect, it } from 'vitest';
import { parseFit } from './fitParser.js';

const LOKI = `[Loki, Bling Inside Link Logi]

Damage Control II
Dark Blood Reactor Control Unit
Dark Blood Reactor Control Unit

Republic Fleet Large Shield Extender
Republic Fleet Large Shield Extender
Federation Navy 100MN Afterburner

Loki Core - Immobility Drivers


Hornet EC-300 x10


Nanite Repair Paste x400
Mobile Depot x1`;

describe('parseFit', () => {
  it('extracts ship + fit name from the header', () => {
    const fit = parseFit(LOKI)!;
    expect(fit).not.toBeNull();
    expect(fit.shipName).toBe('Loki');
    expect(fit.fitName).toBe('Bling Inside Link Logi');
  });

  it('prepends the ship hull as the first line at qty 1', () => {
    const fit = parseFit(LOKI)!;
    expect(fit.lines[0]).toMatchObject({ name: 'Loki', quantity: 1 });
  });

  it('keeps repeated module lines separate (server merges them)', () => {
    const fit = parseFit(LOKI)!;
    const reactors = fit.lines.filter((l) => l.name === 'Dark Blood Reactor Control Unit');
    expect(reactors).toHaveLength(2);
    expect(reactors.every((l) => l.quantity === 1)).toBe(true);
  });

  it('honours x-suffixed quantities on charges/drones', () => {
    const fit = parseFit(LOKI)!;
    expect(fit.lines.find((l) => l.name === 'Hornet EC-300')?.quantity).toBe(10);
    expect(fit.lines.find((l) => l.name === 'Nanite Repair Paste')?.quantity).toBe(400);
    expect(fit.lines.find((l) => l.name === 'Mobile Depot')?.quantity).toBe(1);
  });

  it('preserves subsystem names with hyphens', () => {
    const fit = parseFit(LOKI)!;
    expect(fit.lines.some((l) => l.name === 'Loki Core - Immobility Drivers')).toBe(true);
  });

  it('does not emit the header line as an item', () => {
    const fit = parseFit(LOKI)!;
    expect(fit.lines.some((l) => l.name.includes('['))).toBe(false);
  });

  it('drops [Empty ... slot] placeholders without disturbing the surrounding lines', () => {
    const fit = parseFit(`[Nestor, Links]
Shield Command Burst II
Skirmish Command Burst II
Gistum B-Type Medium Remote Shield Booster
[Empty High slot]
Gistum B-Type Medium Remote Shield Booster

[ Empty Med slot ]
[Empty Rig slot]
Damage Control II`)!;
    expect(fit.lines.some((l) => /empty/i.test(l.name))).toBe(false);
    expect(fit.lines.filter((l) => l.name === 'Gistum B-Type Medium Remote Shield Booster')).toHaveLength(2);
    expect(fit.lines.map((l) => l.name)).toEqual([
      'Nestor',
      'Shield Command Burst II',
      'Skirmish Command Burst II',
      'Gistum B-Type Medium Remote Shield Booster',
      'Gistum B-Type Medium Remote Shield Booster',
      'Damage Control II',
    ]);
  });

  it('returns null when there is no header line', () => {
    expect(parseFit('Damage Control II\nTritanium 100')).toBeNull();
  });

  it('handles a header not on the first line (leading blanks)', () => {
    const fit = parseFit('\n\n[Rifter, Test]\nDamage Control II')!;
    expect(fit.shipName).toBe('Rifter');
    expect(fit.lines[0]).toMatchObject({ name: 'Rifter', quantity: 1 });
  });
});

import { describe, expect, it } from 'vitest';
import { formatIsk, formatVolume, toMultibuy } from './format.js';

describe('formatIsk', () => {
  it('handles null/undefined/NaN as em-dash', () => {
    expect(formatIsk(null)).toBe('—');
    expect(formatIsk(undefined)).toBe('—');
    expect(formatIsk(NaN)).toBe('—');
  });

  it('formats sub-thousand without suffix', () => {
    expect(formatIsk(0)).toBe('0');
    expect(formatIsk(999)).toBe('999');
    expect(formatIsk(3.69)).toBe('3.69');
    expect(formatIsk(42)).toBe('42');
  });

  it('uses k/m/b with 3 significant digits', () => {
    expect(formatIsk(1000)).toBe('1k');
    expect(formatIsk(45600)).toBe('45.6k');
    expect(formatIsk(184500)).toBe('185k'); // rounds up at 3 significant figures
    expect(formatIsk(184000)).toBe('184k');
    expect(formatIsk(1_234_567_890)).toBe('1.23b');
    expect(formatIsk(5_270_756.7)).toBe('5.27m');
  });

  it('keeps the boundary at exactly 1000', () => {
    expect(formatIsk(999.4)).toBe('999');
    expect(formatIsk(1000)).toBe('1k');
  });

  it('preserves sign', () => {
    expect(formatIsk(-2_500_000)).toBe('-2.5m');
  });
});

describe('formatVolume', () => {
  it('handles null/undefined/NaN as em-dash', () => {
    expect(formatVolume(null)).toBe('—');
    expect(formatVolume(undefined)).toBe('—');
    expect(formatVolume(NaN)).toBe('—');
  });

  it('shows plain m³ below a thousand (up to three digits)', () => {
    expect(formatVolume(0)).toBe('0 m³');
    expect(formatVolume(5)).toBe('5 m³');
    expect(formatVolume(742.5)).toBe('743 m³');
    expect(formatVolume(999)).toBe('999 m³');
    expect(formatVolume(0.01)).toBe('0.01 m³');
  });

  it('rounds to k once it reaches a thousand (three significant figures)', () => {
    expect(formatVolume(1000)).toBe('1k m³');
    expect(formatVolume(12_300)).toBe('12.3k m³');
    expect(formatVolume(742_000)).toBe('742k m³');
  });

  it('keeps the k suffix and grows digits above a thousand k (no M)', () => {
    expect(formatVolume(1_500_000)).toBe('1500k m³');
    expect(formatVolume(340_000_000)).toBe('340000k m³');
  });

  it('preserves sign', () => {
    expect(formatVolume(-12_300)).toBe('-12.3k m³');
  });
});

describe('toMultibuy', () => {
  it('formats name+qty per line and omits zero/negative quantities', () => {
    const out = toMultibuy([
      { name: 'Hobgoblin II', quantity: 10 },
      { name: 'Damage Control II', quantity: 1 },
      { name: 'Tritanium', quantity: 0 },
      { name: 'Nanite Repair Paste', quantity: -3 },
    ]);
    expect(out).toBe('Hobgoblin II 10\nDamage Control II 1');
  });
});

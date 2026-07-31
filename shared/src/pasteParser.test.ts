import { describe, expect, it } from 'vitest';
import { parsePaste } from './pasteParser.js';

function pairs(text: string) {
  return parsePaste(text).lines.map((l) => [l.name, l.quantity]);
}

describe('parsePaste', () => {
  it('parses tab-separated name<tab>qty', () => {
    expect(pairs('Hobgoblin II\t10\nTritanium\t100000')).toEqual([
      ['Hobgoblin II', 10],
      ['Tritanium', 100000],
    ]);
  });

  it('parses comma-separated', () => {
    expect(pairs('Damage Control II,1\nWarrior II,5')).toEqual([
      ['Damage Control II', 1],
      ['Warrior II', 5],
    ]);
  });

  it('parses whitespace-separated with multi-word names (qty last)', () => {
    expect(pairs('Hobgoblin II 10\nMedium Shield Extender II 3')).toEqual([
      ['Hobgoblin II', 10],
      ['Medium Shield Extender II', 3],
    ]);
  });

  it('does not treat a roman numeral as a quantity', () => {
    // "Hobgoblin II" alone -> name with implicit qty 1
    expect(pairs('Hobgoblin II')).toEqual([['Hobgoblin II', 1]]);
  });

  it('handles qty-first column order', () => {
    expect(pairs('10 Hobgoblin II\n3 Warrior II')).toEqual([
      ['Hobgoblin II', 10],
      ['Warrior II', 3],
    ]);
  });

  it('accepts x-prefixed and thousand-separated quantities', () => {
    expect(pairs('Tritanium x1000')).toEqual([['Tritanium', 1000]]);
    expect(pairs('Tritanium\t1,000,000')).toEqual([['Tritanium', 1000000]]);
  });

  it('ignores blank lines', () => {
    expect(pairs('Hobgoblin II 10\n\n\nWarrior II 5')).toEqual([
      ['Hobgoblin II', 10],
      ['Warrior II', 5],
    ]);
  });

  it('defaults a single-token line to qty 1', () => {
    expect(pairs('Tritanium')).toEqual([['Tritanium', 1]]);
  });

  it('treats a line with no numeric cell as a name with qty 1', () => {
    expect(pairs('Damage Control II')).toEqual([['Damage Control II', 1]]);
  });
});

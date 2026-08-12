import { describe, it, expect } from 'vitest';
import { normalizeToPctChange, pickComparisonColor, COMPARISON_PALETTE } from './comparisonUtils';


describe('normalizeToPctChange', () => {
  it('returns array same length as input', () => {
    const bars = [
      { t: 1, c: 100 },
      { t: 2, c: 105 },
      { t: 3, c: 110 },
    ];
    const result = normalizeToPctChange(bars);
    expect(result.length).toBe(3);
  });

  it('first point is 0%', () => {
    const bars = [{ t: 1, c: 100 }, { t: 2, c: 110 }];
    const result = normalizeToPctChange(bars);
    expect(result[0].value).toBe(0);
  });

  it('computes % change correctly', () => {
    const bars = [{ t: 1, c: 100 }, { t: 2, c: 110 }, { t: 3, c: 90 }];
    const result = normalizeToPctChange(bars);
    expect(result[1].value).toBeCloseTo(10, 5);
    expect(result[2].value).toBeCloseTo(-10, 5);
  });

  it('handles empty input', () => {
    expect(normalizeToPctChange([])).toEqual([]);
  });

  it('handles single bar', () => {
    const bars = [{ t: 1, c: 100 }];
    expect(normalizeToPctChange(bars)).toEqual([{ time: 1, value: 0 }]);
  });

  it('skips bars with missing close', () => {
    const bars = [{ t: 1, c: 100 }, { t: 2, c: null }, { t: 3, c: 110 }];
    const result = normalizeToPctChange(bars);
    expect(result.length).toBe(2);
    expect(result[1].value).toBeCloseTo(10, 5);
  });

  it('handles zero base close gracefully', () => {
    const bars = [{ t: 1, c: 0 }, { t: 2, c: 100 }];
    const result = normalizeToPctChange(bars);
    // Should not produce Infinity — skip first or treat as 0
    expect(result.every(p => Number.isFinite(p.value))).toBe(true);
  });
});


describe('pickComparisonColor', () => {
  it('returns the curated palette for the first band', () => {
    expect(pickComparisonColor(0)).toBe(COMPARISON_PALETTE[0]);
    expect(pickComparisonColor(1)).toBe(COMPARISON_PALETTE[1]);
  });

  it('past the palette length it yields a DISTINCT shade, not a repeat', () => {
    // Old behavior cycled (idx==len -> palette[0]); now every position is unique.
    const overflow = pickComparisonColor(COMPARISON_PALETTE.length);
    expect(overflow).not.toBe(COMPARISON_PALETTE[0]);
    expect(/^#[0-9a-f]{6}$/i.test(overflow)).toBe(true);
  });

  it('is collision-free: a full group gets all-distinct colors', () => {
    const used = [];
    for (let i = 0; i < COMPARISON_PALETTE.length + 6; i++) {
      const col = pickComparisonColor(i, used);
      expect(used).not.toContain(col);      // never a duplicate
      used.push(col);
    }
    expect(new Set(used).size).toBe(used.length);
  });

  it('handles negative idx', () => {
    expect(pickComparisonColor(-1)).toBe(COMPARISON_PALETTE[0]);
  });
});

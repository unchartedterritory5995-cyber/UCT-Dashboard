import { describe, it, expect } from 'vitest';
import { LAYOUTS, getLayoutCellCount, makeDefaultCells, WATCH_PANEL_PRESET } from './multiChartLayouts';


describe('LAYOUTS', () => {
  it('contains expected entries', () => {
    expect(LAYOUTS.map(l => l.id).sort()).toEqual(
      ['1x1', '1x2', '1x3', '2x1', '2x2', '2x3', '3x1'].sort()
    );
  });

  it('each layout has rows + cols + cellCount', () => {
    for (const l of LAYOUTS) {
      expect(l.rows).toBeGreaterThan(0);
      expect(l.cols).toBeGreaterThan(0);
      expect(l.cellCount).toBe(l.rows * l.cols);
    }
  });
});


describe('getLayoutCellCount', () => {
  it('returns correct count per layout id', () => {
    expect(getLayoutCellCount('1x1')).toBe(1);
    expect(getLayoutCellCount('2x2')).toBe(4);
    expect(getLayoutCellCount('3x1')).toBe(3);
    expect(getLayoutCellCount('2x3')).toBe(6);
  });

  it('returns 1 for unknown id', () => {
    expect(getLayoutCellCount('unknown')).toBe(1);
  });
});


describe('makeDefaultCells', () => {
  it('produces N cells with default sym QQQ and tf D', () => {
    const cells = makeDefaultCells(4);
    expect(cells.length).toBe(4);
    for (const c of cells) {
      expect(c.sym).toBe('QQQ');
      expect(c.tf).toBe('D');
      expect(typeof c.id).toBe('string');
    }
  });

  it('produces unique ids', () => {
    const cells = makeDefaultCells(6);
    const ids = cells.map(c => c.id);
    expect(new Set(ids).size).toBe(6);
  });
});


describe('WATCH_PANEL_PRESET', () => {
  it('is a 2x2 layout with QQQ/SPY/IWM/DIA', () => {
    expect(WATCH_PANEL_PRESET.layout).toBe('2x2');
    expect(WATCH_PANEL_PRESET.cells.length).toBe(4);
    expect(WATCH_PANEL_PRESET.cells.map(c => c.sym).sort())
      .toEqual(['DIA', 'IWM', 'QQQ', 'SPY']);
  });
});

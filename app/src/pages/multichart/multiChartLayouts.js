// app/src/pages/multichart/multiChartLayouts.js


export const LAYOUTS = [
  { id: '1x1', rows: 1, cols: 1, cellCount: 1, label: '1 chart' },
  { id: '1x2', rows: 1, cols: 2, cellCount: 2, label: 'Side by side' },
  { id: '2x1', rows: 2, cols: 1, cellCount: 2, label: 'Stacked' },
  { id: '2x2', rows: 2, cols: 2, cellCount: 4, label: '2×2 grid' },
  { id: '3x1', rows: 3, cols: 1, cellCount: 3, label: '3 stacked' },
  { id: '1x3', rows: 1, cols: 3, cellCount: 3, label: '3 side-by-side' },
  { id: '2x3', rows: 2, cols: 3, cellCount: 6, label: '6 grid' },
];


export function getLayoutCellCount(layoutId) {
  const l = LAYOUTS.find(x => x.id === layoutId);
  return l?.cellCount ?? 1;
}


function genId() {
  return Math.random().toString(36).slice(2, 8);
}


export function makeDefaultCells(count) {
  return Array.from({ length: count }, () => ({
    id: genId(),
    sym: 'QQQ',
    tf: 'D',
    chartSettings: null,  // null = inherit from user prefs
  }));
}


export const WATCH_PANEL_PRESET = {
  layout: '2x2',
  cells: [
    { id: 'wp-qqq', sym: 'QQQ', tf: 'D', chartSettings: null },
    { id: 'wp-spy', sym: 'SPY', tf: 'D', chartSettings: null },
    { id: 'wp-iwm', sym: 'IWM', tf: 'D', chartSettings: null },
    { id: 'wp-dia', sym: 'DIA', tf: 'D', chartSettings: null },
  ],
  syncCrosshair: true,
  syncTimeRange: true,
};

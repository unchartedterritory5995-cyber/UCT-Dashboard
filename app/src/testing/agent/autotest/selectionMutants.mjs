// UCT Agent AUTOTEST: wrong-chart bugs the selection oracle has to catch. Applied at serve time by selectionServe.mjs: no file changes.
export const MUTANTS = {
  // "this chart" is always the first chart on the board, whatever was clicked (the historical default-to-first class)
  'first-chart': { file: /src\/agent\/host\.js$/, from: "selected: () => entries().find(e => e.snap.selected)?.ref || null,", to: 'selected: () => entries()[0]?.ref || null,' },
  // the first chart clicked stays selected: a later click never moves it
  'first-click': { file: /src\/pages\/charts\/ChartsWorkspace\.jsx$/, from: 'onPointerDownCapture={w.type === \'chart\' && h.onPopOut ? () => { selectedChartRef.current = {', to: 'onPointerDownCapture={w.type === \'chart\' && h.onPopOut ? () => { if (!selectedChartRef.current) selectedChartRef.current = {' },
}

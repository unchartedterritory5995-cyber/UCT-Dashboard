// app/src/utils/chartLayoutTable.js
//
// lightweight-charts lays every chart out in a <table> (one row per pane, one per pane
// separator, one for the time axis) whose cells hold only canvases. Unmarked, a screen
// reader and axe read it as a DATA table of empty cells -- measured in the TickerPopup
// and the Ticker Hub sheet: "table, 4 rows" under the meta row, every cell blank.
// It is a layout table, so it is marked presentational. ARIA's presentational-children
// rule carries that to its rows and cells, and the library only ever appends rows to
// the SAME table element, so marking it once at creation holds for later panes.
//
// Never throws: a chart without `chartElement` (an older build, a test stub) is left
// as it is.
export function markChartLayoutPresentational(chart) {
  try {
    const root = typeof chart?.chartElement === 'function' ? chart.chartElement() : null
    const table = root?.querySelector?.('table')
    if (!table) return false
    table.setAttribute('role', 'presentation')
    return true
  } catch {
    return false
  }
}

// u18-export-04 (pl-auto unseen18 on 8a3977c833): "export the Swing watchlist as a csv file" planned watchlist.exportList (the
// list menu's own Export CSV, C3-095) and still said "Not done: I can't export to Excel or other files". A planned
// watchlist.exportList covers exporting a watchlist as CSV / Excel; a format it has no export for (PDF) is still not done.
// Written BEFORE the fix. Evidence: LOCAL, vitest (node), pure.
import { describe, it, expect } from 'vitest'
import { notDoneLines } from './notDone'

const EXPORT = ['watchlist.exportList']
describe('notDone: a planned watchlist export covers the export part', () => {
  it.each([
    'export the Swing watchlist as a csv file',
    'download my momentum watchlist to excel',
    'export this watchlist into a spreadsheet',
  ])('"%s" with watchlist.exportList planned: no "Not done" line', (t) => {
    expect(notDoneLines(t, { actions: EXPORT })).toEqual([])
  })
  it('without the export planned, the line stays (the chart-data case)', () => {
    expect(notDoneLines('change SPY to weekly and export the chart data to Excel', { actions: ['chart.setTimeframe'] })).toHaveLength(1)
  })
  it('a PDF is still not done, even with a watchlist export planned', () => {
    expect(notDoneLines('export the Swing watchlist as a pdf', { actions: EXPORT })).toHaveLength(1)
  })
})

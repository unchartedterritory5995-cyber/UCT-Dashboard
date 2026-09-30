// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.c11bKillzones.test.js
//
// ─── C11b — ICT KILLZONES' DATA TABLE, AGAINST TRADINGVIEW'S OWN ──────────────
//
// Captured on a live TradingView chart 2026-09-28 (NYSE:RDDT 1D, 632 bars). On a
// daily chart the killzones (intraday sessions) never form, so TradingView's
// data table holds exactly its header: three cells, "Range" / "High" / "Low", in
// columns 1, 2 and 3 of row 0 (source lines 1030-1039):
//
//   if show_data and barstate.islast
//       var tbl = table.new(data_loc, 20, 20, …)
//       int c = 1
//       table.cell(tbl, c, 0, "Range", …)
//       c += 1
//       if stats_pivots or stats_dwm
//           table.cell(tbl, c, 0, "High", …)
//           c += 1
//           table.cell(tbl, c, 0, "Low", …)
//           c += 1
//       if stats_levels                       ← off by default; its `for … in`
//           for l in kz1Levels                  also advances `c`
//
// Before C11b every one of the three was refused: the `for … in` advances `c`
// in a loop the walk cannot fold, so the walk condemned `c` everywhere, even at
// the three cells that read it before the loop. A first cut that lifted the
// condemnation drew "Low" in column 5 — a harvest record re-made from the END of
// the block — while the harness (which compares counts and texts, never
// coordinates) read MATCH. This rail pins the ADDRESSES too.
import { describe, it, expect, vi, afterEach } from 'vitest'
import path from 'node:path'

import { loadCapture } from './harness'
import { toProductBars } from './ourSide'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import { objectReaderFor } from '../../objectColumns'
import { evaluateObjects } from '../../objectRuntime'
import { toRenderState } from '../../objectRenderState'

const FILE = path.resolve(process.cwd(), '..',
  'tests/fixtures/vendor/harness/ict-killzones-pivots-tfo-rddt-1d-2026-09-28.json')

describe('⭐ C11b — ict-killzones draws TradingView\'s table header, cell for cell', () => {
  // ⭐ An objects-only script reaches the member door only with the objects
  // pane on — production arms it (docs/frontend_feature_flags.json); vitest's
  // default env does not.
  afterEach(() => { vi.unstubAllEnvs() })

  it('the three header cells, at the columns TradingView holds them, and nothing else', () => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    const loaded = loadCapture(FILE)
    expect(loaded.capture, loaded.reason).toBeTruthy()
    const cap = loaded.capture
    const bars = toProductBars(cap)
    const d = memberPaneDefinition({ source: cap.source.text, id: 'u_c11b_ict', name: 'ict' })
    expect(d.ok, d.reason).toBe(true)
    const reader = objectReaderFor(d.definition, bars, {
      tf: 'D', symbol: { ticker: 'RDDT', exchange: 'NYSE' }, newestBarIsForming: cap.newestBarIsForming ?? null,
    })
    const run = evaluateObjects(reader.program, {
      barCount: bars.length, readNode: reader.readNode, readTime: reader.readTime, readUnknown: reader.readUnknown,
    })
    const state = toRenderState(run.live, { bars, tf: 'D' })

    const vendorTables = cap.objects.records.tables
    expect(state.tables.length).toBe(vendorTables.length)
    expect(state.tables[0].position).toBe(vendorTables[0].pos)

    const vendorCells = cap.objects.records.tableCells
      .map((c) => [c.col, c.row, String(c.t)]).sort((a, b) => a[0] - b[0] || a[1] - b[1])
    const ours = state.tables.flatMap((t) => t.cells || [])
      .map((c) => [c.col, c.row, String(c.text)]).sort((a, b) => a[0] - b[0] || a[1] - b[1])
    expect(vendorCells, 'the capture holds the header only').toEqual([[1, 0, 'Range'], [2, 0, 'High'], [3, 0, 'Low']])
    expect(ours).toEqual(vendorCells)
  })
})

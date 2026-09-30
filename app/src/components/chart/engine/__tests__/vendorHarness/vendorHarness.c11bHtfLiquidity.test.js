// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.c11bHtfLiquidity.test.js
//
// ─── C11b — HTF LIQUIDITY'S PREVIOUS-DAY LEVELS, AGAINST TRADINGVIEW'S OWN ────
//
// Captured on a live TradingView chart 2026-09-28 (NYSE:RDDT 1D, 632 bars). The
// current-chart levels are the corpus's bounded-window idiom twice over:
//
//   update_arrays(o, h_arr, l_arr, h, l) =>        a NUMERIC window, one slot:
//       if o != o[1]                                 the previous day's high/low,
//           h_arr.unshift(h[1]) / l_arr.unshift(l[1]) newest in front
//       if h_arr.size() > 1
//           h_arr.pop() / l_arr.pop()
//   chart_pivot(…, _ph, _pl, _hline, _lline, _hlabel, _llabel, …) =>
//       if _ph.size() > 0
//           if _open != _open[1]                     a LIST OF LINES, newest in
//               _hline.unshift(line.new(…, _ph.get(0), …))   front, evicted
//               _hlabel.set_xy(bar_index, _ph.get(0))        past `plimit` (3)
//               _hlabel.set_text("P" + _tf + "H")
//           …
//       if _hline.size() > plimit
//           line.delete(_hline.pop())
//
// Before C11b every one of those reads refused (`_ph.size` read as a user type)
// and the lists diverged (`unshift` was not carried): lines 6/0, labels 6/0.
//
// ⭐ WHAT IS PINNED IS STRONGER THAN A COUNT. The capture's ids are TradingView's
// one creation counter across lines and labels, and ours is too (`nextId`): the
// six lines TradingView holds are ids 1262-1267 and ours must be the SAME ids,
// in the same order, at the same prices; the six `var` labels are ids 1-6 with
// "PDH" / "PDL" at the last bar's levels and four created at `na` and never
// touched (the weekly/monthly ones, whose inputs are off). The capture's `x` is
// a dense rank of the x positions it holds, so ours must map onto it in order.
import { describe, it, expect, vi, afterEach } from 'vitest'
import path from 'node:path'

import { loadCapture } from './harness'
import { toProductBars } from './ourSide'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import { objectReaderFor } from '../../objectColumns'
import { evaluateObjects } from '../../objectRuntime'

const FILE = path.resolve(process.cwd(), '..',
  'tests/fixtures/vendor/harness/htf-liquidity-dashboard-tfo-rddt-1d-2026-09-28.json')

/** Dense rank of the distinct values, 1-based — the capture's own `x`. */
const denseRank = (xs) => {
  const order = [...new Set(xs.filter((x) => x !== null && x !== undefined))].sort((a, b) => a - b)
  return xs.map((x) => (x === null || x === undefined ? 0 : order.indexOf(x) + 1))
}

describe('⭐ C11b — htf-liquidity draws TradingView\'s previous-day levels, id for id', () => {
  // ⭐ An objects-only script reaches the member door only with the objects
  // pane on — production arms it; vitest's default env does not.
  afterEach(() => { vi.unstubAllEnvs() })

  it('the six lines and six labels TradingView holds: same ids, same prices, same order', () => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    const loaded = loadCapture(FILE)
    expect(loaded.capture, loaded.reason).toBeTruthy()
    const cap = loaded.capture
    const bars = toProductBars(cap)
    const d = memberPaneDefinition({ source: cap.source.text, id: 'u_c11b_htf', name: 'htf' })
    expect(d.ok, d.reason).toBe(true)
    const reader = objectReaderFor(d.definition, bars, {
      tf: 'D', symbol: { ticker: 'RDDT', exchange: 'NYSE' }, newestBarIsForming: cap.newestBarIsForming ?? null,
    })
    const run = evaluateObjects(reader.program, {
      barCount: bars.length, readNode: reader.readNode, readTime: reader.readTime, readUnknown: reader.readUnknown,
    })

    const vLines = cap.objects.records.lines
    const oLines = run.live.filter((o) => o.family === 'line').sort((a, b) => a.id - b.id)
    expect(vLines.length).toBe(6)
    expect(oLines.map((l) => l.id)).toEqual(vLines.map((l) => l.id))
    expect(oLines.map((l) => [l.props.y1, l.props.y2])).toEqual(vLines.map((l) => [l.y1, l.y2]))
    expect(denseRank(oLines.map((l) => l.props.x1))).toEqual(vLines.map((l) => l.x1))

    const vLabels = cap.objects.records.labels
    const oLabels = run.live.filter((o) => o.family === 'label').sort((a, b) => a.id - b.id)
    expect(oLabels.map((l) => l.id)).toEqual(vLabels.map((l) => l.id))
    expect(oLabels.map((l) => (l.props.text == null ? '' : String(l.props.text)))).toEqual(vLabels.map((l) => l.t))
    expect(oLabels.map((l) => (Number.isFinite(l.props.y) ? l.props.y : null))).toEqual(vLabels.map((l) => l.y))
    // The labels share the lines' x ranks (the last bar is rank 3).
    const ranks = denseRank([...oLines.map((l) => l.props.x1), ...oLabels.map((l) => l.props.x)])
    expect(ranks.slice(oLines.length)).toEqual(vLabels.map((l) => l.x))
  })
})

// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.c11cPta.test.js
//
// ─── C11c — PRO-TRADING-ART'S DOUBLE TOPS AND BOTTOMS, AGAINST TRADINGVIEW ────
//
// Captured on a live TradingView chart 2026-09-28 (NYSE:RDDT 1D, 632 bars from
// the listing day). The script keeps its last three pivots in fixed windows and
// reads them the corpus's way:
//
//   var top = array.new_float(3)          method middlePrice(array<float> a) =>
//   if not na(ph)                             a.get(a.size() - 2)
//       top.maintainPivot(ph)   // push + shift, a user write method
//   …
//   if inRange
//       …  top.middlePrice() … top.indexof(top.max()) … topIndex.get(max_index) …
//       var lastStart = 0      // a `var` IN THE BLOCK — and again in the bottom one
//       if isTop and topStart != lastStart
//           lastStart := topStart
//           [Line, A, B] = drawLL(…)      // a helper answering three handles
//           topLine := Line
//
// Before C11c the member door refused it (`pine:no-output`: every create was
// lost). Each wall was general Pine: window reductions and a series index, the
// script's own read method, a block `var`, a destructure beside a state write,
// and a handle copied into another name.
//
// ⭐ WHAT IS PINNED: every object we hold is TradingView's — same order, same
// price, same caption, the id counter agreeing at an offset of exactly the one
// withheld triplet, and our x positions mapping in order onto the capture's dense
// x ranks. The FIRST double top (bar 208) reads `lastStart` inside the warm-up
// curtain (`PINE_STATE_WARMUP`, ruling R-W) and is withheld, counted — so 6 of
// 7 lines and 12 of 14 labels. The capture starts at the listing day
// (`history.startsAtBar0`), which is C12w's exception to lift, not this lane's.
import { describe, it, expect, vi, afterEach } from 'vitest'
import path from 'node:path'

import { loadCapture } from './harness'
import { toProductBars } from './ourSide'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import { objectReaderFor } from '../../objectColumns'
import { evaluateObjects } from '../../objectRuntime'

const FILE = path.resolve(process.cwd(), '..',
  'tests/fixtures/vendor/harness/pro-trading-art-double-top-bottom-with-alert-rddt-1d-2026-09-28.json')

/** Dense rank of the distinct values, 0-based — the capture's own `x`. */
const denseRank = (xs) => {
  const order = [...new Set(xs)].sort((a, b) => a - b)
  return xs.map((x) => order.indexOf(x))
}

describe('⭐ C11c — pro-trading-art draws TradingView\'s double tops and bottoms', () => {
  afterEach(() => { vi.unstubAllEnvs() })

  it('every object we hold is TradingView\'s; only the curtain\'s first triplet is withheld', () => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    const loaded = loadCapture(FILE)
    expect(loaded.capture, loaded.reason).toBeTruthy()
    const cap = loaded.capture
    expect(cap.history.startsAtBar0).toBe(true)
    const bars = toProductBars(cap)
    const d = memberPaneDefinition({ source: cap.source.text, id: 'u_c11c_pta', name: 'pta' })
    expect(d.ok, d.reason).toBe(true)
    const reader = objectReaderFor(d.definition, bars, {
      tf: 'D', symbol: { ticker: 'RDDT', exchange: 'NYSE' }, newestBarIsForming: cap.newestBarIsForming ?? null,
    })
    const run = evaluateObjects(reader.program, {
      barCount: bars.length, readNode: reader.readNode, readTime: reader.readTime, readUnknown: reader.readUnknown,
    })

    const vLines = cap.objects.records.lines
    const vLabels = cap.objects.records.labels
    expect(vLines).toHaveLength(7)
    expect(vLabels).toHaveLength(14)
    const oLines = run.live.filter((o) => o.family === 'line').sort((a, b) => a.id - b.id)
    const oLabels = run.live.filter((o) => o.family === 'label').sort((a, b) => a.id - b.id)
    // the last six lines and twelve labels, and nothing TradingView lacks
    expect(oLines).toHaveLength(6)
    expect(oLabels).toHaveLength(12)
    const wantLines = vLines.slice(1)
    const wantLabels = vLabels.slice(2)
    // one creation counter across families, at an offset of the one withheld triplet
    expect(oLines.map((l) => l.id + 3)).toEqual(wantLines.map((l) => l.id))
    expect(oLabels.map((l) => l.id + 3)).toEqual(wantLabels.map((l) => l.id))
    expect(oLines.map((l) => [l.props.y1, l.props.y2])).toEqual(wantLines.map((l) => [l.y1, l.y2]))
    expect(oLabels.map((l) => [l.props.y, l.props.text])).toEqual(wantLabels.map((l) => [l.y, l.t]))
    // x: our bars in order map onto the capture's dense ranks, offset by the two
    // x positions only the withheld triplet holds
    const xs = [...oLines.flatMap((l) => [l.props.x1, l.props.x2]), ...oLabels.map((l) => l.props.x)]
    const ranks = denseRank(xs).map((r) => r + 2)
    const vx = [...wantLines.flatMap((l) => [l.x1, l.x2]), ...wantLabels.map((l) => l.x)]
    expect(ranks).toEqual(vx)
    // the withheld triplet is counted, never silently dropped
    expect(run.stats.withheldUnknown).toBeGreaterThan(0)
  })
})

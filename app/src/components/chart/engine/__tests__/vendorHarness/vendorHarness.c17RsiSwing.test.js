// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.c17RsiSwing.test.js
//
// ─── C17 — RSI SWING INDICATOR'S SWING LABELS AND LINES, AGAINST TRADINGVIEW ───
//
// Captured on a live TradingView chart 2026-09-28 (NYSE:RDDT 1D, 632 bars — the
// whole listing; `startsAtBar0`). TradingView holds 11 labels and 11 lines, one
// label + one line per swing, alternating. Each label's TEXT reads
// `label.get_y` of the swing label two back (`last_actual_label_*_price`), and
// each line's x2/y2 read `label.get_x/get_y` of the previous label.
//
// This lane's `var`s are computed over a 250-bar window (the warm-up curtain),
// so the swings TradingView made before bar 250 are not made here. Before C17
// the converter refused the whole object program (`state:lost`, 12 ops): its
// handles are written off `var` guards the curtain withholds. With that lifted,
// the run made 8 labels / 8 lines — and the first two label TEXTS and the first
// line's x2/y2 read labels made before the curtain, and were WRONG.
//
// ⭐ WHAT IS PINNED. With the runtime's register taint (`objectRuntime.js`
// `regTaint`), the first two labels and the first line are MADE (so every id
// after them is TradingView's order) but held undrawn, and EVERY object drawn
// is TradingView's — its last 6 labels and last 7 lines, in creation order, at
// its price, with its word, style and placement. The capture's `x` is a dense
// rank of the distinct x positions TradingView holds, so our x positions must
// map onto its ranks one-to-one and in order; and each label's y must be the
// high (above bar) or low (below bar) of the very bar it sits on, which that
// price occupies once in the series.
import { describe, it, expect, vi, afterEach } from 'vitest'
import path from 'node:path'

import { loadCapture } from './harness'
import { toProductBars } from './ourSide'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import { objectReaderFor } from '../../objectColumns'
import { evaluateObjects } from '../../objectRuntime'

const FILE = path.resolve(process.cwd(), '..',
  'tests/fixtures/vendor/harness/rsi-swing-indicator-rddt-1d-2026-09-28.json')
const capture = () => {
  const loaded = loadCapture(FILE)
  if (!loaded.capture) throw new Error(`not a capture — ${loaded.reason}`)
  return loaded.capture
}

afterEach(() => { vi.unstubAllEnvs() })

function memberRun(cap, { listing = false } = {}) {
  // an objects-only script: the member door serves it through the objects-only
  // pane, ARMED in production (`VITE_PINE_OBJECTS_ONLY_PANE_ENABLED`)
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  const bars = toProductBars(cap)
  const d = memberPaneDefinition({ source: cap.source.text, id: 'u_c17_rsi_swing', name: 'rsi swing' })
  expect(d.ok, d.reason).toBe(true)
  // `listing`: the series is stated to start at the symbol's first-ever bar
  // (C12w, ruling R-W) — the capture's `history.startsAtBar0`. Without it the
  // warm-up curtain stands, which is every chart that does not start there.
  const reader = objectReaderFor(d.definition, bars, {
    tf: 'D', symbol: { ticker: 'RDDT', exchange: 'NYSE' }, newestBarIsForming: cap.newestBarIsForming ?? null,
    ...(listing ? { historyFromListing: true } : {}),
  })
  const run = evaluateObjects(reader.program, {
    barCount: bars.length, readNode: reader.readNode, readTime: reader.readTime, readUnknown: reader.readUnknown,
  })
  return { d, run, bars }
}

const YLOC = { ab: 'abovebar', bl: 'belowbar' }

describe('C17 — rsi-swing-indicator: every object drawn is TradingView\'s', () => {
  it('⭐ the member door builds its drawing program — nothing refused (was `state:lost` ×12)', () => {
    const { d } = memberRun(capture())
    expect(d.definition.objects.ops.length).toBeGreaterThan(0)
    expect(d.translation.objectDiagnostics.dropReasons['state:lost']).toBeUndefined()
    expect(d.translation.objectDiagnostics.droppedOps).toBe(0)
  })

  it('⭐ TradingView\'s last 6 labels and last 7 lines, value for value, in creation order', () => {
    const cap = capture()
    const { run, bars } = memberRun(cap)
    const vLabels = [...cap.objects.records.labels].sort((a, b) => a.id - b.id)
    const vLines = [...cap.objects.records.lines].sort((a, b) => a.id - b.id)
    const labels = run.live.filter((o) => o.family === 'label')
    const lines = run.live.filter((o) => o.family === 'line')
    expect(labels).toHaveLength(6)
    expect(lines).toHaveLength(7)

    const vL = vLabels.slice(-6)
    expect(labels.map((o) => [o.props.y, o.props.text, o.props.yloc]))
      .toEqual(vL.map((l) => [l.y, l.t, YLOC[l.yl]]))
    const vN = vLines.slice(-7)
    expect(lines.map((o) => [o.props.y1, o.props.y2])).toEqual(vN.map((l) => [l.y1, l.y2]))

    // ids: TradingView's creation order, interleaved exactly as it made them
    const ours = run.live.map((o) => [o.family, o.id]).sort((a, b) => a[1] - b[1]).map((x) => x[0])
    const theirs = [...vL.map((l) => ['label', l.id]), ...vN.map((l) => ['line', l.id])]
      .sort((a, b) => a[1] - b[1]).map((x) => x[0])
    expect(ours).toEqual(theirs)

    // x: our positions map onto TradingView's dense ranks one-to-one, in order
    const ourXs = [...labels.map((o) => [o.props.x]), ...lines.map((o) => [o.props.x1, o.props.x2])]
    const theirXs = [...vL.map((l) => [l.x]), ...vN.map((l) => [l.x1, l.x2])]
    const posSorted = [...new Set(ourXs.flat())].sort((a, b) => a - b)
    const rankSorted = [...new Set(theirXs.flat())].sort((a, b) => a - b)
    expect(posSorted).toHaveLength(rankSorted.length)
    const rankOf = new Map(posSorted.map((p, i) => [p, rankSorted[i]]))
    expect(ourXs.map((xs) => xs.map((x) => rankOf.get(x)))).toEqual(theirXs)

    // and each label sits on the bar whose high (above) / low (below) is its y —
    // a price that bar alone holds in the series, so the bar is TradingView's too
    for (const o of labels) {
      const field = o.props.yloc === 'abovebar' ? 'h' : 'l'
      expect(bars[o.props.x][field]).toBe(o.props.y)
      expect(bars.filter((b) => b[field] === o.props.y)).toHaveLength(1)
    }
  })

  it('⭐ the objects made off pre-curtain labels are MADE and held, never drawn', () => {
    const { run } = memberRun(capture())
    expect(run.withheld).toEqual({ label: 2, line: 1 })
    expect(run.stats.objectsTainted).toBe(3)
    expect(run.stats.created).toBe(16) // ids stay TradingView's order: nothing skipped
  })

  it('⭐ from the listing (C12w) there is no curtain, no mark forms, and ALL 11 + 11 are TradingView\'s, id for id', () => {
    const cap = capture()
    expect(cap.history.startsAtBar0).toBe(true)
    const { run } = memberRun(cap, { listing: true })
    expect(run.stats.objectsTainted).toBeUndefined()
    expect(run.stats.withheldTainted).toBeUndefined()
    const vLabels = [...cap.objects.records.labels].sort((a, b) => a.id - b.id)
    const vLines = [...cap.objects.records.lines].sort((a, b) => a.id - b.id)
    const labels = run.live.filter((o) => o.family === 'label')
    const lines = run.live.filter((o) => o.family === 'line')
    expect(labels.map((o) => [o.id, o.props.y, o.props.text, o.props.yloc]))
      .toEqual(vLabels.map((l) => [l.id, l.y, l.t, YLOC[l.yl]]))
    // the first line's x2/y2 read an empty handle: `na`, as TradingView's `null`
    expect(lines.map((o) => [o.id, o.props.y1, Number.isNaN(o.props.y2) ? null : o.props.y2]))
      .toEqual(vLines.map((l) => [l.id, l.y1, l.y2]))
  })
})

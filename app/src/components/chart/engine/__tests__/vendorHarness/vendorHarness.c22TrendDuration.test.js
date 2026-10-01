// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.c22TrendDuration.test.js
//
// ─── C22 — TREND-DURATION-FORECAST'S LABELS AND TABLE, AGAINST TRADINGVIEW ────
//
// Captured on a live TradingView chart 2026-09-28 (NYSE:RDDT 1D, 632 bars from
// the listing day). At every trend flip the script labels the new trend and
// re-texts the previous one with the length it ran (`TrendCount`, a counter
// reset at each flip — a SWITCHED recurrence whose reset reads another `var`);
// it keeps the last `samples` (an input, 10) lengths of each direction in two
// windows and tabulates them on the last bar. Its creates read the OTHER
// window's average inside the statement that fills this one.
//
// ⭐ WHAT IS PINNED, from the listing (the capture's `startsAtBar0`):
//   * 26 of TradingView's 28 labels, each its text and its y, in its creation
//     order — every label we draw is one of TradingView's;
//   * the table's average row, "23" and "19", at TradingView's addresses and
//     text colours;
//   * NO line: TradingView extends `LengthLine` by `bullishCount.avg()` bars off
//     a getter (`get_x1() + avg + 1`, refused by name), so ours is withheld —
//     it was drawn one bar long before C22.
// ⛔ WHAT IS NOT DRAWN, named:
//   * TradingView's first label (id 2, bar 58): our `trend` reads `na` until the
//     HMA exists (`ta.rising` of `na`), so the first flip compares against `na`
//     and is not seen — withheld by construction, never guessed;
//   * `LabelProbLen` (id 82): its x is `int(math.avg(get_x1(), get_x2()))` (a
//     getter in arithmetic) and its text reads a window between its add and its
//     removal, where it may hold one element more than its cap;
//   * (served since C32) the 30 cells whose text is per-iteration — the index
//     column `str.tostring(i + 1)` and `bullishCount.get(i)` read by the loop
//     counter — are pinned in `vendorHarness.c32Collections`. ⭐ With C25 (a loop
//     counter's condition, `{v:'loop'}`) the two headers under `if i == 0` are
//     served: TradingView's address, text, colour.
import { describe, it, expect, vi, afterEach } from 'vitest'
import path from 'node:path'

import { loadCapture } from './harness'
import { toProductBars } from './ourSide'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import { objectReaderFor } from '../../objectColumns'
import { evaluateObjects } from '../../objectRuntime'

const FILE = path.resolve(process.cwd(), '..',
  'tests/fixtures/vendor/harness/trend-duration-forecast-chartprime-rddt-1d-2026-09-28.json')

/** A capture colour (0xAABBGGRR) as `#RRGGBB`. */
const hexOf = (n) => {
  const r = n & 0xff
  const g = (n >>> 8) & 0xff
  const b = (n >>> 16) & 0xff
  return `#${[r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')}`.toUpperCase()
}

describe("⭐ C22 — trend-duration-forecast draws TradingView's labels and averages", () => {
  afterEach(() => { vi.unstubAllEnvs() })

  const runTd = (historyFromListing) => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    const loaded = loadCapture(FILE)
    expect(loaded.capture, loaded.reason).toBeTruthy()
    const cap = loaded.capture
    const bars = toProductBars(cap)
    const d = memberPaneDefinition({ source: cap.source.text, id: 'u_c22_td', name: 'td' })
    expect(d.ok, d.reason).toBe(true)
    const reader = objectReaderFor(d.definition, bars, {
      tf: 'D', symbol: { ticker: 'RDDT', exchange: 'NYSE' }, newestBarIsForming: cap.newestBarIsForming ?? null,
      historyFromListing,
    })
    const run = evaluateObjects(reader.program, {
      barCount: bars.length, readNode: reader.readNode, readTime: reader.readTime, readUnknown: reader.readUnknown,
    })
    const fam = (f) => run.live.filter((o) => o.family === f).sort((a, b) => a.id - b.id)
    return { cap, run, lines: fam('line'), labels: fam('label'), tables: fam('table') }
  }

  it('⭐ from the listing: 26 labels, each TradingView\'s text and y, in its creation order', () => {
    const { cap, labels } = runTd(true)
    expect(cap.history.startsAtBar0).toBe(true)
    const vendor = cap.objects.records.labels
    expect(vendor).toHaveLength(28)
    // the two we withhold, by id: the first flip's label and the probable-length label
    const expected = vendor.filter((l) => l.id !== 2 && l.id !== 82)
    expect(labels.map((l) => [l.props.text, l.props.y])).toEqual(expected.map((l) => [l.t, l.y]))
    // and in TradingView's left-to-right order
    const xs = labels.map((l) => l.props.x)
    expect(xs).toEqual([...xs].sort((a, b) => a - b))
  })

  it('⭐ the table\'s average row: TradingView\'s address, text and colour', () => {
    const { cap, tables } = runTd(true)
    expect(tables).toHaveLength(1)
    const cells = tables[0].cells
    expect(Array.isArray(cells)).toBe(true)
    const byAddr = new Map(cells.map((c) => [`${c.col},${c.row}`, c.props]))
    const vendor = cap.objects.records.tableCells.filter((c) => c.row === 11)
    expect(vendor.map((c) => [c.col, c.t])).toEqual([[1, '23'], [2, '19']])
    for (const v of vendor) {
      const p = byAddr.get(`${v.col},${v.row}`)
      expect(p, `cell ${v.col},${v.row}`).toBeTruthy()
      expect(p.text).toBe(v.t)
      expect(p.text_color.toUpperCase()).toBe(hexOf(v.tc))
    }
    // ⭐ C22 × C25 — the two headers `if i == 0` writes inside the loop
    const heads = cap.objects.records.tableCells.filter((c) => c.row === 0)
    expect(heads.map((c) => [c.col, c.t])).toEqual([[1, 'Trend ↑'], [2, 'Trend ↓']])
    for (const v of heads) {
      const p = byAddr.get(`${v.col},${v.row}`)
      expect(p, `cell ${v.col},${v.row}`).toBeTruthy()
      expect(p.text).toBe(v.t)
      expect(p.text_color.toUpperCase()).toBe(hexOf(v.tc))
    }
    // ⭐ C32 — and the 30 cells read by the loop counter (`vendorHarness.c32Collections`)
    expect(cells).toHaveLength(34)
    // every cell we draw is one of TradingView's
    const vend = new Set(cap.objects.records.tableCells.map((c) => `${c.col},${c.row},${c.t}`))
    for (const c of cells) expect(vend.has(`${c.col},${c.row},${c.props.text}`), `${c.col},${c.row}`).toBe(true)
  })

  it('⛔ no line: TradingView\'s `LengthLine` is extended off a getter this lane refuses, so ours is withheld, not drawn short', () => {
    const { cap, lines, run } = runTd(true)
    expect(cap.objects.records.lines).toHaveLength(1)
    expect(lines).toEqual([])
    expect(run.status).toBe('ok')
  })

  it('behind the curtain (listing fact withheld): nothing drawn that TradingView lacks', () => {
    const { cap, labels, lines } = runTd(false)
    const vend = new Set(cap.objects.records.labels.map((l) => `${l.t}|${l.y}`))
    for (const l of labels) expect(vend.has(`${l.props.text}|${l.props.y}`), l.props.text).toBe(true)
    expect(lines).toEqual([])
  })
})

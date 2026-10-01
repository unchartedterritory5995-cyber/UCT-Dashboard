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
//   * 27 of TradingView's 28 labels, each its text and its y, in its creation
//     order — every label we draw is one of TradingView's;
//   * the table's average row, "23" and "19", at TradingView's addresses and
//     text colours;
//   * ⭐ C43 — THE LINE, and `LabelProbLen` (id 82). `LengthLine.set_x2(
//     LengthLine.get_x1() + bullishCount.avg() + 1)` is a getter in arithmetic
//     over an `array<int>` average: the exact float mean (22.6), the sum
//     TRUNCATED into the `int` x (`vw-int-array-avg-spy-1d-2026-09-30`) — x2 =
//     x1 + 23. The label sits at `int(math.avg(get_x1(), get_x2()))` = x1 + 11
//     and reads `Probable Length\n23`: the window read between its add and its
//     removal, exact on every bar no add ran (`objectWindowPositions`). Both at
//     TradingView's x RANK (the capture stores x as a dense rank) and y.
//     ⚰️ C22 held the line (it was drawn one bar long before) and the label.
// ⛔ WHAT IS NOT DRAWN, named:
//   * TradingView's first label (id 2, bar 58): our `trend` reads `na` until the
//     HMA exists (`ta.rising` of `na`), so the first flip compares against `na`
//     and is not seen — withheld by construction, never guessed;
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

  it('⭐ from the listing: 27 labels, each TradingView\'s text and y, in its creation order', () => {
    const { cap, labels, lines } = runTd(true)
    expect(cap.history.startsAtBar0).toBe(true)
    const vendor = cap.objects.records.labels
    expect(vendor).toHaveLength(28)
    // the one we withhold, by id: the first flip's label
    const expected = vendor.filter((l) => l.id !== 2)
    expect(labels.map((l) => [l.props.text, l.props.y])).toEqual(expected.map((l) => [l.t, l.y]))
    // ⭐ C43 — the probable-length label (TradingView's id 82) is among them, last made
    expect(labels[labels.length - 1].props.text).toBe('Probable Length\n23')
    // and every x at TradingView's RANK: the capture stores x as a dense rank
    // over all its objects; ours lacks the withheld id 2, which is rank 0
    expect(vendor.find((l) => l.id === 2).x).toBe(0)
    const all = [...new Set([...labels.map((l) => l.props.x), ...lines.flatMap((l) => [l.props.x1, l.props.x2])])]
      .sort((a, b) => a - b)
    const rank = (x) => all.indexOf(x) + 1
    expect(labels.map((l) => rank(l.props.x))).toEqual(expected.map((l) => l.x))
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

  it('⭐ C43 — the line: TradingView\'s y, style and x ranks; x2 = x1 + trunc(mean + 1), the label at its middle', () => {
    const { cap, lines, labels, run } = runTd(true)
    expect(run.status).toBe('ok')
    const vendor = cap.objects.records.lines
    expect(vendor).toHaveLength(1)
    expect(lines).toHaveLength(1)
    const [v] = vendor
    const p = lines[0].props
    expect([p.y1, p.y2]).toEqual([v.y1, v.y2])
    expect(v.st).toBe('ar')
    expect(p.style).toBe('arrow_right')
    // ⭐ THE LENGTH, from the capture's own numbers: the open trend is bullish
    // (its label reads `Trend ↑ … Real Length`), so the line runs the mean of the
    // ten bullish lengths TradingView tabulates (column 1, rows 1–10), plus one,
    // the fraction dropped.
    const cells = cap.objects.records.tableCells
    const bull = cells.filter((c) => c.col === 1 && c.row >= 1 && c.row <= 10).map((c) => Number(c.t))
    expect(bull).toHaveLength(10)
    const mean = bull.reduce((s, x) => s + x, 0) / bull.length
    expect(Number.isInteger(mean)).toBe(false)                  // non-vacuity: a fraction is dropped
    expect(p.x2 - p.x1).toBe(Math.trunc(mean + 1))
    expect(Math.trunc(mean + 1)).not.toBe(Math.round(mean + 1)) // …and rounding would have drawn another bar
    // the flip label sits one bar right of x1, the probable-length label at the middle
    const flip = labels.find((l) => /Real Length/.test(l.props.text))
    const prob = labels.find((l) => /^Probable Length/.test(l.props.text))
    expect(flip.props.x).toBe(p.x1 + 1)
    expect(prob.props.x).toBe(Math.trunc((p.x1 + p.x2) / 2))
    expect(prob.props.y).toBe(v.y1)
    // ⭐ and every one of those x's at TradingView's RANK (the capture's x is a
    // dense rank over all its objects; ours lacks the withheld id 2, rank 0)
    const all = [...new Set([...labels.map((l) => l.props.x), p.x1, p.x2])].sort((a, b) => a - b)
    const rank = (x) => all.indexOf(x) + 1
    expect([rank(p.x1), rank(p.x2)]).toEqual([v.x1, v.x2])
    const v82 = cap.objects.records.labels.find((l) => l.id === 82)
    expect(rank(prob.props.x)).toBe(v82.x)
    expect(prob.props.text).toBe(v82.t)
    // the line runs PAST the last bar — a future x, as TradingView's does
    expect(p.x2).toBeGreaterThan(cap.bars.count - 1)
  })

  it('behind the curtain (listing fact withheld): nothing drawn that TradingView lacks', () => {
    const { cap, labels, lines } = runTd(false)
    const vend = new Set(cap.objects.records.labels.map((l) => `${l.t}|${l.y}`))
    for (const l of labels) expect(vend.has(`${l.props.text}|${l.props.y}`), l.props.text).toBe(true)
    // ⭐ C43 — a line drawn there is TradingView's own: its y, and its length
    const [v] = cap.objects.records.lines
    for (const l of lines) {
      expect([l.props.y1, l.props.y2]).toEqual([v.y1, v.y2])
      expect(l.props.x2 - l.props.x1).toBe(23)
    }
  })
})

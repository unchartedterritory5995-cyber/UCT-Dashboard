// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.c32Collections.test.js
//
// ─── C32 — TREND-DURATION'S TABLE, READ BY THE LOOP COUNTER, AGAINST TRADINGVIEW ─
//
// Captured on a live TradingView chart 2026-09-28 (NYSE:RDDT 1D, 632 bars from
// the listing day). On the last bar the script tabulates its two windows of
// trend lengths (`samples` = 10 each):
//
//     for i = 0 to bullishCount.size() - 1
//         tbl.cell(0, i + 1, str.tostring(i + 1), tooltip = "Sample index …")
//         lenBull = bullishCount.get(i)
//         tbl.cell(1, i + 1, str.tostring(lenBull),
//              tooltip = "Duration of bullish trend #" + str.tostring(i + 1) + " (" + str.tostring(lenBull) + " bars)")
//         lenBear = bearishCount.get(i) …
//
// ⭐ AND ARTEMIS-OSCILLATOR-PRO'S `kSize` CELL: `str.tostring(kSize) + " bars"`
// where `kSize = array.size(knnF1)` is read ABOVE the statement that fills a
// 100-slot window (cap `knnLen`, an `int`-typed input) — last bar's length, of a
// window wider than MAX_WINDOW_CAP, read for its length only (`sizePrev`,
// `sizeOnly`; `objectWindowLength.test.js`). TradingView: `100 bars` at (1, 2).
//
// ⭐ WHAT IS PINNED: all 34 of TradingView's cells — the 30 per-pass cells C32
// serves (`{t:'val'}` over the counter and `{v:'wget'}` over the window) and the
// four C22/C25 served before — each at TradingView's address with its text, its
// tooltip and (except `chart.fg_color`, the theme's) its text colour; from the listing, and behind the curtain (every
// cell drawn there is one of TradingView's).
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

describe("⭐ C32 — trend-duration-forecast's per-pass table cells are TradingView's", () => {
  afterEach(() => { vi.unstubAllEnvs() })

  const runTd = (historyFromListing) => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    const loaded = loadCapture(FILE)
    expect(loaded.capture, loaded.reason).toBeTruthy()
    const cap = loaded.capture
    const bars = toProductBars(cap)
    const d = memberPaneDefinition({ source: cap.source.text, id: 'u_c32_td', name: 'td' })
    expect(d.ok, d.reason).toBe(true)
    const reader = objectReaderFor(d.definition, bars, {
      tf: 'D', symbol: { ticker: 'RDDT', exchange: 'NYSE' }, newestBarIsForming: cap.newestBarIsForming ?? null,
      historyFromListing,
    })
    const run = evaluateObjects(reader.program, {
      barCount: bars.length, readNode: reader.readNode, readTime: reader.readTime, readUnknown: reader.readUnknown,
    })
    const tables = run.live.filter((o) => o.family === 'table')
    return { cap, run, tables }
  }

  it('⭐ from the listing: all 34 cells at TradingView\'s address, with its text, text colour and tooltip', () => {
    const { cap, run, tables } = runTd(true)
    expect(cap.history.startsAtBar0).toBe(true)
    expect(run.status).toBe('ok')
    expect(tables).toHaveLength(1)
    const vendor = cap.objects.records.tableCells
    expect(vendor).toHaveLength(34)
    const ours = new Map(tables[0].cells.map((c) => [`${c.col},${c.row}`, c.props]))
    expect(ours.size).toBe(34)
    for (const v of vendor) {
      const p = ours.get(`${v.col},${v.row}`)
      expect(p, `cell ${v.col},${v.row}`).toBeTruthy()
      expect(p.text, `text ${v.col},${v.row}`).toBe(v.t)
      // ⭐ C37 — `chart.fg_color` (the data columns) is the CHART'S OWN colour:
      // carried as a theme reference and resolved where it is drawn, against the
      // member's chart (`objectTheme.js`). ⛔ Never asserted as TradingView's —
      // the capture records TradingView's theme (`#0f0f0f` on white), ours is a
      // different chart (`vendorHarness.c37Theme` grades it theme-relative).
      const fg = v.col >= 1 && v.row >= 1 && v.row <= 10
      if (fg) expect(p.text_color, `text colour ${v.col},${v.row}`).toBe('chart.fg_color')
      else expect(String(p.text_color).toUpperCase(), `text colour ${v.col},${v.row}`).toBe(hexOf(v.tc))
      expect(p.tooltip, `tooltip ${v.col},${v.row}`).toBe(v.tt)
    }
    // ⛔ NON-VACUITY: the per-pass columns are really per pass (ten distinct
    // indices; the bull column is not one value repeated)
    const col = (c) => vendor.filter((v) => v.col === c && v.row >= 1 && v.row <= 10).map((v) => ours.get(`${c},${v.row}`).text)
    expect(new Set(col(0)).size).toBe(10)
    expect(new Set(col(1)).size).toBeGreaterThan(5)
  })

  it('behind the curtain (listing fact withheld): every cell drawn is TradingView\'s', () => {
    const { cap, tables } = runTd(false)
    const vend = new Set(cap.objects.records.tableCells.map((c) => `${c.col},${c.row},${c.t}`))
    for (const t of tables) {
      for (const c of t.cells) expect(vend.has(`${c.col},${c.row},${c.props.text}`), `${c.col},${c.row} ${c.props.text}`).toBe(true)
    }
  })
})

const ARTEMIS = path.resolve(process.cwd(), '..',
  'tests/fixtures/vendor/harness/artemis-oscillator-pro-rddt-1d-2026-09-28.json')

describe("⭐ C32 — artemis-oscillator-pro's KNN memory length is TradingView's", () => {
  afterEach(() => { vi.unstubAllEnvs() })

  const runArt = (historyFromListing) => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    const loaded = loadCapture(ARTEMIS)
    expect(loaded.capture, loaded.reason).toBeTruthy()
    const cap = loaded.capture
    const bars = toProductBars(cap)
    const d = memberPaneDefinition({ source: cap.source.text, id: 'u_c32_art', name: 'art' })
    expect(d.ok, d.reason).toBe(true)
    const reader = objectReaderFor(d.definition, bars, {
      tf: 'D', symbol: { ticker: 'RDDT', exchange: 'NYSE' }, newestBarIsForming: cap.newestBarIsForming ?? null,
      historyFromListing,
    })
    const run = evaluateObjects(reader.program, {
      barCount: bars.length, readNode: reader.readNode, readTime: reader.readTime, readUnknown: reader.readUnknown,
    })
    const knn = run.live.filter((o) => o.family === 'table')
      .find((t) => (t.cells || []).some((c) => c.props.text === 'KNN AI'))
    return { cap, run, knn }
  }

  it("⭐ from the listing: cell (1, 2) reads `100 bars`, TradingView's text at TradingView's address", () => {
    const { cap, knn } = runArt(true)
    expect(knn, 'the KNN panel').toBeTruthy()
    const vendorKnnCells = cap.objects.records.tableCells.filter((c) => c.t === '100 bars')
    expect(vendorKnnCells.map((c) => [c.col, c.row])).toEqual([[1, 2]])
    const ours = knn.cells.find((c) => c.col === 1 && c.row === 2)
    expect(ours, 'cell (1, 2)').toBeTruthy()
    expect(ours.props.text).toBe('100 bars')
  })

  it("behind the curtain (listing fact withheld): the cell, if drawn, is TradingView's", () => {
    const { knn } = runArt(false)
    const ours = knn && knn.cells.find((c) => c.col === 1 && c.row === 2)
    if (ours) expect(ours.props.text).toBe('100 bars')
  })
})

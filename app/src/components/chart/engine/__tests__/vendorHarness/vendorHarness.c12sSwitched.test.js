// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.c12sSwitched.test.js
//
// ─── C12s — SWITCHED COUNTERS, AGAINST TRADINGVIEW ────────────────────────────
//
// `artemis-oscillator-pro` counts consecutive weakening bars above its OB level:
//
//     var int meObCount = 0
//     meObCount := meObWeak ? meObCount + 1 : 0
//
// and prints `✦ OB` where the count reaches 4. The `self + 1` arm never forgets
// its seed, so the bounded window refused it (`pine:state`, C17 named it) and the
// three `✦ OB` TradingView draws were never created. C12s serves it as a SWITCHED
// recurrence (`interpret.js::switchedVarSeed`): from the last bar `meObWeak` was
// false the count is Pine's own, whatever came before, and a bar is published only
// where the data shows that reset inside the window.
//
// `ema-ribbon-trend-filter-strixedge` holds a bars-in-trend counter of the same
// shape; its table cell (col 3, row 1) now reads TradingView's `8`.
//
// ⭐ WHAT IS PINNED, against the captures (NYSE:RDDT 1D, 632 bars — the whole
// listing, `startsAtBar0`):
//   - from the listing (C12w) artemis draws the three `✦ OB` TradingView draws,
//     id for id, at its y;
//   - behind the curtain (a chart that does not start at the listing) every
//     `✦ OB` it draws is one of those three, and every label it draws is one the
//     listing run draws too — the switched window is never MORE known than Pine;
//   - `R▼` (C19): its guard tree measured 132 nodes against the 128-node budget
//     until the budget counted what the pass computes; now TradingView's id 16,
//     and every label from the listing id for id;
//   - ema-ribbon's (3, 1) cell is TradingView's text, colour and background.
import { describe, it, expect, vi, afterEach } from 'vitest'
import path from 'node:path'

import { loadCapture } from './harness'
import { toProductBars } from './ourSide'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import { objectReaderFor } from '../../objectColumns'
import { evaluateObjects } from '../../objectRuntime'

const DIR = path.resolve(process.cwd(), '..', 'tests/fixtures/vendor/harness')
const capture = (f) => {
  const loaded = loadCapture(path.join(DIR, f))
  if (!loaded.capture) throw new Error(`not a capture — ${loaded.reason}`)
  return loaded.capture
}

afterEach(() => { vi.unstubAllEnvs() })

function memberRun(cap, { listing = false } = {}) {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  const bars = toProductBars(cap)
  const d = memberPaneDefinition({ source: cap.source.text, id: 'u_c12s_switched', name: 'c12s' })
  expect(d.ok, d.reason).toBe(true)
  const reader = objectReaderFor(d.definition, bars, {
    tf: 'D', symbol: { ticker: 'RDDT', exchange: 'NYSE' }, newestBarIsForming: cap.newestBarIsForming ?? null,
    ...(listing ? { historyFromListing: true } : {}),
  })
  const run = evaluateObjects(reader.program, {
    barCount: bars.length, readNode: reader.readNode, readTime: reader.readTime, readUnknown: reader.readUnknown,
  })
  return { d, reader, run, bars }
}

const ARTEMIS = 'artemis-oscillator-pro-rddt-1d-2026-09-28.json'
const OB = '✦ OB'

describe('C12s — artemis-oscillator-pro: the exhaustion counter is TradingView\'s', () => {
  it('⭐ the four creates C17 named now convert — nothing dropped as `guard:create`', () => {
    const { d } = memberRun(capture(ARTEMIS))
    expect(d.translation.objectDiagnostics.dropReasons['guard:create']).toBeUndefined()
  })

  it('⭐ from the listing: TradingView\'s three `✦ OB`, id for id, at its y', () => {
    const cap = capture(ARTEMIS)
    expect(cap.history.startsAtBar0).toBe(true)
    const { run } = memberRun(cap, { listing: true })
    const vendor = cap.objects.records.labels.filter((l) => l.t === OB).sort((a, b) => a.id - b.id)
    expect(vendor).toHaveLength(3)
    const ours = run.live.filter((o) => o.family === 'label' && o.props.text === OB).sort((a, b) => a.id - b.id)
    expect(ours.map((o) => o.id)).toEqual(vendor.map((l) => l.id))
    // the y is `oscVal + 7`; the two lanes' float order of operations may differ in
    // the last bit, so it is compared within 1e-12 relative, never rounded to a tick
    ours.forEach((o, i) => expect(Math.abs(o.props.y - vendor[i].y) / vendor[i].y, `✦ OB id ${o.id}`).toBeLessThan(1e-12))
  })

  it('⭐ behind the curtain: every `✦ OB` drawn is TradingView\'s, and no label is drawn the listing run does not draw', () => {
    const cap = capture(ARTEMIS)
    const curtain = memberRun(cap).run.live.filter((o) => o.family === 'label')
    const listed = memberRun(cap, { listing: true }).run.live.filter((o) => o.family === 'label')
    const vendorY = cap.objects.records.labels.filter((l) => l.t === OB).map((l) => l.y)
    const ob = curtain.filter((o) => o.props.text === OB)
    expect(ob.length).toBeGreaterThan(0) // non-vacuity: the curtain case serves them
    for (const o of ob) {
      expect(vendorY.some((y) => Math.abs(o.props.y - y) / y < 1e-12), `✦ OB at ${o.props.y}`).toBe(true)
    }
    const key = (o) => `${o.props.text}@${o.props.x}@${o.props.y}`
    const listedKeys = new Set(listed.map(key))
    for (const o of curtain) expect(listedKeys.has(key(o)), key(o)).toBe(true)
  })

  // ⭐ C19 (2026-09-30) — THIS WAS `⛔ R▼ stays unmade … the guard is over the node
  // budget` (132 > 128). The integrator's ruling counts what the evaluator
  // computes (`interpret.js::evaluationUnits`): standalone the `R▼` guard is
  // still 132 units, and 36 against the columns earlier trees of the SAME pass
  // already hold — read
  // through the interner and `crossMemo` without walking below them. So it costs
  // what it computes itself, and the cap stays 128.
  it('⭐ from the listing: `R▼` is TradingView\'s — id 16, at its y — and every label is, id for id', () => {
    const cap = capture(ARTEMIS)
    const { reader, run } = memberRun(cap, { listing: true })
    expect(reader.refusals || []).toEqual([])
    const vendor = cap.objects.records.labels.slice().sort((a, b) => a.id - b.id)
    const ours = run.live.filter((o) => o.family === 'label').sort((a, b) => a.id - b.id)
    expect(ours.map((o) => [o.id, o.props.text])).toEqual(vendor.map((l) => [l.id, l.t]))
    const rv = ours.find((o) => o.props.text === 'R▼')
    const rvVendor = vendor.find((l) => l.t === 'R▼')
    expect(rv.id).toBe(16)
    expect(Math.abs(rv.props.y - rvVendor.y) / rvVendor.y).toBeLessThan(1e-12)
    // it sits on the divergence it confirms: the same bar and y as `D▼` id 15
    const d15 = ours.find((o) => o.id === 15)
    expect([rv.props.x, rv.props.y]).toEqual([d15.props.x, d15.props.y])
  })
})

describe('C12s — ema-ribbon-trend-filter-strixedge: the bars-in-trend cell', () => {
  it('⭐ cell (3, 1) is TradingView\'s `8`, in its colour, on its background', () => {
    const cap = capture('ema-ribbon-trend-filter-strixedge-rddt-1d-2026-09-28.json')
    const vendor = cap.objects.records.tableCells.find((c) => c.col === 3 && c.row === 1)
    expect(vendor.t).toBe('8')
    // the capture stores a colour as 0xAABBGGRR (little-endian RGBA)
    const hex = (c) => `#${[c & 0xff, (c >>> 8) & 0xff, (c >>> 16) & 0xff].map((x) => x.toString(16).padStart(2, '0')).join('')}`
    for (const listing of [true, false]) {
      const table = memberRun(cap, { listing }).run.live.find((o) => o.family === 'table')
      const cell = table.cells.find((c) => c.col === 3 && c.row === 1)
      expect(cell, `listing=${listing}`).toBeTruthy()
      expect([cell.props.text, cell.props.text_color, cell.props.bgcolor])
        .toEqual([vendor.t, hex(vendor.tc), hex(vendor.bgc)])
    }
  })
})

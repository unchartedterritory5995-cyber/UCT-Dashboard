// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.c22Vdubus.test.js
//
// ─── C22 — VDUBUS PATTERN GEN V2, AGAINST TRADINGVIEW ────────────────────────
//
// Captured on a live TradingView chart 2026-09-28 (NYSE:RDDT 1D, 632 bars from
// the listing day). `f_runEngine` is called twice (fast depth 9, slow depth 24),
// each call keeping its OWN zigzag in a `var` array declared in the function
// body and added to at two places (a pivot high, a pivot low). At each new
// point it checks the MACD histogram's pivots (two top-level windows) for a
// standard / climax / predator reversal and draws the XABCD structure: fill
// lines and two linefills (both engines), outline lines and a label (slow).
//
// ⛔ Before C22 every one of its 148 drawing steps was dropped
// (`pine:collection`: the zigzag "nothing in this script creates"), and the
// objects-only pane showed nothing.
//
// ⭐ WHAT IS PINNED: all 112 of TradingView's lines — each its x (the capture's
// dense rank), y, width and colour, in creation order; all 48 linefills,
// joining the same two lines; all 5 labels, text and place.
// ⛔ WHAT IS STILL REFUSED, named: the standard pattern's label (`"Bearish " +
// rawName` — text joined from a per-bar choice), and the dashboard's cell
// (off by default). Neither is drawn by TradingView on this chart either.
import { describe, it, expect, vi, afterEach } from 'vitest'
import path from 'node:path'

import { loadCapture } from './harness'
import { toProductBars } from './ourSide'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import { objectReaderFor } from '../../objectColumns'
import { evaluateObjects } from '../../objectRuntime'

const FILE = path.resolve(process.cwd(), '..',
  'tests/fixtures/vendor/harness/vdubus-pattern-gen-v2-restored-refined-rddt-1d-2026-09-28.json')

/** A capture colour (0xAABBGGRR) as `#RRGGBBAA`. */
const hexOf = (n) => {
  const r = n & 0xff
  const g = (n >>> 8) & 0xff
  const b = (n >>> 16) & 0xff
  const a = (n >>> 24) & 0xff
  return `#${[r, g, b, a].map((x) => x.toString(16).padStart(2, '0')).join('')}`.toUpperCase()
}
/** Ours as `#RRGGBBAA` (a 7-character colour is opaque). */
const ours = (c) => (String(c).length === 7 ? `${c}FF` : String(c)).toUpperCase()

describe('⭐ C22 — vdubus-pattern-gen draws TradingView\'s zigzag structures', () => {
  afterEach(() => { vi.unstubAllEnvs() })

  const runVd = (historyFromListing) => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    const loaded = loadCapture(FILE)
    expect(loaded.capture, loaded.reason).toBeTruthy()
    const cap = loaded.capture
    const bars = toProductBars(cap)
    const d = memberPaneDefinition({ source: cap.source.text, id: 'u_c22_vd', name: 'vd' })
    expect(d.ok, d.reason || '').toBe(true)
    const reader = objectReaderFor(d.definition, bars, {
      tf: 'D', symbol: { ticker: 'RDDT', exchange: 'NYSE' },
      newestBarIsForming: cap.newestBarIsForming ?? null, historyFromListing,
    })
    const run = evaluateObjects(reader.program, {
      barCount: bars.length, readNode: reader.readNode, readTime: reader.readTime, readUnknown: reader.readUnknown,
    })
    return { cap, d, run, reader }
  }

  it('⭐ all 112 lines: TradingView\'s x rank, y, width and colour, in creation order', () => {
    const { cap, run } = runVd(true)
    const vLines = cap.objects.records.lines
    const oLines = run.live.filter((o) => o.family === 'line').sort((a, b) => a.id - b.id)
    const oLabels = run.live.filter((o) => o.family === 'label')
    expect(vLines).toHaveLength(112)
    expect(oLines).toHaveLength(112)
    const xs = [...new Set([...oLines.flatMap((l) => [l.props.x1, l.props.x2]), ...oLabels.map((l) => l.props.x)])]
      .sort((a, b) => a - b)
    const rank = new Map(xs.map((x, i) => [x, i]))
    oLines.forEach((o, k) => {
      const v = vLines[k]
      expect([rank.get(o.props.x1), rank.get(o.props.x2)]).toEqual([v.x1, v.x2])
      expect(o.props.y1).toBeCloseTo(v.y1, 2)
      expect(o.props.y2).toBeCloseTo(v.y2, 2)
      expect(o.props.width).toBe(v.w)
      expect(ours(o.props.color)).toBe(hexOf(v.ci))
    })
  })

  it('⭐ all 48 linefills join the same two lines TradingView\'s do', () => {
    const { cap, run } = runVd(true)
    const vLines = cap.objects.records.lines
    const vFills = cap.objects.records.linefills
    const oLines = run.live.filter((o) => o.family === 'line').sort((a, b) => a.id - b.id)
    const oFills = run.live.filter((o) => o.family === 'linefill').sort((a, b) => a.id - b.id)
    expect(vFills).toHaveLength(48)
    expect(oFills).toHaveLength(48)
    const vIdx = new Map(vLines.map((l, i) => [l.id, i]))
    const oIdx = new Map(oLines.map((l, i) => [l.id, i]))
    oFills.forEach((o, k) => {
      const v = vFills[k]
      expect([oIdx.get(o.props.line1.__ref), oIdx.get(o.props.line2.__ref)]).toEqual([vIdx.get(v.line1), vIdx.get(v.line2)])
      expect(ours(o.props.color)).toBe(hexOf(v.ci))
    })
  })

  it('⭐ all 5 labels: text, rank and y', () => {
    const { cap, run } = runVd(true)
    const vLabels = cap.objects.records.labels
    const oLines = run.live.filter((o) => o.family === 'line')
    const oLabels = run.live.filter((o) => o.family === 'label').sort((a, b) => a.id - b.id)
    const xs = [...new Set([...oLines.flatMap((l) => [l.props.x1, l.props.x2]), ...oLabels.map((l) => l.props.x)])]
      .sort((a, b) => a - b)
    const rank = new Map(xs.map((x, i) => [x, i]))
    expect(oLabels.map((o) => [o.props.text, rank.get(o.props.x), Number(o.props.y.toFixed(3))]))
      .toEqual(vLabels.map((v) => [v.t, v.x, Number(v.y.toFixed(3))]))
  })

  it('behind the curtain (listing fact withheld): nothing drawn that TradingView lacks', () => {
    const full = runVd(true).run
    const { run } = runVd(false)
    const key = (o) => `${o.family}:${JSON.stringify(o.props)}`
    const fullKeys = new Set(full.live.map(key))
    for (const o of run.live) expect(fullKeys.has(key(o))).toBe(true)
  })

  it('⛔ what stays refused is named, not drawn', () => {
    const { d, reader } = runVd(true)
    const diag = d.translation.objectDiagnostics
    // ⭐ C31 — the four `label.new(xD, yD, patName, …)` creates of `f_drawStruct`
    // convert now: `patName` is `f_getHarmonicName`'s LOCAL (`name`, an `if`
    // chain over literals), and a helper's own locals are visible to the text
    // reader. The capture's five labels are unchanged (the test above).
    expect(diag.dropReasons).toEqual({ 'cell:text': 1 })
    expect(reader.failed.length).toBeLessThanOrEqual(1)
  })
})

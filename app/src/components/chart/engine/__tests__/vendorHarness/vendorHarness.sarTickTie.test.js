// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.sarTickTie.test.js
//
// ─── `math.round_to_mintick` ON A HALF TICK — parabolic-sar's label, on the vendor's own bars ───
//
// `parabolic-sar-spy-1d-2026-11-15`: on 2025-09-30 the script's `label.new(…, text =
// tostring(round_to_mintick(sar)))` sits at y 654.405 and TradingView printed "654.41". We printed
// "654.4": both lanes wrote the builtin as `math.round(x / syminfo.mintick) * syminfo.mintick`, and
// 654.405 / 0.01 is 65440.49999999999 in binary (it rounds DOWN), while 654.405 * 100 is 65440.5
// exactly. Both lanes now write `math.round(x * (1 / syminfo.mintick)) * syminfo.mintick`
// (`pine.js::resolveTableCall`, `pineRuntimeFrontend.js` RT5).
//
// The Pine reference (v4, v5, v6, one sentence): "Returns the value rounded to the symbol's mintick,
// i.e. the nearest value that can be divided by syminfo.mintick, without the remainder, with ties
// rounding up." It says ties round UP; it does not say whether a tie is the decimal value (654.405)
// or the binary double (654.40499999999997…, a hair under the half).
//
// ⛔ ONE WITNESS, AND WHAT IT DOES NOT SETTLE. Three readings give 654.41 here (multiply by the price
// scale; a tolerance on `x / tick`; the shortest decimal, a tie up). This one is consistent with the
// capture and moves no other committed answer (the 26 captures whose script calls `round_to_mintick`,
// re-graded on both lanes: one row moved, this one): it moves a decimal tie only where `x * scale`
// lands on the half, always UP, and it leaves 1.005 at 1.00, which is also what TradingView's
// `format.mintick` prints for it (`vw-fmt-tie-readings` T08); the other two readings give 1.01.
// `vw-round-to-mintick-ties` settles it (K02 1.005, K03 163.265 part the readings at 0.01;
// `docs/pine/capture-queue-2026-11-16-tick-tie-and-htf-windows.md`). Helper: `ast/tickRound.js`.
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { gradeCapture, loadCapture, HARNESS_DIR } from './harness'
import { runOurSide } from './ourSide'
import { sha256Hex, sealCapture } from '../../../../../../../tools/vendor_harness/schema.mjs'
import SYMBOL_SCOPE from '../../ast/symbolScope.json'
import { roundToMintickTree } from '../../ast/tickRound.js'

afterEach(() => { vi.unstubAllEnvs() })
const T = 600000
const SPY = 'parabolic-sar-spy-1d-2026-11-15'
const RDDT = 'parabolic-sar-rddt-1d-2026-11-15'
const cap = (id) => loadCapture(path.join(HARNESS_DIR, `${id}.json`)).capture
const objectsPane = () => vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
const runtimePane = () => { objectsPane(); vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1') }
const hostOnly = () => { objectsPane(); vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '') }

/** The bar whose LOW is the witnessed value (the SAR flips onto it four bars later). */
const TIE_BAR_T = 1758807000
const TIE = 654.405

/** A probe printing each expression in its own table cell on the last bar (H5's shape), through the
 *  member door on the capture's own bars. */
function cellsThroughTheDoor(capture, exprs) {
  const text = [
    '//@version=6',
    "indicator('sar tick tie', overlay = true)",
    ...exprs.map((e, i) => `v${i} = ${e}`),
    `var table t = table.new(position.top_right, 1, ${exprs.length})`,
    'if barstate.islast',
    ...exprs.map((_, i) => `    table.cell(t, 0, ${i}, str.tostring(v${i}))`),
    '',
  ].join('\n')
  const ours = runOurSide(sealCapture({ ...capture, source: { ...capture.source, text, sha256: sha256Hex(text) } }))
  expect(ours.ok, ours.refusal).toBe(true)
  expect(ours.objects && ours.objects.ok, JSON.stringify(ours.objects)).toBe(true)
  return ours.objects.texts.tableCells
}

describe('the capture is what this file says it is', () => {
  it('TradingView printed "654.41" on a label at y 654.405, tick 0.01; the bar\'s low is that value', () => {
    const c = cap(SPY)
    expect(c.symbol.minmov / c.symbol.pricescale).toBe(0.01)
    const label = c.objects.records.labels.find((l) => l.t === '654.41')
    expect(label && label.y).toBe(TIE)
    expect(c.objects.texts.labels).not.toContain('654.4')
    const k = c.bars.rows.findIndex((r) => r[0] === TIE_BAR_T)
    expect(c.bars.rows[k][3]).toBe(TIE)
    // the arithmetic of the defect: the quotient is below the half, the product is on it
    expect(TIE / 0.01).toBe(65440.49999999999)
    expect(TIE * (1 / 0.01)).toBe(65440.5)
  })

  it('every tick this engine serves has an exact reciprocal (`1 / tick` IS the price scale)', () => {
    // the served rows are the ones carrying the vendor's two numbers (`_not_served` is the refused roster)
    const rows = Object.entries(SYMBOL_SCOPE.tick_size)
      .filter(([k, v]) => !k.startsWith('_') && v && typeof v === 'object')
    expect(rows.map(([k]) => k)).toEqual(expect.arrayContaining(['NASDAQ', 'NYSE', 'NYSE Arca']))
    for (const [exchange, { minmov, pricescale }] of rows) {
      expect(1 / (minmov / pricescale), exchange).toBe(pricescale / minmov)
      expect(Number.isInteger(pricescale / minmov), exchange).toBe(true)
    }
  })
})

describe('⭐ the runtime lane: parabolic-sar MATCHes on both symbols, the tie label included', () => {
  it.each([[SPY, 50], [RDDT, 52]])('%s: every label text is TradingView\'s', (id, n) => {
    runtimePane()
    const v = gradeCapture(cap(id)).verdict
    expect(v.verdict, v.objects && v.objects.reason).toBe('MATCH')
    expect(v.objects.verdict).toBe('MATCH')
    expect(v.objects.counts.find((c) => c.family === 'labels')).toMatchObject({ vendor: n, ours: n })
    const texts = v.objects.texts.find((t) => t.family === 'labels text')
    expect(texts).toMatchObject({ agree: true, onlyVendor: [], onlyOurs: [] })
  }, T)

  it('the run prints "654.41" for the tie (it printed "654.4")', () => {
    runtimePane()
    const o = runOurSide(cap(SPY))
    expect(o.ok, o.refusal).toBe(true)
    const texts = (o.objects.held || []).filter((h) => h.family === 'label').map((h) => String(h.props.text))
    expect(texts).toContain('654.41')
    expect(texts).not.toContain('654.4')
  }, T)
})

describe('⭐ the host lane prints the same text for the same value', () => {
  /** how many bars back from the newest the tie bar sits */
  const back = () => {
    const rows = cap(SPY).bars.rows
    return rows.length - 1 - rows.findIndex((r) => r[0] === TIE_BAR_T)
  }

  it('`str.tostring(math.round_to_mintick(low[k]))` on the tie bar is "654.41"', () => {
    hostOnly()
    const k = back()
    expect(k).toBeGreaterThan(0)
    const got = cellsThroughTheDoor(cap(SPY), [`math.round_to_mintick(low[${k}])`, `low[${k}]`])
    expect(got).toEqual(['654.41', '654.405'])
  }, T)

  it('⛔ CONTROL: the quotient form, written out, still prints "654.4" on that bar (the bar tells the two apart)', () => {
    hostOnly()
    const k = back()
    const got = cellsThroughTheDoor(cap(SPY), [`math.round(low[${k}] / syminfo.mintick) * syminfo.mintick`])
    expect(got).toEqual(['654.4'])
  }, T)

  it('what the one witness does not move: off a tie nothing changes, and 1.005 stays 1.00', () => {
    hostOnly()
    const got = cellsThroughTheDoor(cap(SPY), [
      'math.round_to_mintick(close / 3)', 'math.round(close / 3 / syminfo.mintick) * syminfo.mintick',
      'math.round_to_mintick(1.005 + close - close)', 'math.round_to_mintick(127.705 + close - close)',
      'math.round_to_mintick(0.125 + close - close)',
    ])
    expect(got[0]).toBe(got[1])
    // `format.mintick` prints 1.005 as "1.00" on TradingView (`vw-fmt-tie-readings` T08): same reading
    expect(got.slice(2)).toEqual(['1', '127.71', '0.13'])
  }, T)
})

describe('both lanes write ONE expression', () => {
  const ENGINE = path.resolve(__dirname, '../..')
  it('`roundToMintickTree` is `math.round(x * (1 / syminfo.mintick)) * syminfo.mintick`', () => {
    const x = { type: 'name', name: 'sar' }
    const tick = { type: 'name', name: 'syminfo.mintick', tok: undefined }
    const count = { type: 'binary', op: '*', tok: undefined, left: x,
      right: { type: 'binary', op: '/', tok: undefined, left: { type: 'number', value: 1, tok: undefined }, right: tick } }
    expect(roundToMintickTree(x, undefined, false)).toEqual({ type: 'binary', op: '*', tok: undefined, right: tick,
      left: { type: 'call', name: 'math.round', tok: undefined, args: [count] } })
    // the host lane's call arguments are `{name, value}` pairs
    expect(roundToMintickTree(x, undefined, true).left.args).toEqual([{ name: null, value: count }])
  })

  it.each(['ast/pine.js', 'ast/pineRuntimeFrontend.js'])('%s builds it there and nowhere else', (rel) => {
    const src = fs.readFileSync(path.join(ENGINE, rel), 'utf8')
    expect(src).toContain('roundToMintickTree(')
    // no second copy of the desugar: the lane writes no `math.round` call node of its own beside a tick
    expect(src).not.toMatch(/name: 'math\.round', tok[^\n]*\n[^\n]*(left: x, right: (mintick|tick)|right: (mintick|tick) \})/)
  })
})

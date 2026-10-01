// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.c35SimpleArg.test.js
//
// ─── C35 — A `simple` ARGUMENT SIZES A WINDOW PER CALL SITE, ON TRADINGVIEW'S BARS ─
//
// Captured on a live TradingView chart 2026-09-28 (NYSE:RDDT 1D, 632 bars from the
// listing day). `artemis-oscillator-pro` draws its oscillator from
//
//     drmEngine(series float src, simple int len, simple string method) =>
//         float pk    = ta.highest(src, len)
//         float vy    = ta.lowest (src, len)
//         …
//     float oscVal = drmEngine(drmSrc, drmLen, drmMethod)
//
// and TradingView plots `oscVal` as "DRM Oscillator" on every bar.
//
// ⭐ WHAT C35 SERVES. The runtime lane compiles one body per function and runs it
// at every call site, so `ta.highest(src, len)` over a frame slot had no length
// before bar 0 — `runtime:history-dynamic-offset@245`, artemis's first runtime
// wall. Pine's rule is that a `simple` argument is fixed for its call site: the
// window is constant per call site. The lane now folds each such argument in the
// caller's context (a literal, an input at its default) and compiles the body
// once per distinct set of values (`pineRuntimeFrontend.js::simpleSpecialisation`).
//
// ⛔ ARTEMIS ITSELF STILL STOPS IN THE RUNTIME LANE — on its NEXT wall, named:
// `drmEngine` calls `smooth(force, len, method)`, whose body is a `switch` over the
// `simple string` method (`pine:block@233`). So this rail runs the vendor's own
// `drmEngine` VERBATIM (lifted from the capture's source) with `smooth` replaced by
// the one arm TradingView takes at the captured inputs — `"RMA" => ta.rma(s, n)`
// (the method input's default, and the switch's default arm) — the substitution
// method C21 used for dual-view. Everything else is the vendor's text.
import { describe, it, expect } from 'vitest'
import path from 'node:path'

import { loadCapture } from './harness'
import { toProductBars } from './ourSide'
import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend'
import { lowerIrProgram } from '../../runtime/lowerIr'
import { execute } from '../../runtime/vm'

const FILE = path.resolve(process.cwd(), '..',
  'tests/fixtures/vendor/harness/artemis-oscillator-pro-rddt-1d-2026-09-28.json')

const load = () => {
  const loaded = loadCapture(FILE)
  if (!loaded.capture) throw new Error(`not a capture — ${loaded.reason}`)
  return loaded.capture
}

/** The vendor's `drmEngine` definition, verbatim: its header line through the
 *  last indented line of its body. */
function drmEngineOf(source) {
  const lines = source.split(/\r?\n/)
  const at = lines.findIndex((l) => l.startsWith('drmEngine('))
  expect(at, 'drmEngine is defined in the captured source').toBeGreaterThan(0)
  const out = [lines[at]]
  for (let i = at + 1; i < lines.length && /^\s+\S/.test(lines[i]); i += 1) out.push(lines[i])
  expect(out.length, 'the definition has its seven body lines').toBe(8)
  return out.join('\n')
}

const script = (source, call) => [
  '//@version=6',
  'indicator("c35 simple argument")',
  // the captured default of the script's own `drmLen` input
  'int drmLen = input.int(14, "Period")',
  // the arm `smooth`'s `switch` takes at the captured method, "RMA"
  'smooth(series float s, simple int n, simple string m) => ta.rma(s, n)',
  drmEngineOf(source),
  `plot(${call})`,
  '',
].join('\n')

function run(src, rows) {
  const built = buildRuntimeIr(src, { bars: rows, inputs: {}, pane: true, basePeriod: 'D', tf: 'D' })
  if (!built.ok) return { refusal: built.refusal, diagnostics: built.diagnostics }
  const program = lowerIrProgram(built.ir)
  const series = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(rows.map((b) => b[k])))
  const res = execute(program, {
    bars: rows.length, series, columns: program.columns, confirmed: true, barTimes: rows.map((b) => b.t),
  })
  return { column: Array.from(res.outputs[0]), diagnostics: built.diagnostics }
}

describe('C35 — a `simple` argument sizes its window per call site (artemis, RDDT 1D)', () => {
  it('⭐⭐ the vendor\'s own `drmEngine`, called with the captured input, IS TradingView\'s DRM Oscillator on every bar', () => {
    const cap = load()
    const rows = toProductBars(cap)
    const fields = cap.plotValues.fields
    const vendor = cap.plotValues.rows.map((r) => r[fields.indexOf('plot_7')])
    const title = cap.study.plots.find((p) => p.id === 'plot_7')
    expect(title && title.title, 'plot_7 is the oscillator').toBe('DRM Oscillator')

    const r = run(script(cap.source.text, 'drmEngine(close, drmLen, "RMA")'), rows)
    expect(r.refusal, r.refusal && r.refusal.message).toBeUndefined()
    // `drmEngine`'s call, and inside it the two `smooth(…, len, …)` calls — each a
    // `simple` length fixed by its call site.
    expect(r.diagnostics.specialisedCalls, 'the calls were served by per-call-site copies').toBe(3)
    let compared = 0
    const off = []
    for (let i = 0; i < rows.length; i += 1) {
      const v = vendor[i]
      if (v === null || v === undefined) continue
      compared += 1
      const ours = r.column[i]
      if (!(Math.abs(ours - v) <= 1e-9 * Math.max(1, Math.abs(v)))) off.push(`bar ${i}: ours ${ours} vendor ${v}`)
    }
    // ⛔ NON-VACUITY: every bar of the capture carries the oscillator.
    expect(compared).toBe(rows.length)
    expect(off.slice(0, 5), `${off.length} bars disagree`).toEqual([])
  }, 60000)

  it('⭐ two call sites with different lengths run two windows, each its own call site\'s', () => {
    const cap = load()
    const rows = toProductBars(cap)
    const both = run(script(cap.source.text, 'drmEngine(close, 14, "RMA") - drmEngine(close, 5, "RMA")'), rows)
    const at14 = run(script(cap.source.text, 'drmEngine(close, 14, "RMA")'), rows)
    const at5 = run(script(cap.source.text, 'drmEngine(close, 5, "RMA")'), rows)
    expect(both.diagnostics.specialisedCalls).toBe(6)
    const diff = at14.column.map((v, i) => v - at5.column[i])
    let differing = 0
    for (let i = 0; i < rows.length; i += 1) {
      if (Number.isNaN(diff[i])) { expect(Number.isNaN(both.column[i]), `bar ${i}`).toBe(true); continue }
      expect(both.column[i]).toBeCloseTo(diff[i], 9)
      if (Math.abs(at14.column[i] - at5.column[i]) > 1e-6) differing += 1
    }
    // ⛔ CONTROL: the two windows really differ, so one shared window would be caught.
    expect(differing).toBeGreaterThan(300)
  }, 60000)

  it('⛔ an argument only known while the bar runs is refused BY NAME, never sized', () => {
    const cap = load()
    const rows = toProductBars(cap)
    const r = run(script(cap.source.text, 'drmEngine(close, bar_index % 7 + 2, "RMA")'), rows)
    expect(r.refusal && r.refusal.guard).toBe('runtime:history-dynamic-offset')
    expect(r.refusal.message).toContain('`len` is declared `simple` in `drmEngine`')
  }, 60000)

  it('⛔ the script as written still stops, on its next wall: `smooth`\'s `switch` over the method', () => {
    const cap = load()
    const built = buildRuntimeIr(cap.source.text, { bars: [], inputs: {}, pane: true, basePeriod: 'D', tf: 'D' })
    expect(built.ok).toBe(false)
    expect(built.refusal.guard).toBe('pine:block')
    expect(built.refusal.line).toBe(233)
  }, 60000)
})

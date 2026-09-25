// app/src/components/chart/engine/runtime/__tests__/refusalsThatMeanOppositeThings.test.js
//
// ─── ⭐⭐ TWO IDENTICAL REFUSALS, OPPOSITE MEANINGS ──────────────────────────
//
// Three names refuse at `pine:function`, in both lanes, with the same guard
// and the same message. Three vendor captures — none of them read by anything
// in this repo until now — say that two of those refusals are a GAP and the
// third one is CORRECT:
//
//   ta.correlation                      vendor SERVES it   -> a real gap
//   ta.percentile_linear_interpolation  vendor SERVES it   -> a real gap
//   alma  (the BARE spelling)           vendor REFUSES it  -> we are RIGHT
//
// ⛔⛔ SO `alma` MUST NEVER BE ADDED TO THE TABLE. Adding it would make this
// engine ACCEPT a script TradingView rejects — a divergence in the direction
// nobody checks for, because every instrument in this programme measures
// "scripts we refuse that the vendor accepts" and none measures the reverse.
// The 3 bare-`alma` sites in `corpus/committed` are not "a name we lack";
// they are v3-era scripts that do not compile at the vendor either. That is a
// different finding with a different fix, and it is worth more than a
// capability: it is 3 sites that should be REMOVED from the demand census.
//
// ⭐⭐ THE COMPILE FAILURE IS THE READING. `r11-alma-spy-2026-09-11.json`
// carries TradingView's own error, verbatim and untidied:
//
//     "Could not find {kind} '{fullName}'"
//
// ⚠️ THE PLACEHOLDERS ARE THE VENDOR'S. TradingView returned the message
// template with `{kind}` and `{fullName}` unsubstituted. The capture recorded
// it as-is rather than cleaning it up, on the grounds that a tidied quote
// would be our sentence wearing the vendor's authority — and this test
// asserts the RAW form for the same reason.
//
// ─── WHAT THE TWO REAL GAPS MEASURED ────────────────────────────────────────
//
//   BOTH return `na` until the window fills, and produce NO partial-window
//   value: first defined at bar_index 19 for length 20, i.e. the first bar at
//   which `length` bars exist.
//
//   ta.correlation(close, close, 20) === 1 on every defined bar (610/610).
//   ⭐ That self-correlation control is what makes the reading a measurement
//   rather than a plot somebody looked at.
//
//   ta.percentile_linear_interpolation's boundaries CLAMP EXACTLY:
//     percentage 0   === ta.lowest(source, length)    610 of 610 bars
//     percentage 100 === ta.highest(source, length)   610 of 610 bars
//   ⛔ The capture carries those oracles IN THE PROBE, on the same bar, for a
//   stated reason: without them "the 0th percentile looks like the minimum"
//   is an eyeball, and with them it is an identity to the last double.
//
// ⛔ THIS FILE IMPLEMENTS NOTHING, and asserts the gaps REFUSE. `alma`'s
// refusal is pinned as CORRECT-FOREVER; the other two are pinned as
// gaps-with-known-semantics, so whoever implements them does not need the
// TradingView session back.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { translatePine } from '../../ast/pine.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const N = 30
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400,
  o: 100 + (i % 5), h: 110 + (i % 7), l: 90 - (i % 3), c: 100 + (i % 11), v: 10 + i,
}))
const SERIES = ['o', 'h', 'l', 'c', 'v']
  .map((k) => Float64Array.from(BARS.map((b) => b[k])))
const head = '//@version=6\nindicator("t")\n'

const REPO = path.resolve(process.cwd(), '..')
const VENDOR = path.join(REPO, 'tests/fixtures/vendor')
const ALMA = JSON.parse(fs.readFileSync(path.join(VENDOR, 'r11-alma-spy-2026-09-11.json'), 'utf8'))
const CP = JSON.parse(fs.readFileSync(path.join(VENDOR, 'r11-corr-pct-spy-2026-09-11.json'), 'utf8'))

function runtimeGuard(body) {
  let built = null
  try { built = buildRuntimeIr(head + body, { bars: BARS, inputs: {} }) } catch (e) {
    return `threw:${String(e && e.message).slice(0, 40)}`
  }
  return built.ok ? 'ok' : String((built.refusal || {}).guard || '?')
}

/** The plotted series, executed. ⭐ ADDED 2026-09-23 when two of the three names
 *  in this file stopped being gaps: a rail that only asks WHETHER a name answers
 *  cannot check that it answers the same thing the capture measured. */
function seriesOf(body) {
  const built = buildRuntimeIr(head + body, { bars: BARS, inputs: {} })
  if (!built.ok) throw new Error(`refused ${(built.refusal || {}).guard}`)
  const prog = lowerIrProgram(built.ir)
  const r = execute(prog, {
    bars: N, series: SERIES, columns: prog.columns, confirmed: true,
    barTimes: BARS.map((b) => b.t),
  })
  return Array.from(r.outputs[0])
}

function hostGuard(body) {
  try {
    const t = translatePine(head + body, { strict: true })
    return (t && t.ok === false) ? String((t.refusal || {}).guard || '?') : 'ok'
  } catch (e) { return `threw:${String(e && e.message).slice(0, 40)}` }
}

describe('⭐⭐ two identical refusals that mean opposite things', () => {
  it('⛔ CONTROL — both captures are on disk, and they DISAGREE about compiling', () => {
    // ⭐ THE LOAD-BEARING CONTROL OF THE WHOLE FILE. If both captures said the
    // same thing the contrast this file exists to draw would be imaginary.
    expect(ALMA._compiles).toBe(false)
    expect(CP._compiles).toBe(true)
    expect(ALMA.symbol).toBe('AMEX:SPY')
  })

  it('⛔⛔ `alma` — THE VENDOR REFUSES IT TOO, so our refusal is CORRECT FOREVER', () => {
    // ⚰️ The one direction this programme never measures: a script we would
    // accept that TradingView rejects. Adding `alma` to the table would
    // manufacture exactly that, and it would look like progress on the
    // demand census while making parity WORSE.
    expect(String(ALMA.verdict)).toMatch(/REFUSED BY THE VENDOR/i)
    expect(ALMA.vendorError.title).toBe('Compilation error')

    // ⚠️ ASSERTED IN THE VENDOR'S RAW FORM, placeholders and all. A tidied
    // quote would be our sentence wearing their authority.
    expect(ALMA.vendorError.error).toContain('{kind}')
    expect(ALMA.vendorError.error).toContain('{fullName}')
    expect(ALMA.vendorError.error).toMatch(/Could not find/)

    // ...and the engine agrees with the vendor, which is the point.
    expect(runtimeGuard('plot(alma(close, 9, 0.85, 6))')).toBe('pine:function')
    expect(hostGuard('plot(alma(close, 9, 0.85, 6))')).toBe('pine:function')
  })

  it('⚠️ …and the capture settles NOTHING about `ta.alma` — which is untested', () => {
    // ⛔ THE CAPTURE SAYS SO ITSELF, and over-reading it is the obvious trap:
    // only the BARE spelling was asked. The namespaced form is a different
    // identifier and may well compile at the vendor. It refuses here too, and
    // that refusal is recorded as UNADJUDICATED rather than endorsed.
    expect(String(ALMA._whatItDoesNOTSettle)).toMatch(/ta\.alma/)
    expect(runtimeGuard('plot(ta.alma(close, 9, 0.85, 6))')).toBe('pine:function')
  })

  it('⭐⭐ `ta.correlation` — a REAL gap, with its window rule measured', () => {
    const c = CP.taCorrelation
    expect(c.beforeTheWindowFills).toBe('na')
    // first defined at the first bar where `length` bars exist — length-1
    expect(c.firstDefinedBarIndex).toBe(c.windowLength - 1)

    // ⭐ THE SELF-CORRELATION CONTROL is what makes this a measurement.
    const ctrl = c._selfCorrelationControl
    expect(ctrl.exactlyOneOnEveryDefinedBar).toBe(true)
    expect(ctrl.valueFromBar19).toBe(1)

    // ⚰️ IT WAS A GAP UNTIL 2026-09-23 AND THIS FILE RECORDED IT AS ONE. The
    // merge of the two lineages CLOSED it — so the assertion becomes the stronger
    // one this capture always made possible: not *"we refuse"*, but *"we answer,
    // and we answer what the vendor answered"*.
    expect(runtimeGuard('plot(ta.correlation(close, open, 20))')).toBe('ok')
    const self = seriesOf('plot(ta.correlation(close, close, 20))')
    // `na` until the window fills; first defined at length-1 — the capture's rule
    for (let i = 0; i < c.windowLength - 1; i += 1) {
      expect(Number.isFinite(self[i]), `bar ${i} should be na`).toBe(false)
    }
    expect(Number.isFinite(self[c.windowLength - 1])).toBe(true)
    // ⭐ AND THE CAPTURE'S OWN CONTROL, RUN AGAINST US: self-correlation is exactly
    // 1 on every defined bar. That control is what made the reading a measurement
    // rather than a plot somebody looked at, and it is equally what makes this a
    // verification rather than a check that the name compiles.
    for (let i = c.windowLength - 1; i < self.length; i += 1) {
      expect(Math.abs(self[i] - ctrl.valueFromBar19)).toBeLessThan(1e-9)
    }
  })

  it('⭐⭐ `ta.percentile_linear_interpolation` — boundaries CLAMP EXACTLY', () => {
    const p = CP.taPercentileLinearInterpolation
    expect(p.beforeTheWindowFills).toBe('na')
    expect(p.firstDefinedBarIndex).toBe(19)

    // ⭐ An identity to the last double on every bar checked, both ends, with
    // ZERO disagreements — read out of the capture rather than restated.
    const b = p.boundaries
    expect(b.atZero_equals_lowest).toBe(b.barsChecked)
    expect(b.atZero_differs).toBe(0)
    expect(String(b.atZero)).toMatch(/ta\.lowest/)
    expect(String(b.atOneHundred)).toMatch(/ta\.highest/)

    // ⛔ NON-VACUITY: the midpoint must sit strictly INSIDE the two
    // boundaries, or "clamps to the extremes" would be compatible with a
    // function that returns the same number for every percentage.
    for (const s of p.sampleMidpoint || []) {
      expect(s.p50).toBeGreaterThan(s.low20)
      expect(s.p50).toBeLessThan(s.high20)
    }
    expect((p.sampleMidpoint || []).length).toBeGreaterThan(0)

    // ⚰️ ALSO A GAP UNTIL 2026-09-23, ALSO CLOSED BY THE MERGE. The capture's
    // headline fact is that the BOUNDARIES CLAMP EXACTLY, so that is what is
    // checked against us rather than mere compilation.
    expect(runtimeGuard('plot(ta.percentile_linear_interpolation(close, 20, 50))')).toBe('ok')
    const hundred = seriesOf('plot(ta.percentile_linear_interpolation(close, 20, 100))')
    const zero = seriesOf('plot(ta.percentile_linear_interpolation(close, 20, 0))')
    const high = seriesOf('plot(ta.highest(close, 20))')
    const low = seriesOf('plot(ta.lowest(close, 20))')
    for (let i = p.firstDefinedBarIndex; i < hundred.length; i += 1) {
      expect(Math.abs(hundred[i] - high[i]), `bar ${i} upper`).toBeLessThan(1e-9)
      expect(Math.abs(zero[i] - low[i]), `bar ${i} lower`).toBeLessThan(1e-9)
    }
    // ⛔ NON-VACUITY AGAINST OUR OWN SERIES, not only the capture's: the midpoint
    // must sit strictly inside, or "clamps to the extremes" would be satisfied by
    // a function that returns one number for every percentage.
    const mid = seriesOf('plot(ta.percentile_linear_interpolation(close, 20, 50))')
    for (let i = p.firstDefinedBarIndex; i < mid.length; i += 1) {
      expect(mid[i]).toBeGreaterThan(low[i])
      expect(mid[i]).toBeLessThan(high[i])
    }
  })

  it('⛔ CONTROL — the probes are well-formed, so the refusals are about the NAMES', () => {
    // ⭐ A syntax error would refuse too, and for the wrong reason. The same
    // call shapes over a name the engine DOES serve must build in both lanes.
    expect(runtimeGuard('plot(ta.sma(close, 20))')).toBe('ok')
    expect(hostGuard('plot(ta.sma(close, 20))')).toBe('ok')
    expect(runtimeGuard('plot(ta.highest(close, 20) - ta.lowest(close, 20))')).toBe('ok')
  })
})

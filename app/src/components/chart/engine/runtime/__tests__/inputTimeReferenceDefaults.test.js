// app/src/components/chart/engine/runtime/__tests__/inputTimeReferenceDefaults.test.js
//
// ─── ⭐⭐ ENGINE NUMBER PENDING (C1, coordinator ruling 2026-11-19) — THE `input.time` DEFAULTS THE REFERENCE ──
//     ALONE SETTLES
//
// RULING-0927 r1 served one default spelling, the captured `timestamp("D MMM YYYY hh:mm +0000")`, and held every
// other for a capture. Three forms read nothing the Pine reference does not state exactly, so they are served now
// (`runtimeInputs.js::timeInputDefaultOf`, the one reader the run, the settings and the translator share):
//   · a literal count of milliseconds: `input.time`'s `defval` is a `const int` and IS the UNIX time it returns;
//   · `timestamp("UTC" | "GMT", year, month, day, hour, minute)`: the zone named is UTC itself;
//   · `timestamp(year, month, day, hour, minute)`: the exchange's zone ("The default is syminfo.timezone"), read only
//     where the run is told a New York symbol, the clock rule of every other exchange-zone read on this lane, and
//     never in New York's clock-change hours.
// Every other spelling still waits for Q-D2 / CR-S1, refused by name.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { runtimeClockOpts } from '../../ast/pineRuntimeClock.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { timeInputDefaultOf } from '../runtimeInputs.js'
import { parseWholeExpression, lexPine } from '../../ast/pine.js'
import { timestampMs } from '../clockFns.js'

// daily bars around 2024-01-01 .. a window that straddles every default below
const T0 = Date.UTC(2023, 11, 20, 14, 30) / 1000
const N = 40
const BARS = Array.from({ length: N }, (_, i) => ({ t: T0 + i * 86400, o: 100, h: 101, l: 99, c: 100 + (i % 5), v: 1000 }))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const NY_SYMBOL = { ticker: 'SPY', exchange: 'NYSE Arca' }
const BTC = { ticker: 'BTCUSD', exchange: 'BITSTAMP' }
const opts = (symbol) => ({ bars: BARS, inputs: {}, symbol, ...runtimeClockOpts(false) })
const HEAD = '//@version=5\nindicator("t")\n'
// the input read where only the run can read it (a `var` the bars move), so the run's value is what is graded
const body = (def) => `t0 = input.time(${def}, "Start")\nvar float x = na\nif time >= t0\n    x := close\nplot(x)\nplot(t0)\n`

const build = (src, symbol = NY_SYMBOL) => buildRuntimeIr(HEAD + src, opts(symbol))
function run(src, symbol = NY_SYMBOL) {
  const b = build(src, symbol)
  if (!b.ok) throw new Error(`refused ${b.refusal.guard}: ${b.refusal.message}`)
  const program = lowerIrProgram(b.ir)
  return execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true, barTimes: BARS.map((x) => x.t) })
    .outputs.map((o) => Array.from(o))
}
const same = (a, b) => a.length === b.length && a.every((x, i) => (Number.isNaN(x) && Number.isNaN(b[i])) || x === b[i])
/** The shared reader over a default written as Pine, with no symbol (the settings' and translator's view). */
const readerOf = (def, o = {}) => timeInputDefaultOf(parseWholeExpression(lexPine(`input.time(${def})`).tokens
  || lexPine(`input.time(${def})`)), () => null, o)

const MS_2024 = Date.UTC(2024, 0, 1, 0, 0)
const WITNESSED = 'timestamp("1 Jan 2024 00:00 +0000")'

describe('C1 — the forms the reference settles are served, and each is the value it states', () => {
  it('a literal count of milliseconds: the run reads exactly it, the captured form\'s instant', () => {
    expect(same(run(body(String(MS_2024)))[0], run(body(WITNESSED))[0])).toBe(true)
    expect(run(body(String(MS_2024)))[1][0]).toBe(MS_2024)
  })
  it('`timestamp("UTC", 2024, 1, 1, 0, 0)` and `"GMT"` are the captured form\'s instant', () => {
    for (const z of ['UTC', 'GMT']) {
      const out = run(body(`timestamp("${z}", 2024, 1, 1, 0, 0)`))
      expect(out[1][0]).toBe(MS_2024)
      expect(same(out[0], run(body(WITNESSED))[0])).toBe(true)
    }
  })
  it('`timestamp(2024, 1, 2, 9, 30)` on a New York symbol is New York wall time, the lane\'s own exchange clock', () => {
    const out = run(body('timestamp(2024, 1, 2, 9, 30)'))
    expect(out[1][0]).toBe(timestampMs('exchange', 2024, 1, 2, 9, 30, 0))
    expect(out[1][0]).toBe(Date.UTC(2024, 0, 2, 14, 30))   // EST, UTC-5
    // and it equals the same `timestamp(…)` written as an expression on the same chart
    const expr = run('t0 = timestamp(2024, 1, 2, 9, 30)\nvar float x = na\nif time >= t0\n    x := close\nplot(x)\nplot(t0)\n')
    expect(same(out[0], expr[0])).toBe(true)
  })
  it('in summer New York is UTC-4', () => {
    expect(run(body('timestamp(2024, 7, 1, 9, 30)'))[1][0]).toBe(Date.UTC(2024, 6, 1, 13, 30))
  })
  it('⛔ non-vacuous: the input splits the run (na before it, a value after)', () => {
    const [x] = run(body(WITNESSED))
    expect(x.some((v) => Number.isNaN(v)) && x.some((v) => Number.isFinite(v))).toBe(true)
  })
})

describe('C1 — what stays refused, by name', () => {
  const refused = (src, re, symbol = NY_SYMBOL) => {
    const b = build(src, symbol)
    expect(b.ok).toBe(false)
    expect(b.refusal.message).toMatch(re)
  }
  it('`timestamp(year, …)` on a symbol not known to be New York, or with no symbol', () => {
    refused(body('timestamp(2024, 1, 2, 9, 30)'), /New York symbol/, BTC)
    refused(body('timestamp(2024, 1, 2, 9, 30)'), /New York symbol/, null)   // (null: a default parameter takes undefined)
  })
  it('`timestamp(year, …)` in the hour New York skips (spring) or repeats (autumn)', () => {
    refused(body('timestamp(2024, 3, 10, 2, 30)'), /skips or repeats/)
    refused(body('timestamp(2024, 11, 3, 1, 30)'), /skips or repeats/)
  })
  it('a zone with an offset (its sign is CR-S1\'s) and every other spelling (Q-D2)', () => {
    refused(body('timestamp("GMT+3", 2024, 1, 1, 0, 0)'), /no capture holds this form/)
    refused(body('timestamp("1 Jan 2024 00:00 +0300")'), /not written in the captured form/)
    refused(body('timestamp("2024-01-01T00:00:00")'), /not written in the captured form/)
  })
  it('the shared reader with no symbol (settings, translator): the exchange form stays skipped; the others serve', () => {
    expect(readerOf('timestamp(2024, 1, 2, 9, 30)').skip).toMatch(/New York symbol/)
    expect(readerOf(String(MS_2024)).ms).toBe(MS_2024)
    expect(readerOf('timestamp("UTC", 2024, 1, 1, 0, 0)').ms).toBe(MS_2024)
    expect(readerOf('timestamp(2024, 1, 2, 9, 30)', { exchangeZone: 'America/New_York' }).ms).toBe(Date.UTC(2024, 0, 2, 14, 30))
  })
})

// app/src/components/chart/engine/__tests__/vendorHarness/hlcc4BitExact.test.js
//
// ⭐⭐ `hlcc4` IS `(high + low + 2 * close) / 4`, AS TRADINGVIEW COMPUTES IT, BIT FOR BIT (Engine 65 (#1489),
// 2026-11-16).
//
// The Pine reference writes `hlcc4` as `(high + low + close + close) / 4`, and we built exactly that: a
// left-to-right sum of four terms. That sum rounds twice where `(high + low) + 2 * close` rounds once, so the
// two differ in the last binary digit on some bars, and TradingView's is the second.
//
// THE WITNESS: `h3-vwap-source-spy-1d-2026-10-02` (AMEX:SPY 1D, 1800 bars). Its S08 is `ta.vwap(hlcc4)` on a
// daily chart, where every bar is its own session, so TradingView's value is that one-bar session's
// `(src * volume) / volume`. This rail applies that arithmetic ITSELF to the series we compute for each
// source, so it measures the SOURCE (not our vwap path) against TradingView on every bar: `hlcc4` from the
// host translation and from the per-bar lane, and, in the same capture family, `hl2` (S06), `ohlc4` (S07)
// and the bare `hlc3` (S01), which were already TradingView's.
// ⛔ CONTROL: the four-term sum is NOT TradingView's on some bars, so the rail can tell the two apart.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { interpret } from '../../ast/interpret'
import { translatePine } from '../../ast/pine'
import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../../runtime/lowerIr.js'
import { execute } from '../../runtime/vm.js'
import { toProductBars } from './ourSide.js'

const HARNESS = path.resolve(process.cwd(), '../tests/fixtures/vendor/harness')
const CAP = JSON.parse(fs.readFileSync(path.join(HARNESS, 'h3-vwap-source-spy-1d-2026-10-02.json'), 'utf8'))
const BARS = toProductBars(CAP)
const column = (title) => {
  const plot = CAP.study.plots.find((p) => p.title === title)
  const at = CAP.plotValues.fields.indexOf(plot.id)
  return CAP.plotValues.rows.map((r) => r[at])
}

/** The bars whose one-bar-session quotient of `ours` is not TradingView's value, and how many were compared. */
function graded(ours, title) {
  const tv = column(title)
  let compared = 0
  const off = []
  tv.forEach((v, i) => {
    if (v === null || !(BARS[i].v > 0)) return
    compared += 1
    const q = (ours[i] * BARS[i].v) / BARS[i].v
    if (q !== v) off.push(`${i}: ours ${q}, TradingView ${v}`)
  })
  return { compared, off }
}

/** The source as the HOST translation computes it: `plot(<name>)`, its tree, interpreted over the bars. */
const hostSeries = (name) => {
  const t = translatePine(`//@version=6\nindicator("hlcc4")\nplot(${name})\n`, { strict: true })
  expect(t.ok, name).toBe(true)
  return Array.from(interpret(t.outputs[t.selected].ast, BARS, {}))
}

/** The source as the PER-BAR lane computes it. ⛔ Read through a `var`, so the expression cannot take the
 *  columnar route and measure the host translation a second time. */
const runtimeSeries = (name) => {
  const r = buildRuntimeIr(`//@version=6\nindicator("hlcc4", overlay = true)\nvar float s = 0.0\ns := 0.0\nplot(${name} + s)\n`,
    { bars: BARS, inputs: {}, newestBarIsForming: false })
  if (!r.ok) throw new Error(`refused: ${r.refusal.guard} — ${r.refusal.message}`)
  const program = lowerIrProgram(r.ir)
  const series = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
  const { outputs } = execute(program, { bars: BARS.length, series, columns: program.columns, confirmed: true })
  return Array.from(outputs[0])
}

describe('hlcc4 is TradingView\'s (high + low + 2 * close) / 4, bit for bit', () => {
  it('the translation reads it back as that arithmetic', () => {
    const t = translatePine('//@version=6\nindicator("hlcc4")\nplot(hlcc4)\n', { strict: true })
    expect(t.outputs[t.selected].formula).toBe('(high + low + 2 * close) / 4')
  })

  it('host translation: S08 on every bar', () => {
    const { compared, off } = graded(hostSeries('hlcc4'), 'S08_vwap_hlcc4_RAW')
    expect(compared, 'non-vacuity').toBeGreaterThan(1500)
    expect(off).toEqual([])
  })

  it('per-bar lane: S08 on every bar', () => {
    const { compared, off } = graded(runtimeSeries('hlcc4'), 'S08_vwap_hlcc4_RAW')
    expect(compared, 'non-vacuity').toBeGreaterThan(1500)
    expect(off).toEqual([])
  })

  it('⛔ control: the four-term sum (the old expansion) is NOT TradingView\'s on some bars', () => {
    const four = BARS.map((b) => (b.h + b.l + b.c + b.c) / 4)
    expect(graded(four, 'S08_vwap_hlcc4_RAW').off.length).toBeGreaterThan(0)
  })

  it('a hand-written four-term sum keeps its own arithmetic (only the name changed)', () => {
    const t = translatePine('//@version=6\nindicator("hlcc4")\nplot((high + low + close + close) / 4)\n', { strict: true })
    expect(t.outputs[t.selected].formula).toBe('(high + low + close + close) / 4')
    // and it is still a price the bar holds: `ta.vwap` of it is served, not refused
    const v = translatePine('//@version=6\nindicator("hlcc4")\nplot(ta.vwap((high + low + close + close) / 4))\n',
      { strict: true })
    expect(v.ok).toBe(true)
  })

  // the same capture family's other means, checked while here: already TradingView's, both lanes
  for (const [name, title] of [['hl2', 'S06_vwap_hl2_RAW'], ['ohlc4', 'S07_vwap_ohlc4_RAW'], ['hlc3', 'S01_vwap_bare_RAW']]) {
    it(`${name}: ${title} on every bar, host translation and per-bar lane`, () => {
      for (const ours of [hostSeries(name), runtimeSeries(name)]) {
        const { compared, off } = graded(ours, title)
        expect(compared, 'non-vacuity').toBeGreaterThan(1500)
        expect(off).toEqual([])
      }
    })
  }
})

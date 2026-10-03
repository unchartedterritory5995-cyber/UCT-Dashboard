// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.h3VwapSource.test.js
//
// ⭐⭐ H3 (2026-10-02) — `ta.vwap(source)` FOR A BAR PRICE, GRADED ON TRADINGVIEW'S
// OWN NUMBERS.
//
// The member door carried ONE session VWAP (the typical price) and refused every
// other source by name (`pine:arity`), quoting the 1D group-B capture: `ta.vwap(close)`
// is a different column. It is now `vwapOf(source)` — the SAME session accumulator
// (`indicators.js::computeVWAP`, its ET-day boundary and all) weighting that price —
// for a source the bar itself carries (`open` / `high` / `low` / `close` and their
// means). Pine's semantics, stated as such: `ta.vwap(src)` is
// `sum(src * volume) / sum(volume)` since the anchor, and the default anchor is the
// session.
//
// THE WITNESS: `vw-clock-vwap-spy-5-ext-2026-09-28` (AMEX:SPY 5m, extended hours,
// 300 bars over several sessions). Its V09 is `ta.vwap` and V08 is
// `ta.vwap(close) - ta.vwap`, so TradingView's `ta.vwap(close)` is V08 + V09 on
// every bar. The capture holds two ET days; the leading partial one is left out
// (the vendor's accumulator started on bars before the capture's first one), so
// the whole second session — 191 bars from its reset — is graded.
//
// ⛔ CONTROLS: our `vwap()` must equal V09 on the same bars (the instrument reads
// the session the way the vendor does), V08 must be non-zero on most bars (else
// `close` and `hlc3` agree and nothing was tested), and a computed source keeps
// its refusal (what Pine's session sum does with an `na` term is unwitnessed).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { interpret } from '../../ast/interpret'
import { translatePine } from '../../ast/pine'
import { toProductBars } from './ourSide'
import { HARNESS_DIR } from './harness'

const CAP = JSON.parse(fs.readFileSync(path.join(HARNESS_DIR, 'vw-clock-vwap-spy-5-ext-2026-09-28.json'), 'utf8'))
const bars = toProductBars(CAP)
const fields = CAP.plotValues.fields
const col = (title) => {
  const plot = CAP.study.plots.find((p) => p.title === title)
  const k = fields.indexOf(plot.id)
  return CAP.plotValues.rows.map((r) => r[k])
}
const V08 = col('V08_vwap_close_minus_vwap_CONTROL_NONZERO')
const V09 = col('V09_vwap_bare_RAW')
const etDay = (t) => new Date(t * 1000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
// the first bar of the second ET day: before it the vendor's sum holds earlier bars
const firstFull = bars.findIndex((b) => etDay(b.t) !== etDay(bars[0].t))

const series = (name) => ({ type: 'series', name })
const vwapOf = (src) => ({ type: 'call', name: 'vwapOf', args: [src] })
const TOL = 1e-6

function agreement(ours, vendor) {
  let compared = 0
  let worst = 0
  for (let i = firstFull; i < bars.length; i++) {
    if (vendor[i] === null || vendor[i] === undefined) continue
    compared += 1
    worst = Math.max(worst, Math.abs(ours[i] - vendor[i]))
  }
  return { compared, worst }
}

describe('H3 — ta.vwap(close) is TradingView\'s on every bar of a 5-minute capture', () => {
  it('the capture spans sessions and the rows align with the bars', () => {
    expect(CAP.timeframe).toBe('5')
    expect(CAP.plotValues.rows.length).toBe(bars.length)
    expect(CAP.plotValues.rows.every((r, i) => r[0] === CAP.bars.rows[i][0])).toBe(true)
    expect(firstFull).toBeGreaterThan(0)
    // two ET days: the session boundary at `firstFull` is the reset both sides make
    expect(new Set(bars.map((b) => etDay(b.t))).size).toBe(2)
    expect(bars.length - firstFull).toBeGreaterThan(150)
  })

  it('⛔ control: our vwap() is the vendor\'s ta.vwap (V09)', () => {
    const r = agreement(interpret({ type: 'call', name: 'vwap', args: [] }, bars, {}), V09)
    expect(r.compared).toBeGreaterThan(150)
    expect(r.worst).toBeLessThan(TOL)
  })

  it('⛔ non-vacuity: ta.vwap(close) is a different column from ta.vwap here', () => {
    const differ = V08.slice(firstFull).filter((v) => Math.abs(v) > 1e-3).length
    expect(differ).toBeGreaterThan(150)
  })

  it('vwapOf(close) is V08 + V09 on every bar after the leading partial session', () => {
    const vendor = V08.map((v, i) => (v === null || V09[i] === null ? null : v + V09[i]))
    const r = agreement(interpret(vwapOf(series('close')), bars, {}), vendor)
    expect(r.compared).toBeGreaterThan(150)
    expect(r.worst).toBeLessThan(TOL)
  })

  it('the member door translates ta.vwap(close) to that column, and v4 vwap(close) too', () => {
    for (const src of [
      '//@version=6\nindicator("h3")\nplot(ta.vwap(close))\n',
      '//@version=4\nstudy("h3")\nplot(vwap(close))\n',
    ]) {
      const t = translatePine(src, { strict: true })
      expect(t.ok, src).toBe(true)
      expect(t.outputs[t.selected].formula).toBe('vwapOf(close)')
      const vendor = V08.map((v, i) => v + V09[i])
      expect(agreement(interpret(t.outputs[t.selected].ast, bars, {}), vendor).worst).toBeLessThan(TOL)
    }
  })

  it('ta.vwap(hlc3) is still the bare vwap() column (unchanged)', () => {
    const t = translatePine('//@version=6\nindicator("h3")\nplot(ta.vwap(hlc3))\n', { strict: true })
    expect(t.outputs[t.selected].formula).toBe('vwap()')
  })

  it('the other bar prices translate too: open / high / low / hl2 / ohlc4 / hlcc4', () => {
    for (const p of ['open', 'high', 'low', 'hl2', 'ohlc4', 'hlcc4']) {
      const t = translatePine(`//@version=6\nindicator("h3")\nplot(ta.vwap(${p}))\n`, { strict: true })
      expect(t.ok, p).toBe(true)
      expect(t.outputs[t.selected].formula, p).toMatch(/^vwapOf\(/)
    }
  })

  it('⛔ a computed source keeps its refusal, by name', () => {
    for (const s of ['ta.sma(close, 5)', 'close * 2', 'volume']) {
      const t = translatePine(`//@version=6\nindicator("h3")\nplot(ta.vwap(${s}))\n`, { strict: true })
      expect(t.ok, s).toBe(false)
      expect(t.refusal.guard, s).toBe('pine:arity')
      expect(t.refusal.message, s).toMatch(/has not been measured/)
    }
  })

  it('a non-finite price blanks the rest of its session and the next session starts clean', () => {
    const ours = interpret(vwapOf(series('close')), bars, {})
    const hole = 3
    const holed = interpret(vwapOf(series('close')), bars.map((b, i) => (i === hole ? { ...b, c: NaN } : b)), {})
    expect(Number.isFinite(holed[hole - 1])).toBe(true)
    for (let i = hole; i < firstFull; i++) expect(Number.isNaN(holed[i]), String(i)).toBe(true)
    for (let i = firstFull; i < bars.length; i++) expect(holed[i]).toBe(ours[i])
  })
})

// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.candles.test.js
//
// ─── ⭐⭐ e97 U5 (phase A) — THE HARNESS COMPARES A CANDLE'S FOUR PRICES ─────────────────────────────────────────
//
// ⚰️ A `plotcandle` reaches a capture as seven plots targeting `plotcandle_N`: `ohlc_open` / `ohlc_high` /
// `ohlc_low` / `ohlc_close` and three colorers (`ohlc_colorer` body, `wick_colorer`, `border_colorer`). v1 put all
// seven under "plot type ohlc_open is not compared by v1", so the 52 candles of 37 committed captures carried no
// TradingView grade, MATCH captures included. And our side's four candle outputs (untitled `open`, `high`, `low`,
// `close`) sat in `mapPlots`' leftover pool, where they broke M2's positional pairing of the untitled plots beside them.
//
// ⭐ PHASE A: the four prices are compared bar for bar, with the harness's own tolerance class (`tolerancePolicy` /
// `valuesAgree`), each as its own plot row; a candle is paired by ORDER (the N-th `plotcandle` with our N-th candle
// group), never by a title neither side has, and UNMAPPED by name when the counts disagree. The three colours are
// named "not compared (phase A)". Every test here builds its own capture: no licensed source, no committed capture.

import { describe, it, expect } from 'vitest'

import {
  compareCapture, vendorPlotRoles, pairCandles, CANDLE_ROLES,
} from '../../../../../../../tools/vendor_harness/compare.mjs'
import { candleRoleOf } from './ourSide'

const T = [1, 2, 3]
const PRICES = { open: [10, 11, 12], high: [13, 14, 15], low: [8, 9, 10], close: [12, 13, 14] }

/** A capture of ONE plot `line` (untitled) and `nCandles` candles, each with its three colorers. */
function captureOf({ nCandles = 1, line = [1, 2, 3] } = {}) {
  const plots = [{ id: 'plot_0', type: 'line', title: null }]
  const cols = [line]
  for (let n = 0; n < nCandles; n += 1) {
    for (const [i, role] of CANDLE_ROLES.entries()) {
      plots.push({ id: `plot_${plots.length}`, type: `ohlc_${role}`, target: `plotcandle_${n}`, title: null })
      cols.push(PRICES[role].map((x) => x + 100 * n))
      void i
    }
    for (const type of ['ohlc_colorer', 'wick_colorer', 'border_colorer']) {
      plots.push({ id: `plot_${plots.length}`, type, target: `plotcandle_${n}`, title: null })
      cols.push([4282652671, 4282652671, 4282652671])
    }
  }
  return {
    symbol: { pricescale: 100 },
    history: { startsAtBar0: true },
    bars: { rows: T.map((t) => [t, 1, 1, 1, 1, 1]) },
    plotValues: { rows: T.map((t, b) => [t, ...cols.map((c) => c[b])]) },
    study: { plots, styles: {}, styleState: {} },
  }
}

/** Our side: the line, then `nCandles` candle groups as the translator titles them (`outputTitle`: the role). */
function oursOf({ nCandles = 1, line = [1, 2, 3], edit = null } = {}) {
  const plots = [{ title: null, kind: 'plot', key: 'value', column: line, lookback: 0 }]
  for (let n = 0; n < nCandles; n += 1) {
    for (const role of CANDLE_ROLES) {
      const o = { title: role, kind: 'plotcandle', key: `c${n}${role}`, lookback: 0,
        column: PRICES[role].map((x) => x + 100 * n), colors: ['#ff0000ff', '#ff0000ff', '#ff0000ff'] }
      Object.assign(o, candleRoleOf(o))
      if (edit && edit.n === n && edit.role === role) o.column = edit.column
      plots.push(o)
    }
  }
  return { ok: true, plots }
}

describe('e97 U5 — a candle\'s four prices are compared', () => {
  it('vendorPlotRoles groups the four prices by candle and names the three colours not compared (phase A)', () => {
    const roles = vendorPlotRoles(captureOf({ nCandles: 2 }))
    expect(roles.candles.map((c) => [c.target, Object.keys(c.parts).sort()])).toEqual([
      ['plotcandle_0', ['close', 'high', 'low', 'open']], ['plotcandle_1', ['close', 'high', 'low', 'open']]])
    expect(roles.notCompared.map((p) => p.why)).toEqual([
      'candle body colour (plotcandle_0) — not compared (phase A)', 'candle wick colour (plotcandle_0) — not compared (phase A)',
      'candle border colour (plotcandle_0) — not compared (phase A)', 'candle body colour (plotcandle_1) — not compared (phase A)',
      'candle wick colour (plotcandle_1) — not compared (phase A)', 'candle border colour (plotcandle_1) — not compared (phase A)'])
    expect(roles.notCompared.some((p) => /is not compared by v1/.test(p.why))).toBe(false)
  })

  it('MATCH on every one of the four prices, each its own row, colour named not compared (phase A)', () => {
    const r = compareCapture(captureOf(), oursOf())
    const rows = r.plots.filter((p) => /^C1-candle-order/.test(p.rule || ''))
    expect(rows.map((p) => [p.rule, p.verdict])).toEqual(CANDLE_ROLES.map((role) => [`C1-candle-order (plotcandle_0.${role})`, 'MATCH']))
    for (const p of rows) {
      expect(p.color).toMatch(/^not compared \(phase A\)/)
      expect(p.stats.steady.compared).toBe(T.length)
    }
    // ...and the verdict record names each colour by its own sentence, never "not compared by v1"
    expect(r.notCompared.filter((p) => /plotcandle/.test(p.why || '')).map((p) => p.why)).toEqual([
      'candle body colour (plotcandle_0) — not compared (phase A)', 'candle wick colour (plotcandle_0) — not compared (phase A)',
      'candle border colour (plotcandle_0) — not compared (phase A)'])
    expect(r.notCompared.some((p) => /^plot type (ohlc|wick|border)_/.test(p.why || ''))).toBe(false)
  })

  it.each(CANDLE_ROLES)('a wrong %s DIVERGEs on that part, by name, and on no other', (role) => {
    const wrong = PRICES[role].map((x, i) => (i === 1 ? x + 5 : x))
    const r = compareCapture(captureOf(), oursOf({ edit: { n: 0, role, column: wrong } }))
    const byRule = Object.fromEntries(r.plots.filter((p) => /^C1/.test(p.rule || '')).map((p) => [p.rule, p.verdict]))
    for (const other of CANDLE_ROLES) {
      expect(byRule[`C1-candle-order (plotcandle_0.${other})`], other).toBe(other === role ? 'DIVERGE' : 'MATCH')
    }
  })

  it('the untitled line beside a candle pairs by M2 again (the candle parts left the leftover pool)', () => {
    const r = compareCapture(captureOf(), oursOf())
    const line = r.plots.find((p) => p.id === 'plot_0')
    expect(line).toMatchObject({ verdict: 'MATCH', rule: 'M2-position-untitled', ours: 'value' })
  })

  it('two candles are paired in order: the second vendor candle with our second group', () => {
    const r = compareCapture(captureOf({ nCandles: 2 }), oursOf({ nCandles: 2 }))
    const second = r.plots.filter((p) => /plotcandle_1/.test(p.rule || ''))
    expect(second.map((p) => [p.ours, p.verdict])).toEqual(CANDLE_ROLES.map((role) => [`c1${role}`, 'MATCH']))
  })

  it('⛔ counts that disagree are UNMAPPED by name, never guessed', () => {
    const r = compareCapture(captureOf({ nCandles: 2 }), oursOf({ nCandles: 1 }))
    const unmapped = r.plots.filter((p) => p.verdict === 'INCONCLUSIVE' && /UNMAPPED/.test(p.reason))
    expect(unmapped).toHaveLength(8)
    expect(unmapped[0].reason).toMatch(/the capture holds 2 plotcandle\(s\) and our side 1/)
  })

  it('pairCandles: a group missing a role is not paired; our role is read off the translator\'s title', () => {
    expect(candleRoleOf({ kind: 'plotcandle', title: 'Smoothed HA close' })).toEqual({ role: 'close', roleIndex: 3 })
    expect(candleRoleOf({ kind: 'plot', title: 'close' })).toEqual({})
    const ours = oursOf().plots.filter((p) => p.role !== 'low')
    const m = pairCandles(vendorPlotRoles(captureOf()).candles, ours)
    expect(m.pairs).toHaveLength(0)
    expect(m.unmappedVendor[0].reason).toMatch(/does not carry all four roles/)
  })
})

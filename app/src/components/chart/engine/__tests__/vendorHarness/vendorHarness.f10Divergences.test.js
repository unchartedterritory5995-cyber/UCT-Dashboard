// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.f10Divergences.test.js
//
// ─── F10 — wave 18's newly drawn DIVERGEs, graded against the CAP5 captures that
//     prove each, in every door state that draws them ─────────────────────────────
//
// Each case is a value or colour the wave-18 tree DREW where TradingView draws
// something else (triage doc § F10):
//   1. a v4 `iff(...)` colour chain       — `pine.js::iffAsTernary` (atr-trailing-stoploss-strategy)
//   2. `ta.vwap` on a daily chart, to the bit — `interpret.js::dailySessionVwap`
//      (mtf-key-levels D-VWAP `ceil(vwap * 100) / 100`; vwap-fibo-dev-extensions-strategy)
//   3. `<field>(timenow)` on a CLOSED newest bar is `na` — `pine.js` (mtf-key-levels `is_today`)
//   4. a colour written through the script's own one-expression `method`
//      — `pine.js::colourMethodBody` (volatility-trend-score `chart.fg_color.transp(50)`)
// Every DIVERGE the fix removes is asserted MATCH (colour compared where it was a
// colour); the unit rails below show each rule can still fail.
import { describe, it, expect } from 'vitest'
import path from 'node:path'

import { gradeCapture, loadCapture, HARNESS_DIR, withDoorState } from './harness'
import { translatePine } from '../../ast/pine'

const T = 900000
const cap = (id) => loadCapture(path.join(HARNESS_DIR, `${id}.json`)).capture
const plot = (v, title) => v.plots.find((p) => p.title === title)
const graded = (id, state) => withDoorState(state, () => gradeCapture(cap(id)).verdict)

describe('F10 (1) — atr-trailing-stoploss-strategy: the `iff` colour chain is carried', () => {
  for (const id of ['atr-trailing-stoploss-strategy-rddt-1d-2026-10-04', 'atr-trailing-stoploss-strategy-spy-1d-2026-10-04']) {
    for (const state of ['off', 'on', 'runtime']) {
      it(`${id} (${state}): the line MATCHES in TradingView's green / red / #363A45 on every bar, and the barcolor agrees`, () => {
        const c = cap(id)
        // vendor fact: the colorer's palette is the three leaves, black being v4's #363A45
        expect(Object.values(c.study.palettes.palette_1.colors).map((x) => x.color)).toEqual(['#4CAF50', '#FF5252', '#363A45'])
        const v = graded(id, state)
        const p = plot(v, 'ATR Trailing Stoploss')
        expect(p.verdict, p.reason).toBe('MATCH')
        expect(p.color).toBe('compared')
        expect(p.stats.colorCompared).toBe(c.bars.rows.length)
        expect(v.paints.verdict, v.paints.reason).toBe('MATCH')
        expect(v.verdict).toBe('MATCH')
      }, T)
    }
  }

  it('unit: `iff(a, c1, iff(b, c2, c3))` is the same three-colour rule as `a ? c1 : b ? c2 : c3`', () => {
    const src = (expr) => `//@version=4\nstudy("t", overlay=true)\nplot(close, color=${expr})\n`
    const a = translatePine(src('iff(close > open, color.green, iff(close < open, color.red, color.black))'), {})
    const b = translatePine(src('close > open ? color.green : close < open ? color.red : color.black'), {})
    const pa = a.outputs[a.selected].presentation
    const pb = b.outputs[b.selected].presentation
    expect(pa.colorPalette).toBeTruthy()
    expect(pa.colorPalette).toEqual(pb.colorPalette)
    expect(pa.colorPalette.length).toBe(3)
    // control: a named `iff` argument is not read as a ternary
    const n = translatePine(src('iff(close > open, then=color.green, _else=color.red)'), {})
    expect(n.outputs.length === 0 || !(n.outputs[n.selected].presentation || {}).colorPalette).toBe(true)
  })
})

describe('F10 (2, 3) — mtf-key-levels: D-VWAP to the cent, and `is_today` on a Sunday capture', () => {
  for (const [id, n] of [['mtf-key-levels-support-and-resistance-rddt-1d-2026-10-04', 636], ['mtf-key-levels-support-and-resistance-spy-1d-2026-10-04', 8477]]) {
    for (const state of ['off', 'on', 'runtime']) {
      it(`${id} (${state}): every VWAP plot MATCHES on every bar, D-VWAP's colour compared`, () => {
        const c = cap(id)
        // vendor facts: captured on a Sunday (UTC), newest bar a Friday, closed
        expect(new Date(c.capturedAtUTC).getUTCDay()).toBe(0)
        expect(c.newestBarIsForming).toBe(false)
        const v = graded(id, state)
        for (const t of ['D-VWAP', 'W-VWAP', 'M-VWAP', 'Y-VWAP']) {
          const p = plot(v, t)
          expect(p.verdict, `${t}: ${p.reason}`).toBe('MATCH')
          expect(p.stats.compared, t).toBe(n)
        }
        expect(plot(v, 'D-VWAP').color).toBe('compared')
        // the objects stay DIVERGE by count only - MISSING, never drawn wrong
        const o = v.objects
        expect(o.texts.every((x) => x.onlyOurs.length === 0)).toBe(true)
        expect(o.counts.every((x) => x.ours <= x.vendor)).toBe(true)
      }, T)
    }
  }

  it('unit: the vendor rounds the accumulator `(hlc3 * vol) / vol`, not `hlc3` (RDDT bar 114)', () => {
    const c = cap('mtf-key-levels-support-and-resistance-rddt-1d-2026-10-04')
    const [, , h, l, cl, vol] = c.bars.rows[114]
    const at = c.plotValues.fields.indexOf(c.study.plots.find((p) => p.title === 'D-VWAP').id)
    const vendor = c.plotValues.rows[114][at]
    const x = (h + l + cl) / 3
    expect(Math.ceil(x * 100) / 100).not.toBe(vendor)
    expect(Math.ceil(((x * vol) / vol) * 100) / 100).toBe(vendor)
  })

  it('unit: `year(timenow)` is `na` unless the newest bar is stated forming', () => {
    const src = '//@version=5\nindicator("t")\nplot(year(timenow))\n'
    const closed = translatePine(src, { strict: true })
    expect(closed.ok, JSON.stringify(closed.refusal)).toBe(true)
    expect(closed.outputs[closed.selected].formula).not.toContain('lastbaryear')
    const forming = translatePine(src, { strict: true, newestBarIsForming: true })
    expect(forming.outputs[forming.selected].formula).toBe('lastbaryear')
  })
})

describe('F10 (2) — vwap-fibo-dev-extensions-strategy: the daily VWAP to the bit', () => {
  for (const id of ['vwap-fibo-dev-extensions-strategy-rddt-1d-2026-10-04', 'vwap-fibo-dev-extensions-strategy-spy-1d-2026-10-04']) {
    it(`${id} (runtime): every plot MATCHES`, () => {
      const v = graded(id, 'runtime')
      for (const p of v.plots) expect(p.verdict, `${p.title}: ${p.reason}`).toBe('MATCH')
      expect(v.verdict).toBe('MATCH')
    }, T)
  }
})

describe('F10 (4) — volatility-trend-score: a colour through the script\'s own `method`', () => {
  it('(runtime) both reference lines carry `chart.fg_color` at 50 % (theme-relative), none in the default blue', () => {
    const v = graded('volatility-trend-score-backquant-rddt-1d-2026-10-04', 'runtime')
    expect(v.objects.verdict, v.objects.reason).toBe('MATCH')
    expect(v.objects.reason).toContain('2 theme-relative')
  }, T)

  it('unit: `x.transp(50)` through `method transp(color x, int t) => color.new(x, t)`', () => {
    const src = `//@version=6
indicator("p", overlay=false)
method transp(color x, int t) =>
    color.new(x, t)
plot(close)
if barstate.islast
    line.new(bar_index - 1, 40, bar_index, 40, color=chart.fg_color.transp(50))
    line.new(bar_index - 1, 20, bar_index, 20, color=color.red.transp(50))
    line.new(bar_index - 1, 10, bar_index, 10, color=color.red.other(50))
`
    const t = translatePine(src, {})
    const cols = t.objects.ops.map((op) => op.props.color && op.props.color.node && op.props.color.node.hex)
    expect(cols[0]).toBe('chart.fg_color@50')
    expect(cols[1]).toBe('#F2364580')
    // control: a method the script does not define is not invented
    expect(cols[2]).toBeUndefined()
  })
})

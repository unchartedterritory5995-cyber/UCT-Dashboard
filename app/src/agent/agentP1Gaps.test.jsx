// P1 GAPS (pl-exec, agent/pl/exec-p1-gaps), each through the REAL panel on the fixture board, read back from the chart's own state,
// with Undo where one exists. Held-out: agentP1GapsHeldOut (committed first). Evidence: LOCAL native Windows Node v24, jsdom,
// BROWSER-MOCK-MODEL / SIMULATED (scripted plans).
//   C1-025  auto-scale ONE chart's price axis (its own axis double-click): done only when the price scale reads back as auto again;
//           Undo puts back the exact price scale it replaced (the dragged pin and LWC's own range)
//   C1-036 / C1-038  take one comparison overlay off a chart / clear them all (Compare Symbols' own writers); Undo puts them back
//   C1-080  one chart theme on EVERY chart of the board (the theme gallery's "all charts"); Undo restores each chart's own theme
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, ONE, FOUR, bareSettings } from './testing/panelHarness'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { CHART_THEMES, themeWithAppSurface } from '../components/chart/chartThemes'
import { AUTOSCALE_HELD_OUT, COMPARE_REMOVE_HELD_OUT, THEME_ALL_HELD_OUT } from './agentP1GapsHeldOut.test.js'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()
let p
beforeEach(() => { p = setupPanel({ tickers: ['NVDA', 'QQQ', 'SPY', 'AMD'] }) })
afterEach(() => { vi.restoreAllMocks(); cleanup() })
const op = (action, args, target = 'c') => p.env('apply', [{ action, target, args }])

// ── C1-025 ──
// The price scale exactly as StockChart's getDateMeta reports it (C1-025): `manual` + `pin` = the dragged-axis pin
// (priceManualRef / priceManualRangeRef), `auto` + `range` = LWC's own price scale (options().autoScale / getVisibleRange()).
// priceAuto = the scale is on auto (no pin, LWC auto-fitting).
const DRAGGED = { manual: true, pin: { minValue: 101.25, maxValue: 188.5 }, auto: false, range: { from: 98.75, to: 191.0 } }
const FIT = { from: 120.5, to: 160.25 }
function withPriceScale(h, start = {}) {
  const v = { scale: { ...DRAGGED }, land: true, calls: [], ...start }
  const meta = () => ({ firstMs: 0, lastMs: 1, rightMs: 1, activeRange: null, atDefaultView: false, indicatorsHidden: false,
    priceAuto: !v.scale.manual && v.scale.auto, priceScale: JSON.parse(JSON.stringify(v.scale)),
    frame: { fromRight: 120, toRight: -5, bars: 500, activeRange: null, locked: false, lock: null } })
  const base = h.charts, read = base.read, list = base.list
  h.charts = {
    ...base,
    read: (ref) => { const s = read(ref); return s && { ...s, view: meta() } },
    list: () => list().map(s => ({ ...s, view: meta() })),
    viewDo: (ref, o, arg) => {
      v.calls.push([ref, o, arg])
      if (v.land && o === 'autoScale') v.scale = { manual: false, pin: null, auto: true, range: { ...FIT } }
      if (v.land && o === 'restoreScale') v.scale = JSON.parse(JSON.stringify(arg))
      return true
    },
  }
  return v
}
// ⭐ (Lead decision) auto-scale is a REVERSIBLE chart.setScale: the Undo puts back the exact price scale it replaced (pin + LWC range).
describe('C1-025: auto-scale one chart\'s price axis', () => {
  it.each(AUTOSCALE_HELD_OUT.map(c => [c.text]))('held-out "%s": the price scale reads back as auto; Undo puts the dragged scale back exactly', async (t) => {
    const { say, h } = p.mount(...ONE('NVDA'))
    const v = withPriceScale(h)
    const before = JSON.stringify(v.scale)
    p.st.envelopes.push(op('chart.setScale', { scale: 'auto' }))
    const out = await say(t)
    expect(v.scale.manual || !v.scale.auto, out).toBe(false)
    expect(out).toMatch(/auto/i)
    expect(out).not.toMatch(/did not|didn't|couldn't|no Undo/i)
    await say('undo')
    expect(JSON.stringify(v.scale)).toBe(before)
    expect(v.calls.map(c => c[1])).toEqual(['autoScale', 'restoreScale'])
  }, 40000)
  it('Undo of a pin-less manual scale (LWC autoScale off, no pin) restores exactly that, range included', async () => {
    const { say, h } = p.mount(...ONE('NVDA'))
    const v = withPriceScale(h, { scale: { manual: false, pin: null, auto: false, range: { from: 50.5, to: 75.125 } } })
    const before = JSON.stringify(v.scale)
    p.st.envelopes.push(op('chart.setScale', { scale: 'auto' }))
    await say('auto scale this chart')
    expect(v.scale.auto).toBe(true)
    await say('undo')
    expect(JSON.stringify(v.scale)).toBe(before)
  }, 40000)
  it('NO-OP already on auto: nothing changed is said; the chart is not asked', async () => {
    const { say, h } = p.mount(...ONE('NVDA'))
    const v = withPriceScale(h, { scale: { manual: false, pin: null, auto: true, range: { ...FIT } } })
    p.st.envelopes.push(op('chart.setScale', { scale: 'auto' }))
    const out = await say('auto scale this chart')
    expect(out).toMatch(/already (?:on )?auto/i)
    expect(out).toMatch(/nothing changed/i)
    expect(v.calls).toEqual([])
  }, 40000)
  it('STALE the member drags the axis again after the auto: Undo refuses and leaves their new drag alone', async () => {
    const { say, h } = p.mount(...ONE('NVDA'))
    const v = withPriceScale(h)
    p.st.envelopes.push(op('chart.setScale', { scale: 'auto' }))
    await say('auto scale this chart')
    const mine = { manual: true, pin: { minValue: 10, maxValue: 20 }, auto: false, range: { from: 9, to: 21 } }
    v.scale = JSON.parse(JSON.stringify(mine))
    await say('undo')
    expect(JSON.stringify(v.scale)).toBe(JSON.stringify(mine))
    expect(v.calls.map(c => c[1])).toEqual(['autoScale'])
  }, 40000)
  it('NEGATIVE a chart that does not go back to auto is never claimed', async () => {
    const { say, h } = p.mount(...ONE('NVDA'))
    withPriceScale(h, { land: false })
    const realNow = Date.now
    let t = realNow()
    vi.spyOn(Date, 'now').mockImplementation(() => { t += 2000; return t })
    p.st.envelopes.push(op('chart.setScale', { scale: 'auto' }))
    const out = await say('auto scale this chart')
    expect(out).not.toMatch(/^.*price scale back on auto/m)
  }, 60000)
})

// ── C1-036 / C1-038 ──
const withComparisons = (syms) => {
  const [widgets, groups] = ONE('NVDA')
  widgets[0].opts = { settings: { ...bareSettings(), comparisonSymbols: syms.map((sym, i) => ({ sym, enabled: true, color: ['#f00', '#0f0', '#00f'][i], scaleMode: 'new' })) } }
  return [widgets, groups]
}
const compsOf = (b) => (mergeChartSettings(b.state.widgets[0].opts?.settings || null).comparisonSymbols || []).map(x => x.sym)
describe('C1-036 / C1-038: take comparison overlays off a chart', () => {
  it.each(COMPARE_REMOVE_HELD_OUT.map(c => [c.text, c]))('held-out "%s": the overlays read back from the chart; Undo puts them back exactly', async (t, c) => {
    const { say, board } = p.mount(...withComparisons(['QQQ', 'SPY', 'AMD']))
    const before = JSON.stringify(board.state.widgets[0].opts.settings.comparisonSymbols)
    p.st.envelopes.push(op('chart.compare', { add: [], remove: c.remove || [], clear: !!c.clear }))
    const out = await say(t)
    expect(compsOf(board), out).toEqual(c.clear ? [] : ['QQQ', 'SPY', 'AMD'].filter(s => !c.remove.includes(s)))
    await say('undo')
    expect(JSON.stringify(board.state.widgets[0].opts.settings.comparisonSymbols)).toBe(before)
  }, 40000)
  it('NEGATIVE a symbol that is not compared on this chart: refused with the real list; nothing changes', async () => {
    const { say, board } = p.mount(...withComparisons(['QQQ', 'SPY']))
    p.st.envelopes.push(op('chart.compare', { add: [], remove: ['TSLA'], clear: false }))
    const out = await say('take TSLA off this chart')
    expect(compsOf(board)).toEqual(['QQQ', 'SPY'])
    expect(out).toMatch(/Nothing to change|not compar|QQQ/i)                    // said as nothing to change: TSLA is not one of them
  }, 40000)
})

// ── C1-080 ──
const bgOf = (b, id) => mergeChartSettings(b.state.widgets.find(w => w.id === id).opts?.settings || null).background
describe('C1-080: one chart theme on every chart of the board', () => {
  it.each(THEME_ALL_HELD_OUT.map(c => [c.text, c]))('held-out "%s": every chart takes the theme; Undo puts each chart\'s own theme back', async (t, c) => {
    const { say, board } = p.mount(...FOUR())
    const before = board.state.widgets.map(w => JSON.stringify(w.opts?.settings || null))
    p.st.envelopes.push((body) => p.env('apply', [{ action: 'chart.applyThemeAll', target: body.context.board[0].ref, args: { theme: c.theme } }]))
    const out = await say(t)
    const bgs = ['c0', 'c1', 'c2', 'c3'].map(id => bgOf(board, id))
    expect(new Set(bgs).size, out).toBe(1)
    expect(bgs[0], out).toBe(themeWithAppSurface(CHART_THEMES.find(x => x.id === c.theme)).bg)       // an app-mirrored theme paints the app surface
    await say('undo')
    expect(board.state.widgets.map(w => JSON.stringify(w.opts?.settings || null))).toEqual(before)
  }, 40000)
})

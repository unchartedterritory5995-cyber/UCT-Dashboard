// P1 GAPS (pl-exec, agent/pl/exec-p1-gaps), each through the REAL panel on the fixture board, read back from the chart's own state,
// with Undo where one exists. Held-out: agentP1GapsHeldOut (committed first). Evidence: LOCAL native Windows Node v24, jsdom,
// BROWSER-MOCK-MODEL / SIMULATED (scripted plans).
//   C1-025  auto-scale ONE chart's price axis (its own axis double-click): done only when the price scale reads back as auto again;
//           Undo puts back the exact price scale it replaced (the dragged pin and LWC's own range)
//   C1-035  a whole compare group (theme / sector / industry: the Compare panel's own lists) on one chart; Undo removes it exactly
//   C1-036 / C1-038  take one comparison overlay off a chart / clear them all (Compare Symbols' own writers); Undo puts them back
//   C1-080  one chart theme on EVERY chart of the board (the theme gallery's "all charts"); Undo restores each chart's own theme
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, ONE, FOUR, bareSettings } from './testing/panelHarness'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { CHART_THEMES, themeWithAppSurface } from '../components/chart/chartThemes'
import { AUTOSCALE_HELD_OUT, COMPARE_REMOVE_HELD_OUT, THEME_ALL_HELD_OUT, GROUP_HELD_OUT } from './agentP1GapsHeldOut.test.js'
import { CHART_VIEW } from './guide/actions'
import * as guideStore from './guide/guideStore'

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
  it('REFUSED a dragged LOG scale (its range cannot be put back exactly): nothing is asked of the chart; the receipt says why', async () => {
    const { say, h } = p.mount(...ONE('NVDA'))
    const v = withPriceScale(h, { scale: { ...DRAGGED, log: true } })
    const before = JSON.stringify(v.scale)
    p.st.envelopes.push(op('chart.setScale', { scale: 'auto' }))
    const out = await say('auto scale this chart')
    expect(v.calls).toEqual([])
    expect(JSON.stringify(v.scale)).toBe(before)
    expect(out).toMatch(/log scale/i)
    expect(out).toMatch(/double-click the price axis/i)
  }, 40000)
  // ⭐ owner decision: the refusal OFFERS the on-screen walkthrough — guide chartView with the detail 'reset the price scale'
  // (pl-teach's row priceScaleReset, "Resetting the price scale"); a yes starts it; the reset is never claimed. Tolerant until
  // that row lands: then the walkthrough is on screen with its title; before it, the guide's own "can't see" answer.
  const ROW_LANDED = CHART_VIEW.some(r => r.id === 'priceScaleReset')
  const NEVER_CLAIMED = /\b(?:I(?:'ve| have)? (?:reset|put)|(?:is|was) (?:now )?(?:reset|back on auto)|Put this chart's price scale back on auto)\b/i
  const refuseLog = async () => {
    const m = p.mount(...ONE('NVDA'))
    const v = withPriceScale(m.h, { scale: { ...DRAGGED, log: true } })
    p.st.envelopes.push(op('chart.setScale', { scale: 'auto' }))
    const out = await m.say('auto scale this chart')
    return { ...m, v, out }
  }
  it('OFFER the refusal offers the walkthrough (chartView, "reset the price scale") and claims nothing', async () => {
    const { out } = await refuseLog()
    expect(out).toContain('Want me to show you? Double-click the price axis to reset it.')
    expect(out).not.toMatch(NEVER_CLAIMED)
    expect(guideStore.peekGuideOffer()).toMatchObject({ feature: 'chartView', detail: 'reset the price scale' })
  }, 40000)
  it.each([['yes'], ['yes please'], ['sure'], ['show me']])('OFFER "%s" starts the price-scale walkthrough; nothing is changed or claimed', async (yes) => {
    const { say, v } = await refuseLog()
    const before = JSON.stringify(v.scale)
    const out = await say(yes)
    expect(guideStore.peekGuideOffer(), 'the offer is spent').toBe(null)
    if (ROW_LANDED) {
      expect(guideStore.guideState()?.feature?.id, out).toBe('chartView')
      expect(guideStore.guideState()?.feature?.title, out).toBe('Resetting the price scale')
    } else expect(out).toMatch(/can.t see|don.t have a walkthrough/i)
    expect(out).not.toMatch(NEVER_CLAIMED)
    expect(v.calls).toEqual([])
    expect(JSON.stringify(v.scale)).toBe(before)
  }, 40000)
  it.each([['no thanks'], ['what timeframe is this chart on?']])('OFFER "%s" drops it: a later "yes" starts nothing', async (next) => {
    const { say } = await refuseLog()
    const said = await say(next)
    expect(said, 'a "no" is never taken as the walkthrough').not.toMatch(/can.t see|highlighted it|follow the card|don.t have a walkthrough/i)
    expect(guideStore.peekGuideOffer()).toBe(null)
    const out = await say('yes')
    expect(guideStore.guideState()).toBe(null)
    expect(out).not.toMatch(/highlighted it|follow the card/i)
  }, 40000)
  it('a LOG scale already auto-fitting with a pin (LWC auto on): Undo needs no range, so it runs and round-trips', async () => {
    const { say, h } = p.mount(...ONE('NVDA'))
    const v = withPriceScale(h, { scale: { manual: true, pin: { minValue: 101.25, maxValue: 188.5 }, auto: true, range: { from: 99, to: 190 }, log: true } })
    p.st.envelopes.push(op('chart.setScale', { scale: 'auto' }))
    await say('auto scale this chart')
    expect(v.scale.manual).toBe(false)
    await say('undo')
    expect(v.scale.manual).toBe(true)
    expect(v.scale.pin).toEqual({ minValue: 101.25, maxValue: 188.5 })
    expect(v.scale.auto).toBe(true)
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

// ── C1-035 ──
// The Compare panel's own group lists and members (compareGroups.fetchGroupList / fetchGroupMembers), served here as the server does
const GROUPS = {
  industry: { Semiconductors: ['NVDA', 'AMD', 'AVGO', 'TSM'], Software: ['MSFT', 'ORCL', 'CRM', 'ADBE', 'NOW', 'INTU', 'PANW'] },
  sector: { Energy: ['XOM', 'CVX', 'COP'], Technology: ['AAPL', 'MSFT'] },
  theme: { 'AI Infrastructure': ['NVDA', 'AVGO', 'VRT', 'ANET'] },
}
function withGroups({ failMembers = false } = {}) {
  const base = globalThis.fetch
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
  globalThis.fetch = vi.fn(async (url, init) => {
    const u = String(url)
    const list = /\/api\/compare\/groups\?type=(\w+)/.exec(u)
    if (list) return json({ groups: Object.entries(GROUPS[list[1]] || {}).map(([name, s]) => ({ name, count: s.length })) })
    const mem = /\/api\/compare\/group-members\?type=(\w+)&name=([^&]+)/.exec(u)
    if (mem) {
      if (failMembers) return json({ error: 'down' }, 503)
      const name = decodeURIComponent(mem[2]), syms = GROUPS[mem[1]]?.[name]
      return syms ? json({ name, symbols: syms, total: syms.length }) : json({ error: 'no such group' }, 404)
    }
    return base(url, init)
  })
}
const compsAt = (b) => mergeChartSettings(b.state.widgets[0].opts?.settings || null).comparisonSymbols || []
const groupOp = (type, name) => op('chart.compare', { add: [], remove: [], clear: false, groupType: type, groupName: name })
describe('C1-035: a whole compare group (theme / sector / industry) on one chart', () => {
  it.each(GROUP_HELD_OUT.map(c => [c.text, c]))('held-out "%s": every member but the chart\'s own symbol, tagged with the group; Undo restores exactly', async (t, c) => {
    withGroups()
    const { say, board } = p.mount(...ONE('NVDA'))
    const before = JSON.stringify(board.state.widgets[0].opts?.settings || null)
    p.st.envelopes.push(groupOp(c.type, c.name))
    const out = await say(t)
    const want = GROUPS[c.type][c.name].filter(s => s !== 'NVDA')
    expect(compsAt(board).map(x => x.sym), out).toEqual(want)
    expect(compsAt(board).every(x => x.group === c.name && x.enabled && x.scaleMode === 'new'), out).toBe(true)
    expect(new Set(compsAt(board).map(x => String(x.color).toLowerCase())).size).toBe(want.length)
    expect(out).toContain(c.name)
    await say('undo')
    expect(JSON.stringify(board.state.widgets[0].opts?.settings || null)).toBe(before)
  }, 40000)
  it('the group named in any case is the panel\'s own group ("semiconductors" -> Semiconductors)', async () => {
    withGroups()
    const { say, board } = p.mount(...ONE('NVDA'))
    p.st.envelopes.push(groupOp('industry', 'semiconductors'))
    await say('compare this against the semis')
    expect(compsAt(board).map(x => x.group)).toEqual(['Semiconductors', 'Semiconductors', 'Semiconductors'])
  }, 40000)
  it('members already compared are kept once (their own entry untouched); only the rest are added', async () => {
    withGroups()
    const [widgets, groups] = ONE('NVDA')
    widgets[0].opts = { settings: { ...bareSettings(), comparisonSymbols: [{ sym: 'AMD', enabled: true, color: '#f00', scaleMode: 'same' }] } }
    const { say, board } = p.mount(widgets, groups)
    p.st.envelopes.push(groupOp('industry', 'Semiconductors'))
    await say('overlay the semiconductors industry')
    expect(compsAt(board).map(x => x.sym)).toEqual(['AMD', 'AVGO', 'TSM'])
    expect(compsAt(board)[0]).toMatchObject({ sym: 'AMD', color: '#f00', scaleMode: 'same' })
  }, 40000)
  it('NEGATIVE a group UCT does not have: refused with the real groups of that kind; nothing changes', async () => {
    withGroups()
    const { say, board } = p.mount(...ONE('NVDA'))
    p.st.envelopes.push(groupOp('industry', 'Widgets'))
    const out = await say('compare against the widgets industry')
    expect(compsAt(board)).toEqual([])
    expect(out).toMatch(/no industry .Widgets./i)
    expect(out).toMatch(/Semiconductors/)
  }, 40000)
  it('NEGATIVE a group past the chart\'s ceiling: refused, nothing changes', async () => {
    withGroups()
    const { say, board } = p.mount(...ONE('NVDA'))
    p.st.envelopes.push(groupOp('industry', 'Software'))
    const out = await say('compare against the software industry')
    expect(compsAt(board)).toEqual([])
    expect(out).toMatch(/at most 5/)
  }, 40000)
  it('NEGATIVE the members could not be loaded: refused as that, nothing changes, nothing claimed', async () => {
    withGroups({ failMembers: true })
    const { say, board } = p.mount(...ONE('NVDA'))
    p.st.envelopes.push(groupOp('sector', 'Energy'))
    const out = await say('overlay the energy sector')
    expect(compsAt(board)).toEqual([])
    expect(out).toMatch(/couldn.t load|could not load/i)
    expect(out).not.toMatch(/Compared|Added/)
  }, 40000)
  it('NO-OP every member already compared: nothing changed is said', async () => {
    withGroups()
    const [widgets, groups] = ONE('NVDA')
    widgets[0].opts = { settings: { ...bareSettings(), comparisonSymbols: ['XOM', 'CVX', 'COP'].map((sym, i) => ({ sym, enabled: true, color: ['#f00', '#0f0', '#00f'][i], scaleMode: 'new' })) } }
    const { say, board } = p.mount(widgets, groups)
    const before = JSON.stringify(compsAt(board))
    p.st.envelopes.push(groupOp('sector', 'Energy'))
    const out = await say('add the energy sector to the compare')
    expect(JSON.stringify(compsAt(board))).toBe(before)
    expect(out).toMatch(/already/i)
  }, 40000)
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

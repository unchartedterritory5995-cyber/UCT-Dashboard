// C2 family (Charts Part C2, Indicators) through the REAL panel: the member's words → the instant path's general readers
// (capabilities/indicatorPhrases.js) → the capability → Indicators' own `agentMutations` writer → the chart's stored
// settings, read back here, then Undo through the same door. Multi-chart forms run on a four-chart board with two daily and
// two weekly charts, through the same fan-out, target rules and spatial safety net a model plan meets. The model is a
// stand-in (scripted, or a sentinel when a turn would have needed it): no paid call.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, waitFor } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, ONE, FOUR } from './testing/panelHarness'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import * as R from '../components/chart/engine/nativeRegistry'
import { instancesOf } from '../components/chart/builder/agentSeams'
import { paneKeysOf } from '../components/chart/builder/agentPanes'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

const VOL = { volumeSeparatePane: true, blankVolume: false }
const csOf = (board, id) => { const w = board.state.widgets.find(x => x.id === id); return mergeChartSettings(w?.opts?.settings ? JSON.stringify(w.opts.settings) : null) }
const rowsOf = (board, id) => instancesOf(csOf(board, id), R).filter(r => !r.setting)
const instOf = (board, id, pred) => (csOf(board, id).indicatorInstances || []).filter(i => !i.deleted).find(pred)
const ofDef = (defId) => (i) => i.defId === defId
const ema = (n) => (i) => i.defId === 'movingAverage' && i.inputs?.period === n
const snap = (x) => JSON.stringify(x ?? null)

let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { cleanup() })

describe('C2 rows on one chart — instant, end state read back, exact Undo', () => {
  let m
  const on = () => csOf(m.board, 'c')
  beforeEach(async () => {
    m = p.mount(...ONE('QQQ'))
    await m.say('add a 20 ema')
    await m.say('add rsi')
    await waitFor(() => expect(rowsOf(m.board, 'c').map(r => r.defId).sort()).toEqual(['movingAverage', 'rsi']))
  })
  const rsiId = () => instOf(m.board, 'c', ofDef('rsi')).instanceId

  it('C2-030 "change the color of the 20 ema to red" — the EMA 20\'s colour; Undo puts it back', async () => {
    const before = snap(instOf(m.board, 'c', ema(20)))
    const out = await m.say('change the color of the 20 ema to red')
    await waitFor(() => expect(instOf(m.board, 'c', ema(20)).inputs.color).toBe('#df4646'))
    expect(out).toMatch(/Changed EMA 20's color on Chart \(QQQ\) to red/)
    expect(p.turns()).toBe(0)
    await m.say('undo')
    await waitFor(() => expect(snap(instOf(m.board, 'c', ema(20)))).toBe(before))
  })

  it('C2-031 a signed histogram\'s up / down colours: "make the macd up bars blue" / "… orange when falling"; each its own Undo', async () => {
    await m.say('add macd')
    await waitFor(() => expect(instOf(m.board, 'c', ofDef('macd'))).toBeTruthy())
    // "colour by sign" is switched on in the Inspector (no Agent door: BLOCKED seam setSignColors) — as the member left it
    const w = m.board.state.widgets.find(x => x.id === 'c')
    w.opts.settings = { ...w.opts.settings, indicatorInstances: w.opts.settings.indicatorInstances.map(i => (i.defId === 'macd' ? { ...i, presentation: { ...(i.presentation || {}), signColors: true } } : i)) }
    const before = snap(instOf(m.board, 'c', ofDef('macd')))
    // (green is already the up colour — the candles' — so that would be "nothing to change")
    expect(await m.say('make the macd up bars green')).toMatch(/already looks like that/)
    await m.say('make the macd up bars blue')
    await waitFor(() => expect(snap(instOf(m.board, 'c', ofDef('macd')))).toMatch(/#2962ff/))
    const afterUp = snap(instOf(m.board, 'c', ofDef('macd')))
    await m.say('make the macd histogram orange when falling')
    await waitFor(() => expect(snap(instOf(m.board, 'c', ofDef('macd')))).toMatch(/#f59e0b/))
    expect(p.turns()).toBe(0)
    await m.say('undo')
    await waitFor(() => expect(snap(instOf(m.board, 'c', ofDef('macd')))).toBe(afterUp))
    await m.say('undo')
    await waitFor(() => expect(snap(instOf(m.board, 'c', ofDef('macd')))).toBe(before))
  })

  it('C2-031 without colour-by-sign, Indicators says so, with its real colours, and nothing changes', async () => {
    await m.say('add macd')
    await waitFor(() => expect(instOf(m.board, 'c', ofDef('macd'))).toBeTruthy())
    const before = snap(instOf(m.board, 'c', ofDef('macd')))
    const out = await m.say('make the macd up bars green')
    expect(out).toMatch(/MACD has no up\/down colours\. It can be MACD, Signal/)
    expect(snap(instOf(m.board, 'c', ofDef('macd')))).toBe(before)
  })

  it('C2-032 / C2-033 "set the 20 ema line width to 3", "switch the 20 ema to a dotted line"', async () => {
    await m.say('set the 20 ema line width to 3')
    await waitFor(() => expect(instOf(m.board, 'c', ema(20)).presentation?.lineWidth).toBe(3))
    await m.say('switch the 20 ema to a dotted line')
    await waitFor(() => expect(instOf(m.board, 'c', ema(20)).presentation?.lineStyle).toBe('dotted'))
    expect(p.turns()).toBe(0)
    await m.say('undo')
    await waitFor(() => expect(instOf(m.board, 'c', ema(20)).presentation?.lineStyle ?? 'solid').toBe('solid'))
    expect(instOf(m.board, 'c', ema(20)).presentation?.lineWidth).toBe(3)
  })

  it('C2-034 "show the 20 ema as an area" — a plot style the Inspector offers; one it does not is refused with the real list; Undo', async () => {
    const before = snap(instOf(m.board, 'c', ema(20)))
    const no = await m.say('show the 20 ema as columns')
    expect(no).toMatch(/can be drawn as line, histogram, dots, area/)
    expect(snap(instOf(m.board, 'c', ema(20)))).toBe(before)
    const out = await m.say('show the 20 ema as an area')
    expect(out).toMatch(/line → area/i)
    expect(snap(instOf(m.board, 'c', ema(20)))).not.toBe(before)
    await m.say('undo')
    await waitFor(() => expect(snap(instOf(m.board, 'c', ema(20)))).toBe(before))
  })

  it('C2-036 / C2-037 "put the 20 ema in the rsi pane", then "put the 20 ema back on the price pane"', async () => {
    await m.say('put the 20 ema in the rsi pane')
    await waitFor(() => expect(rowsOf(m.board, 'c').find(r => r.defId === 'movingAverage').displayTarget).toBe(`@${rsiId()}`))
    expect(p.turns()).toBe(0)
    await m.say('put the 20 ema back on the price pane')
    await waitFor(() => expect(rowsOf(m.board, 'c').find(r => r.defId === 'movingAverage').displayTarget).toBe('price'))
    await m.say('undo')
    await waitFor(() => expect(rowsOf(m.board, 'c').find(r => r.defId === 'movingAverage').displayTarget).toBe(`@${rsiId()}`))
  })

  it('C2-038 "move rsi to the top" — "the top" is the pane stack\'s, not a chart position; Undo puts the order back', async () => {
    expect(paneKeysOf(on(), R, VOL)[0].paneKey).toBe('price')
    await m.say('move rsi to the top')
    await waitFor(() => expect(paneKeysOf(on(), R, VOL)[0].paneKey).toBe(rsiId()))
    expect(p.turns()).toBe(0)
    await m.say('undo')
    await waitFor(() => expect(paneKeysOf(on(), R, VOL)[0].paneKey).toBe('price'))
  })

  it('C2-039 "make the rsi pane 30%", then "reset the rsi pane size"', async () => {
    const share = () => paneKeysOf(on(), R, VOL).find(x => x.paneKey === rsiId())?.share ?? null
    await m.say('make the rsi pane 30%')
    await waitFor(() => expect(share()).toBe(0.3))
    await m.say('reset the rsi pane size')
    await waitFor(() => expect(share()).toBeNull())
    expect(p.turns()).toBe(0)
    await m.say('undo')
    await waitFor(() => expect(share()).toBe(0.3))
  })

  it('C2-042 "duplicate the rsi" — a second copy; Undo removes only the copy', async () => {
    const id = rsiId()
    await m.say('duplicate the rsi')
    await waitFor(() => expect(rowsOf(m.board, 'c').filter(r => r.defId === 'rsi')).toHaveLength(2))
    expect(p.turns()).toBe(0)
    await m.say('undo')
    await waitFor(() => expect(rowsOf(m.board, 'c').filter(r => r.defId === 'rsi').map(r => r.instanceId)).toEqual([id]))
  })

  it('C2-006 "add another rsi" — an explicit second copy at its defaults', async () => {
    await m.say('add another rsi')
    await waitFor(() => expect(rowsOf(m.board, 'c').filter(r => r.defId === 'rsi')).toHaveLength(2))
    expect((csOf(m.board, 'c').indicatorInstances || []).filter(i => !i.deleted && i.defId === 'rsi').every(i => (i.inputs?.period ?? 14) === 14)).toBe(true)
  })

  it('C2-024 "set the macd fast length to 8" — only that setting, the same instance', async () => {
    await m.say('add macd')
    await waitFor(() => expect(instOf(m.board, 'c', ofDef('macd'))).toBeTruthy())
    const id = instOf(m.board, 'c', ofDef('macd')).instanceId
    await m.say('set the macd fast length to 8')
    await waitFor(() => expect(instOf(m.board, 'c', ofDef('macd')).inputs?.fastPeriod).toBe(8))
    expect(instOf(m.board, 'c', ofDef('macd')).instanceId).toBe(id)
    expect(instOf(m.board, 'c', ofDef('macd')).inputs?.slowPeriod ?? 26).toBe(26)
    expect(p.turns()).toBe(0)
    await m.say('undo')
    await waitFor(() => expect(instOf(m.board, 'c', ofDef('macd')).inputs?.fastPeriod ?? 12).toBe(12))
  })

  it('C2-026 "turn off the rs rating on the rs line" — a switch setting flipped; Undo flips it back', async () => {
    await m.say('add the rs line')
    await waitFor(() => expect(instOf(m.board, 'c', ofDef('rsLine'))).toBeTruthy())
    await m.say('turn off the rs rating on the rs line')
    await waitFor(() => expect(instOf(m.board, 'c', ofDef('rsLine')).inputs?.showRating).toBe(false))
    expect(p.turns()).toBe(0)
    await m.say('undo')
    await waitFor(() => expect(instOf(m.board, 'c', ofDef('rsLine')).inputs?.showRating ?? true).toBe(true))
  })

  it('C2-018 / C2-019 "hide the rsi" then "unhide the rsi" — read instantly only because the board says which', async () => {
    await m.say('hide the rsi')
    await waitFor(() => expect(rowsOf(m.board, 'c').find(r => r.defId === 'rsi').hidden).toBe(true))
    await m.say('unhide the rsi')
    await waitFor(() => expect(rowsOf(m.board, 'c').find(r => r.defId === 'rsi').hidden).toBeFalsy())
    expect(p.turns()).toBe(0)
  })

  it('a value the indicator does not offer is refused by Indicators, by name, and nothing changes', async () => {
    const before = snap(csOf(m.board, 'c').indicatorInstances)
    const out = await m.say('set the rsi line width to 9')
    expect(out).not.toMatch(/Changed/)
    expect(snap(csOf(m.board, 'c').indicatorInstances)).toBe(before)
  })
})

describe('multi-chart forms — two daily and two weekly charts', () => {
  let m
  const daily = ['c0', 'c1']
  const weekly = ['c2', 'c3']
  const has = (id, defId) => rowsOf(m.board, id).some(r => r.defId === defId)
  beforeEach(() => {
    const [w, g] = FOUR()
    w[2].opts.tf = 'W'; w[3].opts.tf = 'W'
    m = p.mount(w, g)
  })

  it('"add rsi to all the daily charts" — exactly the daily ones, one receipt each; Undo takes the request back', async () => {
    const out = await m.say('add rsi to all the daily charts')
    await waitFor(() => { for (const c of daily) expect(has(c, 'rsi'), c).toBe(true) })
    for (const c of weekly) expect(has(c, 'rsi'), c).toBe(false)
    expect(out).toMatch(/Added RSI \(14\) on Chart \(SPY\)/)
    expect(out).toMatch(/Added RSI \(14\) on Chart \(QQQ\)/)
    expect(p.turns()).toBe(0)
    await m.say('undo')
    await waitFor(() => { for (const c of daily) expect(has(c, 'rsi'), c).toBe(false) })
  })

  it('"make the 9 green on every weekly chart" after "add the 9 ema to all charts" — only the weekly charts recoloured', async () => {
    await m.say('add the 9 ema to all charts')
    await waitFor(() => { for (const c of [...daily, ...weekly]) expect(instOf(m.board, c, ema(9)), c).toBeTruthy() })
    await m.say('make the 9 green on every weekly chart')
    await waitFor(() => { for (const c of weekly) expect(instOf(m.board, c, ema(9)).inputs?.color, c).toBe('#2faf68') })
    for (const c of daily) expect(instOf(m.board, c, ema(9)).inputs?.color, c).not.toBe('#2faf68')
  })

  it('"hide the rsi on the weekly charts" — the weekly charts\' RSI hidden, the daily ones untouched', async () => {
    await m.say('add rsi to all charts')
    await waitFor(() => { for (const c of [...daily, ...weekly]) expect(has(c, 'rsi'), c).toBe(true) })
    await m.say('hide the rsi on the weekly charts')
    await waitFor(() => { for (const c of weekly) expect(rowsOf(m.board, c).find(r => r.defId === 'rsi').hidden, c).toBe(true) })
    for (const c of daily) expect(rowsOf(m.board, c).find(r => r.defId === 'rsi').hidden, c).toBeFalsy()
    expect(p.turns()).toBe(0)
  })

  it('"remove rsi from all charts" stays confirm-gated: ONE card listing every chart; nothing removed until approved', async () => {
    await m.say('add rsi to all charts')
    await waitFor(() => { for (const c of [...daily, ...weekly]) expect(has(c, 'rsi'), c).toBe(true) })
    await m.say('remove rsi from all charts')
    expect(p.proposals()).toHaveLength(1)
    for (const c of [...daily, ...weekly]) expect(has(c, 'rsi'), c).toBe(true)
    expect(p.transcript()).toMatch(/Remove RSI \(14\) from Chart \(TSLA\)/)
    await m.say('do it')
    await waitFor(() => { for (const c of [...daily, ...weekly]) expect(has(c, 'rsi'), c).toBe(false) })
  })

  it('"add rsi to every monthly chart" with no monthly chart — asked which, nothing changed', async () => {
    const out = await m.say('add rsi to every monthly chart')
    expect(out).toMatch(/None of the charts here is on monthly/)
    for (const c of [...daily, ...weekly]) expect(has(c, 'rsi'), c).toBe(false)
  })

  it('spatial safety net: a MODEL plan on exactly the daily charts runs; one that also touches a weekly chart is never applied silently', async () => {
    const ix = (body, sym) => body.context.indicatorEdits.find(e => e.chart.includes(sym)).ref
    const add = (body, sym) => ({ action: 'indicator.add', target: ix(body, sym), args: { defId: 'mfi', inputs: [{ key: 'period', value: 10 }] } })
    p.st.envelopes.push((body) => p.env('apply', [add(body, 'SPY'), add(body, 'QQQ')]))
    await m.say('could I get the money flow index with length 10 on all of my daily charts please')
    await waitFor(() => { for (const c of daily) expect(has(c, 'mfi'), c).toBe(true) })
    for (const c of weekly) expect(has(c, 'mfi'), c).toBe(false)
    // the wrong set: the daily SPY chart and a WEEKLY one, for words naming the daily charts
    p.st.envelopes.push((body) => p.env('apply', [{ ...add(body, 'SPY'), args: { defId: 'cci', inputs: null } }, { ...add(body, 'NVDA'), args: { defId: 'cci', inputs: null } }]))
    const out = await m.say('could I get the commodity channel index on all of my daily charts please')
    expect(out).toMatch(/Which charts should it go on?/)
    for (const c of [...daily, ...weekly]) expect(has(c, 'cci'), c).toBe(false)
  })

  it('"only show the rsi on the daily charts" is a show-on policy, never read as a set of charts (it goes to the model)', async () => {
    await m.say('only show the rsi on the daily charts')
    expect(p.turns()).toBe(1)
  })
})

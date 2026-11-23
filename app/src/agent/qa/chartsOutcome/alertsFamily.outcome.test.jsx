// ALERTS FAMILY — the general alert reader (capabilities/alertPhrases.js) end to end, through the REAL panel: the reading, the
// card, the product's own writer (the fixture server's /api/watchlist-alerts and /api/indicator-alerts with the real routes'
// semantics, the real drawings store), the read-back and Undo. An instant reading uses NO model turn (`m.p.turns()`); where a
// sentence is deliberately left to the model, the model is scripted (outcomeHarness.jsx: it reads its target from the request)
// and the test proves the instant path did not guess. Nothing here shows what a paid model would do, nor anything about a
// real browser.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import * as store from '../../../components/chart/drawingsStore'
import { levelPriceOf } from '../../../components/chart/drawingFib'
import { bareSettings } from '../../testing/panelHarness'
import { _resetIndicatorAlertCache, loadIndicatorAlerts } from '../../capabilities/indicatorAlerts'
import { open, outcomeSuite, afterEachOutcome, QUAD, QUAD_SYMS, chart, drawingsOf, must, waitFor, proposalsNow } from './outcomeHarness'

vi.mock('../../../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
await outcomeSuite()
afterEach(afterEachOutcome)
beforeEach(() => { _resetIndicatorAlertCache(); for (const s of ['SPY', 'QQQ', 'NVDA', 'TSLA', 'AAPL']) store.clearAll(s) })

const book = (m) => m.st.alerts.map(a => `${a.sym} ${a.direction} ${a.target_price}`).sort()
const posts = (m) => m.p.st.calls.filter(c => c[0] === 'POST' && c[1] === '/api/watchlist-alerts')
const deletes = (m) => m.p.st.calls.filter(c => c[0] === 'DELETE' && c[1].startsWith('/api/watchlist-alerts'))
const quad = (o = {}) => open(QUAD(), QUAD_SYMS, o)
const RSI = { instanceId: 'inst:rsi:1', defId: 'rsi', inputs: { period: 14 } }
/** One NVDA chart carrying `instances`, with the indicator-alert library (the real hook writers over the fixture routes). */
const ialerts = (instances = [RSI], o = {}) => open([chart('c1', 0, 0, 24, 20, { opts: { settings: { ...bareSettings(), indicatorInstances: instances } } })], { 'N:c1': 'NVDA' }, { extra: { indicatorAlerts: true }, ...o })
const iabook = (m) => m.st.ialerts.map(a => ({ sym: a.sym, indicator: a.indicator, condition: a.condition, threshold: a.threshold, tf: a.tf, active: a.active }))
const settle = async (m) => { await m.p.idle(); await waitFor(() => expect(m.p.idle()).resolves.toBeUndefined()) }
const warm = async (m) => { await loadIndicatorAlerts(m.h, { force: true }) }
const BOOK = [{ id: 'a1', sym: 'NVDA', target_price: 200, direction: 'above' }, { id: 'a2', sym: 'AMD', target_price: 90, direction: 'below' },
  { id: 'a3', sym: 'TSLA', target_price: 300, direction: 'above' }, { id: 'a4', sym: 'NVDA', target_price: 150, direction: 'below' }]

describe('C1-114 / C3-128 a price alert, said any way, read instantly: one card, nothing written until Apply, Undo exact', () => {
  it.each([
    ['alert me when AAPL crosses above 200', 'AAPL above 200'],
    ['ping me if $TSLA breaks down below 240', 'TSLA below 240'],
    ['let me know as soon as nvda reclaims 212.50', 'NVDA above 212.5'],
    ['set an alert on AAPL at 180 to the downside', 'AAPL below 180'],
  ])('"%s" → %s', async (text, want) => {
    const m = quad({ seed: { alerts: [BOOK[0]] } })
    await m.say(text)
    expect(m.p.turns()).toBe(0)
    expect(proposalsNow()).toHaveLength(1)
    expect(posts(m)).toEqual([])
    await m.apply()
    await waitFor(() => expect(book(m)).toEqual(['NVDA above 200', want].sort()))
    expect(posts(m)).toHaveLength(1)
    await m.say('undo')
    await waitFor(() => expect(book(m)).toEqual(['NVDA above 200']))
  })
  it('four charts, the bottom-left (NVDA) clicked: "this chart" → NVDA\'s alert, nothing on SPY / QQQ / TSLA', async () => {
    const m = quad({ selected: 'bl' })
    await m.say('alert me when this chart drops below 150')
    expect(m.p.turns()).toBe(0)
    expect(proposalsNow()[0].textContent).toMatch(/NVDA at or below \$150/)
    await m.apply()
    await waitFor(() => expect(book(m)).toEqual(['NVDA below 150']))
  })
  it('CONTROL: "it" on four charts is never resolved instantly — the model (scripted, reading the clicked chart from the request) plans it', async () => {
    const m = quad({ selected: 'br' })
    await m.say('alert me when it drops below 150', (c) => [{ action: 'alert.create', target: must(c.alertLibrary?.[0]?.ref, 'library'), args: { symbol: must(c.charts.find(x => x.selected), 'selected').symbol, price: 150, direction: 'below' } }], { disposition: 'propose' })
    expect(m.p.turns()).toBe(1)
    await m.apply()
    await waitFor(() => expect(book(m)).toEqual(['TSLA below 150']))
  })
  it('CONTROL: no side said ("when AAPL hits 200") is the model\'s question — nothing is proposed instantly and nothing is written', async () => {
    const m = quad()
    await m.say('alert me when AAPL hits 200')
    expect(m.p.turns()).toBe(1)
    expect(proposalsNow()).toHaveLength(0)
    expect(posts(m)).toEqual([])
  })
  it('the product\'s own refusals still apply to an instant reading: a duplicate is refused before anything is written', async () => {
    const m = quad({ seed: { alerts: [BOOK[0]] } })
    expect(await m.say('notify me when NVDA gets above 200')).toMatch(/already have an active alert/)
    expect(m.pending()).toBe(0)
    expect(posts(m)).toEqual([])
  })
})

describe('C3-127 / C3-129 the book: list by symbol, delete one (permanent, asked), never "pause" a price alert', () => {
  it('"what alerts do I have on TSLA" answers from the server\'s book, TSLA only, with no model turn', async () => {
    const m = quad({ seed: { alerts: BOOK } })
    const out = await m.say('what alerts do I have on TSLA')
    expect(m.p.turns()).toBe(0)
    expect(out).toMatch(/TSLA at or above \$300 — active/)
    expect(out).not.toMatch(/NVDA|AMD/)
  })
  it('"which alerts went off today": only the one that went off today', async () => {
    const today = new Date().toISOString()
    const m = quad({ seed: { alerts: [...BOOK, { id: 'a5', sym: 'AAPL', target_price: 180, direction: 'above', is_active: 0, triggered_at: today }] } })
    const out = await m.say('which alerts went off today')
    expect(m.p.turns()).toBe(0)
    expect(out).toMatch(/AAPL at or above \$180/)
    expect(out).not.toMatch(/TSLA|AMD/)
  })
  it('"delete my AMD alert" (one AMD alert): one permanent card, Dismiss keeps it, Apply deletes exactly it, no Undo offered', async () => {
    const m = quad({ seed: { alerts: BOOK } })
    await m.say('show my alerts')                  // the book is read (the widget / bell do the same)
    await m.say('delete my AMD alert')
    expect(m.p.turns()).toBe(0)
    expect(proposalsNow()).toHaveLength(1)
    expect(proposalsNow()[0].textContent).toMatch(/AMD at or below \$90/)
    expect(proposalsNow()[0].textContent).toMatch(/permanent/i)
    await m.dismiss()
    expect(deletes(m)).toEqual([])
    await m.say('cancel the AMD price alert')
    await m.apply()
    await waitFor(() => expect(book(m)).toEqual(['NVDA above 200', 'NVDA below 150', 'TSLA above 300']))
    expect(deletes(m)).toHaveLength(1)
    expect(m.lastReceipt().getAttribute('data-undoable')).not.toBe('true')
  })
  it('CONTROL: two NVDA alerts — "delete my NVDA alert" is never a pick; the model asks with the real alerts as choices', async () => {
    const m = quad({ seed: { alerts: BOOK } })
    await m.say('show my alerts')
    await m.say('delete my NVDA alert')
    expect(m.p.turns()).toBe(1)
    expect(proposalsNow()).toHaveLength(0)
    expect(deletes(m)).toEqual([])
  })
  it('"delete all my NVDA alerts" (the model\'s plan, one op per alert): ONE card naming both, both go on Apply, AMD and TSLA stay', async () => {
    const m = quad({ seed: { alerts: BOOK } })
    await m.say('show my alerts')
    await m.say('delete all my NVDA alerts', (c) => c.alerts.filter(a => a.symbol === 'NVDA').map(a => ({ action: 'alert.delete', target: a.ref, args: {} })), { disposition: 'propose' })
    expect(proposalsNow()).toHaveLength(1)
    expect(proposalsNow()[0].textContent).toMatch(/NVDA at or above \$200/)
    expect(proposalsNow()[0].textContent).toMatch(/NVDA at or below \$150/)
    await m.apply()
    await waitFor(() => expect(book(m)).toEqual(['AMD below 90', 'TSLA above 300']))
  })
  it('"turn off my AMD alert": a price alert has no switch — said in fixed words, NOTHING is deleted', async () => {
    const m = quad({ seed: { alerts: BOOK } })
    await m.say('show my alerts')
    const out = await m.say('turn off my AMD alert')
    expect(m.p.turns()).toBe(0)
    expect(out).toMatch(/can't be paused/)
    expect(proposalsNow()).toHaveLength(0)
    expect(deletes(m)).toEqual([])
    expect(book(m)).toHaveLength(4)
  })
})

describe('C2-089 / C2-093 / C2-098 / C2-099 / C2-100 indicator alerts through the hook\'s own writers', () => {
  it('"ping me if RSI drops below 30 on the daily": one card, then exactly that row on the server; Undo deletes it', async () => {
    const m = ialerts()
    await m.say('ping me if RSI drops below 30 on the daily')
    expect(m.p.turns()).toBe(0)
    expect(proposalsNow()).toHaveLength(1)
    expect(m.st.ialerts).toEqual([])
    await m.apply()
    await waitFor(() => expect(iabook(m)).toEqual([{ sym: 'NVDA', indicator: 'rsi', condition: 'below', threshold: 30, tf: 'D', active: true }]))
    expect(m.st.ialerts[0].instance_id).toBe('inst:rsi:1')
    await m.say('undo')
    await waitFor(() => expect(m.st.ialerts).toEqual([]))
  })
  it('C2-093 "alert me when the weekly rsi crosses above 70": armed on W (the chart is daily), the product\'s cross_above', async () => {
    const m = ialerts()
    await m.say('alert me when the weekly rsi crosses above 70')
    expect(m.p.turns()).toBe(0)
    await m.apply()
    await waitFor(() => expect(iabook(m)).toEqual([{ sym: 'NVDA', indicator: 'rsi', condition: 'cross_above', threshold: 70, tf: 'W', active: true }]))
  })
  it('a level the indicator can never reach is refused by the capability, as it would refuse a model plan', async () => {
    const m = ialerts()
    expect(await m.say('alert me when rsi goes above 120')).toMatch(/can never be reached/)
    expect(m.st.ialerts).toEqual([])
  })
  const SEEDED = [{ id: 7, sym: 'NVDA', indicator: 'rsi', condition: 'above', threshold: 70, tf: 'D', params_json: { period: 14 }, instance_id: 'inst:rsi:1' }]
  it('C2-098 "pause my RSI alert" → the row\'s own switch (instant, no card); Undo switches it back', async () => {
    const m = ialerts([RSI], { seed: { indicatorAlerts: SEEDED } })
    await warm(m)
    await m.say('pause my RSI alert')
    expect(m.p.turns()).toBe(0)
    await waitFor(() => expect(m.st.ialerts[0].active).toBe(false))
    await m.say('undo')
    await waitFor(() => expect(m.st.ialerts[0].active).toBe(true))
    await m.say('turn off my nvda rsi alert')
    await waitFor(() => expect(m.st.ialerts[0].active).toBe(false))
    await m.say('resume my RSI alert')
    await waitFor(() => expect(m.st.ialerts[0].active).toBe(true))
  })
  it('C2-099 "delete my RSI alert": a permanent card; Apply deletes exactly that row', async () => {
    const m = ialerts([RSI], { seed: { indicatorAlerts: [...SEEDED, { ...SEEDED[0], id: 8, sym: 'AMD' }] } })
    await warm(m)
    await m.say('delete my NVDA RSI alert')
    expect(m.p.turns()).toBe(0)
    expect(proposalsNow()).toHaveLength(1)
    expect(proposalsNow()[0].textContent).toMatch(/permanent/i)
    await m.apply()
    await waitFor(() => expect(m.st.ialerts.map(a => a.sym)).toEqual(['AMD']))
  })
  it('C2-100 "why hasn\'t my RSI alert fired": the server\'s own diagnosis, verbatim, with no model turn', async () => {
    const m = ialerts([RSI], { seed: { indicatorAlerts: [{ ...SEEDED[0], state: 'needs_attention', state_detail: 'SYNTHETIC: the RSI instance was removed from the chart' }] } })
    const out = await m.say('why hasn\'t my RSI alert fired')
    expect(m.p.turns()).toBe(0)
    expect(m.p.transcript()).toMatch(/SYNTHETIC: the RSI instance was removed from the chart/)
    expect(out).toMatch(/needing attention|1 indicator alert/)
  })
})

describe('C2-091 a multi-line indicator: the line the member names is the plot armed', () => {
  // the catalog as the evaluator serves MACD: three plots (the fixture's own catalog has RSI and the MA cross only)
  const MC = [{ value: 'cross_above', label: 'Crosses above', needs_threshold: true }, { value: 'cross_below', label: 'Crosses below', needs_threshold: true },
    { value: 'above', label: 'Above threshold', needs_threshold: true }, { value: 'below', label: 'Below threshold', needs_threshold: true }]
  const MACD_CATALOG = [{ indicator: 'macd', label: 'MACD', conditions: MC, plots: [
    { value: 'macd', label: 'MACD line', conditions: MC, inputs: { fast: 12, slow: 26, signal: 9 } },
    { value: 'macd.signal', label: 'Signal line', conditions: MC, inputs: { fast: 12, slow: 26, signal: 9 } },
    { value: 'macd.hist', label: 'Histogram', conditions: MC, inputs: { fast: 12, slow: 26, signal: 9 } }] }]
  const withMacd = async () => {
    const m = ialerts([{ instanceId: 'inst:macd:1', defId: 'macd', inputs: {} }])
    const base = globalThis.fetch
    globalThis.fetch = async (u, i) => (u === '/api/indicator-alerts/catalog' ? new Response(JSON.stringify({ catalog: MACD_CATALOG, refusals: [] }), { status: 200, headers: { 'content-type': 'application/json' } }) : base(u, i))
    _resetIndicatorAlertCache()
    await warm(m)
    return m
  }
  it('"alert me when the macd signal line crosses above 0" arms macd.signal', async () => {
    const m = await withMacd()
    await m.say('alert me when the macd signal line crosses above 0')
    expect(m.p.turns()).toBe(0)
    await m.apply()
    await waitFor(() => expect(iabook(m)).toEqual([{ sym: 'NVDA', indicator: 'macd.signal', condition: 'cross_above', threshold: 0, tf: 'D', active: true }]))
  })
  it('CONTROL: "when macd crosses above 0" names no line of three — the model\'s question, nothing armed', async () => {
    const m = await withMacd()
    await m.say('alert me when macd crosses above 0')
    expect(m.p.turns()).toBe(1)
    expect(proposalsNow()).toHaveLength(0)
    expect(m.st.ialerts).toEqual([])
  })
})

describe('C2-090 / C2-096 moving-average crosses, on the ONE chart the words name', () => {
  const def = (id, x, y) => ({ id, type: 'chart', x, y, w: 12, h: 10, color: 'N', opts: {} })      // default settings: EMA 9 / EMA 20 / SMA 50 / SMA 200
  it('four default charts: "alert me when NVDA\'s 9 ema crosses above its 20" arms the cross on NVDA only', async () => {
    const m = open([def('tl', 0, 0), def('tr', 12, 0), def('bl', 0, 10), def('br', 12, 10)], QUAD_SYMS, { extra: { indicatorAlerts: true } })
    await m.say('alert me when NVDA\'s 9 ema crosses above its 20')
    expect(m.p.turns()).toBe(0)
    await m.apply()
    await waitFor(() => expect(m.st.ialerts).toHaveLength(1))
    expect(m.st.ialerts[0]).toMatchObject({ sym: 'NVDA', indicator: 'ma_cross', condition: 'cross_above' })
    expect(m.st.ialerts[0].params_json).toMatchObject({ ma_type: 'ema', fast: 9, slow: 20 })
  })
  it('CONTROL: the same sentence with no chart named, nothing clicked, is the model\'s question — nothing armed', async () => {
    const m = open([def('tl', 0, 0), def('tr', 12, 0), def('bl', 0, 10), def('br', 12, 10)], QUAD_SYMS, { extra: { indicatorAlerts: true } })
    await m.say('alert me when the 9 ema crosses above the 20')
    expect(m.p.turns()).toBe(1)
    expect(m.st.ialerts).toEqual([])
  })
})

describe('C1-115 / C1-116 / C1-117 an alert on a drawing', () => {
  const bound = (m) => m.st.alerts.filter(a => a.drawing_id)
  const ref = (c, s = 'NVDA') => drawingsOf(c, s).ref
  let n = 0
  const draw = async (m, args, action = 'drawing.addTrendline') => {
    await m.say(`draw it [turn ${++n}]`, (c) => [{ action, target: ref(c), args }])
    await waitFor(() => expect(store.peekDrawings('NVDA').length).toBeGreaterThan(0))
    return store.peekDrawings('NVDA').at(-1)
  }
  const TREND = { from: { date: '2026-10-01', price: 100 }, to: { date: '2026-10-20', price: 120 }, color: null, style: null }
  it('C1-115 "alert me if price breaks below this trendline" (the one just drawn): one card, bound to it; Undo removes the alert, not the line', async () => {
    const m = quad({ extra: { drawings: true }, selected: 'bl' })
    const d = await draw(m, TREND)
    await m.say('alert me if price breaks below this trendline')
    expect(m.p.turns()).toBe(1)                       // the draw was the one model turn
    expect(proposalsNow()).toHaveLength(1)
    expect(bound(m)).toEqual([])
    await m.apply()
    await waitFor(() => expect(bound(m)).toHaveLength(1))
    expect(bound(m)[0]).toMatchObject({ sym: 'NVDA', direction: 'below', alert_type: 'trendline', drawing_id: d.id })
    await m.say('undo')
    await waitFor(() => expect(bound(m)).toEqual([]))
    expect(store.peekDrawings('NVDA')).toEqual([d])
  })
  it('C1-116 "… at a fixed level": the menu\'s other choice — the same geometry WITHOUT the binding, so it stays where the line is', async () => {
    const m = open([chart('c1', 0, 0, 24, 20)], { 'N:c1': 'NVDA' }, { extra: { drawings: true }, seed: { drawings: { NVDA: [{ type: 'horizontal', points: [{ price: 200 }], color: '#ffffff', lineWidth: 1 }] } } })
    await m.say('set an alert above this line at a fixed level')
    expect(m.p.turns()).toBe(0)
    expect(proposalsNow()[0].textContent).toMatch(/does NOT follow the drawing/)
    await m.apply()
    await waitFor(() => expect(m.st.alerts).toHaveLength(1))
    expect(m.st.alerts[0]).toMatchObject({ sym: 'NVDA', direction: 'above', alert_type: 'line', target_price: 200, drawing_id: null })
    // and the default — "follow this line" — binds it, through the same capability
    await m.say('set an alert below this line')
    await m.apply()
    await waitFor(() => expect(bound(m)).toHaveLength(1))
    expect(bound(m)[0]).toMatchObject({ direction: 'below', target_price: 200, drawing_id: store.peekDrawings('NVDA')[0].id })
  })
  it('C1-116 through the model too: a plan with follow false is the fixed alert (the arg the menu\'s choice is)', async () => {
    const m = quad({ extra: { drawings: true }, selected: 'bl' })
    const d = await draw(m, TREND)
    await m.say('set a fixed alert above that trendline [turn x]', (c) => [{ action: 'drawing.setAlert', target: ref(c), args: { drawing: d.id, direction: 'above', level: null, follow: false } }], { disposition: 'propose' })
    await m.apply()
    await waitFor(() => expect(m.st.alerts).toHaveLength(1))
    expect(m.st.alerts[0]).toMatchObject({ alert_type: 'trendline', drawing_id: null, direction: 'above' })
  })
  it('C1-117 "alert me when price drops below the 0.618 level of the fib": bound as <fib>#0.618 at that level\'s price', async () => {
    const m = quad({ extra: { drawings: true }, selected: 'bl' })
    const d = await draw(m, { from: { date: '2026-10-01', price: 100 }, to: { date: '2026-10-20', price: 200 }, color: null, style: null }, 'drawing.addFib')
    await m.say('alert me when price drops below the 0.618 level of the fib')
    await m.apply()
    await waitFor(() => expect(bound(m)).toHaveLength(1))
    expect(bound(m)[0]).toMatchObject({ drawing_id: `${d.id}#0.618`, direction: 'below' })
    expect(bound(m)[0].target_price).toBeCloseTo(levelPriceOf(d, 0.618), 6)
  })
  it('CONTROLS: no side ("set an alert at this line") and a different symbol\'s drawing are the model\'s — nothing proposed instantly', async () => {
    const m = quad({ extra: { drawings: true }, selected: 'bl' })
    await draw(m, TREND)
    const before = m.p.turns()
    await m.say('set an alert at this line')
    expect(m.p.turns()).toBe(before + 1)
    await m.say('alert me when TSLA breaks below that trendline')
    expect(m.p.turns()).toBe(before + 2)
    expect(proposalsNow()).toHaveLength(0)
    expect(m.st.alerts).toEqual([])
    await settle(m)
  })
})

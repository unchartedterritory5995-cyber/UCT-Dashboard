// W1-B (Wave 1, BOARD B-01) — TIME-ANCHORED drawings through the product's own store: trendline, ray,
// horizontal ray, rectangle, Fibonacci, text, anchored VWAP. Points are given as {date, price}; the date
// is an ISO day or a member's date word (agent/dateWords.js), converted with the drawing layer's own
// drawingTimeFor for the chart's timeframe and checked by validateDrawing. Undo is by id (never the
// store's shared undo); an anchor outside the loaded history, in the future, or unreadable is refused.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { buildContext, manifestFor, getCapability } from './capabilities'
import { planOps, collectTargets, prepareOps } from './executor'
import { commitPlan, undoEntry } from './runtime'
import { buildDrawingSource } from './host'
import { routeManifest } from './routing'
import { resolveDateWord, dayWord } from './dateWords'
import { setupPanel, TWO } from './testing/panelHarness'
import * as store from '../components/chart/drawingsStore'
import { UCT_DRAW_GOLD } from '../components/chart/drawingColors'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()
const CTX = { surface: 'charts' }
const DAY = 86400000
const ms = (iso) => Date.parse(`${iso}T00:00:00Z`)
let SYM = 'NVDA'
let n = 0

/** A host whose one chart shows SYM on `tf`, with the history it has loaded (null = unknown). */
function host({ tf = 'D', history = { firstMs: ms('2020-01-02'), lastMs: Date.now() }, defaults = {} } = {}) {
  const view = history ? { firstMs: history.firstMs, lastMs: history.lastMs, rightMs: history.lastMs } : null
  const charts = { list: () => [{ label: `Chart (${SYM})`, symbol: SYM, drawSym: SYM, tf, view, cs: { drawingDefaults: defaults } }] }
  return { drawings: buildDrawingSource(charts) }
}
const op = (action, args) => ({ action, target: SYM, args })
async function plan(h, ops) {
  buildContext(h, CTX)
  const env = await prepareOps(ops)
  return { p: planOps(collectTargets(h, ['drawing']), ops, env, CTX), env }
}
const drawings = () => store.peekDrawings(SYM)
const pt = (date, price) => ({ date, price })
const refuse = async (h, action, args) => (await plan(h, [op(action, args)])).p.refusals[0]?.reason

beforeEach(() => {
  SYM = `A${++n}NC`                       // a fresh symbol per test: the store is module-level
  globalThis.fetch = vi.fn(async () => new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }))
})
afterEach(() => { vi.restoreAllMocks() })

describe('dateWords — a member\'s date words → an ET calendar day (pure given a clock)', () => {
  const NOW = Date.parse('2026-11-02T15:00:00Z')             // a Monday
  const r = (w) => resolveDateWord(w, NOW)
  it('ISO days, today / yesterday, weekdays ("last friday" is strictly before today; "friday" on or before)', () => {
    expect(r('2026-10-15')).toMatchObject({ to: '2026-10-15' })
    expect(r('on 2026-10-15').to).toBe('2026-10-15')
    expect(r('today').to).toBe('2026-11-02')
    expect(r('yesterday').to).toBe('2026-11-01')
    expect(r('last friday').to).toBe('2026-10-30')
    expect(r('Friday').to).toBe('2026-10-30')
    expect(r('last monday').to).toBe('2026-10-26')               // today is Monday: "last" = a week ago
    expect(r('monday').to).toBe('2026-11-02')
    expect(r('3 days ago').to).toBe('2026-10-30')
  })
  it('windows: last week = 5 sessions to its Friday; this week = the weekdays so far; last month = the calendar month', () => {
    expect(r('last week')).toMatchObject({ to: '2026-10-30', sessions: 5 })
    expect(r('this week')).toMatchObject({ to: '2026-11-02', sessions: 1 })
    expect(r('last month')).toMatchObject({ to: '2026-10-31', month: '2026-10' })
  })
  it('named dates; a missing year is this year; a day after today is flagged future, never guessed back a year', () => {
    expect(r('oct 15').to).toBe('2026-10-15')
    expect(r('October 15th, 2025').to).toBe('2025-10-15')
    expect(r('15 oct').to).toBe('2026-10-15')
    expect(r('10/15').to).toBe('2026-10-15')
    expect(r('10/15/25').to).toBe('2025-10-15')
    expect(r('dec 25')).toMatchObject({ to: '2026-12-25', future: true })
    expect(r('2999-01-01').future).toBe(true)
  })
  it('anything else is null — never a guess', () => {
    for (const w of ['', 'the recent low', '2026-02-30', 'someday', '13/45', 'next friday']) expect(r(w), w).toBe(null)
    expect(dayWord('2026-10-30', NOW)).toBe('Fri, Oct 30')
    expect(dayWord('2025-10-30', NOW)).toBe('Thu, Oct 30, 2025')
  })
})

describe('drawing.addTrendline — the toolbar\'s own trendline, placed from two dated points', () => {
  it('writes exactly the overlay\'s shape (ISO times on a daily chart, pane price, defaults); the store mints the id; Undo removes it by id', async () => {
    const h = host({ defaults: { color: '#ff00aa', width: 2 } })
    const { p, env } = await plan(h, [op('drawing.addTrendline', { from: pt('2026-10-15', 180), to: pt('2026-10-30', 195), color: null, style: null })])
    expect(p.ok).toBe(true)
    expect(p.lines).toEqual([`Drew a trendline on ${SYM} from $180 on Thu, Oct 15 to $195 on Fri, Oct 30 — on every chart showing ${SYM}`])
    const res = await commitPlan(h, p, { env })
    expect(res.ok).toBe(true)
    const [d] = drawings()
    expect(d).toMatchObject({ type: 'trendline', points: [{ time: '2026-10-15', price: 180 }, { time: '2026-10-30', price: 195 }], color: '#ff00aa', lineWidth: 2, pane: 'price' })
    expect(d.lineStyle).toBe(undefined)
    expect(d.id.startsWith('new:')).toBe(false)
    expect((await undoEntry(h, res.undo)).ok).toBe(true)
    expect(drawings()).toEqual([])
  })
  it('date words resolve through dateWords; a colour and a dash style are honoured; no default → UCT gold, 1px', async () => {
    const h = host()
    const { p, env } = await plan(h, [op('drawing.addTrendline', { from: pt('oct 15', 100), to: pt('yesterday', 120), color: 'pink', style: 'dashed' })])
    expect(p.ok).toBe(true)
    await commitPlan(h, p, { env })
    const [d] = drawings()
    const yday = resolveDateWord('yesterday').to
    expect(d).toMatchObject({ type: 'trendline', points: [{ time: `${new Date().getUTCFullYear()}-10-15`, price: 100 }, { time: yday, price: 120 }], color: '#ec4899', lineStyle: 'dashed', lineWidth: 1 })
    expect(d.color).not.toBe(UCT_DRAW_GOLD)
  })
  it('⛔ Undo is EXACT and by id: a line the member drew afterwards survives; the Agent\'s own line moved since → Undo refuses', async () => {
    const h = host()
    const { p, env } = await plan(h, [op('drawing.addTrendline', { from: pt('2026-10-01', 10), to: pt('2026-10-20', 12), color: null, style: null })])
    const res = await commitPlan(h, p, { env })
    const mine = store.addDrawing(SYM, { type: 'horizontal', points: [{ price: 40 }], color: '#fff', lineWidth: 1 })
    expect((await undoEntry(h, res.undo)).ok).toBe(true)
    expect(drawings().map(d => d.id)).toEqual([mine])
    const again = await plan(h, [op('drawing.addTrendline', { from: pt('2026-10-01', 10), to: pt('2026-10-20', 12), color: null, style: null })])
    const res2 = await commitPlan(h, again.p, { env: again.env })
    const agents = drawings().find(d => d.type === 'trendline')
    store.updateDrawing(SYM, agents.id, { points: [{ time: '2026-10-02', price: 11 }, { time: '2026-10-20', price: 12 }] })
    const u = await undoEntry(h, res2.undo)
    expect(u.ok).toBe(false)
    expect(u.reason).toMatch(/has changed since I made that change/)
    expect(drawings().length).toBe(2)
  })
  it('refusals (nothing is written): a future date, a date before the loaded history, after its last bar, an unreadable date, a bad price, the same point twice, reversed order, a duplicate', async () => {
    const h = host({ history: { firstMs: ms('2026-01-05'), lastMs: ms('2026-10-15') } })
    const ok = { from: pt('2026-10-01', 10), to: pt('2026-10-14', 12), color: null, style: null }
    expect(await refuse(h, 'drawing.addTrendline', { ...ok, to: pt('2999-01-01', 12) })).toMatch(/is in the future/)
    expect(await refuse(h, 'drawing.addTrendline', { ...ok, from: pt('2025-12-01', 10) })).toMatch(/before the history loaded on the chart \(it starts Mon, Jan 5\) — scroll the chart back/)
    expect(await refuse(h, 'drawing.addTrendline', { ...ok, to: pt('2026-10-25', 12) })).toMatch(/after the last bar on the chart \(Thu, Oct 15\)/)
    expect(await refuse(h, 'drawing.addTrendline', { ...ok, from: pt('the recent low', 10) })).toMatch(/couldn't read “the recent low” as a date/)
    expect(await refuse(h, 'drawing.addTrendline', { ...ok, from: pt('2026-10-01', 0) })).toMatch(/isn't a price/)
    expect(await refuse(h, 'drawing.addTrendline', { ...ok, to: pt('2026-10-01', 10) })).toMatch(/two points are the same/)
    expect(await refuse(h, 'drawing.addTrendline', { from: pt('2026-10-14', 10), to: pt('2026-10-01', 12), color: null, style: null })).toMatch(/is before the first .* time order/)
    expect(await refuse(h, 'drawing.addTrendline', { ...ok, color: 'sparkly' })).toMatch(/isn't a colour/)
    const { p, env } = await plan(h, [op('drawing.addTrendline', ok)])
    await commitPlan(h, p, { env })
    expect(await refuse(h, 'drawing.addTrendline', ok)).toMatch(/already a trendline between those two points/)
    expect(drawings().length).toBe(1)
  })
  it('with no loaded-history read-out the date is still checked against today; the timeframe decides the point shape (intraday = ET-shifted 09:30 seconds, weekly = ISO)', async () => {
    const h5 = host({ tf: '5', history: null })
    const { p, env } = await plan(h5, [op('drawing.addTrendline', { from: pt('2026-10-15', 1), to: pt('2026-10-16', 2), color: null, style: null })])
    expect(p.ok).toBe(true)
    await commitPlan(h5, p, { env })
    const [d] = drawings()
    expect(d.points.map(x => x.time)).toEqual([Date.UTC(2026, 9, 15, 13, 30) / 1000, Date.UTC(2026, 9, 16, 13, 30) / 1000])   // RAW unix 09:30 EDT
    expect(await refuse(h5, 'drawing.addTrendline', { from: pt('2026-10-15', 1), to: pt('2999-10-16', 2), color: null, style: null })).toMatch(/future/)
    SYM = `${SYM}W`
    const hw = host({ tf: 'W' })
    const w = await plan(hw, [op('drawing.addRay', { from: pt('2026-10-05', 1), to: pt('2026-10-19', 2), color: null, style: null })])
    await commitPlan(hw, w.p, { env: w.env })
    expect(drawings()[0]).toMatchObject({ type: 'ray', points: [{ time: '2026-10-05', price: 1 }, { time: '2026-10-19', price: 2 }] })
  })
})

describe('the other anchored tools — each exactly as the toolbar stores it', () => {
  it('horizontal ray: one anchor, showPriceLabel as a new hray carries; receipt and Undo', async () => {
    const h = host()
    const { p, env } = await plan(h, [op('drawing.addHorizontalRay', { date: '2026-10-15', price: 200, color: 'blue', style: 'dotted' })])
    expect(p.lines[0]).toMatch(/^Drew a horizontal ray on .* from \$200 on Thu, Oct 15, extending right \(dotted\)/)
    const res = await commitPlan(h, p, { env })
    expect(drawings()[0]).toMatchObject({ type: 'hray', points: [{ time: '2026-10-15', price: 200 }], showPriceLabel: true, lineStyle: 'dotted', pane: 'price' })
    expect(await refuse(h, 'drawing.addHorizontalRay', { date: '2026-10-15', price: 200, color: null, style: null })).toMatch(/already a horizontal ray/)
    expect((await undoEntry(h, res.undo)).ok).toBe(true)
    expect(drawings()).toEqual([])
  })
  it('rectangle: opposite corners in either order; Fibonacci: the standard tool (levels come from the renderer, nothing invented)', async () => {
    const h = host()
    const r = await plan(h, [op('drawing.addRectangle', { from: pt('2026-10-20', 185), to: pt('2026-10-01', 170), color: null, style: null })])
    expect(r.p.ok).toBe(true)
    await commitPlan(h, r.p, { env: r.env })
    const f = await plan(h, [op('drawing.addFib', { from: pt('2026-10-07', 150), to: pt('2026-10-28', 190), color: null, style: null })])
    expect(f.p.lines[0]).toMatch(/^Drew a Fibonacci retracement on .* from \$150 on Wed, Oct 7 to \$190 on Wed, Oct 28/)
    await commitPlan(h, f.p, { env: f.env })
    const [rect, fib] = drawings()
    expect(rect).toMatchObject({ type: 'rect', points: [{ time: '2026-10-20', price: 185 }, { time: '2026-10-01', price: 170 }] })
    expect(fib).toMatchObject({ type: 'fib', points: [{ time: '2026-10-07', price: 150 }, { time: '2026-10-28', price: 190 }], color: UCT_DRAW_GOLD })
    expect(fib.levels).toBe(undefined)
    expect(await refuse(h, 'drawing.addFib', { from: pt('2026-10-28', 190), to: pt('2026-10-07', 150), color: null, style: null })).toMatch(/time order/)
  })
  it('text: the member\'s exact words, the chart\'s default font size, the new-note layout marker; too long / empty refused', async () => {
    const h = host({ defaults: { fontSize: 15 } })
    const { p, env } = await plan(h, [op('drawing.addText', { text: '  earnings gap  ', date: '2026-10-15', price: 180, color: null })])
    expect(p.lines[0]).toMatch(/^Added the note “earnings gap” on .* at \$180 on Thu, Oct 15/)
    const res = await commitPlan(h, p, { env })
    expect(drawings()[0]).toMatchObject({ type: 'text', text: 'earnings gap', fontSize: 15, textOrigin: 'box', pane: 'price', points: [{ time: '2026-10-15', price: 180 }], boxWidth: null })
    expect(await refuse(h, 'drawing.addText', { text: 'earnings gap', date: '2026-10-15', price: 180, color: null })).toMatch(/already on/)
    expect(await refuse(h, 'drawing.addText', { text: '   ', date: '2026-10-15', price: 180, color: null })).toMatch(/Say what the note should say/)
    expect(await refuse(h, 'drawing.addText', { text: 'x'.repeat(201), date: '2026-10-15', price: 180, color: null })).toMatch(/201 characters/)
    expect((await undoEntry(h, res.undo)).ok).toBe(true)
    expect(drawings()).toEqual([])
  })
  it('anchored VWAP: a trading-day anchor (a weekend is refused — the renderer looks the anchor up by exact bar time); one per anchor day', async () => {
    const h = host()
    expect(await refuse(h, 'drawing.addAvwap', { date: '2026-10-17', price: 180, color: null })).toMatch(/is a Saturday — an anchored VWAP starts on a trading day/)
    const { p, env } = await plan(h, [op('drawing.addAvwap', { date: '2026-10-15', price: 180, color: null })])
    expect(p.lines[0]).toMatch(/^Drew an anchored VWAP on .* from Thu, Oct 15 forward/)
    const res = await commitPlan(h, p, { env })
    expect(drawings()[0]).toMatchObject({ type: 'avwap', points: [{ time: '2026-10-15', price: 180 }], pane: 'price' })
    expect(await refuse(h, 'drawing.addAvwap', { date: '2026-10-15', price: 999, color: null })).toMatch(/already an anchored VWAP from Thu, Oct 15/)
    expect((await undoEntry(h, res.undo)).ok).toBe(true)
    expect(drawings()).toEqual([])
  })
})

describe('registry, context and routing', () => {
  it('the seven anchored tools are registered on the drawing kind, local risk, exact Undo; the context says the timeframe and loaded history', () => {
    for (const name of ['drawing.addTrendline', 'drawing.addRay', 'drawing.addHorizontalRay', 'drawing.addRectangle', 'drawing.addFib', 'drawing.addText', 'drawing.addAvwap']) {
      const c = getCapability(name)
      expect(c, name).toBeTruthy()
      expect([c.target, c.risk, c.undo], name).toEqual(['drawing', 'local', 'exact'])
    }
    const h = host({ tf: 'W', history: { firstMs: ms('2021-03-01'), lastMs: ms('2026-10-30') } })
    const { context } = buildContext(h, CTX)
    expect(context.drawings[0]).toMatchObject({ symbol: SYM, timeframe: 'W', loadedHistory: '2021-03-01 to 2026-10-30' })
    const r = routeManifest(manifestFor(CTX), 'Draw a trendline from the Oct 15 low at 180 to last Friday at 195', { limit: 60, budget: 55 })
    expect(r.routing.selected).toContain('drawings')
    expect(r.manifest.some(c => c.name === 'drawing.addTrendline')).toBe(true)
  })
})

describe('through the REAL panel (panelHarness): a scripted plan draws, the receipt lands, Undo takes it back', () => {
  let p
  beforeEach(() => { p = setupPanel() })
  afterEach(() => { cleanup() })
  it('"draw a trendline on NVDA from Oct 15 at 180 to Oct 30 at 195" → one op on the drawings entry; receipt; undo', async () => {
    const { say, h } = p.mount(...TWO('NVDA', 'AMD'))
    // the workspace host's own drawing source over the board's charts; the tracings read-back served from the store
    h.drawings = { ...buildDrawingSource(h.charts), confirm: async () => ({ ok: true }) }
    // the model answers with the ref it was shown (translateRefs maps it back); a real ref passes through the same way
    p.st.envelopes.push(p.env('apply', [{ action: 'drawing.addTrendline', target: 'NVDA', args: { from: { date: '2026-10-15', price: 180 }, to: { date: '2026-10-30', price: 195 }, color: null, style: null } }]))
    const out = await say('draw a trendline on NVDA from Oct 15 at 180 to Oct 30 at 195')
    expect(out).toMatch(/Drew a trendline on NVDA from \$180 on Thu, Oct 15 to \$195 on Fri, Oct 30/)
    const [d] = store.peekDrawings('NVDA')
    expect(d).toMatchObject({ type: 'trendline', points: [{ time: '2026-10-15', price: 180 }, { time: '2026-10-30', price: 195 }] })
    expect(store.peekDrawings('AMD')).toEqual([])
    expect(screen.queryAllByTestId('agent-proposal').length).toBe(0)           // local + reversible: applied, no card
    expect(p.turns()).toBe(1)
    const undone = await say('undo')
    expect(undone).toMatch(/Undid/)
    expect(store.peekDrawings('NVDA')).toEqual([])
    expect(p.turns()).toBe(1)
  }, 40000)
})

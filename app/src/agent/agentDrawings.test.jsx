// OVERNIGHT BATCH 8 (narrow) — drawings through the product's own store: horizontal levels by
// price (the context menu's own shape), restyle and remove ONE drawing by id, list. Undo is by id,
// never the store's shared undo — so the member's own edits are never reverted.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { registerBuiltins } from './builtins'
import { buildContext } from './capabilities'
import { planOps, collectTargets, prepareOps } from './executor'
import { commitPlan, undoEntry } from './runtime'
import { buildDrawingSource } from './host'
import { routeManifest } from './routing'
import { manifestFor } from './capabilities'
import { _resetAlertCache } from './capabilities/alert'
import * as store from '../components/chart/drawingsStore'
import { UCT_DRAW_GOLD } from '../components/chart/drawingColors'

registerBuiltins()
const CTX = { surface: 'charts' }
let SYM = 'NVDA'
let n = 0

function host({ defaults = {} } = {}) {
  const charts = { list: () => [{ label: `Chart (${SYM})`, symbol: SYM, drawSym: SYM, cs: { drawingDefaults: defaults } }] }
  return { drawings: buildDrawingSource(charts) }
}
const op = (action, args) => ({ action, target: SYM, args })
async function plan(h, ops) {
  buildContext(h, CTX)
  const env = await prepareOps(ops)
  return { p: planOps(collectTargets(h, ['drawing']), ops, env, CTX), env }
}
const drawings = () => store.peekDrawings(SYM)
let alerts = []
let alertsFail = false

beforeEach(() => {
  SYM = `T${++n}X`                       // a fresh symbol per test: the store is module-level
  alerts = []; alertsFail = false
  _resetAlertCache()
  globalThis.fetch = vi.fn(async (url) => {
    if (String(url).startsWith('/api/watchlist-alerts')) {
      if (alertsFail) return new Response('{}', { status: 500 })
      return new Response(JSON.stringify(alerts), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
  })
})
afterEach(() => { vi.restoreAllMocks() })

describe('drawing.addLevel — the price-axis menu\'s own horizontal line', () => {
  it('"draw a horizontal line at $200": the menu\'s exact shape, the member\'s default colour; read back; Undo by id', async () => {
    const h = host({ defaults: { color: '#ff00aa', width: 2 } })
    const { p, env } = await plan(h, [op('drawing.addLevel', { price: 200, color: null, style: null })])
    expect(p.ok).toBe(true)
    expect(p.lines).toEqual([`Drew a horizontal line at $200 on ${SYM}`])
    const res = await commitPlan(h, p, { env })
    expect(res.ok).toBe(true)
    const [d] = drawings()
    expect(d).toMatchObject({ type: 'horizontal', points: [{ price: 200 }], color: '#ff00aa', lineWidth: 2 })
    expect(d.id.startsWith('new:')).toBe(false)                    // the STORE minted the id
    expect((await undoEntry(h, res.undo)).ok).toBe(true)
    expect(drawings()).toEqual([])
  })
  it('no default → UCT gold, 1px; a named colour and a dash style are honoured', async () => {
    const h = host()
    const { p, env } = await plan(h, [op('drawing.addLevel', { price: 182.5, color: 'pink', style: 'dashed' })])
    await commitPlan(h, p, { env })
    expect(drawings()[0]).toMatchObject({ points: [{ price: 182.5 }], color: '#ec4899', lineStyle: 'dashed', lineWidth: 1 })
    const g = await plan(h, [op('drawing.addLevel', { price: 10, color: null, style: null })])
    await commitPlan(h, g.p, { env: g.env })
    expect(drawings()[1]).toMatchObject({ color: UCT_DRAW_GOLD, lineWidth: 1 })
  })
  it('⛔ Undo NEVER uses the store\'s shared undo: a line the member drew afterwards survives the Agent\'s Undo', async () => {
    const h = host()
    const { p, env } = await plan(h, [op('drawing.addLevel', { price: 50, color: null, style: null })])
    const res = await commitPlan(h, p, { env })
    const mine = store.addDrawing(SYM, { type: 'trendline', points: [{ time: '2026-09-10', price: 40 }, { time: '2026-09-24', price: 45 }], color: '#fff', lineWidth: 1 })
    expect((await undoEntry(h, res.undo)).ok).toBe(true)
    expect(drawings().map(d => d.id)).toEqual([mine])
  })
  it('…but if the member then moved or restyled the Agent’s OWN line, Undo refuses and leaves it alone', async () => {
    const h = host()
    const { p, env } = await plan(h, [op('drawing.addLevel', { price: 60, color: null, style: null })])
    const res = await commitPlan(h, p, { env })
    const [d] = drawings()
    store.updateDrawing(SYM, d.id, { points: [{ price: 61 }] })
    const u = await undoEntry(h, res.undo)
    expect(u.ok).toBe(false)
    expect(u.reason).toMatch(/has changed since I made that change/)
    expect(drawings()[0].points[0].price).toBe(61)
  })
  it('refuses a missing / non-positive price, an unknown colour, and a duplicate level — nothing is written', async () => {
    const h = host()
    store.addDrawing(SYM, { type: 'horizontal', points: [{ price: 99 }], color: '#fff', lineWidth: 1 })
    const reasons = []
    for (const a of [{ price: 0, color: null, style: null }, { price: 10, color: 'sparkly', style: null }, { price: 99, color: null, style: null }]) {
      reasons.push((await plan(h, [op('drawing.addLevel', a)])).p.refusals[0]?.reason)
    }
    expect(reasons[0]).toMatch(/positive number/)
    expect(reasons[1]).toMatch(/isn't a colour/)
    expect(reasons[2]).toMatch(/already a horizontal line at \$99/)
    expect(drawings().length).toBe(1)
  })
})

describe('drawing.style / drawing.remove — ONE drawing, by id', () => {
  it('"make that line pink and dashed": only that drawing changes; Undo restores its old style', async () => {
    const h = host()
    const a = store.addDrawing(SYM, { type: 'horizontal', points: [{ price: 1 }], color: '#111111', lineWidth: 1 })
    const b = store.addDrawing(SYM, { type: 'horizontal', points: [{ price: 2 }], color: '#222222', lineWidth: 1 })
    const { p, env } = await plan(h, [op('drawing.style', { drawing: b, color: 'pink', style: 'dashed', width: null })])
    expect(p.lines[0]).toMatch(/^Restyled the .* colour #ec4899, dashed$/)
    const res = await commitPlan(h, p, { env })
    expect(drawings().find(d => d.id === b)).toMatchObject({ color: '#ec4899', lineStyle: 'dashed' })
    expect(drawings().find(d => d.id === a).color).toBe('#111111')
    expect((await undoEntry(h, res.undo)).ok).toBe(true)
    const back = drawings().find(d => d.id === b)
    expect(back.color).toBe('#222222')
    expect(back.lineStyle).toBe(undefined)
  })
  it('remove: gone from the store; Undo puts back the same drawing (a new id, same type, points and style)', async () => {
    const h = host()
    const id = store.addDrawing(SYM, { type: 'rect', points: [{ time: '2026-09-01', price: 5 }, { time: '2026-09-05', price: 6 }], color: '#abcdef', lineWidth: 2 })
    const { p, env } = await plan(h, [op('drawing.remove', { drawing: id })])
    expect(p.lines[0]).toMatch(/^Removed the .* from /)
    const res = await commitPlan(h, p, { env })
    expect(drawings()).toEqual([])
    expect((await undoEntry(h, res.undo)).ok).toBe(true)
    const [d] = drawings()
    expect(d).toMatchObject({ type: 'rect', color: '#abcdef', lineWidth: 2, points: [{ time: '2026-09-01', price: 5 }, { time: '2026-09-05', price: 6 }] })
  })
  it('⛔ remove is refused for a drawing an alert is bound to, when the alert list cannot be read, and when locked', async () => {
    const h = host()
    const bound = store.addDrawing(SYM, { type: 'horizontal', points: [{ price: 7 }], color: '#fff', lineWidth: 1 })
    const locked = store.addDrawing(SYM, { type: 'horizontal', points: [{ price: 8 }], color: '#fff', lineWidth: 1, locked: true })
    alerts = [{ id: 1, sym: SYM, target_price: 7, direction: 'above', is_active: true, drawing_id: bound, alert_type: 'line' }]
    expect((await plan(h, [op('drawing.remove', { drawing: bound })])).p.refusals[0].reason).toMatch(/alert is attached/)
    expect((await plan(h, [op('drawing.remove', { drawing: locked })])).p.refusals[0].reason).toMatch(/locked/)
    expect((await plan(h, [op('drawing.style', { drawing: locked, color: 'red', style: null, width: null })])).p.refusals[0].reason).toMatch(/locked/)
    alerts = []; alertsFail = true; _resetAlertCache()
    const free = store.addDrawing(SYM, { type: 'horizontal', points: [{ price: 9 }], color: '#fff', lineWidth: 1 })
    expect((await plan(h, [op('drawing.remove', { drawing: free })])).p.refusals[0].reason).toMatch(/couldn't check whether an alert/)
    expect(drawings().length).toBe(3)
    expect((await plan(h, [op('drawing.remove', { drawing: 'nope' })])).p.refusals[0].reason).toMatch(/no drawing “nope”/)
  })
})

describe('context and routing', () => {
  it('the model sees each symbol\'s drawings by id; "draw a horizontal line at 200" routes the drawings group', () => {
    const h = host()
    store.addDrawing(SYM, { type: 'horizontal', points: [{ price: 3 }], color: '#fff', lineWidth: 1 })
    const { context: ctx } = buildContext(h, CTX)
    expect(ctx.drawings[0]).toMatchObject({ symbol: SYM, shownOn: [`Chart (${SYM})`] })
    expect(ctx.drawings[0].drawings[0]).toMatchObject({ what: expect.stringMatching(/3/), style: 'solid', width: 1 })
    const r = routeManifest(manifestFor(CTX), 'Draw a horizontal line at $200 on NVDA', { limit: 60, budget: 55 })
    expect(r.routing.selected).toContain('drawings')
    expect(r.manifest.some(c => c.name === 'drawing.addLevel')).toBe(true)
  })
})

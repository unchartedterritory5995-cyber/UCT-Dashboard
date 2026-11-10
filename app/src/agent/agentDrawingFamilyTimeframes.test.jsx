// COMPLETE DRAWING CONTROL — the part the panel's fixture board does not reach: a chart on another timeframe. The stored form
// of a point depends on the timeframe (dates on D/W/M, ET-shifted seconds intraday), a drawing keeps the form it was made in
// when the chart moves on, and a line alert has to reach the server in true UTC. Planner and runtime are real; no model runs.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { registerBuiltins } from './builtins'
import { buildContext } from './capabilities'
import { planOps, collectTargets, prepareOps } from './executor'
import { commitPlan, undoEntry } from './runtime'
import { buildDrawingSource } from './host'
import { _resetAlertCache } from './capabilities/alert'
import * as store from '../components/chart/drawingsStore'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()
const CTX = { surface: 'charts' }
let SYM = 'NVDA', n = 0, book = []

const host = (tf) => ({ drawings: buildDrawingSource({ list: () => [{ label: `Chart (${SYM})`, symbol: SYM, drawSym: SYM, tf, view: null, cs: {} }] }) })
const op = (action, args) => ({ action, target: SYM, args })
async function run(h, ops) {
  buildContext(h, CTX)
  const env = await prepareOps(ops)
  const p = planOps(collectTargets(h, ['drawing']), ops, env, CTX)
  return { p, env, res: p.ok ? await commitPlan(h, p, { env }) : null }
}
const peek = () => store.peekDrawings(SYM)
const open930 = (y, m, d) => Date.UTC(y, m - 1, d, 13, 30) / 1000    // October: 09:30 EDT, RAW unix (drawingTimeBase.js)
const ADD = (tool, points) => op('drawing.add', { tool, points, color: null, style: null })
const pt = (date, price) => ({ date, price })

beforeEach(() => {
  SYM = `F${++n}AM`
  book = []
  _resetAlertCache()
  globalThis.fetch = vi.fn(async (u, o = {}) => {
    const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } })
    if (String(u).startsWith('/api/watchlist-alerts') && o.method === 'POST') {
      const b = JSON.parse(o.body)
      const row = { ...b, id: `a${book.length + 1}`, is_active: 1, triggered_at: null }
      book = [row, ...book]
      return json(row)
    }
    if (String(u).startsWith('/api/watchlist-alerts') && o.method === 'DELETE') { book = book.filter(r => !String(u).endsWith(r.id)); return json({ ok: true }) }
    return json(book)
  })
})
afterEach(() => { vi.restoreAllMocks() })

describe('another timeframe', () => {
  it('intraday: a new tool stores ET-shifted seconds; weekly stores dates', async () => {
    await run(host('5'), [ADD('channel', [pt('2026-10-14', 100), pt('2026-10-20', 120), pt('2026-10-15', 130)])])
    expect(peek()[0].points.map(p => p.time)).toEqual([open930(2026, 10, 14), open930(2026, 10, 20), open930(2026, 10, 15)])
    SYM = `${SYM}W`
    await run(host('W'), [ADD('vertical', [pt('2026-10-14', null)])])
    expect(peek()[0].points).toEqual([{ time: '2026-10-14', price: null }])
  })
  it('the request reads an intraday anchor back as its ET date', async () => {
    const h = host('5')
    await run(h, [ADD('arrow', [pt('2026-10-14', 100), pt('2026-10-20', 120)])])
    const { context } = buildContext(h, CTX)
    expect(context.drawings[0].drawings[0].anchors).toEqual(['2026-10-14 at 100', '2026-10-20 at 120'])
  })
  it('a drawing made on the daily keeps dates when it is edited from a 5-minute chart, and the reverse', async () => {
    await run(host('D'), [ADD('arrow', [pt('2026-10-14', 100), pt('2026-10-20', 120)])])
    const id = peek()[0].id
    await run(host('5'), [op('drawing.setAnchors', { drawing: id, points: [{ point: 2, date: '2026-10-22', price: null }] })])
    expect(peek()[0].points[1]).toEqual({ time: '2026-10-22', price: 120 })
    SYM = `${SYM}R`
    await run(host('5'), [ADD('arrow', [pt('2026-10-14', 100), pt('2026-10-20', 120)])])
    const id2 = peek()[0].id
    await run(host('D'), [op('drawing.setAnchors', { drawing: id2, points: [{ point: 2, date: '2026-10-22', price: null }] })])
    expect(peek()[0].points[1]).toEqual({ time: open930(2026, 10, 22), price: 120 })
  })
  it('an intraday trendline reaches the alert route in true UTC, and Undo removes that alert', async () => {
    const h = host('5')
    await run(h, [op('drawing.addTrendline', { from: pt('2026-10-14', 100), to: pt('2026-10-20', 120), color: null, style: null })])
    const d = peek()[0]
    const { res } = await run(h, [op('drawing.setAlert', { drawing: d.id, direction: 'above', level: null })])
    expect(book).toHaveLength(1)
    expect(book[0]).toMatchObject({ sym: SYM, direction: 'above', alert_type: 'trendline', drawing_id: d.id, anchor_p1: 100, anchor_p2: 120 })
    expect(book[0].anchor_t1).toBe(Date.UTC(2026, 9, 14, 13, 30) / 1000)
    expect(book[0].anchor_t2).toBe(Date.UTC(2026, 9, 20, 13, 30) / 1000)
    expect((await undoEntry(h, res.undo)).ok).toBe(true)
    expect(book).toEqual([])
  })
})

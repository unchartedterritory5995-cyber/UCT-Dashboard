// A plan that draws something and then acts on it by its plan-local id (`new:1`): "draw a trendline and alert me when it
// breaks". The store mints the real id only at commit, so the alert must end up bound to THAT id. Whatever a plan does with a
// drawing it adds, the member gets a sentence: no capability may throw out of planning (an unanswered request).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { buildContext, getCapability } from './capabilities'
import { planOps, collectTargets, prepareOps, INTERNAL_ERROR } from './executor'
import { commitPlan, undoEntry } from './runtime'
import { buildDrawingSource } from './host'
import { _resetAlertCache } from './capabilities/alert'
import * as store from '../components/chart/drawingsStore'
import { setupPanel, ONE } from './testing/panelHarness'

registerBuiltins()
const CTX = { surface: 'charts' }
let SYM = 'NVDA'
let n = 0
let alerts = []
let refuse = false
const JSON_OK = { status: 200, headers: { 'content-type': 'application/json' } }
const host = () => ({ drawings: buildDrawingSource({ list: () => [{ label: `Chart (${SYM})`, symbol: SYM, drawSym: SYM, cs: {} }] }) })
const op = (action, args) => ({ action, target: SYM, args })
const drawings = () => store.peekDrawings(SYM)
async function plan(h, ops) {
  buildContext(h, CTX)
  const env = await prepareOps(ops)
  return { p: planOps(collectTargets(h, ['drawing']), ops, env, CTX), env }
}
const SPAN = { from: { date: '2026-09-01', price: 100 }, to: { date: '2026-09-15', price: 120 }, color: null, style: null }
const LINE = () => op('drawing.addTrendline', SPAN)
const FIB = () => op('drawing.addFib', SPAN)
const LEVEL = () => op('drawing.addLevel', { price: 50, color: null, style: null })
const ALERT = () => op('drawing.setAlert', { drawing: 'new:1', direction: 'below', level: null })

beforeEach(() => {
  SYM = `Q${++n}X`
  alerts = []; refuse = false
  _resetAlertCache()
  globalThis.fetch = vi.fn(async (url, init) => {
    const u = String(url)
    if (!u.startsWith('/api/watchlist-alerts')) return new Response('{}', JSON_OK)
    if (init?.method === 'POST') {
      if (refuse) return new Response('{}', { status: 500 })
      const b = JSON.parse(init.body)
      const row = { id: `a${alerts.length + 1}`, sym: b.sym, target_price: b.target_price, direction: b.direction, alert_type: b.alert_type, drawing_id: b.drawing_id, is_active: true }
      alerts.push(row)
      return new Response(JSON.stringify(row), JSON_OK)
    }
    if (init?.method === 'DELETE') { alerts = alerts.filter(a => !u.endsWith(`/${a.id}`)); return new Response('{}', JSON_OK) }
    return new Response(JSON.stringify(alerts), JSON_OK)
  })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

describe('an alert on the drawing the same plan draws', () => {
  it('"draw a trendline and alert me when it breaks": both land, the alert bound to the STORE\'s id; one Undo takes back both', async () => {
    const h = host()
    const { p, env } = await plan(h, [LINE(), ALERT()])
    expect(p.ok).toBe(true)
    expect(p.lines[0]).toMatch(/trendline/i)
    expect(p.lines.some(l => l.includes('at or below the trendline'))).toBe(true)
    const res = await commitPlan(h, p, { env })
    expect(res.ok).toBe(true)
    const [d] = drawings()
    expect(d.id.startsWith('new:')).toBe(false)
    expect(alerts).toHaveLength(1)
    expect(alerts[0].drawing_id).toBe(d.id)                        // never the plan-local id: useBoundDrawingAlerts keys on this
    expect((await undoEntry(h, res.undo)).ok).toBe(true)
    expect(drawings()).toEqual([])
    expect(alerts).toEqual([])
  })
  it('a Fibonacci level keeps its level in the bound id; the second added drawing is new:2', async () => {
    const h = host()
    const { p, env } = await plan(h, [LINE(), FIB(), op('drawing.setAlert', { drawing: 'new:2', direction: 'above', level: 0.618 })])
    expect(p.ok).toBe(true)
    expect((await commitPlan(h, p, { env })).ok).toBe(true)
    const fib = drawings().find(d => d.type === 'fib')
    expect(alerts[0].drawing_id).toBe(`${fib.id}#0.618`)
  })
  it('the alert POST fails: the drawing is taken back, and the receipt says nothing was left changed', async () => {
    const h = host()
    const { p, env } = await plan(h, [LINE(), ALERT()])
    refuse = true
    const res = await commitPlan(h, p, { env })
    expect(res.ok).toBe(false)
    expect(res.failed[0].reason).toContain('nothing was left changed')
    expect(drawings()).toEqual([])
  })
  it('an alert on an EXISTING drawing still posts first: a refused alert touches nothing', async () => {
    const h = host()
    const first = await plan(h, [LINE()])
    await commitPlan(h, first.p, { env: first.env })
    const [d] = drawings()
    const { p, env } = await plan(h, [op('drawing.setAlert', { drawing: d.id, direction: 'above', level: null }), LEVEL()])
    refuse = true
    const res = await commitPlan(h, p, { env })
    expect(res.ok).toBe(false)
    expect(drawings()).toHaveLength(1)
  })
  it('a tool that cannot carry an alert is refused in words, nothing written', async () => {
    const { p } = await plan(host(), [op('drawing.addRectangle', SPAN), ALERT()])
    expect(p.ok).toBe(false)
    expect(p.refusals[0].reason).toMatch(/can't carry an alert/)
  })
  it('a plan-local id the plan never made is refused in words', async () => {
    const { p } = await plan(host(), [ALERT()])
    expect(p.ok).toBe(false)
    expect(p.refusals[0].reason).toContain('new:1')
  })
  it('removing or clearing the drawing the plan just put an alert on cannot orphan the alert', async () => {
    const h = host()
    const rm = await plan(h, [LINE(), ALERT(), op('drawing.remove', { drawing: 'new:1' })])
    expect(rm.p.ok).toBe(false)
    expect(rm.p.refusals[0].reason).toMatch(/alert is attached/)
    const cl = await plan(h, [LINE(), LEVEL(), ALERT(), op('drawing.clear', {})])
    expect(cl.p.ok).toBe(true)
    expect(cl.p.plans[0].patch.add.map(x => x.type)).toEqual(['trendline'])
    expect(cl.p.plans[0].patch.alerts).toHaveLength(1)
  })
})

describe('the class: every capability that takes a drawing id, given the plan-local id of a drawing the plan adds', () => {
  const FOLLOW = {
    'drawing.style': { drawing: 'new:1', color: 'red', style: null, width: null },
    'drawing.setVisible': { drawing: 'new:1', visible: false },
    'drawing.lock': { drawing: 'new:1', locked: true },
    'drawing.remove': { drawing: 'new:1' },
    'drawing.setAlert': { drawing: 'new:1', direction: 'above', level: null },
    'drawing.setAnchors': { drawing: 'new:1', points: [{ point: 2, date: null, price: 125 }] },
    'drawing.setProps': { drawing: 'new:1', set: [{ prop: 'showPriceLabel', value: false, opacity: null }] },
    'drawing.setLevel': { drawing: 'new:1', price: 130 },
    'drawing.setFibLevels': { drawing: 'new:1', levels: [{ level: 0.618, visible: false, color: null }], bands: [], reset: false },
  }
  it('the table covers every registered capability with a `drawing` argument', async () => {
    const { manifestFor } = await import('./capabilities')
    const names = manifestFor(CTX).filter(c => c.args?.properties?.drawing).map(c => c.name)
    expect([...names].sort()).toEqual(Object.keys(FOLLOW).sort())
  })
  for (const [make, label] of [[LINE, 'trendline'], [FIB, 'fib'], [LEVEL, 'level']]) {
    for (const [action, args] of Object.entries(FOLLOW)) {
      it(`${label} + ${action}: a plan or a sentence, never an exception`, async () => {
        const { p } = await plan(host(), [make(), op(action, args)])
        if (p.ok) expect(p.lines.length, 'the receipt names the drawing AND the step on it').toBe(2)
        else expect(p.refusals[0].reason.length).toBeGreaterThan(5)
      })
    }
  }
})

describe('a capability that throws while planning', () => {
  const crash = (action, fn) => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    return vi.spyOn(getCapability(action), fn).mockImplementation(() => { throw new TypeError('boom') })
  }
  for (const fn of ['check', 'apply', 'describe']) {
    it(`in ${fn}, under test: rethrown, so the suite fails on it`, async () => {
      crash('drawing.addLevel', fn)
      const h = host()
      buildContext(h, CTX)
      const ops = [LEVEL()]
      const env = await prepareOps(ops)
      expect(() => planOps(collectTargets(h, ['drawing']), ops, env, CTX)).toThrow('boom')
      expect(console.error).toHaveBeenCalled()
    })
    it(`in ${fn}, in production: refused in words, logged, coded`, async () => {
      vi.stubEnv('MODE', 'production')                               // the non-test path, forced
      crash('drawing.addLevel', fn)
      const { p } = await plan(host(), [LEVEL()])
      expect(p.ok).toBe(false)
      expect(p.refusals[0]).toMatchObject({ code: INTERNAL_ERROR })
      expect(p.refusals[0].reason).toMatch(/changed nothing/)
      expect(console.error).toHaveBeenCalled()
    })
  }
  it('in production, through the real panel: the member gets the sentence and the outcome row says internal-error, with no actions', async () => {
    vi.stubEnv('MODE', 'production')
    const panel = setupPanel()
    crash('chart.setTimeframe', 'describe')
    const { say } = panel.mount(...ONE())
    const said = await say('switch to weekly')
    expect(said).toMatch(/changed nothing/)
    const rows = vi.mocked(globalThis.fetch).mock.calls.filter(c => c[0] === '/api/agent/record').map(c => JSON.parse(c[1].body).outcomeData)
    expect(rows).toContainEqual({ kind: 'internal-error' })
    expect(rows.filter(r => r?.kind === 'refused')).toEqual([])
    cleanup()
  })
})

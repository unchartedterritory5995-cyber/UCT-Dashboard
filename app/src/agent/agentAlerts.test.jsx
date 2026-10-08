// UCT Agent → the existing price Alerts product (/api/watchlist-alerts). The fixture server
// below implements the real routes' behaviour as measured from api/routers/watchlist_alerts.py
// + watchlist_alert_service.py: owner-scoped rows, hard delete (404 when not found), one-shot
// rows (is_active 0 + triggered_at when they go off), no cap, no duplicate check.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { buildContext, getCapability, manifestFor } from './capabilities'
import { registerBuiltins } from './builtins'
import { planOps, collectTargets, prepareOps } from './executor'
import { decideMode } from './policy'
import { commitPlan, undoEntry } from './runtime'
import { fastParse } from './fastPath'
import { _resetAlertCache, loadAlerts } from './capabilities/alert'
import { makeBoard } from './__fixtures__/board'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'

registerBuiltins()
const CTX = { surface: 'charts' }
const KNOWN = new Set(['NVDA', 'AMD', 'TSLA', 'SPY', 'AAPL'])
const QUOTES = { NVDA: 180, AMD: 150, TSLA: 250, SPY: 650, AAPL: 230 }

let server, calls, envelopes, failPost
const row = (id, sym, price, direction, extra = {}) => ({ id, user_id: 'me', sym, target_price: price, direction, is_active: 1, triggered_at: null, created_at: '2026-10-08T13:00:00Z', alert_type: 'price', drawing_id: null, ...extra })
beforeEach(() => {
  _resetAlertCache()
  try { localStorage.clear() } catch { /* */ }
  server = [row('a1', 'AMD', 160, 'above'), row('a2', 'AMD', 120, 'below'), row('a3', 'TSLA', 300, 'above', { is_active: 0, triggered_at: new Date().toISOString() })]
  calls = []; envelopes = []; failPost = false
  let n = 0
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const u = String(url); const method = init.method || 'GET'
    const body = init.body ? JSON.parse(init.body) : null
    calls.push([method, u, body])
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
    if (u.startsWith('/api/watchlist-alerts')) {
      if (method === 'GET') return json(u.includes('active_only=false') ? server : server.filter(r => r.is_active))
      if (method === 'POST') {
        if (failPost) return json({ detail: 'database is locked' }, 500)
        const r = row(`new${++n}`, body.sym.toUpperCase(), body.target_price, body.direction, { alert_type: body.alert_type })
        server = [r, ...server]
        return json(r)
      }
      if (method === 'DELETE') {
        const id = decodeURIComponent(u.split('/').pop())
        if (!server.some(r => r.id === id)) return json({ detail: 'Alert not found' }, 404)
        server = server.filter(r => r.id !== id)
        return json({ ok: true })
      }
    }
    if (u.startsWith('/api/live-prices')) {
      const t = new URL(u, 'http://x').searchParams.get('tickers').split(',')
      return json(Object.fromEntries(t.filter(s => QUOTES[s]).map(s => [s, { price: QUOTES[s] }])))
    }
    if (u.startsWith('/api/ticker-search')) {
      const q = new URL(u, 'http://x').searchParams.get('q')
      return json({ results: KNOWN.has(q) ? [{ ticker: q }] : [] })
    }
    if (u === '/api/agent/turn') {
      const e = envelopes.shift()
      return json({ conversationId: 'ac_1', envelope: typeof e === 'function' ? e(body) : e, usage: { research_calls: 0, citations: [] } })
    }
    if (u === '/api/agent/record') return json({ conversationId: 'ac_1' })
    return json({ conversations: [] })
  })
})
afterEach(() => { vi.restoreAllMocks() })

const KINDS = ['alertLibrary', 'alert']
const board = () => makeBoard([{ id: 'c', type: 'chart', x: 0, y: 0, w: 12, h: 20 }])
async function plan(host, ops) {
  await loadAlerts({ force: true })
  const env = await prepareOps(ops)
  return { p: planOps(collectTargets(host, KINDS), ops, env, CTX), env }
}
const CREATE = (symbol, price, direction = 'above') => ({ action: 'alert.create', target: 'alerts', args: { symbol, price, direction } })
const posts = () => calls.filter(c => c[0] === 'POST' && c[1].startsWith('/api/watchlist-alerts'))
const deletes = () => calls.filter(c => c[0] === 'DELETE')
const why = (p) => p.refusals.map(r => r.reason).join(' | ')

describe('discovery: the manifest and the context', () => {
  it('three alert actions, closed schemas; create and delete are confirm-risk; delete is irreversible', () => {
    const m = manifestFor(CTX).filter(c => c.name.startsWith('alert.'))
    expect(m.map(c => c.name).sort()).toEqual(['alert.create', 'alert.delete', 'alert.list'])
    expect(getCapability('alert.list').query).toBe(true)
    expect(getCapability('alert.create').risk).toBe('confirm')
    expect(getCapability('alert.delete')).toMatchObject({ risk: 'confirm', reversible: false })
    expect(getCapability('alert.create').args.properties.direction.enum).toEqual(['above', 'below'])
  })
  it('context: the library always (counts); each alert as a target when the book is small or alerts are the topic', async () => {
    await loadAlerts({ force: true })
    const { host } = board()
    const { context, refMap } = buildContext(host, { ...CTX, message: 'make the chart weekly' })
    expect(context.alertLibrary[0]).toMatchObject({ active: 2, wentOff: 1 })
    expect(context.alerts.map(a => [a.symbol, a.when, a.status.split(' ')[0]])).toEqual([
      ['AMD', 'at or above $160', 'active'], ['AMD', 'at or below $120', 'active'], ['TSLA', 'at or above $300', 'went'],
    ])
    expect(refMap[context.alerts[0].ref]).toEqual({ kind: 'alert', ref: 'a1' })
    // A big book stays out of unrelated requests (the counts say it exists).
    server = Array.from({ length: 30 }, (_, i) => row(`b${i}`, 'SPY', 700 + i, 'above'))
    await loadAlerts({ force: true })
    expect(buildContext(host, { ...CTX, message: 'make the chart weekly' }).context.alerts).toBeUndefined()
    expect(buildContext(host, { ...CTX, message: 'delete my SPY alert' }).context.alerts).toHaveLength(25)
  })
})

describe('alert.list (read-only, from the real rows)', () => {
  it('"show my alerts" (fast path) lists every alert with its status; nothing is written', async () => {
    const { host } = board()
    const f = fastParse('show my alerts', { host })
    expect(f.ops[0]).toMatchObject({ action: 'alert.list', args: { symbol: null, status: null, triggered_today: null } })
    const text = await getCapability('alert.list').answer(null, f.ops[0].args)
    expect(text).toMatch(/^Your alerts \(3\):/)
    expect(text).toContain('AMD at or above $160 — active')
    expect(text).toMatch(/TSLA at or above \$300 — went off/)
    expect(calls.every(c => c[0] === 'GET')).toBe(true)
  })
  it('filters: by symbol + active; "which went off today"; none → said plainly', async () => {
    const a = getCapability('alert.list')
    expect(await a.answer(null, { symbol: 'amd', status: 'active', triggered_today: null })).toMatch(/^Your active alerts on AMD \(2\):/)
    expect(await a.answer(null, { symbol: null, status: null, triggered_today: true })).toMatch(/^Your alerts that went off today \(1\):\n• TSLA/)
    expect(await a.answer(null, { symbol: 'NVDA', status: null, triggered_today: null })).toBe('You have no alerts on NVDA.')
  })
})

describe('alert.create', () => {
  it('VALID: proposed (never auto-applied); Apply POSTs exactly that alert, reads it back; Undo deletes exactly it', async () => {
    const { host } = board()
    const { p, env } = await plan(host, [CREATE('nvda', 200, 'above')])
    expect(p.ok).toBe(true)
    expect(decideMode('apply', p)).toBe('propose')
    expect(p.lines).toEqual(['Price alert: NVDA at or above $200 — goes off once, checked while the market is open'])
    const res = await commitPlan(host, p, { env })
    expect(res.ok).toBe(true)
    expect(posts().map(c => c[2])).toEqual([{ sym: 'NVDA', target_price: 200, direction: 'above', alert_type: 'price' }])
    expect(server.find(r => r.sym === 'NVDA')).toMatchObject({ is_active: 1, target_price: 200, direction: 'above' })
    const back = await undoEntry(host, res.undo)
    expect(back.ok).toBe(true)
    expect(server.some(r => r.sym === 'NVDA')).toBe(false)
    expect(deletes()).toHaveLength(1)
  })
  it('UNDO is refused once the alert went off (deleting it would not unsend the notification)', async () => {
    const { host } = board()
    const { p, env } = await plan(host, [CREATE('NVDA', 200)])
    const res = await commitPlan(host, p, { env })
    server = server.map(r => (r.sym === 'NVDA' ? { ...r, is_active: 0, triggered_at: new Date().toISOString() } : r))
    await loadAlerts({ force: true })
    const back = await undoEntry(host, res.undo)
    expect(back.ok).toBe(false)
    expect(server.some(r => r.sym === 'NVDA')).toBe(true)
    expect(deletes()).toHaveLength(0)
  })
  it.each([
    [CREATE('ZZZQ', 10), /UCT has no symbol “ZZZQ” — no alert was created/],
    [CREATE('NVDA', -5), /isn't a usable price level/],
    [CREATE('NVDA', 0), /isn't a usable price level/],
    [CREATE('NVDA', 150, 'above'), /NVDA is already at or above \$150 \(last \$180\), so that alert would go off right away/],
    [CREATE('NVDA', 190, 'below'), /already at or below \$190/],
    [CREATE('AMD', 160, 'above'), /You already have an active alert for AMD at or above \$160/],
  ])('REFUSED before any write: %j', async (op, re) => {
    const { host } = board()
    const { p } = await plan(host, [op])
    expect(p.ok).toBe(false)
    expect(why(p)).toMatch(re)
    expect(posts()).toHaveLength(0)
  })
  it('UNSUPPORTED condition (not above/below) is refused by the closed schema', async () => {
    const { host } = board()
    const { p } = await plan(host, [{ action: 'alert.create', target: 'alerts', args: { symbol: 'NVDA', price: 200, direction: 'crosses' } }])
    expect(p.ok).toBe(false)
    expect(posts()).toHaveLength(0)
  })
  it('LIMIT: at most 5 alerts in one request; the same alert twice in one request is refused', async () => {
    const { host } = board()
    const six = [200, 210, 220, 230, 240, 250].map(x => CREATE('NVDA', x))
    expect(why((await plan(host, six)).p)).toMatch(/more than 5 alerts in one request/)
    expect(why((await plan(host, [CREATE('NVDA', 200), CREATE('NVDA', 200)])).p)).toMatch(/already have an active alert/)
    expect(posts()).toHaveLength(0)
  })
  it('a DUPLICATE made elsewhere between proposal and Apply is refused at the write (server re-read)', async () => {
    const { host } = board()
    const { p, env } = await plan(host, [CREATE('NVDA', 200)])
    server = [row('other', 'NVDA', 200, 'above'), ...server]
    const res = await commitPlan(host, p, { env })
    expect(res.ok).toBe(false)
    expect(res.failed[0].reason).toMatch(/already have an active alert for NVDA at or above \$200/)
    expect(posts()).toHaveLength(0)
  })
  it('PERSISTENCE FAILURE: the server refuses → the receipt says so, nothing is claimed, nothing left behind', async () => {
    const { host } = board()
    const { p, env } = await plan(host, [CREATE('NVDA', 200), CREATE('SPY', 700)])
    failPost = true
    const res = await commitPlan(host, p, { env })
    expect(res.ok).toBe(false)
    expect(res.failed[0].reason).toMatch(/database is locked/)
    expect(server.some(r => r.sym === 'NVDA' || r.sym === 'SPY')).toBe(false)
  })
  it('PARTIAL FAILURE mid-request: the alert already made is taken back', async () => {
    const { host } = board()
    const { p, env } = await plan(host, [CREATE('NVDA', 200), CREATE('SPY', 700)])
    let k = 0
    const real = globalThis.fetch
    globalThis.fetch = vi.fn(async (u, i = {}) => ((i.method === 'POST' && String(u).startsWith('/api/watchlist-alerts') && ++k === 2)
      ? new Response(JSON.stringify({ detail: 'boom' }), { status: 500 }) : real(u, i)))
    const res = await commitPlan(host, p, { env })
    expect(res.ok).toBe(false)
    expect(res.compensated).toBe(true)
    expect(server.some(r => r.sym === 'NVDA' || r.sym === 'SPY')).toBe(false)
  })
})

describe('alert.delete', () => {
  it('by stable id: proposed; Apply deletes exactly that row and reads back; NO Undo (hard delete)', async () => {
    const { host } = board()
    const { p, env } = await plan(host, [{ action: 'alert.delete', target: 'a2', args: {} }])
    expect(p.ok).toBe(true)
    expect(decideMode('apply', p)).toBe('propose')
    expect(p.lines).toEqual(['Deleted the alert AMD at or below $120 (permanent)'])
    const res = await commitPlan(host, p, { env })
    expect(res.ok).toBe(true)
    expect(res.undo).toBeNull()
    expect(server.map(r => r.id)).toEqual(['a1', 'a3'])
  })
  it('STALE: the alert went off (or was deleted elsewhere) after the proposal → refused, nothing deleted', async () => {
    const { host } = board()
    const { p, env } = await plan(host, [{ action: 'alert.delete', target: 'a1', args: {} }])
    server = server.map(r => (r.id === 'a1' ? { ...r, is_active: 0, triggered_at: new Date().toISOString() } : r))
    const res = await commitPlan(host, p, { env })
    expect(res.ok).toBe(false)
    expect(res.failed[0].reason).toMatch(/changed since I read it/)
    expect(deletes()).toHaveLength(0)
    server = server.filter(r => r.id !== 'a1')
    const res2 = await commitPlan(host, (await plan(host, [{ action: 'alert.delete', target: 'a2', args: {} }])).p, { env })
    expect(res2.ok).toBe(true)
  })
  it('an alert that is not in the member\'s book cannot be targeted', async () => {
    const { host } = board()
    const { p } = await plan(host, [{ action: 'alert.delete', target: 'someone-elses', args: {} }])
    expect(p.ok).toBe(false)
    expect(deletes()).toHaveLength(0)
  })
})

describe('in the panel: proposal → Apply once → receipt; delete offers no Undo', () => {
  async function mount() {
    await loadAlerts({ force: true })
    const b = board()
    render(<AgentPanel host={b.host} onClose={() => {}} />)
    const box = screen.getByLabelText('Message UCT Agent')
    const say = (t) => { fireEvent.change(box, { target: { value: t } }); fireEvent.keyDown(box, { key: 'Enter' }) }
    return { ...b, say }
  }
  const lib = (b) => b.context.alertLibrary[0].ref
  const env = (disposition, ops, reply = '') => ({ disposition, reply, question: null, ops, unsupported_category: null })

  it('"Alert me when NVDA crosses above $200": the model\'s apply is proposed; a double-click Apply creates ONE alert; Undo is offered', async () => {
    const { say } = await mount()
    envelopes.push(b => env('apply', [{ action: 'alert.create', target: lib(b), args: { symbol: 'NVDA', price: 200, direction: 'above' } }]))
    say('Alert me when NVDA crosses above $200')
    await waitFor(() => expect(screen.getAllByTestId('agent-proposal')).toHaveLength(1), { timeout: 4000 })
    expect(screen.getByTestId('agent-proposal').textContent).toMatch(/NVDA at or above \$200 — goes off once/)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Apply' }).disabled).toBe(false))
    const btn = screen.getByRole('button', { name: 'Apply' })
    fireEvent.click(btn); fireEvent.click(btn)
    await waitFor(() => expect(screen.getAllByTestId('agent-receipt')).toHaveLength(1), { timeout: 4000 })
    expect(posts()).toHaveLength(1)
    expect(screen.getAllByTestId('agent-undo')).toHaveLength(1)
  })
  it('delete is proposed, applied once, and its receipt has no Undo', async () => {
    const { say } = await mount()
    envelopes.push(b => env('apply', [{ action: 'alert.delete', target: b.context.alerts.find(a => a.when === 'at or below $120').ref, args: {} }]))
    say('delete my AMD 120 alert')
    await waitFor(() => expect(screen.getAllByTestId('agent-proposal')).toHaveLength(1), { timeout: 4000 })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Apply' }).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(screen.getAllByTestId('agent-receipt')).toHaveLength(1), { timeout: 4000 })
    expect(screen.getByTestId('agent-receipt').textContent).toMatch(/Deleted the alert AMD at or below \$120 \(permanent\)/)
    expect(screen.queryAllByTestId('agent-undo')).toHaveLength(0)
    expect(deletes().map(c => c[1])).toEqual(['/api/watchlist-alerts/a2'])
  })
})

// Saved screens — the Screener's own routes (api/routers/screener.py saved-screens): owner-
// scoped, NO name uniqueness and NO revision server-side, starters read-only. The fixture
// server below has exactly those semantics.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { registerBuiltins } from './builtins'
import { getCapability } from './capabilities'
import { planOps, collectTargets, prepareOps } from './executor'
import { decideMode } from './policy'
import { commitPlan, undoEntry } from './runtime'
import { _resetScreenerCache, loadSaved, loadMeta } from './capabilities/screener'
import { makeBoard } from './__fixtures__/board'

registerBuiltins()
const SPEC = { filters: [{ key: 'adr_pct', op: 'gt', min: 5 }], sort: { key: 'adr_pct', dir: 'desc' } }
let server, calls, seq, fail
beforeEach(() => {
  _resetScreenerCache()
  seq = 100; calls = []; fail = null
  server = { saved: [{ id: 7, name: 'Momentum Scan', spec: SPEC }, { id: 8, name: 'Old Test Scan', spec: { filters: [] } }], starters: [{ id: 'starter_uct_50', name: 'UCT 50', spec: { filters: [{ key: 'uct_composite', op: 'gte', min: 80 }] } }] }
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const u = String(url); const m = (init.method || 'GET').toUpperCase(); const body = init.body ? JSON.parse(init.body) : null
    calls.push([m, u, body])
    const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } })
    if (fail && fail(m, u)) return json({ detail: 'database is locked' }, 500)
    if (u === '/api/screener/fields') return json({ fields: [{ key: 'adr_pct', label: 'ADR %', type: 'range', unit: '%' }] })
    if (u === '/api/screener/scan') return json({ total: 3, rows: [{ ticker: 'AAA', adr_pct: 9 }], snapshot_date: '2026-10-07' })
    if (u === '/api/screener/saved-screens' && m === 'GET') return json({ saved: server.saved, starters: server.starters })
    if (u === '/api/screener/saved-screens' && m === 'POST') { const row = { id: ++seq, name: body.name, spec: body.spec }; server.saved.unshift(row); return json(row) }
    const mm = /^\/api\/screener\/saved-screens\/(\d+)$/.exec(u)
    if (mm) {
      const row = server.saved.find(s => s.id === Number(mm[1]))
      if (!row) return json({ detail: 'not found' }, 404)
      if (m === 'PUT') { Object.assign(row, body); return json(row) }
      if (m === 'DELETE') { server.saved = server.saved.filter(s => s !== row); return json({ deleted: true }) }
    }
    return json({})
  })
})
afterEach(() => { vi.restoreAllMocks() })

const K = ['savedScreens']
const board = () => makeBoard([])
async function plan(host, ops) {
  await loadSaved({ force: true })
  const env = await prepareOps(ops)
  return { p: planOps(collectTargets(host, K), ops, env, { surface: 'charts' }), env }
}
const writes = () => calls.filter(c => c[0] !== 'GET' && c[1].startsWith('/api/screener/saved-screens'))

describe('screener.saveAs — the LAST screen run here, exactly as it ran', () => {
  it('after a screen: proposed; POSTs exactly its filters + sort (no paging); read back; Undo deletes it', async () => {
    const { host } = board()
    await loadMeta()
    await getCapability('screener.run').answer(null, { filters: [{ field: 'adr_pct', op: 'gt', value: 5, max: null }], sort_field: null, sort_dir: null, mode: 'new', show: 5, as: null })
    const { p, env } = await plan(host, [{ action: 'screener.saveAs', target: 'screens', args: { name: 'High ADR Momentum' } }])
    expect(p.ok).toBe(true)
    expect(decideMode('apply', p)).toBe('propose')
    const res = await commitPlan(host, p, { env })
    expect(res.ok).toBe(true)
    const post = writes().find(c => c[0] === 'POST' && c[1] === '/api/screener/saved-screens')
    expect(post[2].name).toBe('High ADR Momentum')
    expect(post[2].spec.filters).toEqual([{ key: 'adr_pct', op: 'gt', min: 5 }])
    expect(post[2].spec).not.toHaveProperty('page_size')
    expect(server.saved.some(s => s.name === 'High ADR Momentum')).toBe(true)
    expect((await undoEntry(host, res.undo)).ok).toBe(true)
    expect(server.saved.some(s => s.name === 'High ADR Momentum')).toBe(false)
  })
  it('no screen run yet → refused (nothing invented); a name you already use → refused, never overwritten', async () => {
    const { host } = board()
    expect((await plan(host, [{ action: 'screener.saveAs', target: 'screens', args: { name: 'X' } }])).p.refusals[0].reason).toMatch(/Run a screen here first/)
    await loadMeta()
    await getCapability('screener.run').answer(null, { filters: [{ field: 'adr_pct', op: 'gt', value: 5, max: null }], sort_field: null, sort_dir: null, mode: 'new', show: 5, as: null })
    expect((await plan(host, [{ action: 'screener.saveAs', target: 'screens', args: { name: 'momentum scan' } }])).p.refusals[0].reason).toMatch(/already have a saved screen named “Momentum Scan”/)
    expect(writes()).toHaveLength(0)
  })
})

describe('screener.duplicateSaved / renameSaved / deleteSaved', () => {
  it('copy: the stored spec unchanged, default "<name> copy"; a starter can be copied (becomes yours)', async () => {
    const { host } = board()
    const a = await plan(host, [{ action: 'screener.duplicateSaved', target: 'screens', args: { screen: '7', name: null } }])
    expect(a.p.lines[0]).toBe('Copied the screen “Momentum Scan” to a new saved screen “Momentum Scan copy”')
    await commitPlan(host, a.p, { env: a.env })
    expect(server.saved.find(s => s.name === 'Momentum Scan copy').spec).toEqual(SPEC)
    const b = await plan(host, [{ action: 'screener.duplicateSaved', target: 'screens', args: { screen: 'starter_uct_50', name: 'My UCT 50' } }])
    await commitPlan(host, b.p, { env: b.env })
    expect(server.saved.find(s => s.name === 'My UCT 50').spec).toEqual(server.starters[0].spec)
  })
  it('rename: yours only; Undo renames back; a starter is refused', async () => {
    const { host } = board()
    const { p, env } = await plan(host, [{ action: 'screener.renameSaved', target: 'screens', args: { screen: '7', name: 'Momentum Leaders' } }])
    const res = await commitPlan(host, p, { env })
    expect(server.saved.find(s => s.id === 7).name).toBe('Momentum Leaders')
    expect((await undoEntry(host, res.undo)).ok).toBe(true)
    expect(server.saved.find(s => s.id === 7).name).toBe('Momentum Scan')
    expect((await plan(host, [{ action: 'screener.renameSaved', target: 'screens', args: { screen: 'starter_uct_50', name: 'X' } }])).p.refusals[0].reason).toMatch(/starter screens can't be renamed/)
  })
  it('delete: proposed; exactly that id; no Undo; starters / unknown refused; stale (renamed or gone) refused at Apply', async () => {
    const { host } = board()
    const { p, env } = await plan(host, [{ action: 'screener.deleteSaved', target: 'screens', args: { screen: '8' } }])
    expect(decideMode('apply', p)).toBe('propose')
    const res = await commitPlan(host, p, { env })
    expect(res.ok && res.undo === null).toBe(true)
    expect(writes().map(c => c.slice(0, 2))).toEqual([['DELETE', '/api/screener/saved-screens/8']])
    expect((await plan(host, [{ action: 'screener.deleteSaved', target: 'screens', args: { screen: 'starter_uct_50' } }])).p.ok).toBe(false)
    expect((await plan(host, [{ action: 'screener.deleteSaved', target: 'screens', args: { screen: '999' } }])).p.ok).toBe(false)
    const s = await plan(host, [{ action: 'screener.deleteSaved', target: 'screens', args: { screen: '7' } }])
    server.saved.find(x => x.id === 7).name = 'Momentum (keep)'
    const r = await commitPlan(host, s.p, { env: s.env })
    expect(r.ok).toBe(false)
    expect(server.saved.some(x => x.id === 7)).toBe(true)
  })
  it('a server refusal is reported; nothing claimed', async () => {
    const { host } = board()
    const { p, env } = await plan(host, [{ action: 'screener.duplicateSaved', target: 'screens', args: { screen: '7', name: 'Copy' } }])
    fail = (m) => m === 'POST'
    const res = await commitPlan(host, p, { env })
    expect(res.ok).toBe(false)
    expect(res.failed[0].reason).toMatch(/database is locked/)
    expect(server.saved.some(s => s.name === 'Copy')).toBe(false)
  })
})

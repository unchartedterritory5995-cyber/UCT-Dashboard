// Recently deleted (recentlyDeleted.list / recentlyDeleted.restore): bring back a deleted watchlist, saved layout or saved
// screen through the SAME routes the Recently deleted panel's "Bring back" uses (/api/artifact-versions), against a stand-in
// server with the router's semantics (owner-scoped lists, undelete compare-and-set on the head, 409 once it exists, a layout
// name already used since comes back "(restored)", a delete leaves a tombstone). Read back from each kind's own list, an
// exact Undo that sends it back only while unchanged, asks when two items fit, and never touches anything not named.
import { describe, it, expect, beforeEach } from 'vitest'
import { registerBuiltins } from './builtins'
import { planOps, collectTargets, prepareOps } from './executor'
import { decideMode } from './policy'
import { commitPlan, undoEntry } from './runtime'
import { fastParse } from './fastPath'
import { buildWatchlistSource } from './host'
import { wordsSelect } from './routing'
import { getCapability } from './capabilities'
import { _resetRecentlyDeleted, resolveDeleted, loadDeleted } from './capabilities/recentlyDeleted'
import { stateEffects } from './stateRail'

registerBuiltins()
const CTX = { surface: 'charts' }
const T0 = 1795000000            // epoch seconds (a fixed instant: no wall clock in the answers)

// ── the stand-in server ──
let srv
function server({ off = false, screensPaid = false } = {}) {
  srv = {
    off, screensPaid, calls: [],
    lists: [{ id: '1', name: 'Core', items: [{ id: 'i1', sym: 'AAPL', notes: '' }] }],
    layouts: [{ id: 11, name: 'Main Trading', scope: 'user' }, { id: 12, name: 'Swing', scope: 'user' }],
    screens: [{ id: '7', name: 'Live Screen', spec: { filters: [] } }],
    // the tombstones: artifact_id → { kind, label, head, deleted_at, payload }
    gone: {
      'watchlist:5': { label: 'Momentum', head: 3, deleted_at: T0, payload: { items: [{ id: 'm1', sym: 'NVDA', notes: '' }] } },
      'watchlist:6': { label: 'Earnings Plays', head: 2, deleted_at: T0 + 60, payload: { items: [] } },
      'layout:14': { label: 'Swing', head: 4, deleted_at: T0 + 120, payload: {} },
      'screen:9': { label: 'Momentum', head: 2, deleted_at: T0 + 180, payload: { filters: [] } },
    },
    heads: {},                    // live artefacts' version heads: "kind:id" → n
  }
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url); const method = init.method || 'GET'
    const body = init.body ? JSON.parse(init.body) : null
    srv.calls.push([method, u])
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
    let m
    if (u.startsWith('/api/artifact-versions')) {
      if (srv.off) return json({ detail: 'Not Found' }, 404)
      if ((m = /^\/api\/artifact-versions\/(\w+)\/deleted$/.exec(u))) {
        if (m[1] === 'screen' && srv.screensPaid) return json({ detail: 'paid' }, 402)
        const deleted = Object.entries(srv.gone).filter(([k]) => k.startsWith(`${m[1]}:`)).map(([k, g]) => ({ artifact_id: Number(k.split(':')[1]), label: g.label, head: g.head, deleted_at: g.deleted_at }))
        return json({ kind: m[1], deleted })
      }
      if ((m = /^\/api\/artifact-versions\/(\w+)\/(\d+)\/undelete$/.exec(u)) && method === 'POST') {
        const key = `${m[1]}:${m[2]}`
        const g = srv.gone[key]
        if (!g) return json({ detail: { error: 'exists' } }, 409)
        if (body.base_version !== g.head) return json({ detail: { error: 'version_conflict' } }, 409)
        delete srv.gone[key]
        const version = g.head + 1
        srv.heads[key] = version
        let name = g.label
        if (m[1] === 'watchlist') srv.lists.push({ id: m[2], name, items: g.payload.items })
        if (m[1] === 'layout') {
          if (srv.layouts.some(l => l.name === name)) name = `${name} (restored)`
          srv.layouts.push({ id: Number(m[2]), name, scope: 'user' })
        }
        if (m[1] === 'screen') srv.screens.push({ id: m[2], name, spec: g.payload })
        return json({ kind: m[1], artifact_id: Number(m[2]), restored_from: body.version, version, recorded: true, artifact: { id: Number(m[2]), name } })
      }
      if ((m = /^\/api\/artifact-versions\/(\w+)\/(\d+)$/.exec(u))) {
        const key = `${m[1]}:${m[2]}`
        return srv.heads[key] != null ? json({ kind: m[1], artifact_id: Number(m[2]), head: srv.heads[key], versions: [] }) : json({ detail: 'Not found' }, 404)
      }
      return json({ detail: 'Not Found' }, 404)
    }
    // a delete while armed leaves a tombstone (the history outlives it)
    const tomb = (kind, id, label) => { const key = `${kind}:${id}`; srv.gone[key] = { label, head: (srv.heads[key] || 1) + 1, deleted_at: T0 + 999, payload: {} }; delete srv.heads[key] }
    if ((m = /^\/api\/watchlists\/(\w+)(\?slim=1)?$/.exec(u))) {
      const l = srv.lists.find(x => x.id === m[1])
      if (method === 'DELETE') { if (!l) return json({ detail: 'nf' }, 404); srv.lists = srv.lists.filter(x => x !== l); tomb('watchlist', l.id, l.name); return json({ ok: true }) }
      return l ? json(l) : json({ detail: 'not found' }, 404)
    }
    if (u === '/api/screener/saved-screens') return json({ saved: srv.screens, starters: [] })
    if ((m = /^\/api\/screener\/saved-screens\/(\w+)$/.exec(u)) && method === 'DELETE') {
      const s = srv.screens.find(x => String(x.id) === m[1]); srv.screens = srv.screens.filter(x => x !== s); tomb('screen', m[1], s.name); return json({ ok: true })
    }
    return json({}, 404)
  }
}
function makeHost({ shownIn = [], active = 11 } = {}) {
  const watchlists = buildWatchlistSource({ getLists: () => srv.lists, getWidgets: () => shownIn, revalidate: () => {}, request: (u, o) => globalThis.fetch(u, o) })
  const layouts = {
    snapshot: () => ({ entries: srv.layouts.map(l => ({ ...l, kind: 'yours' })), active: srv.layouts.find(l => l.id === active) || null }),
    refresh: async () => {},
    remove: async (id) => { const l = srv.layouts.find(x => String(x.id) === String(id)); srv.layouts = srv.layouts.filter(x => x !== l); srv.gone[`layout:${id}`] = { label: l.name, head: (srv.heads[`layout:${id}`] || 1) + 1, deleted_at: T0, payload: {} }; delete srv.heads[`layout:${id}`] },
  }
  return { watchlists, layouts }
}
const OP = (item, kind = null) => ({ action: 'recentlyDeleted.restore', target: 'deleted', args: { item, kind } })
async function plan(host, ops) { const env = await prepareOps(ops); return planOps(collectTargets(host, ['recentlyDeleted']), ops, env, CTX) }
const run = async (host, ops) => commitPlan(host, await plan(host, ops))
const writes = () => srv.calls.filter(([m]) => m !== 'GET')

beforeEach(async () => {
  _resetRecentlyDeleted()
  server()
  const { _resetScreenerCache } = await import('./capabilities/screener')
  _resetScreenerCache?.()
})

describe('recentlyDeleted.restore: bring one item back, read back, exact Undo', () => {
  it('"bring back my Momentum watchlist": shown first; the list is back in My Lists, gone from Recently deleted; Undo sends it back', async () => {
    const host = makeHost()
    await loadDeleted({ force: true })
    const f = fastParse('bring back my Earnings Plays watchlist', { host })
    expect(f.ops.map(o => [o.action, o.args])).toEqual([['recentlyDeleted.restore', { item: 'Earnings Plays', kind: 'watchlist' }]])
    const p = await plan(host, [OP('5', 'watchlist')])
    expect(p.ok).toBe(true)
    expect(decideMode('apply', p)).toBe('propose')               // never applied unasked
    expect(p.plans[0].lines.join(' ')).toMatch(/Bring back your deleted watchlist “Momentum”, as it was when it was deleted/)
    const res = await commitPlan(host, p)
    expect(res.ok).toBe(true)
    expect(srv.lists.map(l => l.name)).toEqual(['Core', 'Momentum'])
    expect(host.watchlists.snapshot().map(l => l.name)).toContain('Momentum')
    expect(srv.gone['watchlist:5']).toBeUndefined()
    expect(res.lines.join(' ')).toMatch(/Brought back your watchlist “Momentum”, as it was when it was deleted\. It comes back private\./)
    // nothing else was written: one undelete, no other list touched
    expect(writes()).toEqual([['POST', '/api/artifact-versions/watchlist/5/undelete']])
    const u = await undoEntry(host, res.undo)
    expect(u.ok).toBe(true)
    expect(srv.lists.map(l => l.name)).toEqual(['Core'])
    expect(srv.gone['watchlist:5']).toBeTruthy()                 // back in Recently deleted (recoverable again)
  })

  it('a layout whose name was used since comes back "(restored)", and the receipt says so (never claims the old name)', async () => {
    const host = makeHost()
    const res = await run(host, [OP('Swing', 'layout')])
    expect(res.ok).toBe(true)
    expect(srv.layouts.map(l => l.name)).toEqual(['Main Trading', 'Swing', 'Swing (restored)'])
    expect(res.lines.join(' ')).toMatch(/Brought back your layout “Swing \(restored\)” \(you already have one named “Swing”\)/)
  })

  it('a saved screen comes back into the saved-screens list', async () => {
    const host = makeHost()
    const res = await run(host, [OP('9', 'screen')])
    expect(res.ok).toBe(true)
    expect(srv.screens.map(s => s.name)).toEqual(['Live Screen', 'Momentum'])
    expect(res.lines.join(' ')).toMatch(/saved screen “Momentum”/)
  })

  it('Undo is refused once the restored item was edited since (its version head moved), and nothing is deleted', async () => {
    const host = makeHost()
    const res = await run(host, [OP('5', 'watchlist')])
    srv.heads['watchlist:5'] += 1                                // the member edited the list after it came back
    const u = await undoEntry(host, res.undo)
    expect(u.ok).toBe(false)
    expect(srv.lists.map(l => l.name)).toContain('Momentum')
  })

  it('Undo never deletes the layout that is open now, nor a list a Watchlist widget is showing', async () => {
    const host = makeHost({ active: 14 })
    const res = await run(host, [OP('14', 'layout')])
    expect(res.ok).toBe(true)
    expect((await undoEntry(host, res.undo)).ok).toBe(false)
    expect(srv.layouts.some(l => l.id === 14)).toBe(true)
    const shown = makeHost({ shownIn: [{ id: 'w1', type: 'watchlist', opts: { watchKey: 'user:5' } }] })
    const r2 = await run(shown, [OP('5', 'watchlist')])
    expect((await undoEntry(shown, r2.undo)).ok).toBe(false)
    expect(srv.lists.some(l => l.id === '5')).toBe(true)
  })
})

describe('⛔ targeting and safety', () => {
  it('two deleted items fit the name → asks with both (kind and when), nothing is written; the kind picks one', async () => {
    const host = makeHost()
    const p = await plan(host, [OP('Momentum')])
    expect(p.ok).toBe(false)
    expect(p.refusals[0].reason).toMatch(/Which one do you mean: “Momentum” \(watchlist, deleted .* ET\) or “Momentum” \(saved screen, deleted .* ET\)\? Nothing was changed\./)
    expect(writes()).toEqual([])
    expect((await plan(host, [OP('Momentum', 'screen')])).ok).toBe(true)
  })

  it('a name that is not in Recently deleted (a live list, an unknown name) is refused with what IS there; nothing written', async () => {
    const host = makeHost()
    const live = await plan(host, [OP('Core', 'watchlist')])
    expect(live.ok).toBe(false)
    expect(live.refusals[0].reason).toMatch(/“Core” isn't in your recently deleted watchlists\. What's there: “Momentum”/)
    expect((await plan(host, [OP('Tech Leaders')])).refusals[0].reason).toMatch(/isn't in your recently deleted/)
    expect(writes()).toEqual([])
  })

  it('exclusions hold: "all my deleted watchlists except Momentum" plans exactly the others, one card, one Undo', async () => {
    const host = makeHost()
    const p = await plan(host, [OP('6', 'watchlist')])          // the model's ops: every listed watchlist but Momentum
    const res = await commitPlan(host, p)
    expect(res.ok).toBe(true)
    expect(srv.gone['watchlist:5']).toBeTruthy()                 // the excluded one stays deleted
    expect(srv.lists.map(l => l.name)).toEqual(['Core', 'Earnings Plays'])
  })

  it('two at once, the second refused by the server → the first is taken back; nothing is claimed', async () => {
    const host = makeHost()
    const p = await plan(host, [OP('5', 'watchlist'), OP('6', 'watchlist')])
    expect(p.ok).toBe(true)
    srv.gone['watchlist:6'].head = 9                             // changed elsewhere after the plan
    const res = await commitPlan(host, p)
    expect(res.ok).toBe(false)
    expect(res.lines).toEqual([])
    expect(res.failed[0].reason).toMatch(/“Earnings Plays” changed since I read it/)
    expect(srv.lists.map(l => l.name)).toEqual(['Core'])         // Momentum was sent back again
    expect(srv.gone['watchlist:5']).toBeTruthy()
  })

  it('the same item twice in one request, or one already back, is refused', async () => {
    const host = makeHost()
    const twice = await plan(host, [OP('5', 'watchlist'), OP('Momentum', 'watchlist')])
    expect(twice.refusals[0].reason).toMatch(/already being brought back/)
  })

  it('Recently deleted not armed (404) → says so, nothing written; saved screens unpaid (402) → says so', async () => {
    server({ off: true })
    const host = makeHost()
    expect((await plan(host, [OP('5', 'watchlist')])).refusals[0].reason).toMatch(/Recently deleted isn't available on your account/)
    expect(writes()).toEqual([])
    _resetRecentlyDeleted()
    server({ screensPaid: true })
    expect((await plan(makeHost(), [OP('9', 'screen')])).refusals[0].reason).toMatch(/paid plan/)
  })

  it('no watchlist source on this page → a watchlist is not brought back blind (no read-back)', async () => {
    const p = await plan({ layouts: makeHost().layouts }, [OP('5', 'watchlist')])
    expect(p.ok).toBe(false)
    expect(p.refusals[0].reason).toMatch(/open Charts to bring back a watchlist/)
  })

  it('the restore plan destroys nothing (state rail); its Undo shape reads as a delete', async () => {
    const host = makeHost()
    expect(stateEffects(await plan(host, [OP('5', 'watchlist')]))).toEqual([])
    const back = { ok: true, plans: [{ ref: 'deleted', kind: 'recentlyDeleted', patch: { sendBack: [{ kind: 'watchlist', id: '5', name: 'Momentum' }] }, items: [] }] }
    expect(stateEffects(back).map(e => `${e.state}:${e.type}`)).toEqual(['watchlist:delete'])
  })
})

describe('recentlyDeleted.list and the words', () => {
  it('lists every kind with when it was deleted; one kind on its own', async () => {
    const host = makeHost()
    const cap = getCapability('recentlyDeleted.list')
    const all = await cap.answer(null, { kind: null }, host)
    expect(all).toMatch(/Watchlists \(2\):\n• “Momentum” — deleted .* ET\n• “Earnings Plays”/)
    expect(all).toMatch(/Layouts \(1\):\n• “Swing”/)
    expect(all).toMatch(/Saved screens \(1\):/)
    expect(await cap.answer(null, { kind: 'layout' }, host)).not.toMatch(/Watchlists/)
    expect(fastParse('what have I deleted', { host }).ops[0]).toMatchObject({ action: 'recentlyDeleted.list', args: { kind: null } })
    expect(fastParse('show my recently deleted watchlists', { host }).ops[0]).toMatchObject({ action: 'recentlyDeleted.list', args: { kind: 'watchlist' } })
  })

  it('the fast path never claims a version restore, a switch, or a live name', async () => {
    const host = makeHost()
    await loadDeleted({ force: true })
    for (const t of ['restore my layout to yesterday', 'bring back my Main Trading layout', 'restore the Core watchlist', 'bring back the volume']) {
      const f = fastParse(t, { host })
      const actions = f && f.kind === 'ops' ? f.ops.map(o => o.action) : []
      expect(actions.includes('recentlyDeleted.restore'), t).toBe(false)
    }
    // "deleted" / "undelete" said: claimed whatever the cache holds (the planner then resolves or asks)
    expect(fastParse('undelete the Swing layout', { host }).ops[0].args).toEqual({ item: 'Swing', kind: 'layout' })
    expect(fastParse('restore my deleted Momentum screen', { host }).ops[0].args).toEqual({ item: 'Momentum', kind: 'screen' })
  })

  it('routing: its own words select the group; deleting, versions, tickers and panes never do', () => {
    for (const t of ['bring back my Momentum watchlist', 'undelete the Swing layout', 'show my recently deleted screens', 'what did I delete',
      'restore the watchlist I deleted', 'can I get my deleted layout back', 'bring my Momentum watchlist back']) expect(wordsSelect('recentlyDeleted', t), t).toBe(true)
    for (const t of ['delete my Momentum watchlist', 'remove NVDA from my list', 'restore my layout to yesterday', 'bring back the volume pane',
      'show my watchlists', 'undo that', 'put AAPL back in my watchlist', 'restore the default chart settings']) expect(wordsSelect('recentlyDeleted', t), t).toBe(false)
  })

  it('resolveDeleted: an id, an exact name, words of ONE name; never similarity', () => {
    const rows = [{ kind: 'watchlist', id: '5', label: 'Momentum Leaders', head: 1 }, { kind: 'watchlist', id: '6', label: 'Momentum Laggards', head: 1 }]
    expect(resolveDeleted(rows, 'watchlist:6').row.id).toBe('6')
    expect(resolveDeleted(rows, 'my momentum leaders watchlist').row.id).toBe('5')
    expect(resolveDeleted(rows, 'momentum').why).toMatch(/Which one do you mean/)
    expect(resolveDeleted(rows, 'momentm leaders').why).toMatch(/isn't in/)
  })
})

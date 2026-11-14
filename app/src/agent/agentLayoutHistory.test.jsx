// layoutHistory.list / layoutHistory.restore — Layouts → Version history, through the product's OWN routes
// (pages/charts/versionHistoryApi.js, the panel's three requests) and, after a restore, the workspace's OWN re-seed
// (ChartsWorkspace.handleVersionRestored, reached through pages/charts/versionHistoryAgent.js). The server below is a
// faithful stand-in for api/routers/workspace_doc.py + workspace_doc_store.restore: newest-first versions, a restore
// APPENDS a copy (source 'restore', restored_from, the target's content hash), compare-and-set on base_version (409),
// a missing / tombstoned target is 404, and every route is 404 while the store is dark. No market data anywhere.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { buildContext, getCapability } from './capabilities'
import { planOps, collectTargets, prepareOps, planShape, approvalBinding } from './executor'
import { commitPlan, undoEntry } from './runtime'
import { makeBoard } from './__fixtures__/board'
import { setupPanel, ONE } from './testing/panelHarness'
import { selectGroups, GROUPS } from './routing'
import { HISTORY_NOT_HERE, HISTORY_DARK, _resetLayoutHistoryCache, beforeMoment } from './capabilities/layoutHistory'
import { versionHistoryAgentSource } from '../pages/charts/versionHistoryAgent'
import VersionHistoryPanel from '../pages/charts/VersionHistory'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()
const CTX = { surface: 'charts' }
const ET = (iso) => Math.floor(new Date(iso).getTime() / 1000)

// ── the server ──
const P = (layout, settings = 's1', extra = {}) => ({ charts_workspace_layout: layout, chart_settings: settings, ...extra })
const sha = (prefs) => `sha:${JSON.stringify(Object.keys(prefs || {}).sort().map(k => [k, prefs[k]]))}`
function server({ dark = false, versions = null, prefsFailed = [], hookRestore = null } = {}) {
  const sv = {
    dark, calls: { list: 0, read: [], restore: [] }, prefsFailed,
    versions: (versions || [
      { version: 1, created_at: ET('2026-11-10T14:00:00Z'), source: 'migration', prefs: P('L-oldest') },
      { version: 2, created_at: ET('2026-11-12T15:00:00Z'), source: 'mirror', prefs: P('L-tue', 's2') },
      { version: 3, created_at: ET('2026-11-13T20:30:00Z'), source: 'mirror', prefs: P('L-wed', 's2') },
      { version: 4, created_at: ET('2026-11-14T14:45:00Z'), source: 'mirror', prefs: P('L-now', 's3') },
    ]).map(v => ({ tombstone: false, restored_from: null, ...v, content_sha256: v.tombstone ? null : sha(v.prefs) })),
  }
  sv.head = () => sv.versions[sv.versions.length - 1]
  sv.save = (prefs) => { const h = sv.head(); sv.versions.push({ version: h.version + 1, created_at: h.created_at + 60, source: 'mirror', restored_from: null, tombstone: false, prefs, content_sha256: sha(prefs) }) }
  const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
  sv.fetch = async (url, init = {}) => {
    const u = new URL(String(url), 'http://x')
    if (!u.pathname.startsWith('/api/workspace/doc')) return null
    if (sv.dark) return res(404, { detail: 'Not Found' })
    if (u.pathname === '/api/workspace/doc/versions') {
      sv.calls.list += 1
      const n = Number(u.searchParams.get('limit') || 50)
      return res(200, { board: 'charts', versions: [...sv.versions].reverse().slice(0, n).map(({ prefs: _p, ...v }) => v) })
    }
    const m = /^\/api\/workspace\/doc\/versions\/(\d+)$/.exec(u.pathname)
    if (m) {
      sv.calls.read.push(Number(m[1]))
      const v = sv.versions.find(x => x.version === Number(m[1]))
      if (!v) return res(404, { detail: 'No such version.' })
      const { prefs, ...rest } = v
      return res(200, { ...rest, doc: v.tombstone ? null : { prefs: { ...prefs } } })
    }
    if (u.pathname === '/api/workspace/doc/restore' && init.method === 'POST') {
      const body = JSON.parse(init.body)
      sv.calls.restore.push(body)
      if (hookRestore) { const r = hookRestore(body, sv); if (r) return r }
      const head = sv.head()
      if (body.base_version !== head.version) return res(409, { detail: 'stale' })
      const t = sv.versions.find(x => x.version === body.version)
      if (!t || t.tombstone) return res(404, { detail: 'No such version, or it is a tombstone.' })
      sv.versions.push({ version: head.version + 1, created_at: head.created_at + 30, source: 'restore', restored_from: t.version, tombstone: false, prefs: { ...t.prefs }, content_sha256: t.content_sha256 })
      return res(200, { board: 'charts', version: head.version + 1, appended: true, restored_from: t.version, prefs_written: Object.keys(t.prefs), prefs_unchanged: [], prefs_failed: sv.prefsFailed, left_untouched: [], complete: !sv.prefsFailed.length })
    }
    return res(404, {})
  }
  return sv
}
let restoreFetch = null
function install(sv) {
  const prev = globalThis.fetch
  globalThis.fetch = vi.fn(async (url, init) => (await sv.fetch(url, init)) ?? (prev ? prev(url, init) : { ok: false, status: 404, json: async () => ({}) }))
  restoreFetch = () => { globalThis.fetch = prev }
}
/** ChartsWorkspace's side of the source: where it is, and handleVersionRestored's re-seed (the board reads the head back). */
function workspace(sv, { mobile = false, grid = false } = {}) {
  const ws = { mobile, grid, reseeds: [], board: sv.head().prefs.charts_workspace_layout }
  ws.source = versionHistoryAgentSource(() => ({ mobile: ws.mobile, grid: ws.grid, onRestored: async (r) => { ws.reseeds.push(r); ws.board = sv.head().prefs.charts_workspace_layout } }))
  return ws
}
beforeEach(() => { _resetLayoutHistoryCache() })
afterEach(() => { restoreFetch?.(); restoreFetch = null; cleanup(); vi.restoreAllMocks() })

function host(svOpts, wsOpts) {
  const sv = server(svOpts)
  install(sv)
  const b = makeBoard([{ id: 'c', type: 'chart', x: 0, y: 0, w: 24, h: 20, color: 'N', opts: {} }], { 'N:c': 'NVDA' })
  const ws = workspace(sv, wsOpts)
  b.host.layoutHistory = ws.source
  return { h: b.host, sv, ws }
}
const restore = (args) => ({ action: 'layoutHistory.restore', target: 'boardVersions', args: { version: null, stepsBack: null, before: null, ...args } })
async function plan(h, ops, ctx = CTX) {
  buildContext(h, ctx)
  const env = await prepareOps(ops)
  return { p: planOps(collectTargets(h, ['layoutHistory']), ops, env, ctx), env }
}

describe('layoutHistory.restore — the panel\'s own restore, read back from the server, exact Undo', () => {
  it('stepsBack 1: the version before the current one; shown first (confirm, exclusive); ONE restore POST on the head it was planned on; re-seeded; Undo restores the prior head', async () => {
    const { h, sv, ws } = host()
    const { p, env } = await plan(h, [restore({ stepsBack: 1 })])
    expect(p.ok).toBe(true)
    expect(planShape(p).confirm).toBe(true)
    expect(getCapability('layoutHistory.restore').exclusive).toBe(true)
    expect(p.lines[0]).toMatch(/^Restored your board to version 3 \(Nov 13, 3:30 PM ET, board saved\) — changes Chart settings, Board layout\. Version 4 \(your board before this\) is still in Version history$/)
    const res = await commitPlan(h, p, { env })
    expect(res.ok).toBe(true)
    expect(sv.calls.restore).toEqual([{ version: 3, base_version: 4, board: 'charts' }])
    expect(sv.head()).toMatchObject({ version: 5, source: 'restore', restored_from: 3 })
    expect([ws.reseeds.length, ws.board]).toEqual([1, 'L-wed'])         // the workspace's own re-seed ran, the board shows version 3
    expect(res.undo).toBeTruthy()
    const u = await undoEntry(h, res.undo)
    expect(u.ok).toBe(true)
    expect(sv.calls.restore.at(-1)).toEqual({ version: 4, base_version: 5, board: 'charts' })
    expect(sv.head()).toMatchObject({ version: 6, source: 'restore', restored_from: 4, content_sha256: sv.versions[3].content_sha256 })
    expect(ws.board).toBe('L-now')
    expect(sv.versions).toHaveLength(6)                                 // nothing in the history was deleted
  })
  it('by number, and by a moment ("as it was on Tuesday" → the newest version saved by the end of that day ET)', async () => {
    const a = host()
    const r1 = await plan(a.h, [restore({ version: 1 })])
    expect(r1.p.lines[0]).toMatch(/version 1 \(Nov 10, 9:00 AM ET, first saved copy of your board\) — changes Chart settings, Board layout\./)
    const b = host()
    const r2 = await plan(b.h, [restore({ before: '2026-11-12' })])
    expect(r2.p.lines[0]).toMatch(/to version 2 \(Nov 12, 10:00 AM ET/)
    const r3 = await plan(b.h, [restore({ before: '2026-11-13T16:00' })])
    expect(r3.p.lines[0]).toMatch(/to version 3 /)
    const r4 = await plan(b.h, [restore({ before: '2026-11-13T15:00' })])  // before Wednesday's save → Tuesday's
    expect(r4.p.lines[0]).toMatch(/to version 2 /)
  })
  it('aliases the model may use (`at`, `back`, `v`) plan the same restore', async () => {
    const { h } = host()
    const a = await plan(h, [{ action: 'layoutHistory.restore', target: 'boardVersions', args: { back: 1 } }])
    expect(a.p.ok).toBe(true)
    expect(a.p.lines[0]).toMatch(/to version 3 /)
    const b = await plan(h, [{ action: 'layoutHistory.restore', target: 'boardVersions', args: { at: '2026-11-12' } }])
    expect(b.p.lines[0]).toMatch(/to version 2 /)
    const c = await plan(h, [{ action: 'layoutHistory.restore', target: 'boardVersions', args: { v: 1 } }])
    expect(c.p.lines[0]).toMatch(/to version 1 /)
  })
  it('a key the version does not hold is named as kept (the route never deletes a key)', async () => {
    const { h } = host({ versions: [
      { version: 1, created_at: ET('2026-11-12T15:00:00Z'), source: 'mirror', prefs: { charts_workspace_layout: 'L1' } },
      { version: 2, created_at: ET('2026-11-13T15:00:00Z'), source: 'mirror', prefs: { charts_workspace_layout: 'L2', watchlist_columns: 'cols' } },
    ] })
    const { p } = await plan(h, [restore({ stepsBack: 1 })])
    expect(p.lines[0]).toMatch(/changes Board layout; kept as they are now: Watchlist columns\./)
  })
})

describe('negatives and ambiguity: asked, never guessed; nothing written', () => {
  it('no version named → asks with the latest five; two ways at once → asks', async () => {
    const { h, sv } = host()
    const none = await plan(h, [restore({})])
    expect(none.p.ok).toBe(false)
    expect(none.p.refusals[0].reason).toMatch(/^Which version should I restore\? The latest: version 4 \(.*\) — current; version 3 /)
    const two = await plan(h, [restore({ version: 2, stepsBack: 1 })])
    expect(two.p.refusals[0].reason).toMatch(/Name the version one way/)
    expect(sv.calls.restore).toEqual([])
  })
  it('the current version, a missing number, too far back, before the oldest, a future moment, an unreadable date', async () => {
    const { h, sv } = host()
    const why = async (args) => (await plan(h, [restore(args)])).p.refusals[0]?.reason
    expect(await why({ version: 4 })).toMatch(/Version 4 is your current board, so there is nothing to restore/)
    expect(await why({ version: 99 })).toMatch(/There is no version 99/)
    expect(await why({ stepsBack: 9 })).toMatch(/doesn't go back 9 saves — it has 3 earlier versions/)
    expect(await why({ before: '2026-11-01' })).toMatch(/doesn't go back that far — the oldest version kept here is version 1/)
    expect(await why({ before: '2027-01-01' })).toMatch(/hasn't happened yet/)
    expect(await why({ before: 'last tuesday' })).toMatch(/couldn't read the date “last tuesday”/)
    expect(sv.calls.restore).toEqual([])
  })
  it('a version that already matches the board: "already matches", no proposal, no write', async () => {
    const { h, sv } = host({ versions: [
      { version: 1, created_at: ET('2026-11-12T15:00:00Z'), source: 'mirror', prefs: P('same') },
      { version: 2, created_at: ET('2026-11-13T15:00:00Z'), source: 'mirror', prefs: P('same') },
    ] })
    const { p } = await plan(h, [restore({ stepsBack: 1 })])
    expect(p.refusals[0].reason).toMatch(/^Version 1 \(.*\) already matches your current board, so there is nothing to restore\./)
    expect(sv.calls.restore).toEqual([])
  })
  it('a tombstone is never a target; a cleared head refuses', async () => {
    const { h } = host({ versions: [
      { version: 1, created_at: ET('2026-11-12T15:00:00Z'), source: 'mirror', prefs: P('a') },
      { version: 2, created_at: ET('2026-11-12T16:00:00Z'), source: 'delete', tombstone: true, prefs: null },
      { version: 3, created_at: ET('2026-11-13T15:00:00Z'), source: 'mirror', prefs: P('b') },
    ] })
    expect((await plan(h, [restore({ version: 2 })])).p.refusals[0].reason).toMatch(/where the history was cleared/)
    expect((await plan(h, [restore({ stepsBack: 1 })])).p.lines[0]).toMatch(/to version 1 /)       // the tombstone is skipped
  })
  it('dark store (404): "not turned on", no restore; phone / Multi Chart: not available, NOTHING requested', async () => {
    const d = host({ dark: true })
    expect((await plan(d.h, [restore({ stepsBack: 1 })])).p.refusals[0].reason).toBe(HISTORY_DARK)
    expect(d.sv.calls.restore).toEqual([])
    for (const where of [{ mobile: true }, { grid: true }]) {
      _resetLayoutHistoryCache()
      const m = host({}, where)
      const r = await plan(m.h, [restore({ stepsBack: 1 })])
      expect(r.p.refusals[0].reason).toBe(HISTORY_NOT_HERE)
      expect([m.sv.calls.list, m.sv.calls.read.length, m.sv.calls.restore.length]).toEqual([0, 0, 0])
    }
  })
  it('a host with no Version history (another page): no target, the kind\'s own sentence', async () => {
    const b = makeBoard([{ id: 'c', type: 'chart', x: 0, y: 0, w: 24, h: 20, color: 'N', opts: {} }], { 'N:c': 'NVDA' })
    const r = await plan(b.host, [restore({ stepsBack: 1 })])
    expect(r.p.ok).toBe(false)
    expect(r.p.refusals[0].reason).toBe('That target is not on the workspace.')     // and no context entry offers it
  })
})

describe('compare-and-set: a board saved again is never restored over; read-back decides the receipt', () => {
  it('saved after planning (head moved): the write refuses before POSTing — nothing restored, no Undo', async () => {
    const { h, sv, ws } = host()
    const { p, env } = await plan(h, [restore({ stepsBack: 1 })])
    sv.save(P('L-newer', 's3'))
    const res = await commitPlan(h, p, { env })
    expect(res.ok).toBe(false)
    expect(sv.calls.restore).toEqual([])
    expect(res.undo ?? null).toBe(null)
    expect([ws.reseeds.length, sv.head().version]).toEqual([0, 5])
  })
  it('the server answers 409 (moved between the re-read and the POST): refused, never retried, no re-seed', async () => {
    const { h, sv, ws } = host({ hookRestore: () => ({ ok: false, status: 409, json: async () => ({}) }) })
    const { p, env } = await plan(h, [restore({ stepsBack: 1 })])
    const res = await commitPlan(h, p, { env })
    expect(res.ok).toBe(false)
    expect(sv.calls.restore).toHaveLength(1)
    expect(ws.reseeds).toEqual([])
  })
  it('a 200 whose new head is NOT that version (a server that appended something else): not a receipt, no Undo', async () => {
    const { h, sv } = host({ hookRestore: (body, s) => { s.save(P('surprise')); return { ok: true, status: 200, json: async () => ({ appended: true, restored_from: body.version, prefs_failed: [] }) } } })
    const { p, env } = await plan(h, [restore({ stepsBack: 1 })])
    const res = await commitPlan(h, p, { env })
    expect(res.ok).toBe(false)
    expect(res.undo ?? null).toBe(null)
    expect(sv.head().source).toBe('mirror')
  })
  it('restored except a key the server could not write back: said by name, not a clean receipt', async () => {
    const { h } = host({ prefsFailed: ['chart_settings'] })
    const { p, env } = await plan(h, [restore({ stepsBack: 1 })])
    const res = await commitPlan(h, p, { env })
    expect(res.ok).toBe(false)
    expect(JSON.stringify(res)).toMatch(/restored except Chart settings, which kept the current value/)
  })
  it('Undo after the board was saved again: refused, the newer board is kept', async () => {
    const { h, sv } = host()
    const { p, env } = await plan(h, [restore({ stepsBack: 2 })])
    const res = await commitPlan(h, p, { env })
    expect(res.ok).toBe(true)
    sv.save(P('L-after', 's9'))
    await plan(h, [restore({ stepsBack: 1 })])                          // any later read sees the new head
    const u = await undoEntry(h, res.undo)
    expect(u.ok).toBe(false)
    expect(u.reason).toMatch(/has changed since I made that change/)
    expect(sv.head().prefs.charts_workspace_layout).toBe('L-after')
    expect(sv.calls.restore).toHaveLength(1)
  })
  it('Undo whose CAS loses the race (saved between the check and the POST): refused with the reason, nothing overwritten', async () => {
    const { h, sv } = host()
    const { p, env } = await plan(h, [restore({ stepsBack: 1 })])
    const res = await commitPlan(h, p, { env })
    sv.save(P('L-race'))                                                 // the cache still shows the restore head
    const u = await undoEntry(h, res.undo)
    expect(u.ok).toBe(false)
    expect(u.reason).toMatch(/saved again after I read its history/)
    expect(sv.head().prefs.charts_workspace_layout).toBe('L-race')
  })
  it('the approval binding carries the head it was planned on: a save before "do it" is a different binding', async () => {
    const { h, sv } = host()
    const a = await plan(h, [restore({ stepsBack: 1 })])
    const b1 = approvalBinding(a.p, h)
    sv.save(P('L-x'))
    const b = await plan(h, [restore({ stepsBack: 1 })])
    expect(approvalBinding(b.p, h).change).not.toBe(b1.change)
  })
})

describe('layoutHistory.list — answered from the server', () => {
  it('newest first, the current one marked, how each came to be; count; dark / phone', async () => {
    const { h, sv } = host()
    sv.versions.push({ version: 5, created_at: ET('2026-11-14T15:00:00Z'), source: 'restore', restored_from: 2, tombstone: false, prefs: P('L-tue', 's2'), content_sha256: 'x' })
    buildContext(h, CTX)
    const cap = getCapability('layoutHistory.list')
    const snap = collectTargets(h, ['layoutHistory']).get('boardVersions').snap
    const out = await cap.answer(snap, { count: 3 }, h)
    expect(out.split('\n').slice(0, 3)).toEqual([
      'Version 5 — Nov 14, 10:00 AM ET · Restored from version 2 (current)',
      'Version 4 — Nov 14, 9:45 AM ET · Board saved',
      'Version 3 — Nov 13, 3:30 PM ET · Board saved',
    ])
    expect(out).toMatch(/…and 2 older versions\./)
    expect(out).toMatch(/the one you have now is still in Version history/)
    expect(sv.calls.restore).toEqual([])
    const d = host({ dark: true })
    expect(await cap.answer(collectTargets(d.h, ['layoutHistory']).get('boardVersions').snap, { count: null }, d.h)).toBe(HISTORY_DARK)
    const m = host({}, { mobile: true })
    expect(await cap.answer(collectTargets(m.h, ['layoutHistory']).get('boardVersions').snap, { count: null }, m.h)).toBe(HISTORY_NOT_HERE)
  })
})

describe('source: ONE implementation — the panel\'s routes and the workspace\'s re-seed', () => {
  it('versionHistoryAgentSource calls onRestored only on a 200; never where the board has no Version history', async () => {
    const sv = server({ hookRestore: (b) => (b.version === 2 ? { ok: false, status: 409, json: async () => ({}) } : null) })
    install(sv)
    const seen = []
    const src = versionHistoryAgentSource(() => ({ mobile: false, grid: false, onRestored: async (r) => { seen.push(r.restored_from) } }))
    expect((await src.restore(3, 4)).status).toBe(200)
    expect((await src.restore(2, 5)).status).toBe(409)
    expect(seen).toEqual([3])
    const phone = versionHistoryAgentSource(() => ({ mobile: true, grid: false, onRestored: () => seen.push('x') }))
    expect(phone.read().here).toBe(false)
    expect((await phone.restore(1, 5)).ok).toBe(false)
    expect((await phone.list(5)).ok).toBe(false)
    expect(sv.calls.restore).toHaveLength(2)
  })
  it('ChartsWorkspace hands the Agent the panel\'s own re-seed (handleVersionRestored), desktop board only', () => {
    const src = readFileSync(resolve(__dirname, '../pages/charts/ChartsWorkspace.jsx'), 'utf8')
    expect(src).toMatch(/agentVersionHistoryRef\.current = \{ mobile: isMobile, grid: gridMode, onRestored: handleVersionRestored \}/)
    expect(src).toMatch(/layoutHistory: versionHistoryAgentSource\(\(\) => agentVersionHistoryRef\.current\)/)
    const panel = readFileSync(resolve(__dirname, '../pages/charts/VersionHistory.jsx'), 'utf8')
    expect(panel).toMatch(/await restoreWorkspaceVersion\(selected, headVersion\)/)       // the panel and the Agent: one restore request
    expect(panel).not.toMatch(/\/restore`/)
  })
  it('the REAL Version history panel shows the Agent\'s restore as the current version — the same server state', async () => {
    const { h, sv } = host()
    const { p, env } = await plan(h, [restore({ stepsBack: 2 })])
    await commitPlan(h, p, { env })
    render(<VersionHistoryPanel onClose={() => {}} onRestored={() => {}} />)
    await waitFor(() => expect(screen.getByText('Version 5')).toBeTruthy())
    const row = screen.getByText('Version 5').closest('li')
    expect(row.textContent).toMatch(/Current/)
    expect(row.textContent).toMatch(/Restored from version 2/)
    expect(sv.head().restored_from).toBe(2)
  })
  it('a restore made in the REAL panel after the Agent planned: the Agent\'s write is refused (stale head), never stacked', async () => {
    const { h, sv } = host()
    const { p, env } = await plan(h, [restore({ stepsBack: 1 })])
    const onRestored = vi.fn()
    render(<VersionHistoryPanel onClose={() => {}} onRestored={onRestored} />)
    await waitFor(() => expect(screen.getByText('Version 1')).toBeTruthy())
    await act(async () => { fireEvent.click(screen.getByText('Version 1').closest('button')) })
    await waitFor(() => expect(screen.getByRole('button', { name: /Restore version 1/ })).toBeTruthy())
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Restore version 1/ })) })
    await waitFor(() => expect(onRestored).toHaveBeenCalled())
    const res = await commitPlan(h, p, { env })
    expect(res.ok).toBe(false)
    expect(sv.calls.restore.map(b => b.version)).toEqual([1])
    expect(sv.head().restored_from).toBe(1)
  })
})

describe('through the REAL AgentPanel: a card first, Apply restores, "undo" puts the prior version back', () => {
  let p
  beforeEach(() => { p = setupPanel() })
  const mountWith = (svOpts, wsOpts) => {
    const m = p.mount(...ONE('NVDA'))
    const sv = server(svOpts)
    install(sv)
    const ws = workspace(sv, wsOpts)
    m.h.layoutHistory = ws.source
    return { ...m, sv, ws }
  }
  it('the proposal names the version and what it changes; nothing written until Apply; Undo restores the head it replaced', async () => {
    const { say, click, sv, ws } = mountWith()
    p.st.envelopes.push(p.env('apply', [restore({ stepsBack: 1 })]))
    await say('restore my board to the previous version')
    await waitFor(() => expect(p.proposals()).toHaveLength(1))
    expect(p.proposals()[0].textContent).toMatch(/^Proposed changesRestore your board to version 3 \(.*\) — changes Chart settings, Board layout\./)
    expect(sv.calls.restore).toEqual([])
    await waitFor(() => expect(screen.getByRole('button', { name: 'Apply' }).disabled).toBe(false))
    await click('Apply')
    await waitFor(() => expect(sv.head().source).toBe('restore'))
    expect([sv.head().restored_from, ws.board]).toEqual([3, 'L-wed'])
    await say('undo')
    await waitFor(() => expect(sv.head().restored_from).toBe(4))
    expect(ws.board).toBe('L-now')
  }, 40000)
  it('"what versions of my board are there?" is answered from the server', async () => {
    const { say } = mountWith()
    p.st.envelopes.push(p.env('apply', [{ action: 'layoutHistory.list', target: 'boardVersions', args: { count: null } }]))
    const out = await say('what versions of my board are there?')
    expect(out).toMatch(/Version 4 — Nov 14, 9:45 AM ET · Board saved \(current\)/)
  }, 40000)
})

describe('routing: its own words-only group; other families\' history never selects it', () => {
  const wordsSelect = (id, msg) => {
    const g = GROUPS.find(x => x.id === id)
    return g.words.some(w => w.test(msg.toLowerCase()))
  }
  it.each([
    'open my version history', 'restore my board to the previous version', 'roll back my layout to yesterday',
    'put my workspace back the way it was this morning', 'go back to version 12', 'what versions of my board are there',
    'show me the layout history', 'revert the board to how it looked 2 hours ago', 'restore an earlier version of my layout',
  ])('"%s" selects layoutHistory', (msg) => expect(wordsSelect('layoutHistory', msg)).toBe(true))
  it.each([
    'go back to my previous layout', 'open my main trading layout', 'restore an older version of my rsi indicator',
    'show the history of my watchlist', 'undo that', 'restore the deleted drawing', 'show my alert history',
    'reset the chart to default', 'save my layout', 'what changed on the chart yesterday',
  ])('"%s" does not', (msg) => expect(wordsSelect('layoutHistory', msg)).toBe(false))
  it('is words-only and fill-last, its own group with only its own domain', () => {
    const g = GROUPS.find(x => x.id === 'layoutHistory')
    expect([g.wordsOnly, g.fillLast, g.domains]).toEqual([true, true, ['layoutHistory']])
    expect(GROUPS.filter(x => (x.domains || []).includes('layoutHistory')).map(x => x.id)).toEqual(['layoutHistory'])
    expect(typeof selectGroups).toBe('function')
  })
})

describe('beforeMoment: New York wall clock', () => {
  it('a date is the end of that day ET; a time is that minute ET (EST and EDT)', () => {
    expect(beforeMoment('2026-11-13')).toBe(ET('2026-11-14T04:59:59Z'))
    expect(beforeMoment('2026-11-13T09:30')).toBe(ET('2026-11-13T14:30:59Z'))
    expect(beforeMoment('2026-07-01T09:30')).toBe(ET('2026-07-01T13:30:59Z'))
    expect(beforeMoment('yesterday')).toBe(null)
    expect(beforeMoment('2026-13-01')).toBe(null)
  })
})

// AUDIT #1248 wording condition: retention may prune an old version (30 days AND outside the newest 200), so no receipt,
// Undo note, refusal, summary or discovery line may promise a version stays restorable indefinitely
describe('wording: nothing promises a version stays restorable forever', () => {
  const PROMISE = /\b(?:always|forever|permanent(?:ly)?|any ?time|indefinitely|never (?:be )?(?:lost|deleted|removed|pruned)|nothing (?:is |was |gets )?(?:ever )?deleted|for good|guaranteed?)\b/i
  it('the source strings of layoutHistory.js (comments stripped), its manifest entries and the discovery line', () => {
    const src = readFileSync(resolve(__dirname, 'capabilities/layoutHistory.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/^\s*\/\/.*$/, '').replace(/\s\/\/ .*$/, '')).join('\n')
    const literals = [...src.matchAll(/'(?:[^'\\n]|\.)*'|`(?:[^`\]|\.)*`/g)].map(m => m[0])
    expect(literals.length).toBeGreaterThan(20)
    for (const s of literals) expect(s, s).not.toMatch(PROMISE)
    for (const n of ['layoutHistory.list', 'layoutHistory.restore']) {
      const c = getCapability(n)
      for (const s of [c.summary, c.hints, c.undoNote, c.exclusiveReason].filter(Boolean)) expect(s, n).not.toMatch(PROMISE)
    }
    const disc = readFileSync(resolve(__dirname, 'discovery.js'), 'utf8').split('\n').find(l => l.includes("'layoutHistory.restore'") || l.includes('Version history'))
    expect(disc).toBeTruthy()
    expect(disc).not.toMatch(PROMISE)
  })
  it('every sentence a run produces: proposal / receipt, list answer, Undo and refusals', async () => {
    const out = []
    const { h, sv } = host()
    const ok = await plan(h, [restore({ stepsBack: 1 })])
    out.push(...ok.p.lines)
    const res = await commitPlan(h, ok.p, { env: ok.env })
    out.push(...(res.lines || []))
    const u = await undoEntry(h, res.undo)
    out.push(...(u.lines || []), u.reason || '')
    for (const args of [{}, { version: 99 }, { stepsBack: 50 }, { before: '2026-01-01' }, { version: max(sv) }]) out.push(...(await plan(h, [restore(args)])).p.refusals.map(r => r.reason))
    const snap = collectTargets(h, ['layoutHistory']).get('boardVersions').snap
    out.push(await getCapability('layoutHistory.list').answer(snap, { count: null }, h))
    out.push(HISTORY_DARK, HISTORY_NOT_HERE)
    expect(out.filter(Boolean).length).toBeGreaterThan(8)
    for (const s of out.filter(Boolean)) expect(s, s).not.toMatch(PROMISE)
    expect(out.join('\n')).toMatch(/is still in Version history/)          // the accepted wording is what it says instead
  })
  const max = (sv) => sv.head().version
  it('CONTROL: the check sees a promise', () => {
    for (const s of ['You can always restore it.', 'kept forever', 'nothing is deleted', 'restore it any time', 'it is permanently saved']) expect(s).toMatch(PROMISE)
    expect('The earlier version is still in Version history.').not.toMatch(PROMISE)
  })
})

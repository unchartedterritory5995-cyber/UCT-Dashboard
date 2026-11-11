// W1-B (Wave 1, BOARD B-06) — chart.replay: Tools → Replay Mode through ChartsWorkspace's own handlers (startReplay /
// exitReplayMode) reached as host.charts.setReplay; the ONE shared cutoff every linked chart reads (StockChart's
// `replayCutoff` prop). A view only — nothing is saved; Undo clears it (or restores the previous cutoff); a host with no
// replay source refuses.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { buildContext, getCapability } from './capabilities'
import { planOps, collectTargets, prepareOps } from './executor'
import { commitPlan, undoEntry } from './runtime'
import { makeBoard } from './__fixtures__/board'
import { buildChartSource } from './host'
import { setupPanel, ONE } from './testing/panelHarness'
import { mergeChartSettings } from '../components/chart/chartDefaults'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()
const CTX = { surface: 'charts' }

/** The workspace's replay state as ChartsWorkspace holds it: a cutoff, startReplay(iso, tf), exitReplayMode(). */
function replayState() {
  const st = { cutoff: null, calls: [] }
  st.source = { read: () => st.cutoff, set: (iso) => { st.calls.push(iso); st.cutoff = iso } }
  return st
}
/** A host over the REAL buildChartSource (one chart) with a replay source — or none. */
function host({ replay = null } = {}) {
  const apis = new Map([['c', { agent: { read: () => ({ chartId: 'c', tabId: null, groupKey: 'N', symbol: 'NVDA', tf: 'D', cs: mergeChartSettings({}), stored: null }), view: () => null, drawSym: () => 'NVDA' } }]])
  const b = makeBoard([{ id: 'c', type: 'chart', x: 0, y: 0, w: 24, h: 20, color: 'N', opts: {} }], { 'N:c': 'NVDA' })
  b.host.charts = buildChartSource({ chartApiById: { current: apis }, getWidgets: () => b.state.widgets, replay })
  return b.host
}
const op = (date) => ({ action: 'chart.replay', target: 'c', args: { date } })
async function plan(h, ops) {
  buildContext(h, CTX)
  const env = await prepareOps(ops)
  return { p: planOps(collectTargets(h, ['chart']), ops, env, CTX), env }
}

describe('chart.replay — the Replay dialog\'s own write, view only, exact Undo', () => {
  it('a date: startReplay(iso) with no timeframe change; read back from the shared cutoff; Undo exits replay (startReplay never re-run)', async () => {
    const r = replayState()
    const h = host({ replay: r.source })
    expect(h.charts.read('c').replay).toBe(null)                               // the snapshot carries the shared cutoff
    const { p, env } = await plan(h, [op('2026-10-15')])
    expect(p.ok).toBe(true)
    expect(p.lines).toEqual(['Replay Mode: every chart in this workspace shows bars up to Thu, Oct 15 and hides what came after (a view only — nothing is saved; exit replay to see every bar again)'])
    const res = await commitPlan(h, p, { env })
    expect(res.ok).toBe(true)
    expect(r.calls).toEqual(['2026-10-15'])
    expect(h.charts.read('c').replay).toBe('2026-10-15')
    expect((await undoEntry(h, res.undo)).ok).toBe(true)
    expect(r.calls).toEqual(['2026-10-15', null])                             // Undo = exit replay
    expect(r.cutoff).toBe(null)
  })
  it('a date word; a second date replaces the first and Undo restores the FIRST; exit (null) clears; no-ops are said', async () => {
    const r = replayState()
    const h = host({ replay: r.source })
    const a = await plan(h, [op('oct 15')])
    await commitPlan(h, a.p, { env: a.env })
    expect(r.cutoff).toBe(`${new Date().getUTCFullYear()}-10-15`)
    const b = await plan(h, [op('2026-10-01')])
    const res = await commitPlan(h, b.p, { env: b.env })
    expect(r.cutoff).toBe('2026-10-01')
    expect((await undoEntry(h, res.undo)).ok).toBe(true)
    expect(r.cutoff).toBe(`${new Date().getUTCFullYear()}-10-15`)
    const c = await plan(h, [op(null)])
    expect(c.p.lines).toEqual(['Exited Replay Mode — every bar is back on every chart'])
    await commitPlan(h, c.p, { env: c.env })
    expect(r.cutoff).toBe(null)
    const d = await plan(h, [op(null)])
    expect(d.p.noops ?? d.p.plans?.[0]?.noops ?? []).toBeTruthy()
    expect(d.p.lines).toEqual([])
  })
  it('⛔ Undo refuses once the member changed the cutoff themselves (the Replay dialog) — never overwrites their replay', async () => {
    const r = replayState()
    const h = host({ replay: r.source })
    const { p, env } = await plan(h, [op('2026-10-15')])
    const res = await commitPlan(h, p, { env })
    r.cutoff = '2026-09-01'                                                     // the dialog's own pick, after the Agent's
    const u = await undoEntry(h, res.undo)
    expect(u.ok).toBe(false)
    expect(u.reason).toMatch(/has changed since I made that change/)
    expect(r.cutoff).toBe('2026-09-01')
  })
  it('refused (nothing written): no replay source on this host, an unreadable date, a future date', async () => {
    const none = host()
    expect(none.charts.read('c').replay).toBe(undefined)
    expect((await plan(none, [op('2026-10-15')])).p.refusals[0].reason).toMatch(/Replay Mode isn't reachable from here/)
    const r = replayState()
    const h = host({ replay: r.source })
    expect((await plan(h, [op('the earnings day')])).p.refusals[0].reason).toMatch(/couldn't read “the earnings day” as a date/)
    expect((await plan(h, [op('2999-01-01')])).p.refusals[0].reason).toMatch(/hasn't happened yet — replay only goes back/)
    expect(r.calls).toEqual([])
    const c = getCapability('chart.replay')
    expect([c.target, c.risk, c.undo]).toEqual(['chart', 'local', 'exact'])
  })
})

describe('through the REAL panel (panelHarness)', () => {
  let p
  beforeEach(() => { p = setupPanel() })
  afterEach(() => { cleanup() })
  it('"replay from Oct 15" (scripted) → applied (a view, local), receipt; "undo" exits replay', async () => {
    const r = replayState()
    const { say, h } = p.mount(...ONE('NVDA'))
    const base = h.charts
    h.charts = { ...base, list: () => base.list().map(s => ({ ...s, replay: r.cutoff })), read: (ref) => { const s = base.read(ref); return s ? { ...s, replay: r.cutoff } : null }, setReplay: (iso) => { r.source.set(iso); return true } }
    p.st.envelopes.push(p.env('apply', [{ action: 'chart.replay', target: 'c', args: { date: '2026-10-15' } }]))
    const out = await say('replay from Oct 15')
    expect(out).toMatch(/Replay Mode: every chart in this workspace shows bars up to Thu, Oct 15/)
    expect(r.cutoff).toBe('2026-10-15')
    expect(screen.queryAllByTestId('agent-proposal').length).toBe(0)
    await say('undo')
    expect(r.cutoff).toBe(null)
    expect(r.calls).toEqual(['2026-10-15', null])
    expect(p.turns()).toBe(1)
  }, 40000)
})

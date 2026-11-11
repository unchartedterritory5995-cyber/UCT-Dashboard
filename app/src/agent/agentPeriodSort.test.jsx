// C3-205 / C3-206 / C3-207 (pl-exec6) — Tools → Custom-Period Sort through ChartsWorkspace's OWN writers:
//   periodSort.run  = runPeriodSort, the config popover's Sort (panel, Replay cutoff set or CLEARED, start marker)
//   periodSort.dock = handleDockPeriodSort, the open panel's Dock (a Period Sort widget on the board)
// The fake source below holds the workspace's state exactly as ChartsWorkspace does (YYYYMMDD panel dates, ISO cutoff /
// marker) and applies the same rules; the source checks at the end pin that the popover and the Agent share ONE writer.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, screen } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { buildContext, getCapability } from './capabilities'
import { planOps, collectTargets, prepareOps } from './executor'
import { commitPlan, undoEntry } from './runtime'
import { makeBoard } from './__fixtures__/board'
import { setupPanel, ONE } from './testing/panelHarness'
import { selectGroups } from './routing'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()
const CTX = { surface: 'charts' }
const iso = (ymd) => { const s = String(ymd); return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` }

/** ChartsWorkspace's Custom-Period Sort state and its own writers, over a board's widgets. */
export function periodSortSource(state, { split = null, ignoreRun = false, unreadable = false } = {}) {
  const ps = { panel: null, cutoff: null, marker: null, markerStyle: 'line', runs: [], docks: 0, restores: 0 }
  let n = 0
  ps.source = {
    read: () => (unreadable || ps.unreadable ? null : { panel: ps.panel, cutoff: ps.cutoff, marker: ps.marker, markerStyle: ps.markerStyle }),
    run: (a) => {
      ps.runs.push(a)
      if (ignoreRun) return true                                              // a write that never lands
      ps.panel = { start: a.start, end: a.end, group: a.group || null }
      ps.cutoff = a.replay ? iso(a.end) : null
      ps.marker = a.markStart && a.markStart !== 'off' ? iso(a.start) : null
      if (a.markStart === 'line' || a.markStart === 'candle') ps.markerStyle = a.markStart
      return true
    },
    restore: (was) => { ps.restores += 1; ps.panel = was.panel ? { ...was.panel } : null; ps.cutoff = was.cutoff ?? null; ps.marker = was.marker ?? null; if (was.markerStyle) ps.markerStyle = was.markerStyle; return true },
    dock: () => {
      if (!ps.panel) return null
      ps.docks += 1
      const id = `w-periodsort-${++n}`
      // handleDockPeriodSort: a full grid splits a widget to make room (`split` = that widget's new size)
      if (split) state.widgets = state.widgets.map(w => (w.id === split.id ? { ...w, ...split.rect } : w))
      state.widgets = [...state.widgets, { id, type: 'periodsort', color: 'A', x: 0, y: 20, w: 8, h: 10, opts: { start: ps.panel.start, end: ps.panel.end, group: ps.panel.group || null } }]
      ps.panel = null
      return id
    },
    undock: ({ remove, set, panel }) => {
      state.widgets = state.widgets.filter(w => w.id !== remove).map(w => (set?.[w.id] ? { ...w, ...set[w.id] } : w))
      ps.panel = panel ? { ...panel } : null
      return true
    },
    widgets: () => state.widgets,
  }
  return ps
}
function host(widgets, opts) {
  const b = makeBoard(widgets || [{ id: 'c', type: 'chart', x: 0, y: 0, w: 24, h: 20, color: 'N', opts: {} }], { 'N:c': 'NVDA' })
  const ps = periodSortSource(b.state, opts)
  b.host.periodSort = ps.source
  return { h: b.host, ps, state: b.state }
}
const run = (args) => ({ action: 'periodSort.run', target: 'periodSort', args: { end: null, group: 'stocks', replay: false, markStart: 'off', ...args } })
const dock = () => ({ action: 'periodSort.dock', target: 'periodSort', args: {} })
async function plan(h, ops) {
  buildContext(h, CTX)
  const env = await prepareOps(ops)
  return { p: planOps(collectTargets(h, ['periodSort']), ops, env, CTX), env }
}

describe('periodSort.run — the popover\'s own Sort', () => {
  it('stocks from a start to an end: the panel opens on exactly that range; read back; Undo closes it (exact)', async () => {
    const { h, ps } = host()
    const { p, env } = await plan(h, [run({ start: '2026-10-01', end: '2026-10-30' })])
    expect(p.ok).toBe(true)
    expect(p.lines[0]).toMatch(/^Custom-Period Sort: US common stocks ranked by % change from .*Oct 1 to .*Oct 30/)
    const res = await commitPlan(h, p, { env })
    expect(res.ok).toBe(true)
    expect(ps.runs).toEqual([{ start: 20261001, end: 20261030, group: null, replay: false, markStart: 'off' }])
    expect(ps.panel).toEqual({ start: 20261001, end: 20261030, group: null })
    expect((await undoEntry(h, res.undo)).ok).toBe(true)
    expect(ps.panel).toBe(null)
  })
  it('C3-206: grouping, Replay mode and Mark start are the popover\'s; end null = today; Undo puts the old replay + marker back', async () => {
    const { h, ps } = host()
    ps.cutoff = '2026-09-15'; ps.marker = '2026-09-01'; ps.markerStyle = 'candle'          // an earlier sort's replay and marker
    const { p, env } = await plan(h, [run({ start: '2026-10-01', group: 'sector', replay: true, markStart: 'line' })])
    expect(p.ok).toBe(true)
    const res = await commitPlan(h, p, { env })
    expect(ps.panel.group).toBe('sector')
    expect(ps.panel.start).toBe(20261001)
    expect(ps.cutoff).toBe(iso(ps.panel.end))                                    // replay at the END date
    expect(ps.marker).toBe('2026-10-01')
    expect(ps.markerStyle).toBe('line')
    expect(p.lines[0]).toMatch(/sectors ranked/)
    expect(p.lines[0]).toMatch(/Replay Mode hides every bar after/)
    await undoEntry(h, res.undo)
    expect([ps.panel, ps.cutoff, ps.marker, ps.markerStyle]).toEqual([null, '2026-09-15', '2026-09-01', 'candle'])
  })
  it('as the popover: a sort WITHOUT Replay mode turns an active replay off — and the receipt says so', async () => {
    const { h, ps } = host()
    ps.cutoff = '2026-09-15'
    const { p, env } = await plan(h, [run({ start: '2026-10-01', end: '2026-10-20' })])
    expect(p.lines[0]).toMatch(/Replay Mode is off \(the sort turns it off unless asked\)/)
    await commitPlan(h, p, { env })
    expect(ps.cutoff).toBe(null)
  })
  it('⛔ refused, nothing written: unreadable date, future date, end not after start, state unreadable', async () => {
    const { h, ps } = host()
    expect((await plan(h, [run({ start: 'the earnings day' })])).p.refusals[0].reason).toMatch(/couldn't read “the earnings day” as the start date/)
    expect((await plan(h, [run({ start: '2999-01-01' })])).p.refusals[0].reason).toMatch(/hasn't happened yet/)
    expect((await plan(h, [run({ start: '2026-10-20', end: '2026-10-01' })])).p.refusals[0].reason).toMatch(/end date must be after the start date/)
    expect(ps.runs).toEqual([])
    const u = host(null, { unreadable: true })
    const r = await plan(u.h, [run({ start: '2026-10-01' })])
    expect(r.p.ok).toBe(false)
    expect(r.p.refusals[0].reason).toMatch(/can't read the Custom-Period Sort right now/)     // unavailable, never "no panel open"
    const d = await plan(u.h, [dock()])
    expect(d.p.refusals[0].reason).toMatch(/can't read the Custom-Period Sort right now/)
    expect(u.ps.runs).toEqual([])
    expect(u.ps.docks).toBe(0)
  })
  it('⛔ no false success: a run that never lands is not claimed', async () => {
    const { h, ps } = host(null, { ignoreRun: true })
    const { p, env } = await plan(h, [run({ start: '2026-10-01', end: '2026-10-30' })])
    const res = await commitPlan(h, p, { env })
    expect(res.ok).toBe(false)
    expect(ps.panel).toBe(null)
  }, 15000)
  it('⛔ Undo refuses once the member ran another sort themselves — their panel is never closed', async () => {
    const { h, ps } = host()
    const { p, env } = await plan(h, [run({ start: '2026-10-01', end: '2026-10-30' })])
    const res = await commitPlan(h, p, { env })
    ps.panel = { start: 20260101, end: 20260301, group: 'theme' }               // the popover's own Sort, after the Agent's
    const u = await undoEntry(h, res.undo)
    expect(u.ok).toBe(false)
    expect(ps.panel).toEqual({ start: 20260101, end: 20260301, group: 'theme' })
    expect(ps.restores).toBe(0)
  })
})

describe('periodSort.dock — the panel\'s own Dock', () => {
  it('docks the open panel as a Period Sort widget carrying its range; Undo removes exactly it and brings the panel back', async () => {
    const { h, ps, state } = host()
    ps.panel = { start: 20261001, end: 20261030, group: 'theme' }
    const { p, env } = await plan(h, [dock()])
    expect(p.ok).toBe(true)
    expect(p.lines[0]).toMatch(/^Docked the Custom-Period Sort .* themes\) onto the board as a Period Sort widget/)
    const res = await commitPlan(h, p, { env })
    expect(res.ok).toBe(true)
    const w = state.widgets.find(x => x.type === 'periodsort')
    expect(w.opts).toEqual({ start: 20261001, end: 20261030, group: 'theme' })
    expect(ps.panel).toBe(null)
    expect((await undoEntry(h, res.undo)).ok).toBe(true)
    expect(state.widgets.some(x => x.type === 'periodsort')).toBe(false)
    expect(ps.panel).toEqual({ start: 20261001, end: 20261030, group: 'theme' })
  })
  it('exact Undo: a widget the dock\'s split resized gets its size back', async () => {
    const { h, ps, state } = host(null, { split: { id: 'c', rect: { w: 16 } } })
    ps.panel = { start: 20261001, end: 20261030, group: null }
    const { p, env } = await plan(h, [dock()])
    const res = await commitPlan(h, p, { env })
    expect(state.widgets.find(w => w.id === 'c').w).toBe(16)
    await undoEntry(h, res.undo)
    expect(state.widgets.find(w => w.id === 'c')).toMatchObject({ x: 0, y: 0, w: 24, h: 20 })
  })
  it('⛔ refused with no panel open — nothing on the board changes', async () => {
    const { h, ps, state } = host()
    const before = JSON.stringify(state.widgets)
    const { p } = await plan(h, [dock()])
    expect(p.ok).toBe(false)
    expect(p.refusals[0].reason).toMatch(/no Custom-Period Sort panel open to dock/)
    expect(ps.docks).toBe(0)
    expect(JSON.stringify(state.widgets)).toBe(before)
  })
  it('⛔ wrong-target control: a Period Sort WIDGET already on the board is never touched by run, dock or Undo', async () => {
    const existing = { id: 'ps0', type: 'periodsort', color: 'A', x: 0, y: 20, w: 8, h: 10, opts: { start: 20250101, end: 20250601, group: 'industry' } }
    const { h, ps, state } = host([{ id: 'c', type: 'chart', x: 0, y: 0, w: 24, h: 20, color: 'N', opts: {} }, existing])
    const a = await plan(h, [run({ start: '2026-10-01', end: '2026-10-30' })])
    const r1 = await commitPlan(h, a.p, { env: a.env })
    const b = await plan(h, [dock()])
    const r2 = await commitPlan(h, b.p, { env: b.env })
    expect(state.widgets.find(w => w.id === 'ps0')).toEqual(existing)
    const docked = state.widgets.filter(w => w.type === 'periodsort' && w.id !== 'ps0')
    expect(docked.map(w => w.opts)).toEqual([{ start: 20261001, end: 20261030, group: null }])
    await undoEntry(h, r2.undo)
    expect(state.widgets.find(w => w.id === 'ps0')).toEqual(existing)
    expect(state.widgets.filter(w => w.type === 'periodsort').map(w => w.id)).toEqual(['ps0'])
    expect(ps.panel).toEqual({ start: 20261001, end: 20261030, group: null })
    expect(r1.ok).toBe(true)
  })
  it('the contract: both local (not destructive), exact Undo, on the periodSort target', () => {
    for (const n of ['periodSort.run', 'periodSort.dock']) {
      const c = getCapability(n)
      expect([c.target, c.risk, c.undo], n).toEqual(['periodSort', 'local', 'exact'])
    }
  })
})

describe('routing: the tool\'s words reach boardEdit (where periodSort.* route)', () => {
  it.each([
    'run a custom period sort from Oct 1 to today',
    'period sort sectors since Sep 15',
    'rank stocks from Oct 1 to Oct 30',
    'rank the themes between 2026-09-01 and 2026-10-01',
    'dock that ranking',
  ])('%s', (q) => {
    expect(selectGroups(q).selected).toContain('boardEdit')
  })
})

describe('source: ONE writer — the popover and UCT Agent share runPeriodSort; Dock is handleDockPeriodSort', () => {
  const src = readFileSync(resolve(globalThis.process.cwd(), 'src/pages/charts/ChartsWorkspace.jsx'), 'utf8')
  it('the popover\'s Sort calls runPeriodSort', () => {
    expect(src).toMatch(/onSort=\{\(start, end, replay, group, tf, markStart\) => \{\s*setPeriodSortSel\(null\)\s*runPeriodSort\(start, end, replay, group, tf, markStart\)/)
  })
  it('the Agent host\'s run is runPeriodSort with NO timeframe; dock is the panel\'s handleDockPeriodSort, which returns the new id', () => {
    expect(src).toMatch(/run: runPeriodSort, dock: handleDockPeriodSort/)
    expect(src).toMatch(/r\.run\(a\.start, a\.end, !!a\.replay, a\.group \|\| null, null, a\.markStart \|\| 'off'\)/)
    expect(src).toMatch(/const id = `w-periodsort-\$\{Date\.now\(\)\}`[\s\S]{0,1600}?return id\n {2}\}, \[scheduleSave, groupSyms\]\)/)
    expect(src).toMatch(/onDock=\{\(\) => handleDockPeriodSort\(periodSortPanel\.start, periodSortPanel\.end, periodSortPanel\.group\)\}/)
  })
})

describe('through the REAL panel (panelHarness)', () => {
  let p
  beforeEach(() => { p = setupPanel() })
  afterEach(() => { cleanup() })
  it('"rank stocks from Oct 1 to Oct 30" (scripted) → applied with a receipt, no card; "undo" closes it', async () => {
    const { say, h, board } = p.mount(...ONE('NVDA'))
    const ps = periodSortSource(board?.state || { widgets: [] })
    h.periodSort = ps.source
    p.st.envelopes.push(p.env('apply', [{ action: 'periodSort.run', target: 'periodSort', args: { start: '2026-10-01', end: '2026-10-30', group: 'stocks', replay: false, markStart: 'off' } }]))
    const out = await say('rank stocks from Oct 1 to Oct 30')
    expect(out).toMatch(/Custom-Period Sort: US common stocks ranked by % change/)
    expect(ps.panel).toEqual({ start: 20261001, end: 20261030, group: null })
    expect(screen.queryAllByTestId('agent-proposal').length).toBe(0)
    await say('undo')
    expect(ps.panel).toBe(null)
    expect(p.turns()).toBe(1)
  }, 40000)
})

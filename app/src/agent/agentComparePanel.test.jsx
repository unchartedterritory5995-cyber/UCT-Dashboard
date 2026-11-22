// compare.openView — Tools → Compare Symbols opened on its Rotation (RRG-style) or Overlay tab, through the product's OWN
// door: the `uct:compare-open` event (COMPARE_OPEN_EVENT) a chart's "Open the rotation map" link dispatches. The host source
// is the REAL pages/charts/compareAgent.js over ChartsWorkspace's compare state (faked below exactly as the workspace and the
// panel handle the event), then the REAL CompareSymbolsPanel in a wrapper that holds the workspace's compare state.
import { useCallback, useEffect, useRef, useState } from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { buildContext, getCapability, getTargetKind } from './capabilities'
import { planOps, collectTargets, prepareOps, undoNotesFor } from './executor'
import { commitPlan, undoEntry } from './runtime'
import { makeBoard } from './__fixtures__/board'
import { setupPanel, ONE } from './testing/panelHarness'
import { selectGroups, GROUPS } from './routing'
import { COMPARE_NO_UNDO, COMPARE_NOT_HERE } from './capabilities/comparePanel'
import { compareAgentSource } from '../pages/charts/compareAgent'
import { COMPARE_OPEN_EVENT } from '../pages/charts/compareGroups'
import CompareSymbolsPanel from '../pages/charts/CompareSymbolsPanel'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
// the Rotation tab's map is its own unit (CompareSymbolsPanel.rotation.test.jsx): a stand-in that shows the intent it got
vi.mock('../pages/charts/CompareRotation', () => ({ default: ({ intent }) => <div data-testid="rotation-stub">{JSON.stringify(intent ? { sym: intent.sym ?? null, group: intent.group ?? null } : null)}</div> }))
registerBuiltins()
const CTX = { surface: 'charts' }

/** ChartsWorkspace's compare state + the panel's tab rule, answering the REAL window event as they do. */
function workspace({ mobile = false, grid = false, open = false, tab = null, hasChart = true, percent = false, deaf = false, stalePick = false, intent = null } = {}) {
  const w = { mobile, grid, open, tab: open ? (tab || 'overlay') : null, intent: open ? intent : null, events: [], closes: 0, percent, chart: hasChart }
  const onOpen = (e) => {
    w.events.push(e.detail)
    if (deaf || w.mobile) return                                             // ChartsWorkspace: ignored on the phone
    if (!stalePick) w.intent = e.detail                                     // setCompareIntent(e.detail); `stalePick`: the tab moves, the pick does not
    const d = e.detail || {}
    if (!w.open) { w.open = true; w.tab = d.tab === 'rotation' ? 'rotation' : 'overlay' }   // initialIntent → the panel's tab
    else if (d.tab === 'rotation') w.tab = 'rotation'                       // the open panel's own listener
    else if (d.tab === 'overlay') w.tab = 'overlay'
  }
  window.addEventListener(COMPARE_OPEN_EVENT, onOpen)
  w.off = () => window.removeEventListener(COMPARE_OPEN_EVENT, onOpen)
  w.source = compareAgentSource(() => ({ mobile: w.mobile, grid: w.grid, open: w.open, tab: w.tab, intent: w.intent,
    hasChart: () => w.chart, percentOn: () => w.percent, close: () => { w.closes += 1; w.open = false; w.tab = null; w.intent = null } }))
  return w
}
let live = []
afterEach(() => { for (const w of live) w.off(); live = []; cleanup(); vi.restoreAllMocks() })
function host(opts) {
  const b = makeBoard([{ id: 'c', type: 'chart', x: 0, y: 0, w: 24, h: 20, color: 'N', opts: {} }], { 'N:c': 'NVDA' })
  const w = workspace(opts)
  live.push(w)
  b.host.compare = w.source
  return { h: b.host, w }
}
const view = (args) => ({ action: 'compare.openView', target: 'comparePanel', args: { tab: 'rotation', symbol: null, groupType: null, group: null, ...args } })
async function plan(h, ops, ctx = CTX) {
  buildContext(h, ctx)
  const env = await prepareOps(ops)
  return { p: planOps(collectTargets(h, ['comparePanel']), ops, env, ctx), env }
}
const strip = (d) => { const { agentSeq: _s, ...rest } = d || {}; return rest }

describe('compare.openView — opens and switches the panel through its own event', () => {
  it('closed → Rotation: ONE event, the panel read back open on Rotation; Undo closes it (exact)', async () => {
    const { h, w } = host()
    const { p, env } = await plan(h, [view({})])
    expect(p.ok).toBe(true)
    expect(p.lines[0]).toBe('Opened the Compare panel (Tools → Compare Symbols) on its Rotation tab — a view, nothing saved')
    const res = await commitPlan(h, p, { env })
    expect(res.ok).toBe(true)
    expect(w.events.map(strip)).toEqual([{ tab: 'rotation' }])
    expect([w.open, w.tab]).toEqual([true, 'rotation'])
    expect(res.undo).toBeTruthy()
    expect((await undoEntry(h, res.undo)).ok).toBe(true)
    expect([w.open, w.closes, w.events.length]).toEqual([false, 1, 1])     // closed by the panel's own close, no event
  })
  it('a stock named: the link\'s own detail — its theme by default, its sector / industry when said', async () => {
    const a = host()
    const r1 = await plan(a.h, [view({ symbol: 'nvda' })])
    expect(r1.p.lines[0]).toMatch(/on its Rotation tab, showing NVDA's theme on the rotation map \(the map says so if none is on file\)/)
    await commitPlan(a.h, r1.p, { env: r1.env })
    expect(a.w.events.map(strip)).toEqual([{ tab: 'rotation', sym: 'NVDA', group: 'theme' }])
    const b = host()
    const r2 = await plan(b.h, [view({ symbol: 'AMD', groupType: 'industry' })])
    await commitPlan(b.h, r2.p, { env: r2.env })
    expect(b.w.events.map(strip)).toEqual([{ tab: 'rotation', sym: 'AMD', group: 'industry' }])
  })
  it('a named group: matched through UCT\'s own group list → { type, name }; more than one / none / unreadable asks, nothing sent', async () => {
    const groups = { theme: [{ name: 'AI Chips', count: 12 }], sector: [{ name: 'Technology', count: 300 }], industry: [{ name: 'Semiconductors', count: 40 }, { name: 'Semiconductor Equipment', count: 15 }] }
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const t = new URL(String(url), 'http://x').searchParams.get('type')
      return { ok: true, json: async () => ({ groups: groups[t] || [] }) }
    })
    const { h, w } = host()
    const r = await plan(h, [view({ group: 'semiconductors', groupType: 'industry' })])
    expect(r.p.ok).toBe(true)
    expect(r.p.lines[0]).toMatch(/showing the Semiconductors industry on the rotation map/)
    await commitPlan(h, r.p, { env: r.env })
    expect(w.events.map(strip)).toEqual([{ tab: 'rotation', group: { type: 'industry', name: 'Semiconductors' } }])
    const many = await plan(h, [view({ group: 'semi' })])
    expect(many.p.refusals[0].reason).toMatch(/More than one group matches “semi”: Semiconductors \(industry\), Semiconductor Equipment \(industry\)/)
    expect((await plan(h, [view({ group: 'biotech' })])).p.refusals[0].reason).toMatch(/UCT has no theme, sector or industry called “biotech”/)
    globalThis.fetch.mockImplementation(async () => ({ ok: false, json: async () => ({}) }))
    expect((await plan(h, [view({ group: 'semis', groupType: 'industry' })])).p.refusals[0].reason).toMatch(/couldn't read the industry list just now/)
    expect(w.events.length).toBe(1)
  })
  it('open on Overlay → Rotation: switched, read back; Undo returns to Overlay (the panel stays open)', async () => {
    const { h, w } = host({ open: true, tab: 'overlay' })
    const { p, env } = await plan(h, [view({})])
    expect(p.lines[0]).toBe('Switched the Compare panel to its Rotation tab — a view, nothing saved')
    const res = await commitPlan(h, p, { env })
    expect(w.tab).toBe('rotation')
    expect((await undoEntry(h, res.undo)).ok).toBe(true)
    expect([w.open, w.tab, w.closes]).toEqual([true, 'overlay', 0])
    expect(w.events.map(strip)).toEqual([{ tab: 'rotation' }, { tab: 'overlay' }])
  })
  it('open on Rotation → Overlay: switched — and NO Undo, said plainly (the rotation map starts over when left)', async () => {
    const { h, w } = host({ open: true, tab: 'rotation' })
    const { p, env } = await plan(h, [view({ tab: 'overlay' })])
    const res = await commitPlan(h, p, { env })
    expect(res.ok).toBe(true)
    expect(w.tab).toBe('overlay')
    expect(res.undo ?? null).toBe(null)
    expect(undoNotesFor(p, res)).toEqual([COMPARE_NO_UNDO])
  })
  it('re-picking on an open Rotation tab: read back as THIS event\'s detail; no Undo', async () => {
    const { h, w } = host({ open: true, tab: 'rotation' })
    const { p, env } = await plan(h, [view({ symbol: 'TSLA', groupType: 'sector' })])
    const res = await commitPlan(h, p, { env })
    expect(res.ok).toBe(true)
    expect(strip(w.intent)).toEqual({ tab: 'rotation', sym: 'TSLA', group: 'sector' })
    expect(res.undo ?? null).toBe(null)
  })
  it('"already on Rotation": an honest already, NO event, no Undo', async () => {
    const { h, w } = host({ open: true, tab: 'rotation' })
    const { p } = await plan(h, [view({})])
    expect(p.noops.join(' ')).toMatch(/The Compare panel is already open on its Rotation tab/)
    expect(p.plans.flatMap(x => x.items).filter(i => i.patch).length).toBe(0)
    expect(w.events).toEqual([])
  })
})

describe('⛔ refused — not available here, nothing dispatched', () => {
  it('the phone shell and Multi Chart: "not available here", no event', async () => {
    for (const where of [{ mobile: true }, { grid: true }]) {
      const { h, w } = host(where)
      const spy = vi.spyOn(window, 'dispatchEvent')
      const { p } = await plan(h, [view({})])
      expect(p.ok).toBe(false)
      expect(p.refusals[0].reason).toBe(COMPARE_NOT_HERE)
      expect(spy.mock.calls.filter(([e]) => e?.type === COMPARE_OPEN_EVENT)).toEqual([])
      expect(w.events).toEqual([])
      // and the source itself never dispatches there
      expect(w.source.open({ tab: 'rotation' })).toBe(false)
      expect(w.events).toEqual([])
      spy.mockRestore()
    }
  })
  it('a page with no Compare panel (no host source): the kind says so; off Charts the action is not offered', async () => {
    const b = makeBoard([{ id: 'c', type: 'chart', x: 0, y: 0, w: 24, h: 20, color: 'N', opts: {} }], { 'N:c': 'NVDA' })
    expect(getTargetKind('comparePanel').list(b.host)).toEqual([])
    expect(getTargetKind('comparePanel').unavailable).toBe(COMPARE_NOT_HERE)
    expect(getCapability('compare.openView').available({ surface: 'screener' })).toBe(false)
  })
  it('no chart on the board (opening would ADD a saved chart widget) / % scale on (opening saves it off): refused, no event', async () => {
    const a = host({ hasChart: false })
    expect((await plan(a.h, [view({})])).p.refusals[0].reason).toMatch(/no chart on this board for the Compare panel/)
    const b = host({ percent: true })
    expect((await plan(b.h, [view({ tab: 'overlay' })])).p.refusals[0].reason).toMatch(/on % scale, and opening the panel turns % scale off and saves that/)
    expect([...a.w.events, ...b.w.events]).toEqual([])
    // once open, its % scale was already handled: switching tabs is fine
    const c = host({ percent: true, open: true, tab: 'overlay' })
    expect((await plan(c.h, [view({})])).p.ok).toBe(true)
  })
  it('⛔ no false success: an event the panel never acts on is not claimed', async () => {
    const { h, w } = host({ deaf: true })
    const { p, env } = await plan(h, [view({})])
    const res = await commitPlan(h, p, { env })
    expect(res.ok).toBe(false)
    expect(w.events.length).toBe(1)
    expect(w.open).toBe(false)
  }, 10000)
  it('⛔ Undo refuses once the member switched the panel themselves — their tab is never changed', async () => {
    const { h, w } = host()
    const { p, env } = await plan(h, [view({})])
    const res = await commitPlan(h, p, { env })
    w.tab = 'overlay'                                                       // the member clicked Overlay
    expect((await undoEntry(h, res.undo)).ok).toBe(false)
    expect([w.open, w.tab, w.closes]).toEqual([true, 'overlay', 0])
  })
  it('the contract: local, a view (not destructive), on the comparePanel target', () => {
    const c = getCapability('compare.openView')
    expect(c.target).toBe('comparePanel')
    expect(c.destructive || false).toBe(false)
    expect(c.surfaces).toEqual(['charts'])
  })
})

// AUDIT probe scope (Lead, 2026-11-12): R1..R8, one test (or more) each
describe('AUDIT probe scope R1..R8', () => {
  const board = (h) => JSON.stringify(h.charts.list().map(c => [c.ref, c.symbol, c.tf, c.stored]))
  it('R1: opening on Rotation (several phrasings → one op) writes ONLY the panel — no chart timeframe, setting or indicator input moves', async () => {
    for (const args of [{}, { symbol: 'NVDA' }, { symbol: 'NVDA', groupType: 'industry' }]) {
      const { h, w } = host()
      const before = board(h)
      const { p, env } = await plan(h, [view(args)])
      expect(p.plans.map(x => x.kind)).toEqual(['comparePanel'])
      await commitPlan(h, p, { env })
      expect([w.open, w.tab]).toEqual([true, 'rotation'])
      expect(board(h)).toBe(before)
    }
    // the RS indicator's `view` input is never this action's: no arg reaches it, and the schema refuses any extra key
    const c = getCapability('compare.openView')
    expect(Object.keys(c.args.properties).sort()).toEqual(['group', 'groupType', 'symbol', 'tab'])
    expect(c.args.additionalProperties).toBe(false)
  })
  it('R2: an empty board is refused UP FRONT (openCompare would add a saved chart widget) — no event, no widget', async () => {
    const { h, w } = host({ hasChart: false })
    const widgets = JSON.stringify(h.charts.list())
    const { p } = await plan(h, [view({})])
    expect(p.ok).toBe(false)
    expect(w.events).toEqual([])
    expect(JSON.stringify(h.charts.list())).toBe(widgets)
    expect(w.source.open({ tab: 'rotation' })).toBe(false)                 // and the door itself never dispatches there
    expect(w.events).toEqual([])
  })
  it('R3: phone shell: "not available here", no event, no write', async () => {
    const { h, w } = host({ mobile: true })
    const before = board(h)
    const { p } = await plan(h, [view({ symbol: 'NVDA' })])
    expect(p.refusals[0].reason).toBe(COMPARE_NOT_HERE)
    expect(p.ok).toBe(false)
    expect([w.events, w.open, board(h)]).toEqual([[], false, before])
  })
  it('R4: already on Rotation → "already", no event, nothing to Undo; on Overlay → switched; Undo uses the panel\'s own close door', async () => {
    const a = host({ open: true, tab: 'rotation' })
    const r = await plan(a.h, [view({})])
    expect(r.p.noops.join(' ')).toMatch(/already open on its Rotation tab/)
    const res = await commitPlan(a.h, r.p, { env: r.env })
    expect(res.undo ?? null).toBe(null)
    expect(a.w.events).toEqual([])
    const b = host({ open: true, tab: 'overlay' })
    const r2 = await plan(b.h, [view({})])
    await commitPlan(b.h, r2.p, { env: r2.env })
    expect(b.w.tab).toBe('rotation')
    // the close door is ChartsWorkspace's closeCompare — the panel's ×/Escape onClose (pinned in the source check below)
    expect(readFileSync(resolve(globalThis.process.cwd(), 'src/pages/charts/ChartsWorkspace.jsx'), 'utf8')).toMatch(/close: closeCompare/)
  })
  it('R5: the detail is what CompareRotation reads ({sym, group: type} or {group: {type, name}}); an empty or unknown group, or a type with no stock, asks', async () => {
    const rot = readFileSync(resolve(globalThis.process.cwd(), 'src/pages/charts/CompareRotation.jsx'), 'utf8')
    expect(rot).toMatch(/if \(g && typeof g === 'object'\) \{ type = g\.type; name = g\.name \}/)
    expect(rot).toMatch(/else if \(typeof g === 'string' && intent\.sym\) \{ type = g; name = await groupNameFor\(norm\(intent\.sym\), g\) \}/)
    const { h, w } = host()
    expect((await plan(h, [view({ group: 'the group' })])).p.refusals[0].reason).toMatch(/Name the group/)
    expect((await plan(h, [view({ groupType: 'sector' })])).p.refusals[0].reason).toMatch(/Which stock's sector should the Rotation map show\?/)
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ({ ok: true, json: async () => ({ groups: [{ name: 'Semiconductors', count: 40 }] }) }))
    expect((await plan(h, [view({ group: 'zzz', groupType: 'industry' })])).p.refusals[0].reason).toMatch(/UCT has no industry called “zzz”/)
    expect(w.events).toEqual([])
  })
  it.each(['compare NVDA and AMD', 'compare this chart against the semis group', 'is there sector rotation into energy', 'rotation out of tech this week',
    'what does rotation mean', 'set the RS view to rotation'])('R6: "%s" does not select comparePanel', (q) => {
    expect(selectGroups(q).selected).not.toContain('comparePanel')
  })
  it('R6: "compare NVDA and AMD" still reaches the charts group (chart.compare)', () => {
    expect(selectGroups('compare NVDA and AMD').selected).toContain('charts')
  })
  it('R7: the receipt waits for the panel\'s own read-back; a door that never lands is a failure, not a receipt', async () => {
    const { h } = host({ deaf: true })
    const { p, env } = await plan(h, [view({})])
    const res = await commitPlan(h, p, { env })
    expect(res.ok).toBe(false)
    expect(res.undo ?? null).toBe(null)
  }, 10000)
})

describe('routing: its own words-only group; the RS indicator\'s Rotation view is never taken', () => {
  it.each([
    'open the rotation map', 'show me the rrg view', 'switch the compare panel to the rotation tab', 'show the rotation graph for nvda',
    'open the relative rotation graph for the semis', 'go to the overlay tab', 'open the compare symbols panel on rotation',
  ])('"%s" → comparePanel', (q) => expect(selectGroups(q).selected).toContain('comparePanel'))
  it.each([
    'show rotation on the RS indicator', 'switch the RS indicator to the rotation view', 'set the relative strength view to rotation',
    'add the rotation view of the rs line', 'change the indicator to rotation view', 'put the rrg view in the rs pane',
  ])('"%s" → never comparePanel', (q) => expect(selectGroups(q).selected).not.toContain('comparePanel'))
  it('"show rotation on the RS indicator" still reaches the indicators', () => {
    expect(selectGroups('show rotation on the RS indicator').selected.some(g => /^indicator/.test(g))).toBe(true)
  })
  it('the group is words-only and fill-last, named by its domain', () => {
    const g = GROUPS.find(x => x.id === 'comparePanel')
    expect([g.wordsOnly, g.fillLast, g.domains]).toEqual([true, true, ['compare']])
  })
})

describe('source: ONE door — the workspace\'s compare state and the panel\'s own tab', () => {
  const ws = readFileSync(resolve(globalThis.process.cwd(), 'src/pages/charts/ChartsWorkspace.jsx'), 'utf8')
  const panel = readFileSync(resolve(globalThis.process.cwd(), 'src/pages/charts/CompareSymbolsPanel.jsx'), 'utf8')
  it('the host\'s compare is compareAgentSource over the workspace\'s state; the panel reports its tab; × and Undo share closeCompare', () => {
    expect(ws).toMatch(/compare: compareAgentSource\(\(\) => agentCompareRef\.current\)/)
    expect(ws).toMatch(/onClose=\{closeCompare\}\s*onTabChange=\{setCompareTab\}/)
    expect(ws).toMatch(/mobile: isMobile, grid: gridMode, open: compareOpen, tab: compareTab, intent: compareIntent/)
    expect(ws).toMatch(/if \(isMobileRef\.current\) return\s*setCompareIntent\(e\?\.detail \|\| null\)\s*openCompareRef\.current\(\)/)
    expect(panel).toMatch(/useEffect\(\(\) => \{ onTabChange\?\.\(tab\) \}, \[tab, onTabChange\]\)/)
    expect(panel).toMatch(/const api = compareChartApi\(map, activeChartRef\?\.current\)/)
  })
})

/** ChartsWorkspace's compare state around the REAL CompareSymbolsPanel (the lines the source check above pins). */
function Workspace({ expose, mobile = false }) {
  const [compareOpen, setCompareOpen] = useState(false)
  const [compareIntent, setCompareIntent] = useState(null)
  const [compareTab, setCompareTab] = useState(null)
  const chartApiById = useRef(new Map([['c', { getComparison: () => [], setComparison: () => {}, getPercentScale: () => false, setPercentScale: () => {} }]]))
  const activeChartRef = useRef('c')
  const closeCompare = useCallback(() => { setCompareOpen(false); setCompareIntent(null); setCompareTab(null) }, [])
  const ref = useRef(null)
  ref.current = { mobile, grid: false, open: compareOpen, tab: compareTab, intent: compareIntent, hasChart: () => true, percentOn: () => false, close: closeCompare }
  useEffect(() => { expose(compareAgentSource(() => ref.current)) }, [expose])
  useEffect(() => {
    const onOpen = (e) => { if (mobile) return; setCompareIntent(e?.detail || null); setCompareOpen(true) }
    window.addEventListener(COMPARE_OPEN_EVENT, onOpen)
    return () => window.removeEventListener(COMPARE_OPEN_EVENT, onOpen)
  }, [mobile])
  return compareOpen ? <CompareSymbolsPanel chartApiById={chartApiById} activeChartRef={activeChartRef} initialIntent={compareIntent} onClose={closeCompare} onTabChange={setCompareTab} /> : null
}

describe('through the REAL CompareSymbolsPanel', () => {
  beforeEach(() => { vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ({ ok: false, json: async () => ({}) })) })
  async function mount(mobile = false) {
    let src = null
    render(<Workspace mobile={mobile} expose={(s) => { src = s }} />)
    const b = makeBoard([{ id: 'c', type: 'chart', x: 0, y: 0, w: 24, h: 20, color: 'N', opts: {} }], { 'N:c': 'NVDA' })
    b.host.compare = src
    return b.host
  }
  const selected = () => screen.getAllByRole('tab').find(t => t.getAttribute('aria-selected') === 'true')?.textContent
  it('opens on Rotation with NVDA\'s sector, the tab ON SCREEN is Rotation; Overlay then; Undo of the open closes the dialog', async () => {
    const h = await mount()
    const r1 = await plan(h, [view({ symbol: 'NVDA', groupType: 'sector' })])
    let res
    res = await commitPlan(h, r1.p, { env: r1.env })
    expect(res.ok).toBe(true)
    expect(selected()).toBe('Rotation')
    expect(JSON.parse((await screen.findByTestId('rotation-stub')).textContent)).toEqual({ sym: 'NVDA', group: 'sector' })
    const r2 = await plan(h, [view({ tab: 'overlay' })])
    await commitPlan(h, r2.p, { env: r2.env })
    expect(selected()).toBe('Overlay')
    const r3 = await plan(h, [view({})])
    let res3
    res3 = await commitPlan(h, r3.p, { env: r3.env })
    expect(selected()).toBe('Rotation')
    expect((await undoEntry(h, res3.undo)).ok).toBe(true)
    expect(selected()).toBe('Overlay')
    expect((await undoEntry(h, res.undo)).ok).toBe(false)   // stale: the member's panel moved on since
  })
  it('Undo of an open from closed closes the real dialog', async () => {
    const h = await mount()
    const r = await plan(h, [view({ tab: 'overlay' })])
    let res
    res = await commitPlan(h, r.p, { env: r.env })
    expect(screen.getByRole('dialog', { name: 'Compare Symbols' })).toBeTruthy()
    expect((await undoEntry(h, res.undo)).ok).toBe(true)
    expect(screen.queryByRole('dialog', { name: 'Compare Symbols' })).toBe(null)
  })
  it('on the phone shell: refused, no dialog', async () => {
    const h = await mount(true)
    const r = await plan(h, [view({})])
    expect(r.p.refusals[0].reason).toBe(COMPARE_NOT_HERE)
    expect(screen.queryByRole('dialog')).toBe(null)
  })
})

// AUDIT #1170 point 1 (c): the contract's per-capability `undoNote` (as chartSetup.setRange's) — the manifest says which
// paths have no Undo (summary), and this rail shows the REAL panel's receipt is NOT undoable on exactly those paths (data-undoable; "undo" leaves it alone)
describe('rail: the receipt offers an Undo button only where Undo is exact (through the REAL AgentPanel; it has no Undo BUTTON, the receipt marks itself undoable)', () => {
  let p
  beforeEach(() => { p = setupPanel() })
  const lastReceipt = () => screen.getAllByTestId('agent-receipt').at(-1)
  const mountWith = (opts) => {
    const m = p.mount(...ONE('NVDA'))
    const w = workspace(opts)
    live.push(w)
    m.h.compare = w.source
    return { ...m, w }
  }
  it('Rotation → Overlay: switched, the receipt says why there is no Undo, and the receipt is not undoable', async () => {
    const { say, w } = mountWith({ open: true, tab: 'rotation' })
    p.st.envelopes.push(p.env('apply', [view({ tab: 'overlay' })]))
    const out = await say('go to the overlay tab')
    expect(out).toMatch(/Switched the Compare panel to its Overlay tab/)
    expect(out).toContain(COMPARE_NO_UNDO)
    expect(w.tab).toBe('overlay')
    expect(lastReceipt().getAttribute('data-undoable')).toBe(null)
    // and "undo" cannot reach it: the tab stays, no event is sent
    const n = w.events.length
    await say('undo')
    expect([w.open, w.tab, w.events.length]).toEqual([true, 'overlay', n])
  }, 40000)
  it('a re-pick on an open Rotation tab: not undoable either', async () => {
    const { say, w } = mountWith({ open: true, tab: 'rotation' })
    p.st.envelopes.push(p.env('apply', [view({ symbol: 'AMD', groupType: 'sector' })]))
    const out = await say('show amd\'s sector on the rotation map')
    expect(out).toContain(COMPARE_NO_UNDO)
    expect(strip(w.intent)).toEqual({ tab: 'rotation', sym: 'AMD', group: 'sector' })
    expect(lastReceipt().getAttribute('data-undoable')).toBe(null)
  }, 40000)
  it('closed → Rotation and Overlay → Rotation: undoable, no no-Undo note; "undo" puts the panel back', async () => {
    const a = mountWith({})
    p.st.envelopes.push(p.env('apply', [view({})]))
    const out = await a.say('open the rotation map')
    expect(out).not.toContain(COMPARE_NO_UNDO)
    expect(lastReceipt().getAttribute('data-undoable')).toBe('true')
    await a.say('undo')
    expect(a.w.open).toBe(false)
    cleanup()
    p = setupPanel()
    const b = mountWith({ open: true, tab: 'overlay' })
    p.st.envelopes.push(p.env('apply', [view({})]))
    const out2 = await b.say('switch to the rotation tab')
    expect(out2).not.toContain(COMPARE_NO_UNDO)
    expect(lastReceipt().getAttribute('data-undoable')).toBe('true')
    await b.say('undo')
    expect([b.w.open, b.w.tab]).toEqual([true, 'overlay'])
  }, 40000)
})

// AUDIT N1 (#1170): a panel that lands on Rotation but keeps the PREVIOUS pick is not a success — the read-back checks the
// pick (this event's detail), never the tab alone
describe('rail: Rotation with the OLD pick is "did not take effect", never a receipt', () => {
  const old = { tab: 'rotation', sym: 'AMD', group: 'theme' }
  it('Overlay → Rotation for NVDA sector, the panel switches tab but keeps the AMD theme: failed, no Undo', async () => {
    const { h, w } = host({ open: true, tab: 'overlay', intent: old, stalePick: true })
    const { p, env } = await plan(h, [view({ symbol: 'NVDA', groupType: 'sector' })])
    expect(p.ok).toBe(true)
    const res = await commitPlan(h, p, { env })
    expect(res.ok).toBe(false)
    expect(res.undo ?? null).toBe(null)
    expect(w.intent).toEqual(old)
    expect(strip(w.events.at(0))).toEqual({ tab: 'rotation', sym: 'NVDA', group: 'sector' })
  }, 10000)
  it('a named group on Overlay → Rotation, old pick kept: failed, no Undo', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ({ ok: true, json: async () => ({ groups: [{ name: 'Semiconductors', count: 40 }] }) }))
    const { h } = host({ open: true, tab: 'overlay', intent: old, stalePick: true })
    const { p, env } = await plan(h, [view({ group: 'semiconductors', groupType: 'industry' })])
    const res = await commitPlan(h, p, { env })
    expect([res.ok, res.undo ?? null]).toEqual([false, null])
  }, 10000)
  it('a re-pick on an open Rotation panel that ignores it: failed, no Undo, the old pick stays', async () => {
    const { h, w } = host({ open: true, tab: 'rotation', intent: old, stalePick: true })
    const { p, env } = await plan(h, [view({ symbol: 'NVDA', groupType: 'industry' })])
    const res = await commitPlan(h, p, { env })
    expect([res.ok, res.undo ?? null, w.tab]).toEqual([false, null, 'rotation'])
    expect(w.intent).toEqual(old)
  }, 10000)
  it('the same re-pick through the REAL AgentPanel: no receipt claims it, nothing undoable', async () => {
    const pp = setupPanel()
    const m = pp.mount(...ONE('NVDA'))
    const w = workspace({ open: true, tab: 'rotation', intent: old, stalePick: true })
    live.push(w)
    m.h.compare = w.source
    pp.st.envelopes.push(pp.env('apply', [view({ symbol: 'NVDA', groupType: 'industry' })]))
    const out = await m.say('show the nvda industry on the rotation map')
    expect(out).not.toMatch(/showing NVDA's industry on the rotation map/)
    expect(out).toMatch(/did not take effect|didn't|did not/i)
    expect(screen.queryAllByTestId('agent-receipt').filter(r => r.getAttribute('data-undoable') === 'true')).toEqual([])
  }, 40000)
})

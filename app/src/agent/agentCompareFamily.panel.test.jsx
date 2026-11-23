// Compare family (Charts C1-034 … C1-041 + the Compare Rotation / Overlay view) through the REAL panel: the member's words →
// the instant path's general readers (capabilities/comparePhrases.js) → the existing capability → the Compare panel's own list
// writers → the chart's stored settings, READ BACK here, then Undo through the same door. Multi-chart forms run through the
// same lifted target words, deixis and spatial safety net a model plan meets. The model is a stand-in (scripted, or a sentinel
// when a turn would have needed it): no paid call. The ticker search is the harness's fixture table (Gate B: an unknown ticker
// is refused with a suggestion, never swapped in).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, ONE, TWO, FOUR, MODEL_SENTINEL } from './testing/panelHarness'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { compareAgentSource } from '../pages/charts/compareAgent'
import { COMPARE_OPEN_EVENT } from '../pages/charts/compareGroups'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

const C = (sym, extra = {}) => ({ sym, enabled: true, color: '#60a5fa', scaleMode: 'new', ...extra })
const widget = (board, id) => board.state.widgets.find(x => x.id === id)
const csOf = (board, id) => { const w = widget(board, id); return mergeChartSettings(w?.opts?.settings ? JSON.stringify(w.opts.settings) : null) }
const syms = (board, id) => (csOf(board, id).comparisonSymbols || []).map(x => x.sym)
const compOf = (board, id, sym) => (csOf(board, id).comparisonSymbols || []).find(x => x.sym === sym)
const seed = (board, id, patch) => { const w = widget(board, id); w.opts.settings = { ...w.opts.settings, ...patch } }
const snap = (x) => JSON.stringify(x ?? null)

// the Compare panel's group reads (api/routers/compare.py shapes), faked at the network beside the harness's own answers
const GROUPS = { theme: [{ name: 'AI Chips', count: 3 }], sector: [{ name: 'Technology', count: 3 }], industry: [{ name: 'Semiconductors', count: 3 }] }
const MEMBERS = { 'AI Chips': ['NVDA', 'AMD', 'AVGO'], Technology: ['AAPL', 'MSFT', 'ORCL'], Semiconductors: ['AMD', 'AVGO', 'MU'] }
function withGroupReads() {
  const base = globalThis.fetch
  globalThis.fetch = vi.fn(async (url, init) => {
    const u = new URL(String(url), 'http://x')
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
    if (u.pathname === '/api/compare/groups') return json({ groups: GROUPS[u.searchParams.get('type')] || [] })
    if (u.pathname === '/api/compare/group-members') { const n = u.searchParams.get('name'); return json({ name: n, symbols: MEMBERS[n] || [], total: (MEMBERS[n] || []).length, truncated: false }) }
    return base(url, init)
  })
}

let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('one chart — instant, end state read back, exact Undo', () => {
  let m
  beforeEach(() => { m = p.mount(...ONE('NVDA')) })

  it('C1-034 "compare it with MSFT and QQQ" — both overlaid with the panel\'s own entry shape; Undo takes them off', async () => {
    const out = await m.say('compare it with MSFT and QQQ')
    await waitFor(() => expect(syms(m.board, 'c')).toEqual(['MSFT', 'QQQ']))
    expect(compOf(m.board, 'c', 'QQQ')).toMatchObject({ enabled: true, scaleMode: 'new' })
    expect(out).toMatch(/Comparing NVDA with MSFT, QQQ/)
    expect(p.turns()).toBe(0)
    await m.say('undo')
    await waitFor(() => expect(syms(m.board, 'c')).toEqual([]))
  })

  it('C1-034 "overlay SPY on this chart", then "add a QQQ comparison" — each its own change', async () => {
    await m.say('overlay SPY on this chart')
    await waitFor(() => expect(syms(m.board, 'c')).toEqual(['SPY']))
    await m.say('add a QQQ comparison')
    await waitFor(() => expect(syms(m.board, 'c')).toEqual(['SPY', 'QQQ']))
    expect(p.turns()).toBe(0)
    await m.say('undo')
    await waitFor(() => expect(syms(m.board, 'c')).toEqual(['SPY']))
  })

  it('Gate B: an unknown ticker is refused with a suggestion — never swapped in, nothing written', async () => {
    const before = snap(csOf(m.board, 'c').comparisonSymbols)
    const out = await m.say('compare it with AMZON')
    expect(out).toMatch(/UCT has no symbol “AMZON”\. Did you mean AMZN/)
    expect(snap(csOf(m.board, 'c').comparisonSymbols)).toBe(before)
    expect(p.turns()).toBe(0)
  })

  it('Gate B on the model path: a company NAME the model passed through becomes its one ticker ("microsoft" → MSFT), as chart.setSymbol', async () => {
    p.st.envelopes.push((body) => p.env('apply', [{ action: 'chart.compare', target: body.context.charts[0].ref, args: { add: ['microsoft'], remove: [], clear: false } }]))
    await m.say('could you please put microsoft over this one for comparison')
    await waitFor(() => expect(syms(m.board, 'c')).toEqual(['MSFT']))
  })

  it('C1-036 "remove the QQQ comparison" — only QQQ off; Undo puts it back where it was', async () => {
    seed(m.board, 'c', { comparisonSymbols: [C('SPY'), C('QQQ'), C('MSFT')] })
    const out = await m.say('remove the QQQ comparison')
    await waitFor(() => expect(syms(m.board, 'c')).toEqual(['SPY', 'MSFT']))
    expect(out).toMatch(/Comparing NVDA with SPY, MSFT/)
    await m.say('take MSFT off the comparison')
    await waitFor(() => expect(syms(m.board, 'c')).toEqual(['SPY']))
    expect(p.turns()).toBe(0)
    await m.say('undo')
    await waitFor(() => expect(syms(m.board, 'c')).toEqual(['SPY', 'MSFT']))
  })

  it('C1-036 a symbol that is not compared: said honestly, nothing changed', async () => {
    seed(m.board, 'c', { comparisonSymbols: [C('SPY')] })
    const out = await m.say('remove the QQQ comparison')
    expect(out).toMatch(/None of those is being compared on this chart/)
    expect(syms(m.board, 'c')).toEqual(['SPY'])
  })

  it('C1-038 "clear all the comparisons" — every one off (and Group only with them); Undo restores the list exactly', async () => {
    seed(m.board, 'c', { comparisonSymbols: [C('SPY'), C('QQQ', { scaleMode: 'same' })], compareHideBase: true })
    const before = snap(csOf(m.board, 'c').comparisonSymbols)
    const out = await m.say('clear all the comparisons')
    await waitFor(() => expect(syms(m.board, 'c')).toEqual([]))
    expect(csOf(m.board, 'c').compareHideBase).toBe(false)
    expect(out).toMatch(/Removed every comparison from this chart/)
    expect(p.turns()).toBe(0)
    await m.say('undo')
    await waitFor(() => expect(snap(csOf(m.board, 'c').comparisonSymbols)).toBe(before))
    expect(csOf(m.board, 'c').compareHideBase).toBe(true)
  })

  it('C1-039 "put QQQ on the same scale" / "move the comparisons to their own scale" — the row\'s scale; Undo each', async () => {
    seed(m.board, 'c', { comparisonSymbols: [C('SPY'), C('QQQ')] })
    const out = await m.say('put QQQ on the same scale')
    await waitFor(() => expect(compOf(m.board, 'c', 'QQQ').scaleMode).toBe('same'))
    expect(compOf(m.board, 'c', 'SPY').scaleMode).toBe('new')
    expect(out).toMatch(/QQQ on the main price scale/)
    await m.say('move the comparisons to the same % scale')
    await waitFor(() => expect(compOf(m.board, 'c', 'SPY').scaleMode).toBe('same'))
    await m.say('move the comparisons to their own scale')
    await waitFor(() => expect((csOf(m.board, 'c').comparisonSymbols).every(x => x.scaleMode === 'new')).toBe(true))
    expect(p.turns()).toBe(0)
    await m.say('undo')
    await waitFor(() => expect((csOf(m.board, 'c').comparisonSymbols).every(x => x.scaleMode === 'same')).toBe(true))
  })

  it('C1-039 eye: "hide the SPY comparison", "show the SPY comparison again"', async () => {
    seed(m.board, 'c', { comparisonSymbols: [C('SPY'), C('QQQ')] })
    await m.say('hide the SPY comparison')
    await waitFor(() => expect(compOf(m.board, 'c', 'SPY').enabled).toBe(false))
    expect(compOf(m.board, 'c', 'QQQ').enabled).toBe(true)
    await m.say('show the SPY comparison again')
    await waitFor(() => expect(compOf(m.board, 'c', 'SPY').enabled).toBe(true))
    expect(p.turns()).toBe(0)
  })

  it('C1-041 Group only: "hide the base symbol", then "show the main ticker again"; Undo', async () => {
    seed(m.board, 'c', { comparisonSymbols: [C('SPY')] })
    const out = await m.say('hide the base symbol')
    await waitFor(() => expect(csOf(m.board, 'c').compareHideBase).toBe(true))
    expect(out).toMatch(/Group only on/)
    await m.say('show the main ticker again')
    await waitFor(() => expect(csOf(m.board, 'c').compareHideBase).toBe(false))
    expect(p.turns()).toBe(0)
    await m.say('undo')
    await waitFor(() => expect(csOf(m.board, 'c').compareHideBase).toBe(true))
  })

  it('"show it as percent" — the A / L / % toggle\'s keys; Undo back to linear', async () => {
    await m.say('show it as percent')
    await waitFor(() => expect(csOf(m.board, 'c').percentScale).toBe(true))
    expect(p.turns()).toBe(0)
    await m.say('undo')
    await waitFor(() => expect(csOf(m.board, 'c').percentScale).toBeFalsy())
  })

  it('near-misses go to the model, nothing written: fundamentals, "side by side" is two charts', async () => {
    const before = snap(csOf(m.board, 'c'))
    expect(await m.say('compare NVDA earnings to AMD')).toMatch(MODEL_SENTINEL)
    expect(snap(csOf(m.board, 'c'))).toBe(before)
    expect(p.turns()).toBe(1)
  })
})

describe('compare groups — the panel\'s group writers (C1-035 add via the model; C1-037 / C1-040 instant)', () => {
  let m
  beforeEach(() => { withGroupReads(); m = p.mount(...ONE('QQQ')) })

  it('C1-035 add (model plan) → every member, then C1-040 "put the AI Chips group on the same scale" and C1-037 "remove the AI Chips group"; Undo', async () => {
    p.st.envelopes.push((body) => p.env('apply', [{ action: 'chartSetup.compareGroup', target: body.context.charts[0].ref, args: { action: 'add', group: 'ai chips', groupType: 'any', scale: null } }]))
    const out = await m.say('compare this chart against the AI Chips theme')
    await waitFor(() => expect(syms(m.board, 'c')).toEqual(['NVDA', 'AMD', 'AVGO']))
    expect(out).toMatch(/Comparing QQQ with the AI Chips theme: 3 symbols added/)
    expect(p.turns()).toBe(1)
    await m.say('put the AI Chips group on the same scale')
    await waitFor(() => expect(csOf(m.board, 'c').comparisonSymbols.every(x => x.scaleMode === 'same')).toBe(true))
    const out2 = await m.say('remove the ai chips group')
    await waitFor(() => expect(syms(m.board, 'c')).toEqual([]))
    expect(out2).toMatch(/Removed the AI Chips group \(3 symbols\)/)
    expect(p.turns()).toBe(1)                                         // the scale and the removal were instant
    await m.say('undo')
    await waitFor(() => expect(syms(m.board, 'c')).toEqual(['NVDA', 'AMD', 'AVGO']))
    expect(csOf(m.board, 'c').comparisonSymbols.every(x => x.scaleMode === 'same')).toBe(true)
  })

  it('C1-037 a group this chart does not compare is not read as one (no write)', async () => {
    seed(m.board, 'c', { comparisonSymbols: [C('AMD', { group: 'Semiconductors' })] })
    const before = snap(csOf(m.board, 'c').comparisonSymbols)
    await m.say('remove the ai chips group')
    expect(snap(csOf(m.board, 'c').comparisonSymbols)).toBe(before)
  })
})

describe('two charts — the BASE is the target, the symbols are what is added; never confused', () => {
  let m
  beforeEach(() => { m = p.mount(...TWO('NVDA', 'AMD')) })

  it('"compare AMD with NVDA" — the AMD chart gets NVDA; the NVDA chart is untouched', async () => {
    const left = snap(csOf(m.board, 'cl'))
    const out = await m.say('compare AMD with NVDA')
    await waitFor(() => expect(syms(m.board, 'cr')).toEqual(['NVDA']))
    expect(snap(csOf(m.board, 'cl'))).toBe(left)
    expect(out).toMatch(/Comparing AMD with NVDA/)
    expect(p.turns()).toBe(0)
  })

  it('"overlay SPY on the AMD chart" — the named chart only', async () => {
    await m.say('overlay SPY on the AMD chart')
    await waitFor(() => expect(syms(m.board, 'cr')).toEqual(['SPY']))
    expect(syms(m.board, 'cl')).toEqual([])
    expect(p.turns()).toBe(0)
  })

  it('"compare with QQQ" with no chart clicked — asked which chart, nothing changed; the answer runs it there', async () => {
    const out = await m.say('compare with QQQ')
    expect(out).toMatch(/Which chart/)
    expect(syms(m.board, 'cl')).toEqual([])
    expect(syms(m.board, 'cr')).toEqual([])
    await m.click('Chart (AMD)')
    await waitFor(() => expect(syms(m.board, 'cr')).toEqual(['QQQ']))
    expect(syms(m.board, 'cl')).toEqual([])
  })

  it('"compare with QQQ" with a chart clicked — that chart', async () => {
    p.select('cl')
    await m.say('compare with QQQ')
    await waitFor(() => expect(syms(m.board, 'cl')).toEqual(['QQQ']))
    expect(syms(m.board, 'cr')).toEqual([])
  })

  it('"remove the QQQ comparison" — the chart that compares QQQ, the other untouched', async () => {
    seed(m.board, 'cr', { comparisonSymbols: [C('QQQ'), C('SPY')] })
    seed(m.board, 'cl', { comparisonSymbols: [C('SPY')] })
    await m.say('remove the QQQ comparison')
    await waitFor(() => expect(syms(m.board, 'cr')).toEqual(['SPY']))
    expect(syms(m.board, 'cl')).toEqual(['SPY'])
  })

  it('spatial net: a MODEL plan aimed at the wrong chart for "the AMD chart" is never applied silently', async () => {
    p.st.envelopes.push((body) => p.env('apply', [{ action: 'chart.compare', target: body.context.charts.find(c => c.label === 'Chart (NVDA)').ref, args: { add: ['SPY'], remove: [], clear: false } }]))
    const out = await m.say('i would love to see spy laid over the AMD chart for a comparison please')
    expect(p.turns()).toBe(1)
    expect(out).toMatch(/Which chart do you mean\?/)
    expect(syms(m.board, 'cl')).toEqual([])
    expect(syms(m.board, 'cr')).toEqual([])
  })
})

describe('four charts — sets and positions', () => {
  let m
  beforeEach(() => { m = p.mount(...FOUR()) })
  const all = ['c0', 'c1', 'c2', 'c3']

  it('"compare with … on all charts": the QQQ chart cannot compare against itself, so that request is refused whole (nothing written); "… DIA on all charts" lands on every chart with ONE Undo', async () => {
    // the QQQ chart cannot compare against itself: the whole change is refused, nothing is written (all or nothing)
    const before = all.map(id => snap(csOf(m.board, id).comparisonSymbols))
    const out = await m.say('compare with QQQ on all charts')
    expect(out).toMatch(/already shows QQQ/)
    expect(all.map(id => snap(csOf(m.board, id).comparisonSymbols))).toEqual(before)
    await m.say('compare with DIA on all charts')
    await waitFor(() => { for (const id of all) expect(syms(m.board, id), id).toEqual(['DIA']) })
    await m.say('undo')
    await waitFor(() => { for (const id of all) expect(syms(m.board, id), id).toEqual([]) })
  })

  it('"clear all comparisons on the bottom right chart" — that chart only', async () => {
    for (const id of all) seed(m.board, id, { comparisonSymbols: [C('DIA')] })
    await m.say('clear all comparisons on the bottom right chart')
    await waitFor(() => expect(syms(m.board, 'c3')).toEqual([]))
    for (const id of ['c0', 'c1', 'c2']) expect(syms(m.board, id), id).toEqual(['DIA'])
    expect(p.turns()).toBe(0)
  })
})

describe('Compare Rotation / Overlay view (compare.openView) — instant, through the product\'s own door', () => {
  // ChartsWorkspace's compare state answering the REAL `uct:compare-open` event (as agentComparePanel.test.jsx)
  function workspace() {
    const w = { open: false, tab: null, intent: null, events: [], closes: 0 }
    const onOpen = (e) => {
      w.events.push(e.detail); w.intent = e.detail
      const d = e.detail || {}
      if (!w.open) { w.open = true; w.tab = d.tab === 'rotation' ? 'rotation' : 'overlay' } else if (d.tab) w.tab = d.tab
    }
    window.addEventListener(COMPARE_OPEN_EVENT, onOpen)
    w.off = () => window.removeEventListener(COMPARE_OPEN_EVENT, onOpen)
    w.source = compareAgentSource(() => ({ mobile: false, grid: false, open: w.open, tab: w.tab, intent: w.intent,
      hasChart: () => true, percentOn: () => false, close: () => { w.closes += 1; w.open = false; w.tab = null; w.intent = null } }))
    return w
  }
  let w
  afterEach(() => w?.off())
  it('"open the rotation map for NVDA\'s sector" → Rotation with that pick, read back; Undo closes it; "go to the overlay tab"', async () => {
    const m = p.mount(...ONE('NVDA'))
    w = workspace()
    m.h.compare = w.source
    const out = await m.say('open the rotation map for NVDA\'s sector')
    expect([w.open, w.tab]).toEqual([true, 'rotation'])
    expect({ sym: w.intent.sym, group: w.intent.group }).toEqual({ sym: 'NVDA', group: 'sector' })
    expect(out).toMatch(/Opened the Compare panel \(Tools → Compare Symbols\) on its Rotation tab, showing NVDA's sector/)
    expect(p.turns()).toBe(0)
    await m.say('undo')
    expect(w.open).toBe(false)
    await m.say('open compare symbols')
    expect([w.open, w.tab]).toEqual([true, 'overlay'])
    await m.say('switch to the rotation tab')
    expect(w.tab).toBe('rotation')
    expect(p.turns()).toBe(0)
    expect(screen.getAllByTestId('agent-receipt').length).toBeGreaterThan(0)
  }, 40000)
})

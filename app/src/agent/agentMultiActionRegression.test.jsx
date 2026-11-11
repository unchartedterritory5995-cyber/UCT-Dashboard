// HOTFIX 2026-11-03 — the owner's live multi-action regressions (production 0aeac8cfdb, v1 planner), through the REAL
// panel (AgentPanel + useAgent + registry, routing, planner, policy, runtime, receipts and Undo) and the REAL board
// writer (fixture board). Stand-in: the Agent model (/api/agent/turn), scripted per test. No paid model call.
//   T1  "Create a new chart for NVDA on the daily timeframe, then add a second chart for QQQ." — the receipt names
//       what changed and never says "Already Daily" about charts that did not exist yet
//   T2  "Change the NVDA chart to the weekly timeframe, then undo that change." + conversational Undo phrasings — the
//       receipt's own Undo (doUndo), never a model claim; agent.undo is in the manifest, always routed
//   T3  "Put SPY, QQQ, NVDA, and TSLA on four charts, all the same size." — routed to the grid, read as ONE chart grid
//       (no add + change-existing refusal), and a tab stand-in plan never runs
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { makeBoard } from './__fixtures__/board'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { selectGroups, routeManifest, wordsSelect } from './routing'
import { fastParse } from './fastPath'
import { planCompound } from './compound'
import { multiChartPlan } from './multiChart'
import { manifestFor, getCapability, MANIFEST_CONTRACT } from './capabilities'
import { AuthContext } from '../context/AuthContext'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'
import { continuesTabs } from './useAgent'

registerBuiltins()

let envelopes, calls, saveFails
const env = (disposition, ops, reply = '') => ({ disposition, reply, question: null, ops, unsupported_category: null })
beforeEach(() => {
  envelopes = []; calls = []; saveFails = false
  try { localStorage.clear() } catch { /* */ }
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null
    calls.push([init.method || 'GET', String(url), body])
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
    if (url === '/api/agent/turn') { const e = envelopes.shift(); return json({ conversationId: 'ac_1', envelope: typeof e === 'function' ? e(body) : e, usage: { research_calls: 0, citations: [] } }) }
    if (url === '/api/agent/record') return json({ conversationId: 'ac_1' })
    const q = /ticker-search\?q=([^&]+)/.exec(String(url))
    if (q) return json({ results: [{ ticker: decodeURIComponent(q[1]).toUpperCase() }] })
    if (String(url).startsWith('/api/live-prices')) return json({})
    return json({ conversations: [] })
  })
})
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const turnBodies = () => calls.filter(c => c[1] === '/api/agent/turn').map(c => c[2])
const transcript = () => screen.getByTestId('agent-transcript').textContent
const receipts = () => screen.queryAllByTestId('agent-receipt')
const idle = () => waitFor(() => expect(screen.queryByTestId('agent-typing')).toBeNull(), { timeout: 10000 })

function mount(widgets, groupSyms, extra = {}) {
  const board = makeBoard(widgets, groupSyms)
  const base = board.host.charts
  const h = {
    ...board.host,
    charts: { ...base, canManageIndicators: () => true, canCreateIndicator: () => true, previewHost: () => null, selected: () => null },
    persist: async () => (saveFails ? { ok: false, reason: 'not-saved' } : { ok: true }),
    ...extra,
  }
  render(<AuthContext.Provider value={{ user: { id: 1, role: 'admin' } }}><AgentPanel host={h} onClose={() => {}} /></AuthContext.Provider>)
  const box = screen.getByLabelText('Message UCT Agent')
  const say = async (t) => { await idle(); fireEvent.change(box, { target: { value: t } }); fireEvent.keyDown(box, { key: 'Enter' }); await idle() }
  return { board, h, say }
}
const chartsOf = (board) => board.state.widgets.filter(w => w.type === 'chart').sort((a, b) => (a.y - b.y) || (a.x - b.x))
const symbolsOf = (board, h) => chartsOf(board).map(w => h.charts.read(w.id)?.symbol)
const settings = () => ({ settings: mergeChartSettings(null) })
// one chart on the left half (the rest of the board empty), and one chart filling the board
const HALF = () => [[{ id: 'c1', type: 'chart', x: 0, y: 0, w: 12, h: 20, color: 'A', opts: settings() }], { A: 'NVDA' }]
const FULL = () => [[{ id: 'c1', type: 'chart', x: 0, y: 0, w: 24, h: 20, color: 'A', opts: settings() }], { A: 'NVDA' }]
const ref = (b, key) => b.context[key][0].ref

// ═══ T3 ═══════════════════════════════════════════════════════════════════════════════════════════════
describe('T3 · "on four charts, all the same size"', () => {
  const T3 = 'Put SPY, QQQ, NVDA, and TSLA on four charts, all the same size.'
  it('routing: every multi-chart / equal-size phrasing the owner used routes the grid (equal sizing: the workspace group too)', () => {
    for (const m of [T3, 'put spy, qqq, nvda and tsla on four charts', 'Show 4 charts: SPY, QQQ, NVDA, TSLA', 'make all the charts the same size',
      'make them equal size', 'arrange the charts evenly', 'split the board into four charts',
      'Create four charts in a 2×2 grid: SPY, QQQ, NVDA, and TSLA, all on the daily timeframe.',
      'Create four charts for SPY, QQQ, NVDA and TSLA', 'two more charts with AMD and AVGO', 'tile the charts', 'equally sized charts for SPY and QQQ']) {
      expect(selectGroups(m).selected, m).toContain('chartGrid')
    }
    for (const m of [T3, 'make all the charts the same size', 'make them equal size', 'arrange the charts evenly', 'tile the charts', 'equally sized charts for SPY and QQQ'])
      expect(selectGroups(m).selected, m).toContain('workspace')
    expect(selectGroups('put NVDA and AMD side by side').selected).toContain('chartGrid')
    // agent.undo's own group: named by any Undo word
    for (const m of ['Undo the last change you made to my charts.', 'undo that', 'revert the timeframe change', 'Change the NVDA chart to the weekly timeframe, then undo that change.',
      'hmm could you maybe take back whatever you did to my nvda chart', 'put it back the way it was', 'roll back what you just did'])
      expect(selectGroups(m).selected, m).toContain('undo')
    expect(selectGroups('switch to weekly').selected).not.toContain('undo')
  })
  it('the owner\'s exact words are read deterministically as ONE chart grid (no model call)', () => {
    const board = makeBoard(...HALF())
    const r = multiChartPlan(T3, { host: board.host })
    expect(r?.kind).toBe('ops')
    expect(r.ops).toHaveLength(1)
    expect(r.ops[0]).toMatchObject({ action: 'chartGrid.set', args: { symbols: ['SPY', 'QQQ', 'NVDA', 'TSLA'] } })
  })
  it('the real panel: four equal charts on SPY, QQQ, NVDA, TSLA; one receipt; ONE Undo restores the board', async () => {
    const { board, h, say } = mount(...HALF())
    const before = JSON.stringify(board.state.widgets)
    await say(T3)
    await waitFor(() => expect(chartsOf(board)).toHaveLength(4), { timeout: 8000 })
    expect(symbolsOf(board, h)).toEqual(['SPY', 'QQQ', 'NVDA', 'TSLA'])
    expect(new Set(chartsOf(board).map(w => `${w.w}x${w.h}`)).size).toBe(1)          // all the same size
    expect(turnBodies()).toHaveLength(0)
    expect(transcript()).not.toMatch(/isn.t supported yet|in two steps/)
    await say('undo')
    await waitFor(() => expect(JSON.stringify(board.state.widgets)).toBe(before), { timeout: 8000 })
  }, 30000)
  it('the MODEL\'s shape (adds + tickers + widget.arrange on the board, with room to spare) is ONE grid change — never the add + change-existing refusal', async () => {
    const { board, h, say } = mount(...HALF())
    envelopes.push(b => env('apply', [
      ...[1, 2, 3, 4].map(n => ({ action: 'widget.add', target: ref(b, 'workspace'), args: { type: 'chart', as: `new${n}` } })),
      ...['SPY', 'QQQ', 'NVDA', 'TSLA'].map((s, i) => ({ action: 'chart.setSymbol', target: `new${i + 1}`, args: { symbol: s } })),
      { action: 'widget.arrange', target: ref(b, 'board'), args: { widgets: null, pattern: 'grid' } },
    ]))
    await say('Give me SPY, QQQ, NVDA, TSLA on their own charts and arrange them as a grid')
    await waitFor(() => expect(symbolsOf(board, h)).toEqual(expect.arrayContaining(['SPY', 'QQQ', 'NVDA', 'TSLA'])), { timeout: 8000 })
    expect(transcript()).not.toMatch(/Adding widgets and changing existing ones/)
  }, 30000)
  it('a TAB stand-in plan (live capture: the tickers as tabs of the one chart) never runs — said plainly, the chart untouched', async () => {
    const { h, say } = mount(...FULL())
    envelopes.push(b => env('apply', [
      { action: 'chart.setSymbol', target: b.context.charts[0].ref, args: { symbol: 'SPY' } },
      { action: 'chart.addTab', target: ref(b, 'board'), args: { widget: 'c1', timeframe: null, name: 'QQQ' } },
    ], 'Done'))
    await say('Put SPY and QQQ on two charts please, thank you kindly friend')
    await waitFor(() => expect(transcript()).toMatch(/a chart tab, which you didn’t ask for/))
    expect(h.charts.read('c1').symbol).toBe('NVDA')
    expect(receipts()).toHaveLength(0)
  }, 30000)
  // ⛔ DELIBERATE CHANGE (Multi Chart task, 2026-11-05): the guard used to refuse this continuation because the sentence has
  // no word "tab". A tab added by the last change means the follow-up carries the tab on, so the same action now runs.
  it('"and a weekly one" right after a tab was added continues that request: the follow-up runs, without the word "tab"', async () => {
    const { board, say } = mount(...FULL())
    envelopes.push(b => env('apply', [{ action: 'chart.addTab', target: ref(b, 'board'), args: { widget: 'c1', timeframe: 'D', name: 'Daily' } }]))
    await say('give this chart another tab called Daily please, thanks a lot')
    await waitFor(() => expect(receipts()).toHaveLength(1))
    envelopes.push(b => env('apply', [{ action: 'chart.addTab', target: ref(b, 'board'), args: { widget: 'c1', timeframe: 'W', name: 'Weekly' } }]))
    await say('and a weekly one')
    await waitFor(() => expect(receipts()).toHaveLength(2))
    expect(transcript()).not.toMatch(/a chart tab, which you didn’t ask for/)
    expect(JSON.stringify(board.state.widgets.find(w => w.id === 'c1').opts)).toMatch(/Weekly/)
  }, 30000)
  const REFUSED = /a chart tab, which you didn’t ask for/
  const tabOn = (widget) => (b) => env('apply', [{ action: 'chart.addTab', target: ref(b, 'board'), args: { widget, timeframe: 'W', name: 'Weekly' } }])
  const firstTab = async (say) => {
    envelopes.push(b => env('apply', [{ action: 'chart.addTab', target: ref(b, 'board'), args: { widget: 'c1', timeframe: 'D', name: 'Daily' } }]))
    await say('give this chart another tab called Daily please, thanks a lot')
    await waitFor(() => expect(receipts()).toHaveLength(1))
  }
  it('the four-charts request right after a tab was added is still refused: the 11-03 hotfix\'s case, a tab just before it', async () => {
    const { h, say } = mount(...FULL())
    await firstTab(say)
    envelopes.push(b => env('apply', [
      { action: 'chart.addTab', target: ref(b, 'board'), args: { widget: 'c1', timeframe: null, name: 'SPY' } },
      { action: 'chart.addTab', target: ref(b, 'board'), args: { widget: 'c1', timeframe: null, name: 'QQQ' } },
      { action: 'chart.addTab', target: ref(b, 'board'), args: { widget: 'c1', timeframe: null, name: 'NVDA' } },
      { action: 'chart.addTab', target: ref(b, 'board'), args: { widget: 'c1', timeframe: null, name: 'TSLA' } },
    ], 'Done'))
    await say('Put SPY, QQQ, NVDA, and TSLA on four charts please, thank you kindly friend')
    await waitFor(() => expect(transcript()).toMatch(REFUSED))
    expect(receipts()).toHaveLength(1)
    expect(h.charts.read('c1').symbol).toBe('NVDA')
  }, 30000)
  it('a short request is no follow-up once another message came between', async () => {
    const { say } = mount(...FULL())
    await firstTab(say)
    envelopes.push(env('answer', [], 'It is a daily chart.'))
    await say('what timeframe is that tab anyway my friend, just curious')
    await waitFor(() => expect(transcript()).toMatch(/It is a daily chart/))
    envelopes.push(tabOn('c1'))
    await say('and a weekly one')
    await waitFor(() => expect(transcript()).toMatch(REFUSED))
    expect(receipts()).toHaveLength(1)
  }, 30000)
  it('the follow-up must be on the same widget', () => {
    const last = { id: 4, ops: [{ action: 'chart.addTab', args: { widget: 'c1' } }] }
    const op = (widget, action = 'chart.addTab') => ({ action, args: { widget } })
    expect(continuesTabs([op('c1')], last, 5, 'and a weekly one')).toBe(true)
    expect(continuesTabs([op('c2')], last, 5, 'and a weekly one')).toBe(false)
    expect(continuesTabs([op('c1', 'widget.addTab')], last, 5, 'and a weekly one')).toBe(false)
    expect(continuesTabs([op('c1')], last, 6, 'and a weekly one')).toBe(false)
    expect(continuesTabs([op('c1')], last, 5, 'and could you also add a weekly one here')).toBe(false)
    expect(continuesTabs([op('c1')], last, 5, 'and two more charts')).toBe(false)
    expect(continuesTabs([op('c1'), { action: 'chart.setSymbol', args: {} }], last, 5, 'and a weekly one')).toBe(false)
    expect(continuesTabs([op('c1')], null, 5, 'and a weekly one')).toBe(false)
  })
  it('a tab the last change did NOT add is still refused when the member never said "tab"', async () => {
    const { h, say } = mount(...FULL())
    envelopes.push(b => env('apply', [{ action: 'chart.setTimeframe', target: b.context.charts[0].ref, args: { timeframe: 'W' } }]))
    await say('put this chart on the weekly timeframe for me please')
    await waitFor(() => expect(receipts()).toHaveLength(1))
    envelopes.push(b => env('apply', [{ action: 'chart.addTab', target: ref(b, 'board'), args: { widget: 'c1', timeframe: 'D', name: 'Daily' } }]))
    await say('and a daily one over here as well if you could')
    await waitFor(() => expect(transcript()).toMatch(/a chart tab, which you didn’t ask for/))
    expect(h.charts.read('c1').tf).toBe('W')
  }, 30000)
  it('a tab the member DID ask for still runs (the guard reads the member\'s own word "tab")', async () => {
    const { board, say } = mount(...FULL())
    envelopes.push(b => env('apply', [{ action: 'chart.addTab', target: ref(b, 'board'), args: { widget: 'c1', timeframe: null, name: 'Swing' } }]))
    await say('give this chart another tab called Swing please, thanks a lot')
    await waitFor(() => expect(receipts()).toHaveLength(1))
    expect(transcript()).not.toMatch(/a chart tab, which you didn’t ask for/)
    expect(JSON.stringify(board.state.widgets.find(w => w.id === 'c1').opts)).toMatch(/Swing/)
  }, 30000)
})

// ═══ T1 ═══════════════════════════════════════════════════════════════════════════════════════════════
describe('T1 · "a new chart for NVDA on the daily timeframe, then a second chart for QQQ"', () => {
  it('both charts born on their tickers; the receipt names them and never says "Already Daily" about charts that did not exist', async () => {
    const { board, h, say } = mount(...HALF())
    envelopes.push(b => env('apply', [
      { action: 'widget.add', target: ref(b, 'workspace'), args: { type: 'chart', as: 'new1' } },
      { action: 'chart.setSymbol', target: 'new1', args: { symbol: 'NVDA' } },
      { action: 'chart.setTimeframe', target: 'new1', args: { timeframe: 'D' } },
      { action: 'widget.add', target: ref(b, 'workspace'), args: { type: 'chart', as: 'new2' } },
      { action: 'chart.setSymbol', target: 'new2', args: { symbol: 'QQQ' } },
      { action: 'chart.setTimeframe', target: 'new2', args: { timeframe: 'D' } },
    ]))
    await say('Create a new chart for NVDA on the daily timeframe, then add a second chart for QQQ.')
    await waitFor(() => expect(chartsOf(board)).toHaveLength(3), { timeout: 8000 })
    expect(symbolsOf(board, h).slice(1).sort()).toEqual(['NVDA', 'QQQ'])
    await waitFor(() => expect(receipts()).toHaveLength(1))
    const t = receipts()[0].textContent
    expect(screen.getByTestId('agent-receipt-summary').textContent).toBe('Done — added 2 daily charts for NVDA and QQQ.')   // W2: with each new chart's timeframe
    expect(t).not.toMatch(/Already Daily/)
    expect(t).toMatch(/NVDA/)
    expect(t).toMatch(/QQQ/)
  }, 30000)
})

// ═══ T2 / Undo ════════════════════════════════════════════════════════════════════════════════════════
describe('T2 · conversational Undo — the receipt\'s own Undo, never a claim', () => {
  it('agent.undo is a registered planner action in the manifest (executed only by the browser)', () => {
    expect(getCapability('agent.undo')).toBeTruthy()
    expect(manifestFor({ surface: 'charts' }).map(a => a.name)).toContain('agent.undo')
  })
  it('the deterministic Undo words tolerate qualifiers', () => {
    for (const t of ['undo that', 'Undo the last change you made to my charts.', 'undo what you just did', 'please undo your last change', 'can you undo that for me?', 'undo the change you just made', 'roll back the last change'])
      expect(fastParse(t), t).toMatchObject({ kind: 'undo' })
    expect(fastParse('revert the timeframe change')).toEqual({ kind: 'undo', about: 'timeframe' })
    expect(fastParse('undo the timeframe change you just made to my chart')).toEqual({ kind: 'undo', about: 'timeframe' })
    expect(fastParse('undo the 50 ema')).toBeNull()
  })
  for (const phrase of ['undo that', 'Undo the last change you made to my charts.', 'revert the timeframe change']) {
    it(`"${phrase}" after a weekly switch: back to daily, through Undo, no model call`, async () => {
      const { h, say } = mount(...FULL())
      await say('weekly')
      await waitFor(() => expect(h.charts.read('c1').tf).toBe('W'))
      await say(phrase)
      await waitFor(() => expect(h.charts.read('c1').tf).toBe('D'))
      expect(turnBodies()).toHaveLength(0)
    }, 30000)
  }
  it('"Change the NVDA chart to the weekly timeframe, then undo that change." → the change, then its Undo', async () => {
    const { board, h, say } = mount(...FULL())
    expect(planCompound('Change the NVDA chart to the weekly timeframe, then undo that change.', { host: board.host })?.steps?.map(s => s.kind)).toEqual(['fast', 'undo'])
    await say('Change the NVDA chart to the weekly timeframe, then undo that change.')
    await waitFor(() => expect(transcript()).toMatch(/All 2 steps done/), { timeout: 8000 })
    expect(h.charts.read('c1').tf).toBe('D')
    expect(turnBodies()).toHaveLength(0)
  }, 30000)
  it('"switch to weekly, then undo it" — the same', async () => {
    const { h, say } = mount(...FULL())
    await say('switch to weekly, then undo it')
    await waitFor(() => expect(transcript()).toMatch(/All 2 steps done/), { timeout: 8000 })
    expect(h.charts.read('c1').tf).toBe('D')
  }, 30000)
  it('the MODEL plans agent.undo alone → doUndo; its own words are never shown as the outcome', async () => {
    const { h, say } = mount(...FULL())
    await say('weekly')
    await waitFor(() => expect(h.charts.read('c1').tf).toBe('W'))
    envelopes.push(b => env('apply', [{ action: 'agent.undo', target: ref(b, 'agent'), args: { scope: 'last', about: null } }], 'Undid it for you!'))
    await say('hmm could you maybe take back whatever you did to my nvda chart')
    await waitFor(() => expect(h.charts.read('c1').tf).toBe('D'))
    expect(transcript()).not.toMatch(/Undid it for you/)
    expect(turnBodies()[0].capabilities.map(a => a.name)).toContain('agent.undo')
  }, 30000)
  it('the MODEL plans change + agent.undo LAST → the change, then the Undo of exactly that change', async () => {
    const { h, say } = mount(...FULL())
    envelopes.push(b => env('apply', [
      { action: 'chart.setTimeframe', target: b.context.charts[0].ref, args: { timeframe: 'W' } },
      { action: 'agent.undo', target: ref(b, 'agent'), args: { scope: 'last', about: null } },
    ], 'Switched to weekly and reverted it.'))
    await say('change NVDA to weekly then undo it')
    await waitFor(() => expect(receipts().length).toBeGreaterThanOrEqual(2), { timeout: 8000 })
    expect(h.charts.read('c1').tf).toBe('D')
    expect(transcript()).not.toMatch(/reverted it\./)
  }, 30000)
  it('nothing to undo → said plainly; never a claimed Undo', async () => {
    const { say } = mount(...FULL())
    envelopes.push(b => env('apply', [{ action: 'agent.undo', target: ref(b, 'agent'), args: { scope: 'last', about: null } }], 'Done, undone.'))
    await say('could you take back whatever you did to my chart earlier')
    await waitFor(() => expect(transcript()).toMatch(/nothing of mine to undo/))
    expect(transcript()).not.toMatch(/Done, undone/)
  }, 30000)
  it('a planned change that is already in place + agent.undo → nothing undone, said plainly', async () => {
    const { h, say } = mount(...FULL())
    envelopes.push(b => env('apply', [
      { action: 'chart.setTimeframe', target: b.context.charts[0].ref, args: { timeframe: 'D' } },
      { action: 'agent.undo', target: ref(b, 'agent'), args: { scope: 'last', about: null } },
    ]))
    await say('set my nvda chart over to the daily and afterwards revert what you did there')
    await waitFor(() => expect(transcript()).toMatch(/I didn’t undo anything/), { timeout: 8000 })
    expect(h.charts.read('c1').tf).toBe('D')
  }, 30000)
})

// ═══ review of #766 (F1–F6) ═══════════════════════════════════════════════════════════════════════════
const FULLM = manifestFor({ surface: 'charts', createIndicator: true })
const LIM = { limit: MANIFEST_CONTRACT.limits.maxCapabilities, budget: MANIFEST_CONTRACT.routingThreshold }
const names = (r) => r.manifest.map(c => c.name)
const without = (xs) => xs.filter(n => n !== 'agent.undo').sort()
describe('review F1 · Undo words never narrow routing', () => {
  // an unrecognised message is routed exactly as master routed it (same as any other unrecognised words) — plus agent.undo
  it('"put it back the way it was" / "how do I undo in UCT?" keep the routing the same words get without the Undo word, plus agent.undo', () => {
    for (const [m, plain] of [['put it back the way it was', 'zzz the way it was'], ['how do I undo in UCT?', 'how do I zzz in UCT?']]) {
      const r = routeManifest(FULLM, m, LIM)
      expect(names(r), m).toContain('agent.undo')
      expect(without(names(r)), m).toEqual(without(names(routeManifest(FULLM, plain, LIM))))
    }
    // the unrecognised one is NOT narrowed to the Undo (master sent the full-budget fill)
    expect(names(routeManifest(FULLM, 'put it back the way it was', LIM)).length).toBeGreaterThan(40)
  })
  it('"take me back to the dashboard", "roll back my layout to yesterday", "reverse the order of my watchlist" carry no Undo', () => {
    // (an unrecognised message's full-budget fill may still carry the one-action group as filler, like any other group)
    for (const m of ['take me back to the dashboard', 'roll back my layout to yesterday', 'reverse the order of my watchlist']) expect(wordsSelect('undo', m), m).toBe(false)
    for (const m of ['roll back my layout to yesterday', 'reverse the order of my watchlist']) expect(names(routeManifest(FULLM, m, LIM)), m).not.toContain('agent.undo')
    for (const m of ['roll back my layout to yesterday', 'reverse the order of my watchlist']) expect(selectGroups(m).selected, m).not.toContain('undo')
    expect(names(routeManifest(FULLM, 'take me back to the dashboard', LIM)).length).toBeGreaterThan(40)
  })
  it('a recognised request with an Undo word keeps its own groups and adds the Undo', () => {
    const r = routeManifest(FULLM, 'Change the NVDA chart to the weekly timeframe, then undo that change.', LIM)
    expect(names(r)).toContain('agent.undo')
    expect(names(r)).toContain('chart.setTimeframe')
  })
})

describe('review F2 · a named target is the change\'s kind, never dropped', () => {
  it('reads layout / widgets / charts as the Undo\'s `about`', () => {
    expect(fastParse('undo the change you made to my layout')).toEqual({ kind: 'undo', about: 'layout' })
    expect(fastParse('undo what you did to my widgets')).toEqual({ kind: 'undo', about: 'widget' })
    expect(fastParse('Undo the last change you made to my charts.')).toEqual({ kind: 'undo', about: 'chart' })
    expect(fastParse('undo that')).toEqual({ kind: 'undo' })
  })
  it('"undo what you did to my layout" after a TIMEFRAME change undoes nothing and says what the last change was', async () => {
    const { h, say } = mount(...FULL())
    await say('weekly')
    await waitFor(() => expect(h.charts.read('c1').tf).toBe('W'))
    await say('undo what you did to my layout')
    await waitFor(() => expect(transcript()).toMatch(/My last change wasn't a layout change/))
    expect(h.charts.read('c1').tf).toBe('W')
  }, 30000)
  it('"undo the last change you made to my charts" after a chart GRID takes the grid back', async () => {
    const { board, say } = mount(...HALF())
    const before = JSON.stringify(board.state.widgets)
    await say('Put SPY, QQQ, NVDA, and TSLA on four charts, all the same size.')
    await waitFor(() => expect(chartsOf(board)).toHaveLength(4), { timeout: 8000 })
    await say('undo the last change you made to my charts')
    await waitFor(() => expect(JSON.stringify(board.state.widgets)).toBe(before), { timeout: 8000 })
  }, 30000)
})

describe('review F3–F6 · every sentence says what actually happened', () => {
  it('F3: Undo FIRST went through, the rest refused → the reply says the Undo happened, never "I didn’t change anything"', async () => {
    const { h, say } = mount(...FULL())
    await say('weekly')
    await waitFor(() => expect(h.charts.read('c1').tf).toBe('W'))
    envelopes.push(b => env('apply', [
      { action: 'agent.undo', target: ref(b, 'agent'), args: { scope: 'last', about: null } },
      { action: 'chart.addTab', target: ref(b, 'board'), args: { widget: 'c1', timeframe: null, name: 'QQQ' } },
    ]))
    await say('revert what you did and then put QQQ up as well please')
    await waitFor(() => expect(transcript()).toMatch(/I undid my earlier change \(above\), but I didn’t make the rest of your request/))
    expect(h.charts.read('c1').tf).toBe('D')
    expect(transcript()).not.toMatch(/I didn.t change anything/)
  }, 30000)
  it('F4: "X, then undo it" planned as a PROPOSAL is refused before anything runs — no card left to approve', async () => {
    const { h, say } = mount(...FULL())
    envelopes.push(b => env('propose', [
      { action: 'chart.setTimeframe', target: b.context.charts[0].ref, args: { timeframe: 'W' } },
      { action: 'agent.undo', target: ref(b, 'agent'), args: { scope: 'last', about: null } },
    ]))
    await say('change NVDA to weekly then undo it')
    await waitFor(() => expect(transcript()).toMatch(/can’t make it and undo it in one request/))
    expect(screen.queryAllByTestId('agent-proposal')).toHaveLength(0)
    await say('do it')
    await waitFor(() => expect(transcript()).toMatch(/no proposal waiting/))
    expect(h.charts.read('c1').tf).toBe('D')
  }, 30000)
  it('F4: an apply plan that the POLICY holds for approval (removing two widgets) + Undo last → the card is withdrawn, nothing runs', async () => {
    const three = [[
      { id: 'c1', type: 'chart', x: 0, y: 0, w: 8, h: 20, color: 'A', opts: settings() },
      { id: 'c2', type: 'chart', x: 8, y: 0, w: 8, h: 20, color: 'A', opts: settings() },
      { id: 'c3', type: 'chart', x: 16, y: 0, w: 8, h: 20, color: 'A', opts: settings() },
    ], { A: 'NVDA' }]
    const { board, say } = mount(...three)
    const before = JSON.stringify(board.state.widgets)
    envelopes.push(b => env('apply', [
      { action: 'widget.remove', target: ref(b, 'board'), args: { widget: 'c2' } },
      { action: 'widget.remove', target: ref(b, 'board'), args: { widget: 'c3' } },
      { action: 'agent.undo', target: ref(b, 'agent'), args: { scope: 'last', about: null } },
    ]))
    await say('close the middle and right charts, then undo that again')
    await waitFor(() => expect(transcript()).toMatch(/can’t make it and undo it in one request/), { timeout: 8000 })
    await say('do it')
    await waitFor(() => expect(transcript()).toMatch(/no proposal waiting/))
    expect(JSON.stringify(board.state.widgets)).toBe(before)
  }, 30000)
  it('F5: Undo FIRST put the board back but the save failed → said exactly so, the rest not made', async () => {
    const { board, h, say } = mount(...HALF(), { epoch: () => 1 })          // a board-bound Undo saves through host.persist
    const before = JSON.stringify(board.state.widgets)
    await say('Put SPY, QQQ, NVDA, and TSLA on four charts, all the same size.')
    await waitFor(() => expect(chartsOf(board)).toHaveLength(4), { timeout: 8000 })
    saveFails = true
    envelopes.push(b => env('apply', [
      { action: 'agent.undo', target: ref(b, 'agent'), args: { scope: 'last', about: null } },
      { action: 'chart.setTimeframe', target: b.context.charts[0].ref, args: { timeframe: 'W' } },
    ]))
    await say('revert what you did, and after that bump the first one up to the weekly')
    await waitFor(() => expect(transcript()).toMatch(/That Undo put things back but couldn’t be saved/), { timeout: 8000 })
    expect(JSON.stringify(board.state.widgets)).toBe(before)
    expect(transcript()).not.toMatch(/didn’t go through, I didn’t make/)
    expect(h.charts.read('c1').tf).not.toBe('W')
  }, 30000)
  it('F6: the tab guard never talks about separate charts ("open NVDA in the same chart")', async () => {
    const { say } = mount(...FULL())
    envelopes.push(b => env('apply', [{ action: 'chart.addTab', target: ref(b, 'board'), args: { widget: 'c1', timeframe: null, name: 'NVDA' } }]))
    await say('open NVDA in the same chart')
    await waitFor(() => expect(transcript()).toMatch(/a chart tab, which you didn’t ask for/))
    expect(transcript()).not.toMatch(/separate charts/)
  }, 30000)
})

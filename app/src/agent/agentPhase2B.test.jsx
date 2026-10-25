// UCT Agent — PHASE 2B: chart targeting on multi-chart boards, ambiguous references and routing
// (docs/agent/PHASE2-CHART-CONTROL-AUDIT.md §7 P2-B; owner decisions 4, 7 and 8, 2026-10-25).
// No paid model: the model is SCRIPTED through the real panel; every other check is deterministic.
//   F3   a MODEL plan changes only charts the member identified — else "Which chart?" or a proposal
//   F10  a change on several charts leaves no stale single subject
//   D4   "A and B side by side" never silently replaces existing charts
//   cnt  "all four charts" is checked against the charts UCT can reach
//   rt   "comparison" routes the chart actions; NL-1's exact Undo lane; "look like" is not a similarity search
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { getCapability, getTargetKind, manifestFor } from './capabilities'
import { makeBoard } from './__fixtures__/board'
import { NL1_KEY, exactLane } from './nl1/interpreter'
import { loadAgentConfig, _resetAgentConfig } from './agentClient'
import { screenUnnamedTargets, chartsNamedBy, pickedChoice } from './deixis'
import { createMemory } from './memory'
import { routeManifest } from './routing'
import { fastDiscovery } from './discovery'
import { buildChartSource } from './host'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'
registerBuiltins()

let turns, script, serverNl1
const answer = (o) => ({ conversationId: 'c1', envelope: { disposition: 'answer', reply: '', question: null, ops: [], unsupported_category: null, correction: null, ...o }, usage: {} })
beforeEach(() => {
  turns = []
  serverNl1 = { stream: false, nl1: true }
  script = () => answer({ reply: 'ok' })
  _resetAgentConfig()
  try { localStorage.clear() } catch { /* */ }
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } })
    const body = init.body ? JSON.parse(init.body) : null
    if (url === '/api/agent/turn' || url === '/api/agent/turn/stream') { turns.push(body); return json(script(body, turns.length)) }
    if (url === '/api/agent/record') return json({ conversationId: 'c1' })
    if (url === '/api/agent/config') return json(serverNl1)
    const q = /ticker-search\?q=([^&]+)/.exec(String(url))
    if (q) return json({ results: [{ ticker: decodeURIComponent(q[1]) }] })
    if (String(url).startsWith('/api/live-prices')) return json({})
    return json({ conversations: [] })
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const nl1On = async () => { localStorage.setItem(NL1_KEY, '1'); await loadAgentConfig() }
const legacy = async () => { serverNl1 = { stream: false, nl1: false }; await loadAgentConfig() }
const twoCharts = () => makeBoard([{ id: 'L', type: 'chart', x: 0, y: 0, w: 12, h: 20 }, { id: 'R', type: 'chart', x: 12, y: 0, w: 12, h: 20, color: 'B' }], { A: 'NVDA', B: 'AMD' })
const threeCharts = () => makeBoard([{ id: 'L', type: 'chart', x: 0, y: 0, w: 8, h: 20 }, { id: 'M', type: 'chart', x: 8, y: 0, w: 8, h: 20, color: 'B' }, { id: 'R', type: 'chart', x: 16, y: 0, w: 8, h: 20, color: 'C' }], { A: 'NVDA', B: 'AMD', C: 'TSLA' })
const tf = (b, id) => b.host.charts.read(id).tf
const sym = (b, id) => b.host.charts.read(id).symbol
const refOf = (body, id) => Object.entries(body.__refs || {}).find(([, v]) => v === id)?.[0]
  || body.context.charts.find(c => c.label === `Chart ${id}`)?.ref
const setTf = (body, id, timeframe) => answer({ disposition: 'apply', ops: [{ action: 'chart.setTimeframe', target: refOf(body, id), args: { timeframe } }] })

function mount(b) {
  render(<AgentPanel host={b.host} onClose={() => {}} />)
  const box = screen.getByLabelText('Message UCT Agent')
  const say = async (t) => {
    await waitFor(() => { expect(box.disabled).toBe(false); expect(document.querySelector('[data-testid=agent-typing]')).toBeNull() }, { timeout: 8000 })
    fireEvent.change(box, { target: { value: t } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(box.value).toBe(''), { timeout: 4000 })
    await waitFor(() => expect(document.querySelector('[data-testid=agent-typing]')).toBeNull(), { timeout: 8000 })
  }
  const transcript = () => screen.getByTestId('agent-transcript').textContent
  return { say, transcript }
}

// ── the rule, unit by unit ──────────────────────────────────────────────────────────────────────
describe('F3 — screenUnnamedTargets (deterministic)', () => {
  const op = (target) => ({ action: 'chart.setTimeframe', target, args: { timeframe: 'W' } })
  const screen3 = (b, ops, text, extra = {}) => screenUnnamedTargets({ host: b.host, ops, text, getTargetKind, getCapability, ...extra })

  it('one chart changed that the member did not identify → "Which chart?" with the charts as choices', () => {
    const r = screen3(twoCharts(), [op('R')], 'switch to weekly')
    expect(r.ask.text).toMatch(/Which chart do you mean/)
    expect(r.ask.choices.map(c => c.ref)).toEqual(['L', 'R'])
  })
  it('identified by a position word, by a symbol only that chart shows, by the click, or by a picked choice → runs', () => {
    const b = twoCharts()
    expect(screen3(b, [op('R')], 'switch the right one to weekly')).toBeNull()
    expect(screen3(b, [op('R')], 'make AMD weekly')).toBeNull()
    expect(screen3(b, [op('R')], 'weekly', { pickedRefs: ['R'] })).toBeNull()
    expect(screen3(b, [op('R')], 'Hide volume', { context: 'make the right chart cleaner' })).toBeNull()
    b.host.charts.selected = () => 'R'
    expect(screen3(b, [op('R')], 'switch to weekly')).toBeNull()                // the owner's bare-command rule
    expect(screen3(b, [op('L')], 'switch to weekly').ask).toBeTruthy()          // …but not a DIFFERENT chart
  })
  it('several charts changed and not all identified → only proposed, naming the charts', () => {
    const r = screen3(twoCharts(), [{ action: 'chart.setSymbol', target: 'L', args: { symbol: 'AAPL' } }, { action: 'chart.setSymbol', target: 'R', args: { symbol: 'TSLA' } }], 'show me AAPL and TSLA side by side')
    expect(r.propose).toBe(true)
    expect(r.note).toMatch(/Chart L.*Chart R|Left chart.*Right chart/)
  })
  it('"both" / "all four charts": a count the plan does not match is only proposed; "all charts" runs', () => {
    const b = threeCharts()
    expect(screen3(b, [op('L'), op('M'), op('R')], 'make all charts weekly')).toBeNull()
    expect(screen3(b, [op('L'), op('M'), op('R')], 'make all four charts weekly').propose).toBe(true)
    expect(screen3(b, [op('L'), op('M'), op('R')], 'make both weekly').propose).toBe(true)
    // "all" that is not a set of charts never switches the rule off
    expect(screen3(twoCharts(), [{ action: 'chart.compare', target: 'R', args: { add: [], remove: [], clear: true } }], 'remove all comparisons').ask).toBeTruthy()
  })
  it('a one-chart board, a query, or a chart the plan itself creates is never screened', () => {
    const one = makeBoard([{ id: 'L', type: 'chart', x: 0, y: 0, w: 24, h: 20 }], { A: 'NVDA' })
    expect(screen3(one, [op('L')], 'switch to weekly')).toBeNull()
    expect(screen3(twoCharts(), [{ action: 'indicator.list', target: 'ixe:R', args: {} }], 'what indicators are on there')).toBeNull()
  })
  it('chartsNamedBy: a short ticker counts only in capitals; a symbol on two charts names neither', () => {
    const charts = [{ ref: 'a', symbol: 'F', position: 'left' }, { ref: 'b', symbol: 'NVDA', position: 'right' }, { ref: 'c', symbol: 'NVDA', position: null }]
    expect([...chartsNamedBy('if you can', charts)]).toEqual([])
    expect([...chartsNamedBy('put rsi on F', charts)]).toEqual(['a'])
    expect([...chartsNamedBy('nvda weekly', charts)]).toEqual([])
  })
  it('pickedChoice: an exact label, a number or an ordinal — nothing looser', () => {
    const ch = [{ label: 'Left chart (NVDA)', ref: 'L' }, { label: 'Right chart (AMD)', ref: 'R' }]
    expect(pickedChoice('Right chart (AMD)', ch)).toBe('R')
    expect(pickedChoice('2', ch)).toBe('R')
    expect(pickedChoice('the first one', ch)).toBe('L')
    expect(pickedChoice('the amd one', ch)).toBeNull()
  })
})

describe('F10 — memory: a change on several charts leaves no stale subject', () => {
  it('"it" after a two-chart change is not the chart an earlier change left behind', () => {
    const m = createMemory()
    m.noteChange({ ops: [{ action: 'chart.setTimeframe', args: {}, target: 'L' }], epoch: null })
    expect(m.subject('chart').ref).toBe('L')
    m.noteChange({ ops: [{ action: 'chart.setTimeframe', args: {}, target: 'L' }, { action: 'chart.setTimeframe', args: {}, target: 'R' }], epoch: null })
    expect(m.subject('chart')).toBeNull()
  })
})

describe('routing, the exact lane and discovery', () => {
  it('legacy routing: "comparison" sends the chart actions (chart.compare), not only indicators', () => {
    const r = routeManifest(manifestFor({ surface: 'charts' }), 'Remove the comparison but keep my indicators', { limit: 60, budget: 55 })
    expect(r.manifest.some(c => c.name === 'chart.compare')).toBe(true)
  })
  it('NL-1: the plain Undo\'s whole-message wordings stay instant; anything looser is the model\'s', () => {
    for (const t of ['undo that last change', 'Undo my last change.', 'undo last change']) expect(exactLane(t)).toEqual({ kind: 'undo' })
    expect(exactLane('undo the last two changes')).toBeNull()
  })
  it('"make the left chart look like the right one" is not answered as a similar-charts search', () => {
    expect(fastDiscovery('can you make the left chart look like the right one?')?.topic).not.toBe('similarity')
    expect(fastDiscovery('can you find charts similar to this one?')?.topic).toBe('similarity')
  })
  it('unreachableCount: a chart widget\'s inactive chart tab and an unmounted chart are counted', () => {
    const widgets = [
      { id: 'w1', type: 'chart', x: 0, y: 0, w: 12, h: 20, opts: { tf: 'D', chartTabs: [{ id: 't2', tf: '5' }] } },
      { id: 'w2', type: 'chart', x: 12, y: 0, w: 12, h: 20, opts: { tf: 'D' } },
    ]
    const api = { agent: { read: () => ({ chartId: 'w1', symbol: 'NVDA', tf: 'D', cs: {}, stored: null }) } }
    const src = buildChartSource({ chartApiById: { current: new Map([['w1', api]]) }, getWidgets: () => widgets })
    expect(src.list()).toHaveLength(1)
    expect(src.unreachableCount()).toBe(2)                 // w1's inactive tab + w2 (no adapter)
  })
})

// ── through the real panel ──────────────────────────────────────────────────────────────────────
describe('F3 through the panel — NL-1 on', () => {
  it('"switch to weekly" on two charts, nothing clicked: the model\'s pick does NOT run — "Which chart?"; the member\'s pick resumes the plan', async () => {
    await nl1On()
    const b = twoCharts()
    const { say, transcript } = mount(b)
    script = (body) => setTf(body, 'R', 'W')
    await say('switch to weekly')
    await waitFor(() => expect(transcript()).toMatch(/Which chart do you mean/))
    expect(tf(b, 'R')).toBe('D')
    expect(tf(b, 'L')).toBe('D')
    fireEvent.click(screen.getByRole('button', { name: /^Chart R$/ }))
    await waitFor(() => expect(tf(b, 'R')).toBe('W'))
    expect(tf(b, 'L')).toBe('D')
    expect(turns).toHaveLength(1)                          // the pick resumed the plan: no second model call
  })

  it('D4: "show me AAPL and TSLA side by side" — replacing both charts is only PROPOSED; "do it" applies it', async () => {
    await nl1On()
    const b = twoCharts()
    const { say, transcript } = mount(b)
    script = (body) => answer({ disposition: 'apply', ops: [
      { action: 'chart.setSymbol', target: refOf(body, 'L'), args: { symbol: 'AAPL' } },
      { action: 'chart.setSymbol', target: refOf(body, 'R'), args: { symbol: 'TSLA' } }] })
    await say('show me AAPL and TSLA side by side')
    await waitFor(() => expect(transcript()).toMatch(/I wasn't sure you meant/))
    expect(sym(b, 'L')).toBe('NVDA')
    expect(sym(b, 'R')).toBe('AMD')
    await say('do it')
    await waitFor(() => { expect(sym(b, 'L')).toBe('AAPL'); expect(sym(b, 'R')).toBe('TSLA') })
  })

  it('a correction the guard holds for approval reverses NOTHING first', async () => {
    await nl1On()
    const b = twoCharts()
    const { say, transcript } = mount(b)
    script = (body, n) => (n === 1 ? setTf(body, 'L', '5') : answer({ disposition: 'apply', correction: { replaces: 'last_change' }, ops: [
      { action: 'chart.setTimeframe', target: refOf(body, 'L'), args: { timeframe: '15' } },
      { action: 'chart.setTimeframe', target: refOf(body, 'R'), args: { timeframe: '15' } }] }))
    await say('make the left chart 5 minutes')
    await waitFor(() => expect(tf(b, 'L')).toBe('5'))
    await say('no I meant 15')
    await waitFor(() => expect(transcript()).toMatch(/didn't reverse my earlier change/))
    expect(tf(b, 'L')).toBe('5')
    expect(tf(b, 'R')).toBe('D')
  })
})

describe('F3 through the panel — legacy (NL-1 off)', () => {
  it('a model-path command on two charts with nothing identified asks; a named chart runs at once', async () => {
    await legacy()
    const b = twoCharts()
    const { say, transcript } = mount(b)
    script = (body) => setTf(body, 'R', 'W')
    await say('I would like a weekly view please')
    await waitFor(() => expect(transcript()).toMatch(/Which chart do you mean/))
    expect(tf(b, 'R')).toBe('D')
    expect(turns).toHaveLength(1)
    await say('I would like the AMD chart on a weekly view please')
    await waitFor(() => expect(tf(b, 'R')).toBe('W'))
  })

  it('"change all four charts to daily" with three charts: asked, nothing changed; "all charts" runs on the three', async () => {
    await legacy()
    const b = threeCharts()
    const { say, transcript } = mount(b)
    await say('change all four charts to weekly')
    await waitFor(() => expect(transcript()).toMatch(/I can reach 3 charts here, not 4/))
    expect(['L', 'M', 'R'].map(id => tf(b, id))).toEqual(['D', 'D', 'D'])
    await say('change all charts to weekly')
    await waitFor(() => expect(['L', 'M', 'R'].map(id => tf(b, id))).toEqual(['W', 'W', 'W']))
    expect(turns).toHaveLength(0)
  })
})

// POST-RELEASE REGRESSION (owner production test, 2026-10-13 00:11–00:18 ET, prod 0bd6621548).
// Root cause of every failure that night: the model account was out of credit (HTTP 400 "credit balance
// is too low" on every model call, Agent and indicator builder alike). Two things made it visible where
// it should not have been, and both are pinned here:
//   1 · follow-ups and "below" wording that UCT can answer itself went to the model at all;
//   2 · a model failure reached chat as "(BadRequestError)" / "(model:transport) — nothing changed.) —
//       nothing was left changed".
// The owner's EXACT phrases, in the owner's order. Scripted model + synthetic breadth; no network.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor, cleanup } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { registerBuiltins } from './builtins'
import { _resetBreadthSubject, _resetBreadthDates, breadthFast } from './capabilities/breadth'
import { breadthHistoryFast } from './capabilities/breadthHistory'
import { refusalSentence, BUILDER_DOWN, BUILDER_DOWN_GATES } from './capabilities/indicatorAuthoring'
import { makeBoard } from './__fixtures__/board'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { parseFormula } from '../components/chart/engine/ast/parse'
import { AuthContext } from '../context/AuthContext'
import { setCreateIndicatorFlag, CREATE_INDICATOR_FLAG_KEY } from '../components/chart/builder/studio/createIndicatorFlag'
import { setAuthoringSources, _resetAuthoring } from './capabilities/indicatorAuthoring'
import { storeConversation } from '../components/chart/builder/conversationSave'
import { _simulateReload, STORAGE_KEY } from '../components/chart/builder/authoring/conversationSessions'
import { _resetDraftPreview, AUTHORING_REASONS as AR } from '../components/chart/builder/agentAuthoring'
import { _resetIndicatorEntry, peekAuthoringIntent } from './indicatorEntry'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'
registerBuiltins()

const PROVIDER_DOWN = "UCT Agent can't reach its AI service right now, so nothing was changed. Please try again shortly."
const NOISE = /BadRequestError|model:transport|\(model:|nothing was left changed|didn't take effect/

const show = (o) => ({ mode: 'value', universe: 'us', metrics: ['pct_above_50sma'], date: null, compare_date: null, start: null, end: null, basis: null, side: null, sessions: null, ...o })
const hist = (o) => ({ universe: 'us', metric: 'pct_above_200sma', aggregation: 'daily', start: null, end: null, op: 'below', level: 10, find: 'last', ...o })

// ═══ 1 · BREADTH — one panel session, the owner's words ═══════════════════════════════════════════
describe('breadth conversation (owner tests 1–6) — answered by UCT, never the model', () => {
  let turns, breadthBodies, historyBodies
  beforeEach(() => {
    turns = []; breadthBodies = []; historyBodies = []
    _resetBreadthDates(); _resetBreadthSubject()
    try { localStorage.clear() } catch { /* */ }
    globalThis.fetch = vi.fn(async (url, init = {}) => {
      const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
      const body = init.body ? JSON.parse(init.body) : null
      if (url === '/api/agent/turn') { turns.push(body); return json({ detail: PROVIDER_DOWN }, 503) }   // the account is out of credit
      if (url === '/api/agent/record') return json({ conversationId: 'c1' })
      if (url === '/api/agent/breadth') {
        breadthBodies.push(body)
        const below = body.side === 'below'
        return json({ status: 'ok', text: '…', table: null, present: { kind: 'value', value: below ? '73.8%' : '26.2%',
          label: `${body.universe.toUpperCase()} · % of Stocks ${below ? 'At or Below' : 'Above'} ${body.metrics[0].match(/\d+/)[0]}-Day MA`, note: 'Provisional close · Oct 12' } })
      }
      if (url === '/api/agent/breadth/history') {
        historyBodies.push(body)
        return json({ status: 'ok', text: '…', table: null, present: { kind: 'value', value: '2020-04-03', label: `${body.universe.toUpperCase()} · search`, note: 'Below 10.0% for 3 sessions.' } })
      }
      if (url === '/api/agent/breadth/dates') return json({ today_et: '2026-10-13', latest_finalized: { us: '2026-10-09', nyse: '2026-10-09', nasdaq: '2026-10-09' } })
      if (String(url).startsWith('/api/live-prices')) return json({})
      return json({ conversations: [] })
    })
  })
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  function mount() {
    const board = makeBoard([{ id: 'l', type: 'chart', x: 0, y: 0, w: 24, h: 20 }], { A: 'QQQ' })
    render(<AgentPanel host={board.host} onClose={() => {}} />)
    const box = screen.getByLabelText('Message UCT Agent')
    return async (t) => {
      await waitFor(() => { expect(box.disabled).toBe(false); expect(document.querySelector('[data-testid=agent-typing]')).toBeNull() }, { timeout: 8000 })
      fireEvent.change(box, { target: { value: t } })
      fireEvent.keyDown(box, { key: 'Enter' })
      await waitFor(() => expect(box.value).toBe(''), { timeout: 4000 })
    }
  }
  const transcript = () => screen.getByTestId('agent-transcript').textContent

  it('tests 1–3: A200 reading → "when was the last time that dropped below 10%" → "how long did it stay below 10%?"', async () => {
    const say = mount()
    await say('what percent of US stocks are above their 200sma')
    await waitFor(() => expect(breadthBodies).toHaveLength(1), { timeout: 8000 })
    expect(breadthBodies[0]).toEqual(show({ metrics: ['pct_above_200sma'] }))
    await say('when was the last time that dropped below 10%')
    await waitFor(() => expect(historyBodies).toHaveLength(1), { timeout: 8000 })
    expect(historyBodies[0]).toEqual(hist())
    // TEST 3 (failed in production: it went to the model) — the episode containing that search
    await say('how long did it stay below 10%?')
    await waitFor(() => expect(historyBodies).toHaveLength(2), { timeout: 8000 })
    expect(historyBodies[1]).toEqual(hist({ find: 'last_episode' }))
    expect(turns).toHaveLength(0)
    expect(transcript()).not.toMatch(NOISE)
  }, 40000)

  it('test 4: the three "below the 50sma" phrasings → the share AT OR BELOW, from the same measure', async () => {
    const say = mount()
    for (const q of ['what percent of US stocks below 50sma', 'what percent of us stocks are below 50sma', 'what % of us stocks are below the 50sma']) {
      const n = breadthBodies.length
      await say(q)
      await waitFor(() => expect(breadthBodies).toHaveLength(n + 1), { timeout: 8000 })
      expect(breadthBodies[n]).toEqual(show({ side: 'below', sessions: null }))
    }
    expect(turns).toHaveLength(0)
    expect(transcript()).toContain('US · % of Stocks At or Below 50-Day MA')
  }, 40000)

  it('tests 5–6 and the owner’s conversation: A50 → Nasdaq → below → fewer than 10% above → how long → NYSE', async () => {
    const say = mount()
    await say('what % of US stocks are above 50sma')
    await waitFor(() => expect(breadthBodies).toHaveLength(1), { timeout: 8000 })
    expect(breadthBodies[0]).toEqual(show())
    // TEST 6 (failed in production) — same measure and side, Nasdaq
    await say('what about the nasdaq')
    await waitFor(() => expect(breadthBodies).toHaveLength(2), { timeout: 8000 })
    expect(breadthBodies[1]).toEqual(show({ universe: 'nasdaq' }))
    await say('And how many are below it?')
    await waitFor(() => expect(breadthBodies).toHaveLength(3), { timeout: 8000 })
    expect(breadthBodies[2]).toEqual(show({ universe: 'nasdaq', side: 'below', sessions: null }))
    await say('what about NYSE?')                                       // the side is kept
    await waitFor(() => expect(breadthBodies).toHaveLength(4), { timeout: 8000 })
    expect(breadthBodies[3]).toEqual(show({ universe: 'nyse', side: 'below', sessions: null }))
    await say('and the 200 day?')                                       // the moving average changes, nothing else
    await waitFor(() => expect(breadthBodies).toHaveLength(5), { timeout: 8000 })
    expect(breadthBodies[4]).toEqual(show({ universe: 'nyse', metrics: ['pct_above_200sma'], side: 'below', sessions: null }))
    await say('When was the last time fewer than 10% were above?')
    await waitFor(() => expect(historyBodies).toHaveLength(1), { timeout: 8000 })
    expect(historyBodies[0]).toEqual(hist({ universe: 'nyse' }))
    await say('How long did that last?')
    await waitFor(() => expect(historyBodies).toHaveLength(2), { timeout: 8000 })
    expect(historyBodies[1]).toEqual(hist({ universe: 'nyse', find: 'last_episode' }))
    await say('what about the nasdaq')                                  // a SEARCH subject: the search re-runs
    await waitFor(() => expect(historyBodies).toHaveLength(3), { timeout: 8000 })
    expect(historyBodies[2]).toEqual(hist({ universe: 'nasdaq', find: 'last_episode' }))
    expect(turns).toHaveLength(0)
    expect(transcript()).not.toMatch(NOISE)
  }, 60000)

  it('a question UCT cannot answer itself goes to the model; a model outage is ONE plain sentence', async () => {
    const say = mount()
    await say('why is breadth so weak today')
    await waitFor(() => expect(turns).toHaveLength(1), { timeout: 8000 })
    await waitFor(() => expect(transcript()).toContain(PROVIDER_DOWN), { timeout: 8000 })
    expect(transcript()).not.toMatch(NOISE)
  }, 20000)
})

// ═══ 2 · the deterministic grammar — switches, synonyms, inverse thresholds ════════════════════════
describe('breadth wording — exact args (no model)', () => {
  beforeEach(() => { _resetBreadthSubject(); _resetBreadthDates() })
  const reading = (q) => breadthFast(q)
  const remember = (q) => {                     // what answerBreadth / answerHistory remember (names only)
    const a = breadthFast(q)
    if (a) return import('./capabilities/breadth').then(m => m.rememberBreadthSubject({ kind: 'show', universe: a.universe, metric: a.metrics.length === 1 ? a.metrics[0] : null, show: a }))
    const h = breadthHistoryFast(q)
    return import('./capabilities/breadth').then(m => m.rememberBreadthSubject({ kind: 'history', universe: h.universe, metric: h.metric, history: h }))
  }

  it.each([
    ['what % of nasdaq stocks are under the 200 day', show({ universe: 'nasdaq', metrics: ['pct_above_200sma'], side: 'below', sessions: null })],
    ['what percentage of NYSE stocks are not above their 50-day moving average', show({ universe: 'nyse', side: 'below', sessions: null })],
    ['% of stocks over the 50sma', show()],
    ['what share of us stocks are below the 20 day', show({ metrics: ['pct_above_20sma'], side: 'below', sessions: null })],
  ])('%s', (q, want) => { expect(reading(q)).toEqual(want) })

  it('below at the close keeps the basis; an unsupported period is the model’s', () => {
    expect(reading('what % of us stocks were below the 50 day at the close')).toEqual(show({ side: 'below', basis: 'close' }))
    expect(reading('what % of us stocks are below the 30 day')).toBeNull()
  })

  it('follow-ups need a subject; with none they are left to the model', () => {
    expect(reading('what about the nasdaq')).toBeNull()
    expect(reading('and how many are below it')).toBeNull()
    expect(breadthHistoryFast('how long did it stay below 10%')).toBeNull()
    expect(reading('nasdaq')).toBeNull()                              // a bare universe word never switches
  })

  it('switches keep everything else: universe, MA, side', async () => {
    await remember('what % of us stocks are below the 50sma')
    expect(reading('how about the nyse')).toEqual(show({ universe: 'nyse', side: 'below', sessions: null }))
    expect(reading('what about the 200sma')).toEqual(show({ metrics: ['pct_above_200sma'], side: 'below', sessions: null }))
    expect(reading('what about the 30 day')).toBeNull()               // not a UCT measure
    expect(reading('what % are above it')).toEqual(show())
    expect(reading('what about 2022')).toBeNull()                     // a year, not a moving average
    expect(reading('nasdaq')).toBeNull()                              // a bare universe word, even with a subject
    expect(reading('the nyse')).toBeNull()
  })

  it('inverse thresholds: a condition on the share at or below = the complement condition on % above', async () => {
    // "more than 90% below" ⇔ % above < 10 (strict ⇔ strict); "at least 90% below" ⇔ % above ≤ 10
    expect(breadthHistoryFast('when was the last time more than 90% of us stocks were below the 200sma')).toEqual(hist())
    expect(breadthHistoryFast('when was the last time at least 90% of stocks were below the 200 day')).toEqual(hist({ op: 'at_or_below' }))
    expect(breadthHistoryFast('when was the first time fewer than 5% of nasdaq stocks were below the 50 day')).toEqual(
      hist({ universe: 'nasdaq', metric: 'pct_above_50sma', op: 'above', level: 95, find: 'first' }))
    expect(breadthHistoryFast('when was the last time fewer than 10% of stocks were above the 200sma')).toEqual(hist())
    expect(breadthHistoryFast('when was the last time more than 90% were above the 50 dma')).toEqual(hist({ metric: 'pct_above_50sma', op: 'above', level: 90 }))
    // "that" = a BELOW reading: the threshold is said about the share at or below
    await remember('what % of us stocks are below the 200sma')
    expect(breadthHistoryFast('when was the last time that was above 90%')).toEqual(hist())
    expect(breadthHistoryFast('how long did it stay above 90%')).toEqual(hist({ find: 'last_episode' }))
  })

  it('"how long" after a crossing search asks about the side it crossed to; with no condition anywhere → the model', async () => {
    await remember('when did the us 200sma last cross below 20%')
    expect(breadthHistoryFast('how long did it stay there')).toEqual(hist({ level: 20, find: 'last_episode' }))
    // a windowed search keeps its window: the episode is looked for where the search looked
    await remember('how many times has us a200 fallen below 20% since 2010')
    expect(breadthHistoryFast('how long did that last')).toEqual(hist({ level: 20, start: '2010-01-01', find: 'last_episode' }))
    _resetBreadthSubject()
    await remember('what % of us stocks are above the 200sma')
    expect(breadthHistoryFast('how long did that last')).toBeNull()
  })
})

// ═══ 3 · INDICATORS — the builder's model failure (owner tests 7–8) ═══════════════════════════════
const PATCH = 'uct.authoring.patch/1'
const P = (src) => { const r = parseFormula(src); if (!r.ok) throw new Error(src); return r.ast }
let converseMode, converseCalls, turnBodies, turnMode
function converse({ message, state }) {
  converseCalls.push(message)
  if (converseMode === 'down') return { ok: false, gate: 'model:transport', reason: 'the formula assistant could not be reached' }
  return { ok: true, disposition: 'change', turn: 'patch', reply: '',
    envelope: { contract: PATCH, baseRevision: state.revision, assumptions: [], disposition: 'change',
      ops: [{ op: 'create', name: 'Inside candles', placement: 'price', outputs: [{ key: 'ib', label: 'Inside bar', tree: P('high < high[1] && low > low[1]') }] },
        { op: 'set_color_states', channel: 'barcolor', states: [{ when: P('high < high[1] && low > low[1]'), color: '#ffffff' }], otherwise: '#787b86' }] } }
}
function makeHost(refs) {
  const store = Object.fromEntries(refs.map(r => [r, null]))
  const read = (ref) => (ref in store ? { ref, label: `Chart (${ref})`, position: null, symbol: 'QQQ', tf: 'D', stored: store[ref], cs: mergeChartSettings(store[ref] || {}), linkedCount: 0 } : null)
  return {
    charts: {
      list: () => Object.keys(store).map(read), read,
      commit: (ref, patch) => { store[ref] = patch.settings; return true },
      canManageIndicators: () => true, canCreateIndicator: () => true, openCreateIndicator: () => ({ ok: true }),
      openIndicatorDoor: () => true,
      previewHost: () => ({ showAuthoringPreview: () => ({ ok: true }), clearAuthoringPreview: () => true }),
    },
    otherWidgets: () => [],
  }
}

describe('indicator builder unavailable (owner tests 7–8) — one short, true sentence', () => {
  beforeEach(() => {
    converseMode = 'down'; converseCalls = []; turnBodies = []; turnMode = 'down'
    _resetIndicatorEntry(); _simulateReload()
    try { sessionStorage.removeItem(STORAGE_KEY) } catch { /* */ }
    try { localStorage.clear() } catch { /* */ }
    _resetAuthoring(); _resetDraftPreview()
    act(() => { setCreateIndicatorFlag(true) })
    setAuthoringSources({ extra: { converse, readBack: async () => null, store: (s, o) => storeConversation(s, { ...o, save: async () => ({ ok: false }) }) } })
    globalThis.fetch = vi.fn(async (url, init) => {
      const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
      if (url === '/api/agent/turn') {
        const b = JSON.parse(init.body); turnBodies.push(b)
        if (turnMode === 'down') return json({ detail: PROVIDER_DOWN }, 503)
        const ref = (b.context.indicatorDrafts || []).find(d => d.new)?.ref || 'draft:new'
        const chart = b.context.charts?.[0]?.ref || null
        return json({ conversationId: 'ac_1', turnId: 1, envelope: { disposition: 'apply', reply: '', question: null, unsupported_category: null,
          ops: [{ action: 'indicator.draft', target: ref, args: { message: b.message, chart, edit: null } }] } })
      }
      if (url === '/api/agent/record') return json({ conversationId: 'ac_1' })
      if (String(url).startsWith('/api/agent/conversations')) return json({ conversations: [] })
      if (String(url).startsWith('/api/user-definitions')) return json({ definitions: [] })
      return json({})
    })
  })
  afterEach(() => { cleanup(); vi.restoreAllMocks(); try { localStorage.removeItem(CREATE_INDICATOR_FLAG_KEY) } catch { /* */ } })

  const mount = (host, request) => render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <AuthContext.Provider value={{ isPaid: true, user: { id: 1, role: 'admin' }, loading: false }}>
        <AgentPanel host={host} request={request} onClose={() => {}} />
      </AuthContext.Provider>
    </SWRConfig>)
  const type = (text) => {
    const box = screen.getByLabelText('Message UCT Agent')
    fireEvent.change(box, { target: { value: text } })
    fireEvent.keyDown(box, { key: 'Enter' })
  }
  const transcript = () => screen.getByTestId('agent-transcript').textContent

  it('test 8: "What indicator would you like to build?" → "color every inside candle white" → builder down', async () => {
    mount(makeHost(['c1']), { id: 1, chartRef: 'c1', defId: null, name: null })
    await screen.findByText('What indicator would you like to build?')
    await act(async () => { type('color every inside candle white') })
    await waitFor(() => expect(converseCalls).toEqual(['color every inside candle white']))
    await waitFor(() => expect(transcript()).toContain(BUILDER_DOWN), { timeout: 8000 })
    expect(transcript()).not.toMatch(NOISE)
    expect((transcript().match(/nothing was saved/g) || []).length).toBe(1)        // said once, never wrapped
    expect(peekAuthoringIntent()).toBeNull()                                         // the question is answered
    // the NEXT message is an ordinary Agent turn, not another builder attempt
    await waitFor(() => expect(screen.getByLabelText('Message UCT Agent').disabled).toBe(false))
    await act(async () => { type('what is an inside candle?') })
    await waitFor(() => expect(turnBodies).toHaveLength(1))
    expect(converseCalls).toHaveLength(1)
  })

  it('test 7: a direct request while the Agent’s model is down → one plain sentence, nothing built', async () => {
    mount(makeHost(['c1']), null)
    await act(async () => { type('I want to create an indicator that colors all inside candles white.') })
    await waitFor(() => expect(turnBodies).toHaveLength(1))
    await waitFor(() => expect(transcript()).toContain(PROVIDER_DOWN), { timeout: 8000 })
    expect(converseCalls).toHaveLength(0)
    expect(transcript()).not.toMatch(NOISE)
  })

  it('test 7 with the model healthy: a draft, one short line, "Want me to apply it" — nothing written to the chart', async () => {
    turnMode = 'up'; converseMode = 'up'
    const host = makeHost(['c1'])
    mount(host, null)
    await act(async () => { type('I want to create an indicator that colors all inside candles white.') })
    await waitFor(() => expect(converseCalls).toHaveLength(1), { timeout: 8000 })
    await waitFor(() => expect(transcript()).toMatch(/Draft ready \(not saved yet\).*Want me to apply it/), { timeout: 8000 })
    expect(host.charts.list().every(c => c.stored == null)).toBe(true)
    expect(screen.queryAllByTestId('agent-proposal')).toHaveLength(0)
    expect(transcript()).not.toMatch(/high\[1\]|&&|barcolor/)                          // no formula dump
  })
})

describe('refusalSentence — gate codes stay out of chat', () => {
  const s = (gate) => refusalSentence({ ok: false, reason: AR.TURN_REFUSED, detail: { gate } })
  it('the builder-down set (transport today, a future provider gate) and network faults → BUILDER_DOWN', () => {
    expect([...BUILDER_DOWN_GATES]).toEqual(['model:transport', 'model:unavailable'])
    for (const g of ['model:transport', 'model:unavailable', 'network', 'http:500', 'http:503']) expect(s(g)).toBe(BUILDER_DOWN)
  })
  it('limits keep their own sentences; anything else names no code', () => {
    expect(s('http:429')).toMatch(/hourly limit/)
    expect(s('rate:busy')).toMatch(/still working/)
    expect(s('cost:user')).toMatch(/allowance is used up/)
    expect(s('schema:node')).toBe('The indicator builder couldn’t do that — nothing was saved.')
    expect(s('')).not.toMatch(/\(|:/)
  })
})

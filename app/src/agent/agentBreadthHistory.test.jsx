// BREADTH HISTORY (2026-10-12 owner project): "When was the last time that was below 10%?" is searched
// in UCT's finalized daily history (Market Intelligence breadth_events), never refused and never sent
// to the web. The obvious wording — and its follow-ups — is planned deterministically (no model call),
// through the same planner / runtime, as a LOCAL-ONLY row. Scripted routes, no network.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { getCapability, manifestFor } from './capabilities'
import { breadthHistoryFast, HISTORY_OPS, HISTORY_FINDS } from './capabilities/breadthHistory'
import { rememberBreadthSubject, _resetBreadthSubject, _resetBreadthDates, BREADTH_METRICS, breadthFast } from './capabilities/breadth'
import { selectGroups } from './routing'
import { fastParse } from './fastPath'
import { makeBoard } from './__fixtures__/board'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'
registerBuiltins()

const H = (universe, metric, op, level, find, extra = {}) => ({ universe, metric, aggregation: 'daily', start: null, end: null, op, level, find, ...extra })
const SHOW_A200 = { mode: 'value', universe: 'us', metrics: ['pct_above_200sma'], date: null, compare_date: null, start: null, end: null, basis: null, side: null, sessions: null }

describe('the capability: local-only, closed args, one detector (MI)', () => {
  it('breadth.history is a localOnly QUERY with a closed schema inside the manifest limits', () => {
    const cap = getCapability('breadth.history')
    expect(cap.query).toBe(true)
    expect(cap.localOnly).toBe(true)
    const entry = manifestFor({ surface: 'charts', createIndicator: true }).find(c => c.name === 'breadth.history')
    expect(entry.args.properties.op.enum).toEqual(HISTORY_OPS)
    expect(entry.args.properties.find.enum).toEqual(HISTORY_FINDS)
    expect(entry.args.properties.metric.enum).toEqual(BREADTH_METRICS)
    expect(entry.args.properties.aggregation.enum).toEqual(['daily'])
    expect(entry.summary).toMatch(/Never say UCT lacks historical breadth/)
    expect(Object.keys(entry)).not.toContain('localOnly')
  })
})

describe('deterministic wording (no model call)', () => {
  beforeEach(() => { _resetBreadthSubject() })
  it.each([
    ['When did Nasdaq:A50 last cross above 50%?', H('nasdaq', 'pct_above_50sma', 'crosses_above', 50, 'last')],
    ['How many times has US:A200 fallen below 20% since 2010?', H('us', 'pct_above_200sma', 'below', 20, 'count', { start: '2010-01-01' })],
    ['when was us a200 last below 10%', H('us', 'pct_above_200sma', 'below', 10, 'last')],
    ['When was the first time the 50 day ma was above 90%?', H('us', 'pct_above_50sma', 'above', 90, 'first')],
    ['when was the last time nyse a200 was at or below 10%', H('nyse', 'pct_above_200sma', 'at_or_below', 10, 'last')],
    ['When did the nasdaq 200sma last cross below 20%?', H('nasdaq', 'pct_above_200sma', 'crosses_below', 20, 'last')],
  ])('%s', (q, args) => { expect(breadthHistoryFast(q)).toEqual(args) })

  it('"that" / "it" resolve to the member\'s last breadth request — and to nothing when there is none', () => {
    expect(breadthHistoryFast('When was the last time that was below 10%?')).toBeNull()        // nothing to refer to → the model
    rememberBreadthSubject({ kind: 'show', universe: 'us', metric: 'pct_above_200sma', show: SHOW_A200 })
    expect(breadthHistoryFast('When was the last time that was below 10%?')).toEqual(H('us', 'pct_above_200sma', 'below', 10, 'last'))
    expect(breadthHistoryFast('How long did the last below-10% episode last?')).toEqual(H('us', 'pct_above_200sma', 'below', 10, 'last_episode'))
    expect(breadthHistoryFast('how many times has it fallen below 20% since 2010')).toEqual(H('us', 'pct_above_200sma', 'below', 20, 'count', { start: '2010-01-01' }))
  })

  it('"same thing for Nasdaq" and "what about 2022?" re-run the last SEARCH with one thing changed', () => {
    rememberBreadthSubject({ kind: 'history', universe: 'us', metric: 'pct_above_200sma', history: H('us', 'pct_above_200sma', 'below', 10, 'last') })
    expect(breadthHistoryFast('same thing for Nasdaq')).toEqual(H('nasdaq', 'pct_above_200sma', 'below', 10, 'last'))
    expect(breadthHistoryFast('what about 2022?')).toEqual(H('us', 'pct_above_200sma', 'below', 10, 'last', { start: '2022-01-01', end: '2022-12-31' }))
  })

  it.each([
    'when was the last time NVDA was below $100',          // a stock, not breadth
    'when was the last time that was below 10% and what is NVDA doing',
    'when did breadth last bottom',                         // no condition → the model
    'what was the highest reading for US:A200 during the 2022 bear market', // a period to resolve → the model
    'when was the last time the 30 day ma was below 10%',   // no such measure
  ])('%s → the model', (q) => {
    rememberBreadthSubject({ kind: 'show', universe: 'us', metric: 'pct_above_200sma', show: SHOW_A200 })
    expect(breadthHistoryFast(q)).toBeNull()
  })

  it('a misspelled search is NEVER answered on a guessed reading (fastCorrect: false) — the model plans it', () => {
    rememberBreadthSubject({ kind: 'show', universe: 'us', metric: 'pct_above_200sma', show: SHOW_A200 })
    expect(fastParse('When was the last time that was below 10%?')?.ops?.[0]?.action).toBe('breadth.history')
    for (const q of ['When was the last tiem that was below 10%?', 'when was the lsat time that was belwo 10%']) {
      expect(fastParse(q)).toBeNull()
    }
  })

  it('history wording routes to the breadth group even without breadth words', () => {
    for (const q of ['When did Nasdaq:A50 last cross above 50%?', 'how often has US:A200 been below 20%?', 'what was the lowest NYSE:A200 reading in 2022?']) {
      expect(selectGroups(q).priority).toContain('breadth')
    }
    // a bare follow-up rides on the last action
    expect(selectGroups('When was the last time that was below 10%?', { recentActions: ['breadth.show'] }).priority).toContain('breadth')
  })
})

describe('lowest / highest in a year → breadth.show series (MI\'s own range summary)', () => {
  it.each([
    ['What was the lowest NYSE:A200 reading in 2022?', 'nyse', 'pct_above_200sma', '2022'],
    ['highest us 200sma in 2020', 'us', 'pct_above_200sma', '2020'],
    ['lowest nasdaq a50 in 2022', 'nasdaq', 'pct_above_50sma', '2022'],
  ])('%s', (q, universe, metric, y) => {
    expect(breadthFast(q)).toEqual({ mode: 'series', universe, metrics: [metric], date: null, compare_date: null,
      start: `${y}-01-01`, end: `${y}-12-31`, basis: null, side: null, sessions: null })
  })
  it('a named period that is not a calendar year is the model\'s (it asks for the dates)', () => {
    expect(breadthFast('What was the highest reading for US:A200 during the 2022 bear market?')).toBeNull()
    expect(breadthHistoryFast('What was the highest reading for US:A200 during the 2022 bear market?')).toBeNull()
  })
})

describe('THE production conversation, through the panel', () => {
  let turns, records, breadthBodies, historyBodies
  beforeEach(() => {
    turns = []; records = []; breadthBodies = []; historyBodies = []
    _resetBreadthDates(); _resetBreadthSubject()
    try { localStorage.clear() } catch { /* */ }
    globalThis.fetch = vi.fn(async (url, init = {}) => {
      const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
      const body = init.body ? JSON.parse(init.body) : null
      if (url === '/api/agent/turn') { turns.push(body); return json({ conversationId: 'c1', envelope: { disposition: 'answer', reply: 'model', question: null, ops: [], unsupported_category: null }, usage: {} }) }
      if (url === '/api/agent/record') { records.push(body); return json({ conversationId: 'c1' }) }
      if (url === '/api/agent/breadth') {
        breadthBodies.push(body)
        return json({ status: 'ok', text: 'US · % Above 200-Day MA …', table: null, present: { kind: 'value', value: '11.1%', label: 'US · % of Stocks Above 200-Day MA', note: 'Provisional close · Oct 12' } })
      }
      if (url === '/api/agent/breadth/history') {
        historyBodies.push(body)
        return json({ status: 'ok', text: 'US % above 200-day was last below 10% on 2020-03-23 (finalized daily closes since 2008-01-02).', table: null,
          present: { kind: 'text', text: 'Last below 10%: 2020-03-23.', source: 'Finalized daily closes, US Breadth V2, searched 2008-01-02 – 2026-10-09.' } })
      }
      if (url === '/api/agent/breadth/dates') return json({ today_et: '2026-10-12', latest_finalized: { us: '2026-10-09', nyse: '2026-10-09', nasdaq: '2026-10-09' } })
      if (String(url).startsWith('/api/live-prices')) return json({})
      return json({ conversations: [] })
    })
  })
  afterEach(() => { vi.restoreAllMocks() })
  const mount = () => {
    const board = makeBoard([{ id: 'c1', type: 'chart', x: 0, y: 0, w: 12, h: 20 }], { A: 'AAPL' })
    render(<AgentPanel host={board.host} onClose={() => {}} />)
    const box = screen.getByLabelText('Message UCT Agent')
    return async (t) => { await waitFor(() => expect(box.disabled).toBe(false), { timeout: 6000 }); fireEvent.change(box, { target: { value: t } }); fireEvent.keyDown(box, { key: 'Enter' }) }
  }
  const results = () => screen.queryAllByTestId('agent-result')

  it('reading → "When was the last time that was below 10%?" → searched, answered, no model, no refusal', async () => {
    const say = mount()
    await say('What percent of US stocks are above the 200sma?')
    await waitFor(() => expect(results()).toHaveLength(1), { timeout: 6000 })
    expect(breadthBodies).toEqual([SHOW_A200])
    await say('When was the last time that was below 10%?')
    await waitFor(() => expect(results()).toHaveLength(2), { timeout: 6000 })
    expect(historyBodies).toEqual([H('us', 'pct_above_200sma', 'below', 10, 'last')])
    expect(turns).toHaveLength(0)                                                     // no model call at all
    expect(results()[1].textContent).toContain('2020-03-23')
    expect(document.body.textContent).not.toMatch(/no access to historical|scroll (through )?the chart/i)
    // the follow-ups keep the subject
    await say('How long did the last below-10% episode last?')
    await say('same thing for Nasdaq')
    await waitFor(() => expect(historyBodies).toHaveLength(3), { timeout: 6000 })
    expect(historyBodies[1]).toEqual(H('us', 'pct_above_200sma', 'below', 10, 'last_episode'))
    expect(historyBodies[2]).toEqual(H('nasdaq', 'pct_above_200sma', 'below', 10, 'last_episode'))
    expect(turns).toHaveLength(0)
    // ⛔ every result row is LOCAL — the server replays a value-free note, never the dates or values
    await waitFor(() => expect(records.filter(r => r.outcomeData?.local)).toHaveLength(4), { timeout: 6000 })
    for (const r of records.filter(x => x.outcomeData?.local)) {
      expect(r.outcomeData.actions[0]).toMatch(/^breadth\.(show|history)$/)
      expect(JSON.stringify(r.outcomeData.requests)).not.toMatch(/2020-03-23|11\.1/)
    }
  })

  it('UCT universe: the honest local answer, no server search', async () => {
    const say = mount()
    await say('when was uct a200 last below 10%')
    await waitFor(() => expect(results()).toHaveLength(1), { timeout: 6000 })
    expect(historyBodies).toHaveLength(0)
    expect(results()[0].textContent).toMatch(/Breadth page/)
  })
})

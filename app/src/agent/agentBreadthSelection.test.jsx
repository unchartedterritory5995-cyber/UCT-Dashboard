// BREADTH SELECTION — the owner's three 2026-10-13 failures, at the browser (owner audit; D5 amended).
// Each went to the model and landed on a finalized-only path. Now each is planned deterministically, with
// no model call, into the one selection policy (api/services/uct_agent/breadth_select.py):
//   F1 "…at or below their 50-day…"         → a reading on the share at or below (side below)
//   F2 "…at the October 12, 2026 close?"    → a reading ON that date (finalized, else a labelled
//                                             provisional close, else refused — never another date)
//   F3 "…history for the last 30 trading days" → the last 30 sessions (mode rows), never a threshold search
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { breadthFast, splitDate, loadBreadthDates, _resetBreadthDates, _resetBreadthSubject, rememberBreadthSubject } from './capabilities/breadth'
import { breadthHistoryFast } from './capabilities/breadthHistory'
import { makeBoard } from './__fixtures__/board'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'
registerBuiltins()

const F1 = 'What percentage of Nasdaq stocks are at or below their 50-day moving average?'
const F2 = 'What was the percentage of US stocks above their 50-day moving average at the October 12, 2026 close?'
const F3 = 'Show me the US 50-day breadth history for the last 30 trading days.'
const show = (o) => ({ mode: 'value', universe: 'us', metrics: ['pct_above_50sma'], date: null, compare_date: null, start: null, end: null, basis: null, side: null, sessions: null, ...o })
const rows = (o) => show({ mode: 'rows', ...o })

let turns, breadthBodies, historyBodies
beforeEach(async () => {
  turns = []; breadthBodies = []; historyBodies = []
  _resetBreadthDates(); _resetBreadthSubject()
  try { localStorage.clear() } catch { /* */ }
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
    const body = init.body ? JSON.parse(init.body) : null
    if (url === '/api/agent/turn') { turns.push(body); return json({ detail: 'no model here' }, 503) }
    if (url === '/api/agent/record') return json({ conversationId: 'c1' })
    if (url === '/api/agent/breadth') {
      breadthBodies.push(body)
      if (body.mode === 'rows') {
        return json({ status: 'ok', text: '…', present: { kind: 'table', text: 'US · last 30 sessions',
          table: { columns: [{ key: 'session', label: 'Session' }, { key: 'value', label: 'Value' }, { key: 'status', label: 'Status' }],
            rows: [{ session: '2026-10-12', value: '1.0%', status: 'Provisional close' }, { session: '2026-10-09', value: '1.0%', status: 'Finalized' }] } },
          table: null, chart: { symbol: 'US:A50', label: 'US:A50' } })
      }
      return json({ status: 'ok', text: '…', table: null, present: { kind: 'value', value: '1.0%', label: 'x', note: 'Provisional close · Oct 12. Not finalized yet.' } })
    }
    if (url === '/api/agent/breadth/history') { historyBodies.push(body); return json({ status: 'ok', text: '…', table: null }) }
    if (url === '/api/agent/breadth/dates') return json({ today_et: '2026-10-13', latest_finalized: { us: '2026-10-09', nyse: '2026-10-09', nasdaq: '2026-10-09' } })
    if (String(url).startsWith('/api/live-prices')) return json({})
    return json({ conversations: [] })
  })
  await loadBreadthDates()
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('the three exact questions — deterministic args', () => {
  it('F1 at or below → a reading on the share at or below (present tense, not a close)', () => {
    expect(breadthFast(F1)).toEqual(show({ universe: 'nasdaq', side: 'below' }))
  })
  it('F2 a dated close → the reading on that date', () => {
    expect(breadthFast(F2)).toEqual(show({ date: '2026-10-12' }))
  })
  it('F3 the last 30 trading days → the last 30 sessions (rows), never breadth.history', () => {
    expect(breadthFast(F3)).toEqual(rows({ sessions: 30 }))
    expect(breadthHistoryFast(F3)).toBeNull()
  })
})

describe('wording variants', () => {
  it.each([
    ['what % of us stocks are above the 50 day on Oct 12', show({ date: '2026-10-12' })],
    ['% of nyse stocks above the 200 day as of 10/12/2026', show({ universe: 'nyse', metrics: ['pct_above_200sma'], date: '2026-10-12' })],
    ['what % of nasdaq stocks were below the 50sma at the close on october 9', show({ universe: 'nasdaq', side: 'below', date: '2026-10-09' })],
    ['what % of us stocks are at or under their 200 day', show({ metrics: ['pct_above_200sma'], side: 'below' })],
    ['nasdaq a200 for the last 10 sessions', rows({ universe: 'nasdaq', metrics: ['pct_above_200sma'], sessions: 10 })],
    ['% of us stocks above the 50 day over the past 20 trading sessions', rows({ sessions: 20 })],
    ['what % of nyse stocks are below the 50 sma for the last 5 trading days', rows({ universe: 'nyse', side: 'below', sessions: 5 })],
  ])('%s', (q, want) => { expect(breadthFast(q)).toEqual(want) })

  it.each([
    'what % of us stocks are above the 50 day on october 20',          // after today → the model asks
    'what % of us stocks are above the 50 day on february 30',         // not a date
    'what % of us stocks are above the 50 day on 13/40/2026',
    'show me the us 50-day breadth history for the last 300 trading days',   // more than 250 rows
    'show me the us 50-day breadth for the last 30 days',              // calendar days are not sessions → the model
    'what % of us stocks are above the 30 day on oct 12',              // not a UCT measure
  ])('left to the model: %s', (q) => { expect(breadthFast(q)).toBeNull() })

  it('splitDate never infers an earlier year for a future month', () => {
    expect(splitDate('x on december 1')).toEqual({ rest: 'x', date: null })
    expect(splitDate('x on 10/12/26')).toEqual({ rest: 'x', date: '2026-10-12' })
  })

  it('follow-ups on a session list keep it a list: universe, MA and side switch', () => {
    rememberBreadthSubject({ kind: 'show', universe: 'us', metric: 'pct_above_50sma', show: breadthFast(F3) })
    expect(breadthFast('what about the nasdaq')).toEqual(rows({ universe: 'nasdaq', sessions: 30 }))
    expect(breadthFast('and the 200 day')).toEqual(rows({ metrics: ['pct_above_200sma'], sessions: 30 }))
    expect(breadthFast('and how many are below it')).toEqual(rows({ side: 'below', sessions: 30 }))
  })

  it('threshold searches still go to breadth.history (separate capability)', () => {
    expect(breadthHistoryFast('when was the last time us a50 was below 10%')).toMatchObject({ metric: 'pct_above_50sma', op: 'below', level: 10, find: 'last' })
    expect(breadthFast('when was the last time us a50 was below 10%')).toBeNull()
  })
})

describe('through the panel — no model, one request each, fast', () => {
  it('F1 → F2 → F3: zero model calls, exactly one request each, the session list renders as a table with Open chart', async () => {
    const board = makeBoard([{ id: 'l', type: 'chart', x: 0, y: 0, w: 8, h: 20 }], { A: 'QQQ' })
    render(<AgentPanel host={board.host} onClose={() => {}} />)
    const box = screen.getByLabelText('Message UCT Agent')
    const ms = []
    for (const q of [F1, F2, F3]) {
      await waitFor(() => { expect(box.disabled).toBe(false); expect(document.querySelector('[data-testid=agent-typing]')).toBeNull() }, { timeout: 8000 })
      const n = screen.queryAllByTestId('agent-result').length
      const t = performance.now()
      fireEvent.change(box, { target: { value: q } })
      fireEvent.keyDown(box, { key: 'Enter' })
      await waitFor(() => expect(screen.queryAllByTestId('agent-result')).toHaveLength(n + 1), { timeout: 8000, interval: 2 })
      ms.push(Math.round(performance.now() - t))
    }
    expect(turns).toHaveLength(0)
    expect(historyBodies).toHaveLength(0)                                      // F3 is not a threshold search
    expect(breadthBodies.map(b => [b.mode, b.universe, b.side, b.date, b.sessions])).toEqual([
      ['value', 'nasdaq', 'below', null, null], ['value', 'us', null, '2026-10-12', null], ['rows', 'us', null, null, 30]])
    const table = screen.queryAllByTestId('agent-result').at(-1)
    expect(table.getAttribute('data-kind')).toBe('table')
    expect(table.textContent).toMatch(/Provisional close/)
    expect(Math.max(...ms)).toBeLessThan(300)
  }, 30000)
})

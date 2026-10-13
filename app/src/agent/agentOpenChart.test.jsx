// OPEN CHART on Agent metric cards (owner 2026-10-13). The card carries a TYPED target set by the
// capability from what it answered (a ticker; a PUBLISHED breadth series from the server's registry) —
// never read from the card's words. Opening runs the EXISTING widget.addCharts op: one new chart born
// on that series, unlinked, nothing existing changes, receipt + Undo. A series already on the board is
// left as it is. "% at or below" has no published series → no action (never the opposite measure).
// Owner's four-question sequence included: deterministic, zero model calls, no duplicate requests.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { _resetBreadthSubject, _resetBreadthDates } from './capabilities/breadth'
import { presentOf, chartTarget } from './present'
import AgentResult from './AgentResult'
import { makeBoard } from './__fixtures__/board'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'
registerBuiltins()

// the server's registry: published series per (universe, measure); "below" never has one
const SERIES = { 'us:pct_above_50sma': 'US:A50', 'nasdaq:pct_above_50sma': 'NASDAQ:A50', 'nasdaq:pct_above_200sma': 'NASDAQ:A200', 'nyse:pct_above_200sma': 'NYSE:A200' }
const VALUES = { 'us:pct_above_50sma': 26.2, 'nasdaq:pct_above_50sma': 24.7, 'nasdaq:pct_above_200sma': 38.6 }
let turns, breadthBodies, searches, profileCalls, historyBodies
beforeEach(() => {
  turns = []; breadthBodies = []; searches = []; profileCalls = []; historyBodies = []
  _resetBreadthDates(); _resetBreadthSubject()
  try { localStorage.clear() } catch { /* */ }
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
    const body = init.body ? JSON.parse(init.body) : null
    const u = String(url)
    if (u === '/api/agent/turn') { turns.push(body); return json({ detail: 'no model in this test' }, 503) }
    if (u === '/api/agent/record') return json({ conversationId: 'c1' })
    if (u === '/api/agent/breadth') {
      breadthBodies.push(body)
      const k = `${body.universe}:${body.metrics[0]}`
      const below = body.side === 'below'
      const v = below ? (100 - VALUES[k]).toFixed(1) : VALUES[k].toFixed(1)
      const ma = body.metrics[0].match(/\d+/)[0]
      return json({ status: 'ok', text: '…', table: null,
        present: { kind: 'value', value: `${v}%`, label: `${body.universe.toUpperCase()} · % of Stocks ${below ? 'At or Below' : 'Above'} ${ma}-Day MA`, note: 'Provisional close · Oct 12' },
        ...(!below && SERIES[k] ? { chart: { symbol: SERIES[k], label: SERIES[k] } } : {}) })
    }
    if (u === '/api/agent/breadth/history') {
      historyBodies.push(body)
      return json({ status: 'ok', text: '…', table: null, present: { kind: 'value', value: '2020-04-03', label: 'search', note: 'x' },
        chart: { symbol: SERIES[`${body.universe}:${body.metric}`], label: SERIES[`${body.universe}:${body.metric}`] } })
    }
    if (u === '/api/agent/breadth/dates') return json({ today_et: '2026-10-13', latest_finalized: { us: '2026-10-09', nyse: '2026-10-09', nasdaq: '2026-10-09' } })
    if (u.startsWith('/api/ticker-search')) {
      const q = decodeURIComponent(u.split('q=')[1].split('&')[0]).toUpperCase()
      searches.push(q)
      const known = !q.includes('GONE') && (Object.values(SERIES).includes(q) || ['NVDA', 'QQQ', 'SPY'].includes(q))
      return json({ results: known ? [{ ticker: q }] : [] })
    }
    if (u.startsWith('/api/live-prices')) return json({})
    return json({ conversations: [] })
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

// two charts with free space beside them (a FULL board is its own case below)
const TWO = [{ id: 'l', type: 'chart', x: 0, y: 0, w: 8, h: 20 }, { id: 'r', type: 'chart', x: 8, y: 0, w: 8, h: 20 }]
function mount(widgets = TWO, syms = { A: 'NVDA' }) {
  const board = makeBoard(widgets, syms)
  render(<AgentPanel host={board.host} onClose={() => {}} />)
  const box = screen.getByLabelText('Message UCT Agent')
  const idle = () => waitFor(() => { expect(box.disabled).toBe(false); expect(document.querySelector('[data-testid=agent-typing]')).toBeNull() }, { timeout: 8000 })
  const say = async (t) => {
    await idle()
    fireEvent.change(box, { target: { value: t } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(box.value).toBe(''), { timeout: 4000 })
  }
  return { board, say, idle }
}
const cards = () => screen.queryAllByTestId('agent-result')
const chartButtons = () => screen.queryAllByTestId('agent-open-chart')
const charts = (board) => board.host.charts.list().map(c => c.symbol)
const transcript = () => screen.getByTestId('agent-transcript').textContent

describe('owner’s four-question sequence — deterministic, no model, one request each', () => {
  it('US A50 → Nasdaq → below → 200-day: right args, zero model calls, no duplicate fetches; Open chart only where a series exists', async () => {
    const { say } = mount()
    const q = ['What percentage of US stocks are above their 50 SMA?', 'What about Nasdaq?', 'And how many are below it?', 'And the 200-day?']
    const want = [
      { universe: 'us', metrics: ['pct_above_50sma'], side: null },
      { universe: 'nasdaq', metrics: ['pct_above_50sma'], side: null },
      { universe: 'nasdaq', metrics: ['pct_above_50sma'], side: 'below' },
      { universe: 'nasdaq', metrics: ['pct_above_200sma'], side: 'below' },
    ]
    for (let i = 0; i < q.length; i++) {
      await say(q[i])
      await waitFor(() => expect(cards()).toHaveLength(i + 1), { timeout: 8000 })
      expect(breadthBodies).toHaveLength(i + 1)                       // exactly one request per question
      expect(breadthBodies[i]).toMatchObject({ mode: 'value', ...want[i] })
    }
    expect(turns).toHaveLength(0)
    expect(historyBodies).toHaveLength(0)                             // no history query for a reading
    // the two ABOVE readings offer their series; the two AT-OR-BELOW readings offer nothing
    const offered = cards().map(c => c.querySelector('[data-testid=agent-open-chart]')?.getAttribute('aria-label') || null)
    expect(offered).toEqual(['Open chart: US:A50', 'Open chart: NASDAQ:A50', null, null])
  }, 40000)
})

describe('Open chart — opens the exact series on a NEW chart; the workspace is preserved', () => {
  it('Nasdaq A50 → one new chart born on NASDAQ:A50; existing charts untouched; Undo removes only it', async () => {
    const { board, say, idle } = mount()
    await say('what % of nasdaq stocks are above the 50 day')
    await waitFor(() => expect(chartButtons()).toHaveLength(1), { timeout: 8000 })
    const before = JSON.stringify(board.state.widgets)
    fireEvent.click(chartButtons()[0])
    await waitFor(() => expect(charts(board)).toEqual(['NVDA', 'NVDA', 'NASDAQ:A50']), { timeout: 8000 })
    // the two charts that were there: same ids, places, links and settings
    expect(JSON.stringify(board.state.widgets.slice(0, 2))).toBe(before)
    const added = board.state.widgets[2]
    expect(added).toMatchObject({ type: 'chart', color: 'N' })                     // born unlinked on its own series
    expect(screen.queryAllByTestId('agent-proposal')).toHaveLength(0)            // the click IS the request
    expect(searches).toContain('NASDAQ:A50')                                      // checked like any symbol
    expect(turns).toHaveLength(0)
    await idle()
    fireEvent.change(screen.getByLabelText('Message UCT Agent'), { target: { value: 'undo' } })
    fireEvent.keyDown(screen.getByLabelText('Message UCT Agent'), { key: 'Enter' })
    await waitFor(() => expect(charts(board)).toEqual(['NVDA', 'NVDA']), { timeout: 8000 })
    expect(JSON.stringify(board.state.widgets)).toBe(before)
  }, 30000)

  it('a FULL board: refused with the workspace’s own reason — nothing resized, moved or replaced', async () => {
    const { board, say } = mount([{ id: 'l', type: 'chart', x: 0, y: 0, w: 12, h: 20 }, { id: 'r', type: 'chart', x: 12, y: 0, w: 12, h: 20 }])
    await say('what % of nasdaq stocks are above the 50 day')
    await waitFor(() => expect(chartButtons()).toHaveLength(1), { timeout: 8000 })
    const before = JSON.stringify(board.state.widgets)
    fireEvent.click(chartButtons()[0])
    await waitFor(() => expect(transcript()).toMatch(/no empty space for a Chart/), { timeout: 8000 })
    expect(JSON.stringify(board.state.widgets)).toBe(before)
    expect(transcript()).not.toMatch(/Created/)
  }, 20000)

  it('a series already on the board is not opened twice — said, nothing added', async () => {
    const { board, say } = mount([{ id: 'l', type: 'chart', x: 0, y: 0, w: 12, h: 20, color: 'B' }], { B: 'US:A50' })
    await say('what % of us stocks are above the 50 day')
    await waitFor(() => expect(chartButtons()).toHaveLength(1), { timeout: 8000 })
    fireEvent.click(chartButtons()[0])
    await waitFor(() => expect(transcript()).toMatch(/US:A50 is already on your board/), { timeout: 8000 })
    expect(board.state.widgets).toHaveLength(1)
    expect(board.state.addCalls || []).toHaveLength(0)
  }, 20000)

  it('a history search opens the same measure’s series', async () => {
    const { board, say } = mount()
    await say('when was the last time nyse a200 was below 10%')
    await waitFor(() => expect(chartButtons()).toHaveLength(1), { timeout: 8000 })
    fireEvent.click(chartButtons()[0])
    await waitFor(() => expect(charts(board)).toContain('NYSE:A200'), { timeout: 8000 })
  }, 20000)

  it('a series UCT does not know (a stale / restored card) is refused by the symbol check — no blank chart', async () => {
    const { board, say } = mount()
    SERIES['us:pct_above_50sma'] = 'US:GONE'                          // the registry answered a series search no longer knows
    try {
      await say('what % of us stocks are above the 50 day')
      await waitFor(() => expect(chartButtons()).toHaveLength(1), { timeout: 8000 })
      fireEvent.click(chartButtons()[0])
      await waitFor(() => expect(transcript()).toMatch(/UCT has no symbol “US:GONE”/), { timeout: 8000 })
      expect(charts(board)).toEqual(['NVDA', 'NVDA'])
    } finally { SERIES['us:pct_above_50sma'] = 'US:A50' }
  }, 20000)
})

describe('the card — when the action shows, and what it carries', () => {
  const v = (o) => ({ kind: 'value', value: '24.7%', label: 'NASDAQ · % of Stocks Above 50-Day MA', note: 'n', ...o })
  it('only with a valid target AND a panel that can open charts; Details stays', () => {
    const onOpen = vi.fn()
    const { rerender } = render(<AgentResult view={v({ chart: { symbol: 'NASDAQ:A50', label: 'NASDAQ:A50' }, details: { text: 'full' } })} onOpenChart={onOpen} />)
    expect(chartButtons()).toHaveLength(1)
    expect(screen.getByTestId('agent-result-details')).toBeTruthy()
    rerender(<AgentResult view={v({ chart: { symbol: 'NASDAQ:A50' } })} />)                 // no handler (e.g. another surface)
    expect(chartButtons()).toHaveLength(0)
    rerender(<AgentResult view={v({})} onOpenChart={onOpen} />)                               // no target
    expect(chartButtons()).toHaveLength(0)
    rerender(<AgentResult view={v({ chart: { symbol: 'not a ticker!' } })} onOpenChart={onOpen} />)
    expect(chartButtons()).toHaveLength(0)
    rerender(<AgentResult view={{ kind: 'error', text: 'x', chart: { symbol: 'SPY' } }} onOpenChart={onOpen} />)
    expect(chartButtons()).toHaveLength(0)
    rerender(<AgentResult view={v({ chart: { symbol: 'NASDAQ:A50' } })} onOpenChart={onOpen} busy />)
    expect(chartButtons()[0].disabled).toBe(true)
  })
  it('presentOf keeps the capability’s target — never one guessed from the text', () => {
    expect(presentOf({ text: 'NVDA is up', present: { kind: 'value', value: '1', label: 'NVDA' } }).chart).toBeUndefined()
    expect(presentOf({ text: 'x', chart: { symbol: 'nvda' }, present: { kind: 'value', value: '1', label: 'x' } }).chart).toEqual({ symbol: 'NVDA', label: 'NVDA' })
    expect(presentOf({ text: 'x', error: true, chart: { symbol: 'NVDA' } }).chart).toBeUndefined()
    expect(chartTarget({ symbol: 'A'.repeat(25) })).toBeNull()
  })
})

describe('stock answers chart their ticker', () => {
  it('a profile card opens a chart of that ticker', async () => {
    globalThis.fetch.mockImplementation(async (url, init = {}) => {
      const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
      const u = String(url)
      if (u === '/api/agent/turn') {
        const b = JSON.parse(init.body); turns.push(b)
        const ref = b.context.stockData?.[0]?.ref || b.context.stock?.[0]?.ref || 'stock'
        return json({ conversationId: 'c1', envelope: { disposition: 'apply', reply: '', question: null, unsupported_category: null, ops: [{ action: 'stock.profile', target: ref, args: { symbol: 'QQQ' } }] } })
      }
      if (u.startsWith('/api/agent/record')) return json({ conversationId: 'c1' })
      if (u.startsWith('/api/ticker-search')) { searches.push(u); return json({ results: [{ ticker: 'QQQ' }] }) }
      if (u.includes('QQQ')) { profileCalls.push(u); return json({ ticker: 'QQQ', name: 'Invesco QQQ', market_cap: 1, price: 1 }) }
      return json({ conversations: [] })
    })
    const { board, say } = mount()
    await say('tell me about QQQ')
    await waitFor(() => expect(chartButtons().length).toBeGreaterThan(0), { timeout: 8000 })
    expect(chartButtons()[0].getAttribute('aria-label')).toBe('Open chart: QQQ')
    fireEvent.click(chartButtons()[0])
    await waitFor(() => expect(charts(board)).toContain('QQQ'), { timeout: 8000 })
  }, 20000)
})

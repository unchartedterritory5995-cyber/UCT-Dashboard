// OPEN CHART on Agent metric cards (owner 2026-10-13; rev. 2: REUSE a chart — one switches, several ask, none adds). The card carries a TYPED target set by the
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
      { universe: 'us', metrics: ['pct_above_50sma'], side: null, sessions: null },
      { universe: 'nasdaq', metrics: ['pct_above_50sma'], side: null, sessions: null },
      { universe: 'nasdaq', metrics: ['pct_above_50sma'], side: 'below', sessions: null },
      { universe: 'nasdaq', metrics: ['pct_above_200sma'], side: 'below', sessions: null },
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

// boards: one chart (with room beside it), one chart filling the board, no chart (a watchlist only)
const ONE = [{ id: 'l', type: 'chart', x: 0, y: 0, w: 8, h: 20, color: 'B' }]
const ONE_FULL = [{ id: 'l', type: 'chart', x: 0, y: 0, w: 24, h: 20, color: 'B' }]
const NONE = [{ id: 'w', type: 'watchlist', x: 0, y: 0, w: 6, h: 20 }]
const askNasdaq = async (say) => {
  await say('what % of nasdaq stocks are above the 50 day')
  await waitFor(() => expect(chartButtons()).toHaveLength(1), { timeout: 8000 })
}
const choiceButtons = () => [...(screen.queryAllByTestId('agent-question').at(-1)?.querySelectorAll('button') || [])]

describe('Open chart REUSES a chart — one chart switches, several ask, none adds', () => {
  it('ONE chart: it switches to NASDAQ:A50 at once — same widget, place, size, timeframe; no approval; Undo restores QQQ', async () => {
    const { board, say, idle } = mount(ONE, { B: 'QQQ' })
    board.state.widgets[0].opts = { tf: 'W' }
    await askNasdaq(say)
    const before = JSON.stringify(board.state.widgets)
    fireEvent.click(chartButtons()[0])
    await waitFor(() => expect(charts(board)).toEqual(['NASDAQ:A50']), { timeout: 8000 })
    expect(JSON.stringify(board.state.widgets)).toBe(before)                     // the widget itself is untouched
    expect(board.host.charts.list()[0].tf).toBe('W')
    expect(board.state.addCalls || []).toHaveLength(0)                            // nothing created
    expect(screen.queryAllByTestId('agent-proposal')).toHaveLength(0)            // no approval card
    expect(screen.queryAllByTestId('agent-question')).toHaveLength(0)            // nothing asked
    await waitFor(() => expect(screen.queryAllByTestId('agent-receipt').map(r => r.textContent).join(' ')).toMatch(/NASDAQ:A50/), { timeout: 8000 })
    expect(searches).toContain('NASDAQ:A50')                                      // the symbol check ran
    expect(turns).toHaveLength(0)
    await idle()
    fireEvent.change(screen.getByLabelText('Message UCT Agent'), { target: { value: 'undo' } })
    fireEvent.keyDown(screen.getByLabelText('Message UCT Agent'), { key: 'Enter' })
    await waitFor(() => expect(charts(board)).toEqual(['QQQ']), { timeout: 8000 })
    expect(JSON.stringify(board.state.widgets)).toBe(before)
  }, 30000)

  it('ONE chart on a FULL board: the switch still succeeds (nothing to place)', async () => {
    const { board, say } = mount(ONE_FULL, { B: 'QQQ' })
    await askNasdaq(say)
    fireEvent.click(chartButtons()[0])
    await waitFor(() => expect(charts(board)).toEqual(['NASDAQ:A50']), { timeout: 8000 })
    expect(board.state.widgets).toHaveLength(1)
    expect(transcript()).not.toMatch(/no empty space/)
  }, 20000)

  it('SEVERAL charts: asks which — labelled by place and symbol, plus Cancel; only the one picked changes', async () => {
    const { board, say } = mount(TWO, { A: 'NVDA' })
    board.state.widgets[1].color = 'C'; board.state.groupSyms.C = 'SPY'
    await askNasdaq(say)
    fireEvent.click(chartButtons()[0])
    await waitFor(() => expect(screen.queryAllByTestId('agent-question')).toHaveLength(1), { timeout: 8000 })
    expect(screen.getByTestId('agent-question').textContent).toMatch(/Which chart should show NASDAQ:A50\?/)
    const labels = choiceButtons().map(b => b.textContent)
    expect(labels).toHaveLength(3)
    expect(labels[0]).toMatch(/NVDA/); expect(labels[1]).toMatch(/SPY/); expect(labels[2]).toBe('Cancel')
    expect(charts(board)).toEqual(['NVDA', 'SPY'])                                 // nothing changes before the pick
    fireEvent.click(choiceButtons()[1])
    await waitFor(() => expect(charts(board)).toEqual(['NVDA', 'NASDAQ:A50']), { timeout: 8000 })
    expect(board.state.widgets).toHaveLength(2)
    expect(turns).toHaveLength(0)
  }, 30000)

  it('SEVERAL charts on the SAME ticker: every choice is distinct; the picked one alone changes', async () => {
    const W = [{ id: 'a', type: 'chart', x: 0, y: 0, w: 8, h: 20, color: 'N' }, { id: 'b', type: 'chart', x: 8, y: 0, w: 8, h: 20, color: 'N' }]
    const { board, say } = mount(W, { 'N:a': 'QQQ', 'N:b': 'QQQ' })
    await askNasdaq(say)
    fireEvent.click(chartButtons()[0])
    await waitFor(() => expect(screen.queryAllByTestId('agent-question')).toHaveLength(1), { timeout: 8000 })
    const labels = choiceButtons().slice(0, -1).map(b => b.textContent)
    expect(new Set(labels).size).toBe(2)
    fireEvent.click(choiceButtons()[0])
    await waitFor(() => expect(charts(board)).toEqual(['NASDAQ:A50', 'QQQ']), { timeout: 8000 })
  }, 30000)

  it('Cancel: nothing changes, and a later message is not read as a pick', async () => {
    const { board, say } = mount(TWO, { A: 'NVDA' })
    await askNasdaq(say)
    const before = JSON.stringify(board.state)
    fireEvent.click(chartButtons()[0])
    await waitFor(() => expect(choiceButtons().length).toBe(3), { timeout: 8000 })
    fireEvent.click(choiceButtons()[2])
    await waitFor(() => expect(transcript()).toMatch(/Okay — nothing changed\./), { timeout: 8000 })
    expect(JSON.stringify(board.state)).toBe(before)
  }, 20000)

  it('NO chart: one new chart is added through the safe add; a full board with no chart is refused, unchanged', async () => {
    const { board, say } = mount(NONE)
    await askNasdaq(say)
    fireEvent.click(chartButtons()[0])
    await waitFor(() => expect(charts(board)).toEqual(['NASDAQ:A50']), { timeout: 8000 })
    expect(board.state.widgets).toHaveLength(2)
    cleanup()
    const full = mount([{ id: 'w', type: 'watchlist', x: 0, y: 0, w: 24, h: 20 }])
    await askNasdaq(full.say)
    const before = JSON.stringify(full.board.state.widgets)
    fireEvent.click(chartButtons()[0])
    await waitFor(() => expect(transcript()).toMatch(/no empty space for a Chart/), { timeout: 8000 })
    expect(JSON.stringify(full.board.state.widgets)).toBe(before)
  }, 30000)

  it('a series already on the board: said, nothing changes (no duplicate)', async () => {
    const { board, say } = mount(TWO, { A: 'NASDAQ:A50' })
    await askNasdaq(say)
    const before = JSON.stringify(board.state)
    fireEvent.click(chartButtons()[0])
    await waitFor(() => expect(transcript()).toMatch(/NASDAQ:A50 is already on your board/), { timeout: 8000 })
    expect(JSON.stringify(board.state)).toBe(before)
  }, 20000)

  it('a PROTECTED layout (Main Trading): refused before any question — nothing changes', async () => {
    const board = makeBoard(TWO, { A: 'NVDA' }, { layouts: { entries: [{ id: 1, name: 'Main Trading' }], active: 1 } })
    render(<AgentPanel host={board.host} onClose={() => {}} />)
    const box = screen.getByLabelText('Message UCT Agent')
    fireEvent.change(box, { target: { value: 'what % of nasdaq stocks are above the 50 day' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(chartButtons()).toHaveLength(1), { timeout: 8000 })
    const before = JSON.stringify(board.state.widgets)
    fireEvent.click(chartButtons()[0])
    await waitFor(() => expect(transcript()).toMatch(/protected layout/), { timeout: 8000 })
    expect(screen.queryAllByTestId('agent-question')).toHaveLength(0)
    expect(JSON.stringify(board.state.widgets)).toBe(before)
    expect(charts(board)).toEqual(['NVDA', 'NVDA'])
  }, 20000)

  it('a series UCT does not know (a stale / restored card) is refused by the symbol check — the chart keeps its symbol', async () => {
    const { board, say } = mount(ONE, { B: 'QQQ' })
    SERIES['us:pct_above_50sma'] = 'US:GONE'
    try {
      await say('what % of us stocks are above the 50 day')
      await waitFor(() => expect(chartButtons()).toHaveLength(1), { timeout: 8000 })
      fireEvent.click(chartButtons()[0])
      await waitFor(() => expect(transcript()).toMatch(/UCT has no symbol “US:GONE”/), { timeout: 8000 })
      expect(charts(board)).toEqual(['QQQ'])
    } finally { SERIES['us:pct_above_50sma'] = 'US:A50' }
  }, 20000)

  it('a history search opens the searched measure’s series', async () => {
    const { board, say } = mount(ONE, { B: 'QQQ' })
    await say('when was the last time nyse a200 was below 10%')
    await waitFor(() => expect(chartButtons()).toHaveLength(1), { timeout: 8000 })
    fireEvent.click(chartButtons()[0])
    await waitFor(() => expect(charts(board)).toEqual(['NYSE:A200']), { timeout: 8000 })
  }, 20000)

  it('an EXPLICIT new-chart request keeps the add: "Open NASDAQ:A50 in a new chart" → a new chart (the add’s own proposal)', async () => {
    const { board, say, idle } = mount(ONE, { B: 'QQQ' })
    await say('Open NASDAQ:A50 in a new chart')
    await waitFor(() => expect(screen.queryAllByTestId('agent-proposal')).toHaveLength(1), { timeout: 8000 })
    expect(screen.getByTestId('agent-proposal').textContent).toMatch(/Create a chart: NASDAQ:A50/)
    await idle()
    await say('do it')
    await waitFor(() => expect(charts(board)).toEqual(['QQQ', 'NASDAQ:A50']), { timeout: 8000 })
    expect(turns).toHaveLength(0)
  }, 30000)
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
  it('the footer: metric cards get the divider row (Details left, Open chart right); prose cards keep their layout', () => {
    const onOpen = vi.fn()
    const { rerender, container } = render(<AgentResult view={v({ chart: { symbol: 'NASDAQ:A50' }, details: { text: 'full answer' } })} onOpenChart={onOpen} />)
    const foot = screen.getByTestId('agent-result-foot')
    expect(foot.firstElementChild.getAttribute('data-testid')).toBe('agent-result-details')   // Details first (left)
    expect(foot.lastElementChild.getAttribute('data-testid')).toBe('agent-open-chart')         // the button last (right)
    // Details still opens
    const det = screen.getByTestId('agent-result-details')
    fireEvent.click(det.querySelector('summary'))
    expect(det.open).toBe(true)
    expect(det.textContent).toMatch(/full answer/)
    // a metric card with Details only (e.g. "% at or below"): the same footer, no button
    rerender(<AgentResult view={v({ details: { text: 'x' } })} onOpenChart={onOpen} />)
    expect(screen.getByTestId('agent-result-foot')).toBeTruthy()
    expect(chartButtons()).toHaveLength(0)
    // a prose answer: unchanged (no footer row)
    rerender(<AgentResult view={{ kind: 'text', text: 'hello', details: { text: 'more' } }} onOpenChart={onOpen} />)
    expect(screen.queryByTestId('agent-result-foot')).toBeNull()
    void container
  })

  it('the button: disabled while the panel is busy; "Opening…" (and disabled) while its own click runs', async () => {
    let release
    const onOpen = vi.fn(() => new Promise(r => { release = r }))
    render(<AgentResult view={v({ chart: { symbol: 'NASDAQ:A50' } })} onOpenChart={onOpen} />)
    const b = chartButtons()[0]
    expect(b.textContent).toBe('Open chart')
    fireEvent.click(b)
    await waitFor(() => expect(chartButtons()[0].textContent).toBe('Opening…'))
    expect(chartButtons()[0].disabled).toBe(true)
    expect(chartButtons()[0].getAttribute('aria-busy')).toBe('true')
    release()
    await waitFor(() => expect(chartButtons()[0].textContent).toBe('Open chart'))
    expect(chartButtons()[0].disabled).toBe(false)
    expect(onOpen).toHaveBeenCalledTimes(1)
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
    const { board, say } = mount([{ id: 'l', type: 'chart', x: 0, y: 0, w: 8, h: 20, color: 'B' }], { B: 'NVDA' })
    await say('tell me about QQQ')
    await waitFor(() => expect(chartButtons().length).toBeGreaterThan(0), { timeout: 8000 })
    expect(chartButtons()[0].getAttribute('aria-label')).toBe('Open chart: QQQ')
    fireEvent.click(chartButtons()[0])
    await waitFor(() => expect(charts(board)).toEqual(['QQQ']), { timeout: 8000 })
  }, 20000)
})

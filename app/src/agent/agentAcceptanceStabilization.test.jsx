// PRODUCTION ACCEPTANCE STABILIZATION (2026-10-12) — the browser half of the owner's findings:
//   2 · the comparison card reads earlier → latest → change, the change keeps its sign ("Down")
//   3 · a single value: a compact label ("NVDA · Market cap"), a legible figure, the link stays quiet
//   4 · a general breadth request plans `metrics: []` (UCT's overview); a mixed breadth + news request
//       shows BOTH sections; news shows 5 headlines, the rest one tap away under Details
//   5 · rows (Screener) preview without a scroll box nested in the transcript; "Show all" in place
// Scripted model, mocked routes — no model call, no network.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { getCapability, manifestFor } from './capabilities'
import { presentOf, HEADLINES_SHOWN } from './present'
import { OVERVIEW_METRICS, BREADTH_METRICS, _resetBreadthDates } from './capabilities/breadth'
import { makeBoard } from './__fixtures__/board'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'
import AgentResult, { ROWS_PREVIEW } from './AgentResult'
registerBuiltins()

const MINUS = String.fromCharCode(0x2212)
const css = fs.readFileSync(path.resolve(globalThis.process.cwd(), 'src/agent/AgentResult.module.css'), 'utf8')
const headlines = (n) => Array.from({ length: n }, (_, i) => ({ title: `Headline ${i + 1}`, meta: `Oct ${12 - (i % 3)}, 9:${10 + i} AM ET · Benzinga` }))

describe('2 · the comparison card', () => {
  const view = { kind: 'comparison', title: 'US · % of Stocks Above 50-Day MA', items: [
    { label: 'Earlier', value: '44.5%', note: '2026-09-09' },
    { label: 'Latest', value: '25.6%', note: '2026-10-09' },
    { label: 'Change', value: `${MINUS}18.9 pts`, note: 'Down', tone: 'down' },
  ] }
  it('reads earlier → latest → change; the change is negative and says "Down"', () => {
    render(<AgentResult view={presentOf({ text: 'x', present: view })} />)
    const tiles = [...document.querySelectorAll('dl > div')]
    expect(tiles.map(t => t.querySelector('dt').textContent)).toEqual(['Earlier', 'Latest', 'Change'])
    expect(tiles[2].textContent).toBe(`Change${MINUS}18.9 ptsDown`)
    expect(tiles[2].className).toMatch(/down/)
  })
  it('the tiles line up: every tile has a label, a value and a note line; labels and notes never wrap', () => {
    render(<AgentResult view={view} />)
    for (const t of document.querySelectorAll('dl > div')) {
      expect(t.querySelector('dt').textContent).not.toBe('')
      expect(t.querySelector('dd').firstChild.textContent).not.toBe('')
      expect(t.querySelector('dd span').textContent).not.toBe('')
    }
    expect(css).toMatch(/\.compare \.pair dt, \.compare \.pairNote \{[^}]*white-space: nowrap/)
    expect(css).toMatch(/\.compare \.pair \{ display: flex; flex-direction: column; \}/)
  })
})

describe('3 · a single value', () => {
  const PROFILE = { text: 'NVDA — NVIDIA Corporation\nMarket cap $4.66T', link: { href: '/research/NVDA', label: 'Open NVDA in Research' },
    present: { kind: 'metrics', title: 'NVDA — NVIDIA Corporation', short: 'NVDA', items: [
      { label: 'Price', value: '$191.40' }, { label: 'Market cap', value: '$4.66T', aka: ['market cap'] }] } }
  it('a compact label ("NVDA · Market cap") above a legible figure; the full profile under Details', () => {
    const v = presentOf(PROFILE, { message: "what's NVDA's market cap?" })
    expect(v).toMatchObject({ kind: 'value', value: '$4.66T', label: 'NVDA · Market cap' })
    expect(v.details.items).toHaveLength(2)
    render(<AgentResult view={v} />)
    const card = screen.getByTestId('agent-result-value')
    expect([...card.children].map(c => c.textContent)).toEqual(['NVDA · Market cap', '$4.66T'])
  })
  it('stock.profile names its subject compactly', () => {
    const src = fs.readFileSync(path.resolve(globalThis.process.cwd(), 'src/agent/capabilities/stock.js'), 'utf8')
    expect(src).toMatch(/short: sym, items: fig/)
  })
  it('the figure is ~20–25% smaller than before (26px → 20px; narrow 23px → 18px)', () => {
    expect(css).toMatch(/\.figure \{ font-size: 20px;/)
    expect(css).toMatch(/\.figure \{ font-size: 18px; \}/)
  })
  it('the way into UCT is a quiet text action, not a bordered button', () => {
    const rule = css.match(/\n\.link \{[^}]*\}/)[0]
    expect(rule).not.toMatch(/border:/)
    expect(rule).toMatch(/font-size: 11\.5px/)
  })
})

describe('4 · headlines: 5 up front, the rest one tap away', () => {
  it(`shows ${HEADLINES_SHOWN}; the other 3 of 8 are under Details with their attribution`, () => {
    const v = presentOf({ text: 'Latest 8 headlines…', present: { kind: 'headlines', title: 'NVDA — latest headlines', headlines: headlines(8), source: "From UCT's news feed (not a live web search)." } })
    expect(v.headlines).toHaveLength(5)
    expect(v.details.headlines.map(h => h.title)).toEqual(['Headline 6', 'Headline 7', 'Headline 8'])
    render(<AgentResult view={v} />)
    const d = screen.getByTestId('agent-result-details')
    expect(d.querySelector('summary').textContent).toBe('3 more headlines · details')
    expect(d.textContent).toContain('Benzinga')
    expect(screen.getByTestId('agent-result').textContent).toContain("From UCT's news feed")
  })
  it('five or fewer: all shown, no "more" line; asking for all of them shows all', () => {
    expect(presentOf({ text: 'x', present: { kind: 'headlines', headlines: headlines(4) } }).details?.headlines).toBeUndefined()
    expect(presentOf({ text: 'x', present: { kind: 'headlines', headlines: headlines(8) } }, { message: 'show me all the details' }).headlines).toHaveLength(8)
  })
})

describe('5 · rows: a preview, never a scroll box inside the transcript', () => {
  const table = (n) => ({ columns: [{ key: 'ticker', label: 'Symbol' }, { key: 'price', label: 'Price' }, { key: 'chg', label: 'Chg 1D' }],
    rows: Array.from({ length: n }, (_, i) => ({ ticker: `T${i + 1}`, price: `$${i + 10}`, chg: '1.0%' })) })
  it(`${ROWS_PREVIEW} rows shown with "Show all 25 rows"; the button opens them in place; Open in Screener stays`, () => {
    render(<AgentResult view={{ kind: 'table', table: table(25), text: 'Screen: 3,665 stocks match.', link: { href: '/screener?s=x', label: 'Open in Screener' } }} />)
    const t = screen.getByTestId('agent-result-table')
    expect(t.querySelectorAll('tbody tr')).toHaveLength(ROWS_PREVIEW)
    fireEvent.click(screen.getByTestId('agent-rows-more'))
    expect(t.querySelectorAll('tbody tr')).toHaveLength(25)
    expect(screen.queryByTestId('agent-rows-more')).toBeNull()
    expect(screen.getByTestId('agent-open-link').textContent).toBe('Open in Screener')
  })
  it('a short result shows every row with no button (never "show all" for one or two hidden rows)', () => {
    render(<AgentResult view={{ kind: 'table', table: table(ROWS_PREVIEW + 2) }} />)
    expect(screen.getByTestId('agent-result-table').querySelectorAll('tbody tr')).toHaveLength(ROWS_PREVIEW + 2)
    expect(screen.queryByTestId('agent-rows-more')).toBeNull()
  })
  it('no max-height / overflow scroll on rows', () => {
    expect(css).not.toMatch(/\.rows \{[^}]*(max-height|overflow-y: auto)/)
  })
})

describe('4 · general breadth + mixed intent through the panel', () => {
  let envelopes, records, breadthBodies, newsUrls
  beforeEach(() => {
    envelopes = []; records = []; breadthBodies = []; newsUrls = []
    _resetBreadthDates()
    try { localStorage.clear() } catch { /* */ }
    globalThis.fetch = vi.fn(async (url, init = {}) => {
      const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
      const body = init.body ? JSON.parse(init.body) : null
      if (url === '/api/agent/turn') return json({ conversationId: 'c1', envelope: envelopes.shift()(body), usage: {} })
      if (url === '/api/agent/record') { records.push(body); return json({ conversationId: 'c1' }) }
      if (url === '/api/agent/breadth') {
        breadthBodies.push(body)
        return json({ status: 'ok', text: 'US breadth on 2026-10-09 …', table: null, present: { kind: 'metrics', title: 'US breadth overview',
          items: [{ label: '% of Stocks Above 50-Day MA', value: '11.1%' }, { label: '% of Stocks Above 200-Day MA', value: '22.2%' },
            { label: 'Net New 52-Week Highs-Lows', value: '+33' }, { label: 'Net Advancers (Daily)', value: '+44' }], note: 'As of 2026-10-09 close' } })
      }
      if (url === '/api/agent/breadth/dates') return json({ today_et: '2026-10-12', latest_finalized: { us: '2026-10-09', nyse: '2026-10-09', nasdaq: '2026-10-09' } })
      if (String(url).startsWith('/api/company-news/')) {
        newsUrls.push(url)
        return json({ items: Array.from({ length: 8 }, (_, i) => ({ headline: `NVDA headline ${i + 1}`, source: 'Benzinga', published_at: new Date(Date.now() - i * 3600e3).toISOString(), sentiment: 'neutral' })) })
      }
      if (String(url).startsWith('/api/fundamentals-full/')) return json({ symbol: 'NVDA', companyName: 'NVIDIA Corporation' })
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

  it('the overview is documented in the manifest (metrics [] = general), inside the four-measure limit', () => {
    expect(OVERVIEW_METRICS).toHaveLength(4)
    expect(OVERVIEW_METRICS.every(m => BREADTH_METRICS.includes(m))).toBe(true)
    const entry = manifestFor({ surface: 'charts', createIndicator: true }).find(c => c.name === 'breadth.show')
    expect(entry.hints).toMatch(/\[\] = general overview/)
    expect(entry.hints).not.toMatch(/pct_above_50sma', 'pct_above_200sma/)      // the default lives server-side
    expect(getCapability('breadth.show').localOnly).toBe(true)
  })

  it('"What\'s breadth today and the latest NVDA news?" → the breadth overview AND 5 headlines; no limit refusal', async () => {
    const say = mount()
    envelopes.push((b) => ({ disposition: 'apply', reply: '', question: null, unsupported_category: null, ops: [
      { action: 'breadth.show', target: b.context.breadth[0].ref, args: { mode: 'value', universe: 'us', metrics: [], date: null, compare_date: null, start: null, end: null } },
      { action: 'news.latest', target: b.context.stockData[0].ref, args: { symbol: 'NVDA', limit: null } },
    ] }))
    await say("What's breadth today and the latest NVDA news?")
    const results = await waitFor(() => { const r = screen.getAllByTestId('agent-result'); expect(r).toHaveLength(2); return r }, { timeout: 6000 })
    expect(breadthBodies[0].metrics).toEqual([])                        // the route fills the overview
    const breadth = results.find(r => r.textContent.includes('US breadth overview'))
    expect(within(breadth).getAllByText(/%|\+\d/).length).toBeGreaterThan(0)
    expect(breadth.textContent).not.toMatch(/at most|up to four/i)
    const news = results.find(r => r.dataset.kind === 'headlines')
    expect(news.querySelectorAll(':scope > ul li')).toHaveLength(5)
    expect(within(news).getByTestId('agent-result-details').querySelector('summary').textContent).toBe('3 more headlines · details')
    expect(document.body.textContent).not.toMatch(/did not look up the news|wasn't looked up/i)
    // ⛔ the breadth figures never ride the next model-bound record as text
    await waitFor(() => expect(records.length).toBeGreaterThan(0), { timeout: 6000 })
    const local = records.find(r => r.outcomeData?.local)
    expect(local).toBeTruthy()
  })

  it('a section that genuinely fails says so specifically; the other section still shows', async () => {
    const say = mount()
    const orig = globalThis.fetch
    globalThis.fetch = vi.fn(async (url, init) => (url === '/api/agent/breadth'
      ? new Response(JSON.stringify({ detail: 'breadth store unavailable' }), { status: 503, headers: { 'content-type': 'application/json' } })
      : orig(url, init)))
    envelopes.push((b) => ({ disposition: 'apply', reply: '', question: null, unsupported_category: null, ops: [
      { action: 'breadth.show', target: b.context.breadth[0].ref, args: { mode: 'value', universe: 'us', metrics: [], date: null, compare_date: null, start: null, end: null } },
      { action: 'news.latest', target: b.context.stockData[0].ref, args: { symbol: 'NVDA', limit: null } },
    ] }))
    await say("What's breadth today and the latest NVDA news?")
    await waitFor(() => expect(document.querySelector('[data-kind="headlines"]')).toBeTruthy(), { timeout: 6000 })
    expect(document.body.textContent).toMatch(/couldn't read UCT's breadth data right now \(breadth store unavailable\)/)
  })
})

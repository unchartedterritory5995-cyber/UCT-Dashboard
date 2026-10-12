// RESPONSE PRESENTATION (2026-10-12) — one contract for every Agent answer (present.js), rendered by
// AgentResult, saved with the conversation and restored after navigation / reload. Pins:
//   · the smallest view per result shape; concise by default, depth when asked; FOCUS on what was named
//   · new tools inherit a view (a plain {text, table} or a string gets one)
//   · no empty bubbles — live (push guard) or restored (an empty stored row)
//   · every stored row type restores as its own card; older text-only rows still render
//   · saved views are bounded; nothing scrolls sideways (wrapping rows; stacked cards on a narrow panel)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { registerCapability } from './capabilities'
import { presentOf, compactView, compactViews, itemsFromTurns, wantsDetail, isView, VIEW_MAX_CHARS } from './present'
import { makeBoard } from './__fixtures__/board'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'
import AgentResult from './AgentResult'
registerBuiltins()

const PROFILE = {
  text: 'NVDA — Nvidia Corp · Technology / Semiconductors\nPrice $191.40, +1.20% today\nMarket cap $4.66T · P/E 52.10 trailing, 31.00 forward\nSource: UCT fundamentals.',
  link: { href: '/research/NVDA', label: 'Open NVDA in Research' },
  present: { kind: 'metrics', title: 'NVDA — Nvidia Corp', items: [
    { label: 'Price', value: '$191.40', aka: ['price', 'quote'] },
    { label: 'Market cap', value: '$4.66T', aka: ['market cap', 'valuation'] },
    { label: 'P/E (trailing)', value: '52.10', aka: ['pe', 'p/e', 'price to earnings'] },
    { label: 'Sector', value: 'Technology / Semiconductors', aka: ['sector', 'industry'] },
  ] },
}

describe('1 · presentOf: the smallest view, chosen from the RESULT and the member\'s intent', () => {
  it('FOCUS: a named figure is shown alone; the full profile stays one tap away', () => {
    const v = presentOf(PROFILE, { message: "what's NVDA's market cap?" })
    expect(v).toMatchObject({ kind: 'value', value: '$4.66T', label: 'NVDA — Nvidia Corp · Market cap' })
    expect(v.details.items.map(i => i.label)).toEqual(['Price', 'Market cap', 'P/E (trailing)', 'Sector'])
    expect(v.details.text).toContain('Source: UCT fundamentals.')
    expect(v.link.href).toBe('/research/NVDA')
  })
  it('FOCUS works through a result\'s own alternate names (P/E → "pe ratio")', () => {
    expect(presentOf(PROFILE, { message: "what's AMD's PE ratio" })).toMatchObject({ kind: 'value', value: '52.10' })
  })
  it('two named figures → just those two; nothing named → all of them', () => {
    expect(presentOf(PROFILE, { message: 'price and market cap of NVDA' }).items.map(i => i.label)).toEqual(['Price', 'Market cap'])
    expect(presentOf(PROFILE, { message: 'tell me about NVDA' }).items).toHaveLength(4)
  })
  it('a request for DEPTH shows the full answer, not just the figure', () => {
    expect(wantsDetail('explain how that is calculated')).toBe(true)
    expect(wantsDetail("what's NVDA's market cap?")).toBe(false)
    const v = presentOf(PROFILE, { message: 'give me the market cap and explain it in detail' })
    expect(v.kind).toBe('metrics')
    expect(v.text).toContain('Source: UCT fundamentals.')
  })
  it('a server-built single value passes straight through', () => {
    expect(presentOf({ text: 'long methodology…', present: { kind: 'value', value: '25.6%', label: 'US · % above 50-day', note: 'As of 2026-10-09 close' } }))
      .toMatchObject({ kind: 'value', value: '25.6%', details: { text: 'long methodology…' } })
  })
  it('INHERITED: a tool that returns only text + a table still gets a view (lead + rows; the rest in details)', () => {
    const long = `Screen: 3,665 stocks match (Price > $10). Showing the first 2 by RS Rank.\n${'More detail. '.repeat(30)}`
    const v = presentOf({ text: long, table: { columns: [{ key: 'ticker', label: 'Symbol' }, { key: 'rs', label: 'RS' }], rows: [{ ticker: 'NVDA', rs: 99 }, { ticker: 'PLTR', rs: 98 }] } }, { message: 'strongest stocks' })
    expect(v.kind).toBe('table')
    expect(v.text).toBe('Screen: 3,665 stocks match (Price > $10). Showing the first 2 by RS Rank.')
    expect(v.details.text).toBe(long.trim())
  })
  it('INHERITED: a plain string answer → prose; a short one is shown whole', () => {
    expect(presentOf('NVDA reports on Nov 19.')).toEqual({ kind: 'text', text: 'NVDA reports on Nov 19.' })
  })
  it('an empty answer is no view at all (so no empty card)', () => {
    expect(presentOf('')).toBeNull()
    expect(presentOf({ text: '   ' })).toBeNull()
  })
  it('a malformed present falls back to the text, never a broken card', () => {
    const v = presentOf({ text: 'Fallback text.', present: { kind: 'value', value: '' } })
    expect(isView(v)).toBe(true)
  })
})

describe('2 · persistence: bounded, restorable, every row type', () => {
  it('a saved view stays under its budget (details trimmed first, never cut JSON)', () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({ a: `row ${i} ${'x'.repeat(60)}` }))
    const v = compactView({ kind: 'table', table: { columns: [{ key: 'a', label: 'A' }], rows }, details: { text: 'y'.repeat(5000) } })
    expect(JSON.stringify(v).length).toBeLessThanOrEqual(VIEW_MAX_CHARS)
    expect(v.trimmed || v.details?.trimmed).toBeTruthy()
    expect(compactViews([v, v, v]).every(x => JSON.stringify(x).length <= VIEW_MAX_CHARS)).toBe(true)
  })

  const T = (id, role, text, data = null) => ({ id, role, text, data, created_at: 1760000000 + id })
  it('stored rows → the right cards; empty rows → nothing; older rows → plain text', () => {
    const items = itemsFromTurns([
      T(1, 'member', 'breadth and NVDA market cap?'),
      T(2, 'agent', '', { envelope: { disposition: 'apply', reply: '', ops: [{ action: 'breadth.show' }] } }),          // blanked reply
      T(3, 'outcome', 'US · 25.6%…\n\nNVDA…', { kind: 'answered', actions: ['breadth.show', 'stock.profile'], views: [
        { kind: 'value', value: '25.6%', label: 'US · % above 50-day' }, { kind: 'value', value: '$4.66T', label: 'NVDA · Market cap' }] }),
      T(4, 'outcome', 'Switched timeframe to 15', { kind: 'applied', actions: ['chart.setTimeframe'], lines: ['Switched timeframe to 15'] }),
      T(5, 'outcome', 'Proposed: Delete the watchlist “Swing”', { kind: 'proposed', actions: ['watchlist.delete'] }),
      T(6, 'outcome', 'Asked which target.', { kind: 'clarify-target', actions: ['chart.setType'] }),
      T(7, 'outcome', "I didn't change anything: that list doesn't exist.", { kind: 'refused', actions: ['watchlist.add'] }),
      T(8, 'agent', '', { envelope: { disposition: 'clarify', question: { text: 'Which list?', choices: [] } } }),
      T(9, 'outcome', 'An older answer with no data.'),
      T(10, 'outcome', '', { kind: 'answered' }),
    ])
    expect(items.map(i => i.role)).toEqual(['member', 'agent', 'agent', 'receipt', 'proposal', 'question', 'refusal', 'question', 'agent'])
    expect(items[1].present.value).toBe('25.6%')
    expect(items[2].present.value).toBe('$4.66T')
    expect(items[3]).toMatchObject({ lines: ['Switched timeframe to 15'], restored: true })
    expect(items[4]).toMatchObject({ status: 'history', lines: ['Delete the watchlist “Swing”'] })
    expect(items[7].text).toBe('Which list?')
    expect(items.every(i => i.text || i.present || i.lines)).toBe(true)
  })
})

describe('3 · the panel: live answers, restored conversations, no empty containers', () => {
  let envelopes, records, conv
  beforeEach(() => {
    envelopes = []; records = []; conv = null
    try { localStorage.clear() } catch { /* */ }
    globalThis.fetch = vi.fn(async (url, init = {}) => {
      const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
      if (url === '/api/agent/turn') return json({ conversationId: 'c1', envelope: envelopes.shift()(JSON.parse(init.body)), usage: {} })
      if (url === '/api/agent/record') { records.push(JSON.parse(init.body)); return json({ conversationId: 'c1' }) }
      if (String(url).startsWith('/api/agent/conversations/')) return conv ? json(conv) : json({}, 404)
      if (String(url).startsWith('/api/fundamentals-full/')) return json({ name: 'Nvidia Corp', sector: 'Technology', market_cap: 4.66e12, pe_trailing: 52.1, price: 191.4 })
      if (String(url).startsWith('/api/live-prices')) return json({})
      return json({ conversations: [] })
    })
  })
  afterEach(() => { vi.restoreAllMocks() })
  const mount = () => {
    const board = makeBoard([{ id: 'c1', type: 'chart', x: 0, y: 0, w: 12, h: 20 }], { A: 'AAPL' })
    const r = render(<AgentPanel host={board.host} onClose={() => {}} />)
    const box = screen.getByLabelText('Message UCT Agent')
    const say = async (t) => { await waitFor(() => expect(box.disabled).toBe(false), { timeout: 6000 }); fireEvent.change(box, { target: { value: t } }); fireEvent.keyDown(box, { key: 'Enter' }) }
    return { ...r, say }
  }
  // an EMPTY container: a bubble / result with no text, OR an Agent row (avatar + name) with no content
  const emptyBubbles = () => {
    const t = document.querySelector('[data-testid="agent-transcript"]')
    if (!t) return []
    const blank = [...t.querySelectorAll('[class*="bubble"], [data-testid="agent-result"]')].filter(el => !el.textContent.trim())
    const rows = [...t.querySelectorAll('[class*="agentRow"]')].filter(row => {
      const content = row.querySelector('[class*="bubble"], [data-testid="agent-result"], [data-testid="agent-receipt"], [data-testid="agent-proposal"], [data-testid="agent-question"]')
      return !content || !content.textContent.trim()
    })
    return [...blank, ...rows]
  }

  it('"what\'s NVDA\'s market cap?" → one figure, details on tap, the VIEW saved for the transcript', async () => {
    const { say } = mount()
    envelopes.push((b) => ({ disposition: 'apply', reply: '', question: null, unsupported_category: null,
      ops: [{ action: 'stock.profile', target: b.context.stockData[0].ref, args: { symbol: 'NVDA' } }] }))
    await say("what's NVDA's market cap?")
    const card = await screen.findByTestId('agent-result-value', {}, { timeout: 6000 })
    expect(card.textContent).toContain('$4.66T')
    expect(card.textContent).toContain('Market cap')
    expect(screen.getByTestId('agent-result-details').hasAttribute('open')).toBe(false)
    await waitFor(() => expect(records.some(r => r.outcomeData?.views)).toBe(true), { timeout: 6000 })
    const row = records.find(r => r.outcomeData?.views)
    expect(row.outcomeData.views[0]).toMatchObject({ kind: 'value', value: '$4.66T', v: 1 })
    expect(emptyBubbles()).toEqual([])
  })

  it('a model plan with an EMPTY reply and an answer that came back empty draws no empty bubble', async () => {
    // a query whose answer is EMPTY (a feature that returned nothing) — the push guard's case
    registerCapability({ name: 'zzz.empty', surfaces: ['charts'], target: 'market', query: true, summary: 'test: answers nothing',
      args: { type: 'object', properties: {}, required: [], additionalProperties: false }, answer: async () => '' })
    const { say } = mount()
    envelopes.push((b) => ({ disposition: 'apply', reply: '', question: null, unsupported_category: null,
      ops: [{ action: 'zzz.empty', target: b.context.stockData[0].ref, args: {} }] }))
    await say('anything')
    await waitFor(() => expect(records.length).toBeGreaterThan(0), { timeout: 6000 })
    expect(emptyBubbles()).toEqual([])
  })

  it('RESTORED after navigation: every card is back (value, receipt, proposal, refusal); no empty bubble', async () => {
    localStorage.setItem('uct.agent.conversation', 'c1')
    conv = { id: 'c1', turns: [
      { id: 1, role: 'member', text: "what's NVDA's market cap?", created_at: 1760000001 },
      { id: 2, role: 'agent', text: '', data: { envelope: { disposition: 'apply', ops: [{ action: 'stock.profile' }] } }, created_at: 1760000002 },
      { id: 3, role: 'outcome', text: 'NVDA — Nvidia…', data: { kind: 'answered', actions: ['stock.profile'], views: [{ kind: 'value', value: '$4.66T', label: 'NVDA — Nvidia Corp · Market cap', v: 1 }] }, created_at: 1760000003 },
      { id: 4, role: 'outcome', text: 'Switched timeframe to 15', data: { kind: 'applied', actions: ['chart.setTimeframe'], lines: ['Switched timeframe to 15'] }, created_at: 1760000004 },
      { id: 5, role: 'outcome', text: 'Proposed: Delete the watchlist “Swing”', data: { kind: 'proposed', actions: ['watchlist.delete'] }, created_at: 1760000005 },
      { id: 6, role: 'outcome', text: 'An older answer with no data.', created_at: 1760000006 },
    ] }
    mount()
    expect((await screen.findByTestId('agent-result-value', {}, { timeout: 6000 })).textContent).toContain('$4.66T')
    expect(screen.getByTestId('agent-receipt').textContent).toContain('Switched timeframe to 15')
    expect(screen.getByTestId('agent-proposal').textContent).toMatch(/earlier session/)
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull()                       // a restored proposal never applies
    expect(screen.getByTestId('agent-transcript').textContent).toContain('An older answer with no data.')
    expect(emptyBubbles()).toEqual([])
  })
})

describe('4 · responsive: nothing scrolls sideways', () => {
  const css = fs.readFileSync(path.join(__dirname, 'AgentResult.module.css'), 'utf8')
  it('rows wrap (no nowrap cells) and never scroll horizontally; the transcript is the size container', () => {
    expect(css).not.toMatch(/\.table td[^{]*\{[^}]*white-space:\s*nowrap/)
    expect(css).toMatch(/\.rows \{[^}]*overflow-x: hidden/)
    expect(css).toMatch(/@container agentlist \(max-width: 420px\)/)
    const panelCss = fs.readFileSync(path.join(__dirname, 'AgentPanel.module.css'), 'utf8')
    expect(panelCss).toMatch(/container: agentlist \/ inline-size/)
  })
  it('a wide table renders every cell with its column label, for the stacked narrow layout', () => {
    render(<AgentResult view={{ kind: 'table', table: { columns: [{ key: 'a', label: 'Symbol' }, { key: 'b', label: 'Price' }, { key: 'c', label: 'RS Rank' }], rows: [{ a: 'SUPERLONGTICKERNAME', b: '$1,234,567.89', c: '99' }] } }} />)
    const cells = [...document.querySelectorAll('td')]
    expect(cells.map(c => c.getAttribute('data-label'))).toEqual(['Symbol', 'Price', 'RS Rank'])
    expect(screen.getByTestId('agent-result-table').className).toMatch(/many/)
  })
})

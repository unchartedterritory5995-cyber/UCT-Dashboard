// RANKING INTEGRITY (integration, 2026-10-11 — owner item 9). A requested ranking whose field has NO
// usable value in the results cannot be established, so it is never presented as one — not in the
// answer (agentScreenerSortCoverage.test.jsx) and not when a later step takes "the top N" of it
// into a list or charts (here). ALL of the results is still fine: membership does not depend on
// order. Partial coverage is said on the receipt line. Scripted only — no model call.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { _resetScreenerCache, loadMeta } from './capabilities/screener'
import { makeBoard } from './__fixtures__/board'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'

registerBuiltins()

let calls, envelopes, universe
beforeEach(() => {
  _resetScreenerCache()
  try { localStorage.clear() } catch { /* */ }
  calls = []; envelopes = []
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null
    calls.push([init.method || 'GET', String(url), body])
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
    if (url === '/api/screener/fields') return json({ fields: [{ key: 'rs_rank', label: 'RS Rank', type: 'range', unit: '' }, { key: 'price', label: 'Price', type: 'range', unit: '$' }] })
    if (url === '/api/screener/saved-screens') return json({ saved: [], starters: [] })
    if (url === '/api/screener/scan') {
      // the engine's own order: values first (desc), nulls last — like the real route
      const rows = [...universe].sort((a, b) => (b.rs_rank ?? -Infinity) - (a.rs_rank ?? -Infinity))
      return json({ total: rows.length, rows: rows.slice(0, body.page_size), snapshot_date: '2026-10-11' })
    }
    if (url === '/api/agent/turn') return json({ conversationId: 'ac_1', envelope: envelopes.shift(), usage: { research_calls: 0, citations: [] } })
    if (url === '/api/agent/record') return json({ conversationId: 'ac_1' })
    if (String(url).startsWith('/api/ticker-search')) return json({ results: [] })
    return json({ conversations: [] })
  })
})
afterEach(() => { vi.restoreAllMocks() })

const env = (disposition, ops, reply = '') => ({ disposition, reply, question: null, ops, unsupported_category: null })
const STRONGEST = { action: 'screener.run', target: 's1', args: { filters: [], sort_field: 'rs_rank', sort_dir: 'desc', mode: 'new', show: null, as: 'screen1', within: null } }
const ADD = (top) => ({ action: 'watchlist.add', target: 'w2', args: { symbols: { from: 'screen1', top } } })
const T = (n, rs) => Array.from({ length: n }, (_, i) => ({ ticker: `X${String(i + 1).padStart(2, '0')}`, company: 'x', price: 60, chg_pct_1d: 0, rs_rank: typeof rs === 'function' ? rs(i) : rs }))

async function mount() {
  const board = makeBoard([], { A: 'AAPL' }, { watchlists: [{ id: 'm1', name: 'Momentum', symbols: ['AAA'] }] })
  render(<AgentPanel host={board.host} onClose={() => {}} />)
  await loadMeta()
  const box = screen.getByLabelText('Message UCT Agent')
  const say = async (t) => { await waitFor(() => expect(box.disabled).toBe(false), { timeout: 6000 }); fireEvent.change(box, { target: { value: t } }); fireEvent.keyDown(box, { key: 'Enter' }) }
  return { ...board, say }
}
const items = (state) => state.server.lists[0].items.map(i => i.sym)

describe('a first-N of a ranking whose field has NO values is refused — nothing is added', () => {
  it('"put my 10 strongest stocks in Momentum" with every RS Rank missing: refusal, no receipt, list unchanged', async () => {
    universe = T(30, null)
    const { state, say } = await mount()
    envelopes.push(env('propose', [STRONGEST, ADD(10)]))
    await say('put my 10 strongest stocks in Momentum')
    await screen.findByTestId('agent-proposal', {}, { timeout: 6000 })
    await say('do it')
    await waitFor(() => expect(screen.getByTestId('agent-transcript').textContent)
      .toMatch(/RS Rank data is unavailable for those results, so the highest 10 by RS Rank can't be established from the available data — nothing was added/), { timeout: 6000 })
    expect(screen.queryByTestId('agent-receipt')).toBeNull()
    expect(items(state)).toEqual(['AAA'])                                          // nothing arbitrary added
  })

  it('ALL of the results (top null) is still allowed — membership does not depend on the order', async () => {
    universe = T(5, null)
    const { state, say } = await mount()
    envelopes.push(env('propose', [STRONGEST, ADD(null)]))
    await say('put all of those in Momentum')
    await screen.findByTestId('agent-proposal', {}, { timeout: 6000 })
    await say('do it')
    const r = await screen.findByTestId('agent-receipt', {}, { timeout: 6000 })
    expect(r.textContent).toMatch(/RS Rank data is unavailable for these results/)  // said, not hidden
    expect(items(state)).toEqual(['AAA', 'X01', 'X02', 'X03', 'X04', 'X05'])
  })

  it('PARTIAL coverage: the top N proceeds and the receipt says how many carry an RS Rank', async () => {
    universe = T(12, (i) => (i < 4 ? 99 - i : null))
    const { state, say } = await mount()
    envelopes.push(env('propose', [STRONGEST, ADD(3)]))
    await say('put my 3 strongest stocks in Momentum')
    await screen.findByTestId('agent-proposal', {}, { timeout: 6000 })
    await say('do it')
    const r = await screen.findByTestId('agent-receipt', {}, { timeout: 6000 })
    expect(r.textContent).toMatch(/only 4 of 12 have RS Rank values; the rest are not ranked by it/)
    expect(items(state)).toEqual(['AAA', 'X01', 'X02', 'X03'])
  })

  it('FULL coverage: unchanged — the top N by RS Rank, no coverage note', async () => {
    universe = T(8, (i) => 90 - i)
    const { state, say } = await mount()
    envelopes.push(env('propose', [STRONGEST, ADD(2)]))
    await say('put my 2 strongest stocks in Momentum')
    await screen.findByTestId('agent-proposal', {}, { timeout: 6000 })
    await say('do it')
    const r = await screen.findByTestId('agent-receipt', {}, { timeout: 6000 })
    expect(r.textContent).not.toMatch(/unavailable|only \d+ of/)
    expect(items(state)).toEqual(['AAA', 'X01', 'X02'])
  })
})

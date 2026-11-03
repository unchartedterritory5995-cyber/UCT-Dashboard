// W1-C C-05 (builder-c): the flagship scan slice, deterministic with the SCRIPTED model. "Find stocks above their 20
// EMA with volume at least twice average, drop anything under $10, and put the top five by three-month change in a
// watchlist" is ONE plan: screener.run (a validated SC-1 spec on PUBLIC fields only) → watchlist.create → watchlist.add
// {from: screen1, top: 5} (compose.js refs), shown as ONE approval card, applied with 0 model calls: the screen runs
// fresh, the list is created and filled with exactly the engine's top five in its order. The server half (the same
// spec through the real screen.run against seeded rows) is tests/test_uct_agent_scan_flagship.py. No provider.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { refsOf, checkRefs } from './compose'
import { _resetScreenerCache, loadMeta } from './capabilities/screener'
import { refineRefusal, hiddenKeys } from './capabilities/scanRefine'
import { makeBoard } from './__fixtures__/board'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'

registerBuiltins()

// The flagship phrase as the model's screener.run args (SC-2 §4 vocabulary: above the 20-day EMA = pct_vs_ema20 > 0;
// volume at least twice average = vol_ratio ≥ 2, full session vs 30-day average; under $10 = price ≥ 10; three-month
// change = chg_pct_3m). Every field is a PUBLIC catalog key.
const FLAGSHIP = {
  filters: [
    { field: 'pct_vs_ema20', op: 'gt', value: 0, max: null, values: null },
    { field: 'vol_ratio', op: 'gte', value: 2, max: null, values: null },
    { field: 'price', op: 'gte', value: 10, max: null, values: null },
  ],
  sort_field: 'chg_pct_3m', sort_dir: 'desc', mode: 'new', show: null, as: 'screen1', within: null,
}
const META = { fields: [
  { key: 'pct_vs_ema20', label: '% vs 20 EMA', type: 'range', unit: '%' }, { key: 'vol_ratio', label: 'Volume Ratio', type: 'range', unit: '' },
  { key: 'price', label: 'Price', type: 'range', unit: '$' }, { key: 'chg_pct_3m', label: 'Change 3M', type: 'range', unit: '%' },
  { key: 'rs_rank', label: 'RS Rank', type: 'range', unit: '' },
] }
// A 20-row fixture universe: 12 pass every filter with distinct 3-month changes; 4 traps each fail exactly one filter
// but would rank first; NOCHG passes the filters with no 3-month change (a match, ranked last).
const UNIVERSE = [
  ...Array.from({ length: 12 }, (_, i) => ({ ticker: `PASS${String(i).padStart(2, '0')}`, price: 12 + i, pct_vs_ema20: 1 + i, vol_ratio: 2 + i / 10, chg_pct_3m: 5 + 3 * i })),
  { ticker: 'UNDER10', price: 9.99, pct_vs_ema20: 4, vol_ratio: 3, chg_pct_3m: 99 },
  { ticker: 'BELOWEMA', price: 50, pct_vs_ema20: -0.5, vol_ratio: 3, chg_pct_3m: 98 },
  { ticker: 'THINVOL', price: 50, pct_vs_ema20: 4, vol_ratio: 1.9, chg_pct_3m: 97 },
  { ticker: 'NOCHG', price: 50, pct_vs_ema20: 4, vol_ratio: 3, chg_pct_3m: null },
]
const ok = (r, f) => (f.op === 'gt' ? r[f.key] > f.min : f.op === 'gte' ? r[f.key] >= f.min : f.op === 'lt' ? r[f.key] < f.max : f.op === 'lte' ? r[f.key] <= f.max : true)
function engine(body) {
  let rows = UNIVERSE.filter(r => body.filters.every(f => ok(r, f)))
  if (body.sort?.key) {
    const k = body.sort.key; const sgn = body.sort.dir === 'asc' ? 1 : -1
    rows = [...rows].sort((a, b) => (a[k] == null) - (b[k] == null) || sgn * (a[k] - b[k]))     // nulls last, like the engine
  }
  const start = ((body.page || 1) - 1) * body.page_size
  return { total: rows.length, rows: rows.slice(start, start + body.page_size), snapshot_date: '2026-10-30' }
}

let calls, envelopes
beforeEach(() => {
  _resetScreenerCache()
  try { localStorage.clear() } catch { /* */ }
  calls = []; envelopes = []
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null
    calls.push([init.method || 'GET', String(url), body])
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
    if (url === '/api/screener/fields') return json(META)
    if (url === '/api/screener/saved-screens') return json({ saved: [], starters: [] })
    if (url === '/api/screener/scan') return json(engine(body))
    if (url === '/api/agent/turn') return json({ conversationId: 'ac_1', envelope: envelopes.shift(), usage: { research_calls: 0, citations: [] } })
    if (url === '/api/agent/record') return json({ conversationId: 'ac_1' })
    if (/\/state\/lastScreen$/.test(String(url))) return json({ key: 'lastScreen', value: body?.value || null })
    if (String(url).startsWith('/api/ticker-search')) return json({ results: [] })
    return json({ conversations: [] })
  })
})
afterEach(() => { vi.restoreAllMocks() })

const env = (disposition, ops, reply = '') => ({ disposition, reply, question: null, ops, unsupported_category: null })
const turns = () => calls.filter(c => c[1] === '/api/agent/turn').length
const scans = () => calls.filter(c => c[1] === '/api/screener/scan')
async function mount() {
  const board = makeBoard([], { A: 'AAPL' }, { watchlists: [{ id: 'm1', name: 'Momentum', symbols: ['PASS00'] }] })
  render(<AgentPanel host={board.host} onClose={() => {}} />)
  await loadMeta()
  const box = screen.getByLabelText('Message UCT Agent')
  const say = (t) => { fireEvent.change(box, { target: { value: t } }); fireEvent.keyDown(box, { key: 'Enter' }) }
  return { ...board, say }
}
const S = 's1'; const LIB = 'w3'       // the model's context refs for the screener entry and the watchlist library
const TOP5 = ['PASS11', 'PASS10', 'PASS09', 'PASS08', 'PASS07']

describe('flagship scan slice: one validated public-field spec → one approval card → watchlist.create + add', () => {
  it('the spec names public fields only, and the composition refs check', () => {
    const keys = [...FLAGSHIP.filters.map(f => f.field), FLAGSHIP.sort_field]
    expect(keys.some(k => hiddenKeys().has(k))).toBe(false)
    expect(refineRefusal(keys)).toBeNull()
    const ops = [
      { action: 'screener.run', target: S, args: FLAGSHIP },
      { action: 'watchlist.create', target: LIB, args: { name: 'Momentum Review', as: 'new1' } },
      { action: 'watchlist.add', target: 'new1', args: { symbols: { from: 'screen1', top: 5 } } },
    ]
    expect(refsOf(ops)).toHaveLength(1)
    expect(checkRefs(ops)).toBeNull()
  })
  it('scripted model → ONE proposal card (no symbols guessed, no scan yet); "do it" → one fresh scan, the list made and filled with the top five in the engine\'s order, 0 model calls', async () => {
    const { state, say } = await mount()
    envelopes.push(env('propose', [
      { action: 'screener.run', target: S, args: FLAGSHIP },
      { action: 'watchlist.create', target: LIB, args: { name: 'Momentum Review', as: 'new1' } },
      { action: 'watchlist.add', target: 'new1', args: { symbols: { from: 'screen1', top: 5 } } },
    ]))
    say('Find stocks above their 20 EMA with volume at least twice average, drop anything under $10, and put the top five by three-month change in a watchlist called Momentum Review.')
    const card = await screen.findByTestId('agent-proposal')
    expect(screen.getAllByTestId('agent-proposal')).toHaveLength(1)
    expect(card.textContent).toContain('Screen for % vs 20 EMA > 0% · Volume Ratio ≥ 2 · Price ≥ $10, sorted by Change 3M — run fresh when you apply')
    expect(card.textContent).toContain('Create the watchlist “Momentum Review”')
    expect(card.textContent).toContain('Add the top 5 of its results to “Momentum Review”')
    expect(card.textContent).not.toMatch(/PASS\d\d|UNDER10|BELOWEMA|THINVOL|NOCHG/)
    expect(scans()).toHaveLength(0)
    expect(state.server.lists.some(l => l.name === 'Momentum Review')).toBe(false)
    const t = turns()
    say('do it')
    const receipt = await screen.findByTestId('agent-receipt', {}, { timeout: 4000 })
    expect(turns()).toBe(t)                                                                // Apply: no model call
    expect(scans()).toHaveLength(1)
    expect(scans()[0][2]).toMatchObject({ filters: [{ key: 'pct_vs_ema20', op: 'gt', min: 0 }, { key: 'vol_ratio', op: 'gte', min: 2 }, { key: 'price', op: 'gte', min: 10 }], sort: { key: 'chg_pct_3m', dir: 'desc' } })
    const made = state.server.lists.find(l => l.name === 'Momentum Review')
    expect(made.items.map(i => i.sym)).toEqual(TOP5)
    expect(receipt.textContent).toContain('Screened % vs 20 EMA > 0% · Volume Ratio ≥ 2 · Price ≥ $10: 13 matches')
    expect(receipt.textContent).toContain('Created the watchlist “Momentum Review”')
    expect(receipt.textContent).toContain('Added PASS11, PASS10, PASS09, PASS08 and PASS07 to “Momentum Review”')   // the product names a short add
    expect(calls.some(c => String(c[1]).startsWith('/api/ticker-search'))).toBe(false)   // trusted Screener output
    expect(calls.some(c => String(c[1]).startsWith('/api/live-prices'))).toBe(false)
  })
  it('the same plan with a hidden field in the sort is refused on the card (F-16), nothing is created', async () => {
    const { state, say } = await mount()
    envelopes.push(env('propose', [
      { action: 'screener.run', target: S, args: { ...FLAGSHIP, sort_field: 'rs_rank', mode: 'refine' } },
      { action: 'watchlist.create', target: LIB, args: { name: 'Momentum Review', as: 'new1' } },
      { action: 'watchlist.add', target: 'new1', args: { symbols: { from: 'screen1', top: 5 } } },
    ]))
    say('now the top five by RS rank into a new list')
    const shown = await screen.findByText(/Which screen should I narrow\?|proprietary ratings/, {}, { timeout: 4000 })
    expect(shown).toBeTruthy()
    expect(scans()).toHaveLength(0)
    expect(state.server.lists.some(l => l.name === 'Momentum Review')).toBe(false)
  })
})

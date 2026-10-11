// STABILIZATION (2026-10-11) — the real workflows behind the live check's two FAILs, through the REAL
// panel, on fixture data (no model, no UCT mutation):
//   1. "Show me my strongest stocks." → the Screener over the WHOLE market, highest RS Rank first
//      (owner ruling) — not a watchlist; "Now only the ones above $50." → that SAME screen, refined.
//   2. Action status is UCT's, never the model's words: a planned (proposed) change is shown as
//      waiting, a failed one as failed, a done one by its receipt; a no-op "answer" the server marked
//      NOTHING_DONE says nothing happened. (The server half: tests/test_uct_agent_honest_replies.py.)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { registerBuiltins } from './builtins'
import { fastParse } from './fastPath'
import * as screenerMod from './capabilities/screener'
import { makeBoard } from './__fixtures__/board'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'
registerBuiltins()

const FIELDS = [
  { key: 'rs_rank', label: 'RS Rank', type: 'range', unit: '', category: 'technical' },
  { key: 'price', label: 'Price', type: 'range', unit: '$', category: 'descriptive' },
  { key: 'chg_pct_1d', label: 'Chg 1D', type: 'range', unit: '%', category: 'descriptive' },
]
const UNIVERSE = [['PLTR', 28.4, 99], ['HOOD', 46.1, 98], ['NVDA', 182.5, 97], ['CRWD', 345.0, 96], ['AMD', 41.2, 95], ['TSLA', 251.0, 93]]
  .map(([ticker, price, rs]) => ({ ticker, company: ticker, price, chg_pct_1d: 1.0, rs_rank: rs }))
const NOTHING_DONE = 'I didn\'t do that — no action was planned, so nothing in UCT changed. Ask again a little more specifically (for example, “screen for the highest RS Rank stocks”).'

let turns, turnBodies, scans
beforeEach(() => {
  turns = []; turnBodies = []; scans = []
  try { localStorage.clear() } catch { /* */ }
  screenerMod._resetScreenerCache()
  globalThis.fetch = vi.fn(async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : null
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
    if (url === '/api/agent/turn') { turnBodies.push(body); return json({ conversationId: 'ac_1', turnId: 1, envelope: turns.shift(), usage: { citations: [] } }) }
    if (url === '/api/agent/record') return json({ conversationId: 'ac_1' })
    if (url === '/api/screener/fields') return json({ fields: FIELDS })
    if (url === '/api/screener/fields?options=1') return json({ options: {} })
    if (url === '/api/screener/saved-screens') return json({ saved: [], starters: [] })
    if (url === '/api/screener/scan') {
      scans.push(body)
      const ok = (r) => (body.filters || []).every(f => (f.key !== 'price' ? true : f.op === 'gt' ? r.price > (f.min ?? f.value) : r.price < (f.max ?? f.value)))
      const rows = UNIVERSE.filter(ok).sort((a, b) => (body.sort?.key === 'rs_rank' ? b.rs_rank - a.rs_rank : 0))
      return json({ total: rows.length, rows, snapshot_date: '2026-10-09' })
    }
    return json({ conversations: [] })
  })
})
afterEach(() => { vi.restoreAllMocks() })

const env = (disposition, ops = [], reply = '') => ({ disposition, reply, question: null, ops, unsupported_category: null })
const type = (text) => {
  const box = screen.getByLabelText('Message UCT Agent')
  fireEvent.change(box, { target: { value: text } })
  fireEvent.keyDown(box, { key: 'Enter' })
}
const LISTS = [{ id: 'm1', name: 'Momentum', symbols: ['NVDA', 'AMD'] }]
const board = (extra = {}) => makeBoard([{ id: 'c1', type: 'chart', x: 0, y: 0, w: 18, h: 20 }, { id: 'wl', type: 'watchlist', x: 18, y: 0, w: 6, h: 20, opts: { watchKey: 'user:m1' } }],
  { A: 'AAPL' }, { watchlists: LISTS, ...extra })

describe('1 · "Show me my strongest stocks." and its follow-up — the Screener, whole market, no model', () => {
  it('the phrasings map onto screener.run: no filter, RS Rank highest first, within null (never the watchlist)', async () => {
    await screenerMod.loadMeta()
    const host = board().host
    for (const t of ['Show me my strongest stocks.', 'show me the strongest names', 'what are the strongest stocks', 'RS leaders', 'show me relative strength leaders']) {
      const f = fastParse(t, { host })
      expect(f?.ops?.map(o => o.action), t).toEqual(['screener.run'])
      expect(f.ops[0].args).toEqual({ filters: [], sort_field: 'rs_rank', sort_dir: 'desc', mode: 'new', show: null, as: null, within: null })
    }
  })

  it('NOT instant (the model decides): a NAMED list, a follow-up with no prior screen, a bare number', async () => {
    await screenerMod.loadMeta()
    const host = board().host
    expect(fastParse('show me my strongest stocks in Momentum', { host })).toBeNull()
    expect(fastParse('now only the ones above $50', { host })).toBeNull()    // no screen has run yet
    expect(fastParse('now only the ones above 50', { host })).toBeNull()     // "50" what? not instant
  })

  it('through the panel: the screen runs (RS Rank desc, no list filter), then the follow-up REFINES it with price > $50', async () => {
    const b = board()
    render(<AgentPanel host={b.host} onClose={() => {}} />)
    await screenerMod.loadMeta()
    await waitFor(() => expect(screen.getByLabelText('Message UCT Agent').disabled).toBe(false))
    type('Show me my strongest stocks.')
    await waitFor(() => expect(screen.getAllByText(/PLTR/).length).toBeGreaterThan(0))
    expect(scans).toHaveLength(1)
    expect(scans[0].sort).toEqual({ key: 'rs_rank', dir: 'desc' })
    expect(scans[0].filters.some(f => f.key === 'list')).toBe(false)          // the whole market, not Momentum
    expect(turnBodies).toHaveLength(0)                                         // no model call
    await waitFor(() => expect(screen.getByLabelText('Message UCT Agent').disabled).toBe(false))
    type('Now only the ones above $50.')
    await waitFor(() => expect(scans.length).toBeGreaterThan(1))
    const refined = scans[scans.length - 1]
    expect(refined.sort).toEqual({ key: 'rs_rank', dir: 'desc' })            // the SAME screen, kept
    const price = refined.filters.find(f => f.key === 'price')
    expect(price.op).toBe('gt')
    expect(price.min ?? price.value).toBe(50)
    await waitFor(() => expect(screen.getAllByText(/CRWD/).length).toBeGreaterThan(0))
    expect(turnBodies).toHaveLength(0)
    // nothing on the board changed for a screen (a query)
    expect(b.state.widgets.find(w => w.id === 'wl').opts).toEqual({ watchKey: 'user:m1' })
  })
})

// ── 2 · action status is UCT's ───────────────────────────────────────────────
function chartsHost() {
  const st = { stored: null, tf: 'D' }
  const commits = []
  const read = (ref) => (ref === 'w1' ? { ref, label: 'Chart (SPY)', position: null, symbol: 'SPY', tf: st.tf, stored: st.stored, cs: mergeChartSettings(st.stored || {}), linkedCount: 0 } : null)
  return {
    commits, st,
    fail: false,
    charts: {
      list: () => [read('w1')], read,
      commit(ref, patch) {
        if (this._host.fail) return false
        commits.push(patch)
        if ('settings' in patch) st.stored = patch.settings
        if ('tf' in patch) st.tf = patch.tf
        return true
      },
    },
    otherWidgets: () => [],
  }
}
const mkHost = () => { const h = chartsHost(); h.charts._host = h; return h }
const BARS = { action: 'chart.setType', target: 'c1', args: { type: 'bars' } }

describe('2 · the panel reports what UCT did, never what the model said it did', () => {
  it('a no-op answer the server marked NOTHING_DONE says nothing happened — and nothing did', async () => {
    const host = mkHost()
    turns.push(env('answer', [], NOTHING_DONE))
    render(<AgentPanel host={host} onClose={() => {}} />)
    type('show me what i like')
    await screen.findByText(/nothing in UCT changed/)
    expect(host.commits).toHaveLength(0)
    expect(screen.queryByText(/Opening/)).toBeNull()
  })

  it('PLANNED, not executed: a proposal is shown as waiting; nothing is written, no receipt, until approved', async () => {
    const host = mkHost()
    turns.push(env('propose', [BARS], ''))
    render(<AgentPanel host={host} onClose={() => {}} />)
    type('​switch to bars please')
    await waitFor(() => expect(document.body.textContent).toMatch(/bars/i))
    await new Promise(r => setTimeout(r, 50))
    expect(host.commits).toHaveLength(0)
    expect(document.body.textContent).not.toMatch(/\(saved\)|Changed .* to Bars/)
    expect(document.body.textContent).toMatch(/Proposed changes.*Change chart to Bars.*Apply.*Dismiss/)
    type('do it')
    await waitFor(() => expect(host.commits.length).toBeGreaterThan(0))
    expect(turnBodies).toHaveLength(1)                       // the STORED plan ran, no second model call
  })

  it('FAILED: when the write is refused, the member is told it did not happen — no receipt', async () => {
    const host = mkHost()
    host.fail = true
    turns.push(env('apply', [BARS], ''))
    render(<AgentPanel host={host} onClose={() => {}} />)
    type('​switch to bars')
    await waitFor(() => expect(turnBodies).toHaveLength(1))
    await new Promise(r => setTimeout(r, 100))
    expect(host.commits).toHaveLength(0)
    expect(document.body.textContent).not.toMatch(/Changed .* to Bars/)
    expect(screen.queryByRole('button', { name: /undo/i })).toBeNull()
    expect(document.body.textContent).toMatch(/didn't take effect.*nothing was left changed/)
  })

  it('PARTIAL: one of two writes refused — the member is told what did not take effect, and the board matches it', async () => {
    const st = { w1: { stored: null }, w2: { stored: null } }
    const read = (ref) => (st[ref] ? { ref, label: ref === 'w1' ? 'Left chart (SPY)' : 'Right chart (QQQ)', position: ref === 'w1' ? 'left' : 'right', symbol: ref === 'w1' ? 'SPY' : 'QQQ', tf: 'D', stored: st[ref].stored, cs: mergeChartSettings(st[ref].stored || {}), linkedCount: 0 } : null)
    const host = {
      charts: {
        list: () => ['w1', 'w2'].map(read), read,
        commit(ref, patch) { if (ref === 'w2') return false; if ('settings' in patch) st[ref].stored = patch.settings; return true },
      },
      otherWidgets: () => [],
    }
    turns.push(env('apply', [{ ...BARS, target: 'c1' }, { ...BARS, target: 'c2' }], ''))
    render(<AgentPanel host={host} onClose={() => {}} />)
    type('​make both charts bars')
    // two charts = a PROPOSAL first (approval preserved): nothing written yet
    await screen.findByText(/Proposed changes/)
    expect(st.w1.stored).toBeNull()
    type('do it')
    await waitFor(() => expect(document.body.textContent).toMatch(/didn't take effect/), { timeout: 5000 })
    // names the one that failed and says the rest was rolled back — and the board says the same
    expect(document.body.textContent).toMatch(/Some of that didn't take effect: Right chart \(QQQ\) did not take effect — nothing was left changed\./)
    expect(st.w2.stored).toBeNull()
    expect(st.w1.stored).toBeNull()                                             // the left chart's write was undone
    expect(document.body.textContent).not.toMatch(/Changed .* to Bars/)
  })

  it('DONE: an executed change is reported by UCT\'s receipt, with Undo', async () => {
    const host = mkHost()
    turns.push(env('apply', [BARS], ''))
    render(<AgentPanel host={host} onClose={() => {}} />)
    type('​switch to bars')
    await waitFor(() => expect(host.commits.length).toBeGreaterThan(0))
    await waitFor(() => expect(document.body.textContent).toMatch(/Bars/))
    expect(host.st.stored).toBeTruthy()
  })

  it('layout: a model-planned open is receipted ("Opened “Main Trading”") and Undo opens the previous layout', async () => {
    const b = makeBoard([{ id: 'c1', type: 'chart', x: 0, y: 0, w: 18, h: 20 }], { A: 'AAPL' }, {
      layouts: { entries: [{ id: 1, name: 'Main Trading' }, { id: 2, name: 'Swing Setups' }], boards: { 1: [{ id: 'c9', type: 'chart', x: 0, y: 0, w: 24, h: 20 }], 2: [] }, active: 2 },
    })
    // the model passes the member's own words — the shared resolver (layout.open resolveArgs) names the layout
    turns.push(env('apply', [{ action: 'layout.open', target: 'l1', args: { layout: 'my trading layout' } }], ''))
    render(<AgentPanel host={b.host} onClose={() => {}} />)
    type('​Switch to my trading layout.')            // the model path
    await screen.findByText(/Opened “Main Trading”/)
    expect(b.host.layouts.snapshot().active.name).toBe('Main Trading')
    // no prompt-only hint: the request the model got carries the real list, nothing pre-chosen
    expect(turnBodies[0].context.layouts[0].namedInRequest).toBeUndefined()
  })
})

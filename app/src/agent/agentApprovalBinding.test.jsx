// ⛔ GATE C RELEASE BLOCKER — APPROVAL BINDING (2026-10-16). Regression tests for the approval-safety
// audit (docs/agent/charts-mastery/APPROVAL-SAFETY-AUDIT.md on feat/agent-charts-mastery @ bd5e709446).
//
// What the member approves is what runs, or nothing runs:
//   • every proposal carries a STRUCTURED binding (executor.approvalBinding): each target's identity, its
//     material state and the exact planned change — "do it" re-plans and runs only on an identical one;
//   • before that re-plan, targets with an authority are RE-READ from it (another tab / device), and a
//     target that can't be re-read fails the approval CLOSED;
//   • any other change that RUNS (a write, an Undo) withdraws a waiting proposal; answers don't;
//   • every proposal expires after 10 minutes.
// The REAL panel (AgentPanel → useAgent → planner → runtime) with a scripted model. No network, no paid call.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { makeBoard } from './__fixtures__/board'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { PROPOSAL_TTL_MS } from './capabilities/indicatorAuthoring'
import { _resetScreenerCache, loadMeta } from './capabilities/screener'
import { getCapability } from './capabilities'
import { buildWidgetSync } from './host'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'
registerBuiltins()

let turns, script, screenServer
const env = (o) => ({ conversationId: 'c1', envelope: { disposition: 'answer', reply: '', question: null, ops: [], unsupported_category: null, ...o }, usage: {} })
beforeEach(() => {
  turns = []
  script = () => env({ reply: 'ok' })
  _resetScreenerCache()
  screenServer = { saved: [] }
  try { localStorage.clear() } catch { /* */ }
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const u = String(url)
    const m = (init.method || 'GET').toUpperCase()
    const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } })
    const body = init.body ? JSON.parse(init.body) : null
    if (u === '/api/agent/turn' || u === '/api/agent/turn/stream') { turns.push(body); return json(script(body, turns.length)) }
    if (u === '/api/agent/record') return json({ conversationId: 'c1' })
    if (u === '/api/agent/config') return json({ stream: false })
    if (u.includes('ticker-search') || u.includes('/api/tickers')) return json({ results: ['AMD', 'NVDA', 'TSLA', 'QQQ', 'AAA', 'BBB'].map(t => ({ ticker: t, symbol: t })) })
    if (u === '/api/screener/fields') return json({ fields: [{ key: 'adr_pct', label: 'ADR %', type: 'range', unit: '%' }, { key: 'price', label: 'Price', type: 'range', unit: '$' }] })
    if (u === '/api/screener/scan') return json({ total: 2, rows: [{ ticker: 'AAA', adr_pct: 9, price: 60 }, { ticker: 'BBB', adr_pct: 7, price: 55 }], snapshot_date: '2026-10-15' })
    if (u === '/api/screener/saved-screens' && m === 'GET') return json({ saved: screenServer.saved, starters: [] })
    if (u === '/api/screener/saved-screens' && m === 'POST') { const row = { id: 900 + screenServer.saved.length, name: body.name, spec: body.spec }; screenServer.saved.unshift(row); return json(row) }
    return json({ conversations: [] })
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

// a board: a chart, a Watchlist widget showing Momentum; saved lists Momentum (2) and Swing (1)
function board() {
  return makeBoard([
    { id: 'L', type: 'chart', x: 0, y: 0, w: 12, h: 20, opts: { tf: 'D', settings: { background: '#202020' } } },
    { id: 'R', type: 'chart', x: 12, y: 0, w: 8, h: 20, color: 'B', opts: { tf: 'D' } },
    { id: 'WL', type: 'watchlist', x: 20, y: 0, w: 4, h: 20, color: 'N', opts: { watchKey: 'user:m1' } },
  ], { A: 'NVDA', B: 'AMD' }, {
    watchlists: [{ id: 'm1', name: 'Momentum', symbols: ['NVDA', 'AMD'] }, { id: 's1', name: 'Swing', symbols: ['TSLA'] }],
    layouts: { entries: [{ id: 1, name: 'Swing Board' }, { id: 2, name: 'Day Trading' }], boards: {}, active: 1 },
  })
}
const sec = (body, key) => body.context[key] || []
const listRef = (body, name) => sec(body, 'watchlists').find(l => l.name === name)?.ref
const boardRef = (body) => sec(body, 'board')[0]?.ref
const chartRef = (body, id) => sec(body, 'charts').find(c => c.label === `Chart ${id}`)?.ref
const op = (action, target, args = {}) => ({ action, target, args })
const apply = (...ops) => env({ disposition: 'apply', ops })
const propose = (...ops) => env({ disposition: 'propose', ops, reply: 'Here is the plan.' })
const onServer = (b, id) => b.state.server.lists.find(l => l.id === id) || null
const serverSyms = (b, id) => onServer(b, id)?.items.map(i => i.sym) ?? null

function mount(host) {
  render(<AgentPanel host={host} onClose={() => {}} />)
  const box = screen.getByLabelText('Message UCT Agent')
  const say = async (t) => {
    await waitFor(() => { expect(box.disabled).toBe(false); expect(document.querySelector('[data-testid=agent-typing]')).toBeNull() }, { timeout: 8000 })
    fireEvent.change(box, { target: { value: t } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(box.value).toBe(''), { timeout: 4000 })
    await waitFor(() => expect(document.querySelector('[data-testid=agent-typing]')).toBeNull(), { timeout: 8000 })
  }
  return { say, transcript: () => screen.getByTestId('agent-transcript').textContent }
}
const settle = () => new Promise(r => setTimeout(r, 250))

describe('H1 watchlist.delete — what was approved is what runs, or nothing runs', () => {
  const deleteSwing = () => { script = (body) => apply(op('watchlist.delete', listRef(body, 'Swing'))) }

  it('AUDIT REPRO (in conversation): the card says 1 stock; a fast-path add while it waits WITHDRAWS it; "do it" deletes nothing', async () => {
    const b = board()
    const { say, transcript } = mount(b.host)
    deleteSwing()
    await say('delete my swing watchlist')
    await waitFor(() => expect(transcript()).toMatch(/Delete the watchlist “Swing” and its 1 stock \(permanent\)/))
    await say('add NVDA and AMD to swing')                                 // fast path: a write that RUNS
    await waitFor(() => expect(serverSyms(b, 's1')).toEqual(['TSLA', 'NVDA', 'AMD']))
    await waitFor(() => expect(transcript()).toMatch(/I withdrew the proposal above because something changed/))
    await say('do it')
    await waitFor(() => expect(transcript()).toMatch(/There is no proposal waiting/))
    expect(serverSyms(b, 's1')).toEqual(['TSLA', 'NVDA', 'AMD'])          // nothing deleted
    expect(transcript()).not.toMatch(/Deleted the watchlist/)
  })

  it('ANOTHER DEVICE grows the list after the card: "do it" re-reads the server and refuses; the list is untouched', async () => {
    const b = board()
    const { say, transcript } = mount(b.host)
    deleteSwing()
    await say('delete my swing watchlist')
    await waitFor(() => expect(transcript()).toMatch(/and its 1 stock \(permanent\)/))
    onServer(b, 's1').items.push({ id: 's1-x1', sym: 'NVDA', notes: '' }, { id: 's1-x2', sym: 'AMD', notes: '' })   // the cache does not know
    await say('do it')
    await waitFor(() => expect(transcript()).toMatch(/can’t run as you approved it — what it acts on has changed since I showed it to you/))
    expect(serverSyms(b, 's1')).toEqual(['TSLA', 'NVDA', 'AMD'])
    expect(b.state.server.calls.some(c => c[0] === 'DELETE')).toBe(false)
  })

  it('the list can’t be re-read at approval: fails CLOSED, nothing deleted', async () => {
    const b = board()
    const { say, transcript } = mount(b.host)
    deleteSwing()
    await say('delete my swing watchlist')
    await waitFor(() => expect(transcript()).toMatch(/and its 1 stock/))
    b.state.server.failOn = (method, path) => method === 'GET' && path.startsWith('/api/watchlists/s1')
    await say('do it')
    await waitFor(() => expect(transcript()).toMatch(/I couldn’t re-check that watchlist against your account just now, so nothing was changed/))
    expect(onServer(b, 's1')).not.toBeNull()
  })

  it('LEGITIMATE: unchanged → "do it" deletes exactly what the card said', async () => {
    const b = board()
    const { say, transcript } = mount(b.host)
    deleteSwing()
    await say('delete my swing watchlist')
    await waitFor(() => expect(transcript()).toMatch(/and its 1 stock/))
    await say('do it')
    await waitFor(() => expect(onServer(b, 's1')).toBeNull())
    expect(transcript()).toMatch(/Deleted the watchlist “Swing” and its 1 stock \(permanent\)/)
  })

  it('LEGITIMATE: a question answered in between keeps the card; "do it" still applies it', async () => {
    const b = board()
    const { say, transcript } = mount(b.host)
    deleteSwing()
    await say('delete my swing watchlist')
    await waitFor(() => expect(transcript()).toMatch(/and its 1 stock/))
    script = () => env({ reply: 'Swing holds TSLA.' })
    await say('what is in swing right now?')
    await waitFor(() => expect(transcript()).toMatch(/Swing holds TSLA/))
    await say('do it')
    await waitFor(() => expect(onServer(b, 's1')).toBeNull())
  })
})

describe('watchlist.clear — contents changed after the card', () => {
  const clearSwing = () => { script = (body) => apply(op('watchlist.clear', listRef(body, 'Swing'))) }
  it('another device added stocks: refused, nothing cleared', async () => {
    const b = board()
    const { say, transcript } = mount(b.host)
    clearSwing()
    await say('empty my swing watchlist')
    await waitFor(() => expect(transcript()).toMatch(/Clear all 1 stock from “Swing”/))
    onServer(b, 's1').items.push({ id: 's1-x1', sym: 'NVDA', notes: '' })
    await say('do it')
    await waitFor(() => expect(transcript()).toMatch(/what it acts on has changed since I showed it to you/))
    expect(serverSyms(b, 's1')).toEqual(['TSLA', 'NVDA'])
  })
  it('in this conversation (fast-path add while the card waits): withdrawn, nothing cleared', async () => {
    const b = board()
    const { say, transcript } = mount(b.host)
    clearSwing()
    await say('empty my swing watchlist')
    await waitFor(() => expect(transcript()).toMatch(/Clear all 1 stock/))
    await say('add NVDA to swing')
    await waitFor(() => expect(transcript()).toMatch(/I withdrew the proposal above/))
    await say('do it')
    await settle()
    expect(serverSyms(b, 's1')).toEqual(['TSLA', 'NVDA'])
  })
})

describe('screener.saveAs — the screen changed after the card', () => {
  it('a fast-path refine adds a filter while the card waits: "do it" refuses; asking again saves the new one', async () => {
    const b = board()
    await loadMeta()
    await getCapability('screener.run').answer(null, { filters: [{ field: 'adr_pct', op: 'gt', value: 5, max: null }], sort_field: null, sort_dir: null, mode: 'new', show: 5, as: null })
    const { say, transcript } = mount(b.host)
    const save = (body) => propose(op('screener.saveAs', sec(body, 'savedScreens')[0]?.ref || 'screens', { name: 'High ADR' }))
    script = save
    await say('save this screen as High ADR')
    await waitFor(() => expect(transcript()).toMatch(/Save the last screen \(1 filters\) as a new screen “High ADR”/))
    await say('now only the ones above $50')                                // a QUERY: it doesn't withdraw the card…
    await settle()
    await say('do it')                                                       // …but the screen it would save changed
    await waitFor(() => expect(transcript()).toMatch(/can’t run as you approved it — what it acts on has changed since I showed it to you/))
    expect(screenServer.saved).toEqual([])
    script = save
    await say('save this screen as High ADR')
    await waitFor(() => expect(transcript()).toMatch(/Save the last screen \(2 filters\)/))
    await say('do it')
    await waitFor(() => expect(screenServer.saved.map(s => s.spec.filters.length)).toEqual([2]))
  })
})

// ── indicators: identity / dependencies changed after the card ──
function chartHost() {
  const store = { c1: { cs: JSON.parse(JSON.stringify(mergeChartSettings(null))), tf: 'D', symbol: 'AAPL' } }
  const charts = [{ ref: 'c1', label: 'Chart (AAPL)', position: null }]
  const read = (c) => ({ ...c, symbol: store[c.ref].symbol, tf: store[c.ref].tf, cs: mergeChartSettings(JSON.stringify(store[c.ref].cs)), stored: store[c.ref].cs, linkedCount: 0 })
  const sync = { server: null, unreadable: false }
  return {
    store, sync,
    charts: {
      list: () => charts.map(read),
      read: (ref) => { const c = charts.find(x => x.ref === ref); return c ? read(c) : null },
      commit: (ref, patch) => {
        if ('settings' in patch) store[ref].cs = JSON.parse(JSON.stringify(patch.settings))
        if ('tf' in patch) store[ref].tf = patch.tf
        return true
      },
      canManageIndicators: () => true,
    },
    persist: async () => ({ ok: true }),
    otherWidgets: () => [],
    // the REAL comparator over a simulated server copy of this chart widget (another tab: `sync.server`)
    widgetInSync: buildWidgetSync({
      readLayout: async () => {
        if (sync.unreadable) throw new Error('offline')
        return { widgets: [{ id: 'c1', opts: { settings: sync.server ? sync.server : store.c1.cs, tf: store.c1.tf } }] }
      },
      localLayout: () => ({ widgets: [{ id: 'c1', opts: { settings: store.c1.cs, tf: store.c1.tf } }] }),
      settleMs: 0, tries: 0,
    }),
  }
}
const live = (h) => (mergeChartSettings(JSON.stringify(h.store.c1.cs)).indicatorInstances || []).filter(i => !i.deleted)
const defIds = (h) => live(h).map(i => i.defId)

describe('indicator.remove — identity or dependencies changed after the card', () => {
  async function rsiCard(h, say, transcript) {
    script = () => env({ reply: 'ok' })
    await say('add RSI')
    await waitFor(() => expect(defIds(h)).toContain('rsi'), { timeout: 6000 })
    await waitFor(() => expect(screen.getAllByTestId('agent-receipt').length).toBe(1), { timeout: 6000 })
    await say('get rid of RSI')
    await screen.findByTestId('agent-proposal', {}, { timeout: 6000 })
    expect(transcript()).toMatch(/Remove RSI/)
  }

  const refused = /I didn't change anything|can’t run as you approved it/
  it('the RSI was replaced by hand (a new instance, same name): "do it" refuses; nothing removed', async () => {
    const h = chartHost()
    const { say, transcript } = mount(h)
    await rsiCard(h, say, transcript)
    const rsi = live(h).find(i => i.defId === 'rsi')
    h.store.c1.cs = { ...h.store.c1.cs, indicatorInstances: h.store.c1.cs.indicatorInstances.map(i => (i.instanceId === rsi.instanceId ? { ...i, instanceId: 'manual-rsi' } : i)) }
    await say('do it')
    await waitFor(() => expect(transcript().split('do it').pop()).toMatch(refused))
    expect(live(h).map(i => i.instanceId)).toContain('manual-rsi')
  })

  it('the RSI’s own settings were changed by hand after the card: "do it" refuses; RSI stays', async () => {
    const h = chartHost()
    const { say, transcript } = mount(h)
    await rsiCard(h, say, transcript)
    const rsi = live(h).find(i => i.defId === 'rsi')
    const key = Object.keys(rsi.inputs || {})[0]
    expect(key).toBeTruthy()
    h.store.c1.cs = { ...h.store.c1.cs, indicatorInstances: h.store.c1.cs.indicatorInstances.map(i => (i.instanceId === rsi.instanceId ? { ...i, inputs: { ...i.inputs, [key]: typeof i.inputs[key] === 'number' ? i.inputs[key] + 7 : i.inputs[key] } } : i)) }
    await say('do it')
    await waitFor(() => expect(transcript().split('do it').pop()).toMatch(refused))
    expect(defIds(h)).toContain('rsi')
  })

  it('ANOTHER TAB changed this chart’s indicators (the server copy differs): refused; RSI stays', async () => {
    const h = chartHost()
    const { say, transcript } = mount(h)
    await rsiCard(h, say, transcript)
    h.sync.server = { ...h.store.c1.cs, indicatorInstances: [] }
    await say('do it')
    await waitFor(() => expect(transcript()).toMatch(/that chart was changed in another window or device/))
    expect(defIds(h)).toContain('rsi')
  })

  it('the server copy can’t be read: fails CLOSED; RSI stays', async () => {
    const h = chartHost()
    const { say, transcript } = mount(h)
    await rsiCard(h, say, transcript)
    h.sync.unreadable = true
    await say('do it')
    await waitFor(() => expect(transcript()).toMatch(/I couldn’t re-check that chart’s indicators against your account just now/))
    expect(defIds(h)).toContain('rsi')
  })

  it('LEGITIMATE: an unrelated chart change (candle colour) does not block it — "do it" removes RSI', async () => {
    const h = chartHost()
    const { say, transcript } = mount(h)
    await rsiCard(h, say, transcript)
    h.store.c1.cs = { ...h.store.c1.cs, candles: { ...(h.store.c1.cs.candles || {}), upColor: '#00ff00' } }
    await say('do it')
    await waitFor(() => expect(defIds(h)).not.toContain('rsi'), { timeout: 6000 })
  })
})

describe('expiry — every proposal is good for 10 minutes', () => {
  it('an unsealed card (watchlist.delete) approved after 10 minutes is refused; nothing deleted', async () => {
    const b = board()
    const { say, transcript } = mount(b.host)
    script = (body) => apply(op('watchlist.delete', listRef(body, 'Swing')))
    await say('delete my swing watchlist')
    await waitFor(() => expect(transcript()).toMatch(/and its 1 stock/))
    const real = Date.now
    vi.spyOn(Date, 'now').mockImplementation(() => real() + PROPOSAL_TTL_MS + 1000)
    await say('do it')
    await waitFor(() => expect(transcript()).toMatch(/That proposal expired \(a proposal is good for 10 minutes\)/))
    expect(onServer(b, 's1')).not.toBeNull()
  })
  it('LEGITIMATE: approved at 9 minutes, it runs', async () => {
    const b = board()
    const { say, transcript } = mount(b.host)
    script = (body) => apply(op('watchlist.delete', listRef(body, 'Swing')))
    await say('delete my swing watchlist')
    await waitFor(() => expect(transcript()).toMatch(/and its 1 stock/))
    const real = Date.now
    vi.spyOn(Date, 'now').mockImplementation(() => real() + 9 * 60 * 1000)
    await say('do it')
    await waitFor(() => expect(onServer(b, 's1')).toBeNull())
  })
})

describe('a change that runs while a proposal waits withdraws it — an Undo too', () => {
  it('Undo of an earlier change withdraws the waiting card; "do it" then does nothing', async () => {
    const b = board()
    const { say, transcript } = mount(b.host)
    await say('add NVDA to swing')                                           // an earlier change, with Undo
    await waitFor(() => expect(serverSyms(b, 's1')).toEqual(['TSLA', 'NVDA']))
    script = (body) => apply(op('watchlist.delete', listRef(body, 'Swing')))
    await say('delete my swing watchlist')
    await waitFor(() => expect(transcript()).toMatch(/and its 2 stocks \(permanent\)/))
    await say('undo')
    await waitFor(() => expect(serverSyms(b, 's1')).toEqual(['TSLA']))
    await waitFor(() => expect(transcript()).toMatch(/I withdrew the proposal above/))
    await say('do it')
    await settle()
    expect(onServer(b, 's1')).not.toBeNull()
  })
})

describe('layouts and charts — material state changed while the card wording stays the same', () => {
  it('layout.saveCurrent: the board changed after the card (same wording) → refused, nothing saved', async () => {
    const b = board()
    const { say, transcript } = mount(b.host)
    b.state.layouts.unsaved = false
    script = (body) => env({ disposition: 'apply', ops: [op('layout.saveCurrent', sec(body, 'layouts')[0]?.ref)] })
    await say('save these changes to my layout')
    await waitFor(() => expect(transcript()).toMatch(/Save the current board into your layout “Swing Board”/))
    b.state.widgets = b.state.widgets.map(w => (w.id === 'R' ? { ...w, opts: { ...w.opts, tf: 'W' } } : w))   // edited by hand
    await say('do it')
    await waitFor(() => expect(transcript()).toMatch(/can’t run as you approved it/))
    expect(b.state.layouts.calls.filter(c => c[0] === 'saveCurrent')).toHaveLength(0)
  })

  it('chart.resetDefaults: another tab changed the chart → refused; LEGITIMATE when unchanged', async () => {
    const b = board()
    const { say, transcript } = mount(b.host)
    const reset = (body) => apply(op('chart.resetDefaults', chartRef(body, 'L')))
    script = reset
    await say('reset the left chart to defaults')
    await waitFor(() => expect(transcript()).toMatch(/Restore this chart's default look/))
    b.state.serverWidgets = b.state.widgets.map(w => (w.id === 'L' ? { ...w, opts: { ...w.opts, settings: { background: '#123456' } } } : w))
    await say('do it')
    await waitFor(() => expect(transcript()).toMatch(/that chart was changed in another window or device/))
    b.state.serverWidgets = null
    script = reset
    await say('reset the left chart to defaults')
    await waitFor(() => expect(screen.getAllByTestId('agent-proposal')).toHaveLength(2))
    await say('do it')
    await waitFor(() => expect(transcript()).toMatch(/Restored this chart's default look/))
  })
})

describe('special flows keep working, and stay bound', () => {
  it('screen-result selection: "add the top 2 of that screen to Swing" — the rule is approved, results resolve at Apply', async () => {
    const b = board()
    await loadMeta()
    await getCapability('screener.run').answer(null, { filters: [{ field: 'adr_pct', op: 'gt', value: 5, max: null }], sort_field: null, sort_dir: null, mode: 'new', show: 5, as: null })
    const { say } = mount(b.host)
    script = (body) => apply(op('watchlist.add', listRef(body, 'Swing'), { symbols: { from: 'lastScreen', top: 2 } }))
    await say('add the top 2 of that screen to swing')
    await waitFor(() => expect(screen.getAllByTestId('agent-proposal')).toHaveLength(1))
    await say('do it')
    await waitFor(() => expect(serverSyms(b, 's1')).toEqual(['TSLA', 'AAA', 'BBB']))
  })

  it('screen-result selection: the target list changed on another device after the card → refused', async () => {
    const b = board()
    await loadMeta()
    await getCapability('screener.run').answer(null, { filters: [{ field: 'adr_pct', op: 'gt', value: 5, max: null }], sort_field: null, sort_dir: null, mode: 'new', show: 5, as: null })
    const { say, transcript } = mount(b.host)
    script = (body) => apply(op('watchlist.add', listRef(body, 'Swing'), { symbols: { from: 'lastScreen', top: 2 } }))
    await say('add the top 2 of that screen to swing')
    await waitFor(() => expect(screen.getAllByTestId('agent-proposal')).toHaveLength(1))
    onServer(b, 's1').items.push({ id: 's1-x1', sym: 'QQQ', notes: '' })
    await say('do it')
    await waitFor(() => expect(transcript()).toMatch(/what it acts on has changed since I showed it to you/))
    expect(serverSyms(b, 's1')).toEqual(['TSLA', 'QQQ'])
  })

  it('"do the first two": only the first two run (bound); and refused if what they act on changed', async () => {
    const b = board()
    const { say, transcript } = mount(b.host)
    const links = (body) => propose(
      op('widget.setLink', boardRef(body), { widget: 'L', color: 'C' }),
      op('widget.setLink', boardRef(body), { widget: 'R', color: 'C' }),
      op('widget.setLink', boardRef(body), { widget: 'WL', color: 'C' }),
    )
    script = links
    await say('link everything green')
    await screen.findByTestId('agent-proposal')
    await say('do the first two')
    await waitFor(() => expect(b.state.widgets.find(w => w.id === 'R').color).toBe('C'))
    expect(b.state.widgets.find(w => w.id === 'L').color).toBe('C')
    expect(b.state.widgets.find(w => w.id === 'WL').color).toBe('N')
    // again, but the board changes by hand before the approval
    b.state.widgets = b.state.widgets.map(w => ({ ...w, color: w.id === 'WL' ? 'N' : 'A' }))
    script = links
    await say('link everything green')
    await waitFor(() => expect(screen.getAllByTestId('agent-proposal')).toHaveLength(2))
    b.state.widgets = b.state.widgets.map(w => (w.id === 'L' ? { ...w, x: 0, w: 11 } : w))
    await say('do the first two')
    await waitFor(() => expect(transcript()).toMatch(/can’t run as you approved it|changed/))
    expect(b.state.widgets.find(w => w.id === 'L').color).toBe('A')
  })
})

// ⭐ D18 item 3 (owner, 2026-11-14): REUSE A DISPLAYED CHART BY DEFAULT — a copy only on explicit, structurally-read intent.
// Owner rule: when a request names a set of charts and one of those symbols is already displayed, that chart is reused (the
// SAME ref), never duplicated; the existing chart is preserved unless the member authorises replacing it; an explicit request
// for another / a duplicate chart creates one. D18 item 2: a set-level "N more charts for …" with a displayed symbol is ASKED.
// (a) the copy-intent READER table, (b) the class MATRIX through the real planner and the plan-level screen, (c) the real
// panel: the set-level ask, the timeframe receipt, controls, exact Undo.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { makeBoard } from './__fixtures__/board'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { AuthContext } from '../context/AuthContext'
import { readCopyIntent, setMoreSymbols } from './copyIntent'
import { screenChartReuse, TF_NOTE } from './chartReuse'
import { planOps, collectTargets } from './executor'
import { chartRailRefusal, keepTickers, createdTickers, finalBoard } from './chartRail'
import { multiChartPlan, gridChoiceFor } from './multiChart'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'

registerBuiltins()

// ── (a) the reader ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const CASES = (s) => [s.toUpperCase(), s.toLowerCase(), s[0].toUpperCase() + s.slice(1).toLowerCase()]
describe('D18 · the copy-intent reader (structural): what is ATTACHED to the symbol or its chart noun', () => {
  const COPY = [
    ['add another NVDA chart', 1], ['a second NVDA', 1], ['a 2nd NVDA chart', 1], ['a third NVDA chart', 2], ['one more NVDA', 1],
    ['2 more NVDA charts', 2], ['NVDA again', 1], ['a NVDA chart again', 1], ['NVDA twice', 1], ['duplicate the NVDA chart', 1],
    ['a copy of NVDA', 1], ['a second chart of NVDA', 1], ['open AAPL, MSFT and a second NVDA', 1], ['an extra NVDA chart', 1],
    ['two NVDA charts', 1], ['a new NVDA chart', 1], ['add a second daily NVDA chart', 1],
  ]
  const NONE = ['open AAPL, MSFT and NVDA', 'add NVDA', 'show NVDA', 'bring up NVDA', 'put NVDA up', 'new charts for AAPL, MSFT and NVDA',
    '4 charts: SPY QQQ NVDA AMD', 'add another indicator on NVDA', 'one more line on NVDA', 'make the second chart NVDA', 'add 2 more charts for NVDA and AAPL',
    'add NVDA and AAPL', 'NVDA and AAPL side by side', 'open daily charts for AAPL, MSFT and NVDA']
  for (const [w, n] of COPY) for (const sym of CASES('NVDA')) {
    const words = w.replace(/NVDA/g, sym)
    it(`copy ×${n} · "${words}"`, () => expect(readCopyIntent(words, ['NVDA', 'AAPL', 'MSFT'], { NVDA: 1 }).NVDA).toBe(n))
  }
  for (const w of NONE) for (const sym of CASES('NVDA')) {
    const words = w.replace(/NVDA/g, sym)
    it(`none · "${words}"`, () => expect(readCopyIntent(words, ['NVDA', 'AAPL', 'MSFT', 'SPY', 'QQQ', 'AMD'], { NVDA: 1 }).NVDA).toBeUndefined())
  }
  it('set-level "N more charts": its symbols (D18 item 2), none for a bare count', () => {
    expect(setMoreSymbols('add 2 more charts for NVDA and AAPL', ['NVDA', 'AAPL'])).toEqual(['NVDA', 'AAPL'])
    expect(setMoreSymbols('add 4 more charts', ['NVDA'])).toEqual([])
    expect(setMoreSymbols('add another NVDA chart', ['NVDA'])).toBe(null)
  })
})

// ── (b) the class matrix: symbol shown or not × copy intent × layout × board × producer ─────────────────────────────────────────
const settings = () => ({ settings: mergeChartSettings(null) })
const BOARD_SYMS = ['NVDA', 'SPY', 'AMD']
const board = (n, h = 10) => [Array.from({ length: n }, (_, i) => ({ id: `c${i + 1}`, type: 'chart', x: i * 6, y: 0, w: 6, h, color: 'N', opts: settings() })),
  Object.fromEntries(Array.from({ length: n }, (_, i) => [`N:c${i + 1}`, BOARD_SYMS[i]]))]
const PRODUCERS = {
  'chartGrid.set new_charts': (syms, layout) => [{ action: 'chartGrid.set', target: 'board', args: { symbols: syms, timeframe: null, layout, new_charts: true, watchlist: null, replace: null } }],
  'widget.addCharts': (syms) => [{ action: 'widget.addCharts', target: 'workspace', args: { symbols: syms, timeframe: null, chart_type: null, exact: null } }],
  'widget.add + setSymbol': (syms) => [...syms.map((_, i) => ({ action: 'widget.add', target: 'workspace', args: { type: 'chart', as: `n${i}` } })), ...syms.map((s, i) => ({ action: 'chart.setSymbol', target: `n${i}`, args: { symbol: s } }))],
}
const INTENT = { none: (s) => `open AAPL and ${s}`, copy: (s) => `open AAPL and a second ${s}` }
/** plan as execute does: the reuse screen, then the planner with env.keepTickers, then the rails */
function planAsExecute(b, ops, words) {
  const r = screenChartReuse(ops, b.host, words, { copyResolved: true })
  if (!r.ops.length) return { reusedAll: r.reused, plan: null }
  const kinds = [...new Set(r.ops.map(o => (o.action === 'chartGrid.set' ? 'board' : o.action === 'chart.setSymbol' ? 'chart' : 'workspace')))]
  const plan = planOps(collectTargets(b.host, kinds), r.ops, { keepTickers: keepTickers(words, b.host, createdTickers(r.ops)) }, { surface: 'charts' })
  return { plan, reused: r.reused, refusal: plan.ok ? chartRailRefusal(plan, { words, host: b.host, mode: 'apply' }) : null }
}
describe('D18 · class matrix — the planned final board: displayed symbols are the SAME charts; a new chart only for unshown symbols and explicit copies', () => {
  for (const n of [1, 2, 3]) for (const shownSym of ['NVDA', 'TSLA']) for (const [iname, iw] of Object.entries(INTENT)) for (const [pname, prod] of Object.entries(PRODUCERS)) for (const layout of [null, 'grid', 'columns']) {
    if (pname !== 'chartGrid.set new_charts' && layout) continue
    const displayed = BOARD_SYMS.slice(0, n).includes(shownSym)
    it(`board ${n} · ${shownSym} ${displayed ? 'shown' : 'not shown'} · ${iname} · ${pname}${layout ? ` · ${layout}` : ''}`, () => {
      const b = makeBoard(...board(n))
      const words = iw(shownSym)
      const { plan, refusal, reusedAll } = planAsExecute(b, prod(['AAPL', shownSym], layout), words)
      if (reusedAll) throw new Error('AAPL is never shown — something must be created')
      if (!plan.ok) return                                         // no room: refused by the planner, nothing written
      expect(refusal, words).toBe(null)
      const fin = finalBoard(plan, b.host)
      const created = fin ? fin.created : []
      const wantNew = ['AAPL', ...(!displayed || iname === 'copy' ? [shownSym] : [])].sort()
      expect([...created].sort(), `${words} · ${pname}`).toEqual(wantNew)
      // the existing charts are the same refs, on the same symbols
      expect(fin.kept.map(c => [c.ref, c.symbol])).toEqual(BOARD_SYMS.slice(0, n).map((s0, i) => [`c${i + 1}`, s0]))
    })
  }
})

describe('D18 · timeframe — a symbol shown on ANOTHER timeframe than asked is NOT displayed: a new chart, said', () => {
  it('NVDA daily on the board, "add a weekly NVDA chart" → a new weekly NVDA, the receipt says why', () => {
    const b = makeBoard(...board(2))
    const ops = [{ action: 'chartGrid.set', target: 'board', args: { symbols: ['NVDA'], timeframe: 'W', layout: null, new_charts: true, watchlist: null, replace: null } }]
    const r = screenChartReuse(ops, b.host, 'add a weekly NVDA chart')
    expect(r.notes).toEqual([TF_NOTE('NVDA', 'D', 'W')])
    expect(r.notes[0]).toBe('NVDA is already on your board on Daily — I added a Weekly NVDA chart.')
    expect(keepTickers('add a weekly NVDA chart', b.host, createdTickers(ops)).has('NVDA')).toBe(false)
  })
  it('the same timeframe (or none asked) → reused', () => {
    const b = makeBoard(...board(2))
    const ops = [{ action: 'widget.addCharts', target: 'workspace', args: { symbols: ['NVDA', 'AAPL'], timeframe: 'D', chart_type: null, exact: null } }]
    expect(screenChartReuse(ops, b.host, 'add daily NVDA and AAPL charts').reused).toEqual(['NVDA'])
  })
})

// ── (c) through the real panel ──────────────────────────────────────────────────────────────────────────────────────────────
let envelopes, calls
const env = (disposition, ops) => ({ disposition, reply: '', question: null, ops, unsupported_category: null })
beforeEach(() => {
  envelopes = []; calls = []
  try { localStorage.clear() } catch { /* */ }
  globalThis.fetch = vi.fn(async (url) => {
    calls.push(String(url))
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
    if (url === '/api/agent/turn') return json({ conversationId: 'ac_1', envelope: envelopes.shift() || env('answer', []), usage: { research_calls: 0, citations: [] } })
    if (url === '/api/agent/record') return json({ conversationId: 'ac_1' })
    const q = /ticker-search\?q=([^&]+)/.exec(String(url))
    if (q) return json({ results: [{ ticker: decodeURIComponent(q[1]).toUpperCase() }] })
    if (String(url).startsWith('/api/live-prices')) return json({})
    return json({ conversations: [] })
  })
})
afterEach(() => { vi.restoreAllMocks(); cleanup() })
const idle = () => waitFor(() => expect(screen.queryByTestId('agent-typing')).toBeNull(), { timeout: 10000 })
function mount(n, h = 10) {
  const b = makeBoard(...board(n, h))
  const hh = { ...b.host, charts: { ...b.host.charts, canManageIndicators: () => true, canCreateIndicator: () => true, previewHost: () => null, selected: () => null }, persist: async () => ({ ok: true }) }
  render(<AuthContext.Provider value={{ user: { id: 1, role: 'admin' } }}><AgentPanel host={hh} onClose={() => {}} /></AuthContext.Provider>)
  const box = screen.getByLabelText('Message UCT Agent')
  const say = async (t) => { await idle(); fireEvent.change(box, { target: { value: t } }); fireEvent.keyDown(box, { key: 'Enter' }); await idle() }
  const click = async (label) => { await idle(); fireEvent.click(screen.getAllByRole('button', { name: label }).at(-1)); await idle() }
  const syms = () => b.state.widgets.filter(w => w.type === 'chart').map(w => hh.charts.read(w.id).symbol)
  const raw = () => JSON.stringify(b.state.widgets)
  return { b, say, click, syms, raw }
}
const transcript = () => screen.getByTestId('agent-transcript').textContent
const addCharts = (syms, tf = null) => env('apply', [{ action: 'widget.addCharts', target: 'workspace', args: { symbols: syms, timeframe: tf, chart_type: null, exact: null } }])

describe('D18 · through the real panel', () => {
  it('"open AAPL, MSFT and NVDA" with NVDA shown → NVDA reused (same chart), AAPL and MSFT added; said', async () => {
    const { say, syms } = mount(1)
    envelopes.push(addCharts(['AAPL', 'MSFT', 'NVDA']))
    await say('open AAPL, MSFT and NVDA')
    expect([...syms()].sort()).toEqual(['AAPL', 'MSFT', 'NVDA'])
    expect(transcript()).toMatch(/NVDA is already on your board — I used that chart/)
  }, 30000)
  it('"…and a second NVDA" → a second NVDA chart', async () => {
    const { say, syms } = mount(1)
    envelopes.push(addCharts(['AAPL', 'NVDA']))
    await say('open AAPL and a second NVDA')
    expect(syms().filter(s0 => s0 === 'NVDA')).toHaveLength(2)
  }, 30000)
  it('D18 item 2: "add 2 more charts for NVDA and AAPL" with NVDA shown → ASKED, nothing written; "Use your NVDA chart" → only AAPL added', async () => {
    const { say, click, syms, raw } = mount(1)
    const before = raw()
    envelopes.push(addCharts(['NVDA', 'AAPL']))
    await say('add 2 more charts for NVDA and AAPL')
    expect(raw()).toBe(before)
    expect(transcript()).toMatch(/NVDA is already on your board\. Use that chart, or open a second NVDA chart\? Nothing has changed yet\./)
    await click('Use your NVDA chart')
    expect([...syms()].sort()).toEqual(['AAPL', 'NVDA'])
  }, 30000)
  it('D18 item 2: … "Open a second NVDA chart" → NVDA twice + AAPL', async () => {
    const { say, click, syms } = mount(1)
    envelopes.push(addCharts(['NVDA', 'AAPL']))
    await say('add 2 more charts for NVDA and AAPL')
    await click('Open a second NVDA chart')
    expect([...syms()].sort()).toEqual(['AAPL', 'NVDA', 'NVDA'])
  }, 30000)
  it('"add 4 more charts" with no symbols → N new charts (unchanged, no question)', async () => {
    const { say, syms } = mount(1)
    envelopes.push(addCharts(['AAPL', 'MSFT', 'TSLA', 'META']))
    await say('add 4 more charts')
    expect(syms()).toHaveLength(5)
  }, 30000)
  it('timeframe: NVDA daily, "add a weekly NVDA chart" → a new weekly NVDA, the receipt says so', async () => {
    const { say, syms } = mount(1)
    envelopes.push(addCharts(['NVDA'], 'W'))
    await say('add a weekly NVDA chart')
    expect(syms()).toEqual(['NVDA', 'NVDA'])
    expect(transcript()).toMatch(/NVDA is already on your board on Daily — I added a Weekly NVDA chart\./)
    expect(transcript()).not.toMatch(/you have no NVDA chart/i)
  }, 30000)
  it('CONTROL · an explicit timeframe change stays the timeframe path: "switch my NVDA to weekly"', async () => {
    const { say, b } = mount(1)
    envelopes.push(env('apply', [{ action: 'chart.setTimeframe', target: 'c1', args: { timeframe: 'W' } }]))
    await say('switch my NVDA to weekly')
    expect(b.state.widgets.filter(w => w.type === 'chart')).toHaveLength(1)
  }, 30000)
  it('CONTROL · explicit replace: "replace NVDA with AMD" → AMD, nothing created', async () => {
    const { say, syms } = mount(1)
    envelopes.push(env('apply', [{ action: 'chart.setSymbol', target: 'c1', args: { symbol: 'AMD' } }]))
    await say('replace NVDA with AMD')
    expect(syms()).toEqual(['AMD'])
  }, 30000)
  it('exact Undo after a reuse + add', async () => {
    const { say, raw } = mount(1)
    const before = raw()
    envelopes.push(addCharts(['AAPL', 'NVDA']))
    await say('open AAPL and NVDA')
    await say('undo')
    expect(raw()).toBe(before)
  }, 30000)
})

// ── AUDIT condition: "Add N more charts" picked = an explicit copy — so its LABEL names every displayed symbol it would duplicate ──
describe('D18 · the add-or-replace choice label states the duplicates before the member picks', () => {
  const six = () => makeBoard(Array.from({ length: 6 }, (_, i) => ({ id: `c${i}`, type: 'chart', x: (i % 3) * 8, y: Math.floor(i / 3) * 10, w: 8, h: 10, color: 'N', opts: settings() })),
    { 'N:c0': 'SPY', 'N:c1': 'QQQ', 'N:c2': 'NVDA', 'N:c3': 'AMD', 'N:c4': 'MU', 'N:c5': 'META' })
  const labelOf = (q) => (q?.choices || []).find(c => c.ref === 'grid:add')?.label
  for (const [tickers, dup] of [[['SPY', 'QQQ', 'NVDA', 'TSLA'], ['SPY', 'QQQ', 'NVDA']], [['NVDA', 'AAPL'], ['NVDA']], [['AAPL', 'MSFT'], []]]) {
    it(`instant reader · ${tickers.join(' ')} → names ${dup.length ? dup.join(', ') : 'no duplicate'}`, () => {
      const b = six()
      const said = tickers.length === 2 ? tickers.join(' and ') : `${tickers.slice(0, -1).join(', ')} and ${tickers[tickers.length - 1]}`
      const q = multiChartPlan(`put ${said} on ${({ 2: 'two', 4: 'four' })[tickers.length]} charts`, { host: b.host })
      expect(q?.kind).toBe('ask')
      const label = labelOf(q)
      for (const d of dup) expect(label, d).toContain(d)
      expect(label).toBe(dup.length ? `Add ${tickers.length} new charts (a second ${dup.length === 1 ? dup[0] : `${dup.slice(0, -1).join(', ')} and ${dup[dup.length - 1]}`})` : `Add ${tickers.length} more charts`)
    })
    it(`model plan (gridChoiceFor) · ${tickers.join(' ')} → names ${dup.length ? dup.join(', ') : 'no duplicate'}`, () => {
      const b = six()
      const q = gridChoiceFor([{ action: 'chartGrid.set', target: 'board', args: { symbols: tickers, timeframe: null, layout: null, new_charts: null, watchlist: null, replace: null } }], 'set these up', b.host)
      const label = labelOf(q)
      for (const d of dup) expect(label, d).toContain(d)
      if (!dup.length) expect(label).not.toMatch(/a second/)
    })
  }
})

// ⛔ KEEP ≠ RE-CREATE (live #1210 follow-up, owner 2026-11-14) — through the REAL panel (AgentPanel + useAgent + registry,
// planner, rail, runtime, receipts and Undo) on the REAL board writer (fixture board). Stand-in: the Agent model, scripted.
//   Board: SPY (left), NVDA (right).
//   Member: "Add AAPL and MSFT to my charts, but keep SPY and NVDA."
//   Agent (model clarify): how should I arrange the four charts? — the member CLICKS "All four in a grid".
//   LIVE (wrong): SIX panels — SPY, NVDA, SPY, NVDA, AAPL, MSFT ("Added four new charts for SPY, NVDA, AAPL and MSFT beside your
//   2 charts, re-tiled evenly"). Expected: FOUR — the two kept panels (same widgets) + AAPL + MSFT.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { makeBoard } from './__fixtures__/board'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { AuthContext } from '../context/AuthContext'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'
import { planOps, collectTargets } from './executor'
import { chartRailRefusal, finalBoard, keepTickers, createdTickers } from './chartRail'

registerBuiltins()

let envelopes, calls
const env = (disposition, ops, reply = '', question = null) => ({ disposition, reply, question, ops, unsupported_category: null })
beforeEach(() => {
  envelopes = []; calls = []
  try { localStorage.clear() } catch { /* */ }
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null
    calls.push([init.method || 'GET', String(url), body])
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
    if (url === '/api/agent/turn') {
      const e = envelopes.shift()
      return json({ conversationId: 'ac_1', envelope: typeof e === 'function' ? e(body) : (e || env('answer', [], 'NO SCRIPTED MODEL TURN')), usage: { research_calls: 0, citations: [] } })
    }
    if (url === '/api/agent/record') return json({ conversationId: 'ac_1' })
    const q = /ticker-search\?q=([^&]+)/.exec(String(url))
    if (q) return json({ results: [{ ticker: decodeURIComponent(q[1]).toUpperCase() }] })
    if (String(url).startsWith('/api/live-prices')) return json({})
    return json({ conversations: [] })
  })
})
afterEach(() => { vi.restoreAllMocks(); cleanup() })

export const turnBodies = () => calls.filter(c => c[1] === '/api/agent/turn').map(c => c[2])
const transcript = () => screen.getByTestId('agent-transcript').textContent
const idle = () => waitFor(() => expect(screen.queryByTestId('agent-typing')).toBeNull(), { timeout: 10000 })
const settings = () => ({ settings: mergeChartSettings(null) })
export function mount(widgets, groupSyms) {
  const board = makeBoard(widgets, groupSyms)
  const h = { ...board.host, charts: { ...board.host.charts, canManageIndicators: () => true, canCreateIndicator: () => true, previewHost: () => null, selected: () => null }, persist: async () => ({ ok: true }) }
  render(<AuthContext.Provider value={{ user: { id: 1, role: 'admin' } }}><AgentPanel host={h} onClose={() => {}} /></AuthContext.Provider>)
  const box = screen.getByLabelText('Message UCT Agent')
  const say = async (t) => { await idle(); fireEvent.change(box, { target: { value: t } }); fireEvent.keyDown(box, { key: 'Enter' }); await idle() }
  const click = async (label) => { await idle(); fireEvent.click(screen.getAllByRole('button', { name: label }).at(-1)); await idle() }
  const charts = () => board.state.widgets.filter(w => w.type === 'chart').sort((a, b) => (a.y - b.y) || (a.x - b.x))
  const syms = () => charts().map(w => h.charts.read(w.id).symbol)
  const raw = () => JSON.stringify(board.state.widgets)
  return { board, h, say, click, charts, syms, raw }
}
export const boardOf = (symsIn, h = 20) => [symsIn.map((_, i) => ({ id: `c${i + 1}`, type: 'chart', x: i * Math.floor(24 / symsIn.length), y: 0, w: Math.floor(24 / symsIn.length), h, color: 'N', opts: settings() })),
  Object.fromEntries(symsIn.map((s, i) => [`N:c${i + 1}`, s]))]

const ASK = 'Add AAPL and MSFT to my charts, but keep SPY and NVDA.'
const Q = 'How would you like the four charts arranged?'
const CHOICES = ['All four in a grid', 'Side by side in one row', 'Two rows of two']
export const arrangeQuestion = () => env('clarify', [], Q, { text: Q, choices: CHOICES })
// the two producers the answer can be planned as (both seen from the planner): a grid of all four as NEW charts, and the four
// charts added + arranged (screenChartGrid turns that into one chartGrid.set)
export const PRODUCERS = {
  'chartGrid.set new_charts': (all, layout = 'grid') => [{ action: 'chartGrid.set', target: 'board', args: { symbols: all, timeframe: null, layout, new_charts: true, watchlist: null, replace: null } }],
  'widget.addCharts + arrange': (all, layout = 'grid') => [{ action: 'widget.addCharts', target: 'workspace', args: { symbols: all, timeframe: null, chart_type: null, exact: null } }, { action: 'widget.arrange', target: 'board', args: { widgets: null, pattern: layout } }],
}

describe('KEEP ≠ RE-CREATE · the owner\'s exact sequence, clicking the offered arrangement', () => {
  for (const [pname, plan] of Object.entries(PRODUCERS)) {
    it(`${pname}: "All four in a grid" → FOUR charts — the kept SPY and NVDA panels themselves, plus AAPL and MSFT`, async () => {
      const { say, click, charts, syms } = mount(...boardOf(['SPY', 'NVDA']))
      envelopes.push(arrangeQuestion())
      await say(ASK)
      expect(transcript()).toContain(Q)
      envelopes.push(env('apply', plan(['SPY', 'NVDA', 'AAPL', 'MSFT'])))
      await click('All four in a grid')
      expect(syms()).toEqual(['SPY', 'NVDA', 'AAPL', 'MSFT'])
      expect(charts()).toHaveLength(4)
      // the kept panels are the SAME widgets, not recreated copies
      expect(charts().filter(w => ['c1', 'c2'].includes(w.id)).map(w => w.id)).toEqual(['c1', 'c2'])
      expect(transcript()).not.toMatch(/Added four new charts for SPY, NVDA, AAPL and MSFT/)
    }, 30000)
  }
})

// ── the general rule, generated: keep phrasing × new-ticker count (1–4) × board size (1–4) × arrangement answer ─────────────
// The producer that re-created kept charts (chartGrid.set new_charts with the kept tickers in its list) is planned by the REAL
// planner; the final board must be exactly the kept panels (same widgets) ∪ the new tickers — never a ticker twice.
const KEPT_SYMS = ['SPY', 'NVDA', 'AMD', 'QQQ']
const NEW_SYMS = ['AAPL', 'MSFT', 'TSLA', 'META']
const KEEP = {
  'but keep': (k, n) => `Add ${n} to my charts, but keep ${k}`,
  keeping: (k, n) => `add ${n} keeping ${k}`,
  'and leave': (k, n) => `put ${n} on the board and leave ${k} alone`,
  'plus my existing': (k, n) => `I want ${n} plus my existing ${k}`,
}
const ARRANGE = { 'all four in a grid': 'grid', '2 by 2': 'grid', 'side by side': 'columns', 'grid them': 'grid' }
const list = (xs) => (xs.length === 1 ? xs[0] : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)
describe('KEEP ≠ RE-CREATE · generated: the planned final board is exactly kept ∪ new, no ticker twice, the kept panels the same widgets', () => {
  for (const b of [1, 2, 3, 4]) for (const m of [1, 2, 3, 4]) for (const [kname, kf] of Object.entries(KEEP)) for (const [aname, layout] of Object.entries(ARRANGE)) {
    const kept = KEPT_SYMS.slice(0, b), fresh = NEW_SYMS.slice(0, m)
    it(`board ${b} · ${m} new · ${kname} · ${aname}`, () => {
      const bd = makeBoard(...boardOf(kept))
      const words = `${kf(list(kept), list(fresh))} . ${aname}`
      const ops = PRODUCERS['chartGrid.set new_charts']([...kept, ...fresh], layout)
      const plan = planOps(collectTargets(bd.host, ['board']), ops, { keepTickers: keepTickers(words, bd.host, createdTickers(ops)) }, { surface: 'charts' })   // as execute plans it
      if (!plan.ok) return                                          // no room for b + m charts: refused by the grid, nothing written
      if (aname === '2 by 2' && b + m < 4) {                       // a 4-chart grid asked, fewer charts in the end: COUNT refuses
        expect(chartRailRefusal(plan, { words, host: bd.host, mode: 'apply' }), words).toMatch(/4-chart grid/)
        return
      }
      expect(chartRailRefusal(plan, { words, host: bd.host, mode: 'apply' }), words).toBe(null)
      const fin = finalBoard(plan, bd.host)
      expect(fin.kept.map(c => c.ref)).toEqual(kept.map((_, i) => `c${i + 1}`))
      expect([...fin.kept.map(c => c.symbol), ...fin.created]).toEqual([...kept, ...fresh])
    })
  }
})

// ── the RAIL ALONE: a plan that would create a kept ticker again (any producer) is refused, nothing written ─────────────────
describe('KEEP ≠ RE-CREATE · the rail alone refuses a plan that re-creates a ticker already on the board', () => {
  for (const b of [1, 2, 3]) for (const [kname, kf] of Object.entries(KEEP)) {
    it(`widget.addCharts with the kept tickers · board ${b} · ${kname}`, () => {
      const kept = KEPT_SYMS.slice(0, b)
      const bd = makeBoard(...boardOf(kept, 10))                    // room below for the new charts
      const plan = planOps(collectTargets(bd.host, ['workspace']), [{ action: 'widget.addCharts', target: 'workspace', args: { symbols: [...kept, 'AAPL'], timeframe: null, chart_type: null, exact: null } }], {}, { surface: 'charts' })
      expect(plan.ok).toBe(true)
      expect(chartRailRefusal(plan, { words: kf(list(kept), 'AAPL'), host: bd.host, mode: 'apply' })).toMatch(/already on your board/)
    })
  }
  it('no keep clause: "add AAPL and MSFT" planned with SPY too — the board\'s SPY is not created a second time', () => {
    const bd = makeBoard(...boardOf(['SPY', 'NVDA'], 10))
    const plan = planOps(collectTargets(bd.host, ['workspace']), [{ action: 'widget.addCharts', target: 'workspace', args: { symbols: ['SPY', 'AAPL', 'MSFT'], timeframe: null, chart_type: null, exact: null } }], {}, { surface: 'charts' })
    expect(chartRailRefusal(plan, { words: 'add AAPL and MSFT', host: bd.host, mode: 'apply' })).toMatch(/SPY is already on your board/)
  })
  it('CONTROL: a ticker NAMED as new ("open daily charts for AAPL and SPY") or from a reference ("bring up what remains") is created', () => {
    const bd = makeBoard(...boardOf(['SPY', 'NVDA'], 10))
    const plan = planOps(collectTargets(bd.host, ['workspace']), [{ action: 'widget.addCharts', target: 'workspace', args: { symbols: ['AAPL', 'SPY'], timeframe: null, chart_type: null, exact: null } }], {}, { surface: 'charts' })
    expect(chartRailRefusal(plan, { words: 'open daily charts for AAPL and SPY', host: bd.host, mode: 'apply' })).toBe(null)
    const p2 = planOps(collectTargets(bd.host, ['workspace']), [{ action: 'widget.addCharts', target: 'workspace', args: { symbols: ['SPY'], timeframe: null, chart_type: null, exact: null } }], {}, { surface: 'charts' })
    expect(chartRailRefusal(p2, { words: 'prune amd out of Momentum and bring up what remains', host: bd.host, mode: 'apply' })).toBe(null)
  })
  it('CONTROL: "add another SPY chart" — a copy asked for in words is allowed', () => {
    const bd = makeBoard(...boardOf(['SPY', 'NVDA'], 10))
    const plan = planOps(collectTargets(bd.host, ['workspace']), [{ action: 'widget.addCharts', target: 'workspace', args: { symbols: ['SPY'], timeframe: null, chart_type: null, exact: null } }], {}, { surface: 'charts' })
    expect(chartRailRefusal(plan, { words: 'add another SPY chart', host: bd.host, mode: 'apply' })).toBe(null)
    expect(chartRailRefusal(plan, { words: 'a second spy chart please', host: bd.host, mode: 'apply' })).toBe(null)
  })
  it('the SAME panel: a plan that closes the kept SPY chart and creates a new SPY chart is refused as a change to a kept chart', () => {
    const bd = makeBoard(...boardOf(['SPY', 'NVDA'], 10))
    const p1 = planOps(collectTargets(bd.host, ['board']), [{ action: 'widget.remove', target: 'board', args: { widget: 'c1' } }], {}, { surface: 'charts' })
    const p2 = planOps(collectTargets(bd.host, ['workspace']), [{ action: 'widget.addCharts', target: 'workspace', args: { symbols: ['SPY', 'AAPL'], timeframe: null, chart_type: null, exact: null } }], {}, { surface: 'charts' })
    const plan = { ok: true, plans: [...p1.plans, ...p2.plans] }
    expect(chartRailRefusal(plan, { words: 'add AAPL but keep SPY and NVDA', host: bd.host, mode: 'apply' })).toMatch(/you asked to keep SPY/)
  })
  it('CONTROL · a Multi Chart grid-mode board: growing the grid (empty cells) with a keep clause is not a re-creation', () => {
    const bd = makeBoard(...boardOf(['SPY', 'NVDA'], 10))
    const st = { mode: 'grid', layout: '2x2', cells: [{ id: 'g0', sym: 'SPY', tf: 'D' }, { id: 'g1', sym: 'NVDA', tf: 'D' }, { id: 'g2', sym: null, tf: 'D' }, { id: 'g3', sym: null, tf: 'D' }] }
    const host = { ...bd.host, gridControl: { state: () => st, maxId: () => null, settingsOpen: () => false, snapshot: () => ({ st }), savedGrids: () => [] } }
    const plan = planOps(collectTargets(host, ['multiChart']), [{ action: 'multiChart.set', target: 'multichart', args: { op: 'layout', rows: 2, cols: 3, on: null, name: null, direction: null } }], {}, { surface: 'charts' })
    expect(plan.ok).toBe(true)
    expect(chartRailRefusal(plan, { words: 'add AAPL and MSFT but keep SPY and NVDA', host, mode: 'apply' })).toBe(null)
  })
  it('fails closed: charts from a list whose tickers are unknown, while charts are kept → asked to name them', () => {
    const bd = makeBoard(...boardOf(['SPY']))
    const plan = { ok: true, plans: [{ kind: 'workspace', ref: 'workspace', after: { pendingCharts: [{ symbols: { from: 'wl1', top: 2 } }] }, before: {} }] }
    expect(chartRailRefusal(plan, { words: 'keep SPY and add two from my watchlist', host: bd.host, mode: 'apply' })).toMatch(/Name the tickers/)
  })
})

// ── through the real panel: every arrangement option, 1 and 3 kept charts, mixed / lower case, "keep X but add Y", no keep ──
describe('KEEP ≠ RE-CREATE · through the real panel', () => {
  const LAYOUT_OF = { 'All four in a grid': 'grid', 'Side by side in one row': 'columns', 'Two rows of two': 'grid' }
  for (const choice of CHOICES) for (const [pname, plan] of Object.entries(PRODUCERS)) {
    it(`every offered arrangement · "${choice}" · ${pname}`, async () => {
      const { say, click, charts, syms } = mount(...boardOf(['SPY', 'NVDA']))
      envelopes.push(arrangeQuestion())
      await say(ASK)
      envelopes.push(env('apply', plan(['SPY', 'NVDA', 'AAPL', 'MSFT'], LAYOUT_OF[choice])))
      await click(choice)
      expect([...syms()].sort()).toEqual(['AAPL', 'MSFT', 'NVDA', 'SPY'])
      expect(charts().map(w => w.id)).toEqual(expect.arrayContaining(['c1', 'c2']))
    }, 30000)
  }
  const CASES = [
    ['1 kept, lowercase', ['SPY'], 'add aapl and msft but keep spy', ['AAPL', 'MSFT']],
    ['3 kept, mixed case', ['SPY', 'NVDA', 'AMD'], 'Add Aapl to my charts, keeping Spy, Nvda and Amd', ['AAPL']],
    ['keep X but add Y', ['SPY', 'NVDA'], 'keep SPY and NVDA but add TSLA', ['TSLA']],
    ['no keep clause', ['SPY', 'NVDA'], 'add AAPL and MSFT to my charts in a grid', ['AAPL', 'MSFT']],
  ]
  for (const [name, kept, words, fresh] of CASES) {
    it(`${name} · "${words}" (model plans the kept tickers as new charts) → exactly kept ∪ new`, async () => {
      const { say, charts, syms } = mount(...boardOf(kept))
      envelopes.push(env('apply', PRODUCERS['chartGrid.set new_charts']([...kept, ...fresh])))
      await say(words)
      expect([...syms()].sort()).toEqual([...kept, ...fresh].sort())
      expect(charts().map(w => w.id)).toEqual(expect.arrayContaining(kept.map((_, i) => `c${i + 1}`)))
    }, 30000)
  }
  it('exact Undo: the continued 4-chart grid, then "undo" → the board byte for byte', async () => {
    const { say, click, raw } = mount(...boardOf(['SPY', 'NVDA']))
    const before = raw()
    envelopes.push(arrangeQuestion())
    await say(ASK)
    envelopes.push(env('apply', PRODUCERS['chartGrid.set new_charts'](['SPY', 'NVDA', 'AAPL', 'MSFT'])))
    await click('All four in a grid')
    await say('undo')
    expect(raw()).toBe(before)
  }, 30000)
  it('CONTROL · explicit replace: "replace the NVDA chart with AAPL" → SPY, AAPL', async () => {
    const { say, syms } = mount(...boardOf(['SPY', 'NVDA']))
    envelopes.push(env('apply', [{ action: 'chart.setSymbol', target: 'c2', args: { symbol: 'AAPL' } }]))
    await say('replace the NVDA chart with AAPL')
    expect(syms()).toEqual(['SPY', 'AAPL'])
  }, 30000)
  it('CONTROL · explicit duplicate: "add another SPY chart" → a second SPY chart', async () => {
    const { say, syms } = mount(...boardOf(['SPY', 'NVDA'], 10))
    envelopes.push(env('apply', [{ action: 'widget.addCharts', target: 'workspace', args: { symbols: ['SPY'], timeframe: null, chart_type: null, exact: null } }]))
    await say('add another SPY chart')
    expect(syms().filter(s0 => s0 === 'SPY')).toHaveLength(2)
  }, 30000)
})

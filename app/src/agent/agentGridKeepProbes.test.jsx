// ⛔ KEEP ≠ RE-CREATE · held-out shapes (AUDIT prep, #1275) — generated across 1-, 2- and 3-chart boards, through the REAL panel.
// Stand-in: the model, scripted to plan the DUPLICATING reading (every board ticker AND the new ones as new charts) — it may only
// land as kept ∪ new; a copy lands only when the words ask for one. The receipt's count equals the final board.
//   implicit keep   "throw AAPL and MSFT up next to what I have", "AAPL + MSFT too", "make it a 2×2 with aapl and msft"
//   named + board   "add SPY and AAPL" on a SPY board → one SPY (never two silently)
//   copy intended   "one more SPY", "SPY again", "a 2nd spy chart" → a second SPY
//   refusal text    names WHICH ticker and how to ask for a copy
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { makeBoard } from './__fixtures__/board'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { AuthContext } from '../context/AuthContext'
import { planOps, collectTargets } from './executor'
import { chartRailRefusal, dupSentence } from './chartRail'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'

registerBuiltins()

let envelopes
const env = (disposition, ops) => ({ disposition, reply: '', question: null, ops, unsupported_category: null })
beforeEach(() => {
  envelopes = []
  try { localStorage.clear() } catch { /* */ }
  globalThis.fetch = vi.fn(async (url) => {
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

const settings = () => ({ settings: mergeChartSettings(null) })
const BOARD_SYMS = ['SPY', 'NVDA', 'AMD']
// n charts in one row (full height: a grid of new charts re-tiles them)
const boardOf = (n, h = 20) => [Array.from({ length: n }, (_, i) => ({ id: `c${i + 1}`, type: 'chart', x: i * Math.floor(24 / n), y: 0, w: Math.floor(24 / n), h, color: 'N', opts: settings() })),
  Object.fromEntries(Array.from({ length: n }, (_, i) => [`N:c${i + 1}`, BOARD_SYMS[i]]))]
const idle = () => waitFor(() => expect(screen.queryByTestId('agent-typing')).toBeNull(), { timeout: 10000 })
function mount(n, h = 20) {
  const b = makeBoard(...boardOf(n, h))
  const h = { ...b.host, charts: { ...b.host.charts, canManageIndicators: () => true, canCreateIndicator: () => true, previewHost: () => null, selected: () => null }, persist: async () => ({ ok: true }) }
  render(<AuthContext.Provider value={{ user: { id: 1, role: 'admin' } }}><AgentPanel host={h} onClose={() => {}} /></AuthContext.Provider>)
  const box = screen.getByLabelText('Message UCT Agent')
  const say = async (t) => { await idle(); fireEvent.change(box, { target: { value: t } }); fireEvent.keyDown(box, { key: 'Enter' }); await idle() }
  const charts = () => b.state.widgets.filter(w => w.type === 'chart')
  const syms = () => charts().map(w => h.charts.read(w.id).symbol)
  return { b, h, say, charts, syms }
}
const transcript = () => screen.getByTestId('agent-transcript').textContent
const grid = (symbols) => [{ action: 'chartGrid.set', target: 'board', args: { symbols, timeframe: null, layout: 'grid', new_charts: true, watchlist: null, replace: null } }]
const NUM = { 1: 'one', 2: 'two', 3: 'three', 4: 'four' }

describe('implicit keep — the board\'s charts are kept, only the new tickers are added (receipt count = final board)', () => {
  const SAYS = ['throw AAPL and MSFT up next to what I have', 'AAPL + MSFT too', 'make it a 2×2 with aapl and msft', 'add aapl and Msft to my charts']
  for (const n of [1, 2, 3]) for (const words of SAYS) {
    it(`${n}-chart board · "${words}"`, async () => {
      const { say, charts, syms } = mount(n)
      const kept = BOARD_SYMS.slice(0, n)
      envelopes.push(env('apply', grid([...kept, 'AAPL', 'MSFT'])))
      await say(words)
      const s = syms()
      // never a board ticker twice
      expect(new Set(s).size, words).toBe(s.length)
      if (s.length === n) {
        // nothing landed (an instant reading asked, or a rail refused): the board is untouched
        expect(s).toEqual(kept)
        return
      }
      expect([...s].sort(), words).toEqual([...kept, 'AAPL', 'MSFT'].sort())
      expect(charts().slice(0, n).map(w => w.id)).toEqual(kept.map((_, i) => `c${i + 1}`))
      // the receipt counts exactly what was created, beside exactly what was kept
      const r = screen.queryAllByTestId('agent-receipt').at(-1)?.textContent || transcript()
      expect(r, words).toMatch(new RegExp(`Added two new charts for AAPL and MSFT beside your ${n === 1 ? 'chart' : `${n} charts`}`))
      expect(r, words).not.toMatch(/Added (three|four|five|six) new charts/)
    }, 30000)
  }
})

describe('a board ticker named among the adds is that chart — one SPY, never two silently', () => {
  for (const n of [1, 2, 3]) for (const words of ['add SPY and AAPL', 'add spy and aapl to my layout', 'put SPY and AAPL up']) {
    it(`${n}-chart board · "${words}"`, async () => {
      const { say, syms } = mount(n)
      envelopes.push(env('apply', grid(['SPY', 'AAPL'])))
      await say(words)
      expect(syms().filter(x => x === 'SPY'), words).toHaveLength(1)
    }, 30000)
  }
  it('"add SPY" alone on a SPY board: said, naming the ticker and how to ask for a copy; nothing added', async () => {
    const { say, syms } = mount(2, 10)                             // room below: nothing else stops it
    envelopes.push(env('apply', [{ action: 'widget.addCharts', target: 'workspace', args: { symbols: ['SPY'], timeframe: null, chart_type: null, exact: null } }]))
    await say('add SPY')
    expect(syms()).toEqual(['SPY', 'NVDA'])
    expect(transcript()).toMatch(/SPY is already on your board.*Say “add another SPY chart” if you want a second one\./)
  }, 30000)
})

describe('a copy IS intended — "one more SPY", "SPY again", "a 2nd spy chart"', () => {
  for (const n of [1, 2, 3]) for (const words of ['one more SPY', 'SPY again', 'a 2nd spy chart', 'add another SPY chart']) {
    it(`${n}-chart board · "${words}" (the model adds SPY) → two SPY charts`, async () => {
      const b = makeBoard(...[Array.from({ length: n }, (_, i) => ({ id: `c${i + 1}`, type: 'chart', x: i * 6, y: 0, w: 6, h: 10, color: 'N', opts: settings() })),
        Object.fromEntries(Array.from({ length: n }, (_, i) => [`N:c${i + 1}`, BOARD_SYMS[i]]))])
      const plan = planOps(collectTargets(b.host, ['workspace']), [{ action: 'widget.addCharts', target: 'workspace', args: { symbols: ['SPY'], timeframe: null, chart_type: null, exact: null } }], {}, { surface: 'charts' })
      expect(plan.ok).toBe(true)
      expect(chartRailRefusal(plan, { words, host: b.host, mode: 'apply' }), words).toBe(null)
    })
  }
})

describe('the duplicate refusal text names WHICH ticker and how to ask for a second copy', () => {
  it('one ticker: exact sentence', () => {
    expect(dupSentence(['SPY'])).toBe('I didn’t change anything: SPY is already on your board. Say “add another SPY chart” if you want a second one.')
  })
  for (const n of [1, 2, 3]) {
    it(`${n}-chart board · a plan re-creating every board ticker → the refusal names them`, () => {
      const b = makeBoard(...[Array.from({ length: n }, (_, i) => ({ id: `c${i + 1}`, type: 'chart', x: i * 6, y: 0, w: 6, h: 10, color: 'N', opts: settings() })),
        Object.fromEntries(Array.from({ length: n }, (_, i) => [`N:c${i + 1}`, BOARD_SYMS[i]]))])
      const kept = BOARD_SYMS.slice(0, n)
      const plan = planOps(collectTargets(b.host, ['workspace']), [{ action: 'widget.addCharts', target: 'workspace', args: { symbols: [...kept, 'AAPL'], timeframe: null, chart_type: null, exact: null } }], {}, { surface: 'charts' })
      const list = kept.length === 1 ? kept[0] : `${kept.slice(0, -1).join(', ')} and ${kept[kept.length - 1]}`
      expect(chartRailRefusal(plan, { words: `add AAPL, keeping ${list}`, host: b.host, mode: 'apply' }))
        .toBe(`I didn’t change anything: ${list} ${n === 1 ? 'is' : 'are'} already on your board. Say “add another SPY chart” if you want a second one.`)
    })
  }
  void NUM
})

// ── GRID LOAD vs ADD (OWNER RULING 2026-11-24) ───────────────────────────────────────────────────────────────────────────────
//   "'Load SPY QQQ IWM DIA in a 2x2' should be treated as an explicit request to populate the grid, so changing the symbols of
//    existing charts is allowed without unnecessary confirmation. However, distinguish loading/replacing from adding. Preserve
//    existing charts when the user asks to add charts, and do not silently destroy meaningful existing chart customizations or
//    drawings."
//
// GENERATED rows through the REAL panel (setupPanel: AgentPanel + useAgent + registry, planner, rails, the real board writer),
// on BOTH routings (set explicitly, routingV2Active() asserted on every turn), with the model stand-in scripted two ways — the
// IDEAL plan and a RE-SYMBOL plan (the destructive reading) — whichever path reaches it:
//
//   LOAD  wording × board (1 / 2 / 4 charts; 6 = more charts than tickers) × chart state (plain | indicators + pane + drawings)
//         → no question, no card: the grid is populated (existing charts re-symbolled), and EVERY re-symbolled chart keeps its
//         own work — id, timeframe, link colour, opts (indicators, panes, chart type, colours, watermark) byte-for-byte — and the
//         drawings store (per symbol) is byte-identical; one Undo gives every chart its ticker back. (6 charts: the existing
//         replace-or-add question, 0 changes.)
//   ADD   wording × board × chart state → no existing chart is re-symbolled or removed: charts are added (or a question / a
//         refusal with 0 changes). Never a re-symbol without the member's pick.
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { writeFileSync } from 'node:fs'
import { screen, waitFor } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, bareSettings } from './testing/panelHarness'
import { loadAgentConfig, _resetAgentConfig } from './agentClient'
import { routingV2Active } from './nlm1/flag'
import { _resetTurns } from './trace'
import { DRAWINGS_STORAGE_KEY } from '../components/chart/drawingsPeek'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

const LOAD4 = ['SPY', 'QQQ', 'IWM', 'DIA']
export const LOAD_WORDINGS = {
  'load T in a 2x2': (T) => `load ${T.join(' ')} in a 2x2`,
  'Load T, and in a 2x2': (T) => `Load ${T.slice(0, -1).join(', ')} and ${T.at(-1)} in a 2x2`,
  'put T in a 2x2 grid': (T) => `put ${T.join(' ')} in a 2x2 grid`,
  'show T as four charts': (T) => `show ${T.join(', ')} as four charts`,
  'make a 2x2 of T': (T) => `make a 2x2 of ${T.join(' ')}`,
  'T in a 2x2': (T) => `${T.join(' ')} in a 2x2`,
  'load 4 charts: T': (T) => `load 4 charts: ${T.join(' ')}`,
  'set up a 2x2 with T': (T) => `set up a 2x2 with ${T.join(', ')}`,
}
// add wordings: [words(T), how many tickers]
export const ADD_WORDINGS = {
  'add T': [(T) => `add ${T.join(' ')}`, 2],
  'add T with and': [(T) => `add ${T.join(' and ')}`, 2],
  'add charts for T': [(T) => `add charts for ${T.join(' and ')}`, 2],
  'add a chart with X': [(T) => `add a chart with ${T[0]}`, 1],
  'add a X chart': [(T) => `add a ${T[0]} chart`, 1],
  'add X': [(T) => `add ${T[0]}`, 1],
  'open 2 more charts for T': [(T) => `open 2 more charts for ${T.join(' and ')}`, 2],
  'open two more charts: T': [(T) => `open two more charts: ${T.join(', ')}`, 2],
  'add two new charts for T': [(T) => `add two new charts for ${T.join(' and ')}`, 2],
  'include T too': [(T) => `include ${T.join(' and ')} too`, 2],
  'add T as well': [(T) => `add ${T.join(' and ')} as well`, 2],
  'also chart T': [(T) => `also chart ${T.join(' and ')}`, 2],
  'put T on new charts': [(T) => `put ${T.join(' and ')} on new charts`, 2],
  'give me another chart for X': [(T) => `give me another chart for ${T[0]}`, 1],
  'open another chart with X': [(T) => `open another chart with ${T[0]}`, 1],
  'add T in a 2x2': [(T) => `add ${T.join(' ')} in a 2x2`, 4],
  'add 4 charts for T': [(T) => `add 4 charts for ${T.join(' ')}`, 4],
  'add T to the grid': [(T) => `add ${T.join(' and ')} to the grid`, 2],
}
const BOARD_SYMS = ['NVDA', 'AMD', 'MSFT', 'META', 'AAPL', 'TSLA']
const GEOM = {
  1: [[0, 0, 24, 20]],
  2: [[0, 0, 12, 20], [12, 0, 12, 20]],
  4: [[0, 0, 12, 10], [12, 0, 12, 10], [0, 10, 12, 10], [12, 10, 12, 10]],
  6: [[0, 0, 8, 10], [8, 0, 8, 10], [16, 0, 8, 10], [0, 10, 8, 10], [8, 10, 8, 10], [16, 10, 8, 10]],
}
// a chart with the member's work on it: its own timeframe, an RSI in its own pane, candles → bars, a watermark
const richOpts = (tf) => {
  const s = bareSettings()
  return { tf, watermarkPos: 'top-left',
    settings: { ...s, chartType: 'bars', indicatorInstances: [...(s.indicatorInstances || []), { id: 'rsi-a', defId: 'rsi', inputs: { length: 14 }, pane: 'pane-rsi' }],
      panes: [{ id: 'pane-rsi', height: 0.25 }] } }
}
const TFS = ['W', '60', 'D', 'W', '60', 'D']
const boardOf = (n, rich) => {
  const widgets = GEOM[n].map(([x, y, w, h], i) => ({ id: `c${i}`, type: 'chart', x, y, w, h, color: 'N', opts: rich ? richOpts(TFS[i]) : { tf: 'D', settings: bareSettings() } }))
  return [widgets, Object.fromEntries(widgets.map((w, i) => [`N:${w.id}`, BOARD_SYMS[i]]))]
}
// the member's drawings, as the product stores them: ONE map keyed by symbol (components/chart/drawingsStore)
const seedDrawings = (n) => {
  const all = Object.fromEntries(BOARD_SYMS.slice(0, n).map((s, i) => [s, [{ id: `d-${s}`, type: 'trendline', points: [{ time: 1700000000 + i, price: 10 }, { time: 1700086400, price: 12 }], tb: 'unix' }]]))
  localStorage.setItem(DRAWINGS_STORAGE_KEY, JSON.stringify(all))
  return localStorage.getItem(DRAWINGS_STORAGE_KEY)
}

let p
async function routing(v2) {
  const inner = globalThis.fetch
  globalThis.fetch = vi.fn(async (url, init = {}) => (url === '/api/agent/config'
    ? new Response(JSON.stringify({ conversations: [], routing_v2: v2 }), { status: 200, headers: { 'content-type': 'application/json' } })
    : inner(url, init)))
  try { localStorage.setItem('uct.agent.routingV2', v2 ? '1' : '0') } catch { /* */ }
  _resetAgentConfig()
  await loadAgentConfig()
  expect(routingV2Active()).toBe(v2)
}
const transcript = () => screen.getByTestId('agent-transcript').textContent
const chartsOf = (board, h) => board.state.widgets.filter(w => w.type === 'chart').map(w => ({ id: w.id, symbol: h.charts.read(w.id).symbol, tf: h.charts.read(w.id).tf, color: w.color, opts: JSON.stringify(w.opts), cell: [w.x, w.y, w.w, w.h].join(',') }))
const asked = () => screen.queryAllByTestId('agent-question').length > 0
const pendingCard = () => screen.queryAllByTestId('agent-proposal').filter(e => e.getAttribute('data-status') === 'pending')

// the scripted model: IDEAL (load = the grid reusing the board's charts; add = new charts only) and RE-SYMBOL (the board's
// charts given the requested tickers: the grid reusing them, and a chart.setSymbol on the first chart)
const grid = (T, newCharts) => ({ action: 'chartGrid.set', target: 'board', args: { symbols: T, timeframe: null, layout: null, new_charts: newCharts ? true : null, watchlist: null, replace: null } })
const PLANS = {
  ideal: (kind, T) => (kind === 'load' ? [{ ...grid(T, false), args: { ...grid(T, false).args, layout: 'grid' } }] : [{ action: 'widget.addCharts', target: 'workspace', args: { symbols: T, timeframe: null, chart_type: null, exact: null } }]),
  resymbolGrid: (kind, T) => [grid(T, false)],
  resymbolSet: (kind, T) => [{ action: 'chart.setSymbol', target: 'c0', args: { symbol: T[0] } }],
}

export const ROWS = []
for (const v2 of [false, true]) describe(`GRID LOAD keeps the charts' work [routing ${v2 ? 'v2' : 'v1'}]`, () => {
  beforeEach(async () => { p = setupPanel(); _resetTurns(); await routing(v2) })
  for (const [name, words] of Object.entries(LOAD_WORDINGS)) for (const n of [1, 2, 4, 6]) for (const rich of [false, true]) for (const plan of ['ideal', 'resymbolGrid']) {
    const said = words(LOAD4)
    it(`LOAD · ${name} · ${n} chart${n === 1 ? '' : 's'} · ${rich ? 'with work' : 'plain'} · model ${plan}: "${said}"`, async () => {
      const store0 = rich ? seedDrawings(n) : null
      const m = p.mount(...boardOf(n, rich))
      const before = chartsOf(m.board, m.h)
      const raw0 = JSON.stringify(m.board.state.widgets)
      p.st.envelopes.push(p.env('apply', PLANS[plan]('load', LOAD4)))
      expect(routingV2Active()).toBe(v2)
      await m.say(said)
      const row = { v2, kind: 'load', name, n, rich, plan, said, turns: p.turns(), asked: asked(), card: pendingCard().length > 0 }
      ROWS.push(row)
      if (n > LOAD4.length) {
        // more charts than tickers: the existing replace-or-add question (live train 4), nothing changed before the pick
        expect(row.asked, `${said}: ${transcript()}`).toBe(true)
        expect(JSON.stringify(m.board.state.widgets)).toBe(raw0)
        return
      }
      // an explicit request to populate the grid: no confirmation
      expect(row.asked || row.card, `${said}: ${transcript()}`).toBe(false)
      await waitFor(() => expect(chartsOf(m.board, m.h).map(c => c.symbol).sort(), `${said}: ${transcript()}`).toEqual([...LOAD4].sort()), { timeout: 8000 })
      const now = chartsOf(m.board, m.h)
      // every existing chart is still there, the SAME widget, with its own work: timeframe, opts (indicators, panes, chart type)
      for (const c of before) {
        const x = now.find(y => y.id === c.id)
        expect(x, `${said}: ${c.id} kept`).toBeTruthy()
        expect({ tf: x.tf, opts: x.opts }, `${said}: ${c.id}'s work`).toEqual({ tf: c.tf, opts: c.opts })
      }
      // the drawings (per symbol) are untouched: the board's own tickers' drawings come back with their ticker
      if (rich) expect(localStorage.getItem(DRAWINGS_STORAGE_KEY)).toBe(store0)
      row.resymbolled = before.filter(c => now.find(y => y.id === c.id).symbol !== c.symbol).length
      // one Undo: every chart its own ticker again, the board as it was
      await m.say('undo')
      await waitFor(() => expect(JSON.stringify(m.board.state.widgets)).toBe(raw0), { timeout: 8000 })
      expect(chartsOf(m.board, m.h)).toEqual(before)
    }, 30000)
  }
})

for (const v2 of [false, true]) describe(`ADD never re-symbols an existing chart [routing ${v2 ? 'v2' : 'v1'}]`, () => {
  beforeEach(async () => { p = setupPanel(); _resetTurns(); await routing(v2) })
  for (const [name, [words, k]] of Object.entries(ADD_WORDINGS)) for (const n of [1, 2, 4]) for (const rich of [false, true]) for (const plan of ['ideal', 'resymbolGrid', 'resymbolSet']) {
    const T = LOAD4.slice(0, k)
    const said = words(T)
    it(`ADD · ${name} · ${n} chart${n === 1 ? '' : 's'} · ${rich ? 'with work' : 'plain'} · model ${plan}: "${said}"`, async () => {
      const store0 = rich ? seedDrawings(n) : null
      const m = p.mount(...boardOf(n, rich))
      const before = chartsOf(m.board, m.h)
      p.st.envelopes.push(p.env('apply', PLANS[plan]('add', T)))
      expect(routingV2Active()).toBe(v2)
      await m.say(said)
      const row = { v2, kind: 'add', name, n, rich, plan, said, turns: p.turns(), asked: asked(), card: pendingCard().length > 0 }
      ROWS.push(row)
      // a card the model's plan became: the member applies it — what it does is what is checked
      if (row.card) { await m.click('Apply'); await waitFor(() => expect(pendingCard()).toHaveLength(0), { timeout: 8000 }) }
      const now = chartsOf(m.board, m.h)
      // ⛔ every existing chart is kept exactly: the same widget, its own ticker, timeframe, link and work
      for (const c of before) {
        const x = now.find(y => y.id === c.id)
        expect(x, `${said}: ${c.id} removed — ${transcript()}`).toBeTruthy()
        expect({ symbol: x.symbol, tf: x.tf, color: x.color, opts: x.opts }, `${said}: ${c.id} changed — ${transcript()}`).toEqual({ symbol: c.symbol, tf: c.tf, color: c.color, opts: c.opts })
      }
      if (rich) expect(localStorage.getItem(DRAWINGS_STORAGE_KEY)).toBe(store0)
      row.added = now.length - before.length
      // something happened that the member can see: charts added, or a question / a card / a sentence (never a silent re-symbol)
      expect(row.added > 0 || row.asked || row.card || transcript().length > said.length, `${said}: ${transcript()}`).toBe(true)
    }, 30000)
  }
})

// the generated rows, for the report (only when asked: GRIDLOAD_ROWS=<path>)
afterAll(() => { const out = globalThis.process?.env?.GRIDLOAD_ROWS; if (out) writeFileSync(out, JSON.stringify(ROWS, null, 1)) })

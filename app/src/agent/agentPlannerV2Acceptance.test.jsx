// ── W2-A2 PLANNER v2 ACCEPTANCE SET (Wave 2, 2026-11-03): __fixtures__/program/v2-acceptance.json through the REAL panel ──
//
// Each case is a multi-step turn as the model would drive it (the script IS the model: testing/stepServer.js plays
// the server's STEP-1 loop), executed by the ordinary browser executor (steps.js → execute → planOps → decideMode →
// commitPlan → receipts → Undo). The fixture pins what the executor reported for every step, what the board holds
// afterwards, and what the member saw — the owner's flagship and its variants, scans, charts, indicators, lists,
// layouts, Undo (across a pause, after a refusal, after a failure), partial failure, research replies, refusals.
// Planner v2 stays OFF in production: the scripted config says `planner: 'v2'` only inside these tests.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, TWO, FOUR } from './testing/panelHarness'
import { installStepServer } from './testing/stepServer'
import { _resetAgentConfig } from './agentClient'
import { _resetScreenerCache } from './capabilities/screener'
import { mergeChartSettings, CHART_DEFAULTS } from '../components/chart/chartDefaults'
import SET from './__fixtures__/program/v2-acceptance.json'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

const LISTS = () => [{ id: 'wl1', name: 'Swing', symbols: ['AAPL'] }, { id: 'wl2', name: 'Momentum', symbols: ['NVDA', 'AMD'] }]
const LAYOUTS = () => ({ entries: [{ id: 1, name: 'Swing Board' }, { id: 2, name: 'Day Trading' }], boards: {}, active: 1 })
const BARE = { overlays: CHART_DEFAULTS.overlays.map(() => ({ removed: true })) }
const ROOMY = () => [[{ id: 'c', type: 'chart', x: 0, y: 0, w: 12, h: 10, color: 'N', opts: { settings: mergeChartSettings(BARE) } }], { 'N:c': 'NVDA' }]
const BOARDS = { ROOMY, TWO: () => TWO(), FOUR: () => FOUR() }
// the fixture Screener: three rows, a saved screen; value-free fixture tickers
const SCAN = { total: 3, rows: [{ ticker: 'AAA', adr_pct: 9, price: 60 }, { ticker: 'BBB', adr_pct: 7, price: 55 }, { ticker: 'CCC', adr_pct: 6, price: 50 }], snapshot_date: '2026-10-15' }
const SAVED = [{ id: 901, name: 'ADR Movers', spec: { filters: [{ key: 'adr_pct', op: 'gt', min: 5 }] } }]   // the Screener's stored shape (filters is a list)

// Known gaps: each must fail in exactly its recorded way (a fix turns the case red until the marker is removed).
const GAPS = {}

let p, srv
// the screen's result rows are tickers the server knows (the realistic harness ticker search answers only known ones)
beforeEach(() => { _resetAgentConfig(); _resetScreenerCache(); p = setupPanel({ tickers: SCAN.rows.map(r => r.ticker) }) })
afterEach(() => { srv?.uninstall?.(); vi.restoreAllMocks(); cleanup() })

const settled = async () => { await waitFor(() => { if (screen.queryByTestId('agent-typing') || srv.stream) throw new Error('busy') }, { timeout: 15000 }) }
const tfOf = (board, id) => board.state.widgets.find(w => w.id === id)?.opts?.tf || 'D'
const chartIds = (board) => board.state.widgets.filter(w => w.type === 'chart').map(w => w.id)
const symOf = (board, id) => { const w = board.state.widgets.find(x => x.id === id); return board.state.groupSyms[w.color === 'N' ? `N:${id}` : w.color] }

/** A fixture target descriptor → the short ref for this turn. */
function resolveTarget(t, c) {
  if (t.literal) return t.literal
  if (t.alias) return t.alias
  if (t.section) { const s = c.body.context[t.section]; const e = Array.isArray(s) ? s[t.index || 0] : s; return e?.ref }
  if (t.added) {
    // every ref a step reported, from step results AND from resumes (a card approved mid-turn), in turn order
    const added = c.results.flatMap(r => r.added || []).concat(c.srv.resumes.flatMap(r => r.added || []))
    const kind = added.filter(a => a.kind === t.added)
    return kind[t.index || 0]?.ref || `missing:${t.added}`
  }
  throw new Error(`unknown target descriptor ${JSON.stringify(t)}`)
}

function scriptOf(cs) {
  return cs.script.map(item => (item.reply !== undefined ? item : (c) => ({ action: item.action, target: resolveTarget(item.target, c), args: item.args, mode: item.mode })))
}

function installScreener() {
  const prev = globalThis.fetch
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url)
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
    if (u === '/api/screener/fields') return json({ fields: [{ key: 'adr_pct', label: 'ADR %', type: 'range', unit: '%' }, { key: 'price', label: 'Price', type: 'range', unit: '$' }] })
    if (u === '/api/screener/fields?options=1') return json({ options: {} })
    if (u === '/api/screener/scan') return json(SCAN)
    if (u === '/api/screener/saved-screens') return json({ saved: SAVED, starters: [] })
    return prev(url, init)
  }
}

function check(exp, { board, cs }) {
  if (!exp) return
  if (exp.results) expect(srv.results.map(r => r.status)).toEqual(exp.results)
  if (exp.resumes) expect(srv.resumes.map(r => [r.id, r.status])).toEqual(exp.resumes)
  if (exp.lists) expect(board.state.server.lists.map(l => l.name)).toEqual(exp.lists)
  if (exp.listCount) for (const [name, n] of Object.entries(exp.listCount)) expect(board.state.server.lists.find(l => l.name === name)?.items.length).toBe(n)
  if (exp.charts != null) expect(chartIds(board)).toHaveLength(exp.charts)
  if (exp.tf) for (const [id, tf] of Object.entries(exp.tf)) expect(tfOf(board, id)).toBe(tf)
  if (exp.chartType) for (const [id, t] of Object.entries(exp.chartType)) expect(board.host.charts.read(id).cs.chartType).toBe(t)
  if (exp.symbol) for (const [id, s] of Object.entries(exp.symbol)) expect(symOf(board, id)).toBe(s)
  if (exp.layoutNames) expect(board.state.layouts.entries.map(e => e.name)).toEqual(exp.layoutNames)
  if (exp.transcript) expect(p.transcript()).toMatch(new RegExp(exp.transcript))
  if (exp.noTranscript) expect(p.transcript()).not.toMatch(new RegExp(exp.noTranscript))
  if (exp.proposals != null) expect(p.proposals()).toHaveLength(exp.proposals)
  if (exp.receipts != null) expect(p.summaries()).toHaveLength(exp.receipts)
  if (exp.refusalMatches) for (const [i, re] of Object.entries(exp.refusalMatches)) expect(srv.results[Number(i)].refusal || '').toMatch(new RegExp(re))
  if (exp.indicators) for (const [id, brief] of Object.entries(exp.indicators)) expect(p.brief(board, id)).toEqual(brief)
  if (exp.addedTf) { const added = chartIds(board).filter(id => id.startsWith('w-chart-')); expect(added.length).toBeGreaterThan(0); for (const id of added) expect(tfOf(board, id)).toBe(exp.addedTf) }
  if (exp.addedSymbol) { const added = chartIds(board).filter(id => id.startsWith('w-chart-')); expect(symOf(board, added[0])).toBe(exp.addedSymbol) }
  if (exp.addedIndicators) { const added = chartIds(board).filter(id => id.startsWith('w-chart-')); expect(p.brief(board, added[exp.addedIndicators.index])).toEqual(exp.addedIndicators.brief) }
  if (exp.sources != null) expect(screen.queryAllByTestId('agent-sources')).toHaveLength(exp.sources)
  if (exp.v1turns != null) expect(p.turns()).toBe(exp.v1turns)
  if (exp.stepBodies != null) expect(srv.bodies).toHaveLength(exp.stepBodies)
  void cs
}

describe('W2-A2 — planner v2 scripted acceptance set', () => {
  it('the set is large enough and well-formed', () => {
    expect(SET.cases.length).toBeGreaterThanOrEqual(30)
    const ids = SET.cases.map(c => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const c of SET.cases) {
      expect(c.script[c.script.length - 1].reply).toBeDefined()
      expect(['flagship', 'scan', 'charts', 'indicators', 'lists', 'layouts', 'undo', 'partial', 'research', 'refusal']).toContain(c.group)
    }
    expect(SET.cases.filter(c => c.group === 'flagship').length).toBeGreaterThanOrEqual(4)
  })

  for (const cs of SET.cases) {
    const gap = GAPS[cs.id]
    const run = gap ? (title, fn, t) => it(title, async () => {
      let err = null
      try { await fn() } catch (e) { err = e }
      if (!err) throw new Error(`KNOWN GAP ${gap.id} no longer fails — remove the marker`)
      if (!String(err.message).includes(gap.mode)) throw err
    }, t) : it
    run(`${cs.id} ${cs.title}${gap ? ` [KNOWN GAP ${gap.id}]` : ''}`, async () => {
      installScreener()
      srv = installStepServer(p, scriptOf(cs), { planner: cs.planner || 'v2' })
      const [widgets, syms] = BOARDS[cs.board]()
      const { say, board } = p.mount(widgets, syms, { watchlists: LISTS(), layouts: LAYOUTS() })
      if (cs.failApplyBoard) board.state.failApplyBoard = true
      await say(cs.say)
      await settled()
      // cs.expect is the state once the turn is over: after the initial say and any continuation ("do it") turns
      // that carry no expectation of their own — i.e. before the first follow-up that pins its own (an Undo)
      let checked = false
      for (const step of cs.then || []) {
        if (step.expect && !checked) { check(cs.expect, { board, cs }); checked = true }
        await say(step.say)
        await settled()
        check(step.expect, { board, cs })
      }
      if (!checked) check(cs.expect, { board, cs })
    }, 45000)
  }
})

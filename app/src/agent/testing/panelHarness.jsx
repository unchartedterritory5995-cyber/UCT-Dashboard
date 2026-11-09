/* eslint-disable react-refresh/only-export-components -- a test harness: helpers and board fixtures beside the mount */
// ── A REAL Agent panel over a fixture board, for multi-turn conversation tests (test-only module) ──────
//
// The same construction agentOperatorLive / agentIndicatorCreate use: the REAL AgentPanel + useAgent +
// registry, planner, policy, runtime, receipts and Undo; the REAL board writer (fixture board: the product's
// placement and applyBoard) and the REAL Indicators mutation interface on each chart's stored settings.
// Stand-ins: the Agent model (/api/agent/turn — scripted per test, or a sentinel answer when none is
// queued, so a test can see exactly which turns would have needed the model) and the definitions server.
// No paid model call.
//
//   const p = setupPanel()                  // in beforeEach (installs fetch)
//   const { say, board, h } = p.mount(...FOUR())
//   await say('add the 9 and 20 ema')
//   p.turns()  p.instancesOn(board, 'c0')  p.lastAgent()
import { vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { makeBoard } from '../__fixtures__/board'
import { mergeChartSettings, CHART_DEFAULTS } from '../../components/chart/chartDefaults'
import { _resetAuthoring } from '../capabilities/indicatorAuthoring'
import { _resetProposedPlans } from '../capabilities/indicatorEdits'
import { _simulateReload, STORAGE_KEY } from '../../components/chart/builder/authoring/conversationSessions'
import { _resetDraftPreview } from '../../components/chart/builder/agentAuthoring'
import { AuthContext } from '../../context/AuthContext'
import AgentPanel from '../AgentPanel'

/** What the model "said" when a test queued nothing: visible in the transcript, so a test can assert on it. */
export const MODEL_SENTINEL = '«the model was asked»'

// The product's default overlays (EMA 9/20, SMA 50/200) removed, as a member's removal leaves them —
// so "add the 9 EMA" is asked on a chart that does not already show one.
const BARE = { overlays: CHART_DEFAULTS.overlays.map(() => ({ removed: true })) }
export const bareSettings = () => mergeChartSettings(BARE)

const chart = (id, x, y, w, h) => ({ id, type: 'chart', x, y, w, h, color: 'N', opts: { settings: bareSettings() } })
export const ONE = (sym = 'QQQ') => [[chart('c', 0, 0, 24, 20)], { 'N:c': sym }]
export const TWO = (a = 'NVDA', b = 'AMD') => [[chart('cl', 0, 0, 12, 20), chart('cr', 12, 0, 12, 20)], { 'N:cl': a, 'N:cr': b }]
export const FOUR = (syms = ['SPY', 'QQQ', 'NVDA', 'TSLA']) => [['c0', 'c1', 'c2', 'c3'].map((id, i) => chart(id, (i % 2) * 12, Math.floor(i / 2) * 10, 12, 10)),
  Object.fromEntries(syms.map((s, i) => [`N:c${i}`, s]))]
export const label = (s) => (s ? { ...s, label: `Chart (${s.symbol})` } : s)

// ── The ticker search, as the backend answers it (AUDIT 11-07: the harness used to answer ANY query with that query as a valid
// ticker, so symbol grounding was silently untestable): an exact ticker first, then tickers that start with the query, then
// companies whose name contains it. The table below, plus every ticker a mounted board shows (a chart's ticker is a known one).
// `setupPanel({ tickerEcho: true })` is the old echo, as an explicit opt-in. Fixture names only; no market data.
export const TICKERS = [
  ['SPY', 'SPDR S&P 500 ETF Trust'], ['QQQ', 'Invesco QQQ Trust'], ['DIA', 'SPDR Dow Jones Industrial Average ETF'], ['IWM', 'iShares Russell 2000 ETF'],
  ['NVDA', 'NVIDIA Corporation'], ['AMD', 'Advanced Micro Devices, Inc.'], ['TSLA', 'Tesla, Inc.'], ['AAPL', 'Apple Inc.'], ['MSFT', 'Microsoft Corporation'],
  ['META', 'Meta Platforms, Inc.'], ['AMZN', 'Amazon.com, Inc.'], ['GOOGL', 'Alphabet Inc.'], ['GOOG', 'Alphabet Inc. Class C'], ['NFLX', 'Netflix, Inc.'],
  ['AVGO', 'Broadcom Inc.'], ['TSM', 'Taiwan Semiconductor Manufacturing'], ['PLTR', 'Palantir Technologies Inc.'], ['RKLB', 'Rocket Lab USA, Inc.'],
  ['ASTS', 'AST SpaceMobile, Inc.'], ['IBM', 'International Business Machines'], ['INTC', 'Intel Corporation'], ['MU', 'Micron Technology, Inc.'],
  ['SMCI', 'Super Micro Computer, Inc.'], ['ARM', 'Arm Holdings plc'], ['UBER', 'Uber Technologies, Inc.'], ['CRM', 'Salesforce, Inc.'],
  ['ADBE', 'Adobe Inc.'], ['ORCL', 'Oracle Corporation'], ['COIN', 'Coinbase Global, Inc.'], ['HOOD', 'Robinhood Markets, Inc.'], ['SHOP', 'Shopify Inc.'],
  ['JPM', 'JPMorgan Chase & Co.'], ['XOM', 'Exxon Mobil Corporation'], ['GLD', 'SPDR Gold Shares'], ['TLT', 'iShares 20+ Year Treasury Bond ETF'],
  ['SMH', 'VanEck Semiconductor ETF'], ['XLK', 'Technology Select Sector SPDR'], ['XLE', 'Energy Select Sector SPDR'], ['XLF', 'Financial Select Sector SPDR'],
  ['IT', 'Gartner, Inc.'], ['ON', 'ON Semiconductor Corporation'], ['ALL', 'The Allstate Corporation'], ['NOW', 'ServiceNow, Inc.'], ['BRCB', 'Fixture BRCB'],
  ['VIX', 'CBOE Volatility Index'], ['BTC', 'Bitcoin'], ['SOFI', 'SoFi Technologies, Inc.'], ['CRWD', 'CrowdStrike Holdings, Inc.'], ['DELL', 'Dell Technologies Inc.'],
  ['ANET', 'Arista Networks, Inc.'], ['MRVL', 'Marvell Technology, Inc.'], ['QCOM', 'QUALCOMM Incorporated'], ['TXN', 'Texas Instruments Incorporated'],
  ['BA', 'The Boeing Company'], ['DIS', 'The Walt Disney Company'], ['WMT', 'Walmart Inc.'], ['COST', 'Costco Wholesale Corporation'], ['V', 'Visa Inc.'],
]
function tickerSearch(raw, st) {
  const q = String(raw || '').trim()
  if (!q) return []
  if (st.tickerEcho) return [{ ticker: q.toUpperCase() }]
  const up = q.toUpperCase(), low = q.toLowerCase()
  const table = [...TICKERS.map(([ticker, name]) => ({ ticker, name })), ...[...st.known].filter(t => !TICKERS.some(([x]) => x === t)).map(ticker => ({ ticker, name: '' }))]
  const exact = table.filter(r => r.ticker === up)
  const prefix = table.filter(r => r.ticker !== up && r.ticker.startsWith(up))
  const named = table.filter(r => r.ticker !== up && !r.ticker.startsWith(up) && r.name.toLowerCase().includes(low))
  return [...exact, ...prefix, ...named].slice(0, 20)
}

export function setupPanel({ tickerEcho = false, tickers = [] } = {}) {
  // `tickers`: extra tickers the server knows in this test (a screen's own result rows, a fixture list's symbols)
  const st = { envelopes: [], calls: [], selected: null, tickerEcho, known: new Set(tickers.map(t => String(t).toUpperCase())) }
  const env = (disposition, ops, reply = '') => ({ disposition, reply, question: null, ops, unsupported_category: null })
  _simulateReload()
  try { sessionStorage.removeItem(STORAGE_KEY) } catch { /* */ }
  try { localStorage.clear() } catch { /* */ }
  _resetAuthoring(); _resetDraftPreview(); _resetProposedPlans()
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null
    st.calls.push([init.method || 'GET', String(url), body])
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
    if (url === '/api/agent/turn') {
      const e = st.envelopes.shift() || env('answer', [], MODEL_SENTINEL)
      return json({ conversationId: 'ac_1', envelope: typeof e === 'function' ? e(body) : e, usage: { research_calls: 0, citations: [] } })
    }
    if (url === '/api/agent/record') return json({ conversationId: 'ac_1' })
    if (String(url).startsWith('/api/user-definitions')) return json({ definitions: [] })
    const q = /ticker-search\?q=([^&]+)/.exec(String(url))
    if (q) return json({ results: tickerSearch(decodeURIComponent(q[1]), st) })
    if (String(url).startsWith('/api/live-prices')) return json({})
    return json({ conversations: [] })
  })

  const idle = () => waitFor(() => { if (screen.queryByTestId('agent-typing')) throw new Error('busy') }, { timeout: 10000 })
  const turns = () => st.calls.filter(c => c[1] === '/api/agent/turn').length
  const lastTurnBody = () => [...st.calls].reverse().find(c => c[1] === '/api/agent/turn')?.[2] || null
  const transcript = () => screen.getByTestId('agent-transcript').textContent
  const proposals = () => screen.queryAllByTestId('agent-proposal')
  const summaries = () => screen.queryAllByTestId('agent-receipt-summary').map(e => e.textContent)

  function mount(widgets, groupSyms, { decorate = label, admin = true, layouts = null, watchlists = null, geometry = null } = {}) {
    const board = makeBoard(widgets, groupSyms, layouts || watchlists || geometry ? { ...(layouts ? { layouts } : {}), ...(watchlists ? { watchlists } : {}), ...(geometry || {}) } : undefined)
    // a ticker a mounted chart shows is one the backend knows
    for (const v of Object.values(groupSyms || {})) if (typeof v === 'string' && v.trim()) st.known.add(v.trim().toUpperCase())
    const base = board.host.charts
    const d = decorate || ((s) => s)
    const h = {
      ...board.host,
      charts: { ...base, list: () => base.list().map(d), read: (ref) => d(base.read(ref)), canManageIndicators: () => true, canCreateIndicator: () => true, previewHost: () => null, selected: () => st.selected },
      persist: async (...a) => (st.persist ? st.persist(...a) : { ok: true }),   // st.persist: a test's own save
    }
    render(<AuthContext.Provider value={{ user: { id: 1, role: admin ? 'admin' : 'member' } }}><AgentPanel host={h} onClose={() => {}} /></AuthContext.Provider>)
    const box = screen.getByLabelText('Message UCT Agent')
    // → the text the turn added to the transcript (after the member's own line)
    const say = async (t) => {
      await idle()
      const before = transcript().length
      fireEvent.change(box, { target: { value: t } }); fireEvent.keyDown(box, { key: 'Enter' })
      await idle()
      await new Promise(r => setTimeout(r, 0))
      await idle()
      // everything after the member's own line (timestamps re-render, so not by length alone)
      const all = transcript()
      const at = all.lastIndexOf(t)
      return at >= 0 ? all.slice(at + t.length) : all.slice(before)
    }
    const click = async (name) => {
      await idle()
      const before = transcript().length
      fireEvent.click(screen.getByRole('button', { name }))
      await idle()
      await new Promise(r => setTimeout(r, 0))
      await idle()
      return transcript().slice(before)
    }
    return { board, h, say, click }
  }

  /** The live (not removed) indicator instances on one chart: [{ defId, inputs, name? }]. */
  function instancesOn(board, id) {
    const w = board.state.widgets.find(x => x.id === id)
    const cs = mergeChartSettings(w?.opts?.settings ? JSON.stringify(w.opts.settings) : null)
    return (cs.indicatorInstances || []).filter(i => !i.deleted)
  }
  /** "movingAverage(9 ema)" style one-liners, for readable assertions. */
  function brief(board, id) {
    return instancesOn(board, id).map(i => {
      const p = i.inputs || {}
      const bits = [p.period, p.maType].filter(v => v != null)
      return `${i.defId}${bits.length ? `(${bits.join(' ')})` : ''}`
    })
  }
  function presentationOf(board, id, pred) {
    const i = instancesOn(board, id).find(pred)
    return i?.presentation || null
  }
  return { st, env, mount, idle, turns, lastTurnBody, transcript, proposals, summaries, instancesOn, brief, presentationOf, select: (ref) => { st.selected = ref } }
}

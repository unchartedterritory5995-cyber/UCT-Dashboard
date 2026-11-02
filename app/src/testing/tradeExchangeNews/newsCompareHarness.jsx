// ── TRADE EXCHANGE NEWS · VISUAL COMPARISON HARNESS ─────────────────────────
//
// Mounts the REAL Watchlist, Theme Tracker and News (tradeExchangeNews) widgets
// side by side, each inside a real `.widgetBody` (the workspace's container-query
// root), so their chrome can be compared in a real browser — screenshots plus
// computed-style measurements (tools/txn_news_visual_compare.py drives it).
//
// ⛔ SYNTHETIC ONLY, AND IT CANNOT WRITE. Every API answer below is invented (no
// market data, no Trade Exchange content), the news stream is a scripted
// EventSource, and every non-GET request is REFUSED and recorded — the
// pane/scan-harness locks: widget opts live in page state, the workspace value
// spreads the canonical WORKSPACE_FALLBACK, and fetch refuses writes.
//
// Dev-server only (vite builds index.html alone) — railed by
// newsCompareHarnessAbsent.test.js.
//
//   ?theme=dark|light   app theme the widgets are PLACED under
//   ?apply=<chartThemeId>  simulate the widget gallery's "Apply to all widgets"
//   ?density=compact|comfortable
//   ?width=<px>           pane width (responsive checks; default 320)
//   ?only=news&count=<n>  render only <n> News widgets (multi-widget checks)
//   ?wire=terminal        the terminal-upgrade fixture (long headline, impact marks,
//                         a re-sent story, several tickers)
//   ?rows=<n>             <n> synthetic headlines (performance checks; max 5000, the
//                         archive's count bound). POST /day and GET /days are answered by
//                         fakeNewsDay over them (/day is a READ: the only non-GET let through,
//                         with POST /explain, answered by an INVENTED explanation -- no model)
//   ?opts=<json>          initial News widget opts (e.g. {"settings":{"groupRelated":"on"}})
//   ?library=1            add a second UCT News widget opened on its Saved Headlines view.
//                         The /library/* API is the in-memory fakeLibraryServer over the
//                         synthetic headlines (pre-seeded with three saves, a collection and a
//                         note); "Send to Notebook" lands in an in-memory inbox
//                         (window.__newsHarnessNotebook) -- page memory only, never the network.
//   ?live=1               LIVE MODE for tools/txn_local_e2e.py: /api/trade-exchange-news/*
//                         goes to the real (local, synthetic) web process through
//                         vite.txn-e2e.config.mjs, and the News pool opens its own
//                         stream — nothing about the news path is faked.

import '../../index.css'
import { useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { AuthProvider } from '../../context/AuthContext'
import { WorkspaceContext, WORKSPACE_FALLBACK } from '../../pages/charts/WorkspaceContext'
import { PlacedThemeContext } from '../../hooks/usePlacedTheme'
import WatchlistWidget from '../../pages/charts/widgets/WatchlistWidget'
import ThemesWidget from '../../pages/charts/widgets/ThemesWidget'
import TradeExchangeNewsWidget from '../../pages/charts/widgets/TradeExchangeNewsWidget'
import { fakeNewsDay, fakeNewsDays } from './fakeNewsDay'
import { fakeLibraryServer } from './fakeLibraryServer'
import { formatTimeEt } from '../../lib/presentation/presentationPrimitives'
import { timeLabel } from '../../pages/charts/widgets/tradeExchangeNewsModel'
import { NewsAgentContext } from '../../pages/charts/widgets/tradeExchangeNewsAgent'
import { openAgent, useAgentAsk } from '../../agent/newsAsk'
import { CHART_THEME_BY_ID, patchWidgetOptsWithTheme, mapThemeToWidgetSettings, themeWithAppSurface } from '../../components/chart/chartThemes'
import wsStyles from '../../pages/charts/ChartsWorkspace.module.css'

const params = new URLSearchParams(location.search)
const THEME = params.get('theme') === 'light' ? 'light' : 'dark'
const APPLY = params.get('apply') || ''
const DENSITY = params.get('density') || ''
const WIDTH = Number(params.get('width')) || 320
const ONLY_NEWS = params.get('only') === 'news'
const COUNT = Math.max(1, Math.min(4, Number(params.get('count')) || 1))
const LIVE = params.get('live') === '1'
const LIBRARY = params.get('library') === '1'
// ?role=member: a signed-in member (no UCT Agent mark on explanations); default admin.
const ROLE = params.get('role') === 'member' ? 'member' : 'admin'
// ?agent=1|0: this browser's UCT Agent switch (the panel's own key); unset leaves it alone.
if (params.get('agent') === '1' || params.get('agent') === '0') {
  try { localStorage.setItem('uct.feature.agent', params.get('agent')) } catch { /* storage blocked */ }
}
document.documentElement.dataset.theme = THEME

const SYMS = ['ALFA', 'BRVO', 'CHRL', 'DLTX', 'ECHO', 'FXTR', 'GLFX', 'HTLX']
const NOW = Date.now()
const rnd = (i, k) => (((i * 9301 + k * 49297) % 233280) / 233280 - 0.5)   // deterministic, synthetic
const json = (body, status = 200) => Promise.resolve(new Response(JSON.stringify(body),
  { status, headers: { 'content-type': 'application/json' } }))

const appliedTheme = APPLY ? CHART_THEME_BY_ID[APPLY] : null
const themeTrackerPref = appliedTheme
  ? mapThemeToWidgetSettings({}, themeWithAppSurface(appliedTheme), 'themes')
  : undefined

const HEADLINES = [
  ['SYNTHETIC: $ALFA announces a placeholder product event', ['ALFA']],
  ['SYNTHETIC: BRVO and CHRL disclose an example partnership', ['BRVO', 'CHRL']],
  ['SYNTHETIC: Macro wire — example economic release text for layout testing only', []],
  ['SYNTHETIC: DLTX guidance headline used to compare row height and wrapping across widgets', ['DLTX']],
  ['SYNTHETIC: ECHO halted pending example news', ['ECHO']],
  ['SYNTHETIC: Example sector note mentioning FXTR', ['FXTR']],
  ['SYNTHETIC: GLFX example headline', ['GLFX']],
  ['SYNTHETIC: HTLX example headline with a longer body to show the two-line clamp in compact density', ['HTLX']],
]
// ?wire=old|new — Trade Exchange wire FORMATS (illustrative text), with the server's
// output under the OLD resolver (HEADLINE context, no category) or the NEW one (wire
// contexts + category). Both columns were produced by the real Python resolver.
const WIRE = [
  ['TX-News', 'HASSETT: TRUMP BELIEVES RATES CAN BE LOWER; TRUMP RESPECTS FED INDEPENDENCE', ['CAN'], [], 'Macro'],
  ['TX-News', 'GOOGL lows', ['GOOGL'], ['GOOGL'], 'Price'],
  ['TX-Filings', 'FORM 4P - TFC - TRUIST FINANCIAL CORP*DIRECTOR|OFFICER - CEO: EXAMPLE NAME MP | 25,000 | $48.36', ['FORM', 'TFC', 'MP'], ['TFC'], 'Filing'],
  ['TX-PressRelease', 'DTE - Example Energy Reports Third Quarter 2026 Results', ['DTE'], ['DTE'], 'Earnings'],
  ['TX-PressRelease', 'NVAX NVAX - Example Bio Earns $125 Million Milestone in Partnership', ['NVAX'], ['NVAX'], 'Press Release'],
  ['TX-Options', 'AAPL unusual call activity ahead of the event', ['AAPL'], ['AAPL'], 'Options'],
  ['TX-PressRelease', 'S - Example Security Named Most Valuable Vendor at a Regional Summit', [], ['S'], 'Press Release'],
  ['TX-News', 'Example Corp names a new chief operating officer', [], [], 'News'],
  ['TX-News', 'WHITE HOUSE: WE CAN BE FLEXIBLE ON TIMING, ALL OPTIONS ARE ON THE TABLE', ['CAN', 'ALL'], [], 'News'],
  ['TX-News1', 'CRYPTO', [], [], 'News', { placeholder: 'graphic' }],
  ['TX-News1', 'VIX 16.40', ['VIX'], ['VIX'], 'Price'],
  ['TX-News', 'MICROSOFT EXPECTS TO RAISE ABOUT $25 BILLION IN US BOND SALE - SOURCE', [], ['MSFT'], 'News',
    { mentions: [['MICROSOFT', 'MSFT']] }],
]
// Deterministic synthetic quotes for the wire rows: up, down, flat, and one symbol
// (VIX) with NO quote, so every tone is on screen.
const WIRE_QUOTES = { MSFT: [412.3, 1.24], GOOGL: [171.1, -2.05], TFC: [48.36, 0.62], DTE: [131.9, 0.4],
  NVAX: [9.12, -3.1], AAPL: [228.4, 0.88], S: [21.05, 0], BRCB: [24.1, 1.9], NVDA: [181.2, -1.4], SAMP: [31.4, 12.6],
  SM: [27.3, 0.7], SD: [12.4, -0.6], BC: [88.2, 0.3], USB: [47.9, 0.2], USA: [6.1, -0.4], GIC: [33.6, 0.5], XGMS: [14.2, 2.2] }
// ?wire=review&phase=before|after -- the 2026-10-29 production review: each row with
// the tickers/mentions production served (before) and the server's corrected answer
// (after), so one fixture renders through the old and the new widget alike.
// [source, content, category, before [tickers, mentions], after [tickers, mentions], ageMs]
const REVIEW = [
  ['TX-News', 'Top Admiral Briefs Trump On Iran Attack Options -- WSJ (SM Circulations)', 'News', [['SM'], []], [[], []]],
  ['TX-PressRelease', 'BRCB - Black Rock Coffee Bar Expands Footprint in California with New Riverside Location', 'Press Release',
    [['BRCB'], [['Black Rock Coffee Bar', 'BRCB']]], [['BRCB'], []]],
  ['TX-News', 'Hackers exploit Cisco SD-WAN flaw to deploy custom KeyDrift malware - BC', 'News', [['SD', 'BC'], []], [[], []]],
  ['TX-News', 'TALKS AIM TO SECURE U.S. SUPPORT FOR THE PLAN, OFFICIALS SAY', 'News', [['USB'], [['U.S', 'USB']]], [[], []]],
  ['TX-PressRelease', 'XGMS - X Games USA Launches New Summer Series', 'Press Release', [['XGMS', 'USA'], []], [['XGMS'], []]],
  ['TX-News', 'CEO speaks at the 2026 Global Industrial Conference in Chicago', 'News', [['GIC'], [['Global Industrial', 'GIC']]], [[], []]],
  ['TX-News', 'Microsoft and NVIDIA lead gains as AAPL tops a record', 'News',
    [['AAPL', 'MSFT', 'NVDA'], [['Microsoft', 'MSFT'], ['NVIDIA', 'NVDA']]], [['AAPL', 'MSFT', 'NVDA'], [['Microsoft', 'MSFT'], ['NVIDIA', 'NVDA']]]],
  ['TX-News', 'MICROSOFT EXPECTS TO RAISE ABOUT $25 BILLION IN US BOND SALE - SOURCE', 'News',
    [['MSFT'], [['MICROSOFT', 'MSFT']]], [['MSFT'], [['MICROSOFT', 'MSFT']]]],
  ['TX-PressRelease', 'CBWA - Example Bancorp, Inc. Announces Third Quarter 2026 Results', 'Earnings', [['CBWA'], []], [['CBWA'], []], 86_400_000],
]
// ?wire=terminal -- the terminal upgrade: [source, content, category, tickers, extra]
const T_STORY = 'Example Holdings agrees to acquire Sample Robotics for $4.2 billion in cash'
const TERMINAL = [
  ['TX-PressRelease', 'DTE - Example Energy Reports Third Quarter 2026 Results', 'Earnings', ['DTE']],
  ['TX-News', `SAMP - ${T_STORY}`, 'News', ['SAMP'], { impact: 'mna' }],
  ['TX-News1', 'US CPI (Y/Y) Oct: 3.1% (est 3.0%)', 'Macro', [], { impact: 'econ_release' }],
  ['TX-News', 'Microsoft and NVIDIA lead gains as AAPL tops a record; NVIDIA extends the run', 'News',
    ['AAPL', 'MSFT', 'NVDA'], { mentions: [['Microsoft', 'MSFT'], ['NVIDIA', 'NVDA']] }],
  ['TX-News', `${'SYNTHETIC LONG WIRE: GOOGL outlines a multi-year capital plan covering data centers, power purchase agreements, custom silicon and network buildouts across three continents, with management walking analysts through every segment. '.repeat(3)}Full text continues to the final sentence.`,
    'News', ['GOOGL']],
  ['TX-PressRelease', T_STORY, 'Press Release', ['SAMP'], { impact: 'mna' }],
  ['TX-News', 'FED HOLDS RATES STEADY AT 4.25%-4.50%', 'Macro', [], { impact: 'central_bank', fresh: true }],
]
const WIRE_MODE = params.get('wire')
const ROWS_N = Math.max(0, Math.min(5000, Number(params.get('rows')) || 0))
let OPTS_PARAM = {}
try { OPTS_PARAM = JSON.parse(params.get('opts') || '{}') || {} } catch { OPTS_PARAM = {} }
const REVIEW_PHASE = params.get('phase') === 'before' ? 3 : 4
const ROWS = ROWS_N
  ? Array.from({ length: ROWS_N }, (_, i) => ({ source: 'TX-News', category: ['News', 'Earnings', 'Macro', 'Press Release'][i % 4],
    content: `SYNTHETIC ${i + 1}: ${SYMS[i % SYMS.length]} example headline ${i % 3 ? 'with a little more text to wrap across a line' : ''}`,
    tickers: [SYMS[i % SYMS.length]], ...(i % 97 === 0 ? { impact: 'guidance' } : {}) }))
  : WIRE_MODE === 'terminal'
    ? TERMINAL.map(([source, content, category, tickers, extra]) => ({ source, content, category, tickers, ...(extra || {}) }))
    : WIRE_MODE === 'review'
  ? REVIEW.map((r) => ({ source: r[0], content: r[1], category: r[2], tickers: r[REVIEW_PHASE][0],
    mentions: r[REVIEW_PHASE][1], ...(r[5] ? { ageMs: r[5] } : {}) }))
  : WIRE_MODE
    ? WIRE.map(([source, content, oldT, newT, category, extra]) => ({ source, content,
      tickers: WIRE_MODE === 'old' ? oldT : newT, ...(WIRE_MODE === 'old' ? {} : { category, ...(extra || {}) }) }))
    : HEADLINES.map(([content, tickers]) => ({ source: 'TXNews1', content, tickers }))
const NEWS = ROWS.map(({ ageMs, fresh, ...r }, i) => ({
  type: 'headline', epoch: 'harness0harness0', seq: i + 1, id: `HARNESS${String(i).padStart(18, '0')}`,
  ...r, received_at_ms: fresh ? NOW - 40_000 : NOW - (ROWS.length - i) * (WIRE_MODE === 'terminal' ? 120_000 : 97_000) - (ageMs || 0),
  repeat_count: !WIRE_MODE && i === 4 ? 1 : 0, via: !WIRE_MODE && i === 2 ? 'reconcile' : 'push', delayed: !WIRE_MODE && i === 2,
}))

const LIVE_ADDED = new Set()
// 'HH:MM' on an ET date -> the last instant of that minute (EDT -4 or EST -5: the
// one the shared ET formatter reads back as that time).
function harnessAtMs(date, hhmm) {
  const [y, mo, d] = date.split('-').map(Number)
  const [h, mi] = hhmm.split(':').map(Number)
  const edt = Date.UTC(y, mo - 1, d, h + 4, mi)
  return (formatTimeEt(edt) === timeLabel(hhmm) ? edt : edt + 3_600_000) + 59_999
}
// The Research Library's API, in page memory (?library=1). Seeded lazily from NEWS.
let _lib = null
function libraryServer() {
  if (_lib) return _lib
  _lib = fakeLibraryServer(NEWS)
  const L = '/api/trade-exchange-news/library'
  const seed = [...NEWS].filter((n) => !n.placeholder).slice(-3).map((n) => n.id)
  for (const id of seed) _lib.fetch(`${L}/bookmarks/${id}`, { method: 'PUT', body: '{}' })
  _lib.fetch(`${L}/collections`, { method: 'POST', body: JSON.stringify({ name: 'Earnings season' }) })
  _lib.fetch(`${L}/collections/c1/items/${seed[0]}`, { method: 'PUT' })
  _lib.fetch(`${L}/bookmarks/${seed[0]}/note`, { method: 'PUT', body: JSON.stringify({ note: 'SYNTHETIC note: compare with last quarter' }) })
  return _lib
}
const BLOCKED = []
const NOTEBOOK = []
window.__newsHarnessNotebook = NOTEBOOK
window.__newsHarnessBlocked = BLOCKED
// ?ask=real: UCT Agent's OWN useAgentAsk talks to this INVENTED /api/agent (no model, never the
// network). Every request is kept in window.__agentCalls; &askfail=402 refuses each turn the way the
// server's budget refusal does (final), &askfail=503 like a passing outage (retryable);
// &askdelay=ms holds each answer (default 300).
const ASK_REAL = params.get('ask') === 'real'
const AGENT_CALLS = []
window.__agentCalls = AGENT_CALLS
const AGENT_TRANSCRIPT = [
  { id: 1, role: 'member', text: 'What does this mean for the stock?' },
  { id: 2, role: 'agent', text: 'SYNTHETIC: The company says profit beat its own outlook. That is the company’s claim; I don’t have a live quote here.' },
  { id: 3, role: 'member', text: 'What should I look for next?' },
  { id: 4, role: 'agent', text: 'SYNTHETIC: Guidance details and any analyst revisions; the headline gives neither yet.' },
]
function fakeAgent(method, path, init) {
  const body = init && init.body ? JSON.parse(init.body) : null
  AGENT_CALLS.push({ method, path, body })
  if (method === 'POST' && path === '/api/agent/turn') {
    const fail = Number(params.get('askfail'))
    if (fail === 402) return json({ detail: 'UCT Agent has used today’s budget. It resets at midnight ET.' }, 402)
    if (fail >= 500) return json({ detail: 'UCT Agent is busy right now. Try again in a moment.' }, fail)
    return new Promise((r) => setTimeout(r, Number(params.get('askdelay')) || 300)).then(() => json({
      conversationId: 'ac_harness_news', envelope: { disposition: 'answer', reply: `SYNTHETIC answer to “${body.message}”.` } }))
  }
  if (method === 'GET' && path.startsWith('/api/agent/conversations/')) {
    return json({ id: decodeURIComponent(path.split('/').pop()), turns: AGENT_TRANSCRIPT })
  }
  return json({ detail: 'not in the harness' }, 404)
}
const realFetch = window.fetch.bind(window)
window.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : (input && input.url) || ''
  const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase()
  if (!url.startsWith('/') && !url.startsWith(location.origin)) return realFetch(input, init)
  const path = url.replace(location.origin, '')
  if (ASK_REAL && path.startsWith('/api/agent/')) return fakeAgent(method, path, init)
  if (LIVE && path.startsWith('/api/trade-exchange-news')) return realFetch(input, init)
  if (path.startsWith('/api/trade-exchange-news/library')) return libraryServer().fetch(path, init || {})
  if (method === 'POST' && path === '/api/trade-exchange-news/day') {
    return json(fakeNewsDay(NEWS, JSON.parse((init && init.body) || '{}'), { epoch: 'harness0harness0', atMs: harnessAtMs }))
  }
  if (path.startsWith('/api/trade-exchange-news/days')) return json(fakeNewsDays(NEWS))
  // AI Explanation: an INVENTED answer (no model is called; nothing is written).
  if (method === 'POST' && path === '/api/trade-exchange-news/explain') {
    const id = JSON.parse((init && init.body) || '{}').id
    const row = NEWS.find((n) => n.id === id)
    return json({ id, headline: row?.content || '', received_at_ms: row?.received_at_ms || NOW,
      explanation: 'SYNTHETIC: The company says adjusted profit beat its own outlook. Adjusted figures leave out '
        + 'one-time items, so traders may compare them with expectations; the headline gives no detail on guidance yet.',
      watch: 'Company follow-up details, sector peers, analyst estimate revisions', generated_at_ms: NOW,
      cached: false, version: 'v2' })
  }
  // Send to Notebook: any Notebook write (the capture door's current note or its inbox),
  // recorded in page memory -- never the network.
  if (method === 'POST' && path.startsWith('/api/j2/')) {
    NOTEBOOK.push(JSON.parse((init && init.body) || '{}'))
    return json({ id: `inbox${NOTEBOOK.length}` })
  }
  if (method !== 'GET') { BLOCKED.push(`${method} ${path}`); return json({}) }
  if (path.startsWith('/api/auth/me')) {
    return json({ user: { id: 'harness', email: 'harness@local', role: ROLE, display_name: 'Harness' },
      plan: 'pro', subscription: null, trial: null })
  }
  if (path.startsWith('/api/auth/preferences')) {
    return json({ theme: THEME, ...(themeTrackerPref ? { theme_tracker_settings: themeTrackerPref } : {}) })
  }
  if (path.startsWith('/api/trade-exchange-news/recent')) {
    const limit = Number(new URL(path, location.origin).searchParams.get('limit')) || 200
    return json({ epoch: 'harness0harness0', first_seq: 1, last_seq: NEWS.length, items: NEWS.slice(-limit),
      coverage: { complete: true, gaps: [] }, tickers_provisional: true })
  }
  if (path.startsWith('/api/watchlists/prebuilt')) return json([{ id: 'pre1', name: 'Harness Index', item_count: 4, is_prebuilt: true }])
  if (path.startsWith('/api/watchlists/flagged')) return json({ symbols: [] })
  if (/^\/api\/watchlists\/wl1/.test(path)) {
    return json({ id: 'wl1', name: 'Harness List', user_id: 'harness', is_prebuilt: false,
      items: SYMS.map((s, i) => ({ id: `i${i}`, sym: s, notes: '' })) })
  }
  if (path.startsWith('/api/watchlists')) {
    return json([{ id: 'wl1', name: 'Harness List', user_id: 'harness', is_prebuilt: false, item_count: SYMS.length,
      items: SYMS.map((s, i) => ({ id: `i${i}`, sym: s, notes: '' })) }])
  }
  if (path.startsWith('/api/live-prices')) {
    const prices = {}
    SYMS.forEach((s, i) => { prices[s] = { price: 20 + i * 3.1, change_pct: rnd(i, 1) * 6, change: rnd(i, 2) } })
    if (WIRE_MODE) {
      for (const [sym, [price, pct]] of Object.entries(WIRE_QUOTES)) {
        prices[sym] = { price, change_pct: pct, change: price * pct / 100, prev_close: price / (1 + pct / 100), updated_at: Date.now() / 1000 }
      }
    }
    return json({ prices, ...prices })
  }
  if (path.startsWith('/api/theme-performance')) {
    const themes = ['Alpha Theme', 'Bravo Theme', 'Charlie Theme', 'Delta Theme', 'Echo Theme', 'Foxtrot Theme'].map((name, t) => ({
      name, ticker: `TH${t}`, etf_name: `${name} (synthetic)`,
      holdings: SYMS.slice(t % 3, t % 3 + 4).map((s, i) => ({ sym: s, name: s, weight_pct: 0, source: 'owner',
        returns: Object.fromEntries(['1d', '1w', '1m', '3m', '1y', 'ytd'].map((p, k) => [p, rnd(t * 7 + i, k) * 0.2])) })),
      group_return: Object.fromEntries(['1d', '1w', '1m', '3m', '1y', 'ytd'].map((p, k) => [p, rnd(t, k) * 0.15])),
    }))
    return json({ themes, status: 'ok', generated_at: new Date(NOW).toISOString() })
  }
  return json({})
}

// The news stream: a scripted EventSource (hello, then one live headline after 1.5 s).
class HarnessES {
  constructor(url) {
    this.url = url
    this.readyState = 1
    this.l = {}
    setTimeout(() => this.emit('hello', { epoch: 'harness0harness0', reset: false, coverage: { complete: true, gaps: [] } }), 50)
    setTimeout(() => {
      const ev = { ...NEWS[0], seq: NEWS.length + 1, id: 'HARNESSLIVE0000000000000000'.slice(0, 26),
        content: 'SYNTHETIC: live headline arriving to show the new-row highlight', tickers: [],
        ...(WIRE_MODE === 'new' ? { category: 'News', source: 'TX-News' } : {}), received_at_ms: Date.now(), via: 'push', delayed: false }
      if (!LIVE_ADDED.size) { LIVE_ADDED.add(ev.seq); NEWS.push(ev) }     // the archive has it too, as the server would
      this.emit('headline', ev)
    }, 1500)
  }
  addEventListener(n, fn) { (this.l[n] ||= []).push(fn) }
  emit(n, d) { if (this.readyState !== 2) for (const fn of this.l[n] || []) fn({ data: JSON.stringify(d) }) }
  close() { this.readyState = 2 }
}
// Every other stream gets an inert, already-closed stand-in: the harness opens no
// real transport at all (TERM-024's rail counts constructions).
class ClosedES { constructor() { this.readyState = 2 } addEventListener() {} close() {} }
if (!LIVE) {
  window.EventSource = function (url) {
    return String(url).includes('/api/trade-exchange-news/stream') ? new HarnessES(url) : new ClosedES()
  }
}

function themed(type, opts) {
  return appliedTheme ? patchWidgetOptsWithTheme(type, opts, themeWithAppSurface(appliedTheme)) : opts
}

function Pane({ label, type, Component, initial, index = 0 }) {
  const [opts, setOpts] = useState(() => themed(type, initial))
  return (
    <div className="pane" data-pane={index ? `${type}-${index}` : type}>
      <div className="paneLabel">{label}</div>
      {/* WidgetHost provides the placed theme in the real workspace; so does this. */}
      <PlacedThemeContext.Provider value={THEME}>
        <div className={wsStyles.widgetBody} style={{ height: 560, width: WIDTH, display: 'flex', flexDirection: 'column' }}>
          <Component color="A" opts={opts} onOptsChange={setOpts} />
        </div>
      </PlacedThemeContext.Provider>
    </div>
  )
}

// ?ask=1 (|seed|error): an INVENTED stand-in for UCT Agent's `useAgentAsk` / `openAgent`, so the
// Ask thread can be looked at before the Agent exports land. No model, no network: answers
// are canned SYNTHETIC text after a short delay. `seed` opens with a 4-turn thread; `error`
// fails every question with the Agent's budget sentence.
const ASK = params.get('ask')
// Threads live OUTSIDE React (as the Agent's own store would): render only reads them.
const ASK_THREADS = new Map()
const askThread = (newsId) => {
  if (!ASK_THREADS.has(newsId)) ASK_THREADS.set(newsId, freshThread())
  return ASK_THREADS.get(newsId)
}
const patchThread = (newsId, fn) => ASK_THREADS.set(newsId, fn(askThread(newsId)))
function harnessAnswer(newsId, text, bump) {
  patchThread(newsId, (t) => (ASK === 'error'
    ? { ...t, busy: false, error: { text: 'UCT Agent has used today’s budget. It resets at midnight ET.', retry: true } }
    : { ...t, busy: false, conversationId: 'ac_harness',
      turns: [...t.turns, { id: `a${t.turns.length}`, role: 'agent', text: `SYNTHETIC answer to “${text}”.` }] }))
  bump((n) => n + 1)
}
function freshThread() {
  return {
    turns: ASK === 'seed' ? [
      { id: 's0', role: 'member', text: 'What does this mean for the stock?' },
      { id: 's1', role: 'agent', text: 'SYNTHETIC: The company says profit beat its own outlook. That is the company’s claim; I don’t have a live quote here, so I can’t say how the stock is reacting.' },
      { id: 's2', role: 'member', text: 'What should I look for next?' },
      { id: 's3', role: 'agent', text: 'SYNTHETIC: Guidance details and any analyst revisions; the headline gives neither yet.' },
    ] : [], busy: false, error: null, conversationId: ASK === 'seed' ? 'ac_harness' : null }
}
function useHarnessAsk({ newsId }) {
  const [, bump] = useState(0)
  return { ...askThread(newsId), ask: (text) => {
    patchThread(newsId, (t) => ({ ...t, busy: true, error: null,
      turns: [...t.turns, { id: `m${t.turns.length}`, role: 'member', text }] }))
    bump((n) => n + 1)
    setTimeout(() => harnessAnswer(newsId, text, bump), 600)
  } }
}
// ?ask=real: UCT Agent's OWN useAgentAsk / openAgent, on the invented /api/agent above.
const HARNESS_AGENT = ASK === 'real' ? { useAsk: useAgentAsk, openAgent }
  : ASK ? { useAsk: useHarnessAsk, openAgent: (x) => { window.__openAgent = x } } : null

function Harness() {
  const [groupSyms, setGroupSyms] = useState({ A: 'DLTX' })
  const ws = useMemo(() => ({
    ...WORKSPACE_FALLBACK,
    groupSyms,
    setGroupSym: (c, s) => setGroupSyms((g) => ({ ...g, [c]: s })),
  }), [groupSyms])
  const newsOpts = { ...OPTS_PARAM, ...(DENSITY ? { settings: { ...(OPTS_PARAM.settings || {}), density: DENSITY } } : {}) }
  return (
    <MemoryRouter>
      <AuthProvider>
        <WorkspaceContext.Provider value={ws}>
          <NewsAgentContext.Provider value={HARNESS_AGENT}>
          <div className="row">
            {!ONLY_NEWS && <Pane label="Watchlist" type="watchlist" Component={WatchlistWidget} initial={{ watchKey: 'user:wl1', watchName: 'Harness List' }} />}
            {!ONLY_NEWS && <Pane label="Theme Tracker" type="themes" Component={ThemesWidget} initial={{}} />}
            {LIBRARY && <Pane label="UCT News · Saved" type="tradeExchangeNews" index={9}
              Component={TradeExchangeNewsWidget} initial={{ ...newsOpts, view: 'saved' }} />}
            {Array.from({ length: ONLY_NEWS ? COUNT : 1 }, (_, i) => (
              <Pane key={i} index={i} label={`News (Trade Exchange)${i ? ` #${i + 1}` : ''}`} type="tradeExchangeNews"
                Component={TradeExchangeNewsWidget} initial={newsOpts} />
            ))}
          </div>
          </NewsAgentContext.Provider>
        </WorkspaceContext.Provider>
      </AuthProvider>
    </MemoryRouter>
  )
}

createRoot(document.getElementById('root')).render(<Harness />)

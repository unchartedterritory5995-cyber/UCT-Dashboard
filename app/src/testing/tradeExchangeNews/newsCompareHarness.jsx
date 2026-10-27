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
import { CHART_THEME_BY_ID, patchWidgetOptsWithTheme, mapThemeToWidgetSettings, themeWithAppSurface } from '../../components/chart/chartThemes'
import wsStyles from '../../pages/charts/ChartsWorkspace.module.css'

const params = new URLSearchParams(location.search)
const THEME = params.get('theme') === 'light' ? 'light' : 'dark'
const APPLY = params.get('apply') || ''
const DENSITY = params.get('density') || ''
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
const NEWS = HEADLINES.map(([content, tickers], i) => ({
  type: 'headline', epoch: 'harness0harness0', seq: i + 1, id: `HARNESS${String(i).padStart(18, '0')}`,
  source: 'TXNews1', content, tickers, received_at_ms: NOW - (HEADLINES.length - i) * 97_000,
  repeat_count: i === 4 ? 1 : 0, via: i === 2 ? 'reconcile' : 'push', delayed: i === 2,
}))

const BLOCKED = []
window.__newsHarnessBlocked = BLOCKED
const realFetch = window.fetch.bind(window)
window.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : (input && input.url) || ''
  const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase()
  if (!url.startsWith('/') && !url.startsWith(location.origin)) return realFetch(input, init)
  const path = url.replace(location.origin, '')
  if (method !== 'GET') { BLOCKED.push(`${method} ${path}`); return json({}) }
  if (path.startsWith('/api/auth/me')) {
    return json({ user: { id: 'harness', email: 'harness@local', role: 'admin', display_name: 'Harness' },
      plan: 'pro', subscription: null, trial: null })
  }
  if (path.startsWith('/api/auth/preferences')) {
    return json({ theme: THEME, ...(themeTrackerPref ? { theme_tracker_settings: themeTrackerPref } : {}) })
  }
  if (path.startsWith('/api/trade-exchange-news/recent')) {
    return json({ epoch: 'harness0harness0', first_seq: 1, last_seq: NEWS.length, items: NEWS,
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
    setTimeout(() => this.emit('headline', { ...NEWS[0], seq: NEWS.length + 1, id: 'HARNESSLIVE0000000000000000'.slice(0, 26),
      content: 'SYNTHETIC: live headline arriving to show the new-row highlight', tickers: [], received_at_ms: Date.now(), via: 'push', delayed: false }), 1500)
  }
  addEventListener(n, fn) { (this.l[n] ||= []).push(fn) }
  emit(n, d) { if (this.readyState !== 2) for (const fn of this.l[n] || []) fn({ data: JSON.stringify(d) }) }
  close() { this.readyState = 2 }
}
// Every other stream gets an inert, already-closed stand-in: the harness opens no
// real transport at all (TERM-024's rail counts constructions).
class ClosedES { constructor() { this.readyState = 2 } addEventListener() {} close() {} }
window.EventSource = function (url) {
  return String(url).includes('/api/trade-exchange-news/stream') ? new HarnessES(url) : new ClosedES()
}

function themed(type, opts) {
  return appliedTheme ? patchWidgetOptsWithTheme(type, opts, themeWithAppSurface(appliedTheme)) : opts
}

function Pane({ label, type, Component, initial }) {
  const [opts, setOpts] = useState(() => themed(type, initial))
  return (
    <div className="pane" data-pane={type}>
      <div className="paneLabel">{label}</div>
      {/* WidgetHost provides the placed theme in the real workspace; so does this. */}
      <PlacedThemeContext.Provider value={THEME}>
        <div className={wsStyles.widgetBody} style={{ height: 560, width: 320, display: 'flex', flexDirection: 'column' }}>
          <Component color="A" opts={opts} onOptsChange={setOpts} />
        </div>
      </PlacedThemeContext.Provider>
    </div>
  )
}

function Harness() {
  const [groupSyms, setGroupSyms] = useState({ A: 'DLTX' })
  const ws = useMemo(() => ({
    ...WORKSPACE_FALLBACK,
    groupSyms,
    setGroupSym: (c, s) => setGroupSyms((g) => ({ ...g, [c]: s })),
  }), [groupSyms])
  const newsOpts = DENSITY ? { settings: { density: DENSITY } } : {}
  return (
    <MemoryRouter>
      <AuthProvider>
        <WorkspaceContext.Provider value={ws}>
          <div className="row">
            <Pane label="Watchlist" type="watchlist" Component={WatchlistWidget} initial={{ watchKey: 'user:wl1', watchName: 'Harness List' }} />
            <Pane label="Theme Tracker" type="themes" Component={ThemesWidget} initial={{}} />
            <Pane label="News (Trade Exchange)" type="tradeExchangeNews" Component={TradeExchangeNewsWidget} initial={newsOpts} />
          </div>
        </WorkspaceContext.Provider>
      </AuthProvider>
    </MemoryRouter>
  )
}

createRoot(document.getElementById('root')).render(<Harness />)

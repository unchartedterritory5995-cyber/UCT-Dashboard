// ── UCT AGENT LIVE HARNESS (see agent-harness.html) ─────────────────────────
//
// The REAL ChartsWorkspace + REAL UCT Agent from a FIXTURE board.
// ⛔ Three locks, because this runs on the machine holding Main Trading:
//   1. The board, groups and settings come from the FIXTURE below (GETs are
//      answered here and never reach a server).
//   2. Every non-GET to preferences / layouts / workspace doc is REFUSED and
//      logged (with its body) in window.__agentHarness.refused.
//   3. /api/auth/me is a stub ADMIN with a paid plan — no session cookie, no
//      account, no network.
// /api/agent/* is answered locally: turn by the scripted double, record and
// conversations by an in-page store. The mic's /api/voice/transcribe answers
// with ?say= (default "hide volume") so the REAL VoiceInputButton runs.

import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import '../../index.css'
import { AuthProvider } from '../../context/AuthContext'
import { APP_THEME_BY_ID, applyAppTheme } from '../../styles/appThemes'
import { setAgentFlag } from '../../agent/agentFlag'
import ChartsWorkspace from '../../pages/charts/ChartsWorkspace'
import { scriptedTurn } from './scriptedAgent'

const params = new URLSearchParams(location.search)
const NCHARTS = Number(params.get('charts') || 2)
const THEME = params.get('theme') || 'dark'
const SAY = params.get('say') || 'hide volume'

// ── theme, applied exactly as Layout.jsx does ──
const root = document.documentElement
if (THEME.startsWith('uct:') && APP_THEME_BY_ID[THEME.slice(4)]) applyAppTheme(root, APP_THEME_BY_ID[THEME.slice(4)])
else root.dataset.theme = THEME === 'light' ? 'light' : THEME === 'oled' ? 'oled' : 'dark'

// ── fixture board ──
const BOARD = params.get('board') || ''
const widgets = BOARD === 'rail'
  // a Watchlist rail on the right; the product places up to four charts left of it
  ? [{ id: 'w-watch', type: 'watchlist', color: 'A', x: 18, y: 0, w: 6, h: 20, opts: {} }]
  : BOARD === 'wl'
  // a chart + a Watchlist widget showing the fixture list "Momentum" (user:m1)
  ? [
      { id: 'w-chart-a', type: 'chart', color: 'A', x: 0, y: 0, w: 18, h: 20, opts: { tf: 'D' } },
      { id: 'w-watch', type: 'watchlist', color: 'A', x: 18, y: 0, w: 6, h: 20, opts: { watchKey: 'user:m1', watchName: 'Momentum' } },
    ]
  : BOARD === 'gap'
  // half the board empty, so widget.add has somewhere to land without resizing anything
  ? [{ id: 'w-chart-a', type: 'chart', color: 'A', x: 0, y: 0, w: 12, h: 20, opts: { tf: 'D' } }]
  : NCHARTS === 1
  ? [
      { id: 'w-chart-a', type: 'chart', color: 'A', x: 0, y: 0, w: 18, h: 20, opts: { tf: 'D' } },
      { id: 'w-watch', type: 'watchlist', color: 'A', x: 18, y: 0, w: 6, h: 20, opts: {} },
    ]
  : [
      { id: 'w-chart-a', type: 'chart', color: 'A', x: 0, y: 0, w: 9, h: 20, opts: { tf: 'D' } },
      { id: 'w-chart-b', type: 'chart', color: 'B', x: 9, y: 0, w: 9, h: 20, opts: { tf: 'D' } },
      { id: 'w-watch', type: 'watchlist', color: 'A', x: 18, y: 0, w: 6, h: 10, opts: {} },
      { id: 'w-themes', type: 'themes', color: 'A', x: 18, y: 10, w: 6, h: 10, opts: {} },
    ]
// ?layouts=1 — a FIXTURE layout library (in-page only): two of "your" layouts with
// different boards, similar names, a prebuilt, and a fixture named "Main Trading"
// (a stand-in: the real one is never read or written by this page).
const LAYOUTS = params.get('layouts') === '1'
const lw = (id, type, color, x, y, w, h, opts = {}) => ({ id, type, color, x, y, w, h, opts })
const LIB = LAYOUTS ? {
  global: [{ id: 5, scope: 'global', name: '1-Chart', layout: { version: 1, cols: 24, widgets: [lw('g-one', 'chart', 'A', 0, 0, 24, 20, { tf: 'D' })] } }],
  mine: [
    { id: 11, scope: 'user', name: 'Agent Test', layout: { version: 1, cols: 24, widgets: widgets } },
    { id: 12, scope: 'user', name: 'Intraday Scan', layout: { version: 1, cols: 24, widgets: [lw('i-one', 'chart', 'C', 0, 0, 12, 20, { tf: '5' }), lw('i-two', 'chart', 'D', 12, 0, 12, 20, { tf: '5' })] } },
    { id: 13, scope: 'user', name: 'Momentum', layout: { version: 1, cols: 24, widgets: [lw('m-one', 'chart', 'A', 0, 0, 24, 20)] } },
    { id: 14, scope: 'user', name: 'Momentum 2', layout: { version: 1, cols: 24, widgets: [lw('m2-one', 'chart', 'A', 0, 0, 24, 20)] } },
    { id: 15, scope: 'user', name: 'Momentum Swing', layout: { version: 1, cols: 24, widgets: [lw('ms-one', 'chart', 'A', 0, 0, 24, 20)] } },
    { id: 16, scope: 'user', name: 'Main Trading', layout: { version: 1, cols: 24, widgets: [lw('mt-one', 'chart', 'A', 0, 0, 18, 20), lw('mt-watch', 'watchlist', 'A', 18, 0, 6, 20)] } },
  ],
} : { global: [], mine: [] }
let layoutSeq = 100
// ?watchlists=1 — FIXTURE saved watchlists (in-page only), answering the same routes
// with the same semantics as api/routers/watchlists.py + watchlist_service.py.
const WATCHLISTS = params.get('watchlists') === '1'
let wlSeq = 0
const wlRow = (id, name, syms, notes = {}) => ({ id, user_id: 1, name, description: '', is_public: 0, items: syms.map(sym => ({ id: `${id}-i${++wlSeq}`, watchlist_id: id, sym, notes: notes[sym] || '', sort_order: wlSeq })) })
const WL = WATCHLISTS ? [
  wlRow('m1', 'Momentum', ['NVDA', 'TSLA', 'META', 'AAPL'], { TSLA: 'earnings 10/22' }),
  wlRow('s1', 'Swing', ['MSFT']),
  wlRow('l1', 'Long Term', []),
] : []
const PREFS = {
  charts_workspace_layout: JSON.stringify({ version: 1, cols: 24, widgets }),
  charts_workspace_groups: JSON.stringify({ A: 'SPY', B: 'NVDA', C: 'AAPL', D: 'MSFT' }),
  theme: THEME,
  ...(LAYOUTS ? { charts_active_template: JSON.stringify({ id: 11, name: 'Agent Test', scope: 'user' }) } : {}),
}

const H = (window.__agentHarness = { refused: [], turns: [], records: [], conversations: new Map(), lib: LIB, layoutWrites: [], wl: WL, wlWrites: [] })
setAgentFlag(true)
// Only an explicit ?open= seeds the remembered state; otherwise the Agent's own
// persistence decides (so the harness can prove it survives a reload).
if (params.has('open')) { try { localStorage.setItem('uct.agent.open', params.get('open') === '0' ? '0' : '1') } catch { /* */ } }

const json = (o, status = 200) => Promise.resolve(new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } }))
const realFetch = window.fetch.bind(window)
let convSeq = 0
window.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : (input && input.url) || ''
  const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase()
  let path = url.replace(/^https?:\/\/[^/]+/, '')
  if (path.startsWith('/api/auth/me')) {
    return json({ user: { id: 1, email: 'harness@local', role: 'admin', display_name: 'Harness' }, plan: 'pro', subscription: null, trial: null })
  }
  // The fixture layout library answers in-page (nothing reaches a server): POST with
  // create_only refuses an existing name (409), as the real route does; PATCH renames
  // by id and refuses a duplicate (409).
  if (LAYOUTS && path.startsWith('/api/charts/layouts')) {
    let body = null
    try { body = init && init.body ? JSON.parse(init.body) : null } catch { /* */ }
    if (method !== 'GET') H.layoutWrites.push({ method, path, body, at: Date.now() })
    if (method === 'GET') return json(LIB)
    if (method === 'POST' && path === '/api/charts/layouts') {
      const list = body.scope === 'global' ? LIB.global : LIB.mine
      const hit = list.find(r => r.name === body.name)
      if (hit && body.create_only) return json({ detail: 'You already have a layout with that name' }, 409)
      if (hit) { hit.layout = body.layout; return json(hit) }
      const row = { id: ++layoutSeq, scope: body.scope || 'user', name: body.name, layout: body.layout }
      list.push(row)
      return json(row)
    }
    const m = /^\/api\/charts\/layouts\/(\d+)$/.exec(path)
    if (method === 'PATCH' && m) {
      const row = [...LIB.global, ...LIB.mine].find(r => r.id === Number(m[1]))
      if (!row) return json({ detail: 'Not found' }, 404)
      if (LIB.mine.some(r => r.id !== row.id && r.name === body.name)) return json({ detail: 'You already have a layout with that name' }, 409)
      row.name = body.name
      return json(row)
    }
    return json({ detail: 'refused by harness' }, 403)
  }
  // FIXTURE Screener engine (in-page): the same routes and shapes as api/routers/screener.py.
  // /scan filters a fixed 6-row universe by the posted spec, so counts are REAL for it.
  if (path.startsWith('/api/screener/')) {
    const p0 = path.split('?')[0]
    let body = null
    try { body = init && init.body ? JSON.parse(init.body) : null } catch { /* */ }
    H.screener = H.screener || []
    H.screener.push({ method, path: p0, body })
    if (p0 === '/api/screener/fields') return json({ fields: [
      { key: 'adr_pct', label: 'ADR %', type: 'range', unit: '%' }, { key: 'price', label: 'Price', type: 'range', unit: '$' },
      { key: 'chg_pct_1m', label: 'Change 1M', type: 'range', unit: '%' }, { key: 'above_50sma', label: 'Above 50 SMA', type: 'bool', unit: null },
      { key: 'sector', label: 'Sector', type: 'enum', unit: null },
    ] })
    if (p0 === '/api/screener/saved-screens') return json({ saved: [{ id: 7, name: 'Agent Test Screen', spec: { filters: [{ key: 'chg_pct_1m', op: 'gte', min: 20 }], sort: { key: 'chg_pct_1m', dir: 'desc' } } }], starters: [] })
    if (p0 === '/api/screener/scan' && method === 'POST') {
      const U = [
        { ticker: 'RKLB', company: 'Rocket Lab', price: 52.1, adr_pct: 7.2, chg_pct_1m: 31, chg_pct_1d: 2.1, above_50sma: 1 },
        { ticker: 'ASTS', company: 'AST SpaceMobile', price: 61.4, adr_pct: 8.9, chg_pct_1m: 24, chg_pct_1d: -1.2, above_50sma: 1 },
        { ticker: 'SOUN', company: 'SoundHound', price: 9.4, adr_pct: 9.5, chg_pct_1m: 12, chg_pct_1d: 3.3, above_50sma: 0 },
        { ticker: 'PLTR', company: 'Palantir', price: 180.2, adr_pct: 4.1, chg_pct_1m: 9, chg_pct_1d: 0.4, above_50sma: 1 },
        { ticker: 'NVDA', company: 'NVIDIA', price: 190.3, adr_pct: 3.1, chg_pct_1m: 6, chg_pct_1d: 0.2, above_50sma: 1 },
        { ticker: 'KO', company: 'Coca-Cola', price: 70.1, adr_pct: 1.1, chg_pct_1m: -2, chg_pct_1d: -0.1, above_50sma: 0 },
      ]
      const ok = (r, f) => {
        const v = r[f.key]
        if (v == null) return false
        if (f.op === 'gt') return v > f.min
        if (f.op === 'gte') return v >= f.min
        if (f.op === 'lt') return v < f.max
        if (f.op === 'lte') return v <= f.max
        if (f.op === 'between') return v >= f.min && v <= f.max
        if (f.op === 'eq') return v === f.value
        return false
      }
      const unknown = (body.filters || []).find(f => !['adr_pct', 'price', 'chg_pct_1m', 'above_50sma'].includes(f.key))
      if (unknown) return json({ detail: `Unknown filter "${unknown.key}"` }, 400)
      let rows = U.filter(r => (body.filters || []).every(f => ok(r, f)))
      const s = body.sort || { key: 'uct_composite', dir: 'desc' }
      if (s.key in U[0]) rows = [...rows].sort((a, b) => (s.dir === 'asc' ? 1 : -1) * (a[s.key] - b[s.key]))
      return json({ total: rows.length, rows: rows.slice(0, body.page_size || 50), snapshot_date: '2026-10-07', snapshot: { live: { state: 'live' } } })
    }
    return json({ detail: 'refused by harness' }, 403)
  }
  if (WATCHLISTS && path.startsWith('/api/watchlists') && !/^\/api\/watchlists\/(flagged|themes-batch|bulk-meta|intelligence|digest-settings|public|prebuilt)/.test(path)) {
    let body = null
    try { body = init && init.body ? JSON.parse(init.body) : null } catch { /* */ }
    const path0 = path
    path = path.split('?')[0]                // the routes ignore ?include_prebuilt / ?slim here
    if (method !== 'GET') H.wlWrites.push({ method, path: path0, body, at: Date.now() })
    const view = (w) => ({ ...w, item_count: w.items.length, items: w.items.map(i => ({ ...i })) })
    if (method === 'GET' && path === '/api/watchlists') return json(WL.map(view))
    if (method === 'POST' && path === '/api/watchlists') { const row = wlRow(`n${++wlSeq}`, body.name, []); WL.push(row); return json(view(row)) }
    const m = /^\/api\/watchlists\/([^/]+)(\/.*)?$/.exec(path)
    const wl = m && WL.find(w => w.id === decodeURIComponent(m[1]))
    if (!wl) return json({ detail: 'Watchlist not found' }, 404)
    const sub = m[2] || ''
    if (method === 'GET' && !sub) return json(view(wl))
    if (method === 'POST' && sub === '/items/bulk') {
      let added = 0
      for (const raw of body.symbols) { const sym = raw.trim().toUpperCase(); if (!sym || wl.items.some(i => i.sym === sym)) continue; wl.items.push({ id: `${wl.id}-i${++wlSeq}`, watchlist_id: wl.id, sym, notes: '', sort_order: wlSeq }); added++ }
      return json({ added, watchlist: view(wl) })
    }
    if (method === 'POST' && sub === '/items') {
      const sym = body.sym.trim().toUpperCase(); const hit = wl.items.find(i => i.sym === sym)
      if (hit) return json({ ...hit, duplicate: true })
      const row = { id: `${wl.id}-i${++wlSeq}`, watchlist_id: wl.id, sym, notes: body.notes || '', sort_order: wlSeq }; wl.items.push(row); return json({ ...row, duplicate: false })
    }
    const di = /^\/items\/([^/]+)$/.exec(sub)
    if (method === 'DELETE' && di) { const n = wl.items.length; wl.items = wl.items.filter(i => i.id !== decodeURIComponent(di[1])); return n === wl.items.length ? json({ detail: 'Item not found' }, 404) : json({ ok: true }) }
    if (method === 'PUT' && sub === '/reorder') { const pos = new Map(body.item_ids.map((id, k) => [id, k])); wl.items.sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9)); return json({ ok: true }) }
    if (method === 'PUT' && !sub) { if (body.name) wl.name = body.name; return json(view(wl)) }
    if (method === 'DELETE' && !sub) { WL.splice(WL.indexOf(wl), 1); return json({ ok: true }) }
    return json({ detail: 'refused by harness' }, 403)
  }
  if (path.startsWith('/api/auth/preferences') || path.startsWith('/api/charts/layouts') || path.startsWith('/api/workspace')) {
    if (method !== 'GET') {
      // Refused — but the BODY is kept, so the harness can see exactly what the
      // workspace's own auto-save would have persisted after an Agent change.
      let body = null
      try { body = init && init.body ? JSON.parse(init.body) : null } catch { /* */ }
      H.refused.push({ method, path, body, at: Date.now() })
      // Keep the page's OWN view consistent (a refetch must not undo a switch); the
      // write still never leaves this page.
      if (path.startsWith('/api/auth/preferences') && body && typeof body.key === 'string') PREFS[body.key] = body.value
      return json({ ok: true })
    }
    if (path.startsWith('/api/auth/preferences')) return json(PREFS)
    if (path.startsWith('/api/charts/layouts')) return json({ global: [], mine: [] })
    return json({}, 404)
  }
  if (path === '/api/agent/turn') {
    const body = JSON.parse(init.body)
    H.turns.push(body)
    const cid = body.conversationId || `ac_h${++convSeq}`
    await new Promise(r => setTimeout(r, 350))            // a model takes a moment
    return json({ conversationId: cid, turnId: H.turns.length, envelope: scriptedTurn(body), usage: { citations: [] } })
  }
  if (path === '/api/agent/record') {
    const body = JSON.parse(init.body)
    H.records.push(body)
    return json({ conversationId: body.conversationId || `ac_h${++convSeq}` })
  }
  if (path.startsWith('/api/agent/conversations')) return json(path === '/api/agent/conversations' ? { conversations: [] } : {}, path === '/api/agent/conversations' ? 200 : 404)
  if (path.startsWith('/api/ticker-search')) {
    const q = new URL(url, location.origin).searchParams.get('q') || ''
    return json({ results: /^(SPY|QQQ|IBM|DIA|NVDA|AAPL|MSFT|AMD|TSLA|RKLB|PLTR|ASTS|AVGO|TSM|META)$/i.test(q) ? [{ ticker: q.toUpperCase() }] : [] })
  }
  if (path.startsWith('/api/voice/transcribe')) return json({ text: SAY, seconds_billed: 1 })
  if (path.startsWith('/api/')) {
    // Everything else (bars, quotes, widgets' data): try the local backend if one
    // is running; an error just leaves that widget empty. Never a write.
    if (method !== 'GET') { H.refused.push({ method, path, body: null, at: Date.now() }); return json({ ok: false }, 403) }
    try { return await realFetch(input, init) } catch { return json({}, 503) }
  }
  return realFetch(input, init)
}

// A fake microphone so the REAL VoiceInputButton (MediaRecorder → /transcribe) runs headless.
if (navigator.mediaDevices) {
  navigator.mediaDevices.getUserMedia = async () => {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const dest = ctx.createMediaStreamDestination()
    osc.connect(dest); osc.start()
    return dest.stream
  }
}

createRoot(document.getElementById('root')).render(
  <SWRConfig value={{ revalidateOnFocus: false, dedupingInterval: 8000 }}>
    <AuthProvider>
      <MemoryRouter initialEntries={['/charts']}>
        <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
          <ChartsWorkspace />
        </div>
      </MemoryRouter>
    </AuthProvider>
  </SWRConfig>,
)

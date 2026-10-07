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
const PREFS = {
  charts_workspace_layout: JSON.stringify({ version: 1, cols: 24, widgets }),
  charts_workspace_groups: JSON.stringify({ A: 'SPY', B: 'NVDA', C: 'AAPL', D: 'MSFT' }),
  theme: THEME,
  ...(LAYOUTS ? { charts_active_template: JSON.stringify({ id: 11, name: 'Agent Test', scope: 'user' }) } : {}),
}

const H = (window.__agentHarness = { refused: [], turns: [], records: [], conversations: new Map(), lib: LIB, layoutWrites: [] })
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
  const path = url.replace(/^https?:\/\/[^/]+/, '')
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
    return json({ results: /^(SPY|QQQ|IBM|DIA|NVDA|AAPL|MSFT|AMD|TSLA)$/i.test(q) ? [{ ticker: q.toUpperCase() }] : [] })
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

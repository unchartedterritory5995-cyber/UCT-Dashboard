/**
 * SCAN DECK — SYNTHETIC HARNESS (dev-server only; see scan-deck-harness.html).
 *
 * Mounts the REAL BreadthDrillModal with a page-local fetch shim that answers
 * every /api request from a seeded generator: REAL tickers, names, sectors and
 * logos (realUniverse.js) with GENERATED prices, moves, volume and bars.
 *
 * window.__sdh = { blocked(), requests(), reopen() }
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../../index.css'
import { MemoryRouter } from 'react-router-dom'
import { AuthProvider } from '../../context/AuthContext'
import BreadthDrillModal from '../../pages/breadth/drill/BreadthDrillModal'
import { REAL_UNIVERSE } from './realUniverse'

// Real company logos: the app asks its own backend (/api/ticker-logo/SYM), which
// this page does not run, so logo images are pointed at the public UCT logo
// endpoint instead. Read-only image GETs; nothing else leaves the page.
const LOGO_HOST = 'https://uctintelligence.com'
const rwLogo = (v) => (typeof v === 'string' && v.startsWith('/api/ticker-logo/') ? LOGO_HOST + v : v)
{
  const d = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')
  Object.defineProperty(HTMLImageElement.prototype, 'src', { configurable: true, get() { return d.get.call(this) }, set(v) { d.set.call(this, rwLogo(v)) } })
  const sa = Element.prototype.setAttribute
  Element.prototype.setAttribute = function setAttribute(name, value) {
    return sa.call(this, name, name === 'src' && this instanceof HTMLImageElement ? rwLogo(value) : value)
  }
}

// ── seeded RNG ──────────────────────────────────────────────────────────────
const mul = (a) => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 }
const hash = (s) => [...String(s)].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7)

// ── universe: REAL names + logos, GENERATED numbers ──────────────────────────
const UNIVERSE = REAL_UNIVERSE.map(([t, n, sector, industry, theme]) => ({ t, n, sector, industry, theme }))
// ?big=1 — a universe-sized list (~970 names: the real ones plus generated tickers)
// for scroll/perf checks. ?lat=MS delays every bars answer, like a real network.
const QS = new URLSearchParams(window.location.search)
const BIG = QS.get('big') === '1'
const BARS_LATENCY_MS = Math.max(0, Number(QS.get('lat')) || 0)
if (BIG) {
  const real = UNIVERSE.slice()
  for (let i = 0; UNIVERSE.length < 970; i++) {
    const src = real[i % real.length]
    UNIVERSE.push({ t: `Z${String(i).padStart(3, '0')}`, n: `Synthetic ${i}`, sector: src.sector, industry: src.industry, theme: src.theme })
  }
}
const BY_T = Object.fromEntries(UNIVERSE.map(u => [u.t, u]))

// ── sessions ────────────────────────────────────────────────────────────────
const SESSIONS = []
{
  const d = new Date(Date.UTC(2026, 10, 6))
  while (SESSIONS.length < 300) {
    const wd = d.getUTCDay()
    if (wd !== 0 && wd !== 6) SESSIONS.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() - 1)
  }
}
const COLS = [
  { key: 'up_4pct_today', label: 'Up 4%+', drillKey: 'up_4pct_today_list', dir: 1 },
  { key: 'down_4pct_today', label: 'Dn 4%+', drillKey: 'down_4pct_today_list', dir: -1 },
  { key: 'new_52w_highs', label: 'New 52W Highs', drillKey: 'new_52w_highs_list', dir: 1, n: [6, 22] },
  { key: 'new_52w_lows', label: 'New 52W Lows', drillKey: 'new_52w_lows_list', dir: -1, n: [2, 10] },
  { key: 'new_ath', label: 'All-Time Highs', drillKey: 'new_ath_list', dir: 1, n: [3, 12] },
  { key: 'stage2', label: 'Stage 2', drillKey: 'stage2_list', dir: 1, n: [20, 45] },
  { key: 'hvc_52w', label: 'HVC 52W', drillKey: 'hvc_52w_list', dir: 1, n: [3, 10] },
  { key: 'up_20pct_5d', label: 'Up 20% 5D', drillKey: 'up_20pct_5d_list', dir: 1, n: [5, 16] },
]
function listFor(drillKey, date) {
  const col = COLS.find(c => c.drillKey === drillKey)
  const r = mul(hash(drillKey + date))
  const n = BIG && !col?.n ? UNIVERSE.length : col?.n ? col.n[0] + Math.floor(r() * (col.n[1] - col.n[0])) : 30 + Math.floor(r() * 40)
  const pool = [...UNIVERSE].sort(() => r() - 0.5).slice(0, n)
  return pool.map(u => {
    const mag = 4 + Math.pow(r(), 2.2) * 40
    return { t: u.t, n: u.n, pct: +((col?.dir ?? 1) * mag).toFixed(2), c: closeOn(u.t, date, +(3 + r() * 150).toFixed(2)),
      vr: +(0.6 + Math.pow(r(), 1.7) * 8).toFixed(1), v: Math.round(3e5 + Math.pow(r(), 2) * 6e7), atr: +(2 + r() * 7).toFixed(1), a50: +((r() - 0.3) * 6).toFixed(1) }
  }).sort((a, b) => (col?.dir ?? 1) * (b.pct - a.pct))
}
// The list price is the generated chart's close that day, so list and chart agree.
const BAR_CACHE = new Map()
function closeOn(sym, date, fallback) {
  if (!BAR_CACHE.has(sym)) BAR_CACHE.set(sym, barsFor(sym, 'D'))
  const b = BAR_CACHE.get(sym).find(x => x.t === date)
  return b ? b.c : fallback
}
const ROWS = SESSIONS.map(date => {
  const row = { date, breadth_score: 30 + (hash(date) & 63) }
  for (const c of COLS) row[c.key] = BIG && !c.n ? UNIVERSE.length : listFor(c.drillKey, date).length
  return row
})

function barsFor(sym, tf) {
  const r = mul(hash(sym + tf))
  const out = []
  let p = 10 + r() * 90
  const days = tf === 'W' ? 300 : 600
  const end = new Date(Date.UTC(2026, 10, 6))
  const d = new Date(end); d.setUTCDate(d.getUTCDate() - (tf === 'W' ? days * 7 : Math.round(days * 1.45)))
  while (d <= end) {
    const wd = d.getUTCDay()
    if (tf === 'W' ? wd === 1 : (wd !== 0 && wd !== 6)) {
      const vol = (tf === 'W' ? 0.05 : 0.025) * (0.5 + r())
      const o = p * (1 + (r() - 0.5) * vol * 0.5)
      const c = o * (1 + (r() - 0.48) * vol * 2)
      out.push({ t: d.toISOString().slice(0, 10), o: +o.toFixed(2), h: +(Math.max(o, c) * (1 + r() * vol * 0.6)).toFixed(2),
        l: +(Math.min(o, c) * (1 - r() * vol * 0.6)).toFixed(2), c: +c.toFixed(2), v: Math.round(2e5 + r() * 3e6) })
      p = c
    }
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

// ── fetch shim ──────────────────────────────────────────────────────────────
const BLOCKED = []
const REQUESTS = []
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } })
const bodyOf = (init) => { try { return JSON.parse((init && init.body) || '{}') } catch { return {} } }
window.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : (input && input.url) || ''
  const method = ((init && init.method) || 'GET').toUpperCase()
  REQUESTS.push(`${method} ${url}`)
  if (url.includes('/api/auth/me')) {
    return json({ user: { id: 'harness', email: 'harness@local', role: 'user', display_name: 'Harness' }, plan: 'pro', subscription: null, trial: null })
  }
  if (url.includes('/api/auth/preferences') || url.includes('/api/charts')) {
    if (method !== 'GET') BLOCKED.push(`${method} ${url}`)
    // ?theme=uct:slate stands in for the member's app theme.
    const appTheme = new URLSearchParams(window.location.search).get('theme')
    return json(appTheme && url.includes('/api/auth/preferences') ? { theme: appTheme } : {})
  }
  if (url.includes('/api/breadth/industries')) {
    const out = { industries: {}, sectors: {}, themes: {} }
    for (const t of bodyOf(init).tickers || []) {
      const u = BY_T[t]; if (!u) continue
      out.industries[t] = u.industry; out.sectors[t] = u.sector; out.themes[t] = u.theme
    }
    return json(out)
  }
  if (url.includes('/api/watchlists/themes-batch')) {
    const results = {}
    for (const t of bodyOf(init).tickers || []) results[t] = BY_T[t]?.theme ?? null
    return json({ results })
  }
  if (url.includes('/api/watchlists/bulk-meta') || url.includes('/api/research/snapshot-batch')) {
    const res = {}
    for (const t of bodyOf(init).tickers || []) {
      const u = BY_T[t]; if (!u) continue
      const r = mul(hash(t + 'meta'))
      const cap = Math.pow(10, 8 + r() * 3.3)
      res[t] = { name: u.n, sector: u.sector, industry: u.industry, composite: Math.round(20 + r() * 79),
        market_cap: cap >= 1e9 ? `$${(cap / 1e9).toFixed(2)}B` : `$${Math.round(cap / 1e6)}M`,
        next_earnings: r() < 0.2 ? '2026-11-10' : '2027-02-01' }
    }
    return json(url.includes('bulk-meta') ? { results: res, missing: [] } : res)
  }
  const ctx = /\/api\/breadth-monitor\/(\d{4}-\d{2}-\d{2})\/drill\/([a-z0-9_]+)\/context/.exec(url)
  if (ctx) {
    const [, date, key] = ctx
    const items = listFor(key, date)
    const i = SESSIONS.indexOf(date)
    const prev = SESSIONS.slice(i + 1, i + 6).map(d => new Set(listFor(key, d).map(x => x.t)))
    const repeat = {}; const also = {}
    for (const it of items) {
      const n = prev.filter(s => s.has(it.t)).length; if (n) repeat[it.t] = n
      for (const c of COLS) if (c.drillKey !== key && listFor(c.drillKey, date).some(x => x.t === it.t)) (also[it.t] ||= []).push(c.drillKey)
    }
    return json({ date, metric: key, also, repeat, lookback_found: prev.length })
  }
  // The long history the count chart's 6M / 1Y ranges ask for.
  const hist = /\/api\/breadth-monitor\?days=(\d+)/.exec(url)
  if (hist) return json({ rows: ROWS.slice(0, Number(hist[1])), days: Number(hist[1]) })
  const bars = /\/api\/bars\/([^?]+)\?tf=([^&]+)/.exec(url)
  if (bars) {
    const sym = decodeURIComponent(bars[1]); const tf = bars[2]
    if (BARS_LATENCY_MS) await new Promise(res => setTimeout(res, BARS_LATENCY_MS))
    return json({ ticker: sym, tf, bars: tf === 'D' || tf === 'W' ? barsFor(sym, tf) : [] })
  }
  // The member's own lists: an ARRAY (the table filters it). Flag writes are recorded, not sent.
  if (/\/api\/watchlists(\/public|\/prebuilt)?(\?|$)/.test(url) && method === 'GET') return json([])
  if (url.includes('/api/watchlists/flagged')) {
    if (method !== 'GET') BLOCKED.push(`${method} ${url}`)
    return json(method === 'GET' ? { tickers: [] } : {})
  }
  // Anything else (live quotes, alerts, news…) answers empty: synthetic only.
  return json({})
}

// The page holds a 90-session window, like the real Monitor.
const PAGE_ROWS = ROWS.slice(0, 90)

function makeDrill(colKey, date) {
  const col = COLS.find(c => c.key === colKey)
  return { date, label: col.label, live: false, colKey, drillKey: col.drillKey,
    url: `/api/breadth-monitor/${date}/drill/${col.drillKey}`, items: listFor(col.drillKey, date), error: null }
}

function Harness() {
  const [open, setOpen] = useState(true)
  const [drill, setDrill] = useState(() => makeDrill('up_4pct_today', SESSIONS[0]))
  useEffect(() => {
    window.__sdh = { blocked: () => BLOCKED.slice(), requests: () => REQUESTS.slice(), reopen: () => { setOpen(false); setTimeout(() => setOpen(true), 50) } }
  }, [])
  const onNavigate = useCallback(({ colKey, date }) => setDrill(makeDrill(colKey, date || SESSIONS[0])), [])
  const drillCols = useMemo(() => COLS.map(({ key, label, drillKey }) => ({ key, label, drillKey })), [])
  return (
    <MemoryRouter>
      <AuthProvider>
        {open
          ? <BreadthDrillModal drill={drill} latestDate={SESSIONS[0]} onClose={() => setOpen(false)}
              rows={PAGE_ROWS} drillCols={drillCols} onNavigate={onNavigate} />
          : <button onClick={() => setOpen(true)} style={{ margin: 40 }}>Open scan deck</button>}
      </AuthProvider>
    </MemoryRouter>
  )
}

createRoot(document.getElementById('root')).render(<Harness />)

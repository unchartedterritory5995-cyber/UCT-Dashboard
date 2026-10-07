// app/src/testing/marketcap/marketCapHarness.jsx
//
// ─── MARKET CAP AUTHORITY IN THE REAL ChartWidget (browser acceptance) ──────
//
// ⭐ Mounts the REAL ChartWidget -> StockChart -> engine -> binder ->
// fundamentalColumnWithAuthority -> marketCapAuthorityStore, and answers every
// `/api/*` from LOCAL files that are byte-for-byte production answers:
//   catalog.json, legacy/<SYM>.json   production WEB (FUNDAMENTALS_PIT_ENABLED=1, V5 v5-20261005T152000Z):
//                                     /api/fundamentals/pit/catalog + /series/<SYM>?series=shares_outstanding
//   auth/<SYM>.json, auth/_status.json  /api/marketcap/pit/<SYM>, /pit-status from api.main.app over the
//                                     DARK DRILL authority (the accepted M3 build) -- never production
//   bars/<SYM>_D.json                 the worker's /data/bars.db, read-only
//
// ⛔ ISOLATED BY CONSTRUCTION (the fundamentals harness locks):
//   ChartWidget gets its own `opts` in page state; the workspace spreads WORKSPACE_FALLBACK;
//   every non-GET to preferences / layouts is REFUSED; every `/api/*` is answered here (unknown = 404),
//   so nothing reaches the shared backend on :8000. It never opens /charts and never touches Main Trading.
//
// MODES  ?auth=on   pit-status 200 -> the authority is the ONLY Market Cap source
//        ?auth=off  pit-status 404 (MCAP_PIT_ENABLED unset)  -> the unchanged legacy composer
//        ?auth=503  pit-status 503 (ON, unverifiable)        -> not computable, never legacy
//        ?seed=market_cap  ?ma=<period>  ?sym=DCTH  ?restore=1
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { AuthProvider } from '../../context/AuthContext'
import { WorkspaceContext, WORKSPACE_FALLBACK } from '../../pages/charts/WorkspaceContext'
import ChartWidget from '../../pages/charts/widgets/ChartWidget'
import { mergeChartSettings } from '../../components/chart/chartDefaults'
import * as registry from '../../components/chart/engine/nativeRegistry'
import { createFromResult, fundamentalResults } from '../../components/chart/discoveryCatalog'
import { addInstance, setInstanceHidden, setInstanceInput, setInstancePanePosition } from '../../components/chart/engine/instanceControls'
import { instanceSource } from '../../components/chart/engine/sourceRef'

const ERRORS = []
window.addEventListener('error', (e) => ERRORS.push(String((e.error && e.error.stack) || e.message)))
window.addEventListener('unhandledrejection', (e) => ERRORS.push(String((e.reason && e.reason.stack) || e.reason)))
const _cerr = console.error.bind(console)
console.error = (...a) => { ERRORS.push(a.map(String).join(' ').slice(0, 400)); _cerr(...a) }

const DATA = '/src/testing/marketcap/.data'
const params = new URLSearchParams(location.search)
const AUTH = params.get('auth') || 'on'
const SYMS = ['DCTH', 'ACOG', 'LPG', 'AAPL', 'NVDA', 'TSLA', 'WBS', 'NXAT']

const BLOCKED = []
const REQUESTS = []
const realFetch = window.fetch.bind(window)
const json = (body, status = 200, headers = {}) => Promise.resolve(new Response(JSON.stringify(body),
  { status, headers: { 'content-type': 'application/json', ...headers } }))
const file = async (path) => {
  const r = await realFetch(`${DATA}/${path}`)
  if (!r.ok) return null
  try { return await r.json() } catch { return null }
}

window.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : (input && input.url) || ''
  const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase()
  if (!url.includes('/api/')) return realFetch(input, init)
  REQUESTS.push(`${method} ${url}`)
  if (url.includes('/api/auth/me')) {
    return json({ user: { id: 'harness', email: 'harness@local', role: 'user', display_name: 'Harness' },
      plan: 'pro', subscription: null, trial: null })
  }
  if (url.includes('/api/auth/preferences') || url.includes('/api/charts-layouts') || url.includes('/api/charts/layouts')) {
    if (method !== 'GET') BLOCKED.push(`${method} ${url}`)
    return json({})
  }
  if (url.includes('/api/marketcap/')) {
    if (AUTH === 'off') return json({ detail: 'Not Found' }, 404)
    if (AUTH === '503') return json({ detail: 'market_cap_unavailable' }, 503)
    if (url.includes('/api/marketcap/pit-status')) return json(await file('auth/_status.json'))
    const m = url.match(/\/api\/marketcap\/pit\/([^/?]+)/)
    const rec = m ? await file(`auth/${decodeURIComponent(m[1]).toUpperCase()}.json`) : null
    if (!rec) return json({ detail: 'not_found' }, 404)
    return json(rec.body, rec.status, { ETag: rec.headers.etag || '', 'X-MCAP-Build': rec.headers['x-mcap-build'] || '' })
  }
  if (url.includes('/api/fundamentals/pit/catalog')) return json(await file('catalog.json'))
  const f = url.match(/\/api\/fundamentals\/pit\/series\/([^?]+)/)
  if (f) {
    const rec = await file(`legacy/${decodeURIComponent(f[1]).toUpperCase()}.json`)
    return rec ? json(rec.body, rec.status) : json({ detail: 'no_data' }, 404)
  }
  const b = url.match(/\/api\/bars\/([^?]+)\?tf=([^&]+)/)
  if (b && !url.includes('/adjustment-basis')) {
    const body = await file(`bars/${decodeURIComponent(b[1]).toUpperCase()}_${b[2]}.json`)
    return json(body ? { ...body, sealed: false } : { ticker: b[1], tf: b[2], bars: [] })
  }
  return json({ detail: 'harness: not served' }, 404)
}

// ── the INDEPENDENT oracle (imports nothing from the engine) ────────────────
// ON:  the value at a daily bar is the authority point of that SAME date, else a gap (no forward fill).
// OFF: the legacy composer -- close x the latest shares_outstanding public by 16:00 ET that day (<= 200 d old).
const nyHour = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' })
function close16(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  for (const h of [20, 21]) {
    const s = Date.UTC(y, m - 1, d, h) / 1000
    if (Number(nyHour.format(new Date(s * 1000))) === 16) return s
  }
  throw new Error(`no 16:00 ET on ${iso}`)
}
function legacyAt(points, iso) {
  const ref = close16(iso)
  let hit = null
  for (const p of points) if (p[0] <= ref) hit = p
  if (!hit || !Number.isFinite(hit[1])) return NaN
  const [y, m, d] = hit[2].split('-').map(Number)
  return (ref - Date.UTC(y, m - 1, d) / 1000) / 86400 >= 201 ? NaN : hit[1]
}
const dayOf = (t) => (typeof t === 'string' ? t.slice(0, 10)
  : t && typeof t === 'object' ? `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}` : null)

async function audit(sym, settings) {
  const bars = (await file(`bars/${sym}_D.json`)).bars
  const dbg = window.__uctChartDebug || {}
  const plotted = dbg[Object.keys(dbg)[0]].engineSeries()
  const inst = (settings.indicatorInstances || []).find((i) => String(i.inputs && i.inputs.source) === 'fund:market_cap')
  if (!inst) return { error: 'no market cap instance' }
  const series = plotted.find((s) => s.instanceId === inst.instanceId)
  if (!series) return { error: 'not plotted', hidden: !!inst.hidden }
  const got = new Map(series.data.map((p) => [dayOf(p.time), p.value]))
  let want
  if (AUTH === 'on') {
    const rec = await file(`auth/${sym}.json`)
    const pts = new Map((rec && rec.body && rec.body.points) || [])
    want = (iso) => (pts.has(iso) ? pts.get(iso) : NaN)
  } else if (AUTH === 'off') {
    const rec = await file(`legacy/${sym}.json`)
    const so = (rec && rec.body && rec.body.metrics && rec.body.metrics.shares_outstanding) || []
    const closeOf = new Map(bars.map((b) => [b.t, b.c]))
    want = (iso) => closeOf.get(iso) * legacyAt(so, iso)
  } else {
    want = () => NaN
  }
  const tol = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))
  let checked = 0, mismatches = 0, valued = 0, firstBad = null
  for (const b of bars) {
    const w = want(b.t)
    const gv = got.has(b.t) && Number.isFinite(got.get(b.t)) ? got.get(b.t) : NaN
    checked++
    if (Number.isFinite(gv)) valued++
    if (Number.isFinite(w) !== Number.isFinite(gv) || (Number.isFinite(w) && !tol(w, gv))) {
      mismatches++
      if (!firstBad) firstBad = { t: b.t, want: w, got: gv }
    }
  }
  const at = (iso) => (got.has(iso) && Number.isFinite(got.get(iso)) ? got.get(iso) : null)
  return { sym, mode: AUTH, bars: bars.length, checked, valued, mismatches, firstBad, at }
}

function seed() {
  let cs = mergeChartSettings(null)
  if (!(params.get('seed') || '').includes('market_cap')) return Promise.resolve(cs)
  return file('catalog.json').then((cat) => {
    // through the PRODUCT's own create door, from the catalogue row the Fundamentals tab shows
    for (const res of fundamentalResults(cat.metrics).filter((r) => r.id === 'market_cap')) cs = createFromResult(cs, res, registry)
    const period = Number(params.get('ma'))
    const host = (cs.indicatorInstances || []).find((i) => String(i.inputs && i.inputs.source) === 'fund:market_cap')
    if (period > 0 && host) {                       // a Moving Average SOURCED from Market Cap (the MA Source picker's write)
      const before = new Set(cs.indicatorInstances.map((i) => i.instanceId))
      cs = addInstance(cs, 'movingAverage', registry)
      const ma = cs.indicatorInstances.find((i) => !before.has(i.instanceId))
      cs = setInstanceInput(cs, ma.instanceId, 'source', instanceSource(host.instanceId, 'value'), registry)
      cs = setInstanceInput(cs, ma.instanceId, 'period', period, registry)
    }
    return cs
  })
}

export function Harness({ initialSettings }) {
  const [sym, setSym] = useState((params.get('sym') || 'DCTH').toUpperCase())
  const [opts, setOpts] = useState(() => ({ tf: 'D', settings: initialSettings }))
  const [groupTfs, setGroupTfs] = useState({ A: 'D', B: 'D', C: 'D', D: 'D' })
  const setGroupTf = useCallback((c, t) => setGroupTfs((p) => (p[c] === t ? p : { ...p, [c]: t })), [])
  const setGroupSym = useCallback((c, s) => { if (c === 'A') setSym(s) }, [])
  const activeChartRef = useRef(null)
  const activeWatchlistRef = useRef(null)
  const chartApiById = useRef(new Map())
  const workspace = useMemo(() => ({
    ...WORKSPACE_FALLBACK,
    groupSyms: { A: sym, B: null, C: null, D: null }, setGroupSym, groupTfs, setGroupTf,
    activeChartRef, activeWatchlistRef, chartApiById,
  }), [sym, setGroupSym, groupTfs, setGroupTf])

  useEffect(() => {
    const mcapId = () => (opts.settings.indicatorInstances || []).find((i) => String(i.inputs && i.inputs.source) === 'fund:market_cap')?.instanceId
    window.__mcap = {
      select: (s) => setSym(String(s).toUpperCase()),
      settings: () => opts.settings,
      series: () => {
        const dbg = window.__uctChartDebug || {}
        const k = Object.keys(dbg)[0]
        return k && dbg[k].engineSeries ? dbg[k].engineSeries().map((s) => ({ instanceId: s.instanceId, n: s.data.length,
          finite: s.data.filter((p) => Number.isFinite(p.value)).length })) : null
      },
      audit: async (days) => { const r = await audit(sym, opts.settings); if (r.at) { r.days = Object.fromEntries((days || []).map((d) => [d, r.at(d)])); delete r.at } return r },
      hide: (h) => setOpts((o) => ({ ...o, settings: setInstanceHidden(o.settings, mcapId(), !!h, registry) })),
      paneAbove: () => setOpts((o) => ({ ...o, settings: setInstancePanePosition(o.settings, mcapId(), 'above', registry) })),
      save: () => { localStorage.setItem('mcapHarnessSaved', JSON.stringify(opts.settings)); return true },
      requests: () => REQUESTS.slice(),
      blocked: () => BLOCKED.slice(),
      errors: () => ERRORS.slice(),
    }
  }, [opts, sym])

  return (
    <MemoryRouter>
      <AuthProvider>
        <WorkspaceContext.Provider value={workspace}>
          <div style={{ display: 'flex', height: '100vh' }}>
            <ul style={{ width: 90, margin: 0, padding: 4, listStyle: 'none' }}>
              <li style={{ fontSize: 11, opacity: 0.7, padding: '2px 6px' }}>auth={AUTH}</li>
              {SYMS.map((s) => (
                <li key={s}>
                  <button type="button" data-row={s} onClick={() => setSym(s)}
                    style={{ width: '100%', textAlign: 'left', background: sym === s ? '#2a3f5f' : 'transparent',
                      color: '#e6e8ec', border: 0, padding: '3px 6px', cursor: 'pointer' }}>{s}</button>
                </li>
              ))}
            </ul>
            <div style={{ flex: 1, minWidth: 0 }}>
              <ChartWidget color="A" opts={opts} onOptsChange={setOpts} />
            </div>
          </div>
        </WorkspaceContext.Provider>
      </AuthProvider>
    </MemoryRouter>
  )
}

const restored = (() => {
  if (params.get('restore') !== '1') return null
  try { return mergeChartSettings(JSON.parse(localStorage.getItem('mcapHarnessSaved'))) } catch { return null }
})()
Promise.resolve(restored || seed()).then((cs) => {
  createRoot(document.getElementById('root')).render(<Harness initialSettings={cs} />)
})

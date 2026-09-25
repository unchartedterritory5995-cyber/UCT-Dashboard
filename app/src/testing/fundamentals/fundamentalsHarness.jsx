// app/src/testing/fundamentals/fundamentalsHarness.jsx
//
// ─── HISTORICAL FUNDAMENTALS IN THE REAL ChartWidget ─────────────────────────
//
// ⭐ Mounts the REAL ChartWidget -> StockChart -> Indicators / engine, and
// answers every `/api/*` from LOCAL files exported by
// `tools/fundamentals_pit_poc/export_harness_data.py` (a scratch PIT store built
// from the SEC bulk archives + the local bars.db, read-only). The payloads are
// byte-for-byte what the product's routes return, so everything from the
// catalogue fetch to the as-of projection runs exactly as it would for a member.
//
// ⛔ ISOLATED BY CONSTRUCTION (the scan/pane harness locks, plus one):
//   1. ChartWidget gets its own `opts` + `onOptsChange` in page state.
//   2. The workspace value spreads the canonical `WORKSPACE_FALLBACK`.
//   3. `window.fetch` REFUSES any non-GET to preferences / layouts.
//   4. EVERY `/api/*` is answered here; an unknown route is a 404 -- no request
//      reaches the shared backend on :8000, and none reaches SEC (`__fund.requests()`).
// It never opens /charts and never touches Main Trading.
//
// Dev-server only (vite builds index.html alone; see scanHarnessAbsent.test.js).
//   Run:  npx vite --host 127.0.0.1 --port <free>     (from app/)
//   Then: http://127.0.0.1:<port>/fundamentals-harness.html?sym=AAPL&tf=D
//   Modes: ?catalog=off  (feature dark)   ?deny=1  (unentitled member)
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { AuthProvider } from '../../context/AuthContext'
import { WorkspaceContext, WORKSPACE_FALLBACK } from '../../pages/charts/WorkspaceContext'
import ChartWidget from '../../pages/charts/widgets/ChartWidget'
import { mergeChartSettings } from '../../components/chart/chartDefaults'
import * as registry from '../../components/chart/engine/nativeRegistry'
import { createDirectSeries, createFromResult, fundamentalResults } from '../../components/chart/discoveryCatalog'
import { addInstance, setInstanceInput } from '../../components/chart/engine/instanceControls'
import { instanceSource } from '../../components/chart/engine/sourceRef'

const ERRORS = []
window.addEventListener('error', (e) => ERRORS.push(String((e.error && e.error.stack) || e.message)))
window.addEventListener('unhandledrejection', (e) => ERRORS.push(String((e.reason && e.reason.stack) || e.reason)))
window.__fundErrors = ERRORS

const DATA = '/src/testing/fundamentals/.data'
const params = new URLSearchParams(location.search)
const CATALOG_OFF = params.get('catalog') === 'off'
const DENY = params.get('deny') === '1'
const SYMS = ['AAPL', 'NVDA', 'JPM', 'CAT', 'CAVA', 'CELH', 'TSLA']

const BLOCKED = []
const REQUESTS = []
const realFetch = window.fetch.bind(window)
const json = (body, status = 200) => Promise.resolve(new Response(JSON.stringify(body),
  { status, headers: { 'content-type': 'application/json' } }))
// The derivation version the exporter wrote (`current.json`), never hard-coded.
let _pitRoot = null
const pitRoot = async () => {
  if (!_pitRoot) {
    const r = await realFetch(`${DATA}/fundamentals_pit/current.json`)
    const v = r.ok ? (await r.json()).version : 1
    _pitRoot = `fundamentals_pit/v${v}`
  }
  return _pitRoot
}
const file = async (path) => {
  const r = await realFetch(`${DATA}/${path}`)
  if (!r.ok) return null
  try { return await r.json() } catch { return null }
}

window.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : (input && input.url) || ''
  const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase()
  if (!url.includes('/api/')) return realFetch(input, init)          // vite assets, the data files
  REQUESTS.push(`${method} ${url}`)
  if (url.includes('/api/auth/me')) {
    return json({ user: { id: 'harness', email: 'harness@local', role: 'user', display_name: 'Harness' },
      plan: 'pro', subscription: null, trial: null })
  }
  if (url.includes('/api/auth/preferences') || url.includes('/api/charts-layouts') || url.includes('/api/charts/layouts')) {
    if (method !== 'GET') BLOCKED.push(`${method} ${url}`)
    return json({})
  }
  if (url.includes('/api/fundamentals/pit/')) {
    if (CATALOG_OFF) return json({ detail: 'Not Found' }, 404)
    if (DENY) return json({ detail: 'upgrade' }, 403)
    if (url.includes('/api/fundamentals/pit/catalog')) return json(await file('catalog.json'))
    const m = url.match(/\/api\/fundamentals\/pit\/series\/([^?]+)\?series=([^&]+)/)
    if (m) {
      const sym = decodeURIComponent(m[1]).toUpperCase()
      const ids = decodeURIComponent(m[2]).split(',')
      const index = await file(`${await pitRoot()}/tickers.json`)
      const cik = index && index.tickers ? index.tickers[sym] : null
      const art = cik != null ? await file(`${await pitRoot()}/cik/${cik}.json`) : null
      const out = { symbol: sym, derivation_version: Number((await pitRoot()).split('/v')[1]), metrics: {}, missing: [] }
      if (art) Object.assign(out, { cik: art.cik, name: art.name, split_status: art.split_status,
        withheld_split_sensitive: art.withheld_split_sensitive })
      for (const id of ids) {
        const pts = id === 'beta_1y_spy' ? await file(`beta/${sym}.json`) : art && art.metrics[id]
        if (pts && pts.length) out.metrics[id] = pts
        else out.missing.push(id)
      }
      if (!art && !Object.keys(out.metrics).length) return json({ detail: 'no_data', symbol: sym }, 404)
      return json(out)
    }
  }
  const b = url.match(/\/api\/bars\/([^?]+)\?tf=([^&]+)/)
  if (b && !url.includes('/adjustment-basis')) {
    const body = await file(`bars/${decodeURIComponent(b[1]).toUpperCase()}_${b[2]}.json`)
    return json(body || { ticker: b[1], tf: b[2], bars: [] })
  }
  return json({ detail: 'harness: not served' }, 404)
}

// ── The INDEPENDENT oracle ───────────────────────────────────────────────────
// Re-derives every plotted fundamental value from the raw artifact + raw bars
// WITHOUT importing the engine's as-of code, so an error there cannot hide
// behind itself. Rule under test: the value at a bar is the latest point whose
// public time <= the bar's reference instant (daily: 16:00 ET that day; W/M:
// 16:00 ET on the bucket's last weekday/day; intraday: bar end), dropped once
// its fiscal period is > 200 days old.
const nyHour = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' })
function oracleClose(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  for (const h of [20, 21]) {                       // EDT / EST
    const s = Date.UTC(y, m - 1, d, h) / 1000
    if (Number(nyHour.format(new Date(s * 1000))) === 16) return s
  }
  throw new Error(`no 16:00 ET on ${iso}`)
}
function oracleRef(t, tf) {
  if (tf === 'D') return oracleClose(t)
  if (tf === 'W' || tf === 'M') {
    const [y, m, d] = t.split('-').map(Number)
    const end = tf === 'M' ? new Date(Date.UTC(y, m, 0))
      : new Date(Date.UTC(y, m - 1, d + ((5 - new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 7) % 7)))
    return Math.min(oracleClose(end.toISOString().slice(0, 10)), Date.now() / 1000)
  }
  return Number(t) + Number(tf) * 60
}
function oracleAsOf(points, ref) {
  let hit = null
  for (const p of points) if (p[0] <= ref) hit = p          // points ascend by public time
  if (!hit) return NaN
  if (!Number.isFinite(hit[1])) return NaN                      // a gap point
  if (!hit[2]) return hit[1]                                    // Beta: no period, no staleness
  const [y, m, d] = hit[2].split('-').map(Number)
  return (ref - Date.UTC(y, m - 1, d) / 1000) / 86400 >= 201 ? NaN : hit[1]
}
const ORACLE_COMPOSE = {
  market_cap: (c, x) => c * x.shares_outstanding,
  pe: (c, x) => (x.eps_diluted_ttm > 0 ? c / x.eps_diluted_ttm : NaN),
  ps: (c, x) => (x.revenue_ttm > 0 ? c * x.shares_outstanding / x.revenue_ttm : NaN),
  pb: (c, x) => (x.equity > 0 ? c * x.shares_outstanding / x.equity : NaN),
  fcf_yield: (c, x) => (c * x.shares_outstanding > 0 ? 100 * x.fcf_ttm / (c * x.shares_outstanding) : NaN),
}

async function audit(sym, tf, settings) {
  const cat = await file('catalog.json')
  const byId = Object.fromEntries(cat.metrics.map((m) => [m.id, m]))
  const index = await file(`${await pitRoot()}/tickers.json`)
  const art = await file(`${await pitRoot()}/cik/${index.tickers[sym]}.json`)
  const bars = (await file(`bars/${sym}_${tf}.json`)).bars
  const dbg = window.__uctChartDebug || {}
  const plotted = dbg[Object.keys(dbg)[0]].engineSeries()
  const pointsOf = async (id) => (id === 'beta_1y_spy' ? file(`beta/${sym}.json`) : (art.metrics[id] || []))
  const report = []
  for (const inst of settings.indicatorInstances || []) {
    const src = inst.inputs && inst.inputs.source
    if (!src || !src.startsWith('fund:')) continue
    const metric = byId[src.slice(5)]
    const series = plotted.find((s) => s.instanceId === inst.instanceId)
    if (!series) { report.push({ metric: metric.id, error: 'not plotted' }); continue }
    const ids = metric.series ? [metric.series] : metric.inputs
    const pts = Object.fromEntries(await Promise.all(ids.map(async (id) => [id, await pointsOf(id)])))
    // D/W/M plot ISO days -> align by time (the engine omits non-finite points).
    // Intraday plots display-shifted seconds, so align by index -- only valid
    // when nothing was omitted, which is checked rather than assumed.
    const byTime = typeof bars[0].t === 'string'
      ? new Map(series.data.map((p) => [typeof p.time === 'string' ? p.time : p.time && `${p.time.year}-${String(p.time.month).padStart(2, '0')}-${String(p.time.day).padStart(2, '0')}`, p]))
      : null
    if (!byTime && series.data.length !== bars.length) { report.push({ metric: metric.id, error: 'intraday length differs; cannot align' }); continue }
    let checked = 0, mismatches = 0, preEffective = 0, firstBad = null
    const tolerance = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))
    for (let i = 0; i < bars.length; i++) {
      const ref = oracleRef(bars[i].t, tf)
      let want
      if (metric.series) want = oracleAsOf(pts[metric.series], ref)
      else {
        const x = {}
        let ok = true
        for (const id of ids) { x[id] = oracleAsOf(pts[id], ref); if (!Number.isFinite(x[id])) ok = false }
        want = ok ? ORACLE_COMPOSE[metric.compose](bars[i].c, x) : NaN
      }
      const p = byTime ? byTime.get(bars[i].t) : series.data[i]
      const got = p && Number.isFinite(p.value) ? p.value : NaN
      checked++
      if (Number.isFinite(want) !== Number.isFinite(got) || (Number.isFinite(want) && !tolerance(want, got))) {
        mismatches++
        if (!firstBad) firstBad = { i, t: bars[i].t, want, got }
      }
      // pre-effective: a value on screen that no point public at `ref` could have produced
      if (metric.series && Number.isFinite(got) && !pts[metric.series].some((q) => q[0] <= ref && tolerance(q[1], got))) preEffective++
    }
    const changes = series.data.filter((p, i) => i && p.value !== series.data[i - 1].value).length
    report.push({ metric: metric.id, plotStyle: (inst.presentation && inst.presentation.plotStyle) || 'line',
      bars: bars.length, plottedLen: series.data.length, checked, mismatches, preEffective, changes,
      priceFormat: series.priceFormat, firstBad })
  }
  return report
}

// `?control=nodata,rsi` -- a CONTROL arm with no fundamentals in it: an own-pane
// `sym:` series for a symbol this harness has no bars for (all-NaN, exactly
// like a fundamental the company never reports) and/or an RSI. Used to tell a
// defect of the fundamentals lane from one of the shared pane machinery.
function seedControls(cs, list) {
  for (const c of list) {
    if (c === 'rsi') cs = addInstance(cs, 'rsi', registry)
    const sym = c === 'nodata' ? 'ZZZZ' : (c.startsWith('sym:') ? c.slice(4) : null)
    // Through the product's own door -- the one the Symbols tab uses.
    if (sym) cs = createDirectSeries(cs, `sym:${sym}:close`, registry, { name: sym })
  }
  return cs
}

function seedSettings(ids, controls = []) {
  let cs = seedControls(mergeChartSettings(null), controls)
  if (!ids.length) return cs
  // Seeds through the PRODUCT's own create door, from the same catalogue rows
  // the Fundamentals tab shows -- never a hand-built instance.
  return file('catalog.json').then((cat) => {
    for (const res of fundamentalResults(cat.metrics).filter((r) => ids.includes(r.id))) {
      cs = createFromResult(cs, res, registry)
    }
    // `?ma=<period>` -- a Moving Average whose Source is the FIRST fundamental,
    // written the way the MA's Source picker writes it (`instanceSource`).
    const period = Number(params.get('ma'))
    const host = (cs.indicatorInstances || []).find((i) => String(i.inputs && i.inputs.source).startsWith('fund:'))
    if (period > 0 && host) {
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
  const [sym, setSym] = useState((params.get('sym') || 'AAPL').toUpperCase())
  const [opts, setOpts] = useState(() => ({ tf: params.get('tf') || 'D', settings: initialSettings }))
  const [groupTfs, setGroupTfs] = useState({ A: opts.tf, B: opts.tf, C: opts.tf, D: opts.tf })
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
    window.__fund = {
      select: (s) => setSym(String(s).toUpperCase()),
      setTf: (t) => { setOpts((o) => ({ ...o, tf: t })); setGroupTfs({ A: t, B: t, C: t, D: t }) },
      settings: () => opts.settings,
      series: () => {
        const dbg = window.__uctChartDebug || {}
        const k = Object.keys(dbg)[0]
        return k && dbg[k].engineSeries ? dbg[k].engineSeries() : null
      },
      audit: () => audit(sym, opts.tf, opts.settings),
      // SAVE / RELOAD, the way a stored layout travels: JSON out, and back in through
      // `mergeChartSettings` (the allow-list every stored blob is read through).
      save: () => { localStorage.setItem('fundHarnessSaved', JSON.stringify(opts.settings)); return true },
      requests: () => REQUESTS.slice(),
      blocked: () => BLOCKED.slice(),
    }
  }, [opts, sym])

  return (
    <MemoryRouter>
      <AuthProvider>
        <WorkspaceContext.Provider value={workspace}>
          <div style={{ display: 'flex', height: '100vh' }}>
            <ul style={{ width: 90, margin: 0, padding: 4, listStyle: 'none' }}>
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

const seedIds = (params.get('seed') || '').split(',').filter(Boolean)
const controlIds = (params.get('control') || '').split(',').filter(Boolean)
const restored = (() => {
  if (params.get('restore') !== '1') return null
  try { return mergeChartSettings(JSON.parse(localStorage.getItem('fundHarnessSaved'))) } catch { return null }
})()
Promise.resolve(restored || seedSettings(seedIds, controlIds)).then((cs) => {
  createRoot(document.getElementById('root')).render(<Harness initialSettings={cs} />)
})

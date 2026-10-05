/**
 * UNIFIED ADD TO CHART — LIVE HARNESS (dev-server only; see add-to-chart-harness.html).
 *
 * Mounts the REAL ChartWidget — real ChartPane, settings modal, Indicators
 * surface, ChartDetailDock, Earnings Strip and Company Info — with its `opts` in
 * page state, so the host-feature lifecycle (add → resize → collapse → reload →
 * remove) can be driven and measured without a workspace.
 *
 * ⛔ IT CANNOT WRITE A PREFERENCE OR A LAYOUT — the scan harness's three locks:
 *   1. ChartWidget's opts live in page state (window.__a2c.opts()).
 *   2. The workspace value SPREADS the canonical WORKSPACE_FALLBACK.
 *   3. window.fetch refuses every non-GET to the preference/layout routes and
 *      records it (window.__a2c.blocked()).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { AuthProvider } from '../../context/AuthContext'
import { WorkspaceContext, WORKSPACE_FALLBACK } from '../../pages/charts/WorkspaceContext'
import ChartWidget from '../../pages/charts/widgets/ChartWidget'
import { mergeChartSettings } from '../../components/chart/chartDefaults'
import * as registry from '../../components/chart/engine/nativeRegistry'
import { addInstance } from '../../components/chart/engine/instanceControls'

const BLOCKED = []
const realFetch = window.fetch.bind(window)
window.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : (input && input.url) || ''
  const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase()
  if (url.includes('/api/auth/me')) {
    return Promise.resolve(new Response(JSON.stringify({
      user: { id: 'harness', email: 'harness@local', role: 'user', display_name: 'Harness' },
      plan: 'pro', subscription: null, trial: null,
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
  }
  if (url.includes('/api/auth/preferences') || url.includes('/api/charts-layouts')
      || url.includes('/api/charts/layouts')) {
    if (method !== 'GET') {
      BLOCKED.push(`${method} ${url}`)
      console.error('[a2c-harness] REFUSED a persistence write:', method, url)
    }
    return Promise.resolve(new Response('{}', {
      status: 200, headers: { 'content-type': 'application/json' },
    }))
  }
  return realFetch(input, init)
}

const params = new URLSearchParams(location.search)
const SYM = (params.get('sym') || 'AAPL').toUpperCase()
const TF = params.get('tf') || 'D'
const seedOpts = () => {
  // A realistic chart: the default MAs/Volume plus RSI in its own pane, so pane
  // order and the legend have something to be unaffected by.
  let settings = mergeChartSettings(null)
  if (params.get('studies') !== '0') settings = addInstance(settings, 'rsi', registry)
  let dock
  try { dock = params.get('dock') ? JSON.parse(params.get('dock')) : undefined } catch { dock = undefined }
  return { tf: TF, settings, ...(dock ? { dock } : {}) }
}

function Harness() {
  const [groupSyms, setGroupSyms] = useState({ A: SYM, B: null, C: null, D: null })
  const [opts, setOpts] = useState(seedOpts)
  const [width, setWidth] = useState(() => Number(params.get('w')) || 1400)
  const [mountKey, setMountKey] = useState(0)
  const [mounted, setMounted] = useState(true)
  const optsRef = useRef(opts)
  optsRef.current = opts
  const log = useRef([])

  const setGroupSym = useCallback((c, s) => setGroupSyms(p => (p[c] === s ? p : { ...p, [c]: s })), [])
  const [groupTfs, setGroupTfs] = useState({ A: TF, B: TF, C: TF, D: TF })
  const setGroupTf = useCallback((c, t) => setGroupTfs(p => (p[c] === t ? p : { ...p, [c]: t })), [])
  const activeChartRef = useRef(null)
  const activeWatchlistRef = useRef(null)
  const chartApiById = useRef(new Map())
  const workspace = useMemo(() => ({
    ...WORKSPACE_FALLBACK,
    groupSyms, setGroupSym, groupTfs, setGroupTf,
    activeChartRef, activeWatchlistRef, chartApiById,
  }), [groupSyms, setGroupSym, groupTfs, setGroupTf])

  const onOptsChange = useCallback((next) => {
    log.current.push(JSON.parse(JSON.stringify(next)))
    setOpts(next)
  }, [])

  useEffect(() => {
    window.__a2c = {
      opts: () => JSON.parse(JSON.stringify(optsRef.current)),
      writes: () => log.current.slice(),
      setSym: (s) => setGroupSyms(p => ({ ...p, A: s })),
      setWidth: (w) => setWidth(w),
      // ⭐ RELOAD = what a workspace restore does: the widget is UNMOUNTED, its
      // opts survive only as serialised JSON, and a fresh widget mounts from it.
      reload: () => {
        const saved = JSON.stringify(optsRef.current)
        setMounted(false)
        setTimeout(() => { setOpts(JSON.parse(saved)); setMountKey(k => k + 1); setMounted(true) }, 60)
        return saved.length
      },
      blocked: () => BLOCKED.slice(),
    }
  }, [])

  return (
    <MemoryRouter>
      <AuthProvider>
        <WorkspaceContext.Provider value={workspace}>
          <div
            data-testid="a2c-frame"
            style={{ width, height: 720, border: '1px solid #2a2f38', position: 'relative', display: 'flex', flexDirection: 'column' }}
          >
            {mounted && (
              <ChartWidget key={mountKey} color="A" opts={opts} onOptsChange={onOptsChange} chartId="a2c-harness" />
            )}
          </div>
        </WorkspaceContext.Provider>
      </AuthProvider>
    </MemoryRouter>
  )
}

createRoot(document.getElementById('root')).render(<Harness />)

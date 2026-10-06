/**
 * CREATE INDICATOR — LIVE HARNESS (dev-server only; see create-indicator-harness.html).
 *
 * Mounts the REAL ChartWidget with its `opts` in page state — the same harness
 * shape as add-to-chart-harness — so the Slice 1 lifecycle (open → converse →
 * preview → patch → undo → save → reload; and open → preview → cancel → reload)
 * is driven through the member's own surfaces, never Main Trading.
 *
 * ⛔ PERSISTENCE LOCKS (the a2c/scan harness's three):
 *   1. ChartWidget's opts live in page state (window.__cih.opts()); every chart
 *      settings write is recorded (window.__cih.writes()).
 *   2. The workspace value SPREADS the canonical WORKSPACE_FALLBACK.
 *   3. window.fetch refuses every non-GET to the preference/layout routes and
 *      records it (window.__cih.blocked()).
 *
 * ⭐ THE ONE STAND-IN: POST /api/user-definitions/converse is answered in-page by
 * `scriptedReply` from the request's own compact view. Auth, the definition
 * store (save + list on reload) and bars are the SANDBOXED backend's.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../../index.css'
import { MemoryRouter } from 'react-router-dom'
import { AuthProvider } from '../../context/AuthContext'
import { WorkspaceContext, WORKSPACE_FALLBACK } from '../../pages/charts/WorkspaceContext'
import ChartWidget from '../../pages/charts/widgets/ChartWidget'
import { mergeChartSettings } from '../../components/chart/chartDefaults'
import * as registry from '../../components/chart/engine/nativeRegistry'
import { setCreateIndicatorFlag } from '../../components/chart/builder/studio/createIndicatorFlag'
import { STUDIO_PREVIEW_DEF_ID } from '../../components/chart/builder/studio/chartPreview'
import { scriptedReply } from './scriptedConverse'

const BLOCKED = []
const NET = []          // every request: {t, method, url, status}
const CONVERSE = []     // what the "model" was shown and answered
const realFetch = window.fetch.bind(window)
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

window.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : (input && input.url) || ''
  const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase()
  const rec = { t: Math.round(performance.now()), method, url }
  NET.push(rec)
  if (url.includes('/api/auth/preferences') || url.includes('/api/charts-layouts') || url.includes('/api/charts/layouts')) {
    if (method !== 'GET') {
      BLOCKED.push(`${method} ${url}`)
      console.error('[cih-harness] REFUSED a persistence write:', method, url)
    }
    rec.status = 'stubbed'
    return json({})
  }
  if (url.includes('/api/user-definitions/converse') && method === 'POST') {
    let body = {}
    try { body = JSON.parse((init && init.body) || '{}') } catch { /* */ }
    const answer = scriptedReply(body.message, body.view)
    CONVERSE.push({ message: body.message, revision: body.view && body.view.revision, answer })
    rec.status = 'scripted'
    await new Promise((r) => setTimeout(r, 450))   // a believable round-trip
    return json(answer)
  }
  const r = await realFetch(input, init)
  rec.status = r.status
  return r
}

const params = new URLSearchParams(location.search)
const SYM = (params.get('sym') || 'AAPL').toUpperCase()
const TF = params.get('tf') || 'D'
const seedOpts = () => ({ tf: TF, settings: mergeChartSettings(null) })

const OPTS_KEY = 'cih.opts'
const loadOpts = () => {
  try { const s = sessionStorage.getItem(OPTS_KEY); return s ? JSON.parse(s) : seedOpts() } catch { return seedOpts() }
}

function Harness() {
  const [groupSyms, setGroupSyms] = useState({ A: SYM, B: null, C: null, D: null })
  const [opts, setOpts] = useState(loadOpts)
  const [width] = useState(() => Number(params.get('w')) || 1400)
  const [mountKey, setMountKey] = useState(0)
  const [mounted, setMounted] = useState(true)
  const optsRef = useRef(opts)
  useEffect(() => { optsRef.current = opts }, [opts])
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
    // ⭐ "Durable" for this harness = survives a FULL PAGE RELOAD: the opts are
    // the widget's persisted state, held in sessionStorage in place of a layout.
    try { sessionStorage.setItem(OPTS_KEY, JSON.stringify(next)) } catch { /* */ }
    setOpts(next)
  }, [])

  useEffect(() => {
    window.__cih = {
      opts: () => JSON.parse(JSON.stringify(optsRef.current)),
      instances: () => (optsRef.current.settings?.indicatorInstances || []).filter((i) => i && !i.deleted)
        .map((i) => ({ instanceId: i.instanceId, defId: i.defId })),
      writes: () => log.current.slice(),
      blocked: () => BLOCKED.slice(),
      net: () => NET.slice(),
      converse: () => CONVERSE.slice(),
      previewInstalled: () => !!registry.getDefinition(STUDIO_PREVIEW_DEF_ID),
      userDefs: () => registry.listUserDefinitions().map((d) => ({ id: d.id, version: d.version, name: d.meta && d.meta.name })),
      flag: (on) => setCreateIndicatorFlag(on),
      resetOpts: () => { try { sessionStorage.removeItem(OPTS_KEY) } catch { /* */ } },
      // In-page remount from the serialised opts (the a2c harness's reload).
      remount: () => {
        const saved = JSON.stringify(optsRef.current)
        setMounted(false)
        setTimeout(() => { setOpts(JSON.parse(saved)); setMountKey(k => k + 1); setMounted(true) }, 60)
      },
      // Sandbox account through the REAL auth routes (sandboxed backend only).
      login: async (email = 'ci-harness@local.dev', password = 'harness-pass-1') => {
        const body = JSON.stringify({ email, password, display_name: 'CI Harness' })
        const h = { 'Content-Type': 'application/json' }
        let r = await realFetch('/api/auth/login', { method: 'POST', headers: h, credentials: 'include', body })
        if (!r.ok) r = await realFetch('/api/auth/signup', { method: 'POST', headers: h, credentials: 'include', body })
        return r.status
      },
    }
  }, [])

  return (
    <MemoryRouter>
      <AuthProvider>
        <WorkspaceContext.Provider value={workspace}>
          <div data-testid="cih-frame"
            style={{ width, height: 760, border: '1px solid #2a2f38', position: 'relative', display: 'flex', flexDirection: 'column' }}>
            {mounted && (
              <ChartWidget key={mountKey} color="A" opts={opts} onOptsChange={onOptsChange} chartId="cih-harness" />
            )}
          </div>
        </WorkspaceContext.Provider>
      </AuthProvider>
    </MemoryRouter>
  )
}

createRoot(document.getElementById('root')).render(<Harness />)

// ── ATOMIC HANDOFF + NEIGHBOUR-WARM LIVE HARNESS ────────────────────────────
//
// Mounts the REAL ChartWidget behind the REAL useSymbolHandoff, driven by a
// list surface that changes the colour-group symbol exactly the way Theme
// Tracker and Watchlists do. The unit rails prove the coordinator's logic; only
// this can prove what the MEMBER SEES — that identity and candles agree at
// every compositor-visible instant.
//
// ⛔ WHY NOT StockChart DIRECTLY. `/r/chart` mounts StockChart, so the previous
// harness could not exercise the coordinator at all: its empty-window numbers
// were pre-handoff by construction. The whole point here is the ChartWidget
// boundary, because half the identity surface (dock, leverage/holdings
// controls) lives outside StockChart's tree.
//
// ⛔ IT CANNOT WRITE A PREFERENCE OR A WORKSPACE. Same three locks
// `pane-harness.html` established, because this runs on the machine holding the
// frozen Main Trading row:
//   1. ChartWidget gets its own `opts` + `onOptsChange` held in page state.
//   2. The workspace value is built by spreading the CANONICAL
//      `WORKSPACE_FALLBACK` — never a hand-copied shape (that defect has
//      already been caught once by the provider-shape rails).
//   3. `window.fetch` REFUSES any non-GET to `/api/auth/preferences` outright.
//      Lock 3 does not trust locks 1 and 2 — it is what makes "cannot" a fact.
//
// Dev-server only. `vite build` takes index.html as its single input, so this
// entry never ships; `scanHarnessAbsent.test.js` rails that.
//
// Run:  npx vite     (from app/)
// Then: http://localhost:5173/scan-harness.html

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { AuthProvider } from '../../context/AuthContext'
import { WorkspaceContext, WORKSPACE_FALLBACK } from '../../pages/charts/WorkspaceContext'
import ChartWidget from '../../pages/charts/widgets/ChartWidget'
import { useNeighborWarm } from '../../hooks/useNeighborWarm'
import { expectedLatestCompletedBar, expectedBarsBehind, isCurrentEnoughForPaint } from '../../utils/marketSession'
import { memPeek } from '../../utils/barsMemCache'
import { idbGet } from '../../utils/barsIDB'
import { pollNow, getSnapshot } from '../../hooks/livePriceStore'
import { cameraAuditEnabled, cameraAuditReport, cameraAuditClear, unauthorizedMoves, forceIllegalCameraMove, cameraAuditOwned, cameraTimeScaleOptions } from '../../utils/cameraAudit'

// ── Lock 3: no preference write can leave this page ──
const BLOCKED = []
const realFetch = window.fetch.bind(window)
window.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : (input && input.url) || ''
  const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase()
  // ⭐ THE REAL AuthProvider, ANSWERED OFFLINE. ChartWidget's subtree calls
  // `useAuth` (via useWatchlistAlerts / useFlagged), and hand-faking the auth
  // context would be the same second-authority mistake the provider-shape rails
  // already caught once. So the real provider mounts and this shim answers its
  // one bootstrap call with a stub PAID member — no account, no session cookie,
  // no network.
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
      // eslint-disable-next-line no-console
      console.error('[scan-harness] REFUSED a persistence write:', method, url)
    }
    return Promise.resolve(new Response('{}', {
      status: 200, headers: { 'content-type': 'application/json' },
    }))
  }
  return realFetch(input, init)
}
window.__scanHarnessBlocked = BLOCKED

const params = new URLSearchParams(location.search)
const TF = params.get('tf') || '5'
const SYMS = (params.get('syms') || '').split(',').filter(Boolean)

/** What the harness can see about a symbol WITHOUT touching the network — the
 *  "is the next click already prepared?" question, asked before every switch. */
async function readiness(sym, tf) {
  const mem = memPeek(sym, tf)
  const memLast = mem?.length ? mem[mem.length - 1]?.t : null
  let idbLast = null
  try { const e = await idbGet(sym, tf); idbLast = e?.lastT ?? null } catch { /* absent */ }
  const last = (typeof memLast === 'number') ? memLast : idbLast
  const frontier = expectedLatestCompletedBar(tf)
  const behind = expectedBarsBehind(last, tf)
  const current = (typeof last === 'number') && isCurrentEnoughForPaint(last, tf)
  return {
    sym,
    source: (typeof memLast === 'number') ? 'memory' : (idbLast != null ? 'idb' : 'cold'),
    lastT: last, frontier, barsBehind: behind, currentBeforeClick: !!current,
  }
}

function Harness() {
  const [groupSyms, setGroupSyms] = useState({ A: SYMS[0] || 'SPY', B: null, C: null, D: null })
  const [opts, setOpts] = useState({ tf: TF })
  const activeChartRef = useRef(null)
  const activeWatchlistRef = useRef(null)
  const chartApiById = useRef(new Map())

  const setGroupSym = useCallback((c, s) => setGroupSyms(p => (p[c] === s ? p : { ...p, [c]: s })), [])
  const [groupTfs, setGroupTfs] = useState({ A: TF, B: TF, C: TF, D: TF })
  const setGroupTf = useCallback((c, t) => setGroupTfs(p => (p[c] === t ? p : { ...p, [c]: t })), [])

  // ⭐ CANONICAL SHAPE, SPREAD — never hand-copied. WORKSPACE_FALLBACK exists
  // precisely so a host outside the workspace cannot drift from the real
  // provider's surface, and the provider-shape rails already caught one
  // hand-copy in this project.
  const workspace = useMemo(() => ({
    ...WORKSPACE_FALLBACK,
    groupSyms, setGroupSym, groupTfs, setGroupTf,
    activeChartRef, activeWatchlistRef, chartApiById,
  }), [groupSyms, setGroupSym, groupTfs, setGroupTf])

  // The REAL ±6 neighbour warmer, driven by the visible list order — the same
  // call Theme Tracker and Watchlists make.
  useNeighborWarm(SYMS, groupSyms.A, TF)

  // Expose the controls the Playwright driver needs. Nothing here changes what
  // the product does; it only lets the driver ask questions and click rows.
  useEffect(() => {
    window.__scan = {
      tf: TF,
      symbols: SYMS,
      select: (s) => setGroupSyms(p => ({ ...p, A: s })),
      // ⛔⛔ MEASURE IN-PAGE, NOT BY POLLING OVER CDP. Driving samples from
      // Playwright costs a ~10-25ms round-trip each, so a dense burst covers
      // only the first ~200ms and then leaves a hole — which quantised the
      // first honest latency run (symbols resolving inside the gap were all
      // attributed to its far edge). This watches every animation frame and
      // records the EXACT instant the rendered ticker and the painted symbol
      // both reach the target, so the number is frame-accurate.
      watch: (target) => {
        const t0 = performance.now()
        const out = { target, t0, tCoherent: null, mixedMs: 0, emptyMs: 0, frames: 0 }
        let lastTs = t0
        const tick = () => {
          const now = performance.now()
          const dt = now - lastTs
          lastTs = now
          out.frames += 1
          const el = document.querySelector('[data-testid="sym-label"]')
          const dom = el ? (el.textContent || '').trim().split(/[\s(·]/)[0].toUpperCase() : null
          const rows = window.__uctChartTiming ? window.__uctChartTiming.report() : null
          let chart = null
          if (Array.isArray(rows)) {
            for (let i = rows.length - 1; i >= 0; i--) {
              if (rows[i]['T0→paint'] != null) { chart = String(rows[i].sym || '').toUpperCase(); break }
            }
          }
          if (dom && chart && dom !== chart) out.mixedMs += dt
          if (dom && chart === null) out.emptyMs += dt
          if (out.tCoherent == null && dom === target && chart === target) {
            out.tCoherent = Math.round(now - t0)
          }
          if (out.tCoherent == null && now - t0 < 4000) requestAnimationFrame(tick)
          else window.__scanWatch = out
        }
        requestAnimationFrame(tick)
        return true
      },
      watchResult: () => window.__scanWatch || null,

      // ── CAMERA ACCEPTANCE SURFACE ──────────────────────────────────────
      // ⛔ READ-ONLY + DRIVE-ONLY. Nothing here decides anything about the
      // view; it reads the chart's own probe and pushes the product's real
      // live-price path. A harness that moved the camera itself, or that had
      // its own idea of who owns the view, would be measuring itself.
      //
      // `visibleRange` comes from `window.__uctChartDebug`, the handle the
      // chart already publishes for rigs — not a new side channel.
      range: () => {
        const d = window.__uctChartDebug || {}
        const k = Object.keys(d)[0]
        try { return k ? d[k].visibleRange() : null } catch { return null }
      },
      // Drive the REAL live path: the store fetches /api/live-prices (which the
      // harness route-mocks) and StockChart's live writer mutates the current
      // bar exactly as it does in production.
      tick: () => { try { pollNow() } catch { /* store not registered yet */ } },
      // ⛔ THE RENDERED SERIES, not the store and not React state. §6: a probe
      // that measures the wrong layer can confirm a stimulus that never
      // reached the chart.
      // The member-visible camera: a TIME window. See visibleTimeRange's note.
      timeRange: () => {
        const d = window.__uctChartDebug || {}
        const k = Object.keys(d)[0]
        try { return k ? d[k].visibleTimeRange() : null } catch { return null }
      },
      rendered: () => {
        const d = window.__uctChartDebug || {}
        const k = Object.keys(d)[0]
        try { return k ? { bar: d[k].lastRenderedBar(), n: d[k].renderedBarCount() } : null }
        catch { return null }
      },
      // The boundary replay scores BAR N and BAR N+1 independently -- see the
      // renderedTail note in StockChart's debug handle.
      tail: (k) => {
        const d = window.__uctChartDebug || {}
        const key = Object.keys(d)[0]
        try { return key ? d[key].renderedTail(k || 2) : null } catch { return null }
      },
      // ⛔ WHICH LAYER IS STUCK? The rendered close froze at 104 while the
      // fixture kept serving prices. Reading the STORE alongside the RENDERED
      // series is the only way to tell "the feed stopped" from "the chart
      // stopped listening" — and guessing between those two is how this
      // project has repeatedly fixed the wrong layer.
      store: () => { try { return getSnapshot() } catch { return null } },
      camera: {
        enabled: () => cameraAuditEnabled(),
        report: () => cameraAuditReport(),
        clear: () => cameraAuditClear(),
        unauthorized: () => unauthorizedMoves(),
        owned: () => cameraAuditOwned(),
        tsOptions: (patch) => cameraTimeScaleOptions(patch),
      },
      // ⭐ THE NEGATIVE CONTROL (§5). Deliberately move the camera while the
      // user owns the view; the audit MUST flag it. A clean camera run is
      // meaningless until this has been shown to fail.
      forceIllegalMove: (kind) => forceIllegalCameraMove(kind),
      requested: () => groupSyms.A,
      readiness: (s) => readiness(s, TF),
      blocked: () => BLOCKED.slice(),
    }
  }, [groupSyms.A])

  return (
    <MemoryRouter>
      <AuthProvider>
      <WorkspaceContext.Provider value={workspace}>
        <div style={{ display: 'flex', height: '100vh' }}>
          <ul data-testid="scan-list" style={{ width: 120, overflow: 'auto', margin: 0, padding: 4, listStyle: 'none' }}>
            {SYMS.map(s => (
              <li key={s}>
                <button type="button" data-row={s} onClick={() => setGroupSyms(p => ({ ...p, A: s }))}
                  style={{ width: '100%', textAlign: 'left', background: groupSyms.A === s ? '#2a3f5f' : 'transparent', color: '#e6e8ec', border: 0, padding: '2px 4px', cursor: 'pointer' }}>
                  {s}
                </button>
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

// ⛔⛔ `?blank=1` MOUNTS NOTHING, AND IT IS NOT A CONVENIENCE. Seeding IndexedDB
// requires an `onupgradeneeded` that recreates the store, and a version change
// BLOCKS FOREVER while another connection to the same database is open. With
// the app mounted, the harness page itself holds that connection — so a driver
// that loads this page and then seeds hangs indefinitely with no error at all
// (measured: 30+ minutes, silent). The driver must seed on `?blank=1` FIRST and
// only then load the real page.
if (new URLSearchParams(location.search).get('blank') === '1') {
  document.getElementById('root').textContent = 'blank (seed here, then reload without ?blank=1)'
} else {
  createRoot(document.getElementById('root')).render(<Harness />)
}

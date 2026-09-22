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

createRoot(document.getElementById('root')).render(<Harness />)

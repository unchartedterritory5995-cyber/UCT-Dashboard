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
import { mergeChartSettings } from '../../components/chart/chartDefaults'
import * as registry from '../../components/chart/engine/nativeRegistry'
import { addInstance } from '../../components/chart/engine/instanceControls'

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
// `?studies=1` — the legend-handoff harness. Seeds THIS widget's own
// `opts.settings` (page state, never a preference) with the default moving
// averages + Volume, plus an own-pane RSI and a multi-output MACD, so every
// legend surface — Bar Info, the study stack, the volume strip and the pane
// readouts — is on screen at once. Added through the product's own writer.
const STUDIES = params.get('studies') === '1'
const seedSettings = () => {
  if (!STUDIES) return undefined
  let cs = mergeChartSettings(null)
  cs = addInstance(cs, 'rsi', registry)
  cs = addInstance(cs, 'macd', registry)
  return cs
}

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
  const [opts, setOpts] = useState(() => {
    const settings = seedSettings()
    return settings ? { tf: TF, settings } : { tf: TF }
  })
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

      // ── TYPED ENTER: THE MEMBER'S ACTUAL DOOR, NOT A SHORTCUT ─────────────
      // ⛔⛔ `select()` ABOVE IS THE LIST CLICK, AND IT IS NOT THIS. Both end at
      // `setGroupSym`, so a driver that called `select()` and labelled the number
      // "typed Enter" would be measuring the OTHER path and could never see a
      // difference even if one existed. This drives the REAL `SymbolSearch` in the
      // real `ChartIdentityRow`: open the label button, type into the real input,
      // dispatch a real Enter. Everything the product does between a keystroke and
      // `onSymbolChange` therefore happens, including the 150 ms discovery debounce
      // and the instant-lock row that is supposed to make Enter beat the network.
      typeEnter: async (target) => {
        // ⚠️ OPENING IS A REACT STATE CHANGE, NOT A DOM MUTATION. The first cut
        // clicked the label and queried for the input in the SAME tick; the input
        // does not exist yet, so every typed measurement reported "search input did
        // not open" and 0 requests -- no stimulus, which is not a slow path. Worse,
        // a failed attempt left the panel TOGGLED, so the next call closed it again
        // and the failures alternated. Poll for the input, and always start closed.
        const q = (sel) => document.querySelector(sel)
        const frame = () => new Promise(r => requestAnimationFrame(r))
        const findInput = () => q('input[placeholder*="Search symbol"]')
        for (let i = 0; i < 20 && findInput(); i++) {   // ensure CLOSED first
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
          await frame()
        }
        const label = q('[data-testid="sym-label"]')
        const btn = label?.closest('button') || label?.parentElement
        if (!btn) return { ok: false, why: 'no symbol label button' }
        btn.click()
        let input = null
        for (let i = 0; i < 60 && !input; i++) { await frame(); input = findInput() }
        if (!input) return { ok: false, why: 'search input did not open' }
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype, 'value').set
        setter.call(input, target)                       // React-visible value set
        input.dispatchEvent(new Event('input', { bubbles: true }))
        await frame()                                    // let the instant-lock row land
        const t0 = performance.now()
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        return { ok: true, t0 }
      },

      // ── THE WATERFALL, MEASURED FROM OUTSIDE THE PRODUCT ──────────────────
      // ⭐ NOTHING IS INSTRUMENTED INSIDE `useSymbolHandoff` OR `prepareForDisplay`.
      // The two instants that define the metric are already observable: the DOM
      // label IS the COMMITTED symbol (`ChartWidget` passes the handoff's output
      // down to `SymbolSearch`), and `__uctChartTiming` reports the PAINTED one. A
      // PerformanceObserver picks the network legs up for free. So the product runs
      // byte-for-byte as a member's does while being measured.
      //
      // TC is NOT "the label changed". It is the first frame where identity and
      // candles agree AND the painted series is current-enough/authoritative —
      // otherwise a fast commit onto stale candles would score as a win.
      watchFull: (target, t0) => {
        // ⛔⛔ CLEAR THE SLOT FIRST. The result is only published when the watcher
        // FINISHES, so a driver that waits for `__scanWatchFull` to be non-null was
        // handed the PREVIOUS switch's record instantly and every row was off by
        // one -- readiness said "memory/current" beside a latency actually measured
        // on a different, colder symbol. A stale result is worse than none.
        window.__scanWatchFull = null
        const start = (typeof t0 === 'number') ? t0 : performance.now()
        const out = {
          target, t0: start,
          tCommit: null, tCoherent: null,
          validOldMs: 0, validNewMs: 0,
          invalidMixedMs: 0, invalidEmptyMs: 0, invalidStaleMs: 0,
          frames: 0, net: [], terminal: null,
        }
        const seen = new Set()
        let lastTs = start
        const painted = () => {
          const rows = window.__uctChartTiming ? window.__uctChartTiming.report() : null
          if (!Array.isArray(rows)) return null
          for (let i = rows.length - 1; i >= 0; i--) {
            if (rows[i]['T0→paint'] != null) return String(rows[i].sym || '').toUpperCase()
          }
          return null
        }
        const tick = () => {
          const now = performance.now()
          const dt = now - lastTs; lastTs = now
          out.frames += 1
          const el = document.querySelector('[data-testid="sym-label"]')
          const dom = el ? (el.textContent || '').trim().split(/[\s(·]/)[0].toUpperCase() : null
          const chart = painted()
          if (out.tCommit == null && dom === target) out.tCommit = Math.round(now - start)

          // Frame classification (Phase 2). A genuine no-data / error panel is a
          // TERMINAL DEGRADED state, not an invalid empty frame — it is the chart
          // honestly saying so, which is the behaviour Problem B restored.
          const degraded = !!document.querySelector('[data-render-unavailable], [data-testid="chart-nodata"]')
          if (degraded && out.terminal == null) out.terminal = Math.round(now - start)
          if (dom && chart) {
            if (dom !== target && dom === chart) out.validOldMs += dt
            else if (dom === target && chart === target) out.validNewMs += dt
            else if (dom !== chart) out.invalidMixedMs += dt
          } else if (dom === target && !chart && !degraded) {
            out.invalidEmptyMs += dt
          }

          if (out.tCoherent == null && dom === target && chart === target) {
            const mem = window.__scan.memLast(target)
            const fresh = window.__scan.freshEnough(mem)
            if (fresh) out.tCoherent = Math.round(now - start)
            else out.invalidStaleMs += dt
          }
          for (const e of performance.getEntriesByType('resource')) {
            if (e.startTime < start || seen.has(e.name + e.startTime)) continue
            if (!/\/api\/(bars|ticker-search)/.test(e.name)) continue
            seen.add(e.name + e.startTime)
            out.net.push({ url: e.name.replace(/^https?:\/\/[^/]+/, ''),
                           start: Math.round(e.startTime - start),
                           dur: Math.round(e.duration) })
          }
          if (out.tCoherent == null && now - start < 15000) requestAnimationFrame(tick)
          else { out.total = Math.round(now - start); window.__scanWatchFull = out }
        }
        requestAnimationFrame(tick)
        return true
      },
      watchFullResult: () => window.__scanWatchFull || null,
      memLast: (s) => { const m = memPeek(s, TF); return m?.length ? m[m.length - 1]?.t : null },
      freshEnough: (lastT) => (typeof lastT === 'number') && isCurrentEnoughForPaint(lastT, TF),
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

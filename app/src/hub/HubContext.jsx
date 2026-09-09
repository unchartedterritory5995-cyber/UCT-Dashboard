// Joystick hub — HubProvider + useHub(): mode, shared cross-section state, lastSection.
// See docs/plans/joystick/00-master-spec-v1.3.md §2b (streaming), §2e (adaptability), §4 (Phase 1), Part C (home — lastSection).
//
// ⛔ NOT MOUNTED YET — PHASE 1 SHIPS THIS UNWIRED, DELIBERATELY.
// Today the only thing that imports this file is its own test (or another
// equally unmounted hub module). It is reached from NO route. Phase 2 wires it:
// `HubProvider` goes around `<main>` in `Layout.jsx`, and the section
// integrators call `useHubMode` / `useHubCursor` from their pages.
//
// It is recorded here rather than left to be discovered because this repo has
// been bitten by the opposite: an agent read a green test file as the precedent
// for its own work before noticing the page it tested reached no route. A test
// is not a door. Until Phase 2, treat this module as a design, not a feature —
// and if Phase 2 is cancelled, DELETE these files rather than leaving them
// looking shipped.

import { createContext, useContext, useState, useCallback, useMemo, useRef, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import useRealtimePrices from '../hooks/useRealtimePrices'
import { modesById } from './registry'
import { routeToModeId, isSectionRoute } from './hubRoutes'

/**
 * @typedef {Object} HubContextValue
 * @property {string|null} mode                     Current hub mode id.
 * @property {(id: string) => void} setMode          Manual override (e.g. Catalysts activating
 *                                                    in-place on /dashboard). A real navigation
 *                                                    always wins over a manual choice.
 * @property {import('./registry').HubMode|null} activeModeConfig
 *   The config the gesture engine should read: a page's own `useHubMode`
 *   registration if one is mounted, else the registry's route-derived default.
 * @property {(config: import('./registry').HubMode) => () => void} registerHubMode
 *   Registers a page's mode config; returns an unregister function. `useHubMode.js`
 *   is the only intended caller.
 * @property {string|null} symbol
 * @property {(sym: string|null) => void} setSymbol
 * @property {string|null} timeframe
 * @property {(tf: string|null) => void} setTimeframe
 * @property {*} activeScan
 * @property {(scan: *) => void} setActiveScan
 * @property {*} selectedPosition
 * @property {(position: *) => void} setSelectedPosition
 * @property {{current: *}} chartRef   A plain ref other code can populate. The hub
 *                                     never constructs a chart itself.
 * @property {*} livePrice     The pooled-stream/REST-merged price row for `symbol`,
 *                             or null when there is no shared symbol (or nothing
 *                             has arrived yet). Subscribe-only — see below.
 * @property {boolean} isStreaming
 * @property {string|null} lastSection   The most recently visited SECTION mode id
 *                                       (never `home`), persisted across reloads.
 */

// Safe default so useHub() never explodes when called outside a provider (mirrors
// TickerHubContext's no-op-default pattern, `components/mobile/TickerHubContext.jsx`)
// — everything reads as inert, nothing throws.
/** @type {import('react').Context<HubContextValue>} */
const HubContext = createContext({
  mode: null,
  setMode: () => {},
  activeModeConfig: null,
  registerHubMode: () => () => {},
  symbol: null,
  setSymbol: () => {},
  timeframe: null,
  setTimeframe: () => {},
  activeScan: null,
  setActiveScan: () => {},
  selectedPosition: null,
  setSelectedPosition: () => {},
  chartRef: { current: null },
  livePrice: null,
  isStreaming: false,
  lastSection: null,
})

const LAST_SECTION_STORAGE_KEY = 'hub.lastSection'

function readLastSection() {
  try {
    return localStorage.getItem(LAST_SECTION_STORAGE_KEY)
  } catch {
    return null // private mode / storage disabled — "no last section" is a fine fallback
  }
}

function writeLastSection(sectionId) {
  try {
    localStorage.setItem(LAST_SECTION_STORAGE_KEY, sectionId)
  } catch {
    // Storage can throw (private mode, quota). Losing "last section" is cosmetic —
    // never worth surfacing an error over.
  }
}

export function HubProvider({ children }) {
  const { pathname } = useLocation()

  // ── mode + lastSection, reconciled DURING RENDER on a pathname change ────
  // This mirrors the "adjusting state when a prop changes" pattern React
  // itself documents (and the one `BreadthViews.jsx`'s cursor-seek reconciler
  // already uses in this repo) rather than an effect: both `mode` and
  // `lastSection` are values PURELY DERIVED from `pathname` (with `mode` also
  // accepting a manual override — see below), so mirroring `pathname` into
  // state inside a `useEffect` would call `setState` synchronously in an
  // effect body, which is exactly what `react-hooks/set-state-in-effect`
  // flags — and flags correctly here, since no external system is involved.
  // `prevPathname` seeded to `null` (never a real pathname) guarantees the
  // block below also runs on the very first render, so a session's first
  // load — even landing directly on a section route — seeds `lastSection`
  // immediately rather than waiting for the first navigation.
  const [prevPathname, setPrevPathname] = useState(null)

  // Seeded to null; the render-time block corrects it before the first
  // commit (React discards a render that calls setState and immediately
  // retries), so there is no flash of an uninitialized mode.
  const [mode, setMode] = useState(null)

  // Part C, home mode: "Last-used section defined."
  const [lastSection, setLastSection] = useState(readLastSection)

  if (pathname !== prevPathname) {
    setPrevPathname(pathname)

    const derivedMode = routeToModeId(pathname)
    if (derivedMode != null) setMode(derivedMode)
    // A route hubRoutes doesn't recognize (derivedMode === null, e.g. /settings)
    // leaves `mode` exactly as it was — there is no better route-derived answer,
    // so the hub keeps showing whatever section was last active.

    // Gated by hubRoutes' OWN section test — /dashboard is deliberately excluded
    // (recording it would make Home's "last section" Primary a no-op the instant
    // it's tapped).
    if (isSectionRoute(pathname)) setLastSection(derivedMode)
  }

  // The ONLY genuine external-system side effect here: persisting `lastSection`
  // to localStorage so it survives a reload. This effect never calls
  // `setState`, so it can't trip `react-hooks/set-state-in-effect` — it just
  // mirrors React state OUT to storage, the direction effects are for.
  useEffect(() => {
    if (lastSection != null) writeLastSection(lastSection)
  }, [lastSection])

  // ── per-page mode override (`useHubMode`) ─────────────────────────────────
  // The currently-mounted page's own tap/double-tap/scrub/fan, or null when no
  // page has called useHubMode — in which case the route-derived registry
  // default below applies. `useHubMode.js` is the only intended caller of
  // `registerHubMode`.
  const [pageModeConfig, setPageModeConfig] = useState(null)
  const registerHubMode = useCallback((config) => {
    setPageModeConfig(config)
    return () => {
      // Identity guard: only clear the slot if WE are still the registered
      // config. A fast unmount/remount (or a stale cleanup racing a newer
      // registration) must never clobber a page that already took over —
      // the same shape as the bucket-teardown identity guards in
      // `priceStreamManager.js` / `useRealtimePrices.js`.
      setPageModeConfig((current) => (current === config ? null : current))
    }
  }, [])

  // The config the gesture engine (Phase 2) and section controllers (Phase 3)
  // should actually read: a page's own registration wins; otherwise the
  // registry's route-derived default for the current mode. This is computed
  // ONCE, here, so nothing downstream re-derives the same fallback rule.
  const activeModeConfig = pageModeConfig ?? modesById[mode] ?? null

  // ── shared cross-section values (spec §4 / Part C4) ───────────────────────
  const [symbol, setSymbol] = useState(null)
  const [timeframe, setTimeframe] = useState(null)
  const [activeScan, setActiveScan] = useState(null)
  const [selectedPosition, setSelectedPosition] = useState(null)

  // A plain ref other code can populate. The hub never constructs a chart —
  // it only ever reads whatever a chart-owning component chose to stash here.
  const chartRef = useRef(null)

  // ── stream subscription — SUBSCRIBE ONLY, never a REST call for a live price ──
  // Reuses the pooled SSE hook verbatim (spec §2b): `useRealtimePrices` already
  // merges the shared browser-wide stream (`lib/priceStreamManager.js`) with the
  // existing 2s REST poll for session OHLC/volume, so this adds no new
  // connection and no new fetch — subscribing to an already-streaming symbol is
  // free. It tracks ONLY the shared `symbol`; a section that needs a whole LIST
  // subscribed (Journal's open positions, Screener's visible rows) calls
  // `useRealtimePrices` itself with its own list — the hub does not proxy that.
  const symbolList = useMemo(() => (symbol ? [symbol] : []), [symbol])
  const { prices: symbolPrices, isStreaming } = useRealtimePrices(symbolList)
  const livePrice = symbol ? symbolPrices[symbol] ?? null : null

  const value = useMemo(() => ({
    mode,
    setMode,
    activeModeConfig,
    registerHubMode,
    symbol,
    setSymbol,
    timeframe,
    setTimeframe,
    activeScan,
    setActiveScan,
    selectedPosition,
    setSelectedPosition,
    chartRef,
    livePrice,
    isStreaming,
    lastSection,
  }), [
    mode, activeModeConfig, registerHubMode, symbol, timeframe, activeScan,
    selectedPosition, livePrice, isStreaming, lastSection,
  ])

  return <HubContext.Provider value={value}>{children}</HubContext.Provider>
}

export function useHub() {
  return useContext(HubContext)
}

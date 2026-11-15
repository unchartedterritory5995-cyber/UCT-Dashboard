// app/src/components/chart/restedReaders.js
//
// ─── THE CHART'S PER-SYMBOL READS, BEHIND THE REST GATE ──────────────────────
//
// A chart reads small things keyed by its symbol through hooks the rest of the app uses too
// (name and sector, the listing date, delisted, the leveraged family, the header snapshot,
// and the header's optional fields: N-day change, theme, average volume and IPO date, the
// volume curve). On a chart the symbol can change several times a second; everywhere else it
// does not. So the gate (`lib/symbolPace.js`: a symbol the member is racing past is not
// asked for, the one they stop on is) is applied HERE, at the chart's own call sites, and
// the hooks themselves stay ordinary reads that import nothing from it.
//
// Each wrapper is the hook with ONE thing added: `isPaused` from the gate of that hook's own
// key. What the browser already holds is still returned on the first render.
//
// ⛔ EVERY CHART READER OF A KEY GOES THROUGH HERE. SWR pauses per reader: one reader of a
// key left on the bare hook would ask for every symbol passed, and the gate on the others
// would stop nothing (the name and sector are read by the pane AND by the chart; the
// leveraged family by the widget AND by its control).
import { useRestGate } from '../../lib/symbolPace'
import useTickerMeta from '../../hooks/useTickerMeta'
import { tickerMetaKey } from '../../hooks/tickerMetaKey'
import useTickerIpo from '../../hooks/useTickerIpo'
import { tickerIpoKey } from '../../hooks/tickerIpoKey'
import useDelisted from '../../hooks/useDelisted'
import { delistedKey } from '../../hooks/delistedKey'
import useSingleStockEtfs from '../../hooks/useSingleStockEtfs'
import { singleStockEtfsKey } from '../../hooks/singleStockEtfsKey'
import useFundamentalSnapshot from '../../hooks/useFundamentalSnapshot'
import { snapshotKey } from '../../hooks/fundamentalSnapshotKey'
import useWatchlistPerformance from '../../hooks/useWatchlistPerformance'
import { watchlistPerformanceKey } from '../../hooks/watchlistPerformanceKey'
import useWatchlistThemes from '../../hooks/useWatchlistThemes'
import { watchlistThemesKey } from '../../hooks/watchlistThemesKey'
import useWatchlistMeta from '../../hooks/useWatchlistMeta'
import { snapshotBatchKey } from '../../hooks/watchlistMetaKey'
import useVolumeCurve from '../../hooks/useVolumeCurve'
import { volumeCurveKey } from '../../hooks/volumeCurveKey'

/** Name, sector, industry, theme, exchange (`useTickerMeta`). */
export function useChartTickerMeta(sym) {
  return useTickerMeta(sym, useRestGate(tickerMetaKey(sym)))
}

/** The listing date (`useTickerIpo`). */
export function useChartTickerIpo(sym) {
  return useTickerIpo(sym, useRestGate(tickerIpoKey(sym)))
}

/** The delisted record, or null (`useDelisted`). */
export function useChartDelisted(sym) {
  return useDelisted(sym, useRestGate(delistedKey(sym)))
}

/** The leveraged / inverse family (`useSingleStockEtfs`). */
export function useChartSingleStockEtfs(sym) {
  return useSingleStockEtfs(sym, useRestGate(singleStockEtfsKey(sym)))
}

/** The header's rating, market cap and next earnings (`useFundamentalSnapshot`). */
export function useChartSnapshot(sym, enabled = true) {
  return useFundamentalSnapshot(sym, enabled, useRestGate(enabled ? snapshotKey(sym) : null))
}

// ── the header's OPTIONAL fields (each read only while a field that needs it is shown) ──────
// The chart passes each of these hooks the one symbol on screen (or none). The gate follows
// the key the hook itself asks under for that list.

/** N-day change (`useWatchlistPerformance`). */
export function useChartPerformance(tickers) {
  return useWatchlistPerformance(tickers, useRestGate(watchlistPerformanceKey(tickers)))
}

/** The primary theme (`useWatchlistThemes`). */
export function useChartThemes(tickers) {
  return useWatchlistThemes(tickers, useRestGate(watchlistThemesKey(tickers)))
}

/** Average volume, IPO date and the snapshot's own fields (`useWatchlistMeta`, its per-symbol read). */
export function useChartMeta(tickers) {
  return useWatchlistMeta(tickers, useRestGate(snapshotBatchKey([...new Set(tickers)].sort())))
}

/** The time-of-day volume curve (`useVolumeCurve`). */
export function useChartVolumeCurve(enabled, tickers) {
  return useVolumeCurve(enabled, tickers, useRestGate(enabled ? volumeCurveKey(tickers) : null))
}

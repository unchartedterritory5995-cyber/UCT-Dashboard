// app/src/components/chart/restedReaders.js
//
// ─── THE CHART'S PER-SYMBOL READS, BEHIND THE REST GATE ──────────────────────
//
// A chart reads five small things keyed by its symbol through hooks the rest of the app
// uses too (name and sector, the listing date, delisted, the leveraged family, the header
// snapshot). On a chart the symbol can change several times a second; everywhere else it
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

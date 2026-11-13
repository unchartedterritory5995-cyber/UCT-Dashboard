// The chart header's fundamentals (rating, market cap, next earnings): the same read as the
// snapshot card (`useFundamentalSnapshot`), plus one thing only a chart needs. While a header
// shows these values, the rows a member is about to reach have theirs asked for ahead
// (lib/symbolResourceWarm.js), so the values arrive with the candles on a list scan instead of
// 240 to 540 ms after them (measured on production 2026-11-12).
//
// It lives beside the chart, not in the hook: the snapshot hook is read on pages that load no
// chart, and they should not carry the warmer.
import useFundamentalSnapshot from '../../../hooks/useFundamentalSnapshot'
import { snapshotKey, snapshotFetcher } from '../../../hooks/fundamentalSnapshotKey'
import { useSymbolResource } from '../../../lib/symbolResourceWarm'

export default function useHeaderSnapshot(sym, enabled) {
  useSymbolResource(enabled ? snapshotKey : null, snapshotFetcher)
  return useFundamentalSnapshot(sym, enabled)
}

import { useMemo } from 'react'
import ChartPane from '../../../../components/chart/pane/ChartPane'

// A ts param (epoch seconds or 'YYYY-MM-DD') → the ET SESSION day the cutoff
// speaks. ⛔ Never toISOString(): UTC flips to the next calendar day at
// 8:00 PM ET, so an evening capture would stamp TOMORROW as the cutoff and
// the "frozen" snapshot would include a full session that printed after the
// user wrote the entry (review finding). en-CA locale renders YYYY-MM-DD.
export function tsToAnchorDay(v) {
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10)
  if (typeof v === 'number' && Number.isFinite(v)) {
    const ms = v > 10_000_000_000 ? v : v * 1000
    const d = new Date(ms)
    if (Number.isNaN(d.getTime())) return null
    try {
      return d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
    } catch {
      return d.toISOString().slice(0, 10)
    }
  }
  return null
}

const noopStore = () => {}

/**
 * The chart's journal-embed renderer: ChartPane with FROZEN params.
 *
 * - Symbol is LOCKED (no onSymbolChange) and the TF bar is omitted entirely
 *   (showTfBar={false}) — scroll/zoom inside the embed never writes anything;
 *   param changes arrive only through explicit embed-toolbar actions.
 * - `stored` is the fully-merged settings blob frozen at capture; onStore is
 *   a NO-OP so StockChart's internal writes are swallowed rather than landing
 *   on the reader's global chart_settings (the read-only invariant).
 * - liveUpdates only in mode:'live' (badged, capped); snapshots never
 *   subscribe to anything.
 */
export default function ChartEmbed({ attrs, height = 320 }) {
  const params = attrs?.params || {}
  const anchorDay = tsToAnchorDay(params.to)
  const live = attrs?.mode === 'live'
  const stockChartProps = useMemo(() => ({
    height: '100%',
    liveUpdates: live,
    showDrawingTools: false,
    // The 3M/6M/YTD range-selector pills float mid-frame at embed sizes and
    // collide with the legend (owner feedback with screenshots) — an embed's
    // window is its FROZEN range anyway, so the selector has no job here.
    showRangeSelector: false,
    // ⭐ SNAPSHOTS USE replayCutoff, NOT anchorDate. anchorDate is view-only
    // framing — it never changes WHAT is fetched, so an old snapshot would
    // fetch a today-ending window, the anchor bar wouldn't be in it, and the
    // embed would silently show today's chart. replayCutoff is the prop that
    // sends `?to=` (reaching the server's cold-miss deep-fetch) AND hides
    // post-cutoff bars — actual frozen-evidence semantics. Live embeds track
    // now and take no cutoff. ("What happened next" later = swap this for
    // anchorDate on demand.)
    // ⛔ NO onBarsReady empty-check here: StockChart invokes it with ZERO
    // arguments (contract '() => void'), so an arg-inspecting callback fires
    // unconditionally and permanently pins archived embeds to their PNG
    // (review finding on the first cut). An empty cutoff window rendering an
    // empty chart is the accepted residual until a real emptiness signal
    // exists.
    ...(!live && anchorDay ? { replayCutoff: anchorDay } : {}),
  }), [live, anchorDay])

  return (
    <div style={{ height }}>
      <ChartPane
        sym={params.symbol}
        tf={params.tf || 'D'}
        density="mini"
        showTfBar={false}
        stored={params.settings || null}
        onStore={noopStore}
        stockChartProps={stockChartProps}
      />
    </div>
  )
}

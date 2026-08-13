import { useCallback, useMemo, useRef } from 'react'
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
export default function ChartEmbed({
  attrs, height = 320, annotate = false, onAnnotationsChange = null, onBarsReady = null,
  // Linked crosshair (spec Phase 6 #6): the per-note bus every chart embed
  // shares. StockChart owns both halves already — onCrosshairMove publishes,
  // subscribeCrosshair applies payloads imperatively with echo suppression
  // and ET-day mapping across timeframes (the exact /charts wire).
  crosshairBus = null,
  // "What happened next" (spec Phase 6 #2): VIEW-ONLY — swap the frozen
  // cutoff for anchorDate framing, so the window shows the anchor day plus
  // everything since. Never persisted; the toolbar toggle owns it.
  peekToNow = false,
}) {
  const params = attrs?.params || {}
  const anchorDay = tsToAnchorDay(params.to)
  const live = attrs?.mode === 'live'
  const annotations = Array.isArray(attrs?.annotations) ? attrs.annotations : []
  // Stable per-embed id so an embed ignores its own broadcasts (the
  // ChartWidget idiom — the bus is deliberately NOT React state).
  const embedIdRef = useRef(null)
  if (!embedIdRef.current) embedIdRef.current = `je${Math.random().toString(36).slice(2, 9)}`
  const reportCrosshair = useCallback((payload) => {
    crosshairBus?.emit(embedIdRef.current, payload)
  }, [crosshairBus])
  const subscribeCrosshair = useCallback((cb) => {
    if (!crosshairBus) return () => {}
    return crosshairBus.subscribe(({ sourceId, payload }) => {
      if (sourceId !== embedIdRef.current) cb(payload)
    })
  }, [crosshairBus])
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
    // onBarsReady is a ZERO-ARG ready signal (contract '() => void') — the
    // self-archive uses it to avoid rasterizing a still-painting chart.
    // ⛔ It carries NO data: an arg-inspecting callback fires unconditionally
    // and permanently pins archived embeds to their PNG (review finding on
    // the first cut). An empty cutoff window rendering an empty chart is the
    // accepted residual until a real emptiness signal exists.
    ...(onBarsReady ? { onBarsReady } : {}),
    // peekToNow swaps the cutoff for anchorDate: same anchor day FRAMED, but
    // the fetch runs to now — the aftermath, exactly as the design note below
    // promised ("swap this for anchorDate on demand").
    ...(!live && anchorDay
      ? (peekToNow ? { anchorDate: anchorDay } : { replayCutoff: anchorDay })
      : {}),
    ...(crosshairBus ? { onCrosshairMove: reportCrosshair, subscribeCrosshair } : {}),
    // ── Per-embed annotations (owner spec Phase 6 #1) ─────────────────────
    // StockChart's CONTROLLED annotation layer (the Model Book authoring
    // system): drawings render from the embed node's own attrs and edits
    // bubble back via onAnnotationsChange — no localStorage, no global
    // per-symbol drawing store, so marks on a journal snapshot can never
    // bleed onto /charts (or vice versa). annotate=true adds the full
    // drawing toolbar (lines, text, color/width, clear).
    annotations,
    annotationsVisible: true,
    // ⛔ Without this, TEXT marks render at opacity 0 on every fresh mount:
    // the overlay's textFadeRef starts at 0 and is normally driven by the
    // Model Book focus-zoom. annotationsTextVisible=true is the designed
    // no-zoom door (Setup Library uses it): snaps the fade to 1 on mount.
    // (Authoring masked this — editing paths bypass the fade — so drawn text
    // vanished only on the NEXT open. Live-audit finding.)
    annotationsTextVisible: true,
    annotationsEditable: !!annotate,
    ...(onAnnotationsChange ? { onAnnotationsChange } : {}),
  }), [live, anchorDay, annotations, annotate, onAnnotationsChange, onBarsReady,
    peekToNow, crosshairBus, reportCrosshair, subscribeCrosshair])

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

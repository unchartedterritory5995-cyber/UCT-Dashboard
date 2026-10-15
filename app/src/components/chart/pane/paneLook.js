// THE MEMBER'S CHART LOOK — the StockChart props that make a chart render the way the
// member's own /charts Chart widget does. ONE authority, read by ChartPane (every
// /charts widget, tab and popup) and by any surface that draws "your chart" without
// the pane's chrome (the Screener Focus layout). Two copies of this list drifted the
// day the Focus pane was built: it hard-coded its own candle/volume/scale props and
// ignored the member's canvas, watermark and /charts theme.
//
// Only what decides how the chart LOOKS lives here. What a surface lets you DO with
// it (drawing tools, hotkeys, replay, view locks, range selector) stays with the host.

// The reference look = the Model Book "Throughout the Years" main chart, 1:1.
// boldCandles brings the crisp bold vivid palette, thin curved MAs and vivid volume
// bars; volumeMa + markVolumeExtremes add the volume MA line + gold highest-volume
// bar. userCandleColors / userCanvas hand the candles and the canvas (background,
// grid, crosshair, text) to the member's chart settings. Plus a ~6-month daily
// window, its own compact volume pane, and tight price-scale margins so candles fill
// ~85% of the pane. hideJournalOverlay: a charting surface is not a journal.
export const PANE_LOOK = Object.freeze({
  boldCandles: true,
  userCandleColors: true,
  userCanvas: true,
  colorByNetChange: true,
  candlesOnTop: true,
  ema9MatchCandle: true,
  markVolumeExtremes: true,
  volumeLastValue: true,
  volumeMa: 50,
  hidePriceLine: true,
  hideJournalOverlay: true,
  centerWatermarkOnPlot: true,
  verticalLegend: true,
  alwaysShowLegend: true,
  rightPadBars: 6,
  dailyDefaultBars: 126,
  volumeSeparatePane: true,
  priceScaleTopMargin: 0.12,
  priceScaleBottomMargin: 0.10,
})

// The /charts theme toggle ('default' | 'sunrise') as StockChart's canvasTheme.
export const paneCanvasTheme = theme => (theme === 'sunrise' ? 'sunrise' : null)

// Watermark opacity is user-controllable via Chart Settings → Canvas. The settings
// default (0.07, the global faint default) is treated as "unset" → the pane's strong
// 0.82; any value the user picks wins.
export const paneWatermarkOpacity = cs => (cs?.watermark?.opacity === 0.07 ? 0.82 : cs?.watermark?.opacity)

// Volume-pane height persists per user across every chart surface (default 12%).
export function paneVolumePct(prefs) {
  const v = Number(prefs?.charts_vol_pane_pct)
  return Number.isFinite(v) && v >= 5 && v <= 60 ? v : 12
}

// Every settings- and theme-driven prop, given the resolved settings (`cs`), the
// resolved /charts theme and the member's prefs.
export function paneLookProps({ cs, theme, prefs }) {
  return {
    ...PANE_LOOK,
    canvasTheme: paneCanvasTheme(theme),
    watermarkOpacity: paneWatermarkOpacity(cs),
    // Per-item header colour override (Chart Settings → Header → Show).
    legendColor: cs?.header?.colors?.legend || null,
    volumePaneHeightPct: paneVolumePct(prefs),
  }
}

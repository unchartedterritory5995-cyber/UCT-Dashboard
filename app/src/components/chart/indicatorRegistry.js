// Indicator descriptors — the data behind the Chart Settings "Indicators" tab.
//
// WHY A REGISTRY: the indicator list is currently enumerated in seven places
// (chartDefaults, mergeChartSettings, StockChart's indicatorData memo, its render
// block, paneMargins' stacking order, ChartToolbar's JSX, and OSC_OPTS). Adding one
// means editing all of them. This file is the first step of collapsing that: the
// Indicators tab renders ENTIRELY from these descriptors, so a future "add indicator"
// button is a data change here rather than another block of hand-written JSX.
//
// SCOPE TODAY: moving-average overlays + the volume pane. The 13 oscillators still
// live in the old flat `indicators` map and keep their ChartToolbar UI; folding them
// in is the next step and wants the generic renderer to land first.
//
// FIELD TYPES the tab knows how to render:
//   select  — options: [[value, label], …]
//   number  — min / max / step
//   color   — opens the shared ColorPanel (supports opacity)
//   toggle  — boolean
// A field marked `disabled: '<reason>'` renders greyed with the reason as a title.
// That is deliberate: `offset` and `plotStyle` are in the schema but not yet honored
// by the renderer (both need series-level work in StockChart — offset re-keys every
// data point; plotStyle swaps the LWC series type). Showing them inert is honest;
// showing them live would silently do nothing.

export const MA_TYPES = [['SMA', 'Simple'], ['EMA', 'Exponential']]
export const LINE_STYLES = [['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted']]
export const LINE_WIDTHS = [[1, '1px'], [2, '2px'], [3, '3px'], [4, '4px']]
export const PLOT_STYLES = [['line', 'Line'], ['histogram', 'Histogram'], ['area', 'Area']]

const NOT_WIRED = 'Coming soon — needs renderer support'

/** Reason shown on the volume-pane controls when the SURFACE owns that layout.
 *  The charts workspace + the multi-chart grid hand StockChart `volumeSeparatePane`
 *  and `volumePaneHeightPct`, and those props WIN: StockChart ORs the flag
 *  (`volumeSeparatePane || cs.volume.separatePane`) and prefers the prop for the
 *  height (`volumePaneHeightPct ?? cs.volume.paneHeightPct`). The forcing is
 *  deliberate — the workspace's price-scale margins are tuned for a chart whose
 *  volume sits in its own pane, and its height is set by DRAGGING the separator
 *  (persisted to the `charts_vol_pane_pct` pref), not by this slider. So the saved
 *  prefs are inert there, and the UI says so. Same honesty rule as NOT_WIRED
 *  above: showing a control inert beats showing it live doing nothing. */
export const VOLUME_PANE_SURFACE_FIXED = "Fixed by this chart's layout"

/** Fields for one moving-average overlay. */
export const MA_FIELDS = [
  { key: 'type',      label: 'Average type', type: 'select', options: MA_TYPES },
  { key: 'color',     label: 'Color',        type: 'color' },
  { key: 'period',    label: 'Period',       type: 'number', min: 1, max: 400, step: 1 },
  { key: 'offset',    label: 'Offset',       type: 'number', min: -100, max: 100, step: 1, disabled: NOT_WIRED },
  { key: 'plotStyle', label: 'Plot style',   type: 'select', options: PLOT_STYLES, disabled: NOT_WIRED },
  { key: 'lineStyle', label: 'Line style',   type: 'select', options: LINE_STYLES },
  { key: 'lineWidth', label: 'Line width',   type: 'select', options: LINE_WIDTHS },
]

/** Bar styles for the volume pane. 'columns' = the built-in full-slot histogram
 *  (bars touch, the long-standing look); 'histogram' = thin bars with a visible
 *  gap between each (TC2000-style, drawn by the ThinVolumeSeries custom series). */
export const VOLUME_BAR_STYLES = [['columns', 'Columns'], ['histogram', 'Histogram']]

/** Fields for the volume pane. */
export const VOLUME_FIELDS = [
  { key: 'barStyle',     label: 'Bar style',    type: 'select', options: VOLUME_BAR_STYLES },
  { key: 'upColor',      label: 'Up bars',      type: 'color' },
  { key: 'downColor',    label: 'Down bars',    type: 'color' },
  { key: 'separatePane', label: 'Separate pane', type: 'toggle' },
  { key: 'hvcEnabled',   label: 'Highlight 52W volume highs', type: 'toggle' },
  // Visibility only — the label's COLOR is not user-editable; it tracks the range
  // buttons above it (--chart-panel-text-low) so the two always match.
  { key: 'labelVisible', label: 'Show $ Vol / Avg label', type: 'toggle' },
  { key: 'maPeriod',     label: 'Volume MA period', type: 'number', min: 0, max: 200, step: 1 },
  { key: 'maColor',      label: 'Volume MA color',  type: 'color',  showIf: (v) => Number(v.maPeriod) > 0 },
  { key: 'maLineWidth',  label: 'Volume MA width',  type: 'select', options: LINE_WIDTHS, showIf: (v) => Number(v.maPeriod) > 0 },
]

/** Fields for session VWAP.
 *  Opacity is its OWN key here rather than alpha baked into an 8-digit hex (the
 *  moving-average convention): VWAP's color is also driven by `vwapOverride` from
 *  the Model Book intraday popup, and a plain hex there must not silently lose the
 *  user's opacity. StockChart composes color × opacity into an rgba() at apply time. */
export const VWAP_FIELDS = [
  { key: 'color',     label: 'Color',      type: 'color' },
  { key: 'opacity',   label: 'Opacity %',  type: 'number', min: 5, max: 100, step: 5 },
  { key: 'lineStyle', label: 'Line style', type: 'select', options: LINE_STYLES },
  { key: 'lineWidth', label: 'Line width', type: 'select', options: LINE_WIDTHS },
]

/** The indicators the tab lists, in display order.
 *  `path` tells the tab where the values live in the settings blob:
 *    { kind: 'overlay', index }    → settings.overlays[index]
 *    { kind: 'section', key }      → settings[key]
 *    { kind: 'indicator', key }    → settings.indicators[key]
 *
 *  `opts.volumePaneFixed` — a reason string when the calling SURFACE fixes the
 *  volume layout itself (see VOLUME_PANE_SURFACE_FIXED). It marks the separate-pane
 *  toggle inert instead of letting it look live. VOLUME_FIELDS is a shared module
 *  constant, so the flag is applied to a COPY, never mutated in place.
 */
export function listIndicators(settings, opts = {}) {
  const overlays = Array.isArray(settings?.overlays) ? settings.overlays : []
  const rows = overlays.map((ov, index) => ({
    id: `overlay-${index}`,
    // Label reads as the chart legend does — "EMA 9", "SMA 200".
    label: `${ov?.type || 'SMA'} ${ov?.period ?? ''}`.trim(),
    group: 'Moving averages',
    fields: MA_FIELDS,
    path: { kind: 'overlay', index },
    values: ov || {},
    canToggle: true,
  }))
  rows.push({
    id: 'volume',
    label: 'Volume',
    group: 'Volume',
    fields: opts.volumePaneFixed
      ? VOLUME_FIELDS.map(f => (f.key === 'separatePane' ? { ...f, disabled: opts.volumePaneFixed } : f))
      : VOLUME_FIELDS,
    path: { kind: 'section', key: 'volume' },
    values: settings?.volume || {},
    canToggle: true,
    enabledKey: 'visible',   // volume uses `visible`, overlays use `enabled`
  })
  rows.push({
    id: 'vwap',
    // Intraday-only by construction — StockChart's VWAP_TFS gates it to 1/5/15/30/60,
    // so the label says so rather than letting a daily chart look broken when it's on.
    label: 'VWAP (intraday only)',
    group: 'VWAP',
    fields: VWAP_FIELDS,
    path: { kind: 'indicator', key: 'vwap' },
    values: settings?.indicators?.vwap || {},
    canToggle: true,
  })
  return rows
}

/** Read/write helper so the tab never hardcodes a settings path. */
export function readEnabled(row) {
  const key = row.enabledKey || 'enabled'
  return row.values?.[key] !== false
}

export function patchFor(row, patch, settings) {
  if (row.path.kind === 'overlay') {
    const next = (settings.overlays || []).map((o, i) => (i === row.path.index ? { ...o, ...patch } : o))
    return { overlays: next }
  }
  // Two levels deep — the flat `indicators` map. Merged rather than replaced so a
  // patch of one field can't drop the other indicators or the rest of this one's keys.
  if (row.path.kind === 'indicator') {
    return {
      indicators: {
        ...(settings.indicators || {}),
        [row.path.key]: { ...(settings.indicators?.[row.path.key] || {}), ...patch },
      },
    }
  }
  return { [row.path.key]: { ...(settings[row.path.key] || {}), ...patch } }
}

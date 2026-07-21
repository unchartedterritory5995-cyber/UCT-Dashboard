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

/** Fields for the volume pane. */
export const VOLUME_FIELDS = [
  { key: 'plotStyle',    label: 'Plot style',   type: 'select', options: PLOT_STYLES, disabled: NOT_WIRED },
  { key: 'upColor',      label: 'Up bars',      type: 'color' },
  { key: 'downColor',    label: 'Down bars',    type: 'color' },
  { key: 'separatePane', label: 'Separate pane', type: 'toggle' },
  { key: 'hvcEnabled',   label: 'Highlight 52W volume highs', type: 'toggle' },
  { key: 'labelVisible', label: 'Show $ Vol / Avg label', type: 'toggle' },
  { key: 'labelColor',   label: 'Label color',  type: 'color', showIf: (v) => v.labelVisible !== false },
  { key: 'maPeriod',     label: 'Volume MA period', type: 'number', min: 0, max: 200, step: 1 },
  { key: 'maColor',      label: 'Volume MA color',  type: 'color',  showIf: (v) => Number(v.maPeriod) > 0 },
  { key: 'maLineWidth',  label: 'Volume MA width',  type: 'select', options: LINE_WIDTHS, showIf: (v) => Number(v.maPeriod) > 0 },
]

/** The indicators the tab lists, in display order.
 *  `path` tells the tab where the values live in the settings blob:
 *    { kind: 'overlay', index }  → settings.overlays[index]
 *    { kind: 'section', key }    → settings[key]
 */
export function listIndicators(settings) {
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
    fields: VOLUME_FIELDS,
    path: { kind: 'section', key: 'volume' },
    values: settings?.volume || {},
    canToggle: true,
    enabledKey: 'visible',   // volume uses `visible`, overlays use `enabled`
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
  return { [row.path.key]: { ...(settings[row.path.key] || {}), ...patch } }
}

// ── "SAVE AS DEFAULT": what a drawing's menu row saves, and how it lands in cs.drawingDefaults ──
//
// ONE implementation, two callers: the drawing context menu's "Save as default" row (ChartDrawingOverlay) and
// UCT Agent's drawingExtras.saveDefaults. Both used to be inline: the values read off the drawing lived in the
// menu, the merge into cs.drawingDefaults lived in StockChart's onSaveDefaults. Moved here unchanged so the
// Agent saves exactly what the row saves, through the same merge.

import { drawingProp } from './drawingSchema'
import { fieldsFor, labelPosOf } from './drawingMeasure'
import { defaultsPayloadFor } from './drawingSettingsSchema'

/** The style a drawing's menu shows for it (the row's curColor / curWidth / curStyle / curFontSize). */
export function menuStyleOf(drawing) {
  return {
    color: (drawing?.type === 'advance' ? drawing?.labelColor : drawing?.color) || '#c9a84c',
    lineWidth: drawing?.lineWidth || 1,
    lineStyle: drawing?.lineStyle || 'solid',
    fontSize: Math.round(drawing?.fontSize || 13),
  }
}

/**
 * The payload "Save as default" hands onSaveDefaults for this drawing.
 *
 * ⛔ EVERY VALUE THE TOOL *COULD* PERSIST IS OFFERED; `defaultsPayloadFor` decides which of them this tool actually
 * owns. Booleans go through `drawingProp` so "off" is a real, savable answer; the optional ones are omitted when
 * unset, because "no fill" is the absence of a choice rather than a choice to save.
 */
export function saveDefaultsPayloadFor(drawing, cur = menuStyleOf(drawing)) {
  const values = {
    color: cur.color, lineWidth: cur.lineWidth, lineStyle: cur.lineStyle, fontSize: cur.fontSize,
    showPriceLabel: !!drawingProp(drawing, 'showPriceLabel'),
    showPercentChange: !!drawingProp(drawing, 'showPercentChange'),
  }
  // ⭐ THE MEASUREMENT TOGGLES GO THROUGH `fieldsFor`, for the same reason the switches do: a legacy Measure's dollar
  // field is ON without the property being set, and "save as default" must save what the user is looking at, not
  // what happens to be stored.
  const f = fieldsFor(drawing)
  Object.assign(values, {
    showDollar: f.dollar, showPercent: f.percent, showBars: f.bars, showTime: f.time,
    labelPos: labelPosOf(drawing),
  })
  // ⛔ TEXT NOTE'S BOOLEANS ARE ALWAYS OFFERED so that "off" is savable; its two optional colours are offered only
  // when set, because "no background colour" is the absence of a choice rather than a choice. What keeps
  // `lineWidth`/`lineStyle` out of the payload is not this list — it is the schema: the Text Note's colour row
  // declares `persists: ['color']` alone.
  Object.assign(values, {
    bold: !!drawing?.bold, italic: !!drawing?.italic,
    bgEnabled: !!drawing?.bgEnabled, borderEnabled: !!drawing?.borderEnabled,
    fontFamily: drawing?.fontFamily ?? null,
  })
  for (const p of ['fillColor', 'fillOpacity', 'arrowSize', 'bgColor', 'borderColor', 'levels', 'fills']) {
    if (drawing?.[p] !== undefined && drawing?.[p] !== null) values[p] = drawing[p]
  }
  return defaultsPayloadFor(drawing?.type, values)
}

/**
 * cs.drawingDefaults after a save (StockChart's onSaveDefaults).
 *
 * ⛔ `byTool` MERGES ONE LEVEL DEEP; EVERYTHING ELSE STILL SPREADS FLAT. A plain `{...cs.drawingDefaults, ...d}` would
 * replace the whole byTool map with the one tool that just saved — so saving a Rectangle's fill would silently drop
 * the Arrow size someone saved last week. The flat half (color/width/style/fontSize) keeps its shipped shared
 * behaviour; only the per-tool half is nested.
 */
export function mergeDrawingDefaults(prev, d) {
  const { byTool, ...flat } = d || {}
  const was = prev || {}
  const nextByTool = byTool
    ? Object.entries(byTool).reduce(
      (acc, [tool, props]) => ({ ...acc, [tool]: { ...(acc[tool] || {}), ...props } }),
      { ...(was.byTool || {}) },
    )
    : was.byTool
  return { ...was, ...flat, ...(nextByTool ? { byTool: nextByTool } : {}) }
}

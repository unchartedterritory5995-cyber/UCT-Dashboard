// The drill board's two widgets, persisted so your customisation survives a close.
//
// This is the drill's equivalent of `charts_workspace_layout`, deliberately kept
// SEPARATE from it: the drill board is not part of the /charts layout, and folding
// it in would put a second authority over that blob (and make "apply theme to all
// widgets" walk widgets that are not on the board).
//
// ⛔ What is stored is PREFERENCES ONLY — appearance settings, chart tabs, the
// timeframe, the split position. The symbols and their meta ride
// DrillSourceContext and are rebuilt per open; a 134-row payload must never enter
// a layout blob.

export const DRILL_BOARD_PREF = 'breadth_drill_board'

export const LIST_WIDGET_ID = 'drill-list'
export const CHART_WIDGET_ID = 'drill-chart'

// Both widgets sit on colour group A. THAT is the link: the list publishes the
// selected ticker into group A and the chart reads it — the same mechanism the
// charts tab uses, not a bespoke callback.
export const DRILL_GROUP = 'A'

const DEFAULT_SPLIT = 340   // px, list panel width

/** A fresh board. `seedChartOpts` comes from the caller so the chart is seeded
 *  exactly the way /charts seeds a newly-added chart widget — one authority over
 *  "what does a new chart look like", never a second copy of the defaults. */
export function defaultBoard(seedChartOpts = {}) {
  return {
    split: DEFAULT_SPLIT,
    widgets: [
      { id: LIST_WIDGET_ID, type: 'watchlist', color: DRILL_GROUP, opts: { source: 'breadthDrill' } },
      { id: CHART_WIDGET_ID, type: 'chart', color: DRILL_GROUP, opts: { ...seedChartOpts } },
    ],
  }
}

/** Parse a stored blob, falling back to a fresh board on anything unexpected.
 *  Never throws: a corrupt pref must open the drill, not break the breadth page. */
export function parseBoard(raw, seedChartOpts = {}) {
  const fresh = defaultBoard(seedChartOpts)
  if (!raw) return fresh
  let parsed
  try { parsed = typeof raw === 'string' ? JSON.parse(raw) : raw } catch { return fresh }
  if (!parsed || typeof parsed !== 'object') return fresh
  const stored = Array.isArray(parsed.widgets) ? parsed.widgets : []
  // Rebuild from the DEFAULT shape and copy only `opts` across, so a stored blob
  // can never introduce a widget the board does not host, drop one it needs, or
  // move either off colour group A (which would silently unlink list from chart).
  const widgets = fresh.widgets.map((w) => {
    const prev = stored.find(s => s && s.id === w.id)
    const opts = prev && prev.opts && typeof prev.opts === 'object' ? prev.opts : {}
    return {
      ...w,
      // The source tag is structural, not a preference — a stored blob must not
      // be able to turn the list widget back into a saved-list picker.
      opts: w.id === LIST_WIDGET_ID ? { ...opts, source: 'breadthDrill' } : { ...w.opts, ...opts },
    }
  })
  const split = Number.isFinite(parsed.split) ? clampSplit(parsed.split) : fresh.split
  return { split, widgets }
}

export function clampSplit(px) {
  return Math.max(240, Math.min(760, Math.round(px)))
}

export function serializeBoard(board) {
  return JSON.stringify({
    split: clampSplit(board?.split ?? DEFAULT_SPLIT),
    widgets: (board?.widgets ?? []).map(w => ({ id: w.id, opts: w.opts || {} })),
  })
}

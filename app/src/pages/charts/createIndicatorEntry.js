// app/src/pages/charts/createIndicatorEntry.js
//
// ─── ⭐ THE TOP BAR'S "CREATE INDICATOR": WHICH CHART, AND WHAT TO SAY (2026-11-20) ────
//
// THE GAP (measured as a member, 2026-11-20): on desktop the builder was three clicks deep
// (the chart's settings gear, the Indicators tab, then "Create indicator") and nothing on
// the page named it before the gear was opened. A phone reached it in two taps.
//
// WHY THE TOP BAR AND NOT THE CHART'S TOOLBAR. A labelled "Indicators" button once stood on
// every chart's toolbar and was retired on purpose (`ChartToolbar.jsx`, the tombstone above
// the settings gear): Chart Settings → Indicators is the one home for finding, adding and
// configuring an indicator, and a second permanent per-chart surface is the split that
// consolidation ended. This entry does not undo it. It is ONE control for the page, it
// names a different job (making an indicator from a description), and it opens the SAME
// panel on a chart through the door the command palette already uses
// (`agent.openCreateIndicator`, `indicatorKit/indicatorDoors.js`).
//
// WHICH CHART. A board holds several charts and the button belongs to none of them:
//   1. the chart the member last CLICKED on this board (`selectedChartRef`);
//   2. else the chart they are on (last hovered or focused, `activeChartRef`);
//   3. else the first chart in reading order (top row first, then left to right).
// ⛔ CLICKED BEFORE HOVERED, AND THAT ORDER IS THE POINT: moving the pointer from a chart up
// to the top bar crosses the charts above it, so "last hovered" is very often the chart
// under the button and not the one the member was working on.
//
// ⛔ PURE, AND READ AT CLICK TIME. Everything here takes plain values; the workspace passes
// what its refs hold at the moment of the press. Nothing subscribes to a symbol, a group or
// any state that changes on a chart switch (`ChartsWorkspace.switchRenders.test.jsx`: the
// board renders ZERO times per switch, and this entry must not change that).

/** What the member is told when the builder could not be opened, by reason. Plain sentences. */
export const CREATE_INDICATOR_ENTRY_MESSAGES = Object.freeze({
  'no-chart': 'Add a chart to this board first. Create indicator builds on a chart.',
  access: 'Create indicator isn’t available for your account.',
  readonly: 'That chart can’t open Create indicator.',
  unavailable: 'Create indicator isn’t reachable on that chart right now. Try again in a moment.',
})

/** Can this registered chart open the builder at all? (A Multi Chart cell registers with no opener.) */
const canOpen = (api) => !!(api && api.agent && typeof api.agent.openCreateIndicator === 'function')

/** The board's own id for a registered chart (its saved widget id), or null. Never throws. */
function boardIdOf(api) {
  try {
    const read = api.agent.read?.()
    return read && read.chartId != null ? read.chartId : null
  } catch { return null }
}

/**
 * The chart a press on the top bar's "Create indicator" opens on, or null when the board has no
 * chart that can open it.
 * @param {object}   o
 * @param {Map}      o.apiById           the workspace's registry: mount id → chart API
 * @param {Array}    [o.widgets]         the board's widgets (`{id, x, y}`), for reading order
 * @param {*}        [o.selectedWidgetId] the saved widget id of the chart last CLICKED on this board
 * @param {*}        [o.activeId]         the mount id of the chart last hovered or focused
 */
export function chartForCreateIndicator({ apiById, widgets = null, selectedWidgetId = null, activeId = null } = {}) {
  if (!apiById || typeof apiById.values !== 'function') return null
  const able = [...apiById.values()].filter(canOpen)
  if (able.length === 0) return null
  if (selectedWidgetId != null) {
    const clicked = able.find((api) => boardIdOf(api) === selectedWidgetId)
    if (clicked) return clicked
  }
  if (activeId != null && typeof apiById.get === 'function' && canOpen(apiById.get(activeId))) return apiById.get(activeId)
  const placed = new Map((Array.isArray(widgets) ? widgets : [])
    .filter((w) => w && w.id != null && Number.isFinite(w.x) && Number.isFinite(w.y)).map((w) => [w.id, w]))
  const rows = able.map((api, order) => ({ api, order, at: placed.get(boardIdOf(api)) || null }))
  // a chart the board places comes before one it does not; then top row first, left to right;
  // then the order the charts registered in (stable, so the answer never flips between presses)
  rows.sort((a, b) => {
    if (!!a.at !== !!b.at) return a.at ? -1 : 1
    if (a.at && b.at && (a.at.y !== b.at.y || a.at.x !== b.at.x)) return (a.at.y - b.at.y) || (a.at.x - b.at.x)
    return a.order - b.order
  })
  return rows[0].api
}

/**
 * Ask that chart to open the builder. Answers `{ok: true}` or `{ok: false, reason, message}`;
 * the message is the sentence the member reads. Never throws.
 */
export function openCreateIndicatorOn(api) {
  const no = (reason) => ({ ok: false, reason, message: CREATE_INDICATOR_ENTRY_MESSAGES[reason] })
  if (!canOpen(api)) return no('no-chart')
  let answer = null
  try { answer = api.agent.openCreateIndicator(null) } catch { answer = null }
  if (answer && answer.ok === true) return { ok: true }
  const said = answer && typeof answer.reason === 'string' ? answer.reason : null
  return no(said === 'access' || said === 'readonly' ? said : 'unavailable')
}

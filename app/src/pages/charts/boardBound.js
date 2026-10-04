// app/src/pages/charts/boardBound.js
//
// TERM-001 (FB-S1-02) — THE BOARD-SIZE BOUND. Decided 2026-10-02 under the owner's delegation;
// the number, its evidence and its reversal live in
// docs/terminal-research/12-decisions/2026-10-02-term-001-006-board-bound-and-freshness.md.
//
// ⛔ THE NUMBER IS NOT TYPED HERE. It lives in `boardBound.json`, which this module and
// `api/services/board_bound.py` both read — the `market_calendar.json` idiom (TERM-035): Vite
// imports a file under app/src, and the Python image copies the whole tree. The two refusal
// sentences live in the same file, so the add-widget menu and the server say the same words.
//
// THE RULE, in one place for both doors:
//   * a board may GROW only while it holds fewer than `MAX_BOARD_WIDGETS` widgets;
//   * a board ALREADY over the bound is never truncated, never rejected on read, and stays
//     editable — moving, resizing and closing widgets all save. It just cannot grow.
//
// `PANEL_MOUNT_CAP` (ChartsWorkspace.jsx) is a different quantity — concurrent MOUNTS — and is
// unaffected: a 16-widget board still mounts three at a time.
import bound from './boardBound.json'

export const MAX_BOARD_WIDGETS = bound.maxWidgets

/** The widget count of a layout-shaped value, or `null` when it carries no widget list (an
 *  absent or unreadable board — its size is unknown, never assumed to be zero). */
export function boardWidgetCount(layout) {
  return Array.isArray(layout?.widgets) ? layout.widgets.length : null
}

/** May a board holding `count` widgets take one more? */
export function boardCanGrow(count) {
  return Number.isInteger(count) && count < MAX_BOARD_WIDGETS
}

/** May a board holding `currentCount` be REPLACED by one holding `nextCount` (opening a saved
 *  layout)? The server's own rule (`board_bound.check`): within the bound always; past it only
 *  when the replacement is no larger than the board it replaces. */
export function boardMayBecome(nextCount, currentCount) {
  if (!Number.isInteger(nextCount) || nextCount <= MAX_BOARD_WIDGETS) return true
  return Number.isInteger(currentCount) && nextCount <= currentCount
}

function fill(template, count) {
  return template.replaceAll('{max}', String(MAX_BOARD_WIDGETS)).replaceAll('{count}', String(count))
}

/** The sentence a refused add shows — `count` is what the board WOULD hold. */
export function boardRefusalSentence(count) {
  return fill(bound.refusal, count)
}

/** The sentence a refused layout open shows — `count` is the saved layout's size. */
export function boardLayoutRefusalSentence(count) {
  return fill(bound.layoutRefusal, count)
}

/** The sentence an over-bound board states while it is open, or `null` when it is within the
 *  bound. Stated, never acted on: nothing is removed. */
export function boardOverBoundSentence(count) {
  return Number.isInteger(count) && count > MAX_BOARD_WIDGETS ? fill(bound.overBound, count) : null
}

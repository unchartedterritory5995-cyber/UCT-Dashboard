// app/src/pages/journal-2-0/lib/graphNavigation.js
//
// Wave 8, lane 8A (ruling D-A3): the note graph's two accessible doors, as
// plain functions -- where "Show as list" is remembered, the ONE title order
// shared by the list's rows and the canvas's Home/End, and the rule an arrow
// key follows on the canvas. NoteGraphView renders them; its tests and the a11y
// rail import them from here (a component file exports components only).

/** Where the "Show as list" choice is remembered, per browser. */
export const GRAPH_VIEW_KEY = 'uct.notebook.graph.view'

/** ⛔ A storage that throws (private window, blocked site data) means CANVAS —
 *  the view the page has always opened on, never a crash and never a guess. */
export function readGraphView() {
  try {
    return window.localStorage.getItem(GRAPH_VIEW_KEY) === 'list' ? 'list' : 'canvas'
  } catch {
    return 'canvas'
  }
}

export function writeGraphView(view) {
  try {
    window.localStorage.setItem(GRAPH_VIEW_KEY, view)
  } catch {
    // Not remembered, and that is all: the toggle still switches this page.
  }
}

export const titleOf = (n) => n?.title || 'Untitled'

/** ONE ordering for "by title": the list's rows AND the canvas's Home/End, so
 *  the first row of the table is the note Home selects. */
export const byTitle = (a, b) => titleOf(a).localeCompare(titleOf(b))

/** Arrow key -> unit vector in canvas space (y grows downward). */
export const ARROWS = {
  ArrowRight: [1, 0],
  ArrowLeft: [-1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
}

// How much a note off to the side costs against one straight ahead. At 2, a
// note 45 degrees off-axis must be ~2.6x closer to win, so "right" means
// right rather than "whatever is nearest and not behind me".
const ANGLE_WEIGHT = 2

/**
 * The note an arrow key moves to: among the notes strictly AHEAD of `from` in
 * that direction, the one with the smallest angle-weighted distance. None
 * ahead -> null, and the selection stays where it is.
 */
export function nearestInDirection(nodes, from, [ux, uy]) {
  let best = null
  let bestScore = Infinity
  for (const n of nodes) {
    if (n.id === from.id) continue
    const dx = n.x - from.x
    const dy = n.y - from.y
    const along = dx * ux + dy * uy
    if (along <= 0) continue // level with or behind the selection
    const off = Math.abs(dx * uy - dy * ux)
    const score = Math.hypot(dx, dy) * (1 + ANGLE_WEIGHT * Math.atan2(off, along))
    if (score < bestScore) {
      best = n
      bestScore = score
    }
  }
  return best
}

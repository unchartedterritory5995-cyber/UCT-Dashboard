// app/src/pages/terminal/panelFit.js
//
// ─── A PANEL KNOWS HOW WIDE IT IS (2026-11-18) ───
//
// The phone fit rules of the panel tables keyed on the SCREEN (`@media (max-width: 640px)`). A panel
// can be narrow on a wide screen: three panels side by side on a desktop, two on a small laptop. A
// sweep of every panel in a real browser found seven tables wider than a 600px panel on a 1600px
// screen, scrolling sideways inside it.
//
// THE ONE MECHANISM: every panel body carries `data-fit`, the words its own width earns, written by
// ONE shared ResizeObserver (this module; the shell's `Panel` calls `watchPanelFit` on its body).
// A panel stylesheet keys a rule on a word, never on the screen. `:where()` adds no specificity, so
// a rule sorts exactly as it did inside the media query.
//
//   narrow   the screen is a phone (`MQ.phone`, as before), OR the panel is at most NARROW_MAX wide.
//            EVERY table folds: low-value columns step aside, a long label takes a second line. A
//            phone screen carries this word alone, so a phone gets exactly the rules it got before.
//   foldNNN  one word per step of FOLD_STEPS the panel is no wider than (a 500px panel carries
//            fold590 down to fold510). THE FOLD LADDER: folding a column loses information and
//            wrapping does not, so on a screen wider than a phone a table folds only where it would
//            overflow even with its cells wrapped. Each table names its own step on its box
//            (`data-fold="550"`, the step just above the width it was measured to need), and every
//            fold rule starts with the same list:
//
//                :where([data-fit~='narrow'], [data-fit~='fold590'] [data-fold='590'], ...) .phoneHide
//
//            so a table folds in a narrow panel, or from its own step down, and nowhere else. A
//            table with no `data-fold` folds only in a narrow panel.
//   snug     the panel is at most SNUG_MAX wide. The cells of six tables may wrap.
//   medium   the panel is at most MEDIUM_MAX wide. The same for RSS, the one table wider than that.
//   (none)   a wide panel: the attribute is absent and nothing changes.
// Nothing is hidden by snug or medium.
//
// The widths are the PANEL's own (its border box), measured from the sweep, not screen breakpoints:
//   * NARROW_MAX 460: every measured table that names no step fits a 461px panel with its cells
//     wrapped (the widest needs 448px). Three panels across a 1680px screen (474px) stay above it.
//   * FOLD_STEPS: the measured needs, with wrapping and beside the app's 5px scrollbar, run from
//     458px (the open flow board) to 575px (MYH). The steps sit just under the two-panel boards
//     of the common laptops (592px on a 1440px screen, 555px on 1366, 512px on 1280), so a table
//     that fits one of those keeps every column there.
//   * 660: six tables need 604 to 648px unwrapped (CONFL, the open flow board, PERF, HILO, ACCUM,
//     FLWL), 5px more beside the scrollbar. Above 660 those tables are left exactly as they were.
//   * 780: RSS needs 761px, 766 beside a scrollbar.
//
// WHY AN ATTRIBUTE AND NOT A CONTAINER QUERY (`container-type: inline-size` on the body):
//   * a query container is the containing block of every `position: fixed` element inside it and the
//     body clips (`overflow: auto`). The Terminal embeds whole pages (the chart, the calendar, the
//     screener, the research tabs); 27 files under them place menus and popovers with
//     `position: fixed`, and not every one makes its own portal (ChartContextMenu.jsx does not).
//     An attribute changes no layout rule at all.
//   * the app's declared floor includes Chrome 100 to 104 and Firefox 100 to 109, which have no
//     container queries. Moving the phone rules into one would take the phone fit away there.
//
// WHY THE BORDER BOX: the body scrolls (`overflow: auto`), so its CONTENT width changes when a
// scrollbar appears, and a scrollbar appears when the content grows. Keying on the content width would
// let a tier switch itself back and forth at the edge. The panel's outer width depends on the board
// alone.

import { MQ } from '../../styles/breakpoints'

export const PANEL_FIT_ATTR = 'data-fit'

/** A panel at most this wide folds EVERY table, as a phone does. The bottom of the ladder. */
export const NARROW_MAX = 460
/** THE FOLD LADDER, widest first: a table that names a step (`data-fold`) folds from it down. */
export const FOLD_STEPS = Object.freeze([590, 570, 550, 530, 510, 480])
/** A panel at most this wide is snug. */
export const SNUG_MAX = 660
/** A panel at most this wide is medium. */
export const MEDIUM_MAX = 780
/** The word a panel no wider than `step` carries. */
export const foldWord = (step) => `fold${step}`
/** Every word `data-fit` can carry. The rail holds each stylesheet to these. */
export const PANEL_FIT_TIERS = Object.freeze(['narrow', ...FOLD_STEPS.map(foldWord), 'snug', 'medium'])

const isPhoneScreen = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  && !!window.matchMedia(MQ.phone).matches

/**
 * The words of a panel `width` px wide, as the attribute's value: 'fold590 fold570 snug medium' at
 * 555px, 'medium' at 700px, '' for a wide panel. A phone SCREEN is 'narrow' and nothing else.
 * `null` when the panel is not laid out (a phone keeps its unfocused panels mounted and hidden):
 * that is no answer, so the caller leaves what it had.
 */
export function panelFitFor(width, phoneScreen = false) {
  if (!(width > 0)) return null
  if (phoneScreen) return 'narrow'
  const words = []
  if (width <= NARROW_MAX) words.push('narrow')
  for (const step of FOLD_STEPS) if (width <= step) words.push(foldWord(step))
  if (width <= SNUG_MAX) words.push('snug')
  if (width <= MEDIUM_MAX) words.push('medium')
  return words.join(' ')
}

function apply(el) {
  const fit = panelFitFor(el.offsetWidth, isPhoneScreen())
  if (fit === null) return
  if (fit === '') {
    if (el.hasAttribute(PANEL_FIT_ATTR)) el.removeAttribute(PANEL_FIT_ATTR)
  } else if (el.getAttribute(PANEL_FIT_ATTR) !== fit) {
    el.setAttribute(PANEL_FIT_ATTR, fit)
  }
}

// ONE observer for every panel on the board, made on first use.
let shared = null
function observer() {
  if (shared === null) {
    shared = typeof ResizeObserver === 'function'
      ? new ResizeObserver((entries) => { for (const entry of entries) apply(entry.target) })
      : false
  }
  return shared
}

/**
 * Keep `el` (a panel body) marked with its fit words. Marks it at once, so the first paint is
 * already right, then on every change of its size. Returns the cleanup.
 */
export function watchPanelFit(el) {
  if (!el) return () => {}
  apply(el)
  const ro = observer()
  if (ro) ro.observe(el)
  return () => {
    if (ro) ro.unobserve(el)
    el.removeAttribute(PANEL_FIT_ATTR)
  }
}

/** Tests only: forget the shared observer, so a test can install its own ResizeObserver. */
export function resetPanelFitForTests() {
  if (shared) shared.disconnect()
  shared = null
}

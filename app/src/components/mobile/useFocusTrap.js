import { useEffect } from 'react'

/* useFocusTrap — the ONE focus trap.
 *
 * ⛔⛔ WITHOUT A TRAP, TAB WALKS OUT OF A DIALOG INTO THE PAGE BEHIND IT.
 * `aria-modal="true"` constrains a screen reader's virtual cursor and does NOT
 * constrain Tab — a keyboard user tabs straight out of the panel into content
 * the modal is covering, with no way back but Shift+Tab through everything.
 *
 * ⛔ THIS FILE IS THE ONLY COPY. It was extracted from `Sheet.jsx` on
 * 2026-09-01 because FOUR other components had hand-written the same wrap
 * (BuilderSheet, IndicatorSettingsDialog, EarningsResearchModal,
 * StatementPanels) back when `Sheet` shipped none — and the four copies had
 * already drifted, in three different directions: two selected on bare
 * `[href]` (which also matches <link>/<area>), two selected bare
 * `input, select, textarea` and so counted DISABLED controls into the ring,
 * none skipped hidden nodes, and one gated visibility on `offsetParent` (see
 * below). Four hand-written answers to one question is how a modal ends up
 * wrapping to a control the reader cannot reach.
 *
 * Every surface that traps must consume THIS, or render inside a `Sheet`,
 * which consumes it for them.
 */

export const FOCUSABLE_SELECTOR = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])', 'summary',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/* ⛔ NOT `offsetParent !== null`. That is the obvious visibility test and it is
 * ALWAYS null in jsdom, which computes no layout — so the filter removes every
 * candidate, the "nothing focusable" branch fires, and the trap does nothing
 * while its tests say otherwise. `EarningsResearchModal` shipped exactly that,
 * and its tests had to stub `HTMLElement.prototype.offsetParent` to see the
 * wrap at all: a test that can only pass by faking away the production
 * predicate is not evidence about production. Explicit hiding is what actually
 * matters for focus and is readable without a layout pass. */
export function isHiddenForFocus(n) {
  if (!n) return true
  return n.hasAttribute('hidden')
    || n.getAttribute('aria-hidden') === 'true'
    || n.closest('[hidden],[aria-hidden="true"]') !== null
    || n.style.display === 'none'
    || n.style.visibility === 'hidden'
}

/** Every focusable descendant of `container`, in document order, minus the
 *  explicitly hidden ones. */
export function focusableWithin(container) {
  if (!container) return []
  return [...container.querySelectorAll(FOCUSABLE_SELECTOR)].filter((n) => !isHiddenForFocus(n))
}

/**
 * The wrap decision, applied. Call it on a `keydown` whose key is already known
 * to be Tab. Returns true when it intervened (and called `preventDefault`), so
 * a caller can tell "the trap acted" from "the trap let the browser through" —
 * a trap that swallowed EVERY Tab would pass a naive wrap assertion while
 * making the dialog impossible to walk through.
 */
export function trapTabKey(e, container) {
  if (!container) return false
  const nodes = focusableWithin(container)
  if (!nodes.length) {
    // Nothing focusable inside: keep focus on the container rather than letting
    // Tab escape to the page underneath.
    e.preventDefault()
    container.focus?.()
    return true
  }
  const first = nodes[0]
  const last = nodes[nodes.length - 1]
  const active = document.activeElement
  if (!container.contains(active)) {
    e.preventDefault()
    ;(e.shiftKey ? last : first).focus()
    return true
  }
  if (e.shiftKey && (active === first || active === container)) {
    e.preventDefault()
    last.focus()
    return true
  }
  if (!e.shiftKey && active === last) {
    e.preventDefault()
    first.focus()
    return true
  }
  return false
}

/**
 * Is an open `Sheet` sitting ABOVE this container?
 *
 * ⛔ THE NESTING CASE, AND IT IS NOT HYPOTHETICAL. The desktop earnings modal
 * is a bare `role="dialog"`; its Financials tab renders `StatementPanels`,
 * whose pop-out IS a `Sheet` — portaled to <body>, therefore OUTSIDE the
 * modal's own panel. Two document-capture listeners then see the same Tab, the
 * outer one registered FIRST, and its "focus has escaped, pull it back" branch
 * would yank focus out of the pop-out on every keypress. `Sheet` already
 * arbitrates among Sheets (`isTopmost`); this is the other half — a non-Sheet
 * dialog standing down while a Sheet is up.
 */
export function sheetOpenAbove(container) {
  const panels = document.querySelectorAll('[data-sheet-panel]')
  for (const p of panels) if (!container || !container.contains(p)) return true
  return false
}

/**
 * Install the trap for a dialog that is NOT a `Sheet` (a `Sheet` already runs
 * `trapTabKey` itself — adding this inside one is a second authority over one
 * behaviour, which is the defect this extraction removes).
 *
 * ⛔ DOCUMENT, IN CAPTURE. A React `onKeyDown` on the body a component renders
 * sees only its own subtree, and the first focusable of a dialog is routinely a
 * SIBLING of that subtree (a close button in a header), so the very Shift+Tab
 * that leaks out of the modal never reaches the handler. Measured on
 * `IndicatorSettingsDialog`: the forward wrap passed and the backward one
 * walked to `body`.
 *
 * It also stands down while a `Sheet` is open above it (see `sheetOpenAbove`).
 *
 * @param {boolean} active     trap only while the dialog is open
 * @param {{current: Element|null}} containerRef  the dialog panel
 * @param {() => boolean} [shouldTrap]  optional extra gate
 */
export default function useFocusTrap(active, containerRef, shouldTrap) {
  useEffect(() => {
    if (!active) return undefined
    const onKey = (e) => {
      if (e.key !== 'Tab') return
      const container = containerRef?.current
      if (sheetOpenAbove(container)) return
      if (shouldTrap && !shouldTrap()) return
      trapTabKey(e, container)
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [active, containerRef, shouldTrap])
}

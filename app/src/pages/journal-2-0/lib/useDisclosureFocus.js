import { useCallback, useEffect } from 'react'
import useFocusTrap, { focusableWithin } from '../../../components/mobile/useFocusTrap'

/**
 * Wave 10 lane K2 (clause 9d, keyboard-complete): the ONE keyboard contract for the editor's
 * non-modal disclosures -- the Outline panel, the Export menu, the note's "More note actions"
 * panel and the "find a note" picker (Open beside, a relation property).
 *
 * The pattern is the one the Notebook already uses for a panel beside the note (AskPanel, F4 /
 * A2R-06) and the one ContextPopover uses for an anchored menu:
 *
 *   1. focus moves INTO it when it opens (unless a child already took it, e.g. `autoFocus`);
 *   2. while focus is inside, Tab and Shift+Tab stay inside (the ONE trap, `useFocusTrap`,
 *      gated on focus being inside -- a member who clicks back into the note keeps the note's
 *      own Tab, and nothing is pulled into a panel they left);
 *   3. Escape from inside closes it and hands focus back to the control that opened it.
 *
 * ⛔ Lane 10E-2's keyboard walk (rows S2-23, S2-26, S2-27) opened each of these, pressed Tab six
 * times and walked straight out into the toolbar; the Escape it then pressed landed on whatever
 * was focused out there and the disclosure stayed open.
 *
 * ⛔ NESTING. The picker can open INSIDE "More note actions". Both traps listen on the document,
 * so each one only acts for focus whose INNERMOST disclosure is its own container
 * (`focusOwnedBy`): otherwise the outer trap would wrap Tab to its own first control while the
 * inner one wrapped to its own. Escape is handled on the container and stops there, so one press
 * closes one layer.
 */
export const DISCLOSURE_ATTR = 'data-contained-disclosure'

/** Is focus inside `container`, and not inside a disclosure nested within it? */
export function focusOwnedBy(container) {
  if (!container || typeof document === 'undefined') return false
  const active = document.activeElement
  if (!active || !container.contains(active)) return false
  return active.closest(`[${DISCLOSURE_ATTR}]`) === container
}

/**
 * @param {object} o
 * @param {boolean} o.open           the disclosure is showing
 * @param {{current: Element|null}} o.containerRef  its container
 * @param {() => void} o.onClose     close it
 * @param {{current: Element|null}} [o.openerRef]  where Escape hands focus back (omit when the
 *                                   caller restores focus itself)
 * @param {boolean} [o.focusOnOpen=true]  move focus in on open
 * @param {() => (Element|null)} [o.initialFocus]  where focus goes in (default: the first control)
 * @param {boolean} [o.enabled=true] false turns all three off (a touch Sheet does its own)
 * @returns {{ disclosureProps: object }} spread onto the container
 */
export default function useDisclosureFocus({
  open, containerRef, onClose, openerRef = null, focusOnOpen = true, enabled = true, initialFocus = null,
}) {
  const on = Boolean(open && enabled)
  const owned = useCallback(() => focusOwnedBy(containerRef.current), [containerRef])
  useFocusTrap(on, containerRef, owned)

  useEffect(() => {
    if (!on || !focusOnOpen) return
    const el = containerRef.current
    if (!el || el.contains(document.activeElement)) return
    const first = initialFocus?.() || focusableWithin(el)[0]
    ;(first || el).focus?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read once, at open
  }, [on, focusOnOpen, containerRef])

  const onKeyDown = useCallback((e) => {
    if (!on || e.key !== 'Escape' || (e.isDefaultPrevented ? e.isDefaultPrevented() : e.defaultPrevented)) return
    e.preventDefault()
    e.stopPropagation()
    onClose?.()
    openerRef?.current?.focus?.()
  }, [on, onClose, openerRef])

  return { disclosureProps: { [DISCLOSURE_ATTR]: '', onKeyDown } }
}

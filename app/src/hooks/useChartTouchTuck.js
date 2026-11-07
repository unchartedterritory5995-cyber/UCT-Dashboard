import { useEffect } from 'react'

/**
 * The attribute the phone/tablet chart shell stamps on `<html>` while a finger is on
 * the chart, and for a short idle after it lifts (decision B3, 2026-11-07).
 *
 * The floating buttons that ride the bottom of the chart shell read it: the voice
 * orb (`FloatingOrb.module.css`), the feedback "?" (`FeedbackWidget.module.css`) and
 * the joystick hub with its pill (`hub/HubRoot.jsx`). They tuck out of the way while
 * the member is panning or reading the crosshair, so the newest bars and the last
 * pane's price-axis value are never under a button at the moment they matter.
 *
 * ONE attribute on the root, the same channel the shell already uses for
 * `data-mobile-chart-shell`, so no component has to learn about another and the
 * CSS readers need no JS. Exported so readers and tests never re-type the string.
 */
export const CHART_TOUCH_ATTR = 'data-chart-touching'

/** How long after the last finger lifts before the buttons come back. Shorter than
 *  `useHideOnScroll`'s 1.4 s scroll idle: a lifted finger is a clearer "done" than a
 *  scroll that has merely stopped, and the buttons should not stay away longer than
 *  the read they cleared room for. */
export const CHART_TOUCH_IDLE_MS = 1100

/** A press on one of the chart's own CONTROLS (a legend chip, the back-to-live
 *  chip, a toolbar button) is not "touching the chart": it opens something, and
 *  hiding the buttons for it would only make them flicker. */
//  ⭐ `[data-instance-id]` names every legend chip (review, 2026-11-07): a chip
//  that taps through to the study editor (`onBodyTap`) carries no button role, so
//  without it a tap on RSI or MACD hid the buttons while the editor opened.
const CONTROL_SELECTOR = 'button, a[href], input, select, textarea, [role="button"], [role="menuitem"], [contenteditable="true"], [data-instance-id]'

/**
 * While a touch or pen pointer is down inside `ref`'s element — and for
 * `idleMs` after the last one lifts — `<html>` carries `CHART_TOUCH_ATTR`.
 *
 * Patterns kept from `useHideOnScroll.js`: capture-phase passive listeners (the
 * chart canvas and its overlays stop propagation of their own events, so a
 * bubble-phase listener would miss most presses), an idle timer that always brings
 * the buttons back, and nothing that blocks or delays the gesture itself.
 *
 * ⭐ NO REACT STATE. The attribute is written straight to the root, so a pan does
 * not re-render the chart shell on every press — the readers are CSS and a
 * `MutationObserver`, which is what they already use for the shell attribute.
 *
 * ⛔ A MOUSE NEVER TUCKS ANYTHING. A coarse tablet with a trackpad hovers and clicks;
 * hiding buttons under a cursor that is not covering them would be noise.
 *
 * @param {{current: HTMLElement|null}} ref  the chart area
 * @param {{enabled?: boolean, idleMs?: number}} [opts]
 */
export default function useChartTouchTuck(ref, { enabled = true, idleMs = CHART_TOUCH_IDLE_MS } = {}) {
  useEffect(() => {
    const el = ref && ref.current
    const root = typeof document !== 'undefined' ? document.documentElement : null
    if (!enabled || !el || !root) return undefined

    const down = new Set()
    let idleTimer = 0
    const clear = () => { root.removeAttribute(CHART_TOUCH_ATTR) }

    const onDown = (e) => {
      if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return
      const t = e.target
      if (t && typeof t.closest === 'function' && t.closest(CONTROL_SELECTOR)) return
      down.add(e.pointerId)
      clearTimeout(idleTimer)
      root.setAttribute(CHART_TOUCH_ATTR, '')
    }
    // Lifts are heard on the WINDOW: a pan that ends off the chart (over the
    // toolbar, past the screen edge) must still start the idle.
    const onUp = (e) => {
      if (!down.delete(e.pointerId)) return
      if (down.size > 0) return
      clearTimeout(idleTimer)
      idleTimer = setTimeout(clear, idleMs)
    }

    const opts = { capture: true, passive: true }
    el.addEventListener('pointerdown', onDown, opts)
    window.addEventListener('pointerup', onUp, opts)
    window.addEventListener('pointercancel', onUp, opts)
    return () => {
      el.removeEventListener('pointerdown', onDown, opts)
      window.removeEventListener('pointerup', onUp, opts)
      window.removeEventListener('pointercancel', onUp, opts)
      clearTimeout(idleTimer)
      // the attribute must not outlive the shell that set it
      clear()
    }
  }, [ref, enabled, idleMs])
}

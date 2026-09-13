// app/src/pages/dashboard/useCssDisplayed.js
//
// "Is the stylesheet actually showing this element?" — read from the DOM, not from a breakpoint.
//
// ⛔ WHY THIS EXISTS. `Dashboard.jsx` keeps a desktop cockpit AND a mobile stack in the document
// at once and lets CSS (`.desktopOnly` / `.mobileOnly`) hide one. `display: none` hides a subtree;
// it does not unmount it. So the session hero — `CatalystTable`, with its SWR poll, live-price
// subscription, flagged-list sync, per-row logos and the joystick hub hook — was mounted TWICE on
// every dashboard visit, and the hidden copy paid for all of it. That doubled the cost of any
// render defect in the tile: the 2026-09-10 hub render loop was measured at ~4,500 renders/s on a
// page that showed the tile once.
//
// ⭐ MEASURED FROM THE SAME CSS THAT HIDES IT. `getComputedStyle(el).display === 'none'` is the
// stylesheet's own verdict for this exact element, so there is no second breakpoint literal to
// drift from `Dashboard.module.css` — the repo's `useMediaQuery` caveat (a JS media read can
// disagree with what the page is painting) does not apply to reading the paint itself. A
// ResizeObserver re-measures whenever the box changes (an element toggling `display: none` reports
// a 0×0 box), with `resize` as the belt to that suspender.
//
// ⛔ DEFAULTS TO SHOWN. Until the first layout effect runs there is no measurement, and the honest
// answer is "render it" — the page's own rule is NO BLANK, ever. That costs one extra mount on the
// first commit (unmounted again before the next paint), never a missing hero. jsdom applies no
// stylesheets, so under vitest BOTH branches stay shown — which is why the Dashboard tests still
// see the desktop and mobile heroes together, exactly as they did before.
import { useLayoutEffect, useState } from 'react'

/**
 * @param {{current: HTMLElement|null}} ref  The element whose computed `display` decides it.
 * @returns {boolean} false only when the stylesheet has resolved the element to `display: none`.
 */
export default function useCssDisplayed(ref) {
  const [shown, setShown] = useState(true)

  useLayoutEffect(() => {
    const el = ref?.current
    if (!el || typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') {
      return undefined
    }
    const measure = () => setShown(window.getComputedStyle(el).display !== 'none')
    measure()
    const RO = window.ResizeObserver
    const ro = typeof RO === 'function' ? new RO(measure) : null
    ro?.observe?.(el)
    window.addEventListener('resize', measure)
    return () => {
      ro?.disconnect?.()
      window.removeEventListener('resize', measure)
    }
  }, [ref])

  return shown
}

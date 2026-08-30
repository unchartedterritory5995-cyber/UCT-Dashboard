/**
 * Hover readouts for the views that plot a series (Clock, Divergence, Ribbon,
 * Scoreboard, Timeline).
 *
 * ⛔ NO REACT STATE ON THE HOVER PATH. These are hand-rolled SVG/grid views with
 * up to a few thousand marks on screen; a `setState` per mousemove re-renders
 * the whole view and the hover ends up feeling worse than no hover at all. This
 * is the COT page's idiom (`pages/CotData.jsx` → `renderTip` + `tooltipPlugin`),
 * adopted for the same two reasons it was adopted there: one HTML element
 * positioned imperatively cannot be clipped by the pane it belongs to, and it
 * costs no render.
 *
 * ⭐ The readout is `aria-hidden` DECORATION (see `HoverReadout.jsx`). Every
 * mark it describes still carries its own `title`, which is what assistive tech
 * reaches — so the cheap path is never the only path to the number.
 */
import { useCallback, useRef } from 'react'
import css from './hoverReadout.module.css'

export default function useHoverReadout() {
  const hostRef = useRef(null)
  const tipRef = useRef(null)
  // The mark currently described. Content is rebuilt only when this changes, so
  // a pointer that stays inside one cell touches nothing but two style props.
  const keyRef = useRef(null)

  const show = useCallback((evt, key, title, lines = []) => {
    const tip = tipRef.current
    if (!tip) return
    if (keyRef.current !== key) {
      keyRef.current = key
      while (tip.firstChild) tip.removeChild(tip.firstChild)
      const head = document.createElement('div')
      head.className = css.tipTitle
      head.textContent = title
      tip.appendChild(head)
      for (const line of lines) {
        const row = document.createElement('div')
        row.className = css.tipRow
        row.textContent = line
        tip.appendChild(row)
      }
    }
    const host = hostRef.current
    const box = host?.getBoundingClientRect?.()
    // jsdom (and a host that has not been laid out yet) reports a 0×0 box; skip
    // positioning rather than pinning the readout to the corner.
    if (box && box.width > 0) {
      const w = tip.offsetWidth || 0
      const h = tip.offsetHeight || 0
      // Offsets from the host's VISIBLE box first, so the clamp keeps the
      // readout on screen…
      let x = (evt?.clientX ?? 0) - box.left + 14
      let y = (evt?.clientY ?? 0) - box.top + 14
      if (x + w > box.width) x = Math.max(0, box.width - w)
      if (y + h > box.height) y = Math.max(0, box.height - h)
      // …then the host's scroll offset, because an absolutely-positioned child
      // is placed against the SCROLLED content origin, not the visible box.
      // Three of these hosts are `overflow: auto`, so without this the readout
      // drifts by exactly the scroll distance the moment the view is scrolled.
      tip.style.left = `${Math.round(x + (host.scrollLeft || 0))}px`
      tip.style.top = `${Math.round(y + (host.scrollTop || 0))}px`
    }
    tip.style.opacity = '1'
  }, [])

  const hide = useCallback(() => {
    const tip = tipRef.current
    if (!tip) return
    keyRef.current = null
    tip.style.opacity = '0'
  }, [])

  return { hostRef, tipRef, show, hide }
}

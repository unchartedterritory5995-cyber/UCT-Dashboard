// app/src/components/research/fmpDepth/SidewaysScroll.jsx
//
// The ONE box a wide FA / EE table scrolls sideways in (`.scroll` in FmpDepth.module.css; the
// table's first column stays in place, `.table th:first-child`).
//
// A box that scrolls must be reachable without a pointer: while the table is WIDER than the box,
// the box is a Tab stop (`tabindex="0"`, so the arrow keys scroll it), a named region (`role` +
// `aria-label`, so a screen reader says what it is and that it scrolls) and shows the gold focus
// ring. While the table FITS, the box is the plain <div> it always was: no dead Tab stop, no
// region that claims to scroll, and the wide pages that share these tables (/research, the
// earnings modal) are untouched.
//
// "Wider" is measured, never guessed from the screen: a Terminal panel can be 592px wide on a
// 1440px screen. jsdom lays nothing out (both widths read 0), so there the box stays plain.
import { useLayoutEffect, useRef, useState } from 'react'
import styles from './FmpDepth.module.css'

/** True when what `box` holds is wider than `box` (1px of slack for sub-pixel rounding). */
const holdsMoreThanItShows = (box) => !!box && box.scrollWidth > box.clientWidth + 1

export default function SidewaysScroll({ label, children }) {
  const ref = useRef(null)
  const [wide, setWide] = useState(false)

  useLayoutEffect(() => {
    const box = ref.current
    if (!box) return undefined
    const check = () => setWide(holdsMoreThanItShows(box))
    check()
    if (typeof ResizeObserver !== 'function') return undefined
    // the box changes with the panel, the table with its columns (quarterly / annual, the statement)
    const ro = new ResizeObserver(check)
    ro.observe(box)
    if (box.firstElementChild) ro.observe(box.firstElementChild)
    return () => ro.disconnect()
  }, [])

  const region = wide ? { tabIndex: 0, role: 'region', 'aria-label': label } : null
  return <div ref={ref} className={styles.scroll} {...region}>{children}</div>
}

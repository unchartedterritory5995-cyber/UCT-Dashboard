// app/src/pages/charts/widgets/ChartMarketClock.jsx
// Minimal live market clock for the far right of the Charts-workspace TF bar:
// a session-tone dot (green open / amber pre/after-hours / grey closed) + live
// ET time (ticks every second) + an "ET" tag. Hovering reveals a small popup
// with the full session status + next boundary ("MARKET CLOSED · Opens Tue
// 9:30 AM ET"). Reuses useMarketOpen + sessionModel/nextOpenHint so the status
// can never disagree with the Dashboard's session pill.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import useMarketOpen from '../../../hooks/useMarketOpen'
import { sessionModel, nextOpenHint } from '../../../components/dashboard/sessionModel'
import styles from '../ChartsWorkspace.module.css'

export default function ChartMarketClock() {
  const session = useMarketOpen()
  const [now, setNow] = useState(() => new Date())
  const [hover, setHover] = useState(false)
  const rootRef = useRef(null)
  // The popup is PORTALED to <body> and positioned fixed. It used to be an absolutely
  // positioned child, which .chartHeaderTop's `overflow: hidden` clipped away entirely —
  // the popup was never behind the row below, it was cut off. That overflow is load-
  // bearing (it stops a long company name reflowing the header), so the popup has to
  // leave the subtree rather than the header dropping its clip.
  const [pos, setPos] = useState(null)
  useEffect(() => {
    if (!hover || !rootRef.current) { setPos(null); return undefined }
    const place = () => {
      const el = rootRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      setPos({ top: Math.round(r.bottom + 7), right: Math.round(window.innerWidth - r.right) })
    }
    place()
    // Re-place on scroll/resize: fixed coords go stale the moment anything moves.
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [hover])

  // The popup lives outside the widget, so the canvas-derived vars set on the widget
  // don't cascade to it — copy them across from the clock's own computed style.
  const popupVars = () => {
    const el = rootRef.current
    if (!el || typeof window === 'undefined') return undefined
    const cs = window.getComputedStyle(el)
    const pick = (n) => cs.getPropertyValue(n)?.trim() || undefined
    const out = {}
    for (const n of ['--widget-popup-bg', '--widget-popup-border', '--widget-text-strong']) {
      const v = pick(n)
      if (v) out[n] = v
    }
    return Object.keys(out).length ? out : undefined
  }

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const { label, tone } = sessionModel(session)
  const time = now.toLocaleTimeString('en-US', {
    timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true,
  })
  const toneCls = tone === 'open' ? styles.clkOpen : tone === 'ext' ? styles.clkExt : styles.clkClosed

  // Full status + next boundary, shown in the hover popup.
  const detail = session.isOpen ? `${label} · Closes 4:00 PM ET`
    : session.isExtended ? `${label} · Closes 8:00 PM ET`
    : `${label} · ${nextOpenHint()}`

  return (
    <div
      ref={rootRef}
      className={`${styles.marketClock} ${toneCls}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      tabIndex={0}
    >
      <span className={styles.clockDot} aria-hidden="true" />
      <span className={styles.clockTime}>{time}</span>
      <span className={styles.clockEt}>ET</span>
      {hover && pos && createPortal(
        <div
          className={styles.clockPopup}
          role="status"
          style={{ position: 'fixed', top: pos.top, right: pos.right, ...popupVars() }}
        >{detail}</div>,
        document.body,
      )}
    </div>
  )
}

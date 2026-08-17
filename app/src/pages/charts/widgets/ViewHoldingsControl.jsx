// "View Holdings" — shown ONLY when the charted symbol is an ETF (useEtfSymbols),
// in the tfBar right-cluster's leverage-pill seat (the leverage pill returns null for
// ETFs, so the two never collide). Clicking opens a floating live-watchlist window of
// the ETF's holdings. The panel is portaled to <body> so its position:fixed escapes
// the react-grid-layout widget's transform (which would otherwise trap/clip it).
import { useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import useEtfSymbols from '../../../hooks/useEtfSymbols'
import EtfHoldingsPanel from './EtfHoldingsPanel'
import UIcon from '../../../components/ui/UIcon'
import styles from '../ChartsWorkspace.module.css'

// The per-widget canvas vars WidgetHost publishes on the chart widget subtree. The
// holdings panel is portaled to <body> (outside that subtree), so we snapshot these
// off the in-widget button and re-apply them on the panel — that way its canvas,
// text, dividers and hover MATCH the chart widget instead of falling back to the
// dark app tokens.
const WIDGET_VARS = [
  '--widget-canvas', '--widget-divider', '--widget-divider-strong',
  '--widget-text', '--widget-text-strong', '--widget-accent',
  '--widget-accent-bg', '--widget-row-hover', '--widget-popup-bg', '--widget-popup-border',
]

export default function ViewHoldingsControl({ sym }) {
  const { isEtf } = useEtfSymbols()
  const [open, setOpen] = useState(false)
  const [centerOn, setCenterOn] = useState(null)
  const [themeVars, setThemeVars] = useState(null)
  const btnRef = useRef(null)
  // Not an ETF → render nothing (the panel, if it was open, unmounts with this). The
  // open window follows the chart: while it stays an ETF, EtfHoldingsResults just
  // refetches for the new sym.
  if (!isEtf(sym)) return null

  const toggle = () => {
    if (open) { setOpen(false); return }
    // Open centered on THIS chart widget (its react-grid-layout cell). Falls back to
    // the viewport center if the chart isn't in a grid (pop-out window, etc.).
    let c = null
    const el = btnRef.current
    // Snapshot the chart widget's canvas vars so the portaled panel matches it.
    if (el) {
      const cs = getComputedStyle(el)
      const vars = {}
      for (const n of WIDGET_VARS) { const v = cs.getPropertyValue(n).trim(); if (v) vars[n] = v }
      setThemeVars(Object.keys(vars).length ? vars : null)
    }
    const cell = el?.closest('.react-grid-item')
    if (cell) {
      const r = cell.getBoundingClientRect()
      c = { cx: r.left + r.width / 2, cy: r.top + r.height / 2 }
    }
    setCenterOn(c)
    setOpen(true)
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={styles.viewHoldingsBtn}
        onClick={toggle}
        title={`View ${String(sym).toUpperCase()} holdings`}
        aria-pressed={open}
      >
        <UIcon name="library" size={12} gold={false} />
        View Holdings
      </button>
      {open && createPortal(
        <EtfHoldingsPanel sym={sym} centerOn={centerOn} themeVars={themeVars} onClose={() => setOpen(false)} />,
        document.body,
      )}
    </>
  )
}

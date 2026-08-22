// "View Holdings" — shown ONLY when the charted symbol is an ETF (useEtfSymbols),
// in the tfBar right-cluster's leverage-pill seat (the leverage pill returns null for
// ETFs, so the two never collide). Clicking opens a floating live-watchlist window of
// the ETF's holdings. The panel is portaled to <body> so its position:fixed escapes
// the react-grid-layout widget's transform (which would otherwise trap/clip it).
import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import useEtfSymbols from '../../../hooks/useEtfSymbols'
import EtfHoldingsPanel from './EtfHoldingsPanel'
import UIcon from '../../../components/ui/UIcon'
import { watchlistDefaultsForTheme } from '../../watchlist/watchlistSettings'
import styles from '../ChartsWorkspace.module.css'

// Perceived-luminance test for a #hex or rgb() color → is this a light canvas?
function _isLightCanvas(c) {
  if (!c || typeof c !== 'string') return false
  const s = c.trim()
  let r, g, b
  if (s[0] === '#') {
    let h = s.slice(1)
    if (h.length === 3) h = h.split('').map((x) => x + x).join('')
    if (h.length < 6) return false
    r = parseInt(h.slice(0, 2), 16); g = parseInt(h.slice(2, 4), 16); b = parseInt(h.slice(4, 6), 16)
  } else {
    const m = s.match(/rgba?\(([^)]+)\)/i)
    if (!m) return false
    ;[r, g, b] = m[1].split(',').map((x) => parseFloat(x))
  }
  if (![r, g, b].every(Number.isFinite)) return false
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5
}

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

export default function ViewHoldingsControl({ sym, candleColors = null }) {
  const { isEtf } = useEtfSymbols()
  const [open, setOpen] = useState(false)
  const [centerOn, setCenterOn] = useState(null)
  const [themeVars, setThemeVars] = useState(null)
  const [wlOverride, setWlOverride] = useState(null)
  const [heldEtf, setHeldEtf] = useState(null)
  const btnRef = useRef(null)
  const symIsEtf = isEtf(sym)
  // The panel shows the holdings of the ETF it was opened for. Follow chart changes
  // while they stay on an ETF, but FREEZE on a non-ETF: clicking a holding navigates
  // the chart to that stock, and the list must STAY on screen (only the × closes it).
  useEffect(() => { if (symIsEtf) setHeldEtf(sym) }, [sym, symIsEtf])

  // Hide the button on a non-ETF chart, but keep an already-OPEN panel alive so
  // clicking a holding (→ a stock) doesn't dismiss the list.
  if (!symIsEtf && !open) return null

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
      // Build a watchlist settings override so the holdings LIST (not just the panel
      // chrome) paints the chart's canvas + text, and its %-change up/down colors
      // match the chart's candle up/down colors.
      const canvas = vars['--widget-canvas']
      if (canvas) {
        const base = watchlistDefaultsForTheme(_isLightCanvas(canvas) ? 'light' : 'dark')
        setWlOverride({
          ...base,
          bgMode: 'solid',
          bg: canvas,
          upColor: candleColors?.up || base.upColor,
          downColor: candleColors?.down || base.downColor,
        })
      } else {
        setWlOverride(null)
      }
    }
    const cell = el?.closest('.react-grid-item')
    if (cell) {
      const r = cell.getBoundingClientRect()
      c = { cx: r.left + r.width / 2, cy: r.top + r.height / 2 }
    }
    setCenterOn(c)
    setHeldEtf(sym)   // this ETF's holdings stay shown even after navigating to a stock
    setOpen(true)
  }

  return (
    <>
      {symIsEtf && (
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
      )}
      {open && heldEtf && createPortal(
        <EtfHoldingsPanel sym={heldEtf} centerOn={centerOn} themeVars={themeVars} wlOverride={wlOverride} onClose={() => setOpen(false)} />,
        document.body,
      )}
    </>
  )
}

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

export default function ViewHoldingsControl({ sym }) {
  const { isEtf } = useEtfSymbols()
  const [open, setOpen] = useState(false)
  const [centerOn, setCenterOn] = useState(null)
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
    const cell = btnRef.current?.closest('.react-grid-item')
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
        <EtfHoldingsPanel sym={sym} centerOn={centerOn} onClose={() => setOpen(false)} />,
        document.body,
      )}
    </>
  )
}

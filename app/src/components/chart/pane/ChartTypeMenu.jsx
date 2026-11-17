// ChartTypeMenu (owner 11-15) — the chart header's quick candle-type switch, after the
// timeframes (TradingView keeps one in its top row). The button shows the CURRENT type's
// icon; its menu lists exactly the types Chart Settings → Price style offers, and a pick
// writes the same `chartType` change through the same writer the settings window uses.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import TypeGlyph from '../ChartTypeGlyph'
import styles from './ChartTypeMenu.module.css'

export const CHART_TYPE_OPTIONS = [
  { val: 'candles', label: 'Candles' },
  { val: 'hollow', label: 'Hollow candles' },
  { val: 'bars', label: 'OHLC bars' },
  { val: 'hlc', label: 'HLC bars' },
  { val: 'line', label: 'Line' },
  { val: 'area', label: 'Area' },
]

export default function ChartTypeMenu({ value = 'candles', onPick }) {
  const cur = CHART_TYPE_OPTIONS.find((o) => o.val === value) || CHART_TYPE_OPTIONS[0]
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)
  const btnRef = useRef(null)
  const menuRef = useRef(null)

  useLayoutEffect(() => {
    if (!open || !btnRef.current) { setPos(null); return }
    const r = btnRef.current.getBoundingClientRect()
    const win = btnRef.current.ownerDocument.defaultView || window
    const W = 200
    setPos({ left: Math.max(6, Math.min(r.left, win.innerWidth - W - 6)), top: Math.round(r.bottom + 4), target: btnRef.current.ownerDocument.body })
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    const doc = btnRef.current?.ownerDocument || document
    const onDown = (e) => {
      if (menuRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return
      setOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    doc.addEventListener('mousedown', onDown, true)
    doc.addEventListener('keydown', onKey)
    return () => { doc.removeEventListener('mousedown', onDown, true); doc.removeEventListener('keydown', onKey) }
  }, [open])

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`${styles.btn}${open ? ' ' + styles.btnOn : ''} charts-no-drag`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Chart type: ${cur.label}`}
        title={`Chart type: ${cur.label}`}
        data-guide="chart.typeMenu"
      >
        <span className={styles.glyphBig}><TypeGlyph kind={cur.val} size={19} /></span>
      </button>
      {open && pos && createPortal(
        <div ref={menuRef} className={styles.menu} style={{ left: pos.left, top: pos.top }} role="menu" aria-label="Chart type">
          {CHART_TYPE_OPTIONS.map((o) => (
            <button
              key={o.val}
              type="button"
              role="menuitemradio"
              aria-checked={o.val === cur.val}
              className={`${styles.item}${o.val === cur.val ? ' ' + styles.itemOn : ''}`}
              onClick={() => { setOpen(false); if (o.val !== cur.val) onPick?.(o.val) }}
            >
              <span className={styles.glyph}><TypeGlyph kind={o.val} size={16} /></span>
              <span className={styles.label}>{o.label}</span>
              {o.val === cur.val && <span className={styles.check} aria-hidden="true">✓</span>}
            </button>
          ))}
        </div>,
        pos.target,
      )}
    </>
  )
}

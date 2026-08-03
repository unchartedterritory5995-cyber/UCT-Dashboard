// app/src/components/chart/ColorPicker.jsx — Reusable color picker with swatches + hex input.
// The popup is PORTALED to <body> and fixed-positioned from the swatch, edge-aware
// (flips left/up near a viewport edge) so it can't clip off-screen or be cut off by a
// scrollable settings panel's overflow.
//
// ─── WHY THE POPUP CARRIES `data-chart-portal-popup` ────────────────────────
//
// 🐛 THE BUG IT FIXES WAS SHIPPED AND USER-FACING: **choosing a colour was
// impossible anywhere inside the chart toolbar's inline settings panel.** That
// panel closes on any `mousedown` outside its own ref (`ChartToolbar.jsx`), and a
// PORTALED popup is outside it in the DOM no matter how "inside" it is to the
// user. Pressing a preset dispatched mousedown → the panel unmounted → the button
// was gone before the click landed → `pick()` never ran. Opening the picker
// worked (the swatch itself is inside the panel), which is what made it read as a
// dead palette rather than as a closing panel.
//
// The attribute is the CONTRACT, not the fix: it says "this element is logically
// inside whatever opened it, wherever the portal put it", and an outside-click
// handler that means "outside the UI" rather than "outside this subtree" honours
// it with one `closest()`. Any future portaled child of a dismiss-on-outside
// surface should carry it too — the alternative is threading a ref per popup
// through every consumer, which is how this bug got written in the first place.
import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import styles from './ColorPicker.module.css'

/** The marker every portaled popup that is logically INSIDE a dismiss-on-outside
 *  surface must carry. Exported so the handler and the popup name the same
 *  string — a hand-copied selector on the other side is the same defect one
 *  indirection away. */
export const PORTAL_POPUP_ATTR = 'data-chart-portal-popup'

const SWATCHES = [
  '#c9a84c', '#4ade80', '#ef4444', '#60a5fa',
  '#f472b6', '#fb923c', '#a78bfa', '#e2e8f0',
  '#3cb868', '#e74c3c', '#2196f3', '#ff9800',
  '#26a69a', '#00c853', '#ff1744', '#131722',
]

const POPUP_W = 160
const POPUP_H = 132

export default function ColorPicker({ value, onChange, label, disabled = false, title }) {
  const [open, setOpen] = useState(false)
  const [hex, setHex] = useState(value || '#c9a84c')
  const [pos, setPos] = useState(null)
  const swatchRef = useRef(null)
  const popupRef = useRef(null)

  useEffect(() => { setHex(value || '#c9a84c') }, [value])

  // Position the portaled popup from the swatch, flipping to stay on-screen.
  useLayoutEffect(() => {
    if (!open || !swatchRef.current) return
    const place = () => {
      const r = swatchRef.current.getBoundingClientRect()
      let left = r.left
      if (left + POPUP_W > window.innerWidth - 8) left = r.right - POPUP_W  // right-align near right edge
      left = Math.max(8, left)
      let top = r.bottom + 6
      if (top + POPUP_H > window.innerHeight - 8) top = r.top - POPUP_H - 6   // flip up near bottom
      top = Math.max(8, top)
      setPos({ left: Math.round(left), top: Math.round(top) })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (swatchRef.current && swatchRef.current.contains(e.target)) return
      if (popupRef.current && popupRef.current.contains(e.target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const pick = (c) => {
    setHex(c)
    onChange(c)
    setOpen(false)
  }

  const commitHex = () => {
    if (/^#[0-9a-fA-F]{6}$/.test(hex) || /^#[0-9a-fA-F]{3}$/.test(hex)) {
      onChange(hex)
      setOpen(false)
    } else if (/^[0-9a-fA-F]{6}$/.test(hex) || /^[0-9a-fA-F]{3}$/.test(hex)) {
      onChange('#' + hex)
      setOpen(false)
    }
  }

  return (
    <div className={styles.wrap}>
      {label && <span className={styles.label}>{label}</span>}
      <button
        ref={swatchRef}
        className={styles.swatch}
        // `disabled` is a real one: a swatch that opens a picker whose choice is
        // then ignored is worse than no swatch. `title` carries the reason.
        style={{ background: value, ...(disabled ? { opacity: 0.4, cursor: 'not-allowed' } : null) }}
        disabled={disabled}
        onClick={() => { if (!disabled) setOpen(!open) }}
        title={title || value}
      />
      {open && !disabled && createPortal((
        <div
          ref={popupRef}
          className={styles.popup}
          {...{ [PORTAL_POPUP_ATTR]: 'colorpicker' }}
          style={pos ? { left: pos.left, top: pos.top } : { visibility: 'hidden' }}
          onClick={e => e.stopPropagation()}
        >
          <div className={styles.grid}>
            {SWATCHES.map(c => (
              <button
                key={c}
                className={`${styles.cell} ${c === value ? styles.cellActive : ''}`}
                style={{ background: c }}
                onClick={() => pick(c)}
                title={c}
              />
            ))}
          </div>
          <div className={styles.hexRow}>
            <input
              className={styles.hexInput}
              value={hex}
              onChange={e => setHex(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && commitHex()}
              placeholder="#hex"
              spellCheck={false}
            />
            <button className={styles.hexOk} onClick={commitHex}>OK</button>
          </div>
        </div>
      ), document.body)}
    </div>
  )
}

// app/src/components/chart/ColorPicker.jsx — Reusable color picker with swatches + hex input.
// The popup is PORTALED to <body> and fixed-positioned from the swatch, edge-aware
// (flips left/up near a viewport edge) so it can't clip off-screen or be cut off by a
// scrollable settings panel's overflow.
import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import styles from './ColorPicker.module.css'

const SWATCHES = [
  '#c9a84c', '#4ade80', '#ef4444', '#60a5fa',
  '#f472b6', '#fb923c', '#a78bfa', '#e2e8f0',
  '#3cb868', '#e74c3c', '#2196f3', '#ff9800',
  '#26a69a', '#00c853', '#ff1744', '#131722',
]

const POPUP_W = 160
const POPUP_H = 132

export default function ColorPicker({ value, onChange, label }) {
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
        style={{ background: value }}
        onClick={() => setOpen(!open)}
        title={value}
      />
      {open && createPortal((
        <div
          ref={popupRef}
          className={styles.popup}
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

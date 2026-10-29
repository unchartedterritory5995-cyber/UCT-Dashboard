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
import { safeCssColour } from './engine/objectColour'
import { withAlphaByte, opaqueOf } from './designTokens'

/** ⭐⭐ The OPACITY (0-1) a colour carries — `#RRGGBBAA`'s last byte, `rgba()`'s
 *  fourth number — or 1 when it carries none. */
function opacityOfColour(value) {
  if (typeof value !== 'string') return 1
  const v = value.trim()
  const h8 = /^#[0-9a-f]{6}([0-9a-f]{2})$/i.exec(v)
  if (h8) return parseInt(h8[1], 16) / 255
  const m = /^rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)$/i.exec(v)
  return m ? Math.max(0, Math.min(1, Number(m[1]))) : 1
}

/** A colour at an opacity, as TradingView's style colour is: `#RRGGBB` when opaque,
 *  else `#RRGGBBAA` with the exact byte (`designTokens.withAlphaByte`). */
function colourAtOpacity(value, opacity) {
  const base = opaqueOf(value)
  if (!base) return value
  // ⭐ raising a translucent colour to 100% writes an EXPLICIT `#RRGGBBFF`: a pick,
  // which a seeded `#RRGGBB` default is not (`pool.storedOpacityApplies`).
  if (opacity >= 1) return opacityOfColour(value) >= 1 ? value : `${base}FF`
  return withAlphaByte(base, opacity) || base
}

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

export default function ColorPicker({ value, onChange, label, disabled = false, title, withOpacity = false }) {
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

  // ⭐⭐ `withOpacity`: the picker also holds the colour's ALPHA, so a pick is the
  // whole colour — hue and opacity together — the way TradingView's style colour is.
  // A swatch keeps the current opacity; the slider changes only the opacity.
  const opacity = opacityOfColour(value)
  const pick = (c) => {
    const out = withOpacity ? colourAtOpacity(c, opacity) : c
    setHex(out)
    onChange(out)
    setOpen(false)
  }

  const commitHex = () => {
    if (withOpacity && /^#[0-9a-fA-F]{8}$/.test(hex)) {
      onChange(hex.toUpperCase())
      setOpen(false)
    } else if (/^#[0-9a-fA-F]{6}$/.test(hex) || /^#[0-9a-fA-F]{3}$/.test(hex)) {
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
        style={{ background: safeCssColour(value), ...(disabled ? { opacity: 0.4, cursor: 'not-allowed' } : null) }}
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
              aria-label="Hex color"
              spellCheck={false}
            />
            <button className={styles.hexOk} onClick={commitHex}>OK</button>
          </div>
          {withOpacity && (
            <label className={styles.opacityRow}>
              <span className={styles.opacityLabel}>Opacity</span>
              <input
                type="range" min={0} max={100} step={1}
                className={styles.opacityRange}
                aria-label="Opacity"
                value={Math.round(opacity * 100)}
                onChange={(e) => {
                  const next = colourAtOpacity(value || hex, Number(e.target.value) / 100)
                  setHex(next)
                  onChange(next)
                }}
              />
              <span className={styles.opacityValue}>{Math.round(opacity * 100)}%</span>
            </label>
          )}
        </div>
      ), document.body)}
    </div>
  )
}

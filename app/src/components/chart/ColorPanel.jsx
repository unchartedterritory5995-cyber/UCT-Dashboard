import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import styles from './ColorPanel.module.css'

/**
 * The color-editing panel — palette + saved colors + custom picker. Presentational:
 * the parent positions it (the Chart Settings modal pops it out to the RIGHT, like
 * TC2000/TradingView). Editing a candle color opens ONE shared instance of this.
 */

// ── color math ──────────────────────────────────────────────────────────────
function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x }
function toHex2(n) { return Math.round(clamp01(n) * 255).toString(16).padStart(2, '0') }
function hsvToHex(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c
  let r = 0, g = 0, b = 0
  if (h < 60) { r = c; g = x } else if (h < 120) { r = x; g = c }
  else if (h < 180) { g = c; b = x } else if (h < 240) { g = x; b = c }
  else if (h < 300) { r = x; b = c } else { r = c; b = x }
  return `#${toHex2(r + m)}${toHex2(g + m)}${toHex2(b + m)}`
}
function hexToHsv(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || '').trim())
  if (!m) return null
  const int = parseInt(m[1], 16)
  const r = ((int >> 16) & 255) / 255, g = ((int >> 8) & 255) / 255, b = (int & 255) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  let h = 0
  if (d) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60; if (h < 0) h += 360
  }
  return { h, s: max === 0 ? 0 : d / max, v: max }
}
const normHex = (s) => {
  let v = (s || '').trim()
  if (v && v[0] !== '#') v = '#' + v
  return /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null
}

// ── Palette: 12 uniform columns (gray + 11 hues) × 6 shades. Every column uses
// the SAME light→dark saturation/value ramp, so the whole grid blends smoothly and
// nothing stands out. The exact brand colors live in the separate Defaults row. ──
const HUES = [0, 28, 45, 62, 140, 168, 190, 215, 248, 280, 325]
const SHADES = [[0.18, 1.0], [0.38, 0.98], [0.58, 0.9], [0.72, 0.72], [0.82, 0.52], [0.88, 0.32]]
const GRAY_V = [1.0, 0.82, 0.64, 0.46, 0.28, 0.08]
const COLUMNS = [
  GRAY_V.map((v) => hsvToHex(0, 0, v)),
  ...HUES.map((h) => SHADES.map(([s, v]) => hsvToHex(h, s, v))),
]
const PALETTE = [0, 1, 2, 3, 4, 5].map((r) => COLUMNS.map((col) => col[r]))

// The exact colors used across the app — kept available without disturbing the grid.
// chart up-green, theme green, chart down-red, theme red, site gold, white, black.
const DEFAULTS = ['#1ae51a', '#3cb868', '#c41f2d', '#e74c3c', '#c9a84c', '#ffffff', '#000000']

export default function ColorPanel({ title, value, onChange, onClose, savedColors = [], onSaveColor, onDeleteColor }) {
  const [customOpen, setCustomOpen] = useState(false)
  const svRef = useRef(null)
  const hueRef = useRef(null)
  const hsv = useMemo(() => hexToHsv(value) || { h: 0, s: 0, v: 0 }, [value])
  const [hexText, setHexText] = useState(value || '#000000')
  useEffect(() => { setHexText(value || '#000000') }, [value])

  const emit = useCallback((hex) => { onChange?.(hex) }, [onChange])
  const cur = normHex(value)

  const svPointer = useCallback((e) => {
    const r = svRef.current?.getBoundingClientRect(); if (!r) return
    emit(hsvToHex(hsv.h, clamp01((e.clientX - r.left) / r.width), clamp01(1 - (e.clientY - r.top) / r.height)))
  }, [emit, hsv.h])
  const huePointer = useCallback((e) => {
    const r = hueRef.current?.getBoundingClientRect(); if (!r) return
    emit(hsvToHex(clamp01((e.clientX - r.left) / r.width) * 360, hsv.s || 1, hsv.v || 1))
  }, [emit, hsv.s, hsv.v])
  const startDrag = useCallback((handler) => (e) => {
    e.preventDefault(); handler(e)
    let raf = 0, last = null
    const flush = () => { raf = 0; if (last) { handler(last); last = null } }
    const move = (ev) => { last = ev; if (!raf) raf = requestAnimationFrame(flush) }
    const up = (ev) => { if (raf) cancelAnimationFrame(raf); handler(ev); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }, [])
  const commitHex = useCallback(() => { const n = normHex(hexText); if (n) emit(n); else setHexText(value || '#000000') }, [hexText, emit, value])

  const Sw = (c, key) => (
    <button key={key} type="button" className={`${styles.sw} ${cur === c ? styles.swActive : ''}`}
      style={{ background: c }} title={c} onClick={() => emit(c)} />
  )

  return (
    <div className={styles.panel} role="dialog" aria-label={`${title} color`}>
      <div className={styles.head}>
        <span className={styles.title}>{title}</span>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close color picker">✕</button>
      </div>

      <div className={styles.grid}>
        {PALETTE.map((rowArr, r) => rowArr.map((c, ci) => Sw(c, `p${r}-${ci}`)))}
      </div>

      <div className={styles.savedLabel}>Defaults</div>
      <div className={styles.defaultsRow}>
        {DEFAULTS.map((c) => Sw(c, `d-${c}`))}
      </div>

      {savedColors.length > 0 && (
        <>
          <div className={styles.savedLabel}>Saved</div>
          <div className={styles.savedRow}>
            {savedColors.map((c, i) => (
              <span key={`s-${c}-${i}`} className={styles.savedItem}>
                <button type="button" className={`${styles.sw} ${cur === normHex(c) ? styles.swActive : ''}`}
                  style={{ background: c }} title={c} onClick={() => emit(c)} />
                {onDeleteColor && (
                  <button type="button" className={styles.del} title="Remove saved color"
                    onClick={(e) => { e.stopPropagation(); onDeleteColor(c) }}>×</button>
                )}
              </span>
            ))}
          </div>
        </>
      )}

      <div className={styles.footer}>
        <span className={styles.hash}>#</span>
        <input className={styles.hexInput} value={(hexText || '').replace(/^#/, '')} spellCheck={false} maxLength={6}
          onChange={(e) => setHexText(e.target.value)} onBlur={commitHex}
          onKeyDown={(e) => { if (e.key === 'Enter') commitHex() }} />
        <button type="button" className={`${styles.custBtn} ${customOpen ? styles.custOn : ''}`} onClick={() => setCustomOpen(o => !o)}>Custom</button>
        <button type="button" className={styles.saveBtn} onClick={() => onSaveColor?.(cur || value)}>Save</button>
      </div>

      {customOpen && (
        <div className={styles.customWrap}>
          <div className={styles.svBox} ref={svRef} style={{ background: hsvToHex(hsv.h, 1, 1) }} onPointerDown={startDrag(svPointer)}>
            <div className={styles.svWhite} />
            <div className={styles.svBlack} />
            <div className={styles.svThumb} style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: value }} />
          </div>
          <div className={styles.hueBar} ref={hueRef} onPointerDown={startDrag(huePointer)}>
            <div className={styles.hueThumb} style={{ left: `${(hsv.h / 360) * 100}%` }} />
          </div>
        </div>
      )}
    </div>
  )
}

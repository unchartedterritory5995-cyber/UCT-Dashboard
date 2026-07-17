import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import styles from './ChartColorPicker.module.css'

/**
 * Compact color control for the Chart Settings modal. Default view is a tight
 * shade-grid palette (each COLUMN a hue, each ROW a lighter→darker shade) + a UCT
 * brand row + saved colors + a hex field. A "Custom" toggle reveals the full
 * saturation/value + hue picker only when wanted, so the default stays small.
 * `savedColors`/`onSaveColor` are lifted so every picker shares one saved list.
 */

// ── color math ──────────────────────────────────────────────────────────────
function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x }
function toHex2(n) { return Math.round(clamp01(n) * 255).toString(16).padStart(2, '0') }

function hsvToHex(h, s, v) {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
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

// ── Palette: 12 columns (hue) × 6 rows (shade, light → dark). Brand columns are
// hand-tuned so the EXACT chart + Theme-Tracker green/red and the site gold are
// real cells (they highlight when selected); the rest are generated per hue. ──────
function shadeCol(h) {
  return [[0.30, 1.0], [0.52, 0.96], [0.8, 0.88], [0.92, 0.64], [0.96, 0.44], [0.98, 0.28]]
    .map(([s, v]) => hsvToHex(h, s, v))
}
const GRAY_COL  = ['#ffffff', '#c7c7c7', '#909090', '#5c5c5c', '#2e2e2e', '#000000']
// f23645, #e74c3c = Theme-Tracker red, #c41f2d = default chart down-red.
const RED_COL   = ['#fecaca', '#f87171', '#f23645', '#e74c3c', '#c41f2d', '#7d1620']
// #c9a84c = the site gold used for theme names / accents.
const GOLD_COL  = ['#f3e3b0', '#e7cf8f', '#c9a84c', '#a8892f', '#7a5c16', '#4d3a0e']
// #1ae51a = default chart up-green, #3cb868 = Theme-Tracker green.
const GREEN_COL = ['#d9fbd0', '#86efac', '#1ae51a', '#3cb868', '#15803d', '#0a5c22']
const COLUMNS = [
  GRAY_COL, RED_COL, shadeCol(28), GOLD_COL, shadeCol(52), GREEN_COL,
  shadeCol(165), shadeCol(190), shadeCol(215), shadeCol(245), shadeCol(278), shadeCol(325),
]
// Row-major: each row spans every hue at one shade level.
const PALETTE = [0, 1, 2, 3, 4, 5].map((r) => COLUMNS.map((col) => col[r]))

export default function ChartColorPicker({ value, onChange, label, savedColors = [], onSaveColor, onDeleteColor }) {
  const [open, setOpen] = useState(false)
  const [customOpen, setCustomOpen] = useState(false)
  const wrapRef = useRef(null)
  const svRef = useRef(null)
  const hueRef = useRef(null)

  const hsv = useMemo(() => hexToHsv(value) || { h: 0, s: 0, v: 0 }, [value])
  const [hexText, setHexText] = useState(value || '#000000')
  useEffect(() => { setHexText(value || '#000000') }, [value])

  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    return () => { window.removeEventListener('mousedown', onDown, true); window.removeEventListener('keydown', onKey, true) }
  }, [open])

  const emit = useCallback((hex) => { onChange?.(hex) }, [onChange])

  const svPointer = useCallback((e) => {
    const el = svRef.current; if (!el) return
    const r = el.getBoundingClientRect()
    emit(hsvToHex(hsv.h, clamp01((e.clientX - r.left) / r.width), clamp01(1 - (e.clientY - r.top) / r.height)))
  }, [emit, hsv.h])

  const huePointer = useCallback((e) => {
    const el = hueRef.current; if (!el) return
    const r = el.getBoundingClientRect()
    emit(hsvToHex(clamp01((e.clientX - r.left) / r.width) * 360, hsv.s || 1, hsv.v || 1))
  }, [emit, hsv.s, hsv.v])

  const startDrag = useCallback((handler) => (e) => {
    e.preventDefault()
    handler(e)
    let raf = 0, lastEv = null
    const flush = () => { raf = 0; if (lastEv) { handler(lastEv); lastEv = null } }
    const move = (ev) => { lastEv = ev; if (!raf) raf = requestAnimationFrame(flush) }
    const up = (ev) => {
      if (raf) { cancelAnimationFrame(raf); raf = 0 }
      handler(ev)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }, [])

  const commitHex = useCallback(() => {
    const n = normHex(hexText)
    if (n) emit(n); else setHexText(value || '#000000')
  }, [hexText, emit, value])

  const cur = normHex(value)
  const Swatch = (c, key) => (
    <button
      key={key}
      type="button"
      className={`${styles.sw} ${cur === c ? styles.swActive : ''}`}
      style={{ background: c }}
      title={c}
      onClick={() => emit(c)}
    />
  )

  return (
    <div className={styles.field} ref={wrapRef}>
      <button type="button" className={styles.trigger} onClick={() => setOpen(o => !o)}>
        <span className={styles.swatch} style={{ background: value }} />
        <span className={styles.label}>{label}</span>
        <span className={styles.hexTag}>{value}</span>
      </button>

      {open && (
        <div className={styles.pop} role="dialog" aria-label={`${label} color`}>
          {/* Shade grid — columns = hue, rows = shade. */}
          <div className={styles.grid}>
            {PALETTE.map((rowArr, r) => rowArr.map((c, ci) => Swatch(c, `p${r}-${ci}`)))}
          </div>

          {savedColors.length > 0 && (
            <>
              <div className={styles.savedLabel}>Saved</div>
              <div className={styles.savedRow}>
                {savedColors.map((c, i) => (
                  <span key={`s-${c}-${i}`} className={styles.savedItem}>
                    <button
                      type="button"
                      className={`${styles.sw} ${cur === normHex(c) ? styles.swActive : ''}`}
                      style={{ background: c }}
                      title={c}
                      onClick={() => emit(c)}
                    />
                    {onDeleteColor && (
                      <button
                        type="button"
                        className={styles.savedDel}
                        title="Remove saved color"
                        onClick={(e) => { e.stopPropagation(); onDeleteColor(c) }}
                      >×</button>
                    )}
                  </span>
                ))}
              </div>
            </>
          )}

          <div className={styles.footer}>
            <span className={styles.hexHash}>#</span>
            <input
              className={styles.hexInput}
              value={(hexText || '').replace(/^#/, '')}
              spellCheck={false}
              maxLength={6}
              onChange={(e) => setHexText(e.target.value)}
              onBlur={commitHex}
              onKeyDown={(e) => { if (e.key === 'Enter') commitHex() }}
            />
            <button
              type="button"
              className={`${styles.custBtn} ${customOpen ? styles.custBtnOn : ''}`}
              onClick={() => setCustomOpen(o => !o)}
              title="Custom color"
            >Custom</button>
            <button type="button" className={styles.saveBtn} onClick={() => onSaveColor?.(cur || value)}>Save</button>
          </div>

          {customOpen && (
            <div className={styles.customRow}>
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
      )}
    </div>
  )
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import styles from './ChartColorPicker.module.css'

/**
 * Reusable color control for the Chart Settings modal: a swatch button that opens
 * a popover with (1) a basic preset palette, (2) a saved-custom-colors row, and
 * (3) a full custom picker (saturation/value square + hue slider + hex field +
 * Save). `savedColors`/`onSaveColor` are lifted to the modal so every picker
 * shares one saved-color list (persisted by the caller).
 */

// ── Basic preset palette (a tasteful grid; not a copy of any one tool) ──────────
const PRESETS = [
  '#ffffff', '#c9ccd1', '#8a9099', '#4b5563', '#1f2937', '#000000',
  '#ff3b47', '#f97316', '#f59e0b', '#facc15', '#84cc16', '#22c55e',
  '#10b981', '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6',
  '#a855f7', '#d946ef', '#ec4899', '#f43f5e', '#c41f2d', '#7d1620',
  '#1ae51a', '#21c45c', '#3cb868', '#0a5c22', '#c9a84c', '#7a5c16',
]

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

export default function ChartColorPicker({ value, onChange, label, savedColors = [], onSaveColor }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  const svRef = useRef(null)
  const hueRef = useRef(null)

  const hsv = useMemo(() => hexToHsv(value) || { h: 0, s: 0, v: 0 }, [value])
  const [hexText, setHexText] = useState(value || '#000000')
  useEffect(() => { setHexText(value || '#000000') }, [value])

  // Close on outside click / Escape. CAPTURE phase: the settings modal's panel
  // stops mousedown propagation, so a bubble-phase listener would never see clicks
  // elsewhere in the modal — capture fires before that.
  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    return () => { window.removeEventListener('mousedown', onDown, true); window.removeEventListener('keydown', onKey, true) }
  }, [open])

  const emit = useCallback((hex) => { onChange?.(hex) }, [onChange])

  // Drag on the saturation/value square.
  const svPointer = useCallback((e) => {
    const el = svRef.current; if (!el) return
    const r = el.getBoundingClientRect()
    const s = clamp01((e.clientX - r.left) / r.width)
    const v = clamp01(1 - (e.clientY - r.top) / r.height)
    emit(hsvToHex(hsv.h, s, v))
  }, [emit, hsv.h])

  // Drag on the hue slider (vertical).
  const huePointer = useCallback((e) => {
    const el = hueRef.current; if (!el) return
    const r = el.getBoundingClientRect()
    const h = clamp01((e.clientY - r.top) / r.height) * 360
    emit(hsvToHex(h, hsv.s || 1, hsv.v || 1))
  }, [emit, hsv.s, hsv.v])

  const startDrag = useCallback((handler) => (e) => {
    e.preventDefault()
    handler(e)
    // rAF-throttle: coalesce rapid pointermoves to one update per frame (each
    // emit repaints the chart, so this keeps a heavy-chart drag from thrashing).
    let raf = 0
    let lastEv = null
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

  const hueColor = hsvToHex(hsv.h, 1, 1)

  return (
    <div className={styles.field} ref={wrapRef}>
      <button type="button" className={styles.trigger} onClick={() => setOpen(o => !o)}>
        <span className={styles.swatch} style={{ background: value }} />
        <span className={styles.label}>{label}</span>
        <span className={styles.hexTag}>{value}</span>
      </button>

      {open && (
        <div className={styles.pop} role="dialog" aria-label={`${label} color`}>
          {/* Custom picker */}
          <div className={styles.customRow}>
            <div
              className={styles.svBox}
              ref={svRef}
              style={{ background: hueColor }}
              onPointerDown={startDrag(svPointer)}
            >
              <div className={styles.svWhite} />
              <div className={styles.svBlack} />
              <div
                className={styles.svThumb}
                style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: value }}
              />
            </div>
            <div className={styles.hueBar} ref={hueRef} onPointerDown={startDrag(huePointer)}>
              <div className={styles.hueThumb} style={{ top: `${(hsv.h / 360) * 100}%` }} />
            </div>
          </div>

          <div className={styles.hexRow}>
            <span className={styles.hexPreview} style={{ background: value }} />
            <input
              className={styles.hexInput}
              value={hexText}
              spellCheck={false}
              onChange={(e) => setHexText(e.target.value)}
              onBlur={commitHex}
              onKeyDown={(e) => { if (e.key === 'Enter') commitHex() }}
            />
            <button type="button" className={styles.saveBtn} onClick={() => onSaveColor?.(normHex(value) || value)}>Save</button>
          </div>

          {/* Saved custom colors */}
          {savedColors.length > 0 && (
            <>
              <div className={styles.groupLabel}>Saved</div>
              <div className={styles.swatchGrid}>
                {savedColors.map((c, i) => (
                  <button
                    key={`sv-${c}-${i}`}
                    type="button"
                    className={styles.gridSwatch}
                    style={{ background: c }}
                    title={c}
                    onClick={() => emit(c)}
                  />
                ))}
              </div>
            </>
          )}

          {/* Basic presets */}
          <div className={styles.groupLabel}>Basic</div>
          <div className={styles.swatchGrid}>
            {PRESETS.map((c) => (
              <button
                key={c}
                type="button"
                className={`${styles.gridSwatch} ${normHex(value) === c ? styles.gridSwatchActive : ''}`}
                style={{ background: c }}
                title={c}
                onClick={() => emit(c)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

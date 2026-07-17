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

// Colors may carry an alpha as an 8-digit hex (#rrggbbaa). Split into the #rrggbb
// part + a 0..1 opacity; join back (dropping the alpha at full opacity).
function splitColor(v) {
  const s = (v || '').trim()
  const m8 = /^#?([0-9a-f]{6})([0-9a-f]{2})$/i.exec(s)
  if (m8) return { rgb: `#${m8[1].toLowerCase()}`, a: parseInt(m8[2], 16) / 255 }
  const m6 = /^#?([0-9a-f]{6})$/i.exec(s)
  if (m6) return { rgb: `#${m6[1].toLowerCase()}`, a: 1 }
  // rgb()/rgba() — canvas defaults (e.g. grid) may come through in this form.
  const mr = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(s)
  if (mr) {
    const rgb = `#${toHex2(+mr[1] / 255)}${toHex2(+mr[2] / 255)}${toHex2(+mr[3] / 255)}`
    return { rgb, a: mr[4] === undefined ? 1 : clamp01(parseFloat(mr[4])) }
  }
  return { rgb: '#000000', a: 1 }
}
function joinColor(rgb, a) {
  const base = normHex(rgb) || '#000000'
  if (a >= 0.999) return base
  return base + Math.round(clamp01(a) * 255).toString(16).padStart(2, '0')
}

// ── Palette: 12 columns × 6 shades. Each column is a smooth tint→shade ramp
// ANCHORED on its base color (base sits at row 2, with lighter tints above + darker
// shades below), and the app's exact brand colors ARE those anchors — so they're
// natural cells in the gradient (not out of place) and highlight when selected. ──
function _rgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255] }
function _mix(hex, t, amt) { const c = _rgb(hex); return `#${[0, 1, 2].map((i) => toHex2((c[i] + (t[i] - c[i]) * amt) / 255)).join('')}` }
const _W = [255, 255, 255], _K = [14, 14, 16]
const ramp = (base) => [_mix(base, _W, 0.60), _mix(base, _W, 0.32), base, _mix(base, _K, 0.28), _mix(base, _K, 0.52), _mix(base, _K, 0.74)]

const COLUMNS = [
  ['#ffffff', '#cfcfcf', '#9a9a9a', '#666666', '#333333', '#000000'], // neutrals (white + black)
  ramp('#c41f2d'), // chart down-red
  ramp('#e74c3c'), // Theme-Tracker red
  ramp('#e0862f'), // orange
  ramp('#c9a84c'), // site gold
  ramp('#e3cf4a'), // yellow
  ramp('#1ae51a'), // chart up-green
  ramp('#3cb868'), // Theme-Tracker green
  ramp('#28b0a2'), // teal
  ramp('#3f7fe0'), // blue
  ramp('#7d5be0'), // violet
  ramp('#d24ba8'), // magenta
]
const PALETTE = [0, 1, 2, 3, 4, 5].map((r) => COLUMNS.map((col) => col[r]))

export default function ColorPanel({ title, value, onChange, onClose, savedColors = [], onSaveColor, onDeleteColor }) {
  const [customOpen, setCustomOpen] = useState(false)
  const svRef = useRef(null)
  const hueRef = useRef(null)
  const opRef = useRef(null)
  // Split the value into its RGB + opacity. Palette / hex / custom set the RGB (alpha
  // preserved); the opacity slider sets the alpha (RGB preserved).
  const { rgb: curRgb, a: curA } = useMemo(() => splitColor(value), [value])
  const hsv = useMemo(() => hexToHsv(curRgb) || { h: 0, s: 0, v: 0 }, [curRgb])
  const [hexText, setHexText] = useState(curRgb)
  useEffect(() => { setHexText(curRgb) }, [curRgb])

  const emitRgb = useCallback((rgb) => { onChange?.(joinColor(rgb, curA)) }, [onChange, curA])
  const emitAlpha = useCallback((a) => { onChange?.(joinColor(curRgb, a)) }, [onChange, curRgb])

  const svPointer = useCallback((e) => {
    const r = svRef.current?.getBoundingClientRect(); if (!r) return
    emitRgb(hsvToHex(hsv.h, clamp01((e.clientX - r.left) / r.width), clamp01(1 - (e.clientY - r.top) / r.height)))
  }, [emitRgb, hsv.h])
  const huePointer = useCallback((e) => {
    const r = hueRef.current?.getBoundingClientRect(); if (!r) return
    emitRgb(hsvToHex(clamp01((e.clientX - r.left) / r.width) * 360, hsv.s || 1, hsv.v || 1))
  }, [emitRgb, hsv.s, hsv.v])
  const opPointer = useCallback((e) => {
    const r = opRef.current?.getBoundingClientRect(); if (!r) return
    // Inset the usable track by the thumb radius (7px) so 0% / 100% sit where the
    // thumb is fully visible (not clipped at the track edges).
    emitAlpha(clamp01((e.clientX - r.left - 7) / (r.width - 14)))
  }, [emitAlpha])
  const startDrag = useCallback((handler) => (e) => {
    e.preventDefault(); handler(e)
    let raf = 0, last = null
    const flush = () => { raf = 0; if (last) { handler(last); last = null } }
    const move = (ev) => { last = ev; if (!raf) raf = requestAnimationFrame(flush) }
    const up = (ev) => { if (raf) cancelAnimationFrame(raf); handler(ev); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }, [])
  const commitHex = useCallback(() => { const n = normHex(hexText); if (n) emitRgb(n); else setHexText(curRgb) }, [hexText, emitRgb, curRgb])

  const Sw = (c, key) => (
    <button key={key} type="button" className={`${styles.sw} ${curRgb === c ? styles.swActive : ''}`}
      style={{ background: c }} title={c} onClick={() => emitRgb(c)} />
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

      {savedColors.length > 0 && (
        <>
          <div className={styles.savedLabel}>Saved</div>
          <div className={styles.savedRow}>
            {savedColors.map((c, i) => (
              <span key={`s-${c}-${i}`} className={styles.savedItem}>
                <button type="button" className={`${styles.sw} ${curRgb === normHex(c) ? styles.swActive : ''}`}
                  style={{ background: c }} title={c} onClick={() => emitRgb(c)} />
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
        <button type="button" className={styles.saveBtn} onClick={() => onSaveColor?.(curRgb)}>Save</button>
      </div>

      {customOpen && (
        <div className={styles.customWrap}>
          <div className={styles.svBox} ref={svRef} style={{ background: hsvToHex(hsv.h, 1, 1) }} onPointerDown={startDrag(svPointer)}>
            <div className={styles.svWhite} />
            <div className={styles.svBlack} />
            <div className={styles.svThumb} style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: curRgb }} />
          </div>
          <div className={styles.hueBar} ref={hueRef} onPointerDown={startDrag(huePointer)}>
            <div className={styles.hueThumb} style={{ left: `${(hsv.h / 360) * 100}%` }} />
          </div>
        </div>
      )}

      {/* Opacity — per-color (each swatch: body/borders/wick, up/down). */}
      <div className={styles.opLabel}>Opacity</div>
      <div className={styles.opRow}>
        <div className={styles.opTrack} ref={opRef} onPointerDown={startDrag(opPointer)}>
          <div className={styles.opChecker} />
          <div className={styles.opFill} style={{ background: `linear-gradient(to right, ${curRgb}00, ${curRgb})` }} />
          <div className={styles.opThumb} style={{ left: `calc(7px + ${curA} * (100% - 14px))` }} />
        </div>
        <span className={styles.opVal}>{Math.round(curA * 100)}%</span>
      </div>
    </div>
  )
}

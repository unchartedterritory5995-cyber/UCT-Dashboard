// ⚙ Theme Tracker Settings — restyle the theme tracker: canvas (solid / gradient),
// text size, symbol text color, % up/down colors, the tick-flash tint (on/off +
// up/down), company logos. A direct sibling of WatchlistSettingsPanel, minus the
// Price/Volume rows (the tracker has no price or volume columns).
//
// Layout mirrors the Watchlist/Chart Settings menus: the panel pops out beside the
// tracker on the side FACING the middle of the layout (a widget docked left gets the
// menu on its right, and vice versa), and each color is a SWATCH that opens the
// shared ColorPanel (the exact same palette/HSV/opacity picker the charts use).
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import ColorPanel from '../../components/chart/ColorPanel'
import UIcon from '../../components/ui/UIcon'
import { THEME_TRACKER_FONT_SIZES } from './themeTrackerSettings'
import styles from './ThemeTrackerSettingsPanel.module.css'

const PANEL_W = 268

function Row({ label, hint, children }) {
  return (
    <div className={styles.row}>
      <div className={styles.rowLabel}>
        {label}
        {hint && <span className={styles.hint}>{hint}</span>}
      </div>
      <div className={styles.rowControl}>{children}</div>
    </div>
  )
}

function Toggle({ on, onClick, label }) {
  return (
    <button type="button" role="switch" aria-checked={on}
      className={`${styles.toggle}${on ? ' ' + styles.toggleOn : ''}`} onClick={onClick} title={label}>
      <span className={styles.knob} />
    </button>
  )
}

const BG_MODES = [
  { key: 'solid', label: 'Solid' },
  { key: 'gradient', label: 'Gradient' },
]

export default function ThemeTrackerSettingsPanel({ settings: s, onChange, onReset, onClose, gearEl, hostEl, themeVars = null }) {
  const panelRef = useRef(null)
  const [pos, setPos] = useState(null)               // settings-menu position (beside the tracker)
  const [activeTarget, setActiveTarget] = useState(null)  // { target, label } — which color is being edited
  const [colorPos, setColorPos] = useState(null)     // ColorPanel position (beside the menu)

  // Place the settings menu on the side of the tracker CLOSEST TO THE MIDDLE of
  // the layout: a widget on the left half of the viewport gets the menu on its
  // right, one on the right half gets it on its left. Flips if there's no room.
  // Portaled so the tracker's overflow can't clip it.
  useLayoutEffect(() => {
    if (!hostEl) return
    const place = () => {
      const r = hostEl.getBoundingClientRect()
      const gap = 8
      const preferRight = (r.left + r.width / 2) < window.innerWidth / 2
      let left = preferRight ? r.right + gap : r.left - gap - PANEL_W
      if (preferRight && left + PANEL_W > window.innerWidth - 8) left = r.left - gap - PANEL_W
      if (!preferRight && left < 8) left = Math.min(window.innerWidth - PANEL_W - 8, r.right + gap)
      left = Math.max(8, Math.min(left, window.innerWidth - PANEL_W - 8))
      let top = Math.max(8, r.top)
      const panelH = Math.min(540, Math.round(window.innerHeight * 0.8))
      if (top + panelH > window.innerHeight - 8) top = Math.max(8, window.innerHeight - 8 - panelH)
      setPos({ left: Math.round(left), top: Math.round(top) })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [hostEl])

  // Pop the ColorPanel out to the RIGHT of the settings menu (flip left if tight),
  // bottom-aligned to the menu — exactly like Chart/Watchlist Settings.
  useLayoutEffect(() => {
    if (!activeTarget || !panelRef.current) { setColorPos(null); return }
    const r = panelRef.current.getBoundingClientRect()
    const W = 316, gap = 12
    let left = r.right + gap
    if (left + W > window.innerWidth - 8) left = Math.max(8, r.left - W - gap)
    const bottom = Math.max(8, window.innerHeight - r.bottom)
    setColorPos({ left: Math.round(left), bottom: Math.round(bottom) })
  }, [activeTarget, pos])

  // Outside interaction: click a swatch → switch color; click elsewhere in the menu →
  // close the ColorPanel; click fully outside (not gear/menu/color panel) → close all.
  useEffect(() => {
    const onDown = (e) => {
      if (e.target.closest?.('[data-color-swatch]')) return
      if (e.target.closest?.('[data-color-panel]')) return
      if (panelRef.current && panelRef.current.contains(e.target)) { setActiveTarget(null); return }
      if (gearEl && gearEl.contains(e.target)) return
      onClose?.()
    }
    const onKey = (e) => { if (e.key === 'Escape') { if (activeTarget) setActiveTarget(null); else onClose?.() } }
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown, true); document.removeEventListener('keydown', onKey) }
  }, [onClose, gearEl, activeTarget])

  const set = (patch) => onChange(patch)

  const targetValue = (t) => {
    switch (t) {
      case 'bg': return s.bg
      case 'gradTop': return s.bgGradient.top
      case 'gradBottom': return s.bgGradient.bottom
      default: return s[t]
    }
  }
  const setColorTarget = (t, hex) => {
    if (t === 'gradTop') set({ bgGradient: { ...s.bgGradient, top: hex } })
    else if (t === 'gradBottom') set({ bgGradient: { ...s.bgGradient, bottom: hex } })
    else set({ [t]: hex })
  }

  // A color SWATCH that opens the shared ColorPanel (same as Chart Settings).
  const swatch = (target, label) => (
    <button
      type="button"
      data-color-swatch
      className={`${styles.swatch}${activeTarget?.target === target ? ' ' + styles.swatchActive : ''}`}
      style={{ background: targetValue(target) }}
      title={label}
      onClick={() => setActiveTarget({ target, label })}
    />
  )

  return createPortal((
    <>
      <div
        ref={panelRef}
        className={styles.panel}
        style={{ ...(themeVars || {}), ...(pos ? { left: pos.left, top: pos.top } : { visibility: 'hidden' }) }}
        onClick={e => e.stopPropagation()}
      >
        <div className={styles.head}>
          <span className={styles.title}><UIcon name="gear" size={13} /> Theme Tracker Settings</span>
          <div className={styles.headRight}>
            <button className={styles.resetBtn} onClick={onReset} title="Restore theme tracker settings to defaults">↺ Reset</button>
            <button className={styles.close} onClick={onClose} title="Close">✕</button>
          </div>
        </div>

        <div className={styles.body}>
          {/* Canvas */}
          <div className={styles.sectionLabel}>Canvas</div>
          <Row label="Background">
            <div className={styles.seg}>
              {BG_MODES.map(m => (
                <button key={m.key}
                  className={`${styles.segBtn}${s.bgMode === m.key ? ' ' + styles.segBtnOn : ''}`}
                  onClick={() => set({ bgMode: m.key })}>{m.label}</button>
              ))}
            </div>
          </Row>
          {s.bgMode === 'solid' && <Row label="Canvas color">{swatch('bg', 'Canvas')}</Row>}
          {s.bgMode === 'gradient' && (
            <Row label="Gradient" hint="top → bottom">
              <div className={styles.gradPair}>
                {swatch('gradTop', 'Gradient top')}
                <span className={styles.gradArrow}>→</span>
                {swatch('gradBottom', 'Gradient bottom')}
              </div>
            </Row>
          )}

          {/* Text */}
          <div className={styles.sectionLabel}>Text</div>
          <Row label="Text size" hint="whole tracker">
            <select
              className={styles.sizeSelect}
              value={Number(s.fontSize)}
              onChange={e => set({ fontSize: Number(e.target.value) })}
              title="Theme tracker text size"
            >
              {THEME_TRACKER_FONT_SIZES.map(px => <option key={px} value={px}>{px}</option>)}
            </select>
          </Row>

          {/* Text colors — no Price/Volume rows: the tracker has neither column */}
          <div className={styles.sectionLabel}>Text colors</div>
          <Row label="Symbol">{swatch('symColor', 'Symbol')}</Row>

          {/* % change */}
          <div className={styles.sectionLabel}>% Change</div>
          <Row label="Up">{swatch('upColor', 'Up')}</Row>
          <Row label="Down">{swatch('downColor', 'Down')}</Row>

          {/* Tick flash */}
          <div className={styles.sectionLabel}>Tick flash</div>
          <Row label="Background tint" hint="pulse on each update">
            <Toggle on={s.tintEnabled} onClick={() => set({ tintEnabled: !s.tintEnabled })} label="Toggle tick tint" />
          </Row>
          {s.tintEnabled && (
            <>
              <Row label="Up tint">{swatch('tintUp', 'Up tint')}</Row>
              <Row label="Down tint">{swatch('tintDown', 'Down tint')}</Row>
            </>
          )}

          {/* Symbol column */}
          <div className={styles.sectionLabel}>Symbol column</div>
          <Row label="Company logos">
            <Toggle on={s.showLogos} onClick={() => set({ showLogos: !s.showLogos })} label="Toggle company logos" />
          </Row>
        </div>
      </div>

      {activeTarget && colorPos && (
        <div data-color-panel style={{ position: 'fixed', left: colorPos.left, bottom: colorPos.bottom, zIndex: 4100 }}>
          <ColorPanel
            title={activeTarget.label}
            value={targetValue(activeTarget.target)}
            onChange={(hex) => setColorTarget(activeTarget.target, hex)}
            onClose={() => setActiveTarget(null)}
          />
        </div>
      )}
    </>
  ), document.body)
}

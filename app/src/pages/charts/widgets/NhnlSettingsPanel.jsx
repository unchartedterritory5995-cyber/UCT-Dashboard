// ⚙ New Highs / Lows widget settings — canvas (solid / gradient), text size,
// symbol color, and the New-Highs / New-Lows direction colors. Same shared
// ColorPanel + portal placement as the Breadth / Fundamentals settings panels.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import ColorPanel from '../../../components/chart/ColorPanel'
import UIcon from '../../../components/ui/UIcon'
import WidgetThemeSection from './WidgetThemeSection'
import styles from './NhnlSettingsPanel.module.css'

const PANEL_W = 268
const BG_MODES = [{ key: 'solid', label: 'Solid' }, { key: 'gradient', label: 'Gradient' }]
const FONT_SIZES = [10, 11, 12, 13, 14]

function Row({ label, hint, children }) {
  return (
    <div className={styles.row}>
      <div className={styles.rowLabel}>{label}{hint && <span className={styles.hint}>{hint}</span>}</div>
      <div className={styles.rowControl}>{children}</div>
    </div>
  )
}

export default function NhnlSettingsPanel({ settings: s, onChange, onReset, onClose, gearEl, hostEl, themeVars = null,
  title = 'Highs / Lows Settings', showLogos = null, onToggleLogos = null, widgetType = 'nhnl' }) {
  const panelRef = useRef(null)
  const [pos, setPos] = useState(null)
  const [activeTarget, setActiveTarget] = useState(null)
  const [colorPos, setColorPos] = useState(null)

  // Place beside the widget on the side CLOSEST TO THE MIDDLE of the layout.
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
      const panelH = Math.min(420, Math.round(window.innerHeight * 0.8))
      if (top + panelH > window.innerHeight - 8) top = Math.max(8, window.innerHeight - 8 - panelH)
      setPos({ left: Math.round(left), top: Math.round(top) })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [hostEl])

  // ColorPanel pops to the RIGHT of the menu (flip left if tight).
  useLayoutEffect(() => {
    if (!activeTarget || !panelRef.current) { setColorPos(null); return }
    const r = panelRef.current.getBoundingClientRect()
    const W = 316, gap = 12
    let left = r.right + gap
    if (left + W > window.innerWidth - 8) left = Math.max(8, r.left - W - gap)
    const bottom = Math.max(8, window.innerHeight - r.bottom)
    setColorPos({ left: Math.round(left), bottom: Math.round(bottom) })
  }, [activeTarget, pos])

  useEffect(() => {
    const onDown = (e) => {
      if (e.target.closest?.('[data-color-swatch]')) return
      if (e.target.closest?.('[data-color-panel]')) return
      if (e.target.closest?.('[data-uct-theme-gallery]')) return
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
      case 'textColor': return s.textColor || '#f8f7f3'
      case 'upColor': return s.upColor || '#34d17c'
      case 'downColor': return s.downColor || '#f24b42'
      default: return s[t]
    }
  }
  const setColorTarget = (t, hex) => {
    if (t === 'gradTop') set({ bgGradient: { ...s.bgGradient, top: hex } })
    else if (t === 'gradBottom') set({ bgGradient: { ...s.bgGradient, bottom: hex } })
    else set({ [t]: hex })
  }

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
          <span className={styles.title}><UIcon name="gear" size={13} /> {title}</span>
          <div className={styles.headRight}>
            <button className="btn btn-ghost btn-sm" onClick={onReset} title="Restore settings to defaults">↺ Reset</button>
            <button className={styles.close} onClick={onClose} title="Close">✕</button>
          </div>
        </div>

        <div className={styles.body}>
          <div className={styles.sectionLabel}>Theme</div>
          <Row label="UCT theme" hint="whole-widget look">
            <WidgetThemeSection
              widgetType={widgetType}
              currentSettings={s}
              onSettings={(next) => onChange(next)}
              themeVars={themeVars}
              buttonClass="btn btn-ghost btn-sm"
            />
          </Row>
          {showLogos !== null && onToggleLogos && (
            <>
              <div className={styles.sectionLabel}>Display</div>
              <Row label="Logos" hint="company logo by ticker">
                <div className={styles.seg}>
                  <button className={`${styles.segBtn}${showLogos ? ' ' + styles.segBtnOn : ''}`}
                    onClick={() => onToggleLogos(true)}>On</button>
                  <button className={`${styles.segBtn}${!showLogos ? ' ' + styles.segBtnOn : ''}`}
                    onClick={() => onToggleLogos(false)}>Off</button>
                </div>
              </Row>
            </>
          )}
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

          <div className={styles.sectionLabel}>Text</div>
          <Row label="Text size" hint="row + header text">
            <select
              className={styles.sizeSelect}
              value={Number(s.fontSize) || 11}
              onChange={e => set({ fontSize: Number(e.target.value) })}
              title="Row + header text size"
            >
              {FONT_SIZES.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </Row>

          <div className={styles.sectionLabel}>Text colors</div>
          <Row label="Symbol" hint="ticker + price ink">{swatch('textColor', 'Symbol')}</Row>

          <div className={styles.sectionLabel}>New Highs / New Lows</div>
          <Row label="Highs" hint="green side">{swatch('upColor', 'New Highs color')}</Row>
          <Row label="Lows" hint="red side">{swatch('downColor', 'New Lows color')}</Row>
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

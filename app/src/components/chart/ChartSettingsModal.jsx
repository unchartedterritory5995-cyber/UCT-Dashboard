import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import ColorPanel from './ColorPanel'
import styles from './ChartSettingsModal.module.css'

/**
 * Chart Settings — the new, centered, OLED-black settings modal for the Charts
 * workspace. Replaces the old inline gear panel. Opened by the settings button in
 * the chart header (above the clock). Built section-by-section; v1 ships the chart
 * TYPE selector. `settings` is the merged chart_settings object; `onChange(next)`
 * persists the whole object (via chart_settings preference).
 */

// Compact type glyphs (24×24, currentColor) so each option reads at a glance.
function TypeGlyph({ kind }) {
  const s = { width: 26, height: 26, display: 'block' }
  switch (kind) {
    case 'candles':
      return (
        <svg viewBox="0 0 26 26" style={s} fill="none" stroke="currentColor" strokeWidth="1.4">
          <line x1="8" y1="3" x2="8" y2="23" />
          <rect x="5.5" y="8" width="5" height="9" fill="currentColor" stroke="none" />
          <line x1="18" y1="4" x2="18" y2="22" />
          <rect x="15.5" y="7" width="5" height="8" fill="currentColor" stroke="none" />
        </svg>
      )
    case 'hollow':
      return (
        <svg viewBox="0 0 26 26" style={s} fill="none" stroke="currentColor" strokeWidth="1.4">
          <line x1="8" y1="3" x2="8" y2="23" />
          <rect x="5.5" y="8" width="5" height="9" />
          <line x1="18" y1="4" x2="18" y2="22" />
          <rect x="15.5" y="7" width="5" height="8" />
        </svg>
      )
    case 'hlc':
      return (
        <svg viewBox="0 0 26 26" style={s} fill="none" stroke="currentColor" strokeWidth="1.4">
          <line x1="8" y1="4" x2="8" y2="22" />
          <line x1="8" y1="15" x2="12" y2="15" />
          <line x1="18" y1="6" x2="18" y2="20" />
          <line x1="18" y1="12" x2="22" y2="12" />
        </svg>
      )
    case 'bars':
      return (
        <svg viewBox="0 0 26 26" style={s} fill="none" stroke="currentColor" strokeWidth="1.4">
          <line x1="8" y1="4" x2="8" y2="22" />
          <line x1="4" y1="9" x2="8" y2="9" />
          <line x1="8" y1="15" x2="12" y2="15" />
          <line x1="18" y1="6" x2="18" y2="20" />
          <line x1="14" y1="10" x2="18" y2="10" />
          <line x1="18" y1="12" x2="22" y2="12" />
        </svg>
      )
    case 'line':
      return (
        <svg viewBox="0 0 26 26" style={s} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round">
          <polyline points="3,17 9,11 14,15 23,5" />
        </svg>
      )
    case 'area':
      return (
        <svg viewBox="0 0 26 26" style={s} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round">
          <polyline points="3,17 9,11 14,15 23,5" />
          <path d="M3 17 L9 11 L14 15 L23 5 L23 22 L3 22 Z" fill="currentColor" fillOpacity="0.18" stroke="none" />
        </svg>
      )
    default:
      return null
  }
}

const CHART_TYPES = [
  { val: 'candles', label: 'Candles' },
  { val: 'hollow',  label: 'Hollow Candles' },
  { val: 'hlc',     label: 'HLC Bars' },
  { val: 'bars',    label: 'OHLC Bars' },
  { val: 'line',    label: 'Line' },
  { val: 'area',    label: 'Area' },
]

const COLOR_MODES = [
  { val: 'onecolor',  label: 'One Color' },
  { val: 'netchange', label: 'Net Change' },
  { val: 'openclose', label: 'Open vs Close' },
]

const TARGET_MAP = {
  bodyUp: 'upColor', bodyDown: 'downColor',
  borderUp: 'upBorder', borderDown: 'downBorder',
  wickUp: 'upWick', wickDown: 'downWick',
  one: 'oneColor',
}

export default function ChartSettingsModal({ open, onClose, settings, onChange, savedColors = [], onSaveColor, onDeleteColor }) {
  const panelRef = useRef(null)
  const [activeTarget, setActiveTarget] = useState(null) // { target, label }
  const [panelPos, setPanelPos] = useState(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') { if (activeTarget) setActiveTarget(null); else onClose?.() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, activeTarget])

  useEffect(() => { if (!open) setActiveTarget(null) }, [open])

  // Position the pop-out color panel to the RIGHT of the modal (flip left if tight).
  useLayoutEffect(() => {
    if (!open || !activeTarget || !panelRef.current) { setPanelPos(null); return }
    const r = panelRef.current.getBoundingClientRect()
    const W = 316, gap = 12
    let left = r.right + gap
    if (left + W > window.innerWidth - 8) left = Math.max(8, r.left - W - gap)
    // Align the color panel's BOTTOM edge with the settings modal's bottom edge.
    const bottom = Math.max(8, window.innerHeight - r.bottom)
    setPanelPos({ left, bottom })
  }, [activeTarget, open])

  // Close the color panel on an outside click (not a swatch, not inside the panel).
  useEffect(() => {
    if (!activeTarget) return
    const onDown = (e) => {
      if (e.target.closest?.('[data-color-swatch]') || e.target.closest?.('[data-color-panel]')) return
      setActiveTarget(null)
    }
    window.addEventListener('mousedown', onDown, true)
    return () => window.removeEventListener('mousedown', onDown, true)
  }, [activeTarget])

  if (!open) return null

  const curType = settings?.chartType || 'candles'
  const setType = (val) => {
    if (val === curType) return
    onChange?.({ ...settings, chartType: val, preset: 'custom' })
  }

  const curColorMode = settings?.candleColorMode || 'netchange'
  const setColorMode = (val) => {
    if (val === curColorMode) return
    onChange?.({ ...settings, candleColorMode: val, preset: 'custom' })
  }
  const showColorMode = true

  // Candle colors. Candles/Hollow expose Body / Borders / Wick separately; bars &
  // line/area just use the body (up/down) color. 'onecolor' mode = a single color.
  const candles = settings?.candles || {}
  const isCandleType = curType === 'candles' || curType === 'hollow'
  const setCandleColor = (which, hex) => {
    if (!TARGET_MAP[which]) return
    onChange?.({ ...settings, candles: { ...candles, [TARGET_MAP[which]]: hex }, preset: 'custom' })
  }
  const targetValue = (t) => {
    switch (t) {
      case 'bodyUp': return candles.upColor || '#1ae51a'
      case 'bodyDown': return candles.downColor || '#c41f2d'
      case 'borderUp': return candles.upBorder || candles.upColor || '#1ae51a'
      case 'borderDown': return candles.downBorder || candles.downColor || '#c41f2d'
      case 'wickUp': return candles.upWick || candles.upColor || '#1ae51a'
      case 'wickDown': return candles.downWick || candles.downColor || '#c41f2d'
      case 'one': return candles.oneColor || candles.upColor || '#1ae51a'
      default: return '#1ae51a'
    }
  }
  const colorSwatch = (target, label) => (
    <button
      type="button"
      data-color-swatch
      className={`${styles.cSwatch} ${activeTarget?.target === target ? styles.cSwatchActive : ''}`}
      style={{ background: targetValue(target) }}
      title={label}
      onClick={() => setActiveTarget({ target, label })}
    />
  )

  return (
    <>
      {createPortal(
        <div className={styles.backdrop} onMouseDown={onClose} role="dialog" aria-modal="true" aria-label="Chart settings">
      <div className={styles.panel} ref={panelRef} onMouseDown={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>Chart Settings</span>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className={styles.body}>
          <section className={styles.section}>
            <div className={styles.sectionLabel}>Type</div>
            <div className={styles.typeGrid}>
              {CHART_TYPES.map(({ val, label }) => (
                <button
                  key={val}
                  type="button"
                  className={`${styles.typeCard} ${curType === val ? styles.typeCardActive : ''}`}
                  onClick={() => setType(val)}
                  aria-pressed={curType === val}
                >
                  <span className={styles.typeGlyph}><TypeGlyph kind={val} /></span>
                  <span className={styles.typeName}>{label}</span>
                </button>
              ))}
            </div>
          </section>

          {showColorMode && (
            <section className={styles.section}>
              <div className={styles.sectionLabel}>Color based on</div>
              <div className={styles.modeRow}>
                {COLOR_MODES.map(({ val, label }) => (
                  <button
                    key={val}
                    type="button"
                    className={`${styles.modeCard} ${curColorMode === val ? styles.modeCardActive : ''}`}
                    onClick={() => setColorMode(val)}
                    aria-pressed={curColorMode === val}
                  >
                    <span className={styles.modeName}>{label}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {showColorMode && (
            <section className={styles.section}>
              <div className={styles.sectionLabel}>Colors</div>
              {curColorMode === 'onecolor' ? (
                <div className={styles.cGroupsSingle}>
                  <div className={styles.cGroup}>
                    <span className={styles.cGroupLabel}>Color</span>
                    <div className={styles.cSwatches}>{colorSwatch('one', 'Color')}</div>
                  </div>
                </div>
              ) : isCandleType ? (
                <div className={styles.cGroups}>
                  <div className={styles.cGroup}>
                    <span className={styles.cGroupLabel}>Body</span>
                    <div className={styles.cSwatches}>{colorSwatch('bodyUp', 'Body Up')}{colorSwatch('bodyDown', 'Body Down')}</div>
                  </div>
                  <div className={styles.cGroup}>
                    <span className={styles.cGroupLabel}>Borders</span>
                    <div className={styles.cSwatches}>{colorSwatch('borderUp', 'Border Up')}{colorSwatch('borderDown', 'Border Down')}</div>
                  </div>
                  <div className={styles.cGroup}>
                    <span className={styles.cGroupLabel}>Wick</span>
                    <div className={styles.cSwatches}>{colorSwatch('wickUp', 'Wick Up')}{colorSwatch('wickDown', 'Wick Down')}</div>
                  </div>
                </div>
              ) : (
                <div className={styles.cGroups}>
                  <div className={styles.cGroup}>
                    <span className={styles.cGroupLabel}>Color</span>
                    <div className={styles.cSwatches}>{colorSwatch('bodyUp', 'Up')}{colorSwatch('bodyDown', 'Down')}</div>
                  </div>
                </div>
              )}
            </section>
          )}
        </div>
      </div>
        </div>,
        document.body,
      )}
      {activeTarget && panelPos && createPortal(
        <div
          data-color-panel
          style={{ position: 'fixed', left: panelPos.left, bottom: panelPos.bottom, zIndex: 9100 }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <ColorPanel
            title={activeTarget.label}
            value={targetValue(activeTarget.target)}
            onChange={(hex) => setCandleColor(activeTarget.target, hex)}
            onClose={() => setActiveTarget(null)}
            savedColors={savedColors}
            onSaveColor={onSaveColor}
            onDeleteColor={onDeleteColor}
          />
        </div>,
        document.body,
      )}
    </>
  )
}

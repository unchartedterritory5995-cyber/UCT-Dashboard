import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import ChartColorPicker from './ChartColorPicker'
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

// Coloring only applies to OHLC-style types (candles/bars); line & area are single-color.
const OHLC_TYPES = new Set(['candles', 'hollow', 'hlc', 'bars'])

const COLOR_MODES = [
  { val: 'onecolor',  label: 'One Color' },
  { val: 'netchange', label: 'Net Change' },
  { val: 'openclose', label: 'Open vs Close' },
]

export default function ChartSettingsModal({ open, onClose, settings, onChange, savedColors = [], onSaveColor }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

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
  const showColorMode = OHLC_TYPES.has(curType)

  // Candle colors. Up/down set body+border+wick together (the basic control);
  // 'onecolor' mode uses a single dedicated color.
  const candles = settings?.candles || {}
  const setCandleColor = (which, hex) => {
    const next = { ...candles }
    if (which === 'up')   { next.upColor = hex;   next.upBorder = hex;   next.upWick = hex }
    if (which === 'down') { next.downColor = hex; next.downBorder = hex; next.downWick = hex }
    if (which === 'one')  { next.oneColor = hex }
    onChange?.({ ...settings, candles: next, preset: 'custom' })
  }

  return createPortal(
    <div className={styles.backdrop} onMouseDown={onClose} role="dialog" aria-modal="true" aria-label="Chart settings">
      <div className={styles.panel} onMouseDown={(e) => e.stopPropagation()}>
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
              <div className={styles.colorList}>
                {curColorMode === 'onecolor' ? (
                  <ChartColorPicker
                    label="Color"
                    value={candles.oneColor || candles.upColor || '#1ae51a'}
                    onChange={(hex) => setCandleColor('one', hex)}
                    savedColors={savedColors}
                    onSaveColor={onSaveColor}
                  />
                ) : (
                  <>
                    <ChartColorPicker
                      label="Up"
                      value={candles.upColor || '#1ae51a'}
                      onChange={(hex) => setCandleColor('up', hex)}
                      savedColors={savedColors}
                      onSaveColor={onSaveColor}
                    />
                    <ChartColorPicker
                      label="Down"
                      value={candles.downColor || '#c41f2d'}
                      onChange={(hex) => setCandleColor('down', hex)}
                      savedColors={savedColors}
                      onSaveColor={onSaveColor}
                    />
                  </>
                )}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

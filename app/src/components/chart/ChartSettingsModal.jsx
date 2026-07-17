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

// #rrggbb + 0..1 alpha ⇄ 8-digit hex — for the watermark, whose color & opacity
// are stored as separate settings but edited through the one opacity-aware picker.
function splitHexA(v) {
  const m8 = /^#?([0-9a-f]{6})([0-9a-f]{2})$/i.exec((v || '').trim())
  if (m8) return { rgb: `#${m8[1].toLowerCase()}`, a: parseInt(m8[2], 16) / 255 }
  const m6 = /^#?([0-9a-f]{6})$/i.exec((v || '').trim())
  return { rgb: m6 ? `#${m6[1].toLowerCase()}` : '#a8a290', a: 1 }
}
function joinHexA(rgb, a) {
  const base = /^#[0-9a-f]{6}$/i.test(rgb || '') ? rgb.toLowerCase() : '#a8a290'
  const av = Math.max(0, Math.min(1, a ?? 1))
  if (av >= 0.999) return base
  return base + Math.round(av * 255).toString(16).padStart(2, '0')
}

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

// Header tab options.
const TITLE_MODES = [
  { val: 'ticker', label: 'Ticker' },
  { val: 'company', label: 'Company' },
  { val: 'both', label: 'Both' },
]
const HEADER_TFS = [
  ['1', '1m'], ['5', '5m'], ['15', '15m'], ['30', '30m'],
  ['60', '1h'], ['D', '1D'], ['W', '1W'], ['M', '1M'],
]
// [toggle key, label, color target, header.colors key]. The color target/key drive
// the per-row color swatch + Auto reset in the Show section.
const HEADER_TOGGLES = [
  ['showChange', 'Day change ($ / %)', 'hdrDayChange', 'dayChange'],
  ['showMarketCap', 'Market cap', 'hdrMarketCap', 'marketCap'],
  ['showNextEarnings', 'Next earnings', 'hdrNextEarnings', 'nextEarnings'],
  ['showUctRating', 'UCT rating', 'hdrUctRating', 'uctRating'],
  ['showLegend', 'Chart legend', 'hdrLegend', 'legend'],
]

export default function ChartSettingsModal({ open, onClose, settings, onChange, savedColors = [], onSaveColor, onDeleteColor }) {
  const panelRef = useRef(null)
  const dragRef = useRef(null)
  const [activeTab, setActiveTab] = useState('price') // 'price' | 'canvas'
  const [activeTarget, setActiveTarget] = useState(null) // { target, label }
  const [panelPos, setPanelPos] = useState(null)
  const [pos, setPos] = useState(null) // dragged modal position {left, top}; null = centered

  useEffect(() => { if (!open) setPos(null) }, [open]) // re-center on each open

  // Drag the modal by its header (like a floating tool window). Stays open while
  // dragging; clicking the ✕ or outside still closes it.
  const startDrag = (e) => {
    if (e.button !== 0 || e.target.closest?.('[data-modal-close]')) return
    const r = panelRef.current?.getBoundingClientRect(); if (!r) return
    e.preventDefault()
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: r.left, oy: r.top, w: r.width, h: r.height }
    let raf = 0, last = null
    const flush = () => {
      raf = 0; const d = dragRef.current; if (!d || !last) return
      const nx = Math.max(8, Math.min(window.innerWidth - d.w - 8, d.ox + (last.clientX - d.sx)))
      const ny = Math.max(8, Math.min(window.innerHeight - d.h - 8, d.oy + (last.clientY - d.sy)))
      setPos({ left: nx, top: ny }); last = null
    }
    const move = (ev) => { last = ev; if (!raf) raf = requestAnimationFrame(flush) }
    const up = () => { if (raf) cancelAnimationFrame(raf); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') { if (activeTarget) setActiveTarget(null); else onClose?.() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, activeTarget])

  useEffect(() => { if (!open) setActiveTarget(null) }, [open])
  useEffect(() => { if (open) setActiveTab('price') }, [open]) // always open on Price Style
  useEffect(() => { setActiveTarget(null) }, [activeTab])

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
  }, [activeTarget, open, pos])

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
  const grid = settings?.grid || {}
  const crosshair = settings?.crosshair || {}
  const watermark = settings?.watermark || {}
  const isCandleType = curType === 'candles' || curType === 'hollow'
  const bgMode = settings?.bgMode || 'solid'

  // A color "target" → the nested settings path it writes. Covers candles + canvas.
  const COLOR_PATHS = {
    bodyUp: ['candles', 'upColor'], bodyDown: ['candles', 'downColor'],
    borderUp: ['candles', 'upBorder'], borderDown: ['candles', 'downBorder'],
    wickUp: ['candles', 'upWick'], wickDown: ['candles', 'downWick'],
    one: ['candles', 'oneColor'],
    bg: ['background'], bgTop: ['bgGradient', 'top'], bgBottom: ['bgGradient', 'bottom'],
    grid: ['grid', 'color'], crosshair: ['crosshair', 'color'], text: ['textColor'],
    // Per-item header/legend color overrides (Header tab → Show).
    hdrDayChange: ['header', 'colors', 'dayChange'],
    hdrMarketCap: ['header', 'colors', 'marketCap'],
    hdrNextEarnings: ['header', 'colors', 'nextEarnings'],
    hdrUctRating: ['header', 'colors', 'uctRating'],
    hdrLegend: ['header', 'colors', 'legend'],
  }
  const setColorTarget = (target, hex) => {
    // Watermark keeps color + opacity as SEPARATE settings (the chart reads them
    // apart), so map the picker's 8-digit color → {color, opacity}.
    if (target === 'watermark') {
      const { rgb, a } = splitHexA(hex)
      onChange?.({ ...settings, watermark: { ...watermark, color: rgb, opacity: a }, preset: 'custom' })
      return
    }
    const path = COLOR_PATHS[target]; if (!path) return
    const next = { ...settings }
    let o = next
    for (let i = 0; i < path.length - 1; i++) { o[path[i]] = { ...(o[path[i]] || {}) }; o = o[path[i]] }
    o[path[path.length - 1]] = hex
    next.preset = 'custom'
    onChange?.(next)
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
      case 'bg': return settings.background || '#0e0f0d'
      case 'bgTop': return settings.bgGradient?.top || '#16233b'
      case 'bgBottom': return settings.bgGradient?.bottom || '#0e0f0d'
      case 'grid': return grid.color || 'rgba(46,49,39,0.25)'
      case 'crosshair': return crosshair.color || '#706b5e'
      case 'text': return settings.textColor || '#706b5e'
      case 'watermark': return joinHexA(watermark.color || '#a8a290', (watermark.opacity == null || watermark.opacity === 0.07) ? 0.82 : watermark.opacity)
      // Header/legend overrides: show the active override, else the item's built-in
      // color so the swatch reads as the current on-screen color while "Auto".
      case 'hdrDayChange': return hdrColors.dayChange || '#1ae51a'
      case 'hdrMarketCap': return hdrColors.marketCap || '#c9a84c'
      case 'hdrNextEarnings': return hdrColors.nextEarnings || '#6ba3be'
      case 'hdrUctRating': return hdrColors.uctRating || '#c9a84c'
      case 'hdrLegend': return hdrColors.legend || '#a8a290'
      default: return '#1ae51a'
    }
  }
  const setSetting = (patch) => onChange?.({ ...settings, ...patch, preset: 'custom' })
  const setBgMode = (m) => { if (m !== bgMode) setSetting({ bgMode: m }) }
  const setGridVisible = (v) => setSetting({ grid: { ...grid, visible: v } })
  const setWmVisible = (v) => setSetting({ watermark: { ...watermark, visible: v } })
  const setWmLine = (key, v) => setSetting({ watermark: { ...watermark, lines: { ...(watermark.lines || {}), [key]: v } } })
  const wmLines = watermark.lines || {}
  // Header tab.
  const header = settings?.header || {}
  const setHeader = (patch) => setSetting({ header: { ...header, ...patch } })
  const hdrColors = header.colors || {}
  const hdrColorSet = (key) => hdrColors[key] != null
  // Clear one header-item override → the item returns to its built-in (auto) color.
  const clearHeaderColor = (key) => {
    const nextColors = { ...hdrColors }; delete nextColors[key]
    setSetting({ header: { ...header, colors: nextColors } })
  }
  const headerTfs = Array.isArray(header.timeframes) ? header.timeframes : []
  const toggleHeaderTf = (code) => setHeader({ timeframes: headerTfs.includes(code) ? headerTfs.filter((c) => c !== code) : [...headerTfs, code] })
  const TEXT_SIZES = [8, 10, 11, 12, 14, 16, 18, 20, 22, 24, 28, 32, 40]
  const curTextSize = settings.textSize ?? 11
  const colorSwatch = (target, label, bg) => (
    <button
      type="button"
      data-color-swatch
      className={`${styles.cSwatch} ${activeTarget?.target === target ? styles.cSwatchActive : ''}`}
      style={{ background: bg || targetValue(target) }}
      title={label}
      onClick={() => setActiveTarget({ target, label })}
    />
  )

  return (
    <>
      {createPortal(
        <div className={styles.backdrop} onMouseDown={onClose} role="dialog" aria-modal="true" aria-label="Chart settings">
      <div
        className={styles.panel}
        ref={panelRef}
        onMouseDown={(e) => e.stopPropagation()}
        style={pos ? { position: 'fixed', left: pos.left, top: pos.top, margin: 0, animation: 'none' } : undefined}
      >
        <div className={styles.header} onPointerDown={startDrag} style={{ cursor: 'move' }}>
          <span className={styles.title}>Chart Settings</span>
          <button type="button" data-modal-close className={styles.close} onClick={onClose} aria-label="Close" style={{ cursor: 'pointer' }}>✕</button>
        </div>

        <div className={styles.tabs} role="tablist">
          {[['price', 'Price Style'], ['canvas', 'Canvas'], ['header', 'Header']].map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={activeTab === id}
              className={`${styles.tab} ${activeTab === id ? styles.tabActive : ''}`}
              onClick={() => setActiveTab(id)}
            >{label}</button>
          ))}
        </div>

        <div className={styles.body}>
          {activeTab === 'canvas' && (<>
          <section className={styles.section}>
            <div className={styles.sectionLabel}>Background</div>
            <div className={styles.card}>
              <div className={styles.seg} role="tablist">
                {[['solid', 'Solid'], ['gradient', 'Gradient']].map(([val, label]) => (
                  <button
                    key={val}
                    type="button"
                    role="tab"
                    aria-selected={bgMode === val}
                    className={`${styles.segBtn} ${bgMode === val ? styles.segBtnActive : ''}`}
                    onClick={() => setBgMode(val)}
                  >{label}</button>
                ))}
              </div>
              {bgMode === 'solid' ? (
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Color</span>
                  {colorSwatch('bg', 'Background')}
                </div>
              ) : (<>
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Top</span>
                  {colorSwatch('bgTop', 'Gradient Top')}
                </div>
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Bottom</span>
                  {colorSwatch('bgBottom', 'Gradient Bottom')}
                </div>
              </>)}
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionLabel}>Grid</div>
            <div className={styles.card}>
              <div className={styles.field}>
                <span className={styles.fieldLabel}>Show grid lines</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={grid.visible !== false}
                  className={`${styles.toggle} ${grid.visible !== false ? styles.toggleOn : ''}`}
                  onClick={() => setGridVisible(grid.visible === false)}
                ><span className={styles.toggleKnob} /></button>
              </div>
              {grid.visible !== false && (
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Line color</span>
                  {colorSwatch('grid', 'Grid')}
                </div>
              )}
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionLabel}>Crosshair &amp; Text</div>
            <div className={styles.card}>
              <div className={styles.field}>
                <span className={styles.fieldLabel}>Crosshair</span>
                {colorSwatch('crosshair', 'Crosshair')}
              </div>
              <div className={styles.field}>
                <span className={styles.fieldLabel}>Scale text</span>
                <div className={styles.fieldControls}>
                  <select
                    className={styles.sizeSelect}
                    value={curTextSize}
                    onChange={(e) => setSetting({ textSize: Number(e.target.value) })}
                    aria-label="Scale text size"
                  >
                    {TEXT_SIZES.map((px) => <option key={px} value={px}>{px}</option>)}
                  </select>
                  {colorSwatch('text', 'Scale Text')}
                </div>
              </div>
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionLabel}>Watermark</div>
            <div className={styles.card}>
              <div className={styles.field}>
                <span className={styles.fieldLabel}>Show watermark</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={watermark.visible !== false}
                  className={`${styles.toggle} ${watermark.visible !== false ? styles.toggleOn : ''}`}
                  onClick={() => setWmVisible(watermark.visible === false)}
                ><span className={styles.toggleKnob} /></button>
              </div>
              {watermark.visible !== false && (<>
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Fields</span>
                  <div className={styles.chipRow}>
                    {[['ticker', 'Ticker'], ['company', 'Company'], ['sector', 'Sector'], ['industry', 'Industry'], ['theme', 'Theme']].map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        className={`${styles.chip} ${wmLines[key] !== false ? styles.chipOn : ''}`}
                        onClick={() => setWmLine(key, wmLines[key] === false)}
                        aria-pressed={wmLines[key] !== false}
                      >{label}</button>
                    ))}
                  </div>
                </div>
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Color &amp; opacity</span>
                  {colorSwatch('watermark', 'Watermark', watermark.color || '#a8a290')}
                </div>
              </>)}
            </div>
          </section>
          </>)}
          {activeTab === 'header' && (<>
          <section className={styles.section}>
            <div className={styles.sectionLabel}>Title</div>
            <div className={styles.modeRow}>
              {TITLE_MODES.map(({ val, label }) => (
                <button
                  key={val}
                  type="button"
                  className={`${styles.modeCard} ${(header.titleMode || 'company') === val ? styles.modeCardActive : ''}`}
                  onClick={() => setHeader({ titleMode: val })}
                  aria-pressed={(header.titleMode || 'company') === val}
                >
                  <span className={styles.modeName}>{label}</span>
                </button>
              ))}
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionLabel}>Show</div>
            <div className={styles.card}>
              {HEADER_TOGGLES.map(([key, label, target, colorKey]) => {
                const on = header[key] !== false
                const overridden = hdrColorSet(colorKey)
                return (
                  <div className={styles.field} key={key}>
                    <span className={styles.fieldLabel}>{label}</span>
                    <div className={styles.hdrRowCtl}>
                      {/* Color override — only meaningful when the item is shown. */}
                      {on && (overridden ? (
                        <button
                          type="button"
                          className={styles.hdrAutoBtn}
                          onClick={() => clearHeaderColor(colorKey)}
                          title="Reset to automatic color"
                          aria-label={`Reset ${label} to automatic color`}
                        >Auto</button>
                      ) : (
                        <span className={styles.hdrAutoTag} title="Using the automatic color">Auto</span>
                      ))}
                      {on && colorSwatch(target, `${label} color`)}
                      <button
                        type="button"
                        role="switch"
                        aria-checked={on}
                        className={`${styles.toggle} ${on ? styles.toggleOn : ''}`}
                        onClick={() => setHeader({ [key]: header[key] === false })}
                      ><span className={styles.toggleKnob} /></button>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionLabel}>Timeframes</div>
            <div className={styles.card}>
              <div className={styles.field}>
                <span className={styles.fieldLabel}>Buttons</span>
                <div className={styles.chipRow}>
                  {HEADER_TFS.map(([code, label]) => (
                    <button
                      key={code}
                      type="button"
                      className={`${styles.chip} ${headerTfs.includes(code) ? styles.chipOn : ''}`}
                      onClick={() => toggleHeaderTf(code)}
                      aria-pressed={headerTfs.includes(code)}
                    >{label}</button>
                  ))}
                </div>
              </div>
            </div>
          </section>
          </>)}
          {activeTab === 'price' && (<>
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
          </>)}
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
            onChange={(hex) => setColorTarget(activeTarget.target, hex)}
            onClose={() => setActiveTarget(null)}
            savedColors={savedColors}
            onSaveColor={onSaveColor}
            onDeleteColor={onDeleteColor}
            line={activeTarget.target === 'crosshair' ? {
              width: crosshair.width ?? 1,
              style: crosshair.style ?? 3,
              onWidth: (w) => setSetting({ crosshair: { ...crosshair, width: w } }),
              onStyle: (s) => setSetting({ crosshair: { ...crosshair, style: s } }),
            } : null}
          />
        </div>,
        document.body,
      )}
    </>
  )
}

// app/src/components/chart/ChartToolbar.jsx — TradingView-style horizontal drawing toolbar + settings panel
import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { CHART_DEFAULTS, PRESETS, mergeChartSettings } from './chartDefaults'
import ColorPicker from './ColorPicker'
import styles from './ChartToolbar.module.css'

// ─── SVG icon factory ────────────────────────────────────────────────────────
const I = (children) => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none"
    stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
)

const ICONS = {
  repeat:     I(<><path d="M11.5 2.5L14 5l-2.5 2.5" fill="none" /><path d="M2 8V7a3 3 0 013-3h9" fill="none" /><path d="M4.5 13.5L2 11l2.5-2.5" fill="none" /><path d="M14 8v1a3 3 0 01-3 3H2" fill="none" /></>),
  settings:   I(<><circle cx="8" cy="8" r="2.5" /><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.1 3.1l1.4 1.4M11.5 11.5l1.4 1.4M3.1 12.9l1.4-1.4M11.5 4.5l1.4-1.4" /></>),
  cursor:     I(<path d="M4 2v11l2.5-2.5L9 14l1.5-1-2.5-3.5H12z" fill="currentColor" stroke="none" />),
  trendline:  I(<line x1="3" y1="13" x2="13" y2="3" />),
  ray:        I(<><line x1="3" y1="13" x2="13" y2="3" /><polyline points="13,3 9,3 13,7" fill="none" /></>),
  extended:   I(<><line x1="1" y1="15" x2="15" y2="1" strokeDasharray="1.5 1.5" /><line x1="4" y1="12" x2="12" y2="4" /></>),
  horizontal: I(<><line x1="1" y1="8" x2="15" y2="8" /><circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none" /></>),
  hray:       I(<><line x1="6" y1="8" x2="15" y2="8" /><circle cx="6" cy="8" r="1.5" fill="currentColor" stroke="none" /><polyline points="15,8 12,6 12,10" fill="currentColor" stroke="none" /></>),
  vertical:   I(<><line x1="8" y1="1" x2="8" y2="15" /><circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none" /></>),
  rect:       I(<rect x="3" y="4" width="10" height="8" />),
  circle:     I(<ellipse cx="8" cy="8" rx="6" ry="5" />),
  arrow:      I(<><line x1="3" y1="13" x2="13" y2="3" /><polyline points="7,3 13,3 13,9" fill="none" /></>),
  fib:        I(<><line x1="2" y1="2" x2="14" y2="2" /><line x1="2" y1="6" x2="14" y2="6" strokeDasharray="2 1" /><line x1="2" y1="10" x2="14" y2="10" strokeDasharray="2 1" /><line x1="2" y1="14" x2="14" y2="14" /></>),
  channel:    I(<><line x1="2" y1="12" x2="11" y2="3" /><line x1="5" y1="14" x2="14" y2="5" /></>),
  avwap:      I(<><path d="M3 12 C5 6, 8 4, 13 5" fill="none" /><circle cx="3" cy="12" r="1.5" fill="currentColor" stroke="none" /><text x="9" y="13" fontSize="6" fill="currentColor" stroke="none" fontFamily="monospace">V</text></>),
  text:       I(<text x="4" y="12.5" fontSize="11" fontWeight="700" fill="currentColor" stroke="none" fontFamily="monospace">T</text>),
  measure:    I(<><rect x="2" y="4" width="12" height="8" strokeDasharray="2 1" /><line x1="4" y1="8" x2="12" y2="8" /><line x1="4" y1="6" x2="4" y2="10" /><line x1="12" y1="6" x2="12" y2="10" /></>),
  delete:     I(<><polyline points="3,5 4,14 12,14 13,5" /><line x1="2" y1="5" x2="14" y2="5" /><line x1="6" y1="3" x2="10" y2="3" /><line x1="7" y1="7" x2="7" y2="12" /><line x1="9" y1="7" x2="9" y2="12" /></>),
  clear:      I(<><line x1="4" y1="4" x2="12" y2="12" /><line x1="12" y1="4" x2="4" y2="12" /></>),
}

// ─── Tool definitions ────────────────────────────────────────────────────────
const TOOLS = [
  { id: 'cursor',     label: 'Select (V)' },
  'sep',
  { id: 'trendline',  label: 'Trendline (T)' },
  { id: 'extended',   label: 'Extended Line' },
  { id: 'horizontal', label: 'Horizontal Line (H)' },
  { id: 'hray',       label: 'Horizontal Ray' },
  { id: 'vertical',   label: 'Vertical Line' },
  'sep',
  { id: 'rect',       label: 'Rectangle (R)' },
  { id: 'circle',     label: 'Circle' },
  { id: 'arrow',      label: 'Arrow' },
  'sep',
  { id: 'fib',        label: 'Fibonacci Retracement (F)' },
  { id: 'channel',    label: 'Parallel Channel' },
  { id: 'avwap',      label: 'Anchored VWAP' },
  'sep',
  { id: 'text',       label: 'Text Note (X)' },
  { id: 'measure',    label: 'Measure (M)' },
]

const COLORS = [
  '#c9a84c', '#4ade80', '#ef4444', '#60a5fa',
  '#f472b6', '#fb923c', '#a78bfa', '#e2e8f0',
]

const WIDTHS = [1, 2, 3]

const CHART_TYPES = [
  { value: 'candles', label: 'Candles' },
  { value: 'hollow',  label: 'Hollow' },
  { value: 'bars',    label: 'Bars' },
  { value: 'line',    label: 'Line' },
  { value: 'area',    label: 'Area' },
]

const CROSSHAIR_STYLES = [
  { value: 0, label: 'Solid' },
  { value: 2, label: 'Dashed' },
  { value: 3, label: 'Dotted' },
]

// ─── Settings Panel (inline in chart) ────────────────────────────────────────

function ChartSettingsPanel({ chartSettings, onUpdateSettings }) {
  const cs = chartSettings

  const update = useCallback((path, value) => {
    const next = { ...cs }
    if (path.includes('.')) {
      const [section, key] = path.split('.')
      next[section] = { ...next[section], [key]: value }
    } else {
      next[path] = value
    }
    next.preset = 'custom'
    onUpdateSettings(next)
  }, [cs, onUpdateSettings])

  const updateOverlay = useCallback((idx, field, value) => {
    const next = { ...cs }
    next.overlays = next.overlays.map((o, i) =>
      i === idx ? { ...o, [field]: field === 'period' ? (parseInt(value) || o.period) : value } : o
    )
    next.preset = 'custom'
    onUpdateSettings(next)
  }, [cs, onUpdateSettings])

  const applyPreset = useCallback((key) => {
    const preset = PRESETS[key]
    if (preset) onUpdateSettings(preset.settings)
  }, [onUpdateSettings])

  return (
    <div className={styles.settingsPanel}>
      {/* Presets */}
      <div className={styles.sGroup}>
        <span className={styles.sLabel}>Preset</span>
        <div className={styles.presetRow}>
          {Object.entries(PRESETS).map(([key, p]) => (
            <button
              key={key}
              className={`${styles.presetBtn} ${cs.preset === key ? styles.presetActive : ''}`}
              onClick={() => applyPreset(key)}
            >
              <span className={styles.presetDot} style={{ background: p.swatch }} />
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Chart Type */}
      <div className={styles.sGroup}>
        <span className={styles.sLabel}>Type</span>
        <div className={styles.sPills}>
          {CHART_TYPES.map(ct => (
            <button
              key={ct.value}
              className={`${styles.sPill} ${cs.chartType === ct.value ? styles.sPillActive : ''}`}
              onClick={() => update('chartType', ct.value)}
            >
              {ct.label}
            </button>
          ))}
        </div>
      </div>

      {/* Candle Colors */}
      <div className={styles.sGroup}>
        <span className={styles.sLabel}>Candles</span>
        <div className={styles.sRow}>
          <ColorPicker label="Up" value={cs.candles.upColor} onChange={v => {
            const next = { ...cs, candles: { ...cs.candles, upColor: v, upBorder: v, upWick: v }, preset: 'custom' }
            onUpdateSettings(next)
          }} />
          <ColorPicker label="Down" value={cs.candles.downColor} onChange={v => {
            const next = { ...cs, candles: { ...cs.candles, downColor: v, downBorder: v, downWick: v }, preset: 'custom' }
            onUpdateSettings(next)
          }} />
        </div>
      </div>

      {/* Background & Grid */}
      <div className={styles.sGroup}>
        <span className={styles.sLabel}>Background</span>
        <div className={styles.sRow}>
          <ColorPicker label="BG" value={cs.background} onChange={v => update('background', v)} />
          <ColorPicker label="Text" value={cs.textColor} onChange={v => update('textColor', v)} />
          <ColorPicker label="Grid" value={cs.grid.color} onChange={v => update('grid.color', v)} />
        </div>
        <div className={styles.sRow} style={{ marginTop: 6 }}>
          <label className={styles.sCheck}>
            <input type="checkbox" checked={cs.grid.visible} onChange={e => update('grid.visible', e.target.checked)} />
            Grid
          </label>
          <label className={styles.sCheck}>
            <input type="checkbox" checked={cs.watermark.visible} onChange={e => update('watermark.visible', e.target.checked)} />
            Watermark
          </label>
        </div>
      </div>

      {/* Indicators */}
      <div className={styles.sGroup}>
        <span className={styles.sLabel}>Indicators</span>
        {cs.overlays.map((ov, i) => (
          <div key={i} className={styles.sOverlayRow}>
            <input type="checkbox" checked={ov.enabled} onChange={e => updateOverlay(i, 'enabled', e.target.checked)} />
            <select className={styles.sMiniSelect} value={ov.type} onChange={e => updateOverlay(i, 'type', e.target.value)}>
              <option value="SMA">SMA</option>
              <option value="EMA">EMA</option>
            </select>
            <input
              type="number"
              className={styles.sPeriodInput}
              value={ov.period}
              min={1} max={500}
              onChange={e => updateOverlay(i, 'period', e.target.value)}
            />
            <ColorPicker value={ov.color} onChange={v => updateOverlay(i, 'color', v)} />
          </div>
        ))}
      </div>

      {/* Volume */}
      <div className={styles.sGroup}>
        <span className={styles.sLabel}>Volume</span>
        <div className={styles.sRow}>
          <label className={styles.sCheck}>
            <input type="checkbox" checked={cs.volume.visible} onChange={e => update('volume.visible', e.target.checked)} />
            Show
          </label>
          <label className={styles.sCheck}>
            <input type="checkbox" checked={cs.volume.hvcEnabled} onChange={e => update('volume.hvcEnabled', e.target.checked)} />
            HVC
          </label>
          <ColorPicker label="Up" value={cs.volume.upColor} onChange={v => update('volume.upColor', v)} />
          <ColorPicker label="Dn" value={cs.volume.downColor} onChange={v => update('volume.downColor', v)} />
        </div>
      </div>

      {/* Crosshair */}
      <div className={styles.sGroup}>
        <span className={styles.sLabel}>Crosshair</span>
        <div className={styles.sRow}>
          <ColorPicker value={cs.crosshair.color} onChange={v => update('crosshair.color', v)} />
          <select className={styles.sMiniSelect} value={cs.crosshair.style} onChange={e => update('crosshair.style', parseInt(e.target.value))}>
            {CROSSHAIR_STYLES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
      </div>

      {/* Reset */}
      <div className={styles.sGroup} style={{ borderBottom: 'none', paddingBottom: 0 }}>
        <button className={styles.sResetBtn} onClick={() => { if (confirm('Reset chart settings?')) onUpdateSettings(CHART_DEFAULTS) }}>
          Reset to Defaults
        </button>
      </div>
    </div>
  )
}

// ─── Main Toolbar Component ──────────────────────────────────────────────────

export default function ChartToolbar({
  activeTool, setActiveTool,
  color, setColor,
  lineWidth, setLineWidth,
  hasSelection, onDelete, onClearAll,
  drawingCount,
  repeatMode, setRepeatMode,
  chartSettings, onUpdateSettings,
}) {
  const [showColors, setShowColors] = useState(false)
  const [showWidths, setShowWidths] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const colorRef = useRef(null)
  const widthRef = useRef(null)
  const settingsRef = useRef(null)

  // Close popups on outside click
  useEffect(() => {
    const handler = (e) => {
      if (showColors && colorRef.current && !colorRef.current.contains(e.target)) setShowColors(false)
      if (showWidths && widthRef.current && !widthRef.current.contains(e.target)) setShowWidths(false)
      if (showSettings && settingsRef.current && !settingsRef.current.contains(e.target)) setShowSettings(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showColors, showWidths, showSettings])

  const selectTool = (id) => {
    if (id === 'cursor') {
      setActiveTool(activeTool === 'cursor' ? null : 'cursor')
    } else {
      setActiveTool(activeTool === id ? null : id)
    }
  }

  const closeOthers = (keep) => {
    if (keep !== 'colors') setShowColors(false)
    if (keep !== 'widths') setShowWidths(false)
    if (keep !== 'settings') setShowSettings(false)
  }

  return (
    <div className={styles.toolbar}>
      {/* ── Tool buttons ── */}
      <div className={styles.tools}>
        {TOOLS.map((t, i) =>
          t === 'sep' ? <div key={`sep-${i}`} className={styles.sep} /> : (
            <button
              key={t.id}
              className={`${styles.btn} ${activeTool === t.id ? styles.active : ''}`}
              onClick={() => selectTool(t.id)}
              title={t.label}
            >
              {ICONS[t.id]}
            </button>
          )
        )}
      </div>

      {/* ── Bottom actions ── */}
      <div className={styles.actions}>
        <div className={styles.sep} />

        {/* Repeat mode toggle */}
        <button
          className={`${styles.btn} ${repeatMode ? styles.active : ''}`}
          onClick={() => setRepeatMode(!repeatMode)}
          title={repeatMode ? 'Repeat drawing: ON' : 'Repeat drawing: OFF'}
        >
          {ICONS.repeat}
        </button>

        {/* Chart settings */}
        {chartSettings && onUpdateSettings && (
          <div ref={settingsRef} className={styles.pickerWrap}>
            <button
              className={`${styles.btn} ${showSettings ? styles.active : ''}`}
              onClick={() => { setShowSettings(!showSettings); closeOthers('settings') }}
              title="Chart Settings"
            >
              {ICONS.settings}
            </button>
            {showSettings && (
              <ChartSettingsPanel chartSettings={chartSettings} onUpdateSettings={onUpdateSettings} />
            )}
          </div>
        )}

        <div className={styles.sep} />

        {/* Color picker */}
        <div ref={colorRef} className={styles.pickerWrap}>
          <button
            className={styles.btn}
            onClick={() => { setShowColors(!showColors); closeOthers('colors') }}
            title="Color"
          >
            <div className={styles.colorSwatch} style={{ background: color }} />
          </button>
          {showColors && (
            <div className={styles.popup}>
              {COLORS.map(c => (
                <button
                  key={c}
                  className={`${styles.colorOption} ${c === color ? styles.colorActive : ''}`}
                  style={{ background: c }}
                  onClick={() => { setColor(c); setShowColors(false) }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Line width */}
        <div ref={widthRef} className={styles.pickerWrap}>
          <button
            className={styles.btn}
            onClick={() => { setShowWidths(!showWidths); closeOthers('widths') }}
            title={`Line width: ${lineWidth}px`}
          >
            <svg viewBox="0 0 14 14" width="14" height="14">
              <line x1="1" y1="3" x2="13" y2="3" stroke="currentColor" strokeWidth="1" />
              <line x1="1" y1="7" x2="13" y2="7" stroke="currentColor" strokeWidth="2" />
              <line x1="1" y1="11" x2="13" y2="11" stroke="currentColor" strokeWidth="3" />
            </svg>
          </button>
          {showWidths && (
            <div className={styles.popup}>
              {WIDTHS.map(w => (
                <button
                  key={w}
                  className={`${styles.widthOption} ${w === lineWidth ? styles.widthActive : ''}`}
                  onClick={() => { setLineWidth(w); setShowWidths(false) }}
                >
                  <svg viewBox="0 0 28 12" width="28" height="12">
                    <line x1="2" y1="6" x2="26" y2="6" stroke="currentColor" strokeWidth={w} />
                  </svg>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className={styles.sep} />

        {/* Delete selected */}
        <button
          className={`${styles.btn} ${hasSelection ? styles.danger : ''}`}
          onClick={onDelete}
          disabled={!hasSelection}
          title="Delete selected (Del)"
        >
          {ICONS.delete}
        </button>

        {/* Clear all */}
        <button
          className={`${styles.btn} ${drawingCount > 0 ? styles.danger : ''}`}
          onClick={() => { if (drawingCount > 0 && confirm('Clear all drawings on this chart?')) onClearAll() }}
          disabled={!drawingCount}
          title={`Clear all (${drawingCount})`}
        >
          {ICONS.clear}
        </button>
      </div>
    </div>
  )
}

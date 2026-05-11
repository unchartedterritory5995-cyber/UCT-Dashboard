// app/src/components/chart/ChartToolbar.jsx — TradingView-style horizontal drawing toolbar + settings panel
import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { CHART_DEFAULTS, PRESETS, mergeChartSettings } from './chartDefaults'
import ColorPicker from './ColorPicker'
import ComparisonPicker from './ComparisonPicker'
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
  fibext:     I(<><line x1="2" y1="14" x2="14" y2="14" /><line x1="2" y1="10" x2="14" y2="10" strokeDasharray="2 1" /><line x1="2" y1="6" x2="14" y2="6" strokeDasharray="2 1" /><line x1="2" y1="2" x2="14" y2="2" strokeDasharray="4 2" /><line x1="2" y1="0.5" x2="14" y2="0.5" strokeDasharray="4 2" /></>),
  pitchfork:  I(<><line x1="8" y1="13" x2="8" y2="4" /><line x1="3" y1="13" x2="3" y2="7" /><line x1="13" y1="13" x2="13" y2="7" /><path d="M3 7 Q8 4 13 7" fill="none" /></>),
  channel:    I(<><line x1="2" y1="12" x2="11" y2="3" /><line x1="5" y1="14" x2="14" y2="5" /></>),
  avwap:      I(<><path d="M3 12 C5 6, 8 4, 13 5" fill="none" /><circle cx="3" cy="12" r="1.5" fill="currentColor" stroke="none" /><text x="9" y="13" fontSize="6" fill="currentColor" stroke="none" fontFamily="monospace">V</text></>),
  text:       I(<text x="4" y="12.5" fontSize="11" fontWeight="700" fill="currentColor" stroke="none" fontFamily="monospace">T</text>),
  measure:    I(<><rect x="2" y="4" width="12" height="8" strokeDasharray="2 1" /><line x1="4" y1="8" x2="12" y2="8" /><line x1="4" y1="6" x2="4" y2="10" /><line x1="12" y1="6" x2="12" y2="10" /></>),
  position:   I(<><line x1="1" y1="5" x2="15" y2="5" strokeDasharray="none" /><line x1="1" y1="8" x2="15" y2="8" strokeDasharray="2 1" /><line x1="1" y1="11" x2="15" y2="11" strokeDasharray="none" /><text x="12" y="7" fontSize="4" fill="currentColor" stroke="none">T</text><text x="12" y="12" fontSize="4" fill="currentColor" stroke="none">S</text></>),
  delete:     I(<><polyline points="3,5 4,14 12,14 13,5" /><line x1="2" y1="5" x2="14" y2="5" /><line x1="6" y1="3" x2="10" y2="3" /><line x1="7" y1="7" x2="7" y2="12" /><line x1="9" y1="7" x2="9" y2="12" /></>),
  clear:      I(<><line x1="4" y1="4" x2="12" y2="12" /><line x1="12" y1="4" x2="4" y2="12" /></>),
  camera:     I(<><path d="M2 5.5h12v8H2z" /><circle cx="8" cy="9.5" r="2" /><path d="M5.5 5.5l1-2h3l1 2" /></>),
  replay:     I(<><circle cx="8" cy="8" r="6" /><polyline points="8,5 8,8 10,10" /><path d="M3 8 A5 5 0 0 1 8 3" strokeDasharray="2 1" /></>),
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
  { id: 'fibext',     label: 'Fibonacci Extension (Shift+F)' },
  { id: 'pitchfork',  label: 'Pitchfork (Shift+P)' },
  { id: 'channel',    label: 'Parallel Channel' },
  { id: 'avwap',      label: 'Anchored VWAP' },
  'sep',
  { id: 'text',       label: 'Text Note (X)' },
  { id: 'measure',    label: 'Measure (M)' },
  'sep',
  { id: 'position',   label: 'Position Tool (P)' },
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

  const updateIndicator = useCallback((key, field, value) => {
    const numFields = new Set(['period', 'fastPeriod', 'slowPeriod', 'signalPeriod', 'stdDev', 'kPeriod', 'dPeriod', 'step', 'maxStep'])
    const next = { ...cs }
    next.indicators = {
      ...next.indicators,
      [key]: {
        ...next.indicators[key],
        [field]: numFields.has(field)
          ? (['stdDev', 'step', 'maxStep'].includes(field) ? (parseFloat(value) || next.indicators[key][field]) : (parseInt(value) || next.indicators[key][field]))
          : value,
      },
    }
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
        <span className={styles.sLabel}>Moving Averages</span>
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

      {/* Technical Indicators */}
      <div className={styles.sGroup}>
        <span className={styles.sLabel}>Indicators</span>

        {/* RSI */}
        <div className={styles.sOverlayRow}>
          <input type="checkbox"
            checked={cs.indicators?.rsi?.enabled ?? false}
            onChange={e => updateIndicator('rsi', 'enabled', e.target.checked)} />
          <span className={styles.sIndicatorLabel}>RSI</span>
          <input type="number" className={styles.sPeriodInput}
            value={cs.indicators?.rsi?.period ?? 14} min={2} max={100}
            onChange={e => updateIndicator('rsi', 'period', e.target.value)} title="Period" />
          <ColorPicker value={cs.indicators?.rsi?.color ?? '#7b68ee'}
            onChange={v => updateIndicator('rsi', 'color', v)} />
        </div>

        {/* MACD */}
        <div className={styles.sOverlayRow}>
          <input type="checkbox"
            checked={cs.indicators?.macd?.enabled ?? false}
            onChange={e => updateIndicator('macd', 'enabled', e.target.checked)} />
          <span className={styles.sIndicatorLabel}>MACD</span>
          <div className={styles.sMiniPeriodGroup}>
            <input type="number" className={styles.sPeriodInput}
              value={cs.indicators?.macd?.fastPeriod ?? 12} min={1} max={100}
              onChange={e => updateIndicator('macd', 'fastPeriod', e.target.value)} title="Fast" />
            <input type="number" className={styles.sPeriodInput}
              value={cs.indicators?.macd?.slowPeriod ?? 26} min={1} max={200}
              onChange={e => updateIndicator('macd', 'slowPeriod', e.target.value)} title="Slow" />
            <input type="number" className={styles.sPeriodInput}
              value={cs.indicators?.macd?.signalPeriod ?? 9} min={1} max={50}
              onChange={e => updateIndicator('macd', 'signalPeriod', e.target.value)} title="Signal" />
          </div>
        </div>

        {/* Bollinger Bands */}
        <div className={styles.sOverlayRow}>
          <input type="checkbox"
            checked={cs.indicators?.bb?.enabled ?? false}
            onChange={e => updateIndicator('bb', 'enabled', e.target.checked)} />
          <span className={styles.sIndicatorLabel}>BB</span>
          <input type="number" className={styles.sPeriodInput}
            value={cs.indicators?.bb?.period ?? 20} min={2} max={200}
            onChange={e => updateIndicator('bb', 'period', e.target.value)} title="Period" />
          <input type="number" className={styles.sPeriodInput}
            value={cs.indicators?.bb?.stdDev ?? 2} min={0.5} max={5} step={0.5}
            onChange={e => updateIndicator('bb', 'stdDev', e.target.value)} title="Std Dev" />
          <ColorPicker value={cs.indicators?.bb?.color ?? 'rgba(156,39,176,0.85)'}
            onChange={v => updateIndicator('bb', 'color', v)} />
        </div>

        {/* VWAP */}
        <div className={styles.sOverlayRow}>
          <input type="checkbox"
            checked={cs.indicators?.vwap?.enabled ?? false}
            onChange={e => updateIndicator('vwap', 'enabled', e.target.checked)} />
          <span className={styles.sIndicatorLabel}>VWAP</span>
          <span className={styles.sIndicatorNote}>(intraday only)</span>
          <ColorPicker value={cs.indicators?.vwap?.color ?? '#26C6DA'}
            onChange={v => updateIndicator('vwap', 'color', v)} />
        </div>

        {/* Stochastic */}
        <div className={styles.sOverlayRow}>
          <input type="checkbox"
            checked={cs.indicators?.stoch?.enabled ?? false}
            onChange={e => updateIndicator('stoch', 'enabled', e.target.checked)} />
          <span className={styles.sIndicatorLabel}>Stoch</span>
          <div className={styles.sMiniPeriodGroup}>
            <input type="number" className={styles.sPeriodInput}
              value={cs.indicators?.stoch?.kPeriod ?? 14} min={1} max={100}
              onChange={e => updateIndicator('stoch', 'kPeriod', e.target.value)} title="%K Period" />
            <input type="number" className={styles.sPeriodInput}
              value={cs.indicators?.stoch?.dPeriod ?? 3} min={1} max={20}
              onChange={e => updateIndicator('stoch', 'dPeriod', e.target.value)} title="%D Period" />
          </div>
          <ColorPicker value={cs.indicators?.stoch?.kColor ?? '#FF6B6B'}
            onChange={v => updateIndicator('stoch', 'kColor', v)} />
          <ColorPicker value={cs.indicators?.stoch?.dColor ?? '#4ECDC4'}
            onChange={v => updateIndicator('stoch', 'dColor', v)} />
        </div>

        {/* ATR */}
        <div className={styles.sOverlayRow}>
          <input type="checkbox"
            checked={cs.indicators?.atr?.enabled ?? false}
            onChange={e => updateIndicator('atr', 'enabled', e.target.checked)} />
          <span className={styles.sIndicatorLabel}>ATR</span>
          <input type="number" className={styles.sPeriodInput}
            value={cs.indicators?.atr?.period ?? 14} min={1} max={100}
            onChange={e => updateIndicator('atr', 'period', e.target.value)} title="Period" />
          <ColorPicker value={cs.indicators?.atr?.color ?? '#FFA726'}
            onChange={v => updateIndicator('atr', 'color', v)} />
        </div>

        {/* Parabolic SAR */}
        <div className={styles.sOverlayRow}>
          <input type="checkbox"
            checked={cs.indicators?.sar?.enabled ?? false}
            onChange={e => updateIndicator('sar', 'enabled', e.target.checked)} />
          <span className={styles.sIndicatorLabel}>SAR</span>
          <div className={styles.sMiniPeriodGroup}>
            <input type="number" className={styles.sPeriodInput}
              value={cs.indicators?.sar?.step ?? 0.02} min={0.001} max={0.1} step={0.001}
              onChange={e => updateIndicator('sar', 'step', parseFloat(e.target.value) || 0.02)}
              title="Step (acceleration factor)" />
          </div>
          <ColorPicker value={cs.indicators?.sar?.color ?? '#ffeb3b'}
            onChange={v => updateIndicator('sar', 'color', v)} />
        </div>

        {/* Ichimoku Cloud */}
        <div className={styles.sOverlayRow}>
          <input type="checkbox"
            checked={cs.indicators?.ichimoku?.enabled ?? false}
            onChange={e => updateIndicator('ichimoku', 'enabled', e.target.checked)} />
          <span className={styles.sIndicatorLabel}>Ichimoku</span>
          <div className={styles.sMiniPeriodGroup}>
            <ColorPicker value={cs.indicators?.ichimoku?.tenkanColor ?? '#26C6DA'}
              onChange={v => updateIndicator('ichimoku', 'tenkanColor', v)} title="Tenkan" />
            <ColorPicker value={cs.indicators?.ichimoku?.kijunColor ?? '#EF5350'}
              onChange={v => updateIndicator('ichimoku', 'kijunColor', v)} title="Kijun" />
          </div>
        </div>

        {/* Volume Profile */}
        <div className={styles.sOverlayRow}>
          <input type="checkbox"
            checked={cs.indicators?.volumeProfile?.enabled ?? false}
            onChange={e => updateIndicator('volumeProfile', 'enabled', e.target.checked)} />
          <span className={styles.sIndicatorLabel}>Vol Profile</span>
          <input type="number" className={styles.sPeriodInput}
            value={cs.indicators?.volumeProfile?.bins ?? 24} min={8} max={50}
            onChange={e => updateIndicator('volumeProfile', 'bins', e.target.value)}
            title="Number of price bins" />
          <ColorPicker value={cs.indicators?.volumeProfile?.color ?? 'rgba(120,160,100,0.25)'}
            onChange={v => updateIndicator('volumeProfile', 'color', v)} />
        </div>

        {/* MFI — Money Flow Index */}
        <div className={styles.sOverlayRow}>
          <input type="checkbox"
            checked={cs.indicators?.mfi?.enabled ?? false}
            onChange={e => updateIndicator('mfi', 'enabled', e.target.checked)} />
          <span className={styles.sIndicatorLabel}>MFI</span>
          <input type="number" className={styles.sPeriodInput}
            value={cs.indicators?.mfi?.period ?? 14} min={2} max={100}
            onChange={e => updateIndicator('mfi', 'period', e.target.value)} title="Period" />
          <ColorPicker value={cs.indicators?.mfi?.color ?? '#c084fc'}
            onChange={v => updateIndicator('mfi', 'color', v)} />
        </div>

        {/* CCI — Commodity Channel Index */}
        <div className={styles.sOverlayRow}>
          <input type="checkbox"
            checked={cs.indicators?.cci?.enabled ?? false}
            onChange={e => updateIndicator('cci', 'enabled', e.target.checked)} />
          <span className={styles.sIndicatorLabel}>CCI</span>
          <input type="number" className={styles.sPeriodInput}
            value={cs.indicators?.cci?.period ?? 20} min={2} max={200}
            onChange={e => updateIndicator('cci', 'period', e.target.value)} title="Period" />
          <ColorPicker value={cs.indicators?.cci?.color ?? '#fbbf24'}
            onChange={v => updateIndicator('cci', 'color', v)} />
        </div>

        {/* Williams %R */}
        <div className={styles.sOverlayRow}>
          <input type="checkbox"
            checked={cs.indicators?.williamsR?.enabled ?? false}
            onChange={e => updateIndicator('williamsR', 'enabled', e.target.checked)} />
          <span className={styles.sIndicatorLabel}>Williams %R</span>
          <input type="number" className={styles.sPeriodInput}
            value={cs.indicators?.williamsR?.period ?? 14} min={2} max={100}
            onChange={e => updateIndicator('williamsR', 'period', e.target.value)} title="Period" />
          <ColorPicker value={cs.indicators?.williamsR?.color ?? '#60a5fa'}
            onChange={v => updateIndicator('williamsR', 'color', v)} />
        </div>

        {/* ADX / DMI */}
        <div className={styles.sOverlayRow}>
          <input type="checkbox"
            checked={cs.indicators?.adx?.enabled ?? false}
            onChange={e => updateIndicator('adx', 'enabled', e.target.checked)} />
          <span className={styles.sIndicatorLabel}>ADX</span>
          <input type="number" className={styles.sPeriodInput}
            value={cs.indicators?.adx?.period ?? 14} min={2} max={100}
            onChange={e => updateIndicator('adx', 'period', e.target.value)} title="Period" />
          <div className={styles.sMiniPeriodGroup}>
            <ColorPicker value={cs.indicators?.adx?.adxColor ?? '#e5e7eb'}
              onChange={v => updateIndicator('adx', 'adxColor', v)} title="ADX" />
            <ColorPicker value={cs.indicators?.adx?.plusDIColor ?? '#22c55e'}
              onChange={v => updateIndicator('adx', 'plusDIColor', v)} title="+DI" />
            <ColorPicker value={cs.indicators?.adx?.minusDIColor ?? '#ef4444'}
              onChange={v => updateIndicator('adx', 'minusDIColor', v)} title="-DI" />
          </div>
        </div>

        {/* OBV — On-Balance Volume */}
        <div className={styles.sOverlayRow}>
          <input type="checkbox"
            checked={cs.indicators?.obv?.enabled ?? false}
            onChange={e => updateIndicator('obv', 'enabled', e.target.checked)} />
          <span className={styles.sIndicatorLabel}>OBV</span>
          <ColorPicker value={cs.indicators?.obv?.color ?? '#9ca3af'}
            onChange={v => updateIndicator('obv', 'color', v)} />
        </div>

        {/* Donchian Channels */}
        <div className={styles.sOverlayRow}>
          <input type="checkbox"
            checked={cs.indicators?.donchian?.enabled ?? false}
            onChange={e => updateIndicator('donchian', 'enabled', e.target.checked)} />
          <span className={styles.sIndicatorLabel}>Donchian</span>
          <input type="number" className={styles.sPeriodInput}
            value={cs.indicators?.donchian?.period ?? 20} min={2} max={200}
            onChange={e => updateIndicator('donchian', 'period', e.target.value)} title="Period" />
          <ColorPicker value={cs.indicators?.donchian?.color ?? 'rgba(96,165,250,0.5)'}
            onChange={v => updateIndicator('donchian', 'color', v)} />
        </div>
      </div>

      {/* Display Options */}
      <div className={styles.sGroup}>
        <span className={styles.sLabel}>Display</span>
        <div className={styles.sRow}>
          <label className={styles.sCheck}>
            <input type="checkbox"
              checked={cs.heikinAshi ?? false}
              onChange={e => update('heikinAshi', e.target.checked)} />
            Heikin Ashi
          </label>
          <label className={styles.sCheck}>
            <input type="checkbox"
              checked={cs.logScale ?? false}
              onChange={e => update('logScale', e.target.checked)} />
            Log Scale
          </label>
          <label className={styles.sCheck}>
            <input type="checkbox"
              checked={cs.countdown ?? false}
              onChange={e => onUpdateSettings({ ...cs, countdown: e.target.checked, preset: 'custom' })} />
            Countdown to bar close
          </label>
        </div>
        <div className={styles.sRow} style={{ marginTop: 6 }}>
          <label className={styles.sCheck} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>Theme</span>
            <select
              className={styles.sMiniSelect}
              value={cs.theme || 'dark'}
              onChange={e => onUpdateSettings({ ...cs, theme: e.target.value, preset: 'custom' })}
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </label>
        </div>
      </div>

      {/* Chart Markers */}
      <div className={styles.sGroup}>
        <span className={styles.sLabel}>Markers</span>
        <div className={styles.sRow}>
          <label className={styles.sCheck}>
            <input type="checkbox"
              checked={cs.markers?.earnings ?? false}
              onChange={e => {
                const next = { ...cs, markers: { ...cs.markers, earnings: e.target.checked }, preset: 'custom' }
                onUpdateSettings(next)
              }} />
            Earnings
          </label>
          <label className={styles.sCheck}>
            <input type="checkbox"
              checked={cs.markers?.splits ?? false}
              onChange={e => {
                const next = { ...cs, markers: { ...cs.markers, splits: e.target.checked }, preset: 'custom' }
                onUpdateSettings(next)
              }} />
            Splits
          </label>
          <label className={styles.sCheck}>
            <input type="checkbox"
              checked={cs.markers?.dividends ?? false}
              onChange={e => {
                const next = { ...cs, markers: { ...cs.markers, dividends: e.target.checked }, preset: 'custom' }
                onUpdateSettings(next)
              }} />
            Dividends
          </label>
          <label className={styles.sCheck}>
            <input type="checkbox"
              checked={cs.markers?.news ?? false}
              onChange={e => {
                const next = { ...cs, markers: { ...cs.markers, news: e.target.checked }, preset: 'custom' }
                onUpdateSettings(next)
              }} />
            News markers
          </label>
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

function formatReplayDate(t) {
  if (!t) return ''
  if (typeof t === 'string') return t
  const d = new Date(t * 1000)
  return d.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' })
}

export default function ChartToolbar({
  activeTool, setActiveTool,
  color, setColor,
  lineWidth, setLineWidth,
  hasSelection, onDelete, onClearAll,
  drawingCount,
  repeatMode, setRepeatMode,
  chartSettings, onUpdateSettings,
  showExtended, onToggleExtended,
  onScreenshot,
  tf = null,
  currentSym = null,
  compareSymbol = null,
  onCompareChange = null,
  replayMode = false,
  replayPlaying = false,
  replaySpeed = 1,
  replayDate = null,
  replayIndex = 0,
  replayTotal = 0,
  onReplayToggle = null,
  onReplayPlayPause = null,
  onReplayStep = null,
  onReplayIndexChange = null,
  onReplaySpeedChange = null,
  onShowHelp = null,
}) {
  const [showColors, setShowColors] = useState(false)
  const [showWidths, setShowWidths] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [comparePopoverOpen, setComparePopoverOpen] = useState(false)
  const colorRef = useRef(null)
  const widthRef = useRef(null)
  const settingsRef = useRef(null)
  const compareRef = useRef(null)

  // Comparison symbols update handler: merge into chartSettings via onUpdateSettings
  const cs = chartSettings
  const updateComparisons = useCallback((arr) => {
    if (!onUpdateSettings || !cs) return
    onUpdateSettings({ ...cs, comparisonSymbols: arr, preset: 'custom' })
  }, [cs, onUpdateSettings])

  // Click-outside handler for compare popover
  useEffect(() => {
    if (!comparePopoverOpen) return
    function onClickOutside(e) {
      if (compareRef.current && !compareRef.current.contains(e.target)) {
        setComparePopoverOpen(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [comparePopoverOpen])

  // ── Countdown to bar close ──
  const INTRADAY_SECONDS = { '1': 60, '5': 300, '15': 900, '30': 1800, '60': 3600 }
  const periodSec = INTRADAY_SECONDS[tf]
  const [countdown, setCountdown] = useState(null)

  useEffect(() => {
    if (!periodSec) { setCountdown(null); return }
    const tick = () => {
      const nowSec = Math.floor(Date.now() / 1000)
      const rem = periodSec - (nowSec % periodSec)
      const mm = String(Math.floor(rem / 60)).padStart(2, '0')
      const ss = String(rem % 60).padStart(2, '0')
      setCountdown(`${mm}:${ss}`)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [periodSec])

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
    <>
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

        {/* Extended hours toggle (intraday only) */}
        {showExtended !== null && onToggleExtended && (
          <button
            className={`${styles.btn} ${showExtended ? styles.active : ''}`}
            onClick={() => onToggleExtended(!showExtended)}
            title={showExtended ? 'Extended hours: ON (click for regular session only)' : 'Regular session only (click for extended hours)'}
            style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.5, padding: '2px 6px' }}
          >
            {showExtended ? 'EXT' : 'RTH'}
          </button>
        )}

        {/* ── Compare symbol input ── */}
        {onCompareChange && (
          <div className={styles.compareWrap}>
            <input
              type="text"
              className={styles.compareInput}
              placeholder="+ Compare"
              value={compareSymbol || ''}
              onChange={e => onCompareChange(e.target.value.toUpperCase())}
              onKeyDown={e => { if (e.key === 'Escape') { onCompareChange(''); e.target.blur() } }}
              maxLength={10}
            />
          </div>
        )}

        {/* ── Countdown to bar close ── */}
        {countdown && (
          <span className={styles.countdown} title="Time until bar closes">
            {countdown}
          </span>
        )}

        {/* ── Screenshot ── */}
        {onScreenshot && (
          <button className={styles.btn} onClick={onScreenshot} title="Download chart as PNG">
            {ICONS.camera}
          </button>
        )}

        {/* ── Help (keyboard shortcuts) ── */}
        {onShowHelp && (
          <button
            className={styles.btn}
            onClick={() => onShowHelp?.()}
            title="Keyboard shortcuts (press ?)"
            aria-label="Show keyboard shortcuts"
            style={{ fontSize: 12, fontWeight: 700 }}
          >
            ?
          </button>
        )}

        {/* ── Replay / Time Machine ── */}
        {onReplayToggle && (
          <button
            className={`${styles.btn} ${replayMode ? styles.active : ''}`}
            onClick={onReplayToggle}
            title="Replay / Time Machine"
          >
            {ICONS.replay}
          </button>
        )}

        {/* Compare symbols */}
        {chartSettings && onUpdateSettings && (
          <div ref={compareRef} className={styles.compareContainer}>
            <button
              className={`${styles.btn} ${comparePopoverOpen ? styles.active : ''}`}
              onClick={() => setComparePopoverOpen(o => !o)}
              title="Compare symbols"
              aria-label="Compare symbols"
            >
              <span style={{ fontSize: 13, lineHeight: 1 }}>⇄</span>
              {(cs?.comparisonSymbols?.length > 0) && (
                <span className={styles.compareBadge}>{cs.comparisonSymbols.length}</span>
              )}
            </button>
            {comparePopoverOpen && (
              <ComparisonPicker
                comparisons={cs?.comparisonSymbols || []}
                onUpdate={updateComparisons}
                onClose={() => setComparePopoverOpen(false)}
                currentSym={currentSym}
              />
            )}
          </div>
        )}

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

    {/* ── Replay controls bar ── */}
    {replayMode && (
      <div className={styles.replayBar}>
        <button
          className={styles.replayBtn}
          onClick={() => onReplayIndexChange?.(0)}
          title="Restart from beginning"
        >⏮</button>
        <button className={styles.replayBtn} onClick={() => onReplayStep?.(-10)} title="Back 10">«</button>
        <button className={styles.replayBtn} onClick={() => onReplayStep?.(-1)} title="Back 1">‹</button>
        <button className={`${styles.replayBtn} ${styles.replayPlay}`} onClick={onReplayPlayPause}>
          {replayPlaying ? '⏸' : '▶'}
        </button>
        <button className={styles.replayBtn} onClick={() => onReplayStep?.(1)} title="Fwd 1">›</button>
        <button className={styles.replayBtn} onClick={() => onReplayStep?.(10)} title="Fwd 10">»</button>
        <button
          className={styles.replayBtn}
          onClick={() => onReplayIndexChange?.(Math.max(0, (replayTotal || 1) - 1))}
          title="Skip to end"
        >⏭</button>
        {replayTotal > 1 && (
          <input
            type="range"
            min={0}
            max={Math.max(0, replayTotal - 1)}
            value={Math.min(replayIndex || 0, Math.max(0, replayTotal - 1))}
            onChange={e => onReplayIndexChange?.(parseInt(e.target.value, 10))}
            className={styles.replaySlider}
            title="Scrub timeline"
          />
        )}
        {replayDate && <span className={styles.replayDate}>{formatReplayDate(replayDate)}</span>}
        <div className={styles.replaySpeeds}>
          {[1, 5, 20].map(s => (
            <button
              key={s}
              className={`${styles.replaySpeedBtn} ${replaySpeed === s ? styles.replaySpeedActive : ''}`}
              onClick={() => onReplaySpeedChange?.(s)}
            >{s}×</button>
          ))}
        </div>
        <button className={styles.replayExit} onClick={onReplayToggle}>✕ Exit</button>
      </div>
    )}
    </>
  )
}

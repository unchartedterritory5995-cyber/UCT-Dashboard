// app/src/components/chart/ChartToolbar.jsx — TradingView-style horizontal drawing toolbar + settings panel
import { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback, forwardRef, useImperativeHandle } from 'react'
import { createPortal } from 'react-dom'
import { CHART_DEFAULTS, PRESETS, mergeChartSettings } from './chartDefaults'
import { legendModeOf, nextLegendMode } from './legendMode'
import ColorPicker, { PORTAL_POPUP_ATTR } from './ColorPicker'
import ColorPanel from './ColorPanel'
import ComparisonPicker from './ComparisonPicker'
import UIcon from '../ui/UIcon'
import IndicatorAlertPopover from './IndicatorAlertPopover'
import IndicatorLibraryDialog from './IndicatorLibraryDialog'
import BuilderSheet from './builder/BuilderSheet'
import PatternToolbarButton from './PatternToolbarButton'
import { SIGNATURE_ROWS, SIGNATURE_LOCKED_TITLE } from './signatureToggles'
import { ENGINE_OWNED } from './engine/flipState'
import { isIndicatorEnabled } from './engine/instanceControls'
import * as engineRegistry from './engine/nativeRegistry'
import { catalogRows, labelFor, oscillatorIds } from './indicatorCatalog'
import { useIsPaid } from '../../context/AuthContext'
import { formatETDate } from '../../utils/timeAgo'
import { toolbarFor } from '../../utils/dividerColor'
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
  cup:        I(<><path d="M2.5 4 Q8 15 13.5 4" fill="none" /><circle cx="2.5" cy="4" r="1.4" fill="currentColor" stroke="none" /><circle cx="13.5" cy="4" r="1.4" fill="currentColor" stroke="none" /></>),
  avwap:      I(<><path d="M3 12 C5 6, 8 4, 13 5" fill="none" /><circle cx="3" cy="12" r="1.5" fill="currentColor" stroke="none" /><text x="9" y="13" fontSize="6" fill="currentColor" stroke="none" fontFamily="monospace">V</text></>),
  text:       I(<text x="4" y="12.5" fontSize="11" fontWeight="700" fill="currentColor" stroke="none" fontFamily="monospace">T</text>),
  measure:    I(<><rect x="2" y="4" width="12" height="8" strokeDasharray="2 1" /><line x1="4" y1="8" x2="12" y2="8" /><line x1="4" y1="6" x2="4" y2="10" /><line x1="12" y1="6" x2="12" y2="10" /></>),
  advance:    I(<><line x1="2" y1="13" x2="9" y2="6" /><polyline points="6,6 9,6 9,9" fill="none" /><text x="8.5" y="14" fontSize="6" fontWeight="700" fill="currentColor" stroke="none" fontFamily="monospace">%</text></>),
  position:   I(<><line x1="1" y1="5" x2="15" y2="5" strokeDasharray="none" /><line x1="1" y1="8" x2="15" y2="8" strokeDasharray="2 1" /><line x1="1" y1="11" x2="15" y2="11" strokeDasharray="none" /><text x="12" y="7" fontSize="4" fill="currentColor" stroke="none">T</text><text x="12" y="12" fontSize="4" fill="currentColor" stroke="none">S</text></>),
  delete:     I(<><polyline points="3,5 4,14 12,14 13,5" /><line x1="2" y1="5" x2="14" y2="5" /><line x1="6" y1="3" x2="10" y2="3" /><line x1="7" y1="7" x2="7" y2="12" /><line x1="9" y1="7" x2="9" y2="12" /></>),
  clear:      I(<><line x1="4" y1="4" x2="12" y2="12" /><line x1="12" y1="4" x2="4" y2="12" /></>),
  undo:       I(<><polyline points="6,4 2.5,7.5 6,11" /><path d="M2.5 7.5 H10 a3.5 3.5 0 0 1 0 7 H6.5" /></>),
  redo:       I(<><polyline points="10,4 13.5,7.5 10,11" /><path d="M13.5 7.5 H6 a3.5 3.5 0 0 0 0 7 H9.5" /></>),
  chevronLeft:  I(<polyline points="10,3 5,8 10,13" fill="none" />),
  chevronRight: I(<polyline points="6,3 11,8 6,13" fill="none" />),
  eye:        I(<><path d="M1 8s2.6-4.5 7-4.5S15 8 15 8s-2.6 4.5-7 4.5S1 8 1 8z" /><circle cx="8" cy="8" r="1.8" /></>),
  eyeOff:     I(<><path d="M1 8s2.6-4.5 7-4.5c1 0 1.9.2 2.7.6M15 8s-2.6 4.5-7 4.5c-1 0-1.9-.2-2.7-.6" /><line x1="2.5" y1="2.5" x2="13.5" y2="13.5" /></>),
  camera:     I(<><path d="M2 5.5h12v8H2z" /><circle cx="8" cy="9.5" r="2" /><path d="M5.5 5.5l1-2h3l1 2" /></>),
  // The button this sits on opens the Share popover (copy image / download /
  // copy link), not a screenshot-to-disk action. The camera icon said "save",
  // which is why the clipboard copy went unfound.
  share:      I(<><circle cx="12" cy="3.5" r="1.8" /><circle cx="12" cy="12.5" r="1.8" /><circle cx="4" cy="8" r="1.8" /><path d="M5.6 7.1l4.8-2.7M5.6 8.9l4.8 2.7" /></>),
  replay:     I(<><circle cx="8" cy="8" r="6" /><polyline points="8,5 8,8 10,10" /><path d="M3 8 A5 5 0 0 1 8 3" strokeDasharray="2 1" /></>),
  favorites:  I(<path d="M8 1.6l1.85 3.75 4.15.6-3 2.93.71 4.12L8 11.06 4.29 13l.71-4.12-3-2.93 4.15-.6z" fill="currentColor" stroke="currentColor" strokeWidth="0.6" strokeLinejoin="round" />),
  starOutline: I(<path d="M8 1.6l1.85 3.75 4.15.6-3 2.93.71 4.12L8 11.06 4.29 13l.71-4.12-3-2.93 4.15-.6z" fill="none" />),
  grip:       I(<><circle cx="6" cy="4" r="1" fill="currentColor" stroke="none" /><circle cx="6" cy="8" r="1" fill="currentColor" stroke="none" /><circle cx="6" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="10" cy="4" r="1" fill="currentColor" stroke="none" /><circle cx="10" cy="8" r="1" fill="currentColor" stroke="none" /><circle cx="10" cy="12" r="1" fill="currentColor" stroke="none" /></>),
  check:      I(<polyline points="3,8.5 6.5,12 13,4" />),
}

// ─── Drawing-tools customization (show/hide + favorites) ─────────────────────
// Persisted per-browser. `hidden` = tool ids removed from the main toolbar;
// `favorites` = tool ids surfaced on the floating quick-toolbar. All tools are
// visible by default (empty hidden set).
const LS_HIDDEN = 'uct.chart.drawtools.hidden.v1'
const LS_FAV = 'uct.chart.drawtools.favorites.v1'
const LS_FAVPOS = 'uct.chart.drawtools.favpos.v1'
const _loadArr = (k) => { try { const a = JSON.parse(localStorage.getItem(k) || '[]'); return Array.isArray(a) ? a : [] } catch { return [] } }
const _saveArr = (k, a) => { try { localStorage.setItem(k, JSON.stringify(a)) } catch { /* ignore */ } }

// ─── Tool definitions ────────────────────────────────────────────────────────
const TOOLS = [
  // Select/cursor button removed — you can hover-and-drag annotations with no tool
  // armed (the default), so a dedicated Select mode is redundant.
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
  { id: 'cup',        label: 'Cup Curve — click the left rim, the bottom, then the right rim' },
  { id: 'avwap',      label: 'Anchored VWAP' },
  'sep',
  { id: 'text',       label: 'Text Note (X)' },
  { id: 'measure',    label: 'Measure (M)' },
  { id: 'advance',    label: 'Advance % Label — click the setup candle, then the candle where the move tops' },
  'sep',
  { id: 'position',   label: 'Position Tool (P)' },
]

const WIDTHS = [1, 2, 3]
const FONT_SIZES = [10, 13, 16, 20, 26, 34, 44]

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

// `volumePaneFixed` = a reason string when the SURFACE hosting this chart owns the
// volume layout (it passes StockChart's volumeSeparatePane / volumePaneHeightPct,
// which win over the saved prefs). StockChart derives it from those very props, so
// the two can't drift. Non-null ⇒ the two volume-pane controls render inert with the
// reason instead of writing a pref this chart will ignore.
function ChartSettingsPanel({
  chartSettings, onUpdateSettings, onOpenIndicatorLibrary,
  onOpenFormulaBuilder, volumePaneFixed = null,
}) {
  const cs = chartSettings
  const isPaid = useIsPaid()

  // ── B4 TASK 8: THE ROWS THAT NEEDED THE HONESTY TREATMENT ARE GONE ────────
  //
  // What stood here was `engineInputs` / `engineDrawn` / `engineInert` /
  // `shownInput` / `inertTitle`: the machinery that kept fifteen per-indicator
  // rows from lying about what the engine was drawing. Spec §6 turned those rows
  // into one launcher, so the predicate has no subject and no reader, and an
  // inert helper reads as live logic. `ChartToolbar.engineInert.test.jsx` is
  // RETARGETED rather than deleted: what stays failable is that no per-indicator
  // writer comes back to this surface.
  //
  // `isOn` survives because the volume-overlay strip and the launcher's count
  // both need it, and it is the ONE reader — a count off the raw mirror reports
  // a tombstoned indicator as on.
  /**
   * Is this indicator on? Through `instanceControls` for a FLIPPED id — after
   * Flip B a tombstone can say "off" while the legacy toggle still says "on",
   * and a checkbox reading the wrong one of those re-checks itself on the next
   * render. For every other id this is the expression that has always been in
   * the `checked` attribute, character for character.
   */
  const isOn = useCallback((key) => (ENGINE_OWNED.has(key)
    ? isIndicatorEnabled(cs, key, ENGINE_OWNED)
    : (cs.indicators?.[key]?.enabled ?? false)), [cs])
  const update = useCallback((path, value) => {
    const next = { ...cs }
    const parts = path.split('.')
    if (parts.length === 3) {
      const [section, sub, key] = parts
      next[section] = { ...next[section], [sub]: { ...next[section][sub], [key]: value } }
    } else if (parts.length === 2) {
      const [section, key] = parts
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

  /** How many indicators are on, THROUGH `isOn`. `catalogRows()` is definitions
   *  ∪ the carved-out sections, so `volumeProfile` counts — it has a row in the
   *  library like everything else. */
  const activeCount = useMemo(() => catalogRows().filter((r) => isOn(r.id)).length, [isOn])

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

      {/* UCT Signature — premium overlays. Sits 4th, right after Candles:
          it is the panel's headline feature and was buried at 10th, below
          Watermark and Volume, where nobody scrolled to it (owner decision
          (e), 2026-08-01). Pure position change — same JSX, same state keys,
          same gate.
          Free users get the rows disabled with
          a lock, not hidden: the affordance is the sales pitch. The authoritative
          gate is the backend's 402 (and the fetch hook's own isPaid check) — this
          only decides what the panel offers. */}
      <div className={styles.sGroup}>
        <span className={styles.sLabel}>UCT Signature</span>
        <div className={styles.sRow}>
          {SIGNATURE_ROWS.map(([key, label, tip]) => (
            <label key={key} className={styles.sCheck} title={isPaid ? tip : SIGNATURE_LOCKED_TITLE}>
              <input type="checkbox"
                disabled={!isPaid}
                checked={cs.signature?.[key] ?? false}
                onChange={e => update(`signature.${key}`, e.target.checked)} />
              {label}
              {/* `title` is load-bearing, not decoration: it flips UIcon from
                  aria-hidden to role="img" + <title>, which is the ONLY premium
                  signal a screen reader gets here — the row's own title attr is
                  unreliable to AT and the disabled checkbox is out of tab order.
                  NavBar goes the OTHER way on purpose: its lock is aria-hidden
                  with no title because its row already says "— unlock with Pro"
                  in the accessible name. This row's label is just the indicator
                  name, so the icon has to carry it. */}
              {!isPaid && <UIcon name="lock" size={10} gold title="Premium" />}
            </label>
          ))}
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

      {/* ── Watermark ── */}
      <div className={styles.sGroup}>
        <span className={styles.sLabel}>Watermark</span>
        <div className={styles.sRow}>
          <label className={styles.sCheck}>
            <input type="checkbox" checked={cs.watermark.lines.ticker} onChange={e => update('watermark.lines.ticker', e.target.checked)} />
            Ticker
          </label>
          <label className={styles.sCheck}>
            <input type="checkbox" checked={cs.watermark.lines.company} onChange={e => update('watermark.lines.company', e.target.checked)} />
            Company
          </label>
        </div>
        <div className={styles.sRow}>
          <label className={styles.sCheck}>
            <input type="checkbox" checked={cs.watermark.lines.sector} onChange={e => update('watermark.lines.sector', e.target.checked)} />
            Sector
          </label>
          <label className={styles.sCheck}>
            <input type="checkbox" checked={cs.watermark.lines.industry} onChange={e => update('watermark.lines.industry', e.target.checked)} />
            Industry
          </label>
        </div>
        <div className={styles.sRow}>
          <label className={styles.sCheck}>
            <input type="checkbox" checked={cs.watermark.lines.theme} onChange={e => update('watermark.lines.theme', e.target.checked)} />
            UCT Theme
          </label>
        </div>
        <div className={styles.sRow} style={{ marginTop: 6 }}>
          <ColorPicker label="Color" value={cs.watermark.color} onChange={v => update('watermark.color', v)} />
        </div>
        <div className={styles.sRow} style={{ marginTop: 6, alignItems: 'center' }}>
          <span>Opacity</span>
          <input type="range" min={0} max={0.3} step={0.01} value={cs.watermark.opacity}
            onChange={e => update('watermark.opacity', parseFloat(e.target.value))} />
          <span>{Math.round(cs.watermark.opacity * 100)}%</span>
        </div>
        <div className={styles.sRow} style={{ marginTop: 6, alignItems: 'center' }}>
          <span>Size</span>
          <input type="range" min={0.5} max={2} step={0.1} value={cs.watermark.sizeScale}
            onChange={e => update('watermark.sizeScale', parseFloat(e.target.value))} />
          <span>{cs.watermark.sizeScale.toFixed(1)}×</span>
        </div>
        <div className={styles.sRow} style={{ marginTop: 6 }}>
          <button type="button" className={styles.sMiniSelect}
            onClick={() => { update('watermark.x', 0.5); update('watermark.y', 0.5) }}>
            Reset to center
          </button>
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
          <label
            className={styles.sCheck}
            style={volumePaneFixed ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
            title={volumePaneFixed || 'Show volume in its own pane below price instead of overlaid on the chart'}
          >
            <input type="checkbox" disabled={!!volumePaneFixed}
              checked={!!cs.volume.separatePane} onChange={e => update('volume.separatePane', e.target.checked)} />
            Separate pane
          </label>
          <ColorPicker label="Up" value={cs.volume.upColor} onChange={v => update('volume.upColor', v)} />
          <ColorPicker label="Dn" value={cs.volume.downColor} onChange={v => update('volume.downColor', v)} />
        </div>
        {/* Shown whenever volume actually renders in a pane — which on a
            volumePaneFixed surface is ALWAYS, regardless of the saved toggle.
            Hiding it there would leave the user hunting for a control that the
            chart simply doesn't take its height from; showing it inert says so. */}
        {(cs.volume.separatePane || volumePaneFixed) && (
          <div className={styles.sRow} style={{ marginTop: 6 }}>
            <label
              className={styles.sCheck}
              style={volumePaneFixed ? { gap: 6, opacity: 0.45, cursor: 'not-allowed' } : { gap: 6 }}
              title={volumePaneFixed || 'Height of the separate volume pane (% of chart)'}
            >
              Pane height
              <input type="range" min={8} max={45} step={1} disabled={!!volumePaneFixed}
                value={cs.volume.paneHeightPct ?? 22}
                onChange={e => update('volume.paneHeightPct', parseInt(e.target.value))} />
              <span style={{ minWidth: 28, textAlign: 'right' }}>{cs.volume.paneHeightPct ?? 22}%</span>
            </label>
          </div>
        )}
        {(() => {
          // Move enabled oscillators into the volume pane (left axis) — the same
          // derivation the right-click menu uses, so the two strips cannot drift.
          // This was a second copy of `StockChart`'s `OSC_OPTS`, in another file,
          // spelling `williamsR` a third way again (`W%R` here, `Williams %R`
          // there, `Williams %R` in `chartRegion`).
          // …through `isOn`, the same reader the checkboxes use. For a FLIPPED id
          // the legacy toggle is the MIRROR, not the switch — a deleted RSI must
          // not still offer "overlay it on the volume pane".
          const enabled = oscillatorIds().filter((k) => isOn(k))
          if (!cs.volume.visible || enabled.length === 0) return null
          const cur = Array.isArray(cs.volumeOverlayIndicators) ? cs.volumeOverlayIndicators : []
          return (
            <div className={styles.sRow} style={{ marginTop: 6, flexWrap: 'wrap' }}>
              <span style={{ width: '100%', marginBottom: 2, fontSize: 11, opacity: 0.7 }}>Overlay on volume pane:</span>
              {enabled.map((k) => (
                <label key={k} className={styles.sCheck} title={`Render ${labelFor(k)} inside the volume pane`}>
                  <input type="checkbox" checked={cur.includes(k)}
                    onChange={() => update('volumeOverlayIndicators', cur.includes(k) ? cur.filter(x => x !== k) : [...cur, k])} />
                  {labelFor(k)}
                </label>
              ))}
            </div>
          )
        })()}
      </div>

      {/* Indicators — spec §6: the gear panel's checkbox rows become a
          LAUNCHER. Every control they carried is on the generated dialog, and
          the dialog reaches inputs this surface never could: `sar.maxStep`, six
          of `ichimoku`'s eight, MACD's two colours and VWAP's opacity / line
          style / line width. Fifteen rows that duplicated a surface which now
          covers them is the enumeration this phase exists to end.

          ⚠️ `updateIndicator`, `engineInert`, `inertTitle` and `shownInput`
          retire WITH the rows. `engineInert` existed to say "this control is
          drawn by the engine and this field is not what sets it"; with no
          controls left there is nothing to tell the truth about, and an inert
          helper reads as live logic. `isOn` and `update` stay — the volume
          overlay strip and the rest of the panel use them. */}
      <div className={styles.sGroup}>
        <span className={styles.sLabel}>Indicators</span>
        <button
          type="button"
          className={styles.sLauncher}
          onClick={() => onOpenIndicatorLibrary?.()}
        >
          <span>Manage indicators</span>
          {/* ⛔ COUNTED THROUGH `isOn`, the reader every other control on this
              surface uses. A count read off `cs.indicators[id].enabled` says 2
              for a TOMBSTONED indicator as well — a number over a chart that
              is not drawing it. */}
          <span className={styles.sLauncherCount}>{activeCount}</span>
          <span aria-hidden="true">→</span>
        </button>
        {/* ⭐ PHASE D TASK 11 — THE BUILDER'S **ONE** ENTRY POINT.
            It sits beside "Manage indicators" because it is the same act one
            step further out: that launcher browses definitions somebody else
            authored, this one authors a definition. Both live on the settings
            panel, which renders only behind `chartSettings && onUpdateSettings`
            — spec §5's mount-site scoping, and the reason a read-only chart
            cannot sprout an author surface without a second prop that could
            disagree with the first. */}
        <button
          type="button"
          className={styles.sLauncher}
          onClick={() => onOpenFormulaBuilder?.()}
        >
          <span>New formula</span>
          <span aria-hidden="true">→</span>
        </button>
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
          <label className={styles.sCheck} title="Show pre-market (4:00–9:30) and post-market (16:00–20:00) price data + shading on intraday charts. Off = regular session only (9:30–4:00), with overnight gaps.">
            <input type="checkbox"
              checked={cs.extendedHoursShading ?? false}
              onChange={e => update('extendedHoursShading', e.target.checked)} />
            Extended hours
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

      {/* Swing high/low price labels */}
      <div className={styles.sGroup}>
        <span className={styles.sLabel}>Swing labels</span>
        <div className={styles.sRow}>
          <label className={styles.sCheck} title="Print the price at each notable swing high and swing low, MarketSurge-style">
            <input type="checkbox"
              checked={cs.swingLabels?.enabled ?? false}
              onChange={e => update('swingLabels.enabled', e.target.checked)} />
            Swing prices
          </label>
          <label className={styles.sCheck} style={{ display: 'flex', alignItems: 'center', gap: 6 }} title="How aggressively swings are detected">
            <span>Sensitivity</span>
            <select
              className={styles.sMiniSelect}
              value={cs.swingLabels?.sensitivity || 'medium'}
              onChange={e => update('swingLabels.sensitivity', e.target.value)}
            >
              <option value="low">Low</option>
              <option value="medium">Med</option>
              <option value="high">High</option>
            </select>
          </label>
        </div>
        <div className={styles.sRow} style={{ marginTop: 6 }}>
          <ColorPicker label="Color" value={cs.swingLabels?.color ?? '#d4d0c4'} onChange={v => update('swingLabels.color', v)} />
          <label className={styles.sCheck} title="Tint swing-high labels with the up-color and swing-low labels with the down-color">
            <input type="checkbox"
              checked={cs.swingLabels?.tintByType ?? false}
              onChange={e => update('swingLabels.tintByType', e.target.checked)} />
            Tint by type
          </label>
          {cs.swingLabels?.tintByType && (
            <>
              <ColorPicker label="Up" value={cs.swingLabels?.upColor ?? '#4ade80'} onChange={v => update('swingLabels.upColor', v)} />
              <ColorPicker label="Dn" value={cs.swingLabels?.downColor ?? '#f87171'} onChange={v => update('swingLabels.downColor', v)} />
            </>
          )}
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
          {/* Desk mentions (spec 2026-08-11 §C). This panel is the SECOND surface for
              cs.markers — ChartSettingsModal's Markers tab is the other — so a new
              category has to be added in both or the toggle is missing wherever the
              user happens to open settings. */}
          <label className={styles.sCheck}>
            <input type="checkbox"
              checked={cs.markers?.desk ?? false}
              onChange={e => {
                const next = { ...cs, markers: { ...cs.markers, desk: e.target.checked }, preset: 'custom' }
                onUpdateSettings(next)
              }} />
            Desk mentions
          </label>
        </div>
      </div>

      {/* Previous-day High / Low / Close reference lines (intraday only) */}
      <div className={styles.sGroup}>
        <span className={styles.sLabel}>Prev-day levels · intraday</span>
        {[['high', 'Prev high', '#3cb868'], ['low', 'Prev low', '#e74c3c'], ['close', 'Prev close', '#9aa0a6']].map(([key, label, def]) => {
          const c = cs.prevDayLevels?.[key] || {}
          const setPdl = (patch) => onUpdateSettings({ ...cs, prevDayLevels: { ...cs.prevDayLevels, [key]: { ...c, ...patch } }, preset: 'custom' })
          return (
            <div className={styles.sRow} key={key}>
              <label className={styles.sCheck}>
                <input type="checkbox" checked={!!c.enabled} onChange={e => setPdl({ enabled: e.target.checked })} />
                {label}
              </label>
              {c.enabled && (<>
                <ColorPicker value={c.color || def} onChange={v => setPdl({ color: v })} />
                <select className={styles.sMiniSelect} value={c.style || 'dashed'} onChange={e => setPdl({ style: e.target.value })}>
                  <option value="solid">Solid</option>
                  <option value="dashed">Dashed</option>
                  <option value="dotted">Dotted</option>
                </select>
                <select className={styles.sMiniSelect} value={c.width || 1} onChange={e => setPdl({ width: Number(e.target.value) })}>
                  {[1, 2, 3, 4].map(w => <option key={w} value={w}>{w}px</option>)}
                </select>
              </>)}
            </div>
          )
        })}
      </div>

      {/* Crosshair */}
      <div className={styles.sGroup}>
        <span className={styles.sLabel}>Crosshair</span>
        <div className={styles.sRow}>
          <ColorPicker value={cs.crosshair.color} onChange={v => update('crosshair.color', v)} />
          <select className={styles.sMiniSelect} value={cs.crosshair.style} onChange={e => update('crosshair.style', parseInt(e.target.value))}>
            {CROSSHAIR_STYLES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <label className={styles.sCheck} title="Snap the crosshair to OHLC values">
            <input type="checkbox" checked={!!cs.crosshair.magnet} onChange={e => update('crosshair.magnet', e.target.checked)} />
            Magnet
          </label>
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

// Dropdown to show/hide + favorite drawing tools. Styled to match the info-row
// "add a field" menu (dark, search on top, checkmark on shown rows, star on right).
function FavoriteDrawingsMenu({ tools, hidden, favorites, onToggleHidden, onToggleFavorite, anchorRect, onClose }) {
  const [q, setQ] = useState('')
  const ref = useRef(null)
  useEffect(() => {
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose() }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [onClose])
  const filtered = tools.filter(t => t.label.toLowerCase().includes(q.toLowerCase()))
  const left = Math.min(anchorRect?.left ?? 100, window.innerWidth - 272)
  const top = (anchorRect?.bottom ?? 40) + 4
  return createPortal(
    <div ref={ref} className={styles.menuScroll} style={{ position: 'fixed', left: Math.max(8, left), top, width: 260, maxHeight: '68vh',
        overflowY: 'auto', zIndex: 1000, background: 'var(--menu-bg,#14171c)',
        border: '1px solid var(--menu-border,#232932)', borderRadius: 8, boxShadow: '0 8px 28px rgba(0,0,0,0.5)',
        padding: 6, fontFamily: "'Instrument Sans', sans-serif" }}>
      <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search tools…"
        style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', marginBottom: 4,
          background: 'var(--menu-bg-2,#1b1f26)', border: '1px solid var(--menu-border,#232932)', borderRadius: 6,
          color: 'var(--menu-text,#e8eaed)', fontSize: 13, outline: 'none' }} />
      {filtered.map(t => {
        const visible = !hidden.includes(t.id)
        const fav = favorites.includes(t.id)
        return (
          <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px', borderRadius: 6 }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--menu-accent-bg,rgba(201,168,76,0.1))' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
            <span onClick={() => onToggleHidden(t.id)} style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0, cursor: 'pointer' }}>
              <span style={{ width: 14, height: 14, color: '#c9a84c', flexShrink: 0, display: 'flex' }}>{visible ? ICONS.check : null}</span>
              <span style={{ width: 16, color: 'var(--menu-text,#e8eaed)', opacity: visible ? 1 : 0.45, flexShrink: 0, display: 'flex' }}>{ICONS[t.id]}</span>
              <span style={{ color: 'var(--menu-text,#e8eaed)', opacity: visible ? 1 : 0.45, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.label.replace(/\s*\([^)]*\)\s*$/, '')}</span>
            </span>
            <span onClick={() => onToggleFavorite(t.id)} title={fav ? 'Remove from favorites toolbar' : 'Add to favorites toolbar'}
              style={{ flexShrink: 0, color: fav ? '#c9a84c' : 'var(--menu-text-muted,#6b7280)', display: 'flex', cursor: 'pointer' }}>
              {fav ? ICONS.favorites : ICONS.starOutline}
            </span>
          </div>
        )
      })}
    </div>, document.body)
}

// Floating, draggable quick-toolbar of the user's FAVORITE drawing tools. Matches
// the canvas via the same --chart-toolbar-* vars StockChart publishes.
//
// It portals to <body> (fixed positioning) but is CONFINED to the chart container:
// `pos` is an OFFSET from the container's top-left, and both the drag and the
// render clamp it so the whole bar stays inside the chart widget — it can never be
// dragged out into the page. `boundsRef` is the chart container element.
function FloatingFavoritesToolbar({ tools, favorites, activeTool, onSelect, pos, onMove, colors, boundsRef }) {
  const favTools = favorites.map(id => tools.find(t => t.id === id)).filter(Boolean)
  const elRef = useRef(null)
  // Final fixed-screen coords (computed from the container rect in a layout effect
  // — never by reading refs during render, which isn't reactive). Null until first
  // measured, so we render the bar invisibly for one frame instead of at (0,0).
  const [box, setBox] = useState(null)

  // Measure the container + this bar, clamp the OFFSET so the whole bar stays
  // inside the chart, and store the resulting screen coords. Re-run on scroll /
  // resize so the fixed-positioned bar tracks the container as it moves.
  useLayoutEffect(() => {
    if (!favTools.length) return undefined
    const measure = () => {
      const cont = boundsRef?.current
      const el = elRef.current
      if (!cont) { setBox(null); return }
      const cr = cont.getBoundingClientRect()
      const elW = el?.offsetWidth || (favTools.length * 29 + 40)
      const elH = el?.offsetHeight || 32
      const maxX = Math.max(0, cr.width - elW)
      const maxY = Math.max(0, cr.height - elH)
      // Default (no saved pos): top-right of the chart, clear of the OHLC legend.
      const dflt = { x: Math.max(0, cr.width - elW - 12), y: 8 }
      // The saved position is a FRACTION of the container (fx, fy) so the bar keeps
      // its RELATIVE spot when the widget is resized OR a new chart of a different
      // size is placed — an absolute px offset just clamped it into a corner. (Legacy
      // absolute {x, y} is still honored; the next drag rewrites it as a fraction.)
      let p
      if (pos && (pos.fx != null || pos.fy != null)) p = { x: (pos.fx || 0) * cr.width, y: (pos.fy || 0) * cr.height }
      else if (pos && pos.x != null) p = { x: pos.x, y: pos.y }
      else p = dflt
      const relX = Math.max(0, Math.min(maxX, p.x))
      const relY = Math.max(0, Math.min(maxY, p.y))
      setBox({ left: cr.left + relX, top: cr.top + relY, relX, relY, maxX, maxY })
    }
    measure()
    const bump = () => measure()
    window.addEventListener('scroll', bump, true)
    window.addEventListener('resize', bump)
    let ro = null
    const cont = boundsRef?.current
    if (cont && typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(bump); ro.observe(cont) }
    return () => {
      window.removeEventListener('scroll', bump, true)
      window.removeEventListener('resize', bump)
      if (ro) ro.disconnect()
    }
  }, [boundsRef, pos, favTools.length])

  if (!favTools.length) return null

  const startDrag = (e) => {
    e.preventDefault()
    const startX = e.clientX, startY = e.clientY
    // Reads inside an event handler are fine (not during render). Re-measure the
    // container so the clamp bounds are current even after a widget resize.
    const cont = boundsRef?.current
    const cr = cont ? cont.getBoundingClientRect() : null
    const el = elRef.current
    const elW = el?.offsetWidth || (favTools.length * 29 + 40)
    const elH = el?.offsetHeight || 32
    const maxX = cr ? Math.max(0, cr.width - elW) : Number.POSITIVE_INFINITY
    const maxY = cr ? Math.max(0, cr.height - elH) : Number.POSITIVE_INFINITY
    const base = box ? { x: box.relX, y: box.relY } : (pos ?? { x: 12, y: 8 })
    let last = base
    // Move the bar by DIRECT DOM during the drag — do NOT call onMove per event.
    // onMove does setState + a synchronous localStorage.setItem AND retriggers this
    // component's measuring layout-effect; firing that on every pointermove of a
    // fast drag storms the main thread (hundreds of state-updates + disk writes +
    // getBoundingClientRect re-measures a second). With a heavy Scanner widget also
    // mounted, that storm hangs/crashes the tab. Here we only touch el.style
    // (cheap, no layout read — `cr` was measured once at drag start) and persist
    // the final position ONCE on pointerup.
    const move = (ev) => {
      const relX = Math.max(0, Math.min(maxX, base.x + (ev.clientX - startX)))
      const relY = Math.max(0, Math.min(maxY, base.y + (ev.clientY - startY)))
      last = { x: relX, y: relY }
      if (el && cr) { el.style.left = `${cr.left + relX}px`; el.style.top = `${cr.top + relY}px` }
    }
    const up = () => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', up)
      // Persist as a FRACTION of the container (cr was measured at drag start) so the
      // bar keeps its relative spot across resizes and new same/different-size charts.
      const W = cr && cr.width ? cr.width : 1
      const H = cr && cr.height ? cr.height : 1
      onMove({ fx: last.x / W, fy: last.y / H })
    }
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', up)
  }
  // EXACT toolbar-button colours (passed as props because the CSS vars are chart-
  // scoped and this portals to <body>). Border = the button hover shade so the
  // pill reads as "made of buttons," not a foreign gray panel.
  const bg = colors?.bg || 'rgba(26,28,23,0.92)'
  const bgHover = colors?.bgHover || 'rgba(46,49,39,0.95)'
  const text = colors?.text || '#a8a290'
  const textHover = colors?.textHover || '#e2dfd6'
  return createPortal(
    <div ref={elRef} style={{ position: 'fixed', left: box ? box.left : -9999, top: box ? box.top : -9999,
        opacity: box ? 1 : 0, zIndex: 900, display: 'flex', alignItems: 'center', gap: 3,
        padding: '4px 6px', borderRadius: 8, background: bg,
        border: `1px solid ${bgHover}`, boxShadow: '0 1px 5px rgba(0,0,0,0.16)' }}>
      <span onPointerDown={startDrag} title="Drag to move" style={{ cursor: 'grab', color: text, display: 'flex', padding: '0 1px', touchAction: 'none' }}>{ICONS.grip}</span>
      {favTools.map(t => {
        const on = activeTool === t.id
        return (
          <button key={t.id} onClick={() => onSelect(t.id)} title={t.label}
            onMouseEnter={e => { if (!on) { e.currentTarget.style.background = bgHover; e.currentTarget.style.color = textHover } }}
            onMouseLeave={e => { if (!on) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = text } }}
            style={{ width: 26, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none',
              borderRadius: 4, background: on ? bgHover : 'transparent',
              color: on ? '#c9a84c' : text, cursor: 'pointer' }}>
            {ICONS[t.id]}
          </button>
        )
      })}
    </div>, document.body)
}

// ─── Main Toolbar Component ──────────────────────────────────────────────────

function formatReplayDate(t) {
  if (!t) return ''
  if (typeof t === 'string') return t
  return formatETDate(t * 1000)
}

function ChartToolbar({
  activeTool, setActiveTool,
  color, setColor,
  lineWidth, setLineWidth,
  hasSelection, onDelete, onClearAll,
  onUndo = null, onRedo = null, canUndo = false, canRedo = false,
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
  showPatterns = false,
  onTogglePatterns = null,
  hideReplay = false,
  hidePatterns = false,
  hideCompare = false,
  hideCountdown = false,
  // Reason string when this chart's SURFACE fixes the volume pane (see
  // ChartSettingsPanel). null on surfaces where the saved prefs actually apply.
  volumePaneFixed = null,
  lineStyle = 'solid',           // 'solid' | 'dashed' — current line style (Model Book annotations)
  setLineStyle = null,           // when provided, shows a Solid/Dashed control
  fontSize = 13,                 // current text-annotation font size
  setFontSize = null,            // when provided, shows a text font-size control
  prominent = false,             // force full opacity (annotation/edit mode, not the unobtrusive default)
  magnet = false,                // snap drawings to nearest O/H/L/C
  setMagnet = null,              // when provided, shows the magnet toggle
  toolFilter = null,             // when an array of tool ids, show ONLY those tools (e.g. ['cursor','measure'] for the index pane)
  hideSettingsButton = false,    // charts workspace has the new ChartSettingsModal — drop the legacy V1 gear + inline panel there
  // ⭐ The chart's own engine instances, forwarded to the alert popover so an
  // alert can name the INSTANCE it was armed from (Phase C Task 15). Default
  // `[]`, so every mount site that does not pass it behaves exactly as before:
  // no instance is offered and the alert carries no `instance_id`, which is
  // what every row created before this producer existed carries.
  chartInstances = [],
  // ⭐ PHASE C TASK 12 — the surface's own stable chart id, forwarded to the
  // alert popover so its listing request carries `?scope=` and a "this chart
  // only" alert has something to be scoped TO. Default `null`, so every mount
  // site that passes none keeps the unscoped listing it has always had.
  chartId = null,
  // ⭐ PHASE D TASK 13 — the bars this chart is holding, forwarded to the
  // builder's concierge box, whose compute stage runs on the window the user is
  // looking at (`definition_concierge._validate`). Default `null`: the server
  // skips the compute check on an empty list rather than refusing, so a mount
  // site with no bars still gets a parseable proposal.
  bars = null,
  // Shared saved-color swatches (same list as Chart Settings + the right-click
  // drawing menu) so the toolbar's color popup is the full ColorPanel, not the
  // old 3×3 grid. Default `[]`/null → the panel simply omits the Saved row.
  savedColors = [],
  onSaveColor = null,
  onDeleteColor = null,
  // Toolbar collapse can be CONTROLLED by the parent (StockChart lifts it so the
  // crosshair legend can slide up into the freed space). When `collapsed` is
  // undefined the toolbar keeps its own internal collapse state.
  collapsed: collapsedProp = undefined,
  onToggleCollapsed = null,
  // The chart container element (a ref), used to CONFINE the floating favorites
  // toolbar to this chart widget so it can't be dragged out into the page. Null →
  // the bar falls back to unconfined positioning (legacy behavior).
  favBoundsRef = null,
}, ref) {
  const [showColors, setShowColors] = useState(false)
  const [colorPanelPos, setColorPanelPos] = useState({ left: 0, top: 0 })
  // Toolbar collapse toggle — when true, everything but the toggle button hides so
  // the chart underneath is unobstructed; the toggle stays to bring it back.
  // Controlled by the parent when `collapsedProp` is provided, else self-managed.
  const [collapsedInternal, setCollapsedInternal] = useState(false)
  const collapsed = collapsedProp !== undefined ? collapsedProp : collapsedInternal
  const toggleCollapsed = () => {
    const next = !collapsed
    onToggleCollapsed?.(next)
    if (collapsedProp === undefined) setCollapsedInternal(next)
  }
  const [showWidths, setShowWidths] = useState(false)
  const [showFonts, setShowFonts] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  // ── THE INDICATOR LIBRARY (spec §6) ───────────────────────────────────────
  //
  // Held HERE rather than in `StockChart`, for one reason that is also the
  // read-only mount-site rule: this component already renders the settings panel
  // behind `chartSettings && onUpdateSettings`, and a chart mounted read-only
  // passes no `onUpdateSettings`. Gating the library on the SAME pair means a
  // read-only chart cannot sprout an add-dialog, without a second prop that
  // could disagree with the first (spec §5 "mount-site scoping").
  const [libraryOpen, setLibraryOpen] = useState(false)
  // ⭐ PHASE D TASK 11 — the formula builder, held here for the SAME reason the
  // library is: it is opened from the settings panel, `Sheet` portals to
  // `document.body`, and the panel closes on outside mousedown — so a dialog
  // rendered as the panel's child would be unmounted by the very click that
  // opened it.
  const [builderOpen, setBuilderOpen] = useState(false)
  const [comparePopoverOpen, setComparePopoverOpen] = useState(false)
  const [alertPopoverOpen, setAlertPopoverOpen] = useState(false)
  // ⭐ chart-UX-walls TASK 4 — WHICH CHIP OPENED IT. `{instanceId, plotKey}` when
  // the legend chip's "Add alert…" row opened this popover, else null (the 🔔
  // button, which names no indicator). The popover resolves it to a served
  // ADDRESS itself; this is the only state that had to exist here, and it lives
  // beside `alertPopoverOpen` because the popover is mounted here.
  const [alertInitial, setAlertInitial] = useState(null)
  const colorRef = useRef(null)
  const widthRef = useRef(null)
  const fontRef = useRef(null)
  const settingsRef = useRef(null)
  const compareRef = useRef(null)
  const alertRef = useRef(null)

  // ── Drawing-tools customization (show/hide + favorites) ──
  const [hiddenTools, setHiddenTools] = useState(() => _loadArr(LS_HIDDEN))
  const [favoriteTools, setFavoriteTools] = useState(() => _loadArr(LS_FAV))
  const [favMenuOpen, setFavMenuOpen] = useState(false)
  const [favMenuRect, setFavMenuRect] = useState(null)
  const [favPos, setFavPos] = useState(() => { try { return JSON.parse(localStorage.getItem(LS_FAVPOS)) || null } catch { return null } })
  const favBtnRef = useRef(null)
  const DRAW_TOOL_LIST = useMemo(() => TOOLS.filter(t => t !== 'sep'), [])
  // The floating favorites toolbar PORTALS to <body>, so it can't inherit the
  // chart-scoped --chart-toolbar-* vars. Compute the exact toolbar-button colours
  // from the canvas here (same helper StockChart uses) and pass them as props so
  // the floating bar is byte-identical to the main toolbar buttons on any theme.
  const favToolbarColors = useMemo(() => toolbarFor(chartSettings?.background) || null, [chartSettings?.background])
  const toggleHiddenTool = useCallback((id) => setHiddenTools(prev => {
    const n = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]; _saveArr(LS_HIDDEN, n); return n
  }), [])
  const toggleFavoriteTool = useCallback((id) => setFavoriteTools(prev => {
    const n = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]; _saveArr(LS_FAV, n); return n
  }), [])
  const moveFavToolbar = useCallback((p) => { setFavPos(p); try { localStorage.setItem(LS_FAVPOS, JSON.stringify(p)) } catch { /* ignore */ } }, [])
  const openFavMenu = useCallback(() => {
    const r = favBtnRef.current?.getBoundingClientRect()
    if (r) setFavMenuRect({ left: r.left, bottom: r.bottom })
    setFavMenuOpen(o => !o)
  }, [])

  // Imperative API: lets the chart's right-click menu open the settings panel,
  // and lets `Alt+Shift+A` open the indicator library. ⚠️ `openIndicatorLibrary`
  // is a NO-OP on a read-only mount site — it checks the same pair the button
  // does, so the chord and the button cannot disagree about where the library is
  // available. `StockChart` calls it; it does not own the state.
  const canManageIndicators = !!(chartSettings && onUpdateSettings)
  useImperativeHandle(ref, () => ({
    openSettings: () => {
      setShowColors(false)
      setShowWidths(false)
      setShowSettings(true)
    },
    openIndicatorLibrary: () => {
      if (!canManageIndicators) return false
      setLibraryOpen(true)
      return true
    },
    // ⭐ chart-UX-walls TASK 4 — the legend chip's "Add alert…" row, and the
    // right-click **Add alert on <label>…** row, reach THIS popover rather than
    // mounting a second one. ⚠️ IT RETURNS `false` WHEN THERE IS NO SYMBOL, for
    // the same reason `openIndicatorLibrary` returns false on a read-only mount:
    // the 🔔 button is `disabled` without one and the popover renders nothing, so
    // a row that reported success would be a row that opened nothing.
    openAlerts: (initialFor = null) => {
      if (!currentSym) return false
      setAlertInitial(initialFor)
      setAlertPopoverOpen(true)
      return true
    },
  }), [canManageIndicators, currentSym])

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

  // Click-outside handler for indicator alert popover
  useEffect(() => {
    if (!alertPopoverOpen) return
    function onClickOutside(e) {
      if (alertRef.current && !alertRef.current.contains(e.target)) {
        setAlertPopoverOpen(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [alertPopoverOpen])

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

  // Close popups on outside click.
  //
  // 🐛 …where "outside" means outside the UI, NOT outside the subtree. A PORTALED
  // child (`ColorPicker`'s popup goes to `document.body`) is outside every ref
  // here by construction, so the unqualified `contains()` test closed the settings
  // panel on the mousedown of the very click that was choosing a colour — the
  // button unmounted before `click` fired and `pick()` never ran. **Every colour
  // swatch in the inline settings panel was unusable in production**, and it read
  // as a dead palette rather than as a closing panel because OPENING the picker
  // (the swatch is a real child) always worked.
  //
  // `PORTAL_POPUP_ATTR` is the contract: an element that carries it is logically
  // inside whatever opened it. One `closest()` covers every popup in the panel —
  // present and future — which is the property a per-popup ref threaded through
  // `ChartSettingsPanel` would not have had.
  useEffect(() => {
    const handler = (e) => {
      // `closest` needs an Element; a mousedown can target a text node in jsdom.
      const node = e.target instanceof Element ? e.target : e.target?.parentElement
      if (node && node.closest(`[${PORTAL_POPUP_ATTR}]`)) return
      if (showColors && colorRef.current && !colorRef.current.contains(e.target)) setShowColors(false)
      if (showWidths && widthRef.current && !widthRef.current.contains(e.target)) setShowWidths(false)
      if (showFonts && fontRef.current && !fontRef.current.contains(e.target)) setShowFonts(false)
      if (showSettings && settingsRef.current && !settingsRef.current.contains(e.target)) setShowSettings(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showColors, showWidths, showFonts, showSettings])

  const selectTool = (id) => {
    if (id === 'cursor') {
      setActiveTool(activeTool === 'cursor' ? null : 'cursor')
    } else {
      setActiveTool(activeTool === id ? null : id)
    }
  }

  // Open/close the drawing-color ColorPanel. It portals to <body> (so it is never
  // clipped by the toolbar/widget overflow), positioned just under the swatch
  // button and flipped inward if it would overflow the right/bottom viewport edge.
  const toggleColorPanel = () => {
    if (!showColors) {
      const r = colorRef.current?.getBoundingClientRect()
      if (r) {
        const PANEL_W = 258, PANEL_H = 420, M = 8
        let left = r.left
        if (left + PANEL_W > window.innerWidth - M) left = window.innerWidth - PANEL_W - M
        let top = r.bottom + 4
        if (top + PANEL_H > window.innerHeight - M) top = Math.max(M, r.top - PANEL_H - 4)
        setColorPanelPos({ left: Math.max(M, left), top })
      }
      closeOthers('colors')
      setShowColors(true)
    } else {
      setShowColors(false)
    }
  }

  const closeOthers = (keep) => {
    if (keep !== 'colors') setShowColors(false)
    if (keep !== 'widths') setShowWidths(false)
    if (keep !== 'fonts') setShowFonts(false)
    if (keep !== 'settings') setShowSettings(false)
  }

  return (
    <>
    <div className={`${styles.toolbar} ${collapsed ? styles.collapsed : ''}`} style={prominent ? { opacity: 1 } : undefined}>
      {/* ── Tool buttons ── */}
      {/* Separators removed — every button is evenly spaced by the flex `gap`. */}
      <div className={styles.tools}>
        {(toolFilter ? DRAW_TOOL_LIST.filter(t => toolFilter.includes(t.id)) : DRAW_TOOL_LIST).map((t) => (
          <button
            key={t.id}
            /* Hidden tools stay in the DOM but collapse to width 0 (styles.toolHidden)
               so show/hide animates smoothly instead of popping. */
            className={`${styles.btn} ${activeTool === t.id ? styles.active : ''} ${(!toolFilter && hiddenTools.includes(t.id)) ? styles.toolHidden : ''}`}
            onClick={() => selectTool(t.id)}
            title={t.label}
            aria-label={t.label}
          >
            {ICONS[t.id]}
          </button>
        ))}
        {/* ── Favorite Drawings: show/hide tools + pick favorites for the floating toolbar ── */}
        {!toolFilter && (
          <button
            ref={favBtnRef}
            className={`${styles.btn} ${favMenuOpen ? styles.active : ''}`}
            onClick={openFavMenu}
            title="Customize drawing tools — show/hide & favorite"
            aria-label="Customize drawing tools"
          >
            {ICONS.favorites}
          </button>
        )}
      </div>

      {/* ── Bottom actions ── */}
      <div className={styles.actions}>
        {/* Magnet: snap drawings to nearest O/H/L/C */}
        {setMagnet && (
          <button
            className={`${styles.btn} ${magnet ? styles.active : ''}`}
            onClick={() => setMagnet(!magnet)}
            title={magnet ? 'Magnet: ON — snaps to candle O/H/L/C' : 'Magnet: OFF'}
            aria-label={magnet ? 'Magnet: on' : 'Magnet: off'}
            style={{ fontSize: '13px' }}
          >
            <UIcon name="magnet" size={15} />
          </button>
        )}

        {/* ── OHLCV legend: Always / On click / Off ──────────────────────────
            The mode lived only in Chart Settings → Header; this is its quick
            control. Three states rather than a checkbox because "on click" is
            the one people actually want — a clean chart that answers when asked.

            ⛔ WRITES `header.legendMode` AND NOTHING ELSE. The legacy
            `header.showLegend` boolean is deliberately left alone: it is a
            read-only fallback for blobs written before the mode existed, and
            "keeping them in sync" would put two keys on one fact. `legendModeOf`
            reads the pair; only this line writes.

            Rendered only where settings actually persist — a read-only mount
            (Model Book, a grid cell) gets no button rather than one that writes
            nowhere. */}
        {chartSettings && onUpdateSettings && (() => {
          const mode = legendModeOf(chartSettings)
          const NEXT_LABEL = { always: 'hold to peek', hold: 'off', off: 'always' }
          const ICON = { always: 'eye', hold: 'pin', off: 'eyeOff' }
          const STATE = { always: 'Always on', hold: 'Hold to peek', off: 'Off' }
          return (
            <button
              /* No gold "active" highlight and no stacked caption — so it's the
                 SAME height as every other toolbar button. The MODE is carried by
                 the icon DESIGN itself (owner ask): eye = always on, pin = hold to
                 peek, struck-through eye = off. */
              className={styles.btn}
              onClick={() => onUpdateSettings({
                ...chartSettings,
                header: { ...chartSettings.header, legendMode: nextLegendMode(mode) },
                preset: 'custom',
              })}
              title={`OHLCV legend: ${STATE[mode]} — click for ${NEXT_LABEL[mode]}`}
              aria-label={`OHLCV legend: ${STATE[mode]}`}
            >
              <UIcon name={ICON[mode]} size={14} />
            </button>
          )
        })()}

        {/* Repeat mode toggle */}
        <button
          className={`${styles.btn} ${repeatMode ? styles.active : ''}`}
          onClick={() => setRepeatMode(!repeatMode)}
          title={repeatMode ? 'Repeat drawing: ON' : 'Repeat drawing: OFF'}
          aria-label={repeatMode ? 'Repeat drawing: on' : 'Repeat drawing: off'}
        >
          {ICONS.repeat}
        </button>

        {/* Patterns overlay toggle — temporarily removed (was overlapping the toolbar) */}
        {false && !hidePatterns && onTogglePatterns && (
          <PatternToolbarButton active={!!showPatterns} onToggle={onTogglePatterns} />
        )}

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
        {!hideCompare && onCompareChange && (
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
        {!hideCountdown && countdown && (
          <span className={styles.countdown} title="Time until bar closes">
            {countdown}
          </span>
        )}

        {/* ── Share ── */}
        {/* The tooltip named ONE of the three things this opens. The popover is
            "Share Chart": Download PNG, Copy to Clipboard, Copy Share URL — and
            the clipboard copy (paste straight into a tweet, Discord, or a
            Substack draft) is the one people actually want and the one nobody
            found, because a camera labelled "Download" reads as save-to-disk. */}
        {onScreenshot && (
          <button
            className={styles.btn}
            onClick={onScreenshot}
            aria-label="Share chart"
            title="Share chart — copy image, download PNG, or copy link"
          >
            {ICONS.share}
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
        {!hideReplay && onReplayToggle && (
          <button
            className={`${styles.btn} ${replayMode ? styles.active : ''}`}
            onClick={onReplayToggle}
            title="Replay / Time Machine"
            aria-label="Replay / Time Machine"
          >
            {ICONS.replay}
          </button>
        )}

        {/* Compare symbols */}
        {!hideCompare && chartSettings && onUpdateSettings && (
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

        {/* Indicator alerts (🔔) */}
        <div ref={alertRef} className={styles.compareContainer}>
          <button
            className={`${styles.btn} ${alertPopoverOpen ? styles.active : ''}`}
            onClick={() => { setAlertInitial(null); setAlertPopoverOpen(o => !o) }}
            title={currentSym ? 'Indicator alerts' : 'Select a symbol to set alerts'}
            aria-label="Indicator alerts"
            disabled={!currentSym}
          >
            <UIcon name="bell" size={14} />
          </button>
          {alertPopoverOpen && currentSym && (
            <IndicatorAlertPopover
              sym={currentSym}
              onClose={() => setAlertPopoverOpen(false)}
              chartInstances={chartInstances}
              initial={alertInitial}
              chartId={chartId}
            />
          )}
        </div>

        {/* Indicators — spec §6 asks for a LABELLED button, "not icon-only in
            v1": the add-flow is the thing users are hunting for and a glyph is a
            guess. Gated on the same pair as the settings panel, so a read-only
            mount site (which passes no `onUpdateSettings`) gets neither.

            ⚠️ NOT gated on `hideSettingsButton`. That flag retires the LEGACY V1
            gear on surfaces that have the new modal; the library launcher is the
            add-flow itself and has no equivalent in the modal, so hiding it with
            the gear would leave the charts workspace with no way to add one. */}
        {canManageIndicators && (
          <button
            type="button"
            className={`${styles.btn} ${styles.indicatorsBtn} ${libraryOpen ? styles.active : ''}`}
            onClick={() => { setLibraryOpen(true); closeOthers(null) }}
            title="Indicators — browse and add"
          >
            <UIcon name="breadth" size={14} /> Indicators
          </button>
        )}

        {/* Chart settings — legacy V1 inline panel. Hidden on surfaces that have
            the new ChartSettingsModal (charts workspace); still the settings entry
            point on every other surface. */}
        {chartSettings && onUpdateSettings && !hideSettingsButton && (
          <div ref={settingsRef} className={styles.pickerWrap}>
            <button
              className={`${styles.btn} ${showSettings ? styles.active : ''}`}
              onClick={() => { setShowSettings(!showSettings); closeOthers('settings') }}
              title="Chart Settings"
              aria-label="Chart settings"
            >
              {ICONS.settings}
            </button>
            {showSettings && (
              <ChartSettingsPanel
                chartSettings={chartSettings}
                onUpdateSettings={onUpdateSettings}
                onOpenIndicatorLibrary={() => setLibraryOpen(true)}
                onOpenFormulaBuilder={() => setBuilderOpen(true)}
                volumePaneFixed={volumePaneFixed}
              />

            )}
          </div>
        )}

        {/* ⛔ MOUNTED AT TOOLBAR LEVEL, NOT INSIDE THE SETTINGS PANEL. The panel
            closes on outside mousedown, and `Sheet` portals to `document.body` —
            a dialog rendered as the panel's child would be unmounted by the very
            click that opened it. It also has to outlive the panel: Task 8's
            launcher opens it FROM the panel. */}
        {canManageIndicators && (
          <IndicatorLibraryDialog
            open={libraryOpen}
            onClose={() => setLibraryOpen(false)}
            settings={cs}
            onChange={onUpdateSettings}
            registry={engineRegistry}
            /* 🔴 THE BUILDER'S DOOR ON `/charts` — its SECOND opener, and on the
               charts workspace its ONLY one.
               `ChartSettingsPanel` (below) has held the builder's single entry
               point since Phase D Task 11, and that panel renders behind
               `!hideSettingsButton` — which `/charts` sets, because the workspace
               has `ChartSettingsModal` and two settings surfaces over one
               `chart_settings` blob would be a second authority. That flag is
               correct and stays; what was wrong is that the BUILDER hung off it.
               The reasoning already written above the Indicators button — "hiding
               it with the gear would leave the charts workspace with no way to add
               one" — was never applied to the builder, so nine tasks of authoring
               work were unreachable from the one surface a charting member lives
               on, desktop and phone alike.
               ⛔ ONE SHEET, TWO OPENERS. Both callers set the SAME `builderOpen`
               and reach the ONE builder sheet mounted below; nothing about the
               builder is duplicated, and a member who opens it from either door
               lands in the same draft.
               ⚰️ THIS SAID *"AND THAT SENTENCE MAY NOT SPELL THE JSX TAG"* until
               2026-08-09, because `BuilderSheet.test.jsx` counted mount sites by
               matching the opening tag against the RAW FILE — so naming it in prose
               anywhere in this module reported a SECOND mount and redded a rail that
               was otherwise correct. It is fixed: that rail parses this file and
               counts JSXElement nodes, and comments are not in an AST at all. The
               paragraph is kept in the past tense rather than deleted because the
               constraint shaped how this whole block is worded, and because it is
               the cleanest live example in the repo of why a probe over source text
               is not a probe over source (`lesson_probe_names_must_be_derived_not_
               typed`): the SOURCE had been contorted to please a broken check, and
               the failure read as *"you added a second mount"* to anyone who hit it.
               ⚠️ THE LIBRARY CLOSES FIRST, DELIBERATELY. Both are `Sheet`s, and
               `Sheet` installs a body-scroll lock and an Escape handler that calls
               `e.stopPropagation()` — two open at once means one Escape closes the
               wrong one and the scroll lock is restored by whichever unmounts
               last. */
            onCreateFormula={() => { setLibraryOpen(false); setBuilderOpen(true) }}
          />
        )}

        {/* Mounted at toolbar level for the same reason the library is — see the
            comment above it and `builderOpen`'s declaration. */}
        {canManageIndicators && (
          <BuilderSheet
            open={builderOpen}
            onClose={() => setBuilderOpen(false)}
            /* ⭐ PHASE D TASK 16 — the same pair `IndicatorLibraryDialog` takes,
               and for the same reason: adding a formula to the chart is the same
               act as ticking one in the library, so it goes through the same
               `settings`/`onChange` contract and the same `addInstance` door.
               Both are inside `canManageIndicators`, so a read-only chart still
               cannot write an instance. */
            settings={cs}
            onChange={onUpdateSettings}
            /* ⭐ PHASE D TASK 13 — the concierge's compute stage runs on the
               window the user sees. See the `bars` prop's declaration. */
            bars={bars}
            /* W1a hand-back: the preview draws on this chart */
            sym={currentSym}
            tf={tf}
          />
        )}

        {/* Color picker */}
        <div ref={colorRef} className={styles.pickerWrap}>
          <button
            className={styles.btn}
            onClick={toggleColorPanel}
            title="Color"
            aria-label="Drawing color"
          >
            <div className={styles.colorSwatch} style={{ background: color }} />
          </button>
          {showColors && createPortal(
            <div
              {...{ [PORTAL_POPUP_ATTR]: 'toolbar-color' }}
              onPointerDown={(e) => e.stopPropagation()}
              style={{ position: 'fixed', left: colorPanelPos.left, top: colorPanelPos.top, zIndex: 40 }}
            >
              <ColorPanel
                title="Drawing"
                value={color}
                onChange={(hex) => setColor(hex)}
                onClose={() => setShowColors(false)}
                savedColors={savedColors}
                onSaveColor={onSaveColor}
                onDeleteColor={onDeleteColor}
              />
            </div>,
            document.body,
          )}
        </div>

        {/* Line width */}
        <div ref={widthRef} className={styles.pickerWrap}>
          <button
            className={styles.btn}
            onClick={() => { setShowWidths(!showWidths); closeOthers('widths') }}
            title={`Line width: ${lineWidth}px`}
            aria-label={`Line width: ${lineWidth}px`}
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

        {/* Line style: applies to NEW lines you draw and (if one is selected) the selected line */}
        {setLineStyle && (
          <button
            className={`${styles.btn} ${lineStyle === 'dashed' ? styles.active : ''}`}
            onClick={() => setLineStyle(lineStyle === 'dashed' ? 'solid' : 'dashed')}
            title="Line style — applies to new lines and the selected line"
            style={{ width: 'auto', padding: '0 8px', fontFamily: 'var(--font-mono)', fontSize: '10px', fontWeight: 700, whiteSpace: 'nowrap' }}
          >
            {lineStyle === 'dashed' ? '┄ Dashed' : '─ Solid'}
          </button>
        )}

        {/* Text font size: applies to NEW text and (if a text drawing is selected) the selected one */}
        {setFontSize && (
          <div ref={fontRef} className={styles.pickerWrap}>
            <button
              className={styles.btn}
              onClick={() => { setShowFonts(!showFonts); closeOthers('fonts') }}
              title={`Text size: ${fontSize}px — applies to new text and the selected text`}
              aria-label={`Text size: ${fontSize}px`}
              style={{ width: 'auto', padding: '0 8px', fontWeight: 700, whiteSpace: 'nowrap' }}
            >
              <span style={{ fontSize: 15, lineHeight: 1 }}>A</span>
              <span style={{ fontSize: 9, marginLeft: 1 }}>{fontSize}</span>
            </button>
            {showFonts && (
              <div className={styles.popup}>
                {FONT_SIZES.map(fs => (
                  <button
                    key={fs}
                    className={`${styles.widthOption} ${fs === fontSize ? styles.widthActive : ''}`}
                    onClick={() => { setFontSize(fs); setShowFonts(false) }}
                    style={{ fontSize: 12, fontWeight: 700, minWidth: 34 }}
                  >
                    {fs}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Hide / show all drawings (doesn't delete them) */}
        <button
          className={`${styles.btn} ${chartSettings?.hideDrawings ? styles.active : ''}`}
          onClick={() => onUpdateSettings?.({ ...chartSettings, hideDrawings: !chartSettings?.hideDrawings })}
          disabled={!drawingCount}
          title={chartSettings?.hideDrawings ? 'Show drawings' : 'Hide all drawings'}
          aria-label={chartSettings?.hideDrawings ? 'Show drawings' : 'Hide all drawings'}
          aria-pressed={!!chartSettings?.hideDrawings}
        >
          {chartSettings?.hideDrawings ? ICONS.eyeOff : ICONS.eye}
        </button>

        {/* Undo / Redo */}
        {onUndo && (
          <button
            className={styles.btn}
            onClick={onUndo}
            disabled={!canUndo}
            title="Undo (Ctrl+Z)"
            aria-label="Undo"
          >
            {ICONS.undo}
          </button>
        )}
        {onRedo && (
          <button
            className={styles.btn}
            onClick={onRedo}
            disabled={!canRedo}
            title="Redo (Ctrl+Y)"
            aria-label="Redo"
          >
            {ICONS.redo}
          </button>
        )}

        {/* Delete selected */}
        <button
          className={`${styles.btn} ${hasSelection ? styles.danger : ''}`}
          onClick={onDelete}
          disabled={!hasSelection}
          title="Delete selected (Del)"
          aria-label="Delete selected"
        >
          {ICONS.delete}
        </button>

        {/* Clear all */}
        <button
          className={`${styles.btn} ${drawingCount > 0 ? styles.danger : ''}`}
          onClick={() => { if (drawingCount > 0 && confirm('Clear all drawings on this chart?')) onClearAll() }}
          disabled={!drawingCount}
          title={`Clear all (${drawingCount})`}
          aria-label={`Clear all drawings (${drawingCount})`}
        >
          {ICONS.clear}
        </button>
      </div>

      {/* Toolbar show/hide toggle — a sibling of .tools/.actions (NOT inside them),
          so it stays visible when the toolbar collapses. Anchored to the far right;
          click to slide the toolbar away and click again to bring it back. */}
      <button
        className={`${styles.btn} ${styles.toggleBtn}`}
        onClick={toggleCollapsed}
        title={collapsed ? 'Show toolbar' : 'Hide toolbar'}
        aria-label={collapsed ? 'Show toolbar' : 'Hide toolbar'}
        aria-pressed={collapsed}
      >
        {collapsed ? ICONS.chevronLeft : ICONS.chevronRight}
      </button>
    </div>

    {/* ── Replay controls bar ── */}
    {replayMode && (
      <div className={styles.replayBar}>
        <button
          className={styles.replayBtn}
          onClick={() => onReplayIndexChange?.(0)}
          title="Restart from beginning"
        ><UIcon name="skipBack" size={14} /></button>
        <button className={styles.replayBtn} onClick={() => onReplayStep?.(-10)} title="Back 10">«</button>
        <button className={styles.replayBtn} onClick={() => onReplayStep?.(-1)} title="Back 1">‹</button>
        <button className={`${styles.replayBtn} ${styles.replayPlay}`} onClick={onReplayPlayPause}>
          {replayPlaying ? <UIcon name="pause" size={14} /> : <UIcon name="play" size={14} />}
        </button>
        <button className={styles.replayBtn} onClick={() => onReplayStep?.(1)} title="Fwd 1">›</button>
        <button className={styles.replayBtn} onClick={() => onReplayStep?.(10)} title="Fwd 10">»</button>
        <button
          className={styles.replayBtn}
          onClick={() => onReplayIndexChange?.(Math.max(0, (replayTotal || 1) - 1))}
          title="Skip to end"
        ><UIcon name="skipForward" size={14} /></button>
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
        <button className={styles.replayExit} onClick={onReplayToggle}><UIcon name="x" size={12} style={{verticalAlign:'-1px',marginRight:4}} />Exit</button>
      </div>
    )}

    {/* ── Drawing-tools customizer dropdown + floating favorites toolbar ── */}
    {!toolFilter && favMenuOpen && (
      <FavoriteDrawingsMenu
        tools={DRAW_TOOL_LIST}
        hidden={hiddenTools}
        favorites={favoriteTools}
        onToggleHidden={toggleHiddenTool}
        onToggleFavorite={toggleFavoriteTool}
        anchorRect={favMenuRect}
        onClose={() => setFavMenuOpen(false)}
      />
    )}
    {!toolFilter && favoriteTools.length > 0 && (
      <FloatingFavoritesToolbar
        tools={DRAW_TOOL_LIST}
        favorites={favoriteTools}
        activeTool={activeTool}
        onSelect={selectTool}
        pos={favPos}
        onMove={moveFavToolbar}
        colors={favToolbarColors}
        boundsRef={favBoundsRef}
      />
    )}
    </>
  )
}

export default forwardRef(ChartToolbar)

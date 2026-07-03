// app/src/pages/CotData.jsx
import { useState, useRef, useEffect, Component } from 'react'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale,
  BarController, BarElement,
  LineController, LineElement, PointElement,
  Title, Tooltip, Legend, Filler,
} from 'chart.js'
import { Chart } from 'react-chartjs-2'
import styles from './CotData.module.css'
import { CHART_FONT_FAMILY } from '../utils/chartFont'
import Sheet from '../components/mobile/Sheet'
import { useIsTouch } from '../hooks/useBreakpoint'

ChartJS.register(
  CategoryScale, LinearScale,
  BarController, BarElement,
  LineController, LineElement, PointElement,
  Title, Tooltip, Legend, Filler,
)

// UCT series palette — validated (dark surface #14160f): CVD ΔE 21.8, contrast ≥3:1.
// Deliberately breaks from the red/blue/yellow COT convention.
const SERIES_COLORS = {
  commercials: '#2d8c4e',   // UCT green — the hedgers
  largeSpecs:  '#b18c33',   // UCT gold — institutional trend money
  smallSpecs:  '#4a90c2',   // steel blue — the crowd
  openInterest:'#d4c9a8',   // UCT cream — OI strip
}
const AXIS_TEXT  = '#706b5e'
const GRID_FAINT = 'rgba(168, 162, 144, 0.07)'
const ZERO_LINE  = 'rgba(201, 168, 76, 0.35)'

// Match Chart.js canvas text to the app UI font (default is Helvetica/Arial).
ChartJS.defaults.font.family = CHART_FONT_FAMILY

// ── Symbol data ────────────────────────────────────────────────────────────────

const SYMBOL_NAMES = {
  ES: 'S&P 500 E-Mini',      NQ: 'Nasdaq-100 E-Mini',   YM: 'DJIA E-Mini',
  QR: 'Russell 2000 Mini',   EW: 'S&P MidCap 400',      VI: 'VIX',
  NK: 'Nikkei 225',
  GC: 'Gold',                SI: 'Silver',               HG: 'Copper',
  PL: 'Platinum',            PA: 'Palladium',            AL: 'Aluminum',
  CL: 'Crude Oil (WTI)',     HO: 'Heating Oil',          RB: 'RBOB Gasoline',
  NG: 'Natural Gas',         FL: 'Fuel Ethanol',         BZ: 'Brent Crude',
  ZW: 'Wheat (SRW)',         ZC: 'Corn',                 ZS: 'Soybeans',
  ZM: 'Soybean Meal',        ZL: 'Soybean Oil',          ZR: 'Rough Rice',
  KE: 'Wheat (HRW)',         MW: 'Wheat (Spring)',       OA: 'Oats',
  CT: 'Cotton No. 2',        OJ: 'Orange Juice',         KC: 'Coffee C',
  SB: 'Sugar No. 11',        CC: 'Cocoa',                LB: 'Lumber',
  LE: 'Live Cattle',         GF: 'Feeder Cattle',        HE: 'Lean Hogs',
  DF: 'Nonfat Dry Milk',     BJ: 'Cheese',
  ZB: '30-Year T-Bond',      UD: 'Ultra T-Bond',         ZN: '10-Year T-Note',
  ZF: '5-Year T-Note',       ZT: '2-Year T-Note',        ZQ: 'Fed Funds 30-Day',
  SR3:'SOFR 3-Month',
  DX: 'US Dollar Index',     B6: 'British Pound',        D6: 'Canadian Dollar',
  J6: 'Japanese Yen',        S6: 'Swiss Franc',          E6: 'Euro FX',
  A6: 'Australian Dollar',   M6: 'Mexican Peso',         N6: 'New Zealand Dollar',
  L6: 'Brazilian Real',      BTC:'Bitcoin',              ETH:'Ether',
}

const SYMBOL_GROUPS = {
  'MOST WATCHED':    ['ES','NQ','YM','QR','EW','VI','NK','DX','J6','ZN','BTC','ETH'],
  METALS:            ['GC','SI','HG','PL','PA','AL'],
  ENERGIES:          ['CL','HO','RB','NG','FL','BZ'],
  GRAINS:            ['ZW','ZC','ZS','ZM','ZL','ZR','KE','MW','OA'],
  SOFTS:             ['CT','OJ','KC','SB','CC','LB'],
  'LIVESTOCK & DAIRY':['LE','GF','HE','DF','BJ'],
  FINANCIALS:        ['ZB','UD','ZN','ZF','ZT','ZQ','SR3'],
  CURRENCIES:        ['DX','B6','D6','J6','S6','E6','A6','M6','N6','L6'],
}

const LOOKBACKS = [
  { label: '1Y', weeks: 52  },
  { label: '2Y', weeks: 104 },
  { label: '3Y', weeks: 156 },
  { label: '5Y', weeks: 260 },
]

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtDate(iso) {
  // "2025-11-07" → "11/7/2025"
  const [y, m, d] = iso.split('-')
  return `${parseInt(m)}/${parseInt(d)}/${y}`
}

// Round up/down to 2-significant-digit precision (e.g. 201,000 → 210,000; 317,489 → 320,000)
function roundUpNice(val) {
  if (val <= 0) return 0
  const mag = Math.pow(10, Math.floor(Math.log10(val)) - 1)
  return Math.ceil(val / mag) * mag
}

function fmtNum(v) {
  if (v == null) return ''
  const abs = Math.abs(Math.round(v)).toLocaleString()
  return v < 0 ? `(${abs})` : abs
}

function fmtCompact(v) {
  if (v == null) return ''
  const abs = Math.abs(v)
  if (abs >= 1e6) return `${(v / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `${Math.round(v / 1e3)}K`
  return String(Math.round(v))
}

// ── Error boundary ─────────────────────────────────────────────────────────────

class ChartErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(e) { return { error: e } }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '24px', color: '#ff6b6b', fontSize: '13px', fontFamily: 'var(--font-mono)' }}>
          Chart error: {String(this.state.error.message || this.state.error)}
        </div>
      )
    }
    return this.props.children
  }
}

// ── Component ──────────────────────────────────────────────────────────────────

const CHART_SIZE_KEY = 'cot.chart.size'

export default function CotData() {
  const [symbol,       setSymbol]       = useState('ES')
  const [weeks,        setWeeks]        = useState(52)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [search,       setSearch]       = useState('')
  const [data,         setData]         = useState(null)
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState(null)
  const [chartSize,    setChartSize]    = useState(null)   // { width?, height? } or null = default
  const [resizing,     setResizing]     = useState(null)   // 'right' | 'bottom' | 'corner' | null
  const dropdownRef    = useRef(null)
  const chartWrapRef   = useRef(null)
  const resizeStateRef = useRef(null)
  const isTouch        = useIsTouch()

  // Close dropdown on outside click
  useEffect(() => {
    function onClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  // Load saved chart size on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(CHART_SIZE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (parsed && (parsed.width || parsed.height)) setChartSize(parsed)
      }
    } catch { /* ignore */ }
  }, [])

  // Persist chart size on change
  useEffect(() => {
    if (!chartSize) return
    try { localStorage.setItem(CHART_SIZE_KEY, JSON.stringify(chartSize)) } catch { /* ignore */ }
  }, [chartSize])

  // Window-level mousemove/mouseup while resizing
  useEffect(() => {
    if (!resizing) return

    function onMouseMove(e) {
      const state = resizeStateRef.current
      if (!state) return
      const dx = e.clientX - state.startX
      const dy = e.clientY - state.startY
      const next = { ...(state.startSize) }
      const parentWidth = chartWrapRef.current?.parentElement?.clientWidth || window.innerWidth
      const maxHeight   = window.innerHeight - 100

      if (state.axis === 'right' || state.axis === 'corner') {
        next.width = Math.max(400, Math.min(parentWidth, state.startSize.width + dx))
      }
      if (state.axis === 'left') {
        next.width = Math.max(400, Math.min(parentWidth, state.startSize.width - dx))
      }
      if (state.axis === 'bottom' || state.axis === 'corner') {
        next.height = Math.max(300, Math.min(maxHeight, state.startSize.height + dy))
      }
      if (state.axis === 'top') {
        next.height = Math.max(300, Math.min(maxHeight, state.startSize.height - dy))
      }
      setChartSize(next)
    }

    function onMouseUp() {
      setResizing(null)
      resizeStateRef.current = null
    }

    document.body.style.userSelect = 'none'
    document.body.style.cursor =
      resizing === 'right' || resizing === 'left'  ? 'ew-resize' :
      resizing === 'bottom' || resizing === 'top'  ? 'ns-resize' :
                                                     'nwse-resize'

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup',   onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup',   onMouseUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
  }, [resizing])

  function startResize(axis, e) {
    e.preventDefault()
    const rect = chartWrapRef.current?.getBoundingClientRect()
    if (!rect) return
    resizeStateRef.current = {
      startX:    e.clientX,
      startY:    e.clientY,
      startSize: { width: rect.width, height: rect.height },
      axis,
    }
    setResizing(axis)
  }

  function resetChartSize() {
    setChartSize(null)
    try { localStorage.removeItem(CHART_SIZE_KEY) } catch { /* ignore */ }
  }

  function pickSymbol(s) {
    setSymbol(s)
    setDropdownOpen(false)
    setSearch('')
  }

  // Fetch COT data when symbol or weeks changes
  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch(`/api/cot/${symbol}?weeks=${weeks}`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(d  => { setData(d);          setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [symbol, weeks])

  // Filter symbol groups by search query
  const filteredGroups = Object.entries(SYMBOL_GROUPS).reduce((acc, [grp, syms]) => {
    const q = search.toLowerCase()
    const matches = syms.filter(s =>
      s.toLowerCase().includes(q) ||
      (SYMBOL_NAMES[s] || '').toLowerCase().includes(q) ||
      grp.toLowerCase().includes(q)
    )
    if (matches.length) acc[grp] = matches
    return acc
  }, {})

  // ── Chart config ─────────────────────────────────────────────────────────────
  const labels  = data ? data.map(d => fmtDate(d.date)) : []
  const hasData = data && data.length > 0

  // Symmetric net-positioning bound — rounded up to a clean number
  const netBound = hasData
    ? roundUpNice(Math.max(
        ...data.flatMap(d => [
          Math.abs(d.large_spec_net),
          Math.abs(d.commercial_net),
          Math.abs(d.small_spec_net),
        ])
      ))
    : 250000

  // Latest report + week-over-week deltas for the header stat chips
  const latest = hasData ? data[data.length - 1] : null
  const prev   = hasData && data.length > 1 ? data[data.length - 2] : null
  const chips  = latest ? [
    { key: 'commercials',  label: 'Commercials', value: latest.commercial_net,
      delta: prev ? latest.commercial_net - prev.commercial_net : null },
    { key: 'largeSpecs',   label: 'Large Specs', value: latest.large_spec_net,
      delta: prev ? latest.large_spec_net - prev.large_spec_net : null },
    { key: 'smallSpecs',   label: 'Small Specs', value: latest.small_spec_net,
      delta: prev ? latest.small_spec_net - prev.small_spec_net : null },
    { key: 'openInterest', label: 'Open Interest', value: latest.open_interest,
      delta: prev ? latest.open_interest - prev.open_interest : null, compact: true },
  ] : []

  // Fixed axis width so the two stacked panels align vertically
  const AXIS_FIT = axis => { axis.width = 64 }

  const tooltipStyle = {
    backgroundColor: '#22251e',
    titleColor:      '#f0ead8',
    titleFont:       { weight: 'bold', size: 12 },
    bodyColor:       '#e0dac8',
    bodyFont:        { size: 11 },
    borderColor:     'rgba(201, 168, 76, 0.35)',
    borderWidth:     1,
    padding:         10,
    cornerRadius:    6,
  }

  const netData = hasData ? {
    labels,
    datasets: [
      {
        type:            'bar',
        label:           'Commercials',
        data:            data.map(d => d.commercial_net),
        backgroundColor: SERIES_COLORS.commercials,
        borderRadius:    3,
        borderSkipped:   'start',
        maxBarThickness: 14,
        categoryPercentage: 0.68,
        barPercentage:   0.9,
        order:           1,
      },
      {
        type:            'bar',
        label:           'Large Speculators',
        data:            data.map(d => d.large_spec_net),
        backgroundColor: SERIES_COLORS.largeSpecs,
        borderRadius:    3,
        borderSkipped:   'start',
        maxBarThickness: 14,
        categoryPercentage: 0.68,
        barPercentage:   0.9,
        order:           2,
      },
      {
        type:            'bar',
        label:           'Small Speculators',
        data:            data.map(d => d.small_spec_net),
        backgroundColor: SERIES_COLORS.smallSpecs,
        borderRadius:    3,
        borderSkipped:   'start',
        maxBarThickness: 14,
        categoryPercentage: 0.68,
        barPercentage:   0.9,
        order:           3,
      },
    ],
  } : null

  const netOptions = {
    responsive:          true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend:  { display: false },
      tooltip: {
        ...tooltipStyle,
        callbacks: {
          title: items => items[0]?.label || '',
          label: ctx   => `  ${ctx.dataset.label}: ${fmtNum(ctx.raw)}`,
          labelColor: ctx => {
            const colors = {
              'Commercials':       SERIES_COLORS.commercials,
              'Large Speculators': SERIES_COLORS.largeSpecs,
              'Small Speculators': SERIES_COLORS.smallSpecs,
            }
            const c = colors[ctx.dataset.label] || '#f0ead8'
            return { borderColor: c, backgroundColor: c, borderRadius: 2 }
          },
        },
      },
    },
    scales: {
      x: {
        grid:   { display: false },
        border: { color: 'rgba(168, 162, 144, 0.15)' },
        ticks:  { display: false },
      },
      y: {
        min:      -netBound,
        max:       netBound,
        afterFit:  AXIS_FIT,
        grid: {
          color: ctx => ctx.tick.value === 0 ? ZERO_LINE : GRID_FAINT,
          lineWidth: ctx => ctx.tick.value === 0 ? 1.5 : 1,
        },
        border: { display: false },
        ticks:  {
          color: AXIS_TEXT,
          font:  { size: 10 },
          callback: v => v == null ? '' : v < 0 ? `(${Math.abs(v).toLocaleString()})` : v.toLocaleString(),
        },
      },
    },
  }

  const oiData = hasData ? {
    labels,
    datasets: [
      {
        type:            'line',
        label:           'Open Interest',
        data:            data.map(d => d.open_interest),
        borderColor:     SERIES_COLORS.openInterest,
        backgroundColor: 'rgba(212, 201, 168, 0.10)',
        fill:            true,
        borderWidth:     1.5,
        tension:         0.35,
        pointRadius:     0,
        pointHoverRadius:4,
        pointHoverBackgroundColor: SERIES_COLORS.openInterest,
      },
    ],
  } : null

  const oiOptions = {
    responsive:          true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend:  { display: false },
      tooltip: {
        ...tooltipStyle,
        callbacks: {
          title: items => items[0]?.label || '',
          label: ctx   => `  Open Interest: ${Math.round(ctx.raw).toLocaleString()}`,
          labelColor: () => ({
            borderColor:     SERIES_COLORS.openInterest,
            backgroundColor: SERIES_COLORS.openInterest,
            borderRadius:    2,
          }),
        },
      },
    },
    scales: {
      x: {
        grid:   { display: false },
        border: { color: 'rgba(168, 162, 144, 0.15)' },
        ticks:  {
          color:         AXIS_TEXT,
          maxTicksLimit: 13,
          maxRotation:   0,
          font:          { size: 10 },
        },
      },
      y: {
        afterFit: AXIS_FIT,
        grid:     { color: GRID_FAINT },
        border:   { display: false },
        ticks:    {
          color:         AXIS_TEXT,
          maxTicksLimit: 4,
          font:          { size: 10 },
          callback: v => fmtCompact(v),
        },
      },
    },
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className={styles.page}>

      {/* Top bar */}
      <div className={styles.topBar}>

        {/* Market dropdown */}
        <div className={styles.dropdownWrap} ref={dropdownRef}>
          <button
            className={styles.dropdownBtn}
            onClick={() => setDropdownOpen(v => !v)}
          >
            <span>{SYMBOL_NAMES[symbol] || symbol} ({symbol})</span>
            <span className={styles.chevron}>{dropdownOpen ? '▲' : '▼'}</span>
          </button>

          {/* Desktop: anchored popover. Touch: bottom-sheet (below). */}
          {dropdownOpen && !isTouch && (
            <div className={styles.dropdownMenu}>
              <input
                className={styles.dropdownSearch}
                placeholder="Search markets..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                autoFocus
              />
              <div className={styles.dropdownList}>
                {Object.entries(filteredGroups).map(([grp, syms]) => (
                  <div key={grp}>
                    <div className={styles.dropdownGroup}>{grp}</div>
                    {syms.map(s => (
                      <div
                        key={s}
                        className={`${styles.dropdownItem} ${s === symbol ? styles.dropdownItemActive : ''}`}
                        onClick={() => pickSymbol(s)}
                      >
                        <span className={styles.dropdownSym}>{s}</span>
                        <span className={styles.dropdownName}>{SYMBOL_NAMES[s] || ''}</span>
                      </div>
                    ))}
                  </div>
                ))}
                {Object.keys(filteredGroups).length === 0 && (
                  <div style={{ padding: '14px', fontSize: '12px', color: 'var(--text-muted)' }}>
                    No markets match "{search}"
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Touch: market picker as a bottom-sheet with 44px tap targets. */}
        {isTouch && (
          <Sheet
            open={dropdownOpen}
            onClose={() => { setDropdownOpen(false); setSearch('') }}
            variant="bottom-sheet"
            title="Select market"
          >
            <input
              className={styles.sheetSearch}
              placeholder="Search markets..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {Object.entries(filteredGroups).map(([grp, syms]) => (
              <div key={grp}>
                <div className={styles.dropdownGroup}>{grp}</div>
                {syms.map(s => (
                  <div
                    key={s}
                    className={`${styles.sheetItem} ${s === symbol ? styles.sheetItemActive : ''}`}
                    onClick={() => pickSymbol(s)}
                  >
                    <span className={styles.dropdownSym}>{s}</span>
                    <span className={styles.dropdownName}>{SYMBOL_NAMES[s] || ''}</span>
                  </div>
                ))}
              </div>
            ))}
            {Object.keys(filteredGroups).length === 0 && (
              <div style={{ padding: '14px', fontSize: '13px', color: 'var(--text-muted)' }}>
                No markets match "{search}"
              </div>
            )}
          </Sheet>
        )}

        {/* Lookback buttons */}
        <div className={styles.lookbackBtns}>
          {LOOKBACKS.map(lb => (
            <button
              key={lb.label}
              className={`${styles.lookbackBtn} ${weeks === lb.weeks ? styles.lookbackActive : ''}`}
              onClick={() => setWeeks(lb.weeks)}
            >
              {lb.label}
            </button>
          ))}
          {chartSize && (
            <button
              className={styles.resetSizeBtn}
              onClick={resetChartSize}
              title="Reset chart to default size"
            >
              ↻ Reset size
            </button>
          )}
        </div>

      </div>

      {/* Chart */}
      <div
        ref={chartWrapRef}
        className={styles.chartWrap}
        style={chartSize ? {
          width:  chartSize.width  ? `${chartSize.width}px`  : undefined,
          height: chartSize.height ? `${chartSize.height}px` : undefined,
        } : undefined}
      >
        {loading && (
          <div className={styles.overlay}>Loading COT data…</div>
        )}
        {!loading && error && (
          <div className={`${styles.overlay} ${styles.overlayError}`}>
            {error}
          </div>
        )}
        {!loading && !error && (!data || data.length === 0) && (
          <div className={styles.overlay}>
            No COT data available for {symbol}
            {data !== null && ' — database may still be seeding'}
          </div>
        )}
        {!loading && !error && netData && (
          <ChartErrorBoundary>
            <div className={styles.chartHeader}>
              <div className={styles.chartHeaderLeft}>
                <div className={styles.eyebrow}>CFTC — Commitment of Traders</div>
                <div className={styles.chartTitle}>
                  {SYMBOL_NAMES[symbol] || symbol}
                  <span className={styles.chartTitleSym}>{symbol}</span>
                </div>
                {latest && (
                  <div className={styles.chartSub}>
                    Net positioning · latest report {fmtDate(latest.date)}
                  </div>
                )}
              </div>
              <div className={styles.legendChips}>
                {chips.map(c => (
                  <div key={c.key} className={styles.chip}>
                    <span
                      className={styles.chipDot}
                      style={{ background: SERIES_COLORS[c.key] }}
                    />
                    <div className={styles.chipBody}>
                      <span className={styles.chipLabel}>{c.label}</span>
                      <span className={styles.chipVal}>
                        {c.compact ? fmtCompact(c.value) : fmtNum(c.value)}
                        {c.delta != null && c.delta !== 0 && (
                          <span className={c.delta > 0 ? styles.chipDeltaUp : styles.chipDeltaDown}>
                            {c.delta > 0 ? '▲' : '▼'} {fmtCompact(Math.abs(c.delta))}
                          </span>
                        )}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className={styles.netPanel}>
              <Chart type="bar" data={netData} options={netOptions} />
            </div>

            <div className={styles.oiHeader}>
              <span className={styles.oiLabel}>Open Interest</span>
              <span className={styles.oiNote}>total contracts outstanding</span>
            </div>
            <div className={styles.oiPanel}>
              <Chart type="line" data={oiData} options={oiOptions} />
            </div>
          </ChartErrorBoundary>
        )}

        {/* Resize handles */}
        <div
          className={styles.resizeHandleRight}
          onMouseDown={e => startResize('right', e)}
          title="Drag to adjust chart width"
        />
        <div
          className={styles.resizeHandleLeft}
          onMouseDown={e => startResize('left', e)}
          title="Drag to adjust chart width"
        />
        <div
          className={styles.resizeHandleBottom}
          onMouseDown={e => startResize('bottom', e)}
          title="Drag to adjust chart height"
        />
        <div
          className={styles.resizeHandleTop}
          onMouseDown={e => startResize('top', e)}
          title="Drag to adjust chart height"
        />
        <div
          className={styles.resizeHandleCorner}
          onMouseDown={e => startResize('corner', e)}
          title="Drag to adjust chart width and height"
        />
      </div>

    </div>
  )
}

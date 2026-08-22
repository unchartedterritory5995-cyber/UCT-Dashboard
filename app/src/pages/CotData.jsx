// app/src/pages/CotData.jsx
import { useState, useRef, useEffect, useMemo, Component } from 'react'
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
import PositioningRail from './cot/PositioningRail'
import { SERIES_COLORS, HOVER_COLORS } from './cot/cotPalette'
import { fmtDate, fmtNum, fmtCompact } from './cot/cotFormat'
import { tooltipRows } from './cot/cotTooltip'
import { proxyFor } from './cot/cotProxies'
import { alignPrice } from './cot/cotAnalogs'

ChartJS.register(
  CategoryScale, LinearScale,
  BarController, BarElement,
  LineController, LineElement, PointElement,
  Title, Tooltip, Legend, Filler,
)

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

// One fetch per symbol: the API maximum (10 years). The chart shows the
// selected lookback as a client-side slice, and the positioning rail needs the
// three years BEHIND every visible week for its COT Index — history the
// visible window alone cannot supply.
const FETCH_WEEKS = 520

// Weekly closes of the ETF proxy (price context for the rail's precedents and
// divergence checks, and the price pane). 600 > FETCH_WEEKS so every report
// week has a bar; missing weeks simply align to null.
const PRICE_BARS = 600
const PRICE_COLOR = '#f0ead8'

// ── Helpers ────────────────────────────────────────────────────────────────────

// "via USO (ETF proxy — roll drag)" → "ETF proxy — roll drag"; "via SPY" → "".
function proxyExtra(proxy) {
  if (!proxy?.note) return ''
  return proxy.note.replace(/^via\s+\S+\s*/, '').replace(/^\(|\)$/g, '').trim()
}

// Round up/down to 2-significant-digit precision (e.g. 201,000 → 210,000; 317,489 → 320,000)
function roundUpNice(val) {
  if (val <= 0) return 0
  const mag = Math.pow(10, Math.floor(Math.log10(val)) - 1)
  return Math.ceil(val / mag) * mag
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
  const [data,         setData]         = useState(null)   // full FETCH_WEEKS history for `symbol`
  const [bars,         setBars]         = useState(null)   // weekly bars of the price proxy, or null
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState(null)
  const [chartSize,    setChartSize]    = useState(null)   // { width?, height? } or null = default
  const [resizing,     setResizing]     = useState(null)   // 'right' | 'bottom' | 'corner' | null
  const dropdownRef    = useRef(null)
  const chartWrapRef   = useRef(null)
  const railWrapRef    = useRef(null)
  const resizeStateRef = useRef(null)
  const isTouch        = useIsTouch()

  // Cross-pane hover sync — written via DOM refs (never React state) so a
  // mousemove doesn't re-render four Chart.js instances. The positioning rail
  // owns its own state behind an imperative handle for the same reason.
  const chartInstRef = useRef({})   // pane key -> Chart.js instance
  const readoutRef   = useRef({})   // pane key -> value <span>
  const deltaElRef   = useRef({})   // pane key -> delta <span>
  const hoverDateRef = useRef(null) // "Week of …" chip
  const railRef      = useRef(null) // PositioningRail imperative handle
  const dataRef      = useRef(null) // the VISIBLE slice
  const priceRef     = useRef(null) // proxy closes aligned to the VISIBLE slice
  const proxyRef     = useRef(null) // { ticker, note } or null
  const tipElRef     = useRef(null) // the ONE HTML tooltip shared by every pane
  const lastHoverRef = useRef(undefined)

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
      const parent      = chartWrapRef.current?.parentElement
      const parentWidth = parent?.clientWidth || window.innerWidth
      // Leave room for the rail beside the chart (it stacks below on narrow screens).
      const railEl    = railWrapRef.current
      const railBeside = railEl && parent && railEl.offsetTop === chartWrapRef.current.offsetTop
      const maxWidth  = railBeside ? parentWidth - railEl.offsetWidth - 16 : parentWidth
      const maxHeight = window.innerHeight - 100

      if (state.axis === 'right' || state.axis === 'corner') {
        next.width = Math.max(400, Math.min(maxWidth, state.startSize.width + dx))
      }
      if (state.axis === 'left') {
        next.width = Math.max(400, Math.min(maxWidth, state.startSize.width - dx))
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

  // Fetch the full history once per symbol; lookback is a client-side slice.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/cot/${symbol}?weeks=${FETCH_WEEKS}`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(d  => { if (!cancelled) { setData(d);          setLoading(false) } })
      .catch(e => { if (!cancelled) { setError(e.message); setLoading(false) } })
    return () => { cancelled = true }
  }, [symbol])

  // Price context: the proxy ETF's weekly closes, fetched alongside (never
  // blocking) the COT history. Symbols without a liquid proxy get none.
  const proxy = useMemo(() => proxyFor(symbol), [symbol])
  useEffect(() => {
    let cancelled = false
    setBars(null)
    if (!proxy) return undefined
    fetch(`/api/bars/${proxy.ticker}?tf=W&bars=${PRICE_BARS}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled) setBars(Array.isArray(d?.bars) ? d.bars : []) })
      .catch(() => { if (!cancelled) setBars([]) })
    return () => { cancelled = true }
  }, [proxy])

  // The visible window: the last `weeks` reports of the fetched history.
  const view      = useMemo(() => (data ? data.slice(-weeks) : null), [data, weeks])
  const viewStart = data && view ? data.length - view.length : 0

  // One close per report week (first Friday bar on/after the Tuesday report).
  const priceAligned = useMemo(
    () => (data && bars && bars.length ? alignPrice(data, bars) : null),
    [data, bars],
  )
  const priceView = useMemo(
    () => (priceAligned && view ? priceAligned.slice(-view.length) : null),
    [priceAligned, view],
  )
  const hasPrice = !!(priceView && priceView.some(v => v != null))

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
  const labels  = view ? view.map(d => fmtDate(d.date)) : []
  const hasData = view && view.length > 0

  // Latest report + week-over-week deltas for the pane headers
  const latest = hasData ? view[view.length - 1] : null
  const prev   = hasData && view.length > 1 ? view[view.length - 2] : null

  // Fixed axis width so all stacked panes align vertically
  const AXIS_FIT = axis => { axis.width = 64 }

  // ── Cross-pane hover sync ────────────────────────────────────────────────────
  dataRef.current  = view
  priceRef.current = priceView
  proxyRef.current = proxy

  const priceInfoAt = i => (proxyRef.current && priceRef.current
    ? { ticker: proxyRef.current.ticker, close: priceRef.current[i] ?? null }
    : undefined)

  const FIELD_BY_KEY = {
    commercials: 'commercial_net',
    largeSpecs:  'large_spec_net',
    smallSpecs:  'small_spec_net',
  }

  function setDeltaEl(el, delta) {
    if (!el) return
    if (delta == null || delta === 0) { el.style.visibility = 'hidden'; return }
    el.style.visibility = 'visible'
    el.textContent = `${delta > 0 ? '▲' : '▼'} ${fmtCompact(Math.abs(delta))} wk`
    el.className = delta > 0 ? styles.paneDeltaUp : styles.paneDeltaDown
  }

  // Hovering a week in ANY pane highlights it in every pane, live-updates all
  // pane-header readouts, and points the positioning rail at that week;
  // idx null restores the latest report.
  function applyHover(idx, sourceKey) {
    if (lastHoverRef.current === idx) return
    lastHoverRef.current = idx
    const d = dataRef.current
    if (!d || !d.length) return
    const i       = idx == null ? d.length - 1 : idx
    const row     = d[i]
    const prevRow = i > 0 ? d[i - 1] : null

    for (const [key, field] of Object.entries(FIELD_BY_KEY)) {
      const vEl = readoutRef.current[key]
      if (vEl) vEl.textContent = fmtNum(row[field])
      setDeltaEl(deltaElRef.current[key], prevRow ? row[field] - prevRow[field] : null)
    }
    const oiEl = readoutRef.current.openInterest
    if (oiEl) oiEl.textContent = fmtCompact(row.open_interest)
    setDeltaEl(deltaElRef.current.openInterest,
      prevRow ? row.open_interest - prevRow.open_interest : null)

    // Price pane readout: close + week-over-week % (the proxy's own scale).
    const pEl = readoutRef.current.price
    const px  = priceRef.current
    if (pEl && px) {
      const cur = px[i], prv = i > 0 ? px[i - 1] : null
      pEl.textContent = cur == null ? '—' : cur.toFixed(2)
      const dEl = deltaElRef.current.price
      if (dEl) {
        if (cur == null || prv == null || prv === 0 || cur === prv) dEl.style.visibility = 'hidden'
        else {
          const pct = ((cur - prv) / prv) * 100
          dEl.style.visibility = 'visible'
          dEl.textContent = `${pct > 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(1)}% wk`
          dEl.className = pct > 0 ? styles.paneDeltaUp : styles.paneDeltaDown
        }
      }
    }

    const dEl = hoverDateRef.current
    if (dEl) {
      dEl.textContent   = idx == null ? '' : `Week of ${fmtDate(row.date)}`
      dEl.style.opacity = idx == null ? '0' : '1'
    }

    railRef.current?.setIndex(idx == null ? null : viewStart + idx)
    if (idx == null) hideTip()

    for (const [key, chart] of Object.entries(chartInstRef.current)) {
      if (!chart || key === sourceKey) continue
      try {
        chart.setActiveElements(idx == null ? [] : [{ datasetIndex: 0, index: idx }])
        chart.tooltip?.setActiveElements([], { x: 0, y: 0 })
        chart.update('none')
      } catch { /* chart mid-teardown */ }
    }
  }

  // New symbol/lookback: resync readouts to the fresh latest report
  useEffect(() => {
    lastHoverRef.current = undefined
    applyHover(null, null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view])

  // Every pane's tooltip lists ALL series for the hovered week — the hovered
  // pane's own series first (highlighted), the rest beneath. It is ONE HTML
  // element inside panesWrap rather than Chart.js's canvas tooltip: a canvas
  // tooltip is clipped by its own pane, and with five stacked panes no pane is
  // tall enough for six lines.
  const TIP_COLORS = { ...SERIES_COLORS, price: PRICE_COLOR }

  function hideTip() {
    const el = tipElRef.current
    if (el) el.style.opacity = '0'
  }

  function renderTip(el, title, rows) {
    while (el.firstChild) el.removeChild(el.firstChild)
    const t = document.createElement('div')
    t.className = styles.tipTitle
    t.textContent = title
    el.appendChild(t)
    for (const r of rows) {
      const line = document.createElement('div')
      line.className = r.hot ? `${styles.tipRow} ${styles.tipRowHot}` : styles.tipRow
      const dot = document.createElement('span')
      dot.className = styles.tipDot
      dot.style.background = TIP_COLORS[r.key] || AXIS_TEXT
      const lab = document.createElement('span')
      lab.className = styles.tipLabel
      lab.textContent = r.label
      const val = document.createElement('span')
      val.className = styles.tipVal
      val.textContent = r.value
      line.append(dot, lab, val)
      el.appendChild(line)
    }
  }

  function tooltipPlugin(key) {
    return {
      enabled: false,
      external: ({ chart, tooltip }) => {
        const el = tipElRef.current
        if (!el) return
        const i = tooltip?.dataPoints?.[0]?.dataIndex
        const row = tooltip && tooltip.opacity !== 0 && i != null ? dataRef.current?.[i] : null
        if (!row) { el.style.opacity = '0'; return }
        renderTip(el, `Week of ${fmtDate(row.date)}`, tooltipRows(row, key, priceInfoAt(i)))
        const wrap = el.parentElement
        const c = chart.canvas.getBoundingClientRect()
        const w = wrap.getBoundingClientRect()
        const pad = 14
        let x = c.left - w.left + tooltip.caretX + pad
        let y = c.top - w.top + tooltip.caretY - el.offsetHeight / 2
        if (x + el.offsetWidth > wrap.clientWidth) x = c.left - w.left + tooltip.caretX - pad - el.offsetWidth
        y = Math.max(0, Math.min(y, wrap.clientHeight - el.offsetHeight))
        el.style.left = `${Math.round(x)}px`
        el.style.top  = `${Math.round(y)}px`
        el.style.opacity = '1'
      },
    }
  }

  // One pane per trader group — each with its own zero line, symmetric to its
  // own extreme so every group reads against its own history.
  const PANE_DEFS = [
    { key: 'commercials', label: 'Commercials',        field: 'commercial_net' },
    { key: 'largeSpecs',  label: 'Large Speculators',  field: 'large_spec_net' },
    { key: 'smallSpecs',  label: 'Small Speculators',  field: 'small_spec_net' },
  ]

  const fmtNet = v =>
    v == null ? '' : v < 0 ? `(${fmtCompact(Math.abs(v))})` : fmtCompact(v)

  const panes = hasData ? PANE_DEFS.map(def => {
    const series = view.map(d => d[def.field])
    // Asymmetric bounds: fit each side to that group's own extremes so a
    // one-sided group (e.g. always-short large specs) uses the full pane
    // height. The minority side keeps a 12% floor so small bars stay visible.
    const up   = roundUpNice(Math.max(...series, 0))
    const dn   = roundUpNice(Math.max(...series.map(v => -v), 0))
    const span = Math.max(up, dn, 1000)
    const yMax = Math.max(up, roundUpNice(span * 0.12))
    const yMin = -Math.max(dn, roundUpNice(span * 0.12))
    // A padded (breathing-room-only) edge gets no label — it would crowd the 0.
    const upPadded = yMax > up
    const dnPadded = -yMin > dn
    const color = SERIES_COLORS[def.key]
    return {
      ...def,
      color,
      latest: latest[def.field],
      delta:  prev ? latest[def.field] - prev[def.field] : null,
      chartData: {
        labels,
        datasets: [{
          type:            'bar',
          label:           def.label,
          data:            series,
          backgroundColor: color,
          hoverBackgroundColor: HOVER_COLORS[def.key],
          borderRadius:    2,
          borderSkipped:   'start',
          maxBarThickness: 20,
          categoryPercentage: 0.82,
          barPercentage:   0.86,
        }],
      },
      chartOptions: {
        responsive:          true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        onHover: (evt, els) => applyHover(els.length ? els[0].index : null, def.key),
        plugins: {
          legend:  { display: false },
          tooltip: tooltipPlugin(def.key),
        },
        scales: {
          x: {
            grid:   { display: false },
            border: { display: false },
            ticks:  { display: false },
          },
          y: {
            min:      yMin,
            max:      yMax,
            afterFit: AXIS_FIT,
            // Exactly three ticks — floor, zero, ceiling — so the gold zero
            // line always renders even with asymmetric bounds.
            afterBuildTicks: axis => {
              axis.ticks = [yMin, 0, yMax].map(value => ({ value }))
            },
            grid: {
              color: ctx => ctx.tick.value === 0 ? ZERO_LINE : GRID_FAINT,
              lineWidth: ctx => ctx.tick.value === 0 ? 1.5 : 1,
            },
            border: { display: false },
            ticks:  {
              color: AXIS_TEXT,
              font:  { size: 10 },
              callback: v => {
                if ((v === yMax && upPadded) || (v === yMin && dnPadded)) return ''
                return fmtNet(v)
              },
            },
          },
        },
      },
    }
  }) : []

  // Price pane (proxy ETF weekly closes) — sits above the trader groups so the
  // reader sees what price did before reading who was positioned for it.
  const priceData = hasPrice ? {
    labels,
    datasets: [{
      type:            'line',
      label:           `Price (${proxy.ticker})`,
      data:            priceView,
      borderColor:     PRICE_COLOR,
      borderWidth:     1.5,
      tension:         0.25,
      pointRadius:     0,
      pointHoverRadius: 4,
      pointHoverBackgroundColor: PRICE_COLOR,
      spanGaps:        false,
    }],
  } : null

  const priceOptions = {
    responsive:          true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    onHover: (evt, els) => applyHover(els.length ? els[0].index : null, 'price'),
    plugins: {
      legend:  { display: false },
      tooltip: tooltipPlugin('price'),
    },
    scales: {
      x: { grid: { display: false }, border: { display: false }, ticks: { display: false } },
      y: {
        afterFit: AXIS_FIT,
        grid:     { color: GRID_FAINT },
        border:   { display: false },
        ticks:    { color: AXIS_TEXT, maxTicksLimit: 4, font: { size: 10 },
                    callback: v => (Math.abs(v) >= 1000 ? fmtCompact(v) : String(Math.round(v))) },
      },
    },
  }

  const oiData = hasData ? {
    labels,
    datasets: [
      {
        type:            'line',
        label:           'Open Interest',
        data:            view.map(d => d.open_interest),
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
    onHover: (evt, els) => applyHover(els.length ? els[0].index : null, 'openInterest'),
    plugins: {
      legend:  { display: false },
      tooltip: tooltipPlugin('openInterest'),
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

      {/* Chart + positioning rail */}
      <div className={styles.body}>

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
        {!loading && !error && (!view || view.length === 0) && (
          <div className={styles.overlay}>
            No COT data available for {symbol}
            {data !== null && ' — database may still be seeding'}
          </div>
        )}
        {!loading && !error && hasData && (
          <ChartErrorBoundary>
            <div className={styles.chartHeader}>
              <div className={styles.chartHeaderLeft}>
                <div className={styles.eyebrow}>Commitment of Traders</div>
                <div className={styles.chartTitle}>
                  {SYMBOL_NAMES[symbol] || symbol}
                  <span className={styles.chartTitleSym}>{symbol}</span>
                </div>
                {latest && (
                  <div className={styles.chartSub}>
                    Weekly net positioning by trader group · CFTC report {fmtDate(latest.date)}
                  </div>
                )}
              </div>
            </div>

            <div className={styles.panesWrap} onMouseLeave={() => applyHover(null, null)}>
              <div className={styles.watermark} aria-hidden="true">
                <span className={styles.watermarkSym}>{symbol}</span>
                <span className={styles.watermarkName}>
                  {SYMBOL_NAMES[symbol] || symbol}
                </span>
              </div>
              <div className={styles.hoverDate} ref={hoverDateRef} aria-hidden="true" />
              <div className={styles.tip} ref={tipElRef} aria-hidden="true" />

              {hasPrice && (
                <div className={`${styles.pane} ${styles.panePrice}`}>
                  <div className={styles.paneHeader}>
                    <span className={styles.paneDot} style={{ background: PRICE_COLOR }} />
                    <span className={styles.paneLabel}>Price · {proxy.ticker}</span>
                    {proxyExtra(proxy) && <span className={styles.paneNote}>{proxyExtra(proxy)}</span>}
                    <span
                      className={styles.paneVal}
                      ref={el => { readoutRef.current.price = el }}
                    >
                      {priceView[priceView.length - 1] != null ? priceView[priceView.length - 1].toFixed(2) : '—'}
                    </span>
                    <span
                      ref={el => { deltaElRef.current.price = el }}
                      className={styles.paneDeltaUp}
                      style={{ visibility: 'hidden' }}
                    >
                      —
                    </span>
                  </div>
                  <div className={styles.paneBody}>
                    <Chart
                      type="line"
                      data={priceData}
                      options={priceOptions}
                      ref={el => { chartInstRef.current.price = el }}
                    />
                  </div>
                </div>
              )}

              {panes.map(p => (
                <div key={p.key} className={styles.pane}>
                  <div className={styles.paneHeader}>
                    <span className={styles.paneDot} style={{ background: p.color }} />
                    <span className={styles.paneLabel}>{p.label}</span>
                    <span
                      className={styles.paneVal}
                      ref={el => { readoutRef.current[p.key] = el }}
                    >
                      {fmtNum(p.latest)}
                    </span>
                    <span
                      ref={el => { deltaElRef.current[p.key] = el }}
                      className={p.delta > 0 ? styles.paneDeltaUp : styles.paneDeltaDown}
                      style={p.delta == null || p.delta === 0 ? { visibility: 'hidden' } : undefined}
                    >
                      {p.delta != null && p.delta !== 0
                        ? `${p.delta > 0 ? '▲' : '▼'} ${fmtCompact(Math.abs(p.delta))} wk`
                        : '—'}
                    </span>
                  </div>
                  <div className={styles.paneBody}>
                    <Chart
                      type="bar"
                      data={p.chartData}
                      options={p.chartOptions}
                      ref={el => { chartInstRef.current[p.key] = el }}
                    />
                  </div>
                </div>
              ))}

              <div className={`${styles.pane} ${styles.paneOi}`}>
                <div className={styles.paneHeader}>
                  <span className={styles.paneDot} style={{ background: SERIES_COLORS.openInterest }} />
                  <span className={styles.paneLabel}>Open Interest</span>
                  <span
                    className={styles.paneVal}
                    ref={el => { readoutRef.current.openInterest = el }}
                  >
                    {fmtCompact(latest.open_interest)}
                  </span>
                  <span
                    ref={el => { deltaElRef.current.openInterest = el }}
                    className={prev && latest.open_interest > prev.open_interest ? styles.paneDeltaUp : styles.paneDeltaDown}
                    style={!prev || latest.open_interest === prev.open_interest ? { visibility: 'hidden' } : undefined}
                  >
                    {prev && latest.open_interest !== prev.open_interest
                      ? `${latest.open_interest > prev.open_interest ? '▲' : '▼'} ${fmtCompact(Math.abs(latest.open_interest - prev.open_interest))} wk`
                      : '—'}
                  </span>
                </div>
                <div className={styles.paneBody}>
                  <Chart
                    type="line"
                    data={oiData}
                    options={oiOptions}
                    ref={el => { chartInstRef.current.openInterest = el }}
                  />
                </div>
              </div>
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

      {/* The rail tracks the hovered week; it reads from the FULL history so
          the 3-year index is right even at the left edge of the chart. */}
      {!loading && !error && hasData && (
        <div ref={railWrapRef} className={styles.railCol}>
          <PositioningRail
            ref={railRef}
            rows={data}
            symbol={symbol}
            name={SYMBOL_NAMES[symbol] || symbol}
            bars={bars}
            priceAligned={priceAligned}
            proxy={proxy}
          />
        </div>
      )}

      </div>

    </div>
  )
}

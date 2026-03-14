// app/src/pages/CotData.jsx
import { useState, useRef, useEffect, Component } from 'react'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale,
  BarController, BarElement,
  LineController, LineElement, PointElement,
  Title, Tooltip, Legend,
} from 'chart.js'
import { Chart } from 'react-chartjs-2'
import styles from './CotData.module.css'

ChartJS.register(
  CategoryScale, LinearScale,
  BarController, BarElement,
  LineController, LineElement, PointElement,
  Title, Tooltip, Legend,
)

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
  INDICES:           ['ES','NQ','YM','QR','EW','VI','NK'],
  METALS:            ['GC','SI','HG','PL','PA','AL'],
  ENERGIES:          ['CL','HO','RB','NG','FL','BZ'],
  GRAINS:            ['ZW','ZC','ZS','ZM','ZL','ZR','KE','MW','OA'],
  SOFTS:             ['CT','OJ','KC','SB','CC','LB'],
  'LIVESTOCK & DAIRY':['LE','GF','HE','DF','BJ'],
  FINANCIALS:        ['ZB','UD','ZN','ZF','ZT','ZQ','SR3'],
  CURRENCIES:        ['DX','B6','D6','J6','S6','E6','A6','M6','N6','L6','BTC','ETH'],
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

function roundDownNice(val) {
  if (val <= 0) return 0
  const mag = Math.pow(10, Math.floor(Math.log10(val)) - 1)
  return Math.floor(val / mag) * mag
}

function fmtNum(v) {
  if (v == null) return ''
  const abs = Math.abs(Math.round(v)).toLocaleString()
  return v < 0 ? `(${abs})` : abs
}

// ── Error boundary ─────────────────────────────────────────────────────────────

class ChartErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(e) { return { error: e } }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '24px', color: '#ff6b6b', fontSize: '13px', fontFamily: 'monospace' }}>
          Chart error: {String(this.state.error.message || this.state.error)}
        </div>
      )
    }
    return this.props.children
  }
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function CotData() {
  const [symbol,       setSymbol]       = useState('ES')
  const [weeks,        setWeeks]        = useState(52)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [search,       setSearch]       = useState('')
  const [data,         setData]         = useState(null)
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState(null)
  const dropdownRef = useRef(null)

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
  const labels = data ? data.map(d => fmtDate(d.date)) : []

  // Symmetric left-axis bound — rounded up to a clean number
  const leftBound = data && data.length > 0
    ? roundUpNice(Math.max(
        ...data.flatMap(d => [
          Math.abs(d.large_spec_net),
          Math.abs(d.commercial_net),
          Math.abs(d.small_spec_net),
        ])
      ))
    : 250000



  const chartData = data && data.length > 0 ? {
    labels,
    datasets: [
      {
        type:            'bar',
        label:           'Small Speculators',
        data:            data.map(d => d.small_spec_net),
        backgroundColor: '#FFD700',
        yAxisID:         'y',
        order:           3,
      },
      {
        type:            'bar',
        label:           'Large Speculators',
        data:            data.map(d => d.large_spec_net),
        backgroundColor: '#1E90FF',
        yAxisID:         'y',
        order:           2,
      },
      {
        type:            'bar',
        label:           'Commercials',
        data:            data.map(d => d.commercial_net),
        backgroundColor: '#FF3333',
        yAxisID:         'y',
        order:           1,
      },
      {
        type:            'line',
        label:           'Open Interest',
        data:            data.map(d => d.open_interest),
        borderColor:     '#00FF00',
        backgroundColor: 'transparent',
        borderWidth:     2,
        tension:         0.4,
        pointRadius:     0,
        pointHoverRadius:5,
        yAxisID:         'y2',
        order:           0,
      },
    ],
  } : null

  const chartOptions = {
    responsive:          true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      title: {
        display: true,
        text:    `${SYMBOL_NAMES[symbol] || symbol} — ${symbol}`,
        color:   'white',
        font:    { size: 13, weight: 'normal' },
        padding: { bottom: 18 },
      },
      legend: {
        position: 'bottom',
        labels: {
          color:          'rgba(255,255,255,0.75)',
          usePointStyle:  true,
          pointStyleWidth:10,
          padding:        22,
          font:           { size: 11 },
        },
      },
      tooltip: {
        backgroundColor: '#1a1a1a',
        titleColor:      'white',
        titleFont:       { weight: 'bold', size: 12 },
        bodyFont:        { size: 11 },
        borderColor:     '#333',
        borderWidth:     1,
        padding:         10,
        callbacks: {
          title:      items => items[0]?.label || '',
          label:      ctx  => {
            const v = ctx.raw
            const lbl = ctx.dataset.label
            if (lbl === 'Open Interest') {
              return `  Open Interest: ${Math.round(v).toLocaleString()}`
            }
            return `  ${lbl}: ${fmtNum(v)}`
          },
          labelColor: ctx  => {
            const colors = {
              'Small Speculators': '#FFD700',
              'Large Speculators': '#1E90FF',
              'Commercials':       '#FF3333',
              'Open Interest':     '#00FF00',
            }
            const c = colors[ctx.dataset.label] || 'white'
            return { borderColor: c, backgroundColor: c }
          },
        },
      },
    },
    scales: {
      x: {
        grid:   { display: false },
        border: { color: '#444' },
        ticks:  {
          color:        'rgba(255,255,255,0.55)',
          maxTicksLimit: 13,
          maxRotation:   0,
          font:          { size: 10 },
        },
      },
      y: {
        min:    -leftBound,
        max:     leftBound,
        grid:   { color: '#2a2a2a' },
        border: { color: '#444', dash: [4, 4] },
        ticks:  {
          color: 'rgba(255,255,255,0.6)',
          font:  { size: 10 },
          callback: v => v == null ? '' : v < 0 ? `(${Math.abs(v).toLocaleString()})` : v.toLocaleString(),
        },
      },
      y2: {
        position: 'right',
        afterDataLimits: axis => {
          axis.max = roundUpNice(axis.max)
          axis.min = Math.max(0, roundDownNice(axis.max / 4))
        },
        grid:     { display: false },
        border:   { color: '#333' },
        ticks:    {
          color: 'rgba(0,255,0,0.7)',
          font:  { size: 10 },
          callback: v => v == null ? '' : v.toLocaleString(),
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

          {dropdownOpen && (
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
                        onClick={() => { setSymbol(s); setDropdownOpen(false); setSearch('') }}
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
        </div>
      </div>

      {/* Chart */}
      <div className={styles.chartWrap}>
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
        {!loading && !error && chartData && (
          <ChartErrorBoundary>
            <Chart type="bar" data={chartData} options={chartOptions} />
          </ChartErrorBoundary>
        )}
      </div>

    </div>
  )
}

import { useState, useMemo, useEffect, useCallback } from 'react'
import useSWR from 'swr'
import StockChart from '../components/StockChart'
import styles from './CustomScan.module.css'

const fetcher = url => fetch(url).then(r => r.json())

// Chart helpers removed — using StockChart component

// ─── Tag metadata ────────────────────────────────────────────────────────

const TAG_META = {
  '52wh':  { label: '52W High',     color: 'green' },
  'ath':   { label: 'ATH',          color: 'green' },
  '20dh':  { label: '20D High',     color: 'teal'  },
  'hvc':   { label: 'Vol High',     color: 'blue'  },
  's2':    { label: 'Stage 2',      color: 'amber' },
  's4':    { label: 'Stage 4',      color: 'red'   },
  'up50m': { label: '+50%/Mo',      color: 'green' },
  'up25m': { label: '+25%/Mo',      color: 'green' },
  'up25q': { label: '+25%/Qtr',     color: 'teal'  },
  'magna': { label: 'Magna',        color: 'amber' },
  'up4d':  { label: '+4% Today',    color: 'green' },
  'dn4d':  { label: '-4% Today',    color: 'red'   },
  '52wl':  { label: '52W Low',      color: 'red'   },
}

// ─── Filter definitions ──────────────────────────────────────────────────

const FILTERS = {
  // Breadth signals
  breadth_tag: {
    label: 'Breadth Signal',
    tab: 'technical',
    options: [
      { label: 'Any',            test: () => true },
      { label: '52-Week High',   test: c => c.tags?.includes('52wh') },
      { label: 'All-Time High',  test: c => c.tags?.includes('ath') },
      { label: 'Stage 2',        test: c => c.tags?.includes('s2') },
      { label: 'HVC (Vol High)', test: c => c.tags?.includes('hvc') },
      { label: 'Magna (+13%/34d)', test: c => c.tags?.includes('magna') },
      { label: '+25%/Quarter',   test: c => c.tags?.includes('up25q') },
      { label: '+25%/Month',     test: c => c.tags?.includes('up25m') },
      { label: '+50%/Month',     test: c => c.tags?.includes('up50m') },
      { label: '+4% Today',      test: c => c.tags?.includes('up4d') },
    ],
  },
  above_50: {
    label: 'Above 50 SMA',
    tab: 'technical',
    options: [
      { label: 'Any', test: () => true },
      { label: 'Yes', test: c => c.a50 === true },
      { label: 'No',  test: c => c.a50 === false },
    ],
  },
  vol_ratio: {
    label: 'Volume Ratio',
    tab: 'technical',
    options: [
      { label: 'Any',           test: () => true },
      { label: 'High >2×',      test: c => c.vr != null && c.vr > 2 },
      { label: 'Elevated 1.5×', test: c => c.vr != null && c.vr >= 1.5 && c.vr <= 2 },
      { label: 'Normal 0.8–1.5×', test: c => c.vr != null && c.vr >= 0.8 && c.vr < 1.5 },
      { label: 'Low <0.8×',     test: c => c.vr != null && c.vr < 0.8 },
    ],
  },
  pct_1d: {
    label: '1D Change',
    tab: 'technical',
    options: [
      { label: 'Any',         test: () => true },
      { label: 'Up >4%',      test: c => c.pct_1d != null && c.pct_1d > 4 },
      { label: 'Up 1–4%',     test: c => c.pct_1d != null && c.pct_1d >= 1 && c.pct_1d <= 4 },
      { label: 'Flat ±1%',    test: c => c.pct_1d != null && Math.abs(c.pct_1d) < 1 },
      { label: 'Down >1%',    test: c => c.pct_1d != null && c.pct_1d < -1 },
    ],
  },
  // Scanner-enriched filters (only apply to scanner candidates)
  setup_type: {
    label: 'Setup Type',
    tab: 'technical',
    options: [
      { label: 'Any',        test: () => true },
      { label: 'Pullback MA',test: c => c.setup_type === 'PULLBACK_MA' },
      { label: 'Remount',    test: c => c.setup_type === 'REMOUNT' },
      { label: 'Gapper',     test: c => c.setup_type === 'GAPPER_NEWS' },
    ],
  },
  alert_state: {
    label: 'Alert State',
    tab: 'technical',
    options: [
      { label: 'Any',        test: () => true },
      { label: 'Actionable', test: c => ['BREAKING','READY','WATCH','WATCH+','PATTERN'].includes(c.alert_state) },
      { label: 'Breaking',   test: c => c.alert_state === 'BREAKING' },
      { label: 'Ready',      test: c => c.alert_state === 'READY' },
      { label: 'Watch',      test: c => c.alert_state === 'WATCH' || c.alert_state === 'WATCH+' },
      { label: 'Pattern',    test: c => c.alert_state === 'PATTERN' },
    ],
  },
  rsi: {
    label: 'RSI (14)',
    tab: 'technical',
    options: [
      { label: 'Any',           test: () => true },
      { label: 'Overbought >70',test: c => c.rsi != null && c.rsi > 70 },
      { label: 'High 60–70',    test: c => c.rsi != null && c.rsi >= 60 && c.rsi <= 70 },
      { label: 'Mid 40–60',     test: c => c.rsi != null && c.rsi >= 40 && c.rsi < 60 },
      { label: 'Low <40',       test: c => c.rsi != null && c.rsi < 40 },
    ],
  },
  ema_dist: {
    label: 'EMA20 Distance',
    tab: 'technical',
    options: [
      { label: 'Any',          test: () => true },
      { label: 'Kiss ≤2%',     test: c => c.ema_distance_pct != null && c.ema_distance_pct <= 2 },
      { label: 'Near 2–5%',    test: c => c.ema_distance_pct != null && c.ema_distance_pct > 2 && c.ema_distance_pct <= 5 },
      { label: 'Extended >8%', test: c => c.ema_distance_pct != null && c.ema_distance_pct > 8 },
    ],
  },
  ma_stack: {
    label: 'MA Stack',
    tab: 'technical',
    options: [
      { label: 'Any',    test: () => true },
      { label: 'Intact', test: c => c.ma_stack_intact === true },
      { label: 'Broken', test: c => c.ma_stack_intact === false },
    ],
  },
  rs_trend: {
    label: 'RS Trend',
    tab: 'technical',
    options: [
      { label: 'Any',    test: () => true },
      { label: 'Rising', test: c => c.rs_trend === 'up' },
      { label: 'Flat',   test: c => c.rs_trend === 'flat' },
      { label: 'Falling',test: c => c.rs_trend === 'down' },
    ],
  },
  candle_score: {
    label: 'Candle Score',
    tab: 'technical',
    options: [
      { label: 'Any',       test: () => true },
      { label: 'High >70',  test: c => c.candle_score != null && c.candle_score > 70 },
      { label: 'Med 50–70', test: c => c.candle_score != null && c.candle_score >= 50 && c.candle_score <= 70 },
    ],
  },
  pattern: {
    label: 'Pattern',
    tab: 'technical',
    options: [
      { label: 'Any',         test: () => true },
      { label: 'Has Pattern', test: c => !!c.pattern_type },
      { label: 'Flag',        test: c => c.pattern_type === 'flag' },
      { label: 'Wedge',       test: c => c.pattern_type === 'wedge' },
      { label: 'No Pattern',  test: c => !c.pattern_type },
    ],
  },
  adr: {
    label: 'ADR %',
    tab: 'technical',
    options: [
      { label: 'Any',      test: () => true },
      { label: '>8%',      test: c => c.adr_pct != null && c.adr_pct > 8 },
      { label: '5–8%',     test: c => c.adr_pct != null && c.adr_pct >= 5 && c.adr_pct <= 8 },
      { label: '4–5%',     test: c => c.adr_pct != null && c.adr_pct >= 4 && c.adr_pct < 5 },
    ],
  },
  // Descriptive
  sector: {
    label: 'Sector',
    tab: 'descriptive',
    dynamic: true,
  },
  data_source: {
    label: 'Data Source',
    tab: 'descriptive',
    options: [
      { label: 'Any',             test: () => true },
      { label: 'Scanner (rich)',  test: c => c.source === 'scanner' || c.source === 'both' },
      { label: 'Breadth only',    test: c => c.source === 'breadth' },
    ],
  },
}

const SORT_FIELDS = [
  { key: 'ticker',           label: 'Ticker' },
  { key: 'pct_1d',           label: '1D %' },
  { key: 'vr',               label: 'Vol Ratio' },
  { key: 'candle_score',     label: 'Candle Score' },
  { key: 'rsi',              label: 'RSI' },
  { key: 'ema_distance_pct', label: 'EMA Dist %' },
  { key: 'adr_pct',          label: 'ADR %' },
  { key: 'pole_pct',         label: 'Prior Run %' },
  { key: 'alert_state',      label: 'Alert State' },
  { key: 'close',            label: 'Price' },
]

const ALERT_ORDER = { BREAKING:0, READY:1, 'WATCH+':2, WATCH:3, PATTERN:4, NO_PATTERN:5, EXTENDED:6, NO_DATA:7 }

const PRESETS = [
  { label: 'My Presets', filters: {} },
  { label: 'Stage 2 + Vol',    filters: { breadth_tag: 'Stage 2', above_50: 'Yes', vol_ratio: 'Elevated 1.5×' } },
  { label: '52W High Breakout',filters: { breadth_tag: '52-Week High', above_50: 'Yes' } },
  { label: 'HVC Momentum',     filters: { breadth_tag: 'HVC (Vol High)', pct_1d: 'Up >4%' } },
  { label: 'Scanner — Actionable', filters: { alert_state: 'Actionable', ma_stack: 'Intact', rs_trend: 'Rising' } },
  { label: 'EMA Kiss',         filters: { ema_dist: 'Kiss ≤2%', ma_stack: 'Intact' } },
  { label: 'Magna Stocks',     filters: { breadth_tag: 'Magna (+13%/34d)', above_50: 'Yes' } },
]

const TABS = [
  { key: 'technical',   label: 'Technical' },
  { key: 'descriptive', label: 'Descriptive' },
  { key: 'all',         label: 'All' },
]

// ─── Helpers ─────────────────────────────────────────────────────────────

function alertBadgeClass(state) {
  if (state === 'BREAKING')                    return styles.alertBreaking
  if (state === 'READY')                       return styles.alertReady
  if (state === 'WATCH' || state === 'WATCH+') return styles.alertWatch
  if (state === 'PATTERN')                     return styles.alertPattern
  return null
}

function setupClass(t) {
  if (t === 'PULLBACK_MA')  return styles.badgePullback
  if (t === 'REMOUNT')      return styles.badgeRemount
  if (t === 'GAPPER_NEWS')  return styles.badgeGapper
  return null
}
function setupShort(t) {
  if (t === 'PULLBACK_MA')  return 'PULL'
  if (t === 'REMOUNT')      return 'RMT'
  if (t === 'GAPPER_NEWS')  return 'GAP'
  return t
}

const fmt1    = v => v != null ? v.toFixed(1) : '—'
const fmtPct  = (v, plus) => v != null ? (plus && v > 0 ? '+' : '') + v.toFixed(1) + '%' : '—'
const fmtP    = v => v != null ? '$' + v.toFixed(2) : '—'

// ─── Main component ───────────────────────────────────────────────────────

export default function CustomScan({ allCandidates }) {
  // ── Data fetching ──
  const { data: universeData } = useSWR('/api/scanner/universe', fetcher, {
    refreshInterval: 4 * 3600 * 1000,  // 4h — breadth updates daily
  })

  // ── Merge scanner candidates into breadth universe ──
  const mergedUniverse = useMemo(() => {
    const byTicker = {}

    // 1. Seed with breadth universe stocks
    for (const s of (universeData?.stocks ?? [])) {
      byTicker[s.ticker] = { ...s, source: 'breadth' }
    }

    // 2. Merge / overlay scanner candidates (richer data)
    for (const c of (allCandidates ?? [])) {
      const t = c.ticker
      if (!t) continue
      if (byTicker[t]) {
        // Already in breadth — enrich with scanner fields
        byTicker[t] = {
          ...byTicker[t],
          ...c,
          ticker: t,
          name:   byTicker[t].name || c.company || '',
          tags:   byTicker[t].tags || [],
          source: 'both',
        }
      } else {
        // Scanner-only stock (not in breadth universe)
        byTicker[t] = {
          ticker: t,
          name:   c.company || '',
          close:  null,
          vr:     null,
          a50:    null,
          pct_1d: c.change_pct ?? c.gap_pct ?? null,
          tags:   [],
          source: 'scanner',
          ...c,
        }
      }
    }

    return Object.values(byTicker)
  }, [universeData, allCandidates])

  // ── Filter state ──
  const [activeTab, setActiveTab]        = useState('technical')
  const [activeFilters, setActiveFilters] = useState({})
  const [sortKey, setSortKey]            = useState('pct_1d')
  const [sortDir, setSortDir]            = useState('desc')
  const [tickerSearch, setTickerSearch]  = useState('')
  const [showFilters, setShowFilters]    = useState(true)
  const [preset, setPreset]             = useState('My Presets')

  // ── Chart state ──
  const [selectedSym, setSelectedSym]   = useState(null)
  const [selectedName, setSelectedName] = useState('')
  const [chartPeriod, setChartPeriod]   = useState('D')

  // Dynamic sector options
  const sectorOptions = useMemo(() => {
    const sectors = new Set(mergedUniverse.map(c => c.sector).filter(Boolean))
    return [
      { label: 'Any', test: () => true },
      ...[...sectors].sort().map(s => ({ label: s, test: c => c.sector === s })),
    ]
  }, [mergedUniverse])

  const resolvedFilters = useMemo(() => ({
    ...FILTERS,
    sector: { ...FILTERS.sector, options: sectorOptions },
  }), [sectorOptions])

  // ── Presets ──
  const applyPreset = useCallback(label => {
    const p = PRESETS.find(x => x.label === label)
    if (p) { setActiveFilters(p.filters); setPreset(label) }
  }, [])

  const setFilter = useCallback((key, label) => {
    setActiveFilters(prev => ({ ...prev, [key]: label === 'Any' ? undefined : label }))
    setPreset('My Presets')
  }, [])

  const resetFilters = useCallback(() => {
    setActiveFilters({})
    setTickerSearch('')
    setPreset('My Presets')
  }, [])

  // ── Finviz preload ──
  // ── Filter + sort ──
  const results = useMemo(() => {
    let rows = [...mergedUniverse]

    if (tickerSearch.trim()) {
      const q = tickerSearch.trim().toUpperCase()
      rows = rows.filter(c =>
        c.ticker?.toUpperCase().includes(q) ||
        c.name?.toUpperCase().includes(q) ||
        c.company?.toUpperCase().includes(q)
      )
    }

    Object.entries(activeFilters).forEach(([key, selectedLabel]) => {
      if (!selectedLabel) return
      const fDef = resolvedFilters[key]
      if (!fDef) return
      const opt = fDef.options?.find(o => o.label === selectedLabel)
      if (opt) rows = rows.filter(opt.test)
    })

    rows.sort((a, b) => {
      let av = a[sortKey], bv = b[sortKey]
      if (sortKey === 'ticker')      { av = a.ticker || ''; bv = b.ticker || '' }
      if (sortKey === 'alert_state') { av = ALERT_ORDER[a.alert_state] ?? 99; bv = ALERT_ORDER[b.alert_state] ?? 99 }
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      return sortDir === 'asc' ? av - bv : bv - av
    })

    return rows
  }, [mergedUniverse, activeFilters, tickerSearch, sortKey, sortDir, resolvedFilters])

  // Keyboard navigation
  useEffect(() => {
    function onKey(e) {
      if (!selectedSym) return
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      const idx = results.findIndex(r => r.ticker === selectedSym)
      if (idx === -1) return
      const next = e.key === 'ArrowDown' ? results[idx + 1] : results[idx - 1]
      if (next) { setSelectedSym(next.ticker); setSelectedName(next.name || '') }
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedSym, results])

  // Sort toggle helper
  const toggleSort = key => {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortKey(key); setSortDir('desc') }
  }
  const sortArrow = key => sortKey === key ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''

  const visibleKeys = useMemo(() => {
    if (activeTab === 'all') return Object.keys(resolvedFilters)
    return Object.entries(resolvedFilters).filter(([, f]) => f.tab === activeTab).map(([k]) => k)
  }, [activeTab, resolvedFilters])

  const activeFilterCount = Object.values(activeFilters).filter(Boolean).length
  const universeDate      = universeData?.date
  const universeCount     = universeData?.universe_count ?? 0

  // ── Render ──
  return (
    <div className={styles.wrap}>

      {/* ── Control bar ── */}
      <div className={styles.controlBar}>
        <div className={styles.controlLeft}>
          <select className={styles.presetSelect} value={preset} onChange={e => applyPreset(e.target.value)}>
            {PRESETS.map(p => <option key={p.label}>{p.label}</option>)}
          </select>
          <span className={styles.controlLabel}>Order by</span>
          <select className={styles.select} value={sortKey} onChange={e => setSortKey(e.target.value)}>
            {SORT_FIELDS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
          <select className={styles.selectSmall} value={sortDir} onChange={e => setSortDir(e.target.value)}>
            <option value="desc">Desc</option>
            <option value="asc">Asc</option>
          </select>
          <span className={styles.controlLabel}>Tickers</span>
          <input
            className={styles.tickerInput}
            placeholder="NVDA, AAPL…"
            value={tickerSearch}
            onChange={e => setTickerSearch(e.target.value)}
          />
        </div>
        <div className={styles.controlRight}>
          {universeDate && (
            <span className={styles.universeInfo}>
              {results.length} / {mergedUniverse.length} · universe {universeCount.toLocaleString()} · {universeDate}
            </span>
          )}
          <button
            className={`${styles.filterToggle} ${showFilters ? styles.filterToggleActive : ''}`}
            onClick={() => setShowFilters(v => !v)}
          >
            Filters {activeFilterCount > 0 ? `▲ ${activeFilterCount}` : showFilters ? '▲' : '▼'}
          </button>
        </div>
      </div>

      {/* ── Filter panel ── */}
      {showFilters && (
        <div className={styles.filterPanel}>
          <div className={styles.filterTabRow}>
            <button className={styles.resetBtn} onClick={resetFilters}>Reset Filters</button>
            {TABS.map(t => {
              const count = Object.entries(activeFilters).filter(([k, v]) =>
                v && resolvedFilters[k]?.tab === t.key
              ).length
              return (
                <button
                  key={t.key}
                  className={`${styles.filterTab} ${activeTab === t.key ? styles.filterTabActive : ''}`}
                  onClick={() => setActiveTab(t.key)}
                >
                  {t.label}
                  {count > 0 && <span className={styles.filterTabBadge}>{count}</span>}
                </button>
              )
            })}
            <span className={styles.resultCount}>{results.length} result{results.length !== 1 ? 's' : ''}</span>
          </div>
          <div className={styles.filterGrid}>
            {visibleKeys.map(key => {
              const fDef = resolvedFilters[key]
              const current = activeFilters[key] || 'Any'
              return (
                <div key={key} className={styles.filterCell}>
                  <label className={styles.filterLabel}>{fDef.label}</label>
                  <select
                    className={`${styles.filterSelect} ${activeFilters[key] ? styles.filterSelectActive : ''}`}
                    value={current}
                    onChange={e => setFilter(key, e.target.value)}
                  >
                    {fDef.options?.map(o => <option key={o.label}>{o.label}</option>)}
                  </select>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Body: results table + chart panel ── */}
      <div className={styles.body}>

        {/* Left — results table */}
        <div className={styles.leftPanel}>
          {results.length === 0 ? (
            <div className={styles.empty}>No stocks match the current filters</div>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.sortable} onClick={() => toggleSort('ticker')}>Ticker{sortArrow('ticker')}</th>
                  <th>Signal</th>
                  <th>Tags</th>
                  <th className={styles.sortable} onClick={() => toggleSort('pct_1d')}>1D%{sortArrow('pct_1d')}</th>
                  <th className={styles.sortable} onClick={() => toggleSort('close')}>Price{sortArrow('close')}</th>
                  <th className={styles.sortable} onClick={() => toggleSort('vr')}>VolR{sortArrow('vr')}</th>
                  <th>A50</th>
                  <th className={styles.sortable} onClick={() => toggleSort('candle_score')}>Score{sortArrow('candle_score')}</th>
                  <th className={styles.sortable} onClick={() => toggleSort('rsi')}>RSI{sortArrow('rsi')}</th>
                  <th className={styles.sortable} onClick={() => toggleSort('ema_distance_pct')}>EMA%{sortArrow('ema_distance_pct')}</th>
                  <th>RS</th>
                  <th>Pat</th>
                </tr>
              </thead>
              <tbody>
                {results.map(c => {
                  const isSelected = c.ticker === selectedSym
                  const alertCls   = alertBadgeClass(c.alert_state)
                  const setupCls   = setupClass(c.setup_type)
                  return (
                    <tr
                      key={c.ticker}
                      className={`${styles.row} ${isSelected ? styles.rowSelected : ''}`}
                      onClick={() => { setSelectedSym(c.ticker); setSelectedName(c.name || c.company || '') }}
                    >
                      <td>
                        <div className={styles.tickerCell}>
                          <span className={styles.sym}>{c.ticker}</span>
                          {c.name || c.company
                            ? <span className={styles.co}>{(c.name || c.company || '').slice(0, 22)}</span>
                            : null}
                        </div>
                      </td>
                      <td>
                        <div className={styles.signalCell}>
                          {alertCls && (
                            <span className={`${styles.alertBadge} ${alertCls}`}>{c.alert_state}</span>
                          )}
                          {setupCls && (
                            <span className={`${styles.setupBadge} ${setupCls}`}>{setupShort(c.setup_type)}</span>
                          )}
                        </div>
                      </td>
                      <td>
                        <div className={styles.tagRow}>
                          {(c.tags || []).slice(0, 3).map(tag => {
                            const meta = TAG_META[tag]
                            return meta ? (
                              <span key={tag} className={`${styles.tag} ${styles['tag_' + meta.color]}`}>
                                {meta.label}
                              </span>
                            ) : null
                          })}
                        </div>
                      </td>
                      <td className={
                        c.pct_1d > 2 ? styles.numGreen :
                        c.pct_1d < -2 ? styles.numRed : styles.numNeutral
                      }>{fmtPct(c.pct_1d, true)}</td>
                      <td className={styles.numNeutral}>{fmtP(c.close)}</td>
                      <td className={c.vr > 1.5 ? styles.numGreen : styles.numNeutral}>
                        {c.vr != null ? c.vr.toFixed(1) + '×' : '—'}
                      </td>
                      <td className={c.a50 === true ? styles.numGreen : c.a50 === false ? styles.numMuted : ''}>
                        {c.a50 === true ? '✓' : c.a50 === false ? '✗' : '—'}
                      </td>
                      <td className={styles.scoreCell}>
                        {c.candle_score != null
                          ? <span className={c.candle_score > 70 ? styles.numGreen : c.candle_score > 50 ? styles.numAmber : styles.numMuted}>
                              {Math.round(c.candle_score)}
                            </span>
                          : <span className={styles.numMuted}>—</span>}
                      </td>
                      <td className={
                        c.rsi > 70 ? styles.numRed :
                        c.rsi < 30 ? styles.numGreen : styles.numNeutral
                      }>{fmt1(c.rsi)}</td>
                      <td className={
                        c.ema_distance_pct > 8 ? styles.numRed :
                        c.ema_distance_pct <= 2 ? styles.numGreen : styles.numNeutral
                      }>{fmtPct(c.ema_distance_pct, true)}</td>
                      <td>
                        {c.rs_trend === 'up'   && <span className={styles.rsUp}>RS↑</span>}
                        {c.rs_trend === 'down' && <span className={styles.rsDown}>RS↓</span>}
                        {c.rs_trend === 'flat' && <span className={styles.numMuted}>—</span>}
                        {!c.rs_trend           && <span className={styles.numMuted}>—</span>}
                      </td>
                      <td className={styles.numNeutral}>
                        {c.pattern_type
                          ? <span className={styles.patType}>{c.pattern_type}</span>
                          : <span className={styles.numMuted}>—</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Right — chart panel */}
        <div className={styles.rightPanel}>
          {selectedSym ? (
            <>
              <div className={styles.chartHeader}>
                <span className={styles.chartSym}>{selectedSym}</span>
                <span className={styles.chartName}>{selectedName}</span>
                <div className={styles.chartPeriodTabs}>
                  {[['5', '5min'], ['30', '30min'], ['60', '1hr'], ['D', 'Daily'], ['W', 'Weekly']].map(([p, label]) => (
                    <button
                      key={p}
                      className={`${styles.chartPeriodBtn} ${chartPeriod === p ? styles.chartPeriodBtnActive : ''}`}
                      onClick={() => setChartPeriod(p)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <StockChart sym={selectedSym} tf={chartPeriod} />
            </>
          ) : (
            <div className={styles.chartEmpty}>
              <span className={styles.chartEmptyIcon}>↖</span>
              <span>Select a ticker to view chart</span>
              <span className={styles.chartEmptyHint}>↑ ↓ arrow keys to navigate</span>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}

import { useState, useMemo } from 'react'
import TickerPopup from '../components/TickerPopup'
import styles from './CustomScan.module.css'

// ─── Filter definitions ────────────────────────────────────────────────────

const FILTERS = {
  // Technical
  setup_type: {
    label: 'Setup Type',
    tab: 'technical',
    options: [
      { label: 'Any', test: () => true },
      { label: 'Pullback MA', test: c => c.setup_type === 'PULLBACK_MA' },
      { label: 'Remount',     test: c => c.setup_type === 'REMOUNT' },
      { label: 'Gapper',      test: c => c.setup_type === 'GAPPER_NEWS' },
    ],
  },
  alert_state: {
    label: 'Alert State',
    tab: 'technical',
    options: [
      { label: 'Any',      test: () => true },
      { label: 'Breaking', test: c => c.alert_state === 'BREAKING' },
      { label: 'Ready',    test: c => c.alert_state === 'READY' },
      { label: 'Watch',    test: c => c.alert_state === 'WATCH' || c.alert_state === 'WATCH+' },
      { label: 'Pattern',  test: c => c.alert_state === 'PATTERN' },
      { label: 'Extended', test: c => c.alert_state === 'EXTENDED' },
      { label: 'Actionable', test: c => ['BREAKING','READY','WATCH','WATCH+','PATTERN'].includes(c.alert_state) },
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
      { label: 'Low 30–40',     test: c => c.rsi != null && c.rsi >= 30 && c.rsi < 40 },
      { label: 'Oversold <30',  test: c => c.rsi != null && c.rsi < 30 },
    ],
  },
  volatility: {
    label: 'Volatility (ADR%)',
    tab: 'technical',
    options: [
      { label: 'Any',       test: () => true },
      { label: 'High >8%',  test: c => c.adr_pct != null && c.adr_pct > 8 },
      { label: 'Med 5–8%',  test: c => c.adr_pct != null && c.adr_pct >= 5 && c.adr_pct <= 8 },
      { label: 'Low 4–5%',  test: c => c.adr_pct != null && c.adr_pct >= 4 && c.adr_pct < 5 },
    ],
  },
  ema_dist: {
    label: 'EMA20 Distance',
    tab: 'technical',
    options: [
      { label: 'Any',         test: () => true },
      { label: 'Kiss ≤2%',    test: c => c.ema_distance_pct != null && c.ema_distance_pct <= 2 },
      { label: 'Near 2–5%',   test: c => c.ema_distance_pct != null && c.ema_distance_pct > 2 && c.ema_distance_pct <= 5 },
      { label: 'Moderate 5–8%', test: c => c.ema_distance_pct != null && c.ema_distance_pct > 5 && c.ema_distance_pct <= 8 },
      { label: 'Extended >8%', test: c => c.ema_distance_pct != null && c.ema_distance_pct > 8 },
    ],
  },
  sma20_dist: {
    label: '20-Day SMA',
    tab: 'technical',
    options: [
      { label: 'Any',              test: () => true },
      { label: 'Above SMA20',      test: c => c.sma20_dist_pct != null && c.sma20_dist_pct > 0 },
      { label: 'Below SMA20',      test: c => c.sma20_dist_pct != null && c.sma20_dist_pct < 0 },
      { label: 'Within 5%',        test: c => c.sma20_dist_pct != null && Math.abs(c.sma20_dist_pct) <= 5 },
      { label: 'More than 10% above', test: c => c.sma20_dist_pct != null && c.sma20_dist_pct > 10 },
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
      { label: 'Any',     test: () => true },
      { label: 'Rising',  test: c => c.rs_trend === 'up' },
      { label: 'Flat',    test: c => c.rs_trend === 'flat' },
      { label: 'Falling', test: c => c.rs_trend === 'down' },
    ],
  },
  pattern: {
    label: 'Pattern',
    tab: 'technical',
    options: [
      { label: 'Any',        test: () => true },
      { label: 'Has Pattern',test: c => !!c.pattern_type },
      { label: 'Flag',       test: c => c.pattern_type === 'flag' },
      { label: 'Wedge',      test: c => c.pattern_type === 'wedge' },
      { label: 'Pennant',    test: c => c.pattern_type === 'pennant' },
      { label: 'No Pattern', test: c => !c.pattern_type },
    ],
  },
  candle_score: {
    label: 'Candle Score',
    tab: 'technical',
    options: [
      { label: 'Any',       test: () => true },
      { label: 'High >70',  test: c => c.candle_score != null && c.candle_score > 70 },
      { label: 'Med 50–70', test: c => c.candle_score != null && c.candle_score >= 50 && c.candle_score <= 70 },
      { label: 'Low <50',   test: c => c.candle_score != null && c.candle_score < 50 },
    ],
  },
  volume: {
    label: 'Volume Flow',
    tab: 'technical',
    options: [
      { label: 'Any',           test: () => true },
      { label: 'Accumulation',  test: c => c.vol_acc_ratio != null && c.vol_acc_ratio > 1.1 },
      { label: 'Distribution',  test: c => c.vol_acc_ratio != null && c.vol_acc_ratio < 0.85 },
      { label: 'Neutral',       test: c => c.vol_acc_ratio != null && c.vol_acc_ratio >= 0.85 && c.vol_acc_ratio <= 1.1 },
    ],
  },
  prior_run: {
    label: 'Prior Run %',
    tab: 'technical',
    options: [
      { label: 'Any',            test: () => true },
      { label: 'Strong >40%',    test: c => c.pole_pct != null && c.pole_pct > 40 },
      { label: 'Moderate 20–40%',test: c => c.pole_pct != null && c.pole_pct >= 20 && c.pole_pct <= 40 },
      { label: 'Weak <20%',      test: c => c.pole_pct != null && c.pole_pct < 20 },
    ],
  },
  tightness: {
    label: 'Bar Tightness',
    tab: 'technical',
    options: [
      { label: 'Any',              test: () => true },
      { label: 'Tight <2.5%',      test: c => c.close_cv_pct != null && c.close_cv_pct < 2.5 },
      { label: 'Moderate 2.5–4%',  test: c => c.close_cv_pct != null && c.close_cv_pct >= 2.5 && c.close_cv_pct < 4 },
      { label: 'Loose >4%',        test: c => c.close_cv_pct != null && c.close_cv_pct >= 4 },
    ],
  },
  earnings: {
    label: 'Earnings Risk',
    tab: 'technical',
    options: [
      { label: 'Any',                test: () => true },
      { label: 'Upcoming (<10 days)',test: c => !!c.earnings_date },
      { label: 'No Near Earnings',   test: c => !c.earnings_date },
    ],
  },
  // Descriptive
  sector: {
    label: 'Sector',
    tab: 'descriptive',
    dynamic: true, // options built from data
  },
}

const SORT_FIELDS = [
  { key: 'ticker',           label: 'Ticker' },
  { key: 'candle_score',     label: 'Candle Score' },
  { key: 'rsi',              label: 'RSI' },
  { key: 'adr_pct',          label: 'ADR %' },
  { key: 'ema_distance_pct', label: 'EMA Dist %' },
  { key: 'pole_pct',         label: 'Prior Run %' },
  { key: 'close_cv_pct',     label: 'Tightness' },
  { key: 'vol_acc_ratio',    label: 'Vol Acc' },
  { key: 'alert_state',      label: 'Alert State' },
]

const ALERT_ORDER = { BREAKING:0, READY:1, 'WATCH+':2, WATCH:3, PATTERN:4, NO_PATTERN:5, EXTENDED:6, NO_DATA:7 }

const PRESETS = [
  { label: 'My Presets', filters: {} },
  {
    label: 'High Quality Setup',
    filters: { alert_state: 'Actionable', candle_score: 'High >70', ma_stack: 'Intact', rs_trend: 'Rising' },
  },
  {
    label: 'EMA Kiss',
    filters: { ema_dist: 'Kiss ≤2%', ma_stack: 'Intact', volume: 'Accumulation' },
  },
  {
    label: 'Pattern + RS',
    filters: { pattern: 'Has Pattern', rs_trend: 'Rising', alert_state: 'Actionable' },
  },
  {
    label: 'Tight Pullback',
    filters: { setup_type: 'Pullback MA', tightness: 'Tight <2.5%', ma_stack: 'Intact' },
  },
  {
    label: 'No Earnings Risk',
    filters: { earnings: 'No Near Earnings', alert_state: 'Actionable' },
  },
]

const TABS = [
  { key: 'technical',   label: 'Technical' },
  { key: 'descriptive', label: 'Descriptive' },
  { key: 'all',         label: 'All' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────

function alertBadgeClass(state) {
  if (state === 'BREAKING')              return styles.alertBreaking
  if (state === 'READY')                 return styles.alertReady
  if (state === 'WATCH' || state === 'WATCH+') return styles.alertWatch
  if (state === 'PATTERN')               return styles.alertPattern
  if (state === 'EXTENDED')              return styles.alertExtended
  return styles.alertNone
}

function setupLabel(t) {
  if (t === 'PULLBACK_MA')  return 'PULLBACK'
  if (t === 'REMOUNT')      return 'REMOUNT'
  if (t === 'GAPPER_NEWS')  return 'GAPPER'
  return t
}

function setupClass(t) {
  if (t === 'PULLBACK_MA')  return styles.badgePullback
  if (t === 'REMOUNT')      return styles.badgeRemount
  if (t === 'GAPPER_NEWS')  return styles.badgeGapper
  return styles.badgeDefault
}

function fmt1(v) { return v != null ? v.toFixed(1) : '—' }
function fmt0(v) { return v != null ? Math.round(v) : '—' }
function fmtPct(v, plus = false) {
  if (v == null) return '—'
  const s = v.toFixed(1) + '%'
  return plus && v > 0 ? '+' + s : s
}

// ─── Main component ────────────────────────────────────────────────────────

export default function CustomScan({ allCandidates }) {
  const [activeTab, setActiveTab]       = useState('technical')
  const [activeFilters, setActiveFilters] = useState({})
  const [sortKey, setSortKey]           = useState('candle_score')
  const [sortDir, setSortDir]           = useState('desc')
  const [tickerSearch, setTickerSearch]  = useState('')
  const [showFilters, setShowFilters]   = useState(true)
  const [preset, setPreset]             = useState('My Presets')

  // Build dynamic sector options from data
  const sectorOptions = useMemo(() => {
    const sectors = new Set(allCandidates.map(c => c.sector).filter(Boolean))
    return [
      { label: 'Any', test: () => true },
      ...[...sectors].sort().map(s => ({ label: s, test: c => c.sector === s })),
    ]
  }, [allCandidates])

  // Merge dynamic options into FILTERS
  const resolvedFilters = useMemo(() => ({
    ...FILTERS,
    sector: { ...FILTERS.sector, options: sectorOptions },
  }), [sectorOptions])

  // Apply preset
  function applyPreset(label) {
    const p = PRESETS.find(x => x.label === label)
    if (p) { setActiveFilters(p.filters); setPreset(label) }
  }

  // Toggle a filter value
  function setFilter(key, label) {
    setActiveFilters(prev => ({ ...prev, [key]: label === 'Any' ? undefined : label }))
    setPreset('My Presets')
  }

  function resetFilters() {
    setActiveFilters({})
    setTickerSearch('')
    setPreset('My Presets')
  }

  // Filter + sort
  const results = useMemo(() => {
    let rows = [...allCandidates]

    // Ticker search
    if (tickerSearch.trim()) {
      const q = tickerSearch.trim().toUpperCase()
      rows = rows.filter(c => c.ticker?.toUpperCase().includes(q) || c.company?.toUpperCase().includes(q))
    }

    // Apply each active filter
    Object.entries(activeFilters).forEach(([key, selectedLabel]) => {
      if (!selectedLabel) return
      const fDef = resolvedFilters[key]
      if (!fDef) return
      const opt = fDef.options?.find(o => o.label === selectedLabel)
      if (opt) rows = rows.filter(opt.test)
    })

    // Sort
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
  }, [allCandidates, activeFilters, tickerSearch, sortKey, sortDir, resolvedFilters])

  // Which filter keys to show in active tab
  const visibleKeys = useMemo(() => {
    if (activeTab === 'all') return Object.keys(resolvedFilters)
    return Object.entries(resolvedFilters)
      .filter(([, f]) => f.tab === activeTab)
      .map(([k]) => k)
  }, [activeTab, resolvedFilters])

  const activeFilterCount = Object.values(activeFilters).filter(Boolean).length

  // ── Render ──

  return (
    <div className={styles.wrap}>

      {/* ── Top control bar ── */}
      <div className={styles.controlBar}>
        <div className={styles.controlLeft}>
          <select
            className={styles.presetSelect}
            value={preset}
            onChange={e => applyPreset(e.target.value)}
          >
            {PRESETS.map(p => (
              <option key={p.label}>{p.label}</option>
            ))}
          </select>

          <span className={styles.controlLabel}>Order by</span>
          <select
            className={styles.select}
            value={sortKey}
            onChange={e => setSortKey(e.target.value)}
          >
            {SORT_FIELDS.map(f => (
              <option key={f.key} value={f.key}>{f.label}</option>
            ))}
          </select>
          <select
            className={styles.selectSmall}
            value={sortDir}
            onChange={e => setSortDir(e.target.value)}
          >
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

        <button
          className={`${styles.filterToggle} ${showFilters ? styles.filterToggleActive : ''}`}
          onClick={() => setShowFilters(v => !v)}
        >
          Filters {activeFilterCount > 0 ? `▲ ${activeFilterCount}` : showFilters ? '▲' : '▼'}
        </button>
      </div>

      {/* ── Filter panel ── */}
      {showFilters && (
        <div className={styles.filterPanel}>
          {/* Tab row */}
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

          {/* Filter grid */}
          <div className={styles.filterGrid}>
            {visibleKeys.map(key => {
              const fDef = resolvedFilters[key]
              const current = activeFilters[key] || 'Any'
              const isDirty = !!activeFilters[key]
              return (
                <div key={key} className={styles.filterCell}>
                  <label className={styles.filterLabel}>{fDef.label}</label>
                  <select
                    className={`${styles.filterSelect} ${isDirty ? styles.filterSelectActive : ''}`}
                    value={current}
                    onChange={e => setFilter(key, e.target.value)}
                  >
                    {fDef.options?.map(o => (
                      <option key={o.label}>{o.label}</option>
                    ))}
                  </select>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Results table ── */}
      <div className={styles.tableWrap}>
        {results.length === 0 ? (
          <div className={styles.empty}>No candidates match the current filters</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Alert</th>
                <th>Setup</th>
                <th>Ticker</th>
                <th>Company / Sector</th>
                <th onClick={() => { setSortKey('candle_score'); setSortDir(d => d==='desc'?'asc':'desc') }}
                    className={styles.sortable}>
                  Score {sortKey==='candle_score' ? (sortDir==='desc'?'↓':'↑') : ''}
                </th>
                <th onClick={() => { setSortKey('rsi'); setSortDir(d => d==='desc'?'asc':'desc') }}
                    className={styles.sortable}>
                  RSI {sortKey==='rsi' ? (sortDir==='desc'?'↓':'↑') : ''}
                </th>
                <th onClick={() => { setSortKey('ema_distance_pct'); setSortDir(d => d==='desc'?'asc':'desc') }}
                    className={styles.sortable}>
                  EMA Dist {sortKey==='ema_distance_pct' ? (sortDir==='desc'?'↓':'↑') : ''}
                </th>
                <th onClick={() => { setSortKey('adr_pct'); setSortDir(d => d==='desc'?'asc':'desc') }}
                    className={styles.sortable}>
                  ADR% {sortKey==='adr_pct' ? (sortDir==='desc'?'↓':'↑') : ''}
                </th>
                <th onClick={() => { setSortKey('pole_pct'); setSortDir(d => d==='desc'?'asc':'desc') }}
                    className={styles.sortable}>
                  Prior Run {sortKey==='pole_pct' ? (sortDir==='desc'?'↓':'↑') : ''}
                </th>
                <th>Pattern</th>
                <th>RS</th>
                <th>Vol</th>
                <th onClick={() => { setSortKey('close_cv_pct'); setSortDir(d => d==='desc'?'asc':'desc') }}
                    className={styles.sortable}>
                  Tight {sortKey==='close_cv_pct' ? (sortDir==='desc'?'↓':'↑') : ''}
                </th>
              </tr>
            </thead>
            <tbody>
              {results.map(c => {
                const isExtended = c.alert_state === 'EXTENDED'
                return (
                  <tr key={c.ticker} className={`${styles.row} ${isExtended ? styles.rowDim : ''}`}>
                    <td>
                      <span className={`${styles.alertBadge} ${alertBadgeClass(c.alert_state)}`}>
                        {c.alert_state || '—'}
                      </span>
                    </td>
                    <td>
                      <span className={`${styles.setupBadge} ${setupClass(c.setup_type)}`}>
                        {setupLabel(c.setup_type)}
                      </span>
                    </td>
                    <td>
                      <TickerPopup sym={c.ticker}>
                        <span className={styles.sym}>{c.ticker}</span>
                      </TickerPopup>
                    </td>
                    <td>
                      <div className={styles.companyCell}>
                        {c.company && <span className={styles.company}>{c.company}</span>}
                        {c.sector  && <span className={styles.sectorTag}>{c.sector}</span>}
                      </div>
                    </td>
                    <td className={styles.scoreCell}>
                      <span className={
                        c.candle_score > 70 ? styles.numGreen :
                        c.candle_score > 50 ? styles.numAmber : styles.numMuted
                      }>
                        {fmt0(c.candle_score)}
                      </span>
                    </td>
                    <td className={
                      c.rsi > 70 ? styles.numRed :
                      c.rsi < 30 ? styles.numGreen : styles.numNeutral
                    }>{fmt1(c.rsi)}</td>
                    <td className={c.ema_distance_pct > 8 ? styles.numRed : c.ema_distance_pct <= 2 ? styles.numGreen : styles.numNeutral}>
                      {fmtPct(c.ema_distance_pct, true)}
                    </td>
                    <td className={styles.numNeutral}>{fmtPct(c.adr_pct)}</td>
                    <td className={c.pole_pct > 20 ? styles.numGreen : styles.numNeutral}>
                      {fmtPct(c.pole_pct, true)}
                    </td>
                    <td className={styles.patternCell}>
                      {c.pattern_type
                        ? <><span className={styles.patternType}>{c.pattern_type}</span>
                            {c.apex_days_remaining != null && c.apex_days_remaining <= 10 &&
                              <span className={styles.apexTag}>{c.apex_days_remaining}d</span>}
                          </>
                        : <span className={styles.numMuted}>—</span>
                      }
                    </td>
                    <td>
                      <span className={
                        c.rs_trend === 'up' ? styles.rsUp :
                        c.rs_trend === 'down' ? styles.rsDown : styles.rsMuted
                      }>
                        {c.rs_trend === 'up' ? 'RS↑' : c.rs_trend === 'down' ? 'RS↓' : 'flat'}
                      </span>
                    </td>
                    <td>
                      {c.vol_acc_ratio != null && (
                        <span className={
                          c.vol_acc_ratio > 1.1 ? styles.volAcc :
                          c.vol_acc_ratio < 0.85 ? styles.volDist : styles.numMuted
                        }>
                          {c.vol_acc_ratio > 1.1 ? 'ACC' : c.vol_acc_ratio < 0.85 ? 'DIST' : 'NEUT'}
                        </span>
                      )}
                    </td>
                    <td className={c.close_cv_pct < 2.5 ? styles.numGreen : c.close_cv_pct > 4 ? styles.numMuted : styles.numNeutral}>
                      {fmtPct(c.close_cv_pct)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

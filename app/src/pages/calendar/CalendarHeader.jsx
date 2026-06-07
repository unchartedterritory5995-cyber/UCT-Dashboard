// app/src/pages/calendar/CalendarHeader.jsx
import { useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useIsPhone } from '../../hooks/useBreakpoint'
import { FiltersSheet } from '../../components/mobile'
import styles from './Calendar.module.css'

const AUDIENCE = [
  ['mine', '★ My Stocks'], ['watchlist', 'Watchlist'], ['positions', 'Positions'],
  ['uct20', 'UCT20'], ['all', 'All ($300M+)'],
]
const SORTS = [['mine', 'My stocks first'], ['time', 'Time'], ['mcap', 'Market cap'], ['move', 'Expected move']]
const SOURCES = [['watchlist','Watchlists'],['flagged','Flagged'],['positions','Positions'],['uct20','UCT20']]

// B3: event-type chips — Earnings + Macro are always on (baseline); IPOs + Dividends are toggleable
// eventTypes is a Set of enabled types: always includes 'earnings' and 'macro'.
export const DEFAULT_EVENT_TYPES = new Set(['earnings', 'macro'])
const EVENT_TYPE_CHIPS = [
  ['earnings', 'Earnings'],
  ['macro',    'Macro'],
  ['ipos',     'IPOs'],
  ['dividends','Dividends'],
]

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]

// A3: FiltersPopover — compact numeric filter controls
// Persisted via the main setFilters → calendar_filters pref
function FiltersPopover({ filters, setFilters, onClose }) {
  const set = (k, v) => setFilters({ ...filters, [k]: v === '' ? null : Number(v) })
  return (
    <div className={styles.filterPop}>
      <div className={styles.filterPopHd}>Filters</div>
      <div className={styles.filterRow}>
        <label className={styles.filterLbl}>Min avg vol</label>
        <input
          className={styles.filterInput}
          type="number"
          min={0}
          placeholder="e.g. 500000"
          value={filters.minAvgVol ?? ''}
          onChange={e => set('minAvgVol', e.target.value)}
        />
      </div>
      <div className={styles.filterRow}>
        <label className={styles.filterLbl}>Price min ($)</label>
        <input
          className={styles.filterInput}
          type="number"
          min={0}
          placeholder="e.g. 5"
          value={filters.priceMin ?? ''}
          onChange={e => set('priceMin', e.target.value)}
        />
      </div>
      <div className={styles.filterRow}>
        <label className={styles.filterLbl}>Price max ($)</label>
        <input
          className={styles.filterInput}
          type="number"
          min={0}
          placeholder="e.g. 500"
          value={filters.priceMax ?? ''}
          onChange={e => set('priceMax', e.target.value)}
        />
      </div>
      <button className={styles.filterClear} onClick={() => {
        setFilters({ ...filters, minAvgVol: null, priceMin: null, priceMax: null })
        onClose()
      }}>Clear</button>
    </div>
  )
}

// E2: ExportMenu — Download .ics / Copy webcal URL
function ExportMenu({ onClose }) {
  const [copying, setCopying] = useState(false)
  const [copied, setCopied] = useState(false)
  const [downloading, setDownloading] = useState(false)

  const download = useCallback(async () => {
    setDownloading(true)
    try {
      // Fetch token then trigger download
      const tr = await fetch('/api/calendar/export-token', { credentials: 'include' })
      const { token } = tr.ok ? await tr.json() : {}
      const url = token
        ? `/api/calendar/export.ics?scope=mine&token=${token}`
        : '/api/calendar/export.ics?scope=all'
      const a = document.createElement('a')
      a.href = url
      a.download = 'uct-earnings.ics'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    } catch (_) { /* silent */ }
    setDownloading(false)
    onClose()
  }, [onClose])

  const copyWebcal = useCallback(async () => {
    setCopying(true)
    try {
      const tr = await fetch('/api/calendar/export-token', { credentials: 'include' })
      const { subscribe_url } = tr.ok ? await tr.json() : {}
      if (subscribe_url) {
        await navigator.clipboard.writeText(subscribe_url)
        setCopied(true)
        setTimeout(() => { setCopied(false); onClose() }, 1500)
      }
    } catch (_) { /* silent */ }
    setCopying(false)
  }, [onClose])

  return (
    <div className={styles.exportPop}>
      <button className={styles.exportItem} onClick={download} disabled={downloading}>
        {downloading ? 'Downloading…' : '⬇ Download .ics'}
      </button>
      <button className={styles.exportItem} onClick={copyWebcal} disabled={copying}>
        {copied ? '✓ Copied!' : copying ? 'Copying…' : '🔗 Copy webcal URL'}
      </button>
    </div>
  )
}

export default function CalendarHeader({
  view, setView, weekLabel, filters, setFilters,
  mySources, setMySources,
  // Month nav (only shown when view === 'month')
  monthCursor, setMonthCursor,
  // B3: event type filter (Set of enabled types)
  eventTypes, setEventTypes,
}) {
  const isPhone = useIsPhone()
  const [gear, setGear] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  const set = (k, v) => setFilters({ ...filters, [k]: v })
  const toggleSource = s => setMySources(
    mySources.includes(s) ? mySources.filter(x => x !== s) : [...mySources, s])

  // B3: toggle an event type; 'earnings' and 'macro' cannot be disabled
  const toggleEventType = type => {
    if (!setEventTypes) return
    const locked = type === 'earnings' || type === 'macro'
    if (locked) return  // always on
    const next = new Set(eventTypes || DEFAULT_EVENT_TYPES)
    if (next.has(type)) next.delete(type)
    else next.add(type)
    setEventTypes(next)
  }

  // A3: check if any metric filters are active
  const hasMetricFilters = !!(filters.minAvgVol || filters.priceMin || filters.priceMax)

  // ── Shared filter controls (desktop inline row + phone FiltersSheet) ──
  const setNum = (k, v) => setFilters({ ...filters, [k]: v === '' ? null : Number(v) })

  const eventTypeChips = view !== 'month' && EVENT_TYPE_CHIPS.map(([type, lbl]) => {
    const active = (eventTypes || DEFAULT_EVENT_TYPES).has(type)
    const locked = type === 'earnings' || type === 'macro'
    return (
      <span
        key={type}
        className={`${styles.chip} ${active ? styles.chipOn : ''}`}
        style={locked ? { opacity: 1, cursor: 'default' } : {}}
        onClick={() => toggleEventType(type)}
        title={locked ? 'Always on' : active ? `Hide ${lbl}` : `Show ${lbl}`}
      >
        {lbl}
      </span>
    )
  })

  const audienceChips = AUDIENCE.map(([k, lbl]) => (
    <span key={k} className={`${styles.chip} ${filters.audience === k ? styles.chipOn : ''}`}
          onClick={() => set('audience', k)}>{lbl}</span>
  ))

  const capSelect = (
    <select className={styles.sel} value={filters.minMcap}
            onChange={e => set('minMcap', Number(e.target.value))}>
      <option value={0}>Any cap</option><option value={2}>$2B+</option>
      <option value={10}>$10B+</option><option value={50}>$50B+</option>
    </select>
  )
  const sortSelect = (
    <select className={styles.sel} value={filters.sort} onChange={e => set('sort', e.target.value)}>
      {SORTS.map(([k, lbl]) => <option key={k} value={k}>Sort: {lbl}</option>)}
    </select>
  )
  const metricInputs = (
    <>
      <div className={styles.filterRow}>
        <label className={styles.filterLbl}>Min avg vol</label>
        <input className={styles.filterInput} type="number" min={0} inputMode="numeric"
               placeholder="e.g. 500000" value={filters.minAvgVol ?? ''}
               onChange={e => setNum('minAvgVol', e.target.value)} />
      </div>
      <div className={styles.filterRow}>
        <label className={styles.filterLbl}>Price min ($)</label>
        <input className={styles.filterInput} type="number" min={0} inputMode="decimal"
               placeholder="e.g. 5" value={filters.priceMin ?? ''}
               onChange={e => setNum('priceMin', e.target.value)} />
      </div>
      <div className={styles.filterRow}>
        <label className={styles.filterLbl}>Price max ($)</label>
        <input className={styles.filterInput} type="number" min={0} inputMode="decimal"
               placeholder="e.g. 500" value={filters.priceMax ?? ''}
               onChange={e => setNum('priceMax', e.target.value)} />
      </div>
    </>
  )

  const sourcesCheckboxes = SOURCES.map(([k, lbl]) => (
    <label key={k} className={styles.gearRow}>
      <input type="checkbox" checked={mySources.includes(k)} onChange={() => toggleSource(k)} /> {lbl}
    </label>
  ))

  const mobileActiveCount =
    (filters.minAvgVol ? 1 : 0) + (filters.priceMin ? 1 : 0) +
    (filters.priceMax ? 1 : 0) + (filters.minMcap > 0 ? 1 : 0)
  const clearMobileFilters = () =>
    setFilters({ ...filters, minAvgVol: null, priceMin: null, priceMax: null, minMcap: 0 })

  function prevMonth() {
    if (!setMonthCursor) return
    setMonthCursor(c => {
      const m = c.month === 1 ? 12 : c.month - 1
      const y = c.month === 1 ? c.year - 1 : c.year
      return { year: y, month: m }
    })
  }
  function nextMonth() {
    if (!setMonthCursor) return
    setMonthCursor(c => {
      const m = c.month === 12 ? 1 : c.month + 1
      const y = c.month === 12 ? c.year + 1 : c.year
      return { year: y, month: m }
    })
  }

  return (
    <div className={styles.header}>
      <div className={styles.hrow}>
        <span className={styles.ttl}>📅 Calendar</span>
        <span className={styles.view}>
          {['Feed','Week','Month'].map(v => (
            <span key={v} className={view === v.toLowerCase() ? styles.viewOn : ''}
                  onClick={() => setView(v.toLowerCase())}>{v}</span>
          ))}
        </span>
        {/* Show week label in feed/week; show month nav in month view */}
        {view !== 'month' ? (
          <span className={styles.wk}>{weekLabel}</span>
        ) : (
          <span className={styles.monthNavHeader}>
            <button className={styles.monthNavBtn} onClick={prevMonth} aria-label="Previous month">‹</button>
            <span className={styles.monthNavLbl}>
              {monthCursor ? `${MONTH_NAMES[monthCursor.month - 1]} ${monthCursor.year}` : ''}
            </span>
            <button className={styles.monthNavBtn} onClick={nextMonth} aria-label="Next month">›</button>
          </span>
        )}
        <Link to="/calendar/mystocks" className={styles.hubLink} title="My Stocks Hub">
          ⭐ Hub
        </Link>
        {/* E2: Export menu */}
        <span className={styles.exportWrap}>
          <button
            className={styles.exportBtn}
            onClick={() => { setExportOpen(o => !o); setGear(false); setFilterOpen(false) }}
            aria-label="Export calendar"
          >
            Export ▾
          </button>
          {exportOpen && <ExportMenu onClose={() => setExportOpen(false)} />}
        </span>
        {/* My Stocks sources — desktop popover; phone moves these into the Filters sheet */}
        {!isPhone && (
          <span className={styles.gearWrap}>
            <button className={styles.mystk} onClick={() => { setGear(g => !g); setExportOpen(false) }}>★ My Stocks ⚙</button>
            {gear && (
              <div className={styles.gearPop}>
                <div className={styles.scolLbl}>Count toward &ldquo;My Stocks&rdquo;:</div>
                {sourcesCheckboxes}
              </div>
            )}
          </span>
        )}
        {/* Phone: single entry point to all secondary filters */}
        {isPhone && (
          <button
            className={`${styles.filterBtn} ${mobileActiveCount > 0 ? styles.filterBtnActive : ''}`}
            onClick={() => setMobileFiltersOpen(true)}
            aria-label="Open calendar filters"
          >
            ⚙ Filters{mobileActiveCount > 0 ? ` · ${mobileActiveCount}` : ''}
          </button>
        )}
      </div>

      {/* ── Filter row (desktop / tablet) ── */}
      {!isPhone && (
        <div className={styles.fb}>
          {view !== 'month' && (<>{eventTypeChips}<span className={styles.sep} /></>)}
          {audienceChips}
          <span className={styles.sep} />
          {capSelect}
          {sortSelect}
          {/* A3: Filters popover button */}
          <span className={styles.filterWrap}>
            <button
              className={`${styles.filterBtn} ${hasMetricFilters ? styles.filterBtnActive : ''}`}
              onClick={() => { setFilterOpen(o => !o); setGear(false) }}
              aria-label="Open metric filters"
            >
              Filters {hasMetricFilters ? '●' : '▾'}
            </button>
            {filterOpen && (
              <FiltersPopover
                filters={filters}
                setFilters={setFilters}
                onClose={() => setFilterOpen(false)}
              />
            )}
          </span>
        </div>
      )}

      {/* ── Filter sheet (phone) ── */}
      {isPhone && (
        <FiltersSheet
          open={mobileFiltersOpen}
          onClose={() => setMobileFiltersOpen(false)}
          onClear={mobileActiveCount > 0 ? clearMobileFilters : undefined}
          onApply={() => setMobileFiltersOpen(false)}
          title="Calendar Filters"
          activeCount={mobileActiveCount}
          applyLabel="Done"
        >
          {view !== 'month' && (
            <div className={styles.sheetSec}>
              <div className={styles.sheetLbl}>Show</div>
              <div className={styles.sheetChips}>{eventTypeChips}</div>
            </div>
          )}
          <div className={styles.sheetSec}>
            <div className={styles.sheetLbl}>Audience</div>
            <div className={styles.sheetChips}>{audienceChips}</div>
          </div>
          <div className={styles.sheetSec}>
            <div className={styles.sheetLbl}>Cap &amp; sort</div>
            <div className={styles.sheetRow}>{capSelect}{sortSelect}</div>
          </div>
          <div className={styles.sheetSec}>
            <div className={styles.sheetLbl}>Metric filters</div>
            {metricInputs}
          </div>
          <div className={styles.sheetSec}>
            <div className={styles.sheetLbl}>Count toward &ldquo;My Stocks&rdquo;</div>
            {sourcesCheckboxes}
          </div>
        </FiltersSheet>
      )}
    </div>
  )
}

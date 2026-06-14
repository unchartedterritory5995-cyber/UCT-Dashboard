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

export default function CalendarHeader({
  view, setView, weekLabel, filters, setFilters,
  mySources, setMySources,
  monthCursor, setMonthCursor,
  eventTypes, setEventTypes,
}) {
  const isPhone = useIsPhone()
  const [panelOpen, setPanelOpen] = useState(false)            // desktop ⚙ Filters popover
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  // Export state
  const [copying, setCopying] = useState(false)
  const [copied, setCopied] = useState(false)
  const [downloading, setDownloading] = useState(false)

  const set = (k, v) => setFilters({ ...filters, [k]: v })
  const setNum = (k, v) => setFilters({ ...filters, [k]: v === '' ? null : Number(v) })
  const toggleSource = s => setMySources(
    mySources.includes(s) ? mySources.filter(x => x !== s) : [...mySources, s])

  const toggleEventType = type => {
    if (!setEventTypes) return
    const locked = type === 'earnings' || type === 'macro'
    if (locked) return
    const next = new Set(eventTypes || DEFAULT_EVENT_TYPES)
    if (next.has(type)) next.delete(type)
    else next.add(type)
    setEventTypes(next)
  }

  // ── Export handlers (folded in from the old ExportMenu) ──
  const download = useCallback(async () => {
    setDownloading(true)
    try {
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
    setPanelOpen(false)
  }, [])

  const copyWebcal = useCallback(async () => {
    setCopying(true)
    try {
      const tr = await fetch('/api/calendar/export-token', { credentials: 'include' })
      const { subscribe_url } = tr.ok ? await tr.json() : {}
      if (subscribe_url) {
        await navigator.clipboard.writeText(subscribe_url)
        setCopied(true)
        setTimeout(() => { setCopied(false); setPanelOpen(false) }, 1500)
      }
    } catch (_) { /* silent */ }
    setCopying(false)
  }, [])

  // ── Active-filter count for the ⚙ Filters badge ──
  const evTypes = eventTypes || DEFAULT_EVENT_TYPES
  const eventTypesChanged = evTypes.has('ipos') || evTypes.has('dividends')
  const activeCount =
    (filters.minAvgVol ? 1 : 0) + (filters.priceMin ? 1 : 0) +
    (filters.priceMax ? 1 : 0) + (filters.minMcap > 0 ? 1 : 0) +
    (eventTypesChanged ? 1 : 0) + (filters.sort !== 'mine' ? 1 : 0)

  const clearAllFilters = () => setFilters({
    ...filters, minAvgVol: null, priceMin: null, priceMax: null, minMcap: 0,
  })

  // ── Shared control fragments (used by desktop panel + phone sheet) ──
  const eventTypeChips = view !== 'month' && EVENT_TYPE_CHIPS.map(([type, lbl]) => {
    const active = evTypes.has(type)
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

  const exportButtons = (
    <div className={styles.sheetRow}>
      <button className={styles.exportItem} onClick={download} disabled={downloading}>
        {downloading ? 'Downloading…' : '⬇ Download .ics'}
      </button>
      <button className={styles.exportItem} onClick={copyWebcal} disabled={copying}>
        {copied ? '✓ Copied!' : copying ? 'Copying…' : '🔗 Copy webcal URL'}
      </button>
    </div>
  )

  // ── The consolidated secondary-controls panel (desktop popover + phone sheet) ──
  const panelSections = (
    <>
      {view !== 'month' && (
        <div className={styles.sheetSec}>
          <div className={styles.sheetLbl}>Show</div>
          <div className={styles.sheetChips}>{eventTypeChips}</div>
        </div>
      )}
      <div className={styles.sheetSec}>
        <div className={styles.sheetLbl}>Cap &amp; sort</div>
        <div className={styles.sheetRow}>{capSelect}{sortSelect}</div>
      </div>
      <div className={styles.sheetSec}>
        <div className={styles.sheetLbl}>Metric filters</div>
        {metricInputs}
      </div>
      <div className={styles.sheetSec}>
        <div className={styles.sheetLbl}>Count toward My Stocks</div>
        {sourcesCheckboxes}
      </div>
      <div className={styles.sheetSec}>
        <div className={styles.sheetLbl}>Export</div>
        {exportButtons}
      </div>
    </>
  )

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

  const filterBtn = (onClick) => (
    <button
      className={`${styles.filterBtn} ${activeCount > 0 ? styles.filterBtnActive : ''}`}
      onClick={onClick}
      aria-label="Open calendar filters"
    >
      ⚙ Filters{activeCount > 0 ? ` · ${activeCount}` : ''}
    </button>
  )

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

        {/* Desktop: audience chips inline (primary filter) + ⚙ Filters popover */}
        {!isPhone && <span className={styles.sep} />}
        {!isPhone && audienceChips}
        {!isPhone && (
          <span className={styles.filterWrap} style={{ marginLeft: 'auto' }}>
            {filterBtn(() => setPanelOpen(o => !o))}
            {panelOpen && <div className={styles.gearPop}>{panelSections}</div>}
          </span>
        )}

        {/* Phone: single ⚙ Filters button opens the sheet */}
        {isPhone && (
          <span style={{ marginLeft: 'auto' }}>
            {filterBtn(() => setMobileFiltersOpen(true))}
          </span>
        )}

        <Link to="/calendar/mystocks" className={styles.hubLink} title="My Stocks Hub">
          ⭐ Hub
        </Link>
      </div>

      {/* Phone filter sheet — audience moves inside since it isn't inline on phone */}
      {isPhone && (
        <FiltersSheet
          open={mobileFiltersOpen}
          onClose={() => setMobileFiltersOpen(false)}
          onClear={activeCount > 0 ? clearAllFilters : undefined}
          onApply={() => setMobileFiltersOpen(false)}
          title="Calendar Filters"
          activeCount={activeCount}
          applyLabel="Done"
        >
          <div className={styles.sheetSec}>
            <div className={styles.sheetLbl}>Audience</div>
            <div className={styles.sheetChips}>{audienceChips}</div>
          </div>
          {panelSections}
        </FiltersSheet>
      )}
    </div>
  )
}

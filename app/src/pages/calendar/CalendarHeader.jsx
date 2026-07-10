// app/src/pages/calendar/CalendarHeader.jsx
import { useState, useCallback, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useIsPhone } from '../../hooks/useBreakpoint'
import { FiltersSheet } from '../../components/mobile'
import CompanyLogo from '../../components/CompanyLogo'
import UIcon from '../../components/ui/UIcon'
import useSectorRead from '../../hooks/useSectorRead'
import styles from './Calendar.module.css'

const AUDIENCE = [
  ['mine', 'My Stocks', 'star-fill'], ['watchlist', 'Watchlist'], ['positions', 'Positions'],
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

// ── Ticker search (header) ────────────────────────────────────────────────────
// Typeahead over /api/ticker-search (prewarmed ticker_meta names). Selecting a
// name resolves its report date: found in the loaded week → jump+pulse; outside
// → ONE /api/calendar/next-report fetch (never per keystroke) → jump to that
// week. '/' focuses the input from anywhere on the page.

function CalendarSearch({ onJump, onDidJump }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const [notice, setNotice] = useState(null)     // "no scheduled report" line
  const [resolving, setResolving] = useState(null)
  const [hi, setHi] = useState(0)
  const inputRef = useRef(null)
  const boxRef = useRef(null)
  const debounceRef = useRef(null)
  // Monotonic request id — a slow response for an OLD query must never
  // overwrite results for the current one (or reopen a closed dropdown).
  const reqIdRef = useRef(0)

  // '/' focuses search from anywhere (ignored while typing elsewhere)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== '/') return
      const t = e.target
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      e.preventDefault()
      inputRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Click-outside closes the dropdown
  useEffect(() => {
    const onDoc = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) {
        setOpen(false); setNotice(null)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  // Clear any pending debounce on unmount
  useEffect(() => () => clearTimeout(debounceRef.current), [])

  const runSearch = useCallback((text) => {
    clearTimeout(debounceRef.current)
    const myId = ++reqIdRef.current
    if (!text.trim()) { setResults([]); setOpen(false); return }
    debounceRef.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/ticker-search?q=${encodeURIComponent(text.trim())}&limit=8`)
        const j = r.ok ? await r.json() : { results: [] }
        if (reqIdRef.current !== myId) return   // stale response — drop it
        setResults(j.results || [])
        setHi(0)
        setOpen(true)
      } catch {
        if (reqIdRef.current === myId) setResults([])
      }
    }, 150)
  }, [])

  const select = useCallback(async (ticker) => {
    const sym = (ticker || '').toUpperCase()
    if (!sym) return
    setNotice(null)
    setResolving(sym)
    try {
      // ONE resolve call on selection (6h-cached server-side)
      const r = await fetch(`/api/calendar/next-report?sym=${encodeURIComponent(sym)}`,
                            { credentials: 'include' })
      const j = r.ok ? await r.json() : null
      if (j?.date) {
        onJump(sym, j.date)
        setOpen(false)
        setQ('')
        setResults([])
        onDidJump?.()
      } else {
        setNotice(`${sym} — no scheduled report found`)
      }
    } catch {
      setNotice(`${sym} — lookup failed, try again`)
    } finally {
      setResolving(null)
    }
  }, [onJump])

  const onKeyDown = (e) => {
    if (!open || !results.length) {
      if (e.key === 'Enter' && q.trim()) select(q.trim())
      if (e.key === 'Escape') { setOpen(false); setNotice(null); e.target.blur() }
      return
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(h + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(h - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); select(results[hi]?.ticker || q.trim()) }
    else if (e.key === 'Escape') { setOpen(false); setNotice(null); e.target.blur() }
  }

  return (
    <span className={styles.searchWrap} ref={boxRef}>
      <UIcon name="search" size={13} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
      <input
        ref={inputRef}
        className={styles.searchInput}
        placeholder="When does… (press /)"
        value={q}
        aria-label="Search a ticker's report date"
        onChange={e => { setQ(e.target.value); setNotice(null); runSearch(e.target.value) }}
        onFocus={() => { if (results.length) setOpen(true) }}
        onKeyDown={onKeyDown}
      />
      {(open || notice) && (
        <div className={styles.searchPop}>
          {notice && <div className={styles.searchNotice}>{notice}</div>}
          {!notice && results.map((r, i) => (
            <div
              key={r.ticker}
              className={`${styles.searchRow} ${i === hi ? styles.searchRowHi : ''}`}
              onMouseEnter={() => setHi(i)}
              onClick={() => select(r.ticker)}
            >
              <CompanyLogo sym={r.ticker} size={16} tile />
              <span className={styles.searchRowSym}>{r.ticker}</span>
              <span className={styles.searchRowName}>
                {resolving === r.ticker ? 'Finding report date…' : (r.name || '')}
              </span>
            </div>
          ))}
          {!notice && !results.length && (
            <div className={styles.searchNotice}>No matches</div>
          )}
        </div>
      )}
    </span>
  )
}

// ── Week picker popover (± 8 weeks) ──────────────────────────────────────────

// Local-parts ISO formatter — toISOString() converts to UTC and shifts the
// date for UTC+13/+14 browsers (NZDT, Samoa), turning every Monday into a
// Sunday and breaking the arrows/picker for those users.
function localIso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// The picker anchors on the TRUE current week's Monday (ET), regardless of
// which week is being viewed — offset 0 is always "this week".
function mondayOfTodayEt() {
  const iso = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' })
    .format(new Date())
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return localIso(d)
}

function fmtPickerWeek(mondayIso) {
  const s = new Date(mondayIso + 'T12:00:00')
  const e = new Date(s); e.setDate(s.getDate() + 4)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return s.getMonth() === e.getMonth()
    ? `${M[s.getMonth()]} ${s.getDate()}–${e.getDate()}`
    : `${M[s.getMonth()]} ${s.getDate()} – ${M[e.getMonth()]} ${e.getDate()}`
}

function WeekPicker({ currentMonday, activeMonday, onPick, onClose }) {
  const weeks = []
  for (let i = -8; i <= 8; i++) {
    const d = new Date(currentMonday + 'T12:00:00')
    d.setDate(d.getDate() + i * 7)
    weeks.push({ monday: localIso(d), offset: i })
  }
  return (
    <div className={styles.wkPop}>
      {weeks.map(w => (
        <button
          key={w.monday}
          className={`${styles.wkPopItem} ${w.monday === activeMonday ? styles.wkPopItemActive : ''}`}
          onClick={() => { onPick(w.offset === 0 ? null : w.monday); onClose() }}
        >
          <span>Week of {fmtPickerWeek(w.monday)}</span>
          {w.offset === 0 && <span className={styles.wkPopThis}>this week</span>}
        </button>
      ))}
    </div>
  )
}

export default function CalendarHeader({
  view, setView, weekLabel, filters, setFilters,
  mySources, setMySources,
  monthCursor, setMonthCursor,
  eventTypes, setEventTypes,
  availableSectors = [],
  // Week Navigator (flagship 1b)
  dayTabs = [],
  isCurrentWeek = true,
  onPrevWeek, onNextWeek, onGotoToday, onGotoWeek, onDayTab, onSearchJump,
}) {
  const isPhone = useIsPhone()
  const [panelOpen, setPanelOpen] = useState(false)            // desktop ⚙ Filters popover
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const pickerRef = useRef(null)
  // Export state
  const [copying, setCopying] = useState(false)
  const [copied, setCopied] = useState(false)
  const [downloading, setDownloading] = useState(false)

  // Peer read-through — one AI line on the scoped sector's setup this week.
  // Keyed to the viewed week's Monday; null sector → hook is inert.
  const sectorReadWeek = dayTabs.length ? dayTabs[0].ds : null
  const { line: sectorReadLine, generating: sectorReadBusy } =
    useSectorRead(filters.sector || null, sectorReadWeek)

  const set = (k, v) => setFilters({ ...filters, [k]: v })
  const setNum = (k, v) => setFilters({ ...filters, [k]: v === '' ? null : Number(v) })
  const toggleSource = s => setMySources(
    mySources.includes(s) ? mySources.filter(x => x !== s) : [...mySources, s])

  // Click-outside closes the week picker
  useEffect(() => {
    if (!pickerOpen) return
    const onDoc = (e) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) setPickerOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [pickerOpen])

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

  // "Most Anticipated" shareable image — opens the branded weekly PNG in a new
  // tab for the currently-viewed week (right-click save / share the URL).
  const shareWeekImage = useCallback(() => {
    const monday = dayTabs.length ? dayTabs[0].ds : ''
    const url = monday
      ? `/api/calendar/most-anticipated.png?week=${monday}`
      : '/api/calendar/most-anticipated.png'
    window.open(url, '_blank', 'noopener')
    setPanelOpen(false)
  }, [dayTabs])

  // ── Active-filter count for the ⚙ Filters badge ──
  const evTypes = eventTypes || DEFAULT_EVENT_TYPES
  const eventTypesChanged = evTypes.has('ipos') || evTypes.has('dividends')
  const activeCount =
    (filters.minAvgVol ? 1 : 0) + (filters.priceMin ? 1 : 0) +
    (filters.priceMax ? 1 : 0) + (filters.minMcap > 0 ? 1 : 0) +
    (eventTypesChanged ? 1 : 0) + (filters.sort !== 'mine' ? 1 : 0) +
    (filters.confirmedOnly ? 1 : 0) + (filters.sector ? 1 : 0)

  const clearAllFilters = () => setFilters({
    ...filters, minAvgVol: null, priceMin: null, priceMax: null, minMcap: 0,
    confirmedOnly: false, sector: null,
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

  const audienceChips = AUDIENCE.map(([k, lbl, icon]) => (
    <span key={k} className={`${styles.chip} ${filters.audience === k ? styles.chipOn : ''}`}
          onClick={() => set('audience', k)}
          title={
            k === 'all'   ? 'Every US company with a market cap of $300M or more' :
            k === 'uct20' ? "UCT's 20 leadership names" :
            k === 'mine'  ? 'Your watchlists + flagged + broker positions + UCT20 (pick sources in Filters)' :
            undefined
          }>
      {icon && <UIcon name={icon} size={12} style={{ verticalAlign: '-1px', marginRight: 4 }} />}{lbl}
    </span>
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
      <label className={styles.gearRow} title="Hide reporters whose date is only a projection">
        <input type="checkbox" checked={!!filters.confirmedOnly}
               onChange={e => set('confirmedOnly', e.target.checked)} /> Confirmed dates only
      </label>
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
        {downloading ? 'Downloading…' : <><UIcon name="download" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />Download .ics</>}
      </button>
      <button className={styles.exportItem} onClick={copyWebcal} disabled={copying}>
        {copied ? <><UIcon name="check" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />Copied!</> : copying ? 'Copying…' : <><UIcon name="link" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />Copy webcal URL</>}
      </button>
      {view !== 'month' && (
        <button className={styles.exportItem} onClick={shareWeekImage}
                title="Open a shareable image of this week's biggest reporters">
          <UIcon name="flame" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />Most Anticipated image
        </button>
      )}
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
      <UIcon name="gear" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />Filters{activeCount > 0 ? ` · ${activeCount}` : ''}
    </button>
  )

  // Short weekday label for a day tab: "THU 9" from "Thu Jul 9"
  const tabLabel = (t) => {
    const parts = (t.label || '').split(' ')
    const wd = (parts[0] || '').toUpperCase()
    const dayNum = parts[2] || parts[1] || ''
    return `${wd} ${dayNum}`.trim()
  }

  const currentMonday = dayTabs.length ? dayTabs[0].ds : null

  // Sector scoping row — chips for the sectors actually present this week.
  // Only worth showing when there's more than one sector to pick between.
  const showSectorRow = view !== 'month' && availableSectors.length > 1
  const activeSector = filters.sector || null

  return (
    <div className={styles.header}>
      <div className={styles.hrow}>
        <span className={styles.ttl}><UIcon name="calendar" size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />Calendar</span>
        <span className={styles.view}>
          {['Feed','Week','Month'].map(v => (
            <span key={v} className={view === v.toLowerCase() ? styles.viewOn : ''}
                  onClick={() => setView(v.toLowerCase())}>{v}</span>
          ))}
        </span>
        {view === 'month' && (
          <span className={styles.monthNavHeader}>
            <button className={styles.monthNavBtn} onClick={prevMonth} aria-label="Previous month">‹</button>
            <span className={styles.monthNavLbl}>
              {monthCursor ? `${MONTH_NAMES[monthCursor.month - 1]} ${monthCursor.year}` : ''}
            </span>
            <button className={styles.monthNavBtn} onClick={nextMonth} aria-label="Next month">›</button>
          </span>
        )}

        {/* Desktop: audience chips inline (primary filter) + search + ⚙ Filters popover */}
        {!isPhone && <span className={styles.sep} />}
        {!isPhone && audienceChips}
        {!isPhone && (
          <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            {onSearchJump && <CalendarSearch onJump={onSearchJump} />}
            <span className={styles.filterWrap}>
              {filterBtn(() => setPanelOpen(o => !o))}
              {panelOpen && <div className={styles.gearPop}>{panelSections}</div>}
            </span>
          </span>
        )}

        {/* Phone: single ⚙ Filters button opens the sheet */}
        {isPhone && (
          <span style={{ marginLeft: 'auto' }}>
            {filterBtn(() => setMobileFiltersOpen(true))}
          </span>
        )}

        <Link to="/calendar/mystocks" className={styles.hubLink} title="My Stocks hub — earnings, news, calls, filings">
          <UIcon name="star-fill" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />Hub
        </Link>
      </div>

      {/* ── Week Navigator: the page's time spine (Feed + Week views) ── */}
      {view !== 'month' && (
        <div className={styles.navRow}>
          <button className={styles.monthNavBtn} onClick={onPrevWeek} aria-label="Previous week">‹</button>
          <span className={styles.dayTabs}>
            {dayTabs.map(t => (
              <button
                key={t.ds}
                className={`${styles.dayTab} ${t.is_today ? styles.dayTabToday : ''}`}
                onClick={() => onDayTab?.(t.ds)}
                aria-label={`Go to ${t.label}`}
              >
                <span className={styles.dayTabLbl}>{tabLabel(t)}</span>
                <span className={styles.dayTabCount}>{t.count}</span>
                {t.mineN > 0 && (
                  <span className={styles.dayTabMine}>
                    <UIcon name="star-fill" size={9} style={{ verticalAlign: '-1px' }} />{t.mineN}
                  </span>
                )}
              </button>
            ))}
          </span>
          <button className={styles.monthNavBtn} onClick={onNextWeek} aria-label="Next week">›</button>

          {!isCurrentWeek && (
            <button className={styles.todayPill} onClick={onGotoToday}>Today</button>
          )}

          <span className={styles.wkBtnWrap} ref={pickerRef}>
            <button className={styles.wkBtn} onClick={() => setPickerOpen(o => !o)}
                    aria-label="Pick a week">
              {weekLabel || 'Pick a week'} <span aria-hidden="true">▾</span>
            </button>
            {pickerOpen && (
              <WeekPicker
                currentMonday={mondayOfTodayEt()}
                activeMonday={currentMonday}
                onPick={(monday) => onGotoWeek?.(monday)}
                onClose={() => setPickerOpen(false)}
              />
            )}
          </span>
        </div>
      )}

      {/* ── Sector scoping: one-tap narrow to a GICS sector present this week ── */}
      {showSectorRow && (
        <div className={styles.sectorRow} role="group" aria-label="Filter by sector">
          <button
            className={`${styles.sectorChip} ${!activeSector ? styles.sectorChipOn : ''}`}
            onClick={() => set('sector', null)}
          >
            All sectors
          </button>
          {availableSectors.map(([sector, count]) => (
            <button
              key={sector}
              className={`${styles.sectorChip} ${activeSector === sector ? styles.sectorChipOn : ''}`}
              onClick={() => set('sector', activeSector === sector ? null : sector)}
              title={`${count} reporter${count === 1 ? '' : 's'} in ${sector}`}
            >
              {sector}<span className={styles.sectorChipCount}>{count}</span>
            </button>
          ))}
        </div>
      )}

      {/* Peer read-through — the AI one-liner for the scoped sector this week */}
      {showSectorRow && activeSector && (sectorReadLine || sectorReadBusy) && (
        <div className={styles.sectorRead}>
          <UIcon name="sparkle" size={12} style={{ verticalAlign: '-1px', marginRight: 6, flex: '0 0 auto' }} />
          {sectorReadLine
            ? <span>{sectorReadLine}</span>
            : <span className={styles.sectorReadBusy}>Reading the {activeSector} tape…</span>}
        </div>
      )}

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
          {/* Search leads the sheet — "when does NVDA report" is the #1 entry
              intent and must exist on phones too, not only in the desktop bar. */}
          {onSearchJump && (
            <div className={styles.sheetSec}>
              <div className={styles.sheetLbl}>Find a report</div>
              <CalendarSearch
                onJump={onSearchJump}
                onDidJump={() => setMobileFiltersOpen(false)}
              />
            </div>
          )}
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

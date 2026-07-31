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
  ['uct20', 'UCT20'], ['all', 'All'],
]
const SORTS = [['mine', 'My stocks first'], ['time', 'Time'], ['mcap', 'Market cap'], ['move', 'Expected move']]
const SOURCES = [['watchlist','Watchlists'],['flagged','Flagged'],['positions','Positions'],['uct20','UCT20']]

// Event-type chips — Earnings is the calendar (always on). Macro (Fed/econ),
// IPOs, Dividends are all opt-in — off by default so an earnings calendar shows
// earnings, not Fed-speaker noise.
export const DEFAULT_EVENT_TYPES = new Set(['earnings'])
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

// ── The ONE search (merged 2026-07-14) ───────────────────────────────────────
// Typing LIVE-FILTERS the loaded week (parent-owned quickQ → filterLogic `q`)
// while the typeahead over /api/ticker-search offers the jump. Enter or
// clicking a result resolves the ticker's report date (ONE
// /api/calendar/next-report fetch — never per keystroke) and jumps to that
// week, clearing the filter (the pulse highlight takes over). Escape clears
// both. '/' focuses the input from anywhere on the page.
// quickQ/setQuickQ are optional — absent, it falls back to internal state and
// behaves as the old jump-only search.

function CalendarSearch({ onJump, onDidJump, quickQ, setQuickQ }) {
  const [localQ, setLocalQ] = useState('')
  const controlled = typeof setQuickQ === 'function'
  const q = controlled ? quickQ : localQ
  const setQ = controlled ? setQuickQ : setLocalQ
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

  // Escape must also drop the RESULTS — clearing only the text left a stale
  // dropdown that reopened on the next focus for a search that no longer exists.
  const clearAll = (e) => {
    setQ(''); setResults([]); setOpen(false); setNotice(null); e?.target?.blur?.()
  }

  const onKeyDown = (e) => {
    if (!open || !results.length) {
      if (e.key === 'Enter' && q.trim()) select(q.trim())
      if (e.key === 'Escape') clearAll(e)
      return
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(h + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(h - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); select(results[hi]?.ticker || q.trim()) }
    else if (e.key === 'Escape') clearAll(e)
  }

  return (
    <span className={styles.searchWrap} ref={boxRef}>
      <UIcon name="search" size={13} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
      <input
        ref={inputRef}
        className={styles.searchInput}
        placeholder="Filter or find a ticker…  ( / )"
        value={q}
        aria-label="Filter this week or jump to a ticker's report date"
        onChange={e => { setQ(e.target.value); setNotice(null); runSearch(e.target.value) }}
        onFocus={() => { if (results.length) setOpen(true) }}
        onKeyDown={onKeyDown}
      />
      {q && (
        <button className={styles.quickClearX} onClick={() => { setQ(''); setResults([]); setOpen(false); setNotice(null) }}
                aria-label="Clear search">
          <UIcon name="x" size={11} />
        </button>
      )}
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

// Quick-bar cap tiers (WSE-style): our universe floor is $300M, so $1B+ is
// the first useful cut. Pills write the SAME persisted minMcap the ⚙ panel
// used to own — one source of truth, now always visible.
const CAP_TIERS = [[0, 'All'], [1, '$1B+'], [10, '$10B+'], [100, '$100B+']]

// ONE self-describing view segment (2026-07-14 UX pass): Board = the logo
// mosaic, Table = the day-by-day data table, Month = the grid. Replaces the
// muddy Feed/Week split + the Tiles|Rows density toggle.
const VIEWS = [
  ['wire', 'Wire', 'Live earnings results as they hit the tape'],
  ['board', 'Board', 'Five-day logo board — the week at a glance'],
  ['table', 'Table', 'Day-by-day data table — EPS & revenue estimates, expected move, beat history'],
  ['month', 'Month', 'Full month grid'],
]

export default function CalendarHeader({
  view, setView, weekLabel, filters, setFilters,
  mySources, setMySources,
  monthCursor, setMonthCursor,
  eventTypes, setEventTypes,
  availableSectors = [],
  // Quick filters (WSE competitor pass, 2026-07-13/14)
  quickQ = '', setQuickQ,
  weekCounts = null,
  onClearQuick,
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

  // Peer read-through — OPT-IN (no auto-spend, no auto-chrome). A small toggle
  // under the sector chips reveals the AI line only when the user asks for it.
  const [sectorReadOpen, setSectorReadOpen] = useState(false)
  useEffect(() => { setSectorReadOpen(false) }, [filters.sector])
  const sectorReadWeek = dayTabs.length ? dayTabs[0].ds : null
  const { line: sectorReadLine, generating: sectorReadBusy } =
    useSectorRead(sectorReadOpen ? (filters.sector || null) : null, sectorReadWeek)

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
    const locked = type === 'earnings'
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
  // minMcap is NOT counted here anymore: the cap pills sit in the always-
  // visible quick bar, so an active tier is already self-evident.
  const evTypes = eventTypes || DEFAULT_EVENT_TYPES
  const eventTypesChanged = evTypes.has('ipos') || evTypes.has('dividends') || evTypes.has('macro')
  const activeCount =
    (filters.minAvgVol ? 1 : 0) + (filters.priceMin ? 1 : 0) +
    (filters.priceMax ? 1 : 0) +
    (eventTypesChanged ? 1 : 0) + (filters.sort !== 'mine' ? 1 : 0) +
    (filters.confirmedOnly ? 1 : 0) + (filters.sector ? 1 : 0)

  const clearAllFilters = () => setFilters({
    ...filters, minAvgVol: null, priceMin: null, priceMax: null, minMcap: 0,
    confirmedOnly: false, sector: null,
  })

  // ── Shared control fragments (used by desktop panel + phone sheet) ──
  const eventTypeChips = view !== 'month' && EVENT_TYPE_CHIPS.map(([type, lbl]) => {
    const active = evTypes.has(type)
    const locked = type === 'earnings'
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
        <div className={styles.sheetLbl}>Sort</div>
        <div className={styles.sheetRow}>{sortSelect}</div>
      </div>
      {view !== 'month' && availableSectors.length > 1 && (
        <div className={styles.sheetSec}>
          <div className={styles.sheetLbl}>Sector</div>
          <select className={styles.sel} value={filters.sector || ''}
                  onChange={e => set('sector', e.target.value || null)}>
            <option value="">All sectors</option>
            {availableSectors.map(([s, c]) => (
              <option key={s} value={s}>{s} ({c})</option>
            ))}
          </select>
        </div>
      )}
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

  const activeSector = filters.sector || null

  // ── Quick-filter fragments (live in the navigator row on desktop, in a
  //    compact strip on phone — no third chrome band). ──
  const capPillsEl = (
    <span className={styles.capPills} role="group" aria-label="Market cap filter">
      {CAP_TIERS.map(([v, lbl]) => (
        <button
          key={v}
          className={`${styles.capPill} ${filters.minMcap === v ? styles.capPillOn : ''}`}
          aria-pressed={filters.minMcap === v}
          onClick={() => set('minMcap', v)}
        >
          {lbl}
        </button>
      ))}
    </span>
  )

  const summaryEl = weekCounts && weekCounts.raw > 0 && (
    <span className={styles.quickSummary}>
      {weekCounts.total} reporting
      {weekCounts.mine > 0 && (
        <> · <UIcon name="star-fill" size={10} style={{ verticalAlign: '-1px' }} /> {weekCounts.mine} mine</>
      )}
      {weekCounts.hidden > 0 && (
        <>
          {' '}· {weekCounts.hidden} hidden
          {onClearQuick && (quickQ.trim() || filters.minMcap > 0) && (
            <button className={styles.quickClearAll} onClick={onClearQuick}>Clear</button>
          )}
        </>
      )}
    </span>
  )

  const searchEl = onSearchJump && (
    <CalendarSearch
      onJump={onSearchJump}
      quickQ={quickQ}
      setQuickQ={setQuickQ}
    />
  )

  return (
    <div className={styles.header}>
      <div className={styles.hrow}>
        <span className={styles.ttl}><UIcon name="calendar" size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />Calendar</span>
        <span className={styles.view}>
          {VIEWS.map(([key, lbl, tip]) => (
            <span key={key} className={view === key ? styles.viewOn : ''}
                  title={tip}
                  onClick={() => setView(key)}>{lbl}</span>
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

        {/* Desktop: audience chips inline (primary filter) + ⚙ Filters popover.
            The search lives in the navigator row now — one band fewer. Month
            has no navigator, so the search mounts HERE for that view ("when
            does NVDA report" must work everywhere; '/' rides the component). */}
        {!isPhone && <span className={styles.sep} />}
        {!isPhone && audienceChips}
        {!isPhone && view === 'month' && (
          <span style={{ marginLeft: 'auto' }}>{searchEl}</span>
        )}
        {!isPhone && (
          <span className={styles.filterWrap}
                style={view === 'month' ? {} : { marginLeft: 'auto' }}>
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

        <Link to="/calendar/mystocks" className={styles.hubLink} title="My Stocks hub — earnings, news, calls, filings">
          <UIcon name="star-fill" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />Hub
        </Link>
      </div>

      {/* ── Week Navigator: the page's time spine (Board + Table views).
          Desktop also hosts the quick filters in its empty middle — cap
          pills + the one search + summary — so the page stays two bands. ── */}
      {view !== 'month' && (
        <div className={styles.navRow}>
          <button className={styles.monthNavBtn} onClick={onPrevWeek}
                  aria-label="Previous week" title="Previous week (←)">‹</button>
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
          <button className={styles.monthNavBtn} onClick={onNextWeek}
                  aria-label="Next week" title="Next week (→)">›</button>

          {!isCurrentWeek && (
            <button className={styles.todayPill} onClick={onGotoToday}
                    title="Back to today (T)">Today</button>
          )}

          {!isPhone && <span className={styles.sep} />}
          {!isPhone && capPillsEl}
          {!isPhone && searchEl}
          {!isPhone && summaryEl}

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

      {/* Phone: one compact quick strip — pills scroll, search grows, and a
          "hidden" pill appears only when filters bite. Month keeps just the
          search (its grid doesn't consume the week filters), so "when does X
          report" works on every view. Clear renders ONLY when the QUICK
          filters (search/cap) are active — audience/sector hiding is honest
          information but Clear can't undo it (it would be a dead button). */}
      {isPhone && (
        <div className={styles.quickBar}>
          {view !== 'month' && capPillsEl}
          {searchEl}
          {view !== 'month' && weekCounts && weekCounts.hidden > 0 && (
            <span className={styles.quickSummaryPhone}>
              {weekCounts.total} shown · {weekCounts.hidden} hidden
              {onClearQuick && (quickQ.trim() || filters.minMcap > 0) && (
                <button className={styles.quickClearAll} onClick={onClearQuick}>Clear</button>
              )}
            </span>
          )}
        </div>
      )}

      {/* Sector scoping lives in Filters now (the always-on 8-chip band read as
          clutter). When a sector IS active, a single removable pill appears —
          zero chrome by default, a clear "you're filtered" cue when you opt in. */}
      {activeSector && view !== 'month' && (
        <div className={styles.sectorActive}>
          <span className={styles.sectorActivePill}>
            {activeSector}
            <button className={styles.sectorClear} onClick={() => set('sector', null)}
                    aria-label={`Clear ${activeSector} filter`}>
              <UIcon name="x" size={11} />
            </button>
          </span>
          {!sectorReadOpen ? (
            <button className={styles.sectorReadToggle} onClick={() => setSectorReadOpen(true)}>
              <UIcon name="sparkle" size={11} style={{ verticalAlign: '-1px', marginRight: 5 }} />
              Read the {activeSector} tape
            </button>
          ) : (
            <span className={styles.sectorReadInline}>
              <UIcon name="sparkle" size={12} style={{ verticalAlign: '-1px', marginRight: 6, flex: '0 0 auto' }} />
              {sectorReadLine
                ? <span>{sectorReadLine}</span>
                : <span className={styles.sectorReadBusy}>Reading the {activeSector} tape…</span>}
            </span>
          )}
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
          {/* Search no longer lives in the sheet — the merged filter/jump
              input sits directly in the phone quick strip, always visible. */}
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

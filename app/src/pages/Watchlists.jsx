// app/src/pages/Watchlists.jsx
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import useSWR from 'swr'
import UIcon from '../components/ui/UIcon'
import CompanyLogo from '../components/CompanyLogo'
import { useFlagged } from '../hooks/useFlagged'
import { useAuth } from '../context/AuthContext'
import useRealtimePrices from '../hooks/useRealtimePrices'
import useWatchlistPerformance from '../hooks/useWatchlistPerformance'
import useWatchlistMeta from '../hooks/useWatchlistMeta'
import useWatchlistThemes from '../hooks/useWatchlistThemes'
import useTickerTags from '../hooks/useTickerTags'
import useWatchlistAlerts from '../hooks/useWatchlistAlerts'
import useTagColors from '../hooks/useTagColors'
import StockChart from '../components/StockChart'
import SymbolSearch from '../components/chart/SymbolSearch'
import { prefetchBars, prefetchBarsToIDB, prefetchAllTimeframes, prefetchBarOnIntent, prefetchListAllTimeframes } from '../utils/prefetchBars'
import { useIsTouch } from '../hooks/useBreakpoint'
import Sheet from '../components/mobile/Sheet'
import styles from './Watchlists.module.css'
import { useChartsSym } from './charts/ChartsSymContext'
import usePreferences, { parsePref } from '../hooks/usePreferences'
import WatchlistSettingsPanel from './watchlist/WatchlistSettingsPanel'
import { WATCHLIST_SETTINGS_KEY, WATCHLIST_DEFAULTS, WATCHLIST_BASE_FONT_PX, mergeWatchlistSettings, watchlistStyleVars } from './watchlist/watchlistSettings'

const fetcher = url => fetch(url).then(r => r.json())
const PERIODS = [['1', '1min'], ['5', '5min'], ['15', '15min'], ['30', '30min'], ['60', '1hr'], ['D', 'Daily'], ['W', 'Weekly'], ['M', 'Monthly']]
const PERF_COLS = [['1d', '1D'], ['1w', '1W'], ['1m', '1M'], ['3m', '3M'], ['ytd', 'YTD']]
// Configurable columns (right-click a header to hide/show, drag a gridline to resize).
// Flag + Sym are fixed (star + identity). Persisted per-user in localStorage.
const OPTIONAL_COLS = [  // hideable via right-click
  { key: 'price', label: 'Price', def: 62, min: 44 },
  { key: 'vol', label: 'Vol', def: 56, min: 40 },
  { key: 'chg', label: '% Chg', def: 68, min: 50 },
]
// Every real column is a FIXED px width (incl. Sym) so its gridlines sit at the same
// x in the header and every row (a flexible column would drift with scrollbar/subpixel
// rounding and misalign). A trailing minmax(0,1fr) filler absorbs any leftover width.
const COL_META = {
  flag: { def: 30, min: 16 }, sym: { def: 96, min: 56 }, price: { def: 62, min: 44 },
  vol: { def: 56, min: 40 }, chg: { def: 68, min: 50 },
  // Optional data columns (added via the + button).
  mcap: { def: 82, min: 56 }, earn: { def: 92, min: 62 }, rating: { def: 78, min: 54 },
  // Intraday quote-derived columns (computed client-side from the live quote).
  dchg: { def: 70, min: 50 }, fromopen: { def: 76, min: 54 }, fromhigh: { def: 76, min: 54 },
  fromlow: { def: 76, min: 54 }, dcr: { def: 58, min: 42 },
  // Fundamentals text columns (from the meta batch) + N-day performance (perf batch).
  sector: { def: 116, min: 70 }, industry: { def: 136, min: 80 }, theme: { def: 124, min: 74 },
  perf5d: { def: 66, min: 48 }, perf30d: { def: 68, min: 48 }, perf60d: { def: 68, min: 48 }, perf90d: { def: 70, min: 50 },
}
const DEFAULT_COL_ORDER = ['flag', 'sym', 'price', 'vol', 'chg']   // reorderable by dragging a header
// [full label, abbreviation] + the min column width to still show the full word.
const COL_LABELS = {
  flag: ['', ''], sym: ['Symbol', 'Sym'], price: ['Price', 'Price'], vol: ['Volume', 'Vol'], chg: ['% Change', '% Chg'],
  mcap: ['Market Cap', 'Mkt Cap'], earn: ['Next Earnings', 'Earnings'], rating: ['UCT Rating', 'UCT'],
  dchg: ['$ Change', '$ Chg'], fromopen: ['% from Open', '% Open'], fromhigh: ['% from High', '% High'],
  fromlow: ['% from Low', '% Low'], dcr: ['DCR', 'DCR'],
  sector: ['Sector', 'Sector'], industry: ['Industry', 'Industry'], theme: ['Theme', 'Theme'],
  perf5d: ['5-Day', '5-day'], perf30d: ['30-Day', '30-day'], perf60d: ['60-Day', '60-day'], perf90d: ['90-Day', '90-day'],
}
const COL_FULL_MINW = {
  sym: 62, price: 46, vol: 60, chg: 80, mcap: 78, earn: 108, rating: 82,
  dchg: 84, fromopen: 92, fromhigh: 92, fromlow: 88, dcr: 40,
  sector: 40, industry: 40, theme: 40, perf5d: 40, perf30d: 40, perf60d: 40, perf90d: 40,
}
// Extra data columns the user can ADD via the + button (not shown by default).
const EXTRA_COLS = [
  { key: 'mcap', label: 'Market Cap' },
  { key: 'earn', label: 'Next Earnings' },
  { key: 'rating', label: 'UCT Rating' },
  { key: 'dchg', label: '$ Change' },
  { key: 'fromopen', label: '% from Open' },
  { key: 'fromhigh', label: '% from High' },
  { key: 'fromlow', label: '% from Low' },
  { key: 'dcr', label: 'Daily Closing Range' },
  { key: 'sector', label: 'Sector' },
  { key: 'industry', label: 'Industry' },
  { key: 'theme', label: 'Theme' },
  { key: 'perf5d', label: '5-Day Change' },
  { key: 'perf30d', label: '30-Day Change' },
  { key: 'perf60d', label: '60-Day Change' },
  { key: 'perf90d', label: '90-Day Change' },
]
const EXTRA_KEYS = new Set(EXTRA_COLS.map(c => c.key))
// Subset of EXTRA columns whose data comes from the /api/research/snapshot-batch
// meta fetch (vs the live quote feed). Only these trigger useWatchlistMeta; the
// quote-derived ones (dchg/fromopen/…) read fields already on prices[sym].
const META_KEYS = new Set(['mcap', 'earn', 'rating', 'sector', 'industry'])
// Text columns — sorted alphabetically, not numerically.
const TEXT_COLS = new Set(['sector', 'industry', 'theme'])
// N-day performance columns → their key in perfData (from /api/watchlist-performance).
const PERF_KEY_MAP = { perf5d: '5d', perf30d: '30d', perf60d: '60d', perf90d: '90d' }
const PERF_COL_KEYS = new Set(Object.keys(PERF_KEY_MAP))
// Intraday quote-derived column VALUES (numbers or null). Shared by row rendering
// AND column sorting so the two never drift. Each takes the live quote (prices[sym]).
const colDerived = {
  dchg: (q) => {
    if (!q) return null
    if (Number.isFinite(q.change)) return q.change
    const p = q.price, pc = q.prev_close
    return (Number.isFinite(p) && Number.isFinite(pc)) ? p - pc : null
  },
  fromopen: (q) => {
    const o = q?.day_open, p = q?.price
    return (Number.isFinite(o) && o > 0 && Number.isFinite(p)) ? ((p - o) / o) * 100 : null
  },
  fromhigh: (q) => {
    const h = q?.day_high, p = q?.price
    return (Number.isFinite(h) && h > 0 && Number.isFinite(p)) ? ((p - h) / h) * 100 : null
  },
  fromlow: (q) => {
    const l = q?.day_low, p = q?.price
    return (Number.isFinite(l) && l > 0 && Number.isFinite(p)) ? ((p - l) / l) * 100 : null
  },
  // Daily Closing Range: where the price sits within the day's range, 0–100%.
  dcr: (q) => {
    const h = q?.day_high, l = q?.day_low, p = q?.price
    if (!Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(p) || h <= l) return null
    return Math.max(0, Math.min(100, ((p - l) / (h - l)) * 100))
  },
}

// ISO date → compact M/D for the Next Earnings column.
function fmtEarn(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '')
  return m ? `${+m[2]}/${+m[3]}` : '—'
}
// Market cap arrives PRE-FORMATTED from the backend ("$1.23T" / "$482.10B" / "$950M" /
// "$12,345") — parse the display string back to a number so the column can sort.
function parseMcap(s) {
  if (s == null) return null
  if (typeof s === 'number') return Number.isFinite(s) ? s : null
  const m = /^\s*\$?\s*(-?[\d,.]+)\s*([TBMK]?)/i.exec(String(s))
  if (!m) return null
  const n = parseFloat(m[1].replace(/,/g, ''))
  if (!Number.isFinite(n)) return null
  const mult = { T: 1e12, B: 1e9, M: 1e6, K: 1e3 }[m[2].toUpperCase()] || 1
  return n * mult
}
// Next earnings sorts by calendar date — YYYY-MM-DD → YYYYMMDD.
function earnSortValue(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '')
  return m ? Number(`${m[1]}${m[2]}${m[3]}`) : null
}
// UCT rating (1–99) → tier color: high = green, mid = gold, low = red.
function ratingColor(r) {
  if (r == null || !Number.isFinite(r)) return undefined
  if (r >= 70) return '#1ae51a'
  if (r >= 40) return '#c9a84c'
  return '#ff3b47'
}
const WL_COLS_LS = 'uct.watchlist.cols'
const COL_PRESETS = {
  'Price View': new Set(),
  'Performance': new Set(['1d', '1w', '1m', '3m', 'ytd']),
  'Short-Term': new Set(['1d', '1w', '1m']),
}

function changePctClass(val) {
  if (val == null) return ''
  if (val > 5) return styles.cellDeepGreen
  if (val > 0) return styles.cellGreen
  if (val < -5) return styles.cellDeepRed
  if (val < 0) return styles.cellRed
  return ''
}

function fmtVol(v) {
  if (v == null || !Number.isFinite(v)) return '—'
  if (v >= 1e9) return (v / 1e9).toFixed(1) + 'B'
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M'
  if (v >= 1e3) return (v / 1e3).toFixed(v >= 1e5 ? 0 : 1) + 'K'
  return String(v)
}

// Flash a quick bold (+ optional up/down background tint) whenever a cell's value
// ticks — mirrors ThemeTrackerPage's ReturnCell so the watchlist feels as "live"
// as the theme tracker. `tint` adds the up/down background flash (the % column);
// price/volume flash bold only. No flash on first paint (prevRef seeds to value).
//
// TINT COLOR follows the DAY DIRECTION, not the tick direction: a stock green on
// the day always flashes the up-tint (even on a down-tick), a stock red on the day
// always flashes the down-tint. `tintSign` supplies that day value; it defaults to
// the cell's own value (the % column's value IS the day change, so its sign already
// == day direction). tickUp/tickDown map to the user's custom --wl-tint colors, so
// this stays palette-agnostic. `dir` now only GATES the flash (any change), the
// color comes from the day sign.
const FlashCell = React.memo(function FlashCell({ value, display, className, tint = false, tintSign = null }) {
  const [dir, setDir] = useState(null)
  const prevRef = useRef(value)
  useEffect(() => {
    const p = prevRef.current
    if (value != null && p != null && value !== p) {
      setDir(value > p ? 'up' : 'down')
      prevRef.current = value
      const id = setTimeout(() => setDir(null), 480)
      return () => clearTimeout(id)
    }
    prevRef.current = value
  }, [value])
  const daySign = tintSign != null ? tintSign : value
  const flash = dir
    ? `${styles.tickFlash}${tint ? ' ' + (daySign >= 0 ? styles.tickUp : styles.tickDown) : ''}`
    : ''
  // The tint/bold ride an INNER content-sized box so the flash hugs the value
  // (like Theme Tracker), not the full-width grid cell. Outer keeps cell layout.
  return (
    <span className={className}>
      <span className={`${styles.tickInner}${flash ? ' ' + flash : ''}`}>{display}</span>
    </span>
  )
})

// Memoized columnar ticker row: Flag(star) | Symbol(logo) | Price | Volume | % Change.
// PERF: this is the single hottest render path — with 4 watchlist widgets × ~150 rows,
// a naive re-render on every arrow-key selection change reconciles ~600 rows per keypress
// and makes fast scanning lag. React.memo + all-primitive props + stable callbacks means a
// selection change only re-renders the TWO rows whose `selected` flipped (see WatchlistWidget
// setSym stability + the stable onRow* callbacks + memoized orderedKeys in the parent).
const WatchRow = React.memo(function WatchRow({
  sym, name, price, changePct, volume, flagged, selected, orderedKeys,
  showLogos = true, tintEnabled = true, logoSize = 16, mcap = null, earn = null, rating = null,
  dchg = null, fromOpen = null, fromHigh = null, fromLow = null, dcr = null,
  sector = null, industry = null, theme = null,
  perf5d = null, perf30d = null, perf60d = null, perf90d = null,
  isOwner, itemId, notes, wlId, noteOpen, alertOn,
  onSelect, onToggleFlag, onIntent, onToggleNote, onSetAlert, onCtx, onRemove,
}) {
  // Signed % cell (green/red text + day-direction tint flash) — shared by the
  // %-from-open/high/low columns so they read like the % Change column.
  const pctCell = (key, v) => (
    <FlashCell key={key} value={v} tint={tintEnabled}
      className={`${styles.changeCell} ${v != null ? (v >= 0 ? styles.gain : styles.loss) : ''}`}
      display={v != null ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` : '—'} />
  )
  const cellFor = (key) => {
    if (key === 'flag') return (
      <button
        key="flag"
        className={`${styles.flagStar}${flagged ? ' ' + styles.flagStarActive : ''}`}
        onClick={e => { e.stopPropagation(); onToggleFlag(sym) }}
        title={flagged ? 'Remove from Flagged' : 'Add to Flagged (Shift+F)'}
      >{flagged ? <UIcon name="star-fill" size={13} /> : <UIcon name="star" size={13} />}</button>
    )
    if (key === 'sym') return (
      <span key="sym" className={styles.symCell} onContextMenu={wlId ? (e => onCtx(e, sym, wlId, isOwner)) : undefined}>
        {showLogos && <span className={styles.rowLogo}><CompanyLogo sym={sym} name={name} size={logoSize} round /></span>}
        <span className={styles.rowSym}>{sym}</span>
      </span>
    )
    if (key === 'price') return (
      <FlashCell key="price" value={price} className={styles.priceCell}
        display={price != null ? price.toFixed(2) : '—'} />
    )
    if (key === 'vol') return (
      <FlashCell key="vol" value={volume} className={styles.volCell} display={fmtVol(volume)} />
    )
    if (key === 'chg') return (
      <FlashCell key="chg" value={changePct} tint={tintEnabled}
        className={`${styles.changeCell} ${changePct != null ? (changePct >= 0 ? styles.gain : styles.loss) : ''}`}
        display={changePct != null ? `${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%` : '—'} />
    )
    if (key === 'mcap') return <span key="mcap" className={styles.metaCell}>{mcap || '—'}</span>
    if (key === 'earn') return <span key="earn" className={styles.metaCell}>{fmtEarn(earn)}</span>
    if (key === 'rating') return (
      <span key="rating" className={styles.metaCell} style={{ color: ratingColor(rating), fontWeight: 600 }}>
        {Number.isFinite(rating) ? rating : '—'}
      </span>
    )
    // Intraday quote-derived columns.
    if (key === 'dchg') return (
      <FlashCell key="dchg" value={dchg} tint={tintEnabled}
        className={`${styles.changeCell} ${dchg != null ? (dchg >= 0 ? styles.gain : styles.loss) : ''}`}
        display={dchg != null ? `${dchg >= 0 ? '+' : ''}${dchg.toFixed(2)}` : '—'} />
    )
    if (key === 'fromopen') return pctCell('fromopen', fromOpen)
    if (key === 'fromhigh') return pctCell('fromhigh', fromHigh)
    if (key === 'fromlow') return pctCell('fromlow', fromLow)
    if (key === 'dcr') return (
      <span key="dcr" className={styles.metaCell}>{dcr != null ? `${dcr.toFixed(0)}%` : '—'}</span>
    )
    // Fundamentals text columns (left-aligned, ellipsized, full value on hover).
    if (key === 'sector') return <span key="sector" className={styles.textCell} title={sector || ''}>{sector || '—'}</span>
    if (key === 'industry') return <span key="industry" className={styles.textCell} title={industry || ''}>{industry || '—'}</span>
    if (key === 'theme') return <span key="theme" className={styles.textCell} title={theme || ''}>{theme || '—'}</span>
    // N-day performance columns (signed %, green/red like % Change).
    if (key === 'perf5d') return pctCell('perf5d', perf5d)
    if (key === 'perf30d') return pctCell('perf30d', perf30d)
    if (key === 'perf60d') return pctCell('perf60d', perf60d)
    if (key === 'perf90d') return pctCell('perf90d', perf90d)
    return null
  }
  return (
    <div
      data-watch-sym={sym}
      className={`${styles.listRow} ${styles.wlRow}${selected ? ' ' + styles.listRowSelected : ''}`}
      onClick={() => onSelect(sym)}
      onPointerEnter={() => onIntent(sym)}
      onFocus={() => onIntent(sym)}
    >
      {orderedKeys.map(cellFor)}
      {isOwner && (
        <div className={styles.rowActions} onClick={e => e.stopPropagation()}>
          <button
            className={`${styles.noteBtn}${noteOpen ? ' ' + styles.noteBtnActive : ''}`}
            onClick={() => onToggleNote(itemId, notes)}
            title="Notes"
          ><UIcon name="edit" size={12} /></button>
          <button
            className={`${styles.alertBtn}${alertOn ? ' ' + styles.alertBtnActive : ''}`}
            onClick={e => onSetAlert(sym, e)}
            title="Set price alert"
          ><UIcon name="bell" size={12} /></button>
          {onRemove && (
            <button className={styles.removeBtn} onClick={e => onRemove(e, wlId, itemId)} title="Remove from this list">×</button>
          )}
        </div>
      )}
    </div>
  )
})

function AddItemRow({ onAdd }) {
  const [sym, setSym] = useState('')
  return (
    <form
      className={styles.addItemRow}
      onSubmit={e => { e.preventDefault(); if (sym.trim()) { onAdd(sym.trim()); setSym('') } }}
    >
      <input
        className={styles.addItemInput}
        placeholder="+ Ticker"
        value={sym}
        onChange={e => setSym(e.target.value.toUpperCase())}
        maxLength={10}
      />
      <button type="submit" className={styles.addItemBtn}>Add</button>
    </form>
  )
}

export default function Watchlists({ embedded = false, pickList = null, pickName = null, onExitPick = null, activeRef = null, widgetKey = null }) {
  // This widget is "active" (owns arrow keys + its own scroll) when hovered/focused.
  const isActiveWidget = () => !activeRef || activeRef.current == null || activeRef.current === widgetKey
  const markActiveWidget = () => { if (activeRef && widgetKey) activeRef.current = widgetKey }

  // ── Watchlist appearance settings (⚙ panel) ────────────────────────────────
  const { prefs, setPref } = usePreferences()
  const wlSettings = useMemo(
    () => mergeWatchlistSettings(parsePref(prefs?.[WATCHLIST_SETTINGS_KEY], null)),
    [prefs],
  )
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsBtnRef = useRef(null)
  const patchSettings = useCallback((patch) => {
    setPref(WATCHLIST_SETTINGS_KEY, JSON.stringify({ ...wlSettings, ...patch }))
  }, [wlSettings, setPref])
  const resetSettings = useCallback(() => {
    setPref(WATCHLIST_SETTINGS_KEY, JSON.stringify(WATCHLIST_DEFAULTS))
  }, [setPref])
  const wlStyle = useMemo(() => watchlistStyleVars(wlSettings), [wlSettings])
  // CompanyLogo sizes itself with an inline px style, so the text-size scale has to be
  // applied in JS for the logo (the CSS var handles everything else).
  const rowLogoSize = useMemo(() => {
    const px = Number(wlSettings.fontSize)
    const scale = px > 0 ? px / WATCHLIST_BASE_FONT_PX : 1
    return Math.round(16 * scale)
  }, [wlSettings.fontSize])

  const [activeTab, setActiveTab] = useState('mine')
  const [selectedSym, setSelectedSym] = useState(null)
  const { sym: hubSym, setSym: setHubSym } = useChartsSym()
  useEffect(() => {
    if (hubSym && hubSym !== selectedSym) setSelectedSym(hubSym)
  }, [hubSym]) // intentionally do NOT depend on selectedSym (avoid feedback loop)

  // Single-list "pick" mode (widget scoped to one chosen list): force the right
  // tab + force the picked group expanded so it opens straight to the tickers.
  useEffect(() => {
    if (!pickList) return
    setActiveTab(pickList.startsWith('community:') ? 'community' : 'mine')
    let key = null
    if (pickList === 'flagged') key = 'flagged'
    else if (pickList.startsWith('user:')) key = pickList.slice(5)
    else if (pickList.startsWith('community:')) key = pickList.slice(10)
    else if (pickList.startsWith('tag:')) key = pickList
    if (key != null) {
      setExpandedLists(prev => {
        const n = new Set(prev)
        n.add(key)
        const num = Number(key)
        if (!Number.isNaN(num)) n.add(num)   // list ids may be numeric
        return n
      })
    }
  }, [pickList])
  const [chartPeriod, setChartPeriod] = useState('D')
  const [flagToast, setFlagToast] = useState(null)
  const [expandedLists, setExpandedLists] = useState(new Set())
  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState({ name: '', description: '', is_public: false })
  const [saving, setSaving] = useState(false)
  const [renamingId, setRenamingId] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  const [ctxMenu, setCtxMenu] = useState(null) // { x, y, id, isOwner, symbols, sym? }
  const [starred, setStarred] = useState(new Set()) // "listId:SYM" keys
  const [expandedNote, setExpandedNote] = useState(null) // item ID with note open
  const [noteText, setNoteText] = useState('')
  const [dragItemId, setDragItemId] = useState(null)
  const [dragOverId, setDragOverId] = useState(null)
  const [importListId, setImportListId] = useState(null)
  const [importText, setImportText] = useState('')
  const [showPerfCols, setShowPerfCols] = useState(false)
  const [visiblePerf, setVisiblePerf] = useState(new Set())
  const [sortBy, setSortBy] = useState(null) // null | 'sym' | 'price' | 'change' | '1d' | '1w' | '1m' | '3m' | 'ytd'
  const [sortDir, setSortDir] = useState('desc')
  const [filterText, setFilterText] = useState('')

  function toggleStar(listId, sym) {
    const key = `${listId}:${sym}`
    setStarred(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n })
  }

  function getStarredSyms(listId) {
    const prefix = `${listId}:`
    return [...starred].filter(k => k.startsWith(prefix)).map(k => k.slice(prefix.length))
  }

  async function handleRemoveStarred(listId) {
    const syms = getStarredSyms(listId)
    if (!syms.length) return
    if (listId === 'flagged') {
      syms.forEach(s => removeFlagged(s))
    } else {
      const wl = myLists?.find(w => w.id === listId)
      if (!wl) return
      for (const sym of syms) {
        const item = wl.items?.find(i => i.sym === sym)
        if (item) await fetch(`/api/watchlists/${listId}/items/${item.id}`, { method: 'DELETE' })
      }
      mutateMine()
    }
    // Clear stars for this list
    setStarred(prev => {
      const n = new Set(prev)
      for (const k of prev) { if (k.startsWith(`${listId}:`)) n.delete(k) }
      return n
    })
    setCtxMenu(null)
  }

  function handleSort(col) {
    if (sortBy === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortBy(col); setSortDir('desc') }
  }
  function sortIndicator(col) { return sortBy !== col ? '' : sortDir === 'desc' ? ' ▾' : ' ▴' }

  // sortAndFilterItems is defined further down — after `prices` and `perfData`
  // are in scope. Defining it here would TDZ on those `const` deps.

  function exportCSV(wl) {
    const items = wl.items || []
    const rows = [['Symbol', 'Notes'], ...items.map(i => [i.sym, (i.notes || '').replace(/"/g, '""')])]
    const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${wl.name.replace(/[^a-zA-Z0-9]/g, '_')}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    setCtxMenu(null)
  }

  function parseImportText(text) {
    return text.split(/[\n,]+/).map(s => s.trim().toUpperCase()).filter(s => /^[A-Z]{1,10}$/.test(s))
  }

  async function handleImport() {
    const syms = parseImportText(importText)
    if (!syms.length || !importListId) return
    await fetch(`/api/watchlists/${importListId}/items/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbols: syms }),
    })
    setImportListId(null)
    setImportText('')
    mutateMine()
  }

  function handleDrop(wlId, items) {
    if (!dragItemId || !dragOverId || dragItemId === dragOverId) { setDragItemId(null); setDragOverId(null); return }
    const ids = items.map(i => i.id)
    const fromIdx = ids.indexOf(dragItemId)
    const toIdx = ids.indexOf(dragOverId)
    if (fromIdx < 0 || toIdx < 0) { setDragItemId(null); setDragOverId(null); return }
    ids.splice(fromIdx, 1)
    ids.splice(toIdx, 0, dragItemId)
    setDragItemId(null)
    setDragOverId(null)
    fetch(`/api/watchlists/${wlId}/reorder`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_ids: ids }),
    }).then(() => mutateMine()).catch(() => {})
  }

  function saveNote(wlId, itemId, text) {
    fetch(`/api/watchlists/${wlId}/items/${itemId}/notes`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: text }),
    }).then(() => mutateMine()).catch(() => {})
  }

  function toggleNote(itemId, currentNotes) {
    if (expandedNote === itemId) { setExpandedNote(null); return }
    setExpandedNote(itemId)
    setNoteText(currentNotes || '')
  }

  function handleContextMenu(e, id, isOwner, symbols) {
    e.preventDefault()
    e.stopPropagation()
    const x = Math.min(e.clientX, window.innerWidth - 220)
    const y = Math.min(e.clientY, window.innerHeight - 300)
    setCtxMenu({ x, y, id, isOwner, symbols })
  }

  // Touch long-press → open the same context menu (mouse uses native right-click).
  // Returns props to spread onto a trigger element. `build(e)` should return the
  // ctxMenu payload to set; reads clientX/clientY from the originating event.
  const lpTimer = useRef(null)
  const lpStart = useRef({ x: 0, y: 0 })
  const lpFiredAt = useRef(0)
  function longPressMenu(build) {
    const clear = () => { if (lpTimer.current) { clearTimeout(lpTimer.current); lpTimer.current = null } }
    return {
      onPointerDown: (e) => {
        if (e.pointerType === 'mouse') return
        lpStart.current = { x: e.clientX, y: e.clientY }
        clear()
        lpTimer.current = setTimeout(() => {
          try { navigator.vibrate?.(10) } catch { /* noop */ }
          lpFiredAt.current = e.timeStamp || performance.now()
          setCtxMenu(build({ clientX: e.clientX, clientY: e.clientY }))
        }, 450)
      },
      onPointerMove: (e) => {
        if (!lpTimer.current) return
        if (Math.abs(e.clientX - lpStart.current.x) > 10 || Math.abs(e.clientY - lpStart.current.y) > 10) clear()
      },
      onPointerUp: clear,
      onPointerCancel: clear,
      // Swallow the click that follows a long-press so the row/name's own
      // onClick (toggle list / select sym) doesn't also fire.
      onClickCapture: (e) => {
        const now = e.timeStamp || performance.now()
        if (now - lpFiredAt.current < 600) { e.preventDefault(); e.stopPropagation() }
      },
    }
  }

  function handleCopyList(symbols) {
    navigator.clipboard.writeText(symbols.join(', '))
    setCtxMenu(null)
  }

  const { user } = useAuth()
  const isTouch = useIsTouch()
  const { flagged, toggle: toggleFlag, remove: removeFlagged, isFlagged, isShared, toggleShare, flaggedName, renameFlagged } = useFlagged()
  const { data: myLists, mutate: mutateMine } = useSWR('/api/watchlists', fetcher, { refreshInterval: 60000 })
  const { data: communityLists, mutate: mutateCommunity } = useSWR('/api/watchlists/public', fetcher, { refreshInterval: 60000 })
  const { tagColors: TAG_COLORS, tagByKey: TAG_BY_KEY } = useTagColors()
  const { tags, setTag, removeTag, getTag, isColorShared, toggleShareColor, communityTags } = useTickerTags()
  const { createAlert, deleteAlert, getAlertsForSym, hasAlert } = useWatchlistAlerts()
  const [alertPopover, setAlertPopover] = useState(null) // { sym, x, y }
  const [alertPrice, setAlertPrice] = useState('')
  const [alertDir, setAlertDir] = useState('above')

  // Collect all visible tickers for live prices
  const allTickers = useMemo(() => {
    const tickers = []
    if (activeTab === 'mine' && expandedLists.has('flagged')) {
      tickers.push(...flagged)
    }
    if (activeTab === 'mine') {
      TAG_COLORS.forEach(tc => {
        if (expandedLists.has(`tag:${tc.key}`)) {
          Object.entries(tags).filter(([, c]) => c === tc.key).forEach(([s]) => tickers.push(s))
        }
      })
    }
    const lists = activeTab === 'mine' ? myLists : communityLists
    if (lists) {
      lists
        .filter(wl => expandedLists.has(wl.id))
        .forEach(wl => (wl.items || []).forEach(i => { if (i.sym) tickers.push(i.sym) }))
    }
    return tickers
  }, [activeTab, flagged, tags, myLists, communityLists, expandedLists])

  const { prices } = useRealtimePrices(allTickers)
  // Column config (persisted per-user in localStorage) — declared HERE, above the
  // perf/theme fetches, so those can gate on which columns are shown.
  const [colCfg, setColCfg] = useState(() => {
    try { return JSON.parse(localStorage.getItem(WL_COLS_LS)) || {} } catch { return {} }
  })
  const _colKeys = Array.isArray(colCfg.order) ? colCfg.order : []
  // Perf batch: fetched when a legacy perf pill OR an N-day column is active.
  const { perfData } = useWatchlistPerformance(
    (visiblePerf.size > 0 || _colKeys.some(k => PERF_COL_KEYS.has(k))) ? allTickers : [],
  )
  // Theme batch: only when the Theme column is shown.
  const { themeData } = useWatchlistThemes(_colKeys.includes('theme') ? allTickers : [])

  // Pre-warm EVERY visible ticker across all scan timeframes (into durable IDB)
  // so arrowing/scrolling the list is instant on intraday TFs (5m/30m/1h), not
  // just the pre-warmed daily. Debounced + bounded (the shared IDB queue idles
  // behind the active chart); already-warm pairs skip. Runs once the list settles.
  useEffect(() => {
    if (!allTickers.length) return
    const t = setTimeout(() => prefetchListAllTimeframes(allTickers), 1200)
    return () => clearTimeout(t)
  }, [allTickers])

  // Moved here from earlier in the file — depends on `prices` and `perfData`,
  // which are declared above. Putting it earlier hits a TDZ on those consts
  // when the deps array evaluates, crashing the page on mount.
  const sortAndFilterItems = useCallback((items) => {
    let filtered = items
    if (filterText) {
      const q = filterText.toUpperCase()
      filtered = filtered.filter(i => (i.sym || i).toString().toUpperCase().includes(q))
    }
    if (!sortBy) return filtered
    return [...filtered].sort((a, b) => {
      const symA = a.sym || a, symB = b.sym || b
      let va, vb
      if (sortBy === 'sym') { va = symA; vb = symB }
      else if (sortBy === 'price') { va = prices[symA]?.price; vb = prices[symB]?.price }
      else if (sortBy === 'change') { va = prices[symA]?.change_pct; vb = prices[symB]?.change_pct }
      else { va = perfData[symA]?.[sortBy]; vb = perfData[symB]?.[sortBy] }
      if (va == null && vb == null) return 0
      if (va == null) return 1
      if (vb == null) return -1
      if (sortBy === 'sym') return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va)
      return sortDir === 'asc' ? va - vb : vb - va
    })
  }, [sortBy, sortDir, filterText, prices, perfData])

  function togglePerfCol(key) {
    setVisiblePerf(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n })
  }

  // Clear toast
  useEffect(() => {
    if (!flagToast) return
    const t = setTimeout(() => setFlagToast(null), 1500)
    return () => clearTimeout(t)
  }, [flagToast])

  // Build a flat, deduped, top-to-bottom list of every sym currently visible
  // across expanded watchlists / flagged / color-tag auto-lists. Arrow keys
  // navigate through this flat list so the user can move row-by-row no matter
  // which list contains the selected ticker.
  const visibleSymsFlat = useMemo(() => {
    const seen = new Set()
    const out = []
    const push = (s) => { if (s && !seen.has(s)) { seen.add(s); out.push(s) } }

    // Flagged group first (matches visual order on "mine" tab)
    if (activeTab === 'mine' && expandedLists.has('flagged')) {
      flagged.forEach(push)
    }
    // Color-tag auto-lists
    if (activeTab === 'mine') {
      TAG_COLORS.forEach(tc => {
        if (expandedLists.has(`tag:${tc.key}`)) {
          Object.entries(tags).filter(([, c]) => c === tc.key).forEach(([s]) => push(s))
        }
      })
    }
    // User / community watchlists (whichever tab is active)
    const lists = activeTab === 'mine' ? myLists : communityLists
    if (lists) {
      lists.filter(wl => expandedLists.has(wl.id)).forEach(wl => {
        (wl.items || []).forEach(i => push(i.sym))
      })
    }
    return out
  }, [activeTab, expandedLists, flagged, tags, TAG_COLORS, myLists, communityLists])

  // Keyboard nav: arrow up/down moves through every expanded list.
  const handleKeyDown = useCallback((e) => {
    // Don't hijack arrows while user is typing in an input/textarea/contenteditable
    const tgt = e.target
    if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) return
    // Only the ACTIVE watchlist widget handles arrows — otherwise all 4 widgets race
    // over one keypress (first-mounted wins) and navigate the wrong list.
    if (activeRef && activeRef.current != null && activeRef.current !== widgetKey) return

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      // Derive the order straight from the DOM (the actual on-screen order) so arrow
      // nav ALWAYS matches the displayed rows — including any active column sort.
      // Falls back to visibleSymsFlat if the DOM isn't reachable.
      let flat = []
      const root = pageRef.current
      if (root) {
        const seen = new Set()
        root.querySelectorAll('[data-watch-sym]').forEach(el => {
          const s = el.getAttribute('data-watch-sym')
          if (s && !seen.has(s)) { seen.add(s); flat.push(s) }
        })
      }
      if (!flat.length) flat = visibleSymsFlat
      if (!flat.length) return
      const idx = selectedSym ? flat.indexOf(selectedSym) : -1
      // If selection is set but not in THIS widget's list, don't navigate —
      // another widget (Themes, etc.) owns the selection and its own handler responds.
      if (idx < 0 && selectedSym) return
      e.preventDefault()
      // This widget owns the arrow now — stop other window keydown listeners
      // (e.g. the Theme Tracker, which shares the color group) from ALSO grabbing
      // the selection when we run off the end of the list.
      e.stopImmediatePropagation()
      const len = flat.length
      let next
      if (idx < 0) {
        next = e.key === 'ArrowDown' ? 0 : len - 1
      } else {
        // WRAP at the ends: off the bottom → top, off the top → bottom.
        next = e.key === 'ArrowDown' ? (idx + 1) % len : (idx - 1 + len) % len
      }
      const nextSym = flat[next]
      if (nextSym) {
        if (nextSym !== selectedSym) setSelectedSym(nextSym)
        setHubSym(nextSym)   // always re-assert so this widget wins the color group
      }
    }
    if (e.shiftKey && e.key === 'F' && selectedSym && flagged.includes(selectedSym)) {
      removeFlagged(selectedSym)
      setFlagToast('removed')
    }
  }, [visibleSymsFlat, selectedSym, flagged, removeFlagged, setHubSym])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  // Scroll the active row into view when selection changes via keyboard.
  const pageRef = useRef(null)
  useEffect(() => {
    if (!selectedSym || !pageRef.current) return
    // Only the active widget scrolls — otherwise all 4 watchlists force a synchronous
    // reflow on every selection change (the big cost when scanning up / wrapping).
    if (!isActiveWidget()) return
    const row = pageRef.current.querySelector(`[data-watch-sym="${CSS.escape(selectedSym)}"]`)
    if (row && typeof row.scrollIntoView === 'function') {
      row.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
  }, [selectedSym])

  // Durable warm of the WHOLE visible list into IndexedDB, so arrowing through it
  // with the keyboard (faster than hover-prefetch can react) is instant — and stays
  // instant across page reloads. Bounded + idle-deferred inside prefetchBarsToIDB,
  // and it skips already-warm tickers, so a big list doesn't hammer the network.
  useEffect(() => {
    if (!visibleSymsFlat.length) return
    prefetchBarsToIDB(visibleSymsFlat, chartPeriod)
    if (chartPeriod !== 'D') prefetchBarsToIDB(visibleSymsFlat, 'D')
  }, [visibleSymsFlat, chartPeriod])

  // Prefetch all timeframes for current ticker + adjacent flagged tickers
  useEffect(() => {
    if (!selectedSym) return
    prefetchAllTimeframes(selectedSym)
    if (!flagged.length) return
    const idx = flagged.indexOf(selectedSym)
    if (idx < 0) return
    const upcoming = flagged.slice(idx + 1, idx + 6)
    prefetchBars(upcoming, chartPeriod)
  }, [selectedSym, flagged, chartPeriod])

  function toggleList(id) {
    setExpandedLists(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleCreate(e) {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await fetch('/api/watchlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createForm),
      })
      if (res.ok) {
        setShowCreate(false)
        setCreateForm({ name: '', description: '', is_public: false })
        mutateMine()
        mutateCommunity()
      }
    } finally { setSaving(false) }
  }

  async function handleDeleteList(id) {
    if (!confirm('Delete this watchlist?')) return
    await fetch(`/api/watchlists/${id}`, { method: 'DELETE' })
    setExpandedLists(prev => { const n = new Set(prev); n.delete(id); return n })
    mutateMine()
    mutateCommunity()
  }

  async function handleRename(id, newName) {
    const trimmed = newName.trim()
    if (!trimmed) { setRenamingId(null); return }
    await fetch(`/api/watchlists/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: trimmed }),
    })
    setRenamingId(null)
    mutateMine()
    mutateCommunity()
  }

  async function handleTogglePublic(wl) {
    await fetch(`/api/watchlists/${wl.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_public: !wl.is_public }),
    })
    mutateMine()
    mutateCommunity()
  }

  async function handleAddItem(listId, sym) {
    await fetch(`/api/watchlists/${listId}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sym, notes: '' }),
    })
    mutateMine()
  }

  async function handleRemoveItem(listId, itemId) {
    await fetch(`/api/watchlists/${listId}/items/${itemId}`, { method: 'DELETE' })
    mutateMine()
  }

  const currentLists = activeTab === 'mine' ? myLists : communityLists

  // ── Configurable + sortable columns ── (colCfg STATE is declared earlier, above
  // the meta/perf/theme fetches, so those fetches can gate on which columns show.)
  const saveColCfg = useCallback((next) => {
    setColCfg(next)
    try { localStorage.setItem(WL_COLS_LS, JSON.stringify(next)) } catch { /* ignore */ }
  }, [])
  const [liveResize, setLiveResize] = useState(null)   // {key,width} during a drag
  const [colMenu, setColMenu] = useState(null)         // {x,y} right-click menu
  const resizingRef = useRef(false)                    // suppress the header sort-click after a resize
  const dragColRef = useRef(null)                      // key of the header column being drag-reordered
  const colHidden = colCfg.hidden || {}
  const colSort = colCfg.sort || null                  // {key, dir} | null

  // ── Sort-order freeze ──────────────────────────────────────────────────────
  // When sorting by a live column (% Chg / Price / Volume) the rows would jump
  // around every tick as quotes update — annoying. Instead we sort against a
  // SNAPSHOT of the prices taken at SORT time and keep that row order stable;
  // live values still update in place. Clicking a sort column re-ranks (the
  // header doubles as a "re-sort" button). Consumed by applyColSort below.
  const pricesRef = useRef(prices)
  useEffect(() => { pricesRef.current = prices }, [prices])
  const [sortBasis, setSortBasis] = useState(null)
  // Re-snapshot on every explicit sort — colSort changes on each header click.
  useEffect(() => {
    const p = pricesRef.current
    setSortBasis(p && Object.keys(p).length ? { ...p } : null)
  }, [colSort])   // eslint-disable-line react-hooks/exhaustive-deps
  // Initial fill: capture once when live prices first arrive so a saved/default
  // sort still orders correctly on load without then re-shuffling every tick.
  useEffect(() => {
    if (sortBasis == null && colSort && prices && Object.keys(prices).length) {
      setSortBasis({ ...prices })
    }
  }, [prices, sortBasis, colSort])
  const colWidth = (k) => {
    if (liveResize?.key === k) return liveResize.width
    return colCfg.widths?.[k] ?? COL_META[k]?.def
  }
  // Columns in the user's chosen ORDER; flag + sym always shown, price/vol/chg unless hidden.
  const colOrder = (Array.isArray(colCfg.order) && colCfg.order.length ? colCfg.order : DEFAULT_COL_ORDER).filter(k => COL_META[k])
  // Memoized so its reference is stable across selection-change re-renders (WatchRow is
  // React.memo — a new array here would break row memoization on every keypress).
  const orderedKeys = useMemo(() => {
    const hidden = colCfg.hidden || {}
    const order = (Array.isArray(colCfg.order) && colCfg.order.length ? colCfg.order : DEFAULT_COL_ORDER).filter(k => COL_META[k])
    const ks = order.filter(k => (k === 'flag' || k === 'sym') || !hidden[k])
    DEFAULT_COL_ORDER.forEach(k => { if ((k === 'flag' || k === 'sym') && !ks.includes(k)) ks.unshift(k) })  // never lose flag/sym
    return ks
  }, [colCfg])
  const visibleOptional = OPTIONAL_COLS.filter(c => !colHidden[c.key])
  // Measured content width of the list (excludes the vertical scrollbar) — drives the
  // shrink-to-fit below so an ADDED column squeezes the others in rather than overflow.
  const listBodyRef = useRef(null)
  const [bodyW, setBodyW] = useState(0)
  useEffect(() => {
    const el = listBodyRef.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(() => setBodyW(el.clientWidth))
    ro.observe(el)
    setBodyW(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  // Fixed-px columns at their set widths — NO shrink-to-fit. Dragging a gridline
  // resizes only that column; when the total exceeds the widget width the columns
  // simply overflow and the rightmost ones clip off the right edge (.listBody is
  // overflow-x:hidden). This is deliberate: making Price wider must push Volume off
  // the screen rather than silently squeezing every other column to keep it all
  // visible. (`bodyW` is still measured but no longer scales the widths.)
  const renderedColWidths = useMemo(
    () => orderedKeys.map(k => colWidth(k)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orderedKeys, colCfg, liveResize],
  )
  const gridTemplate = useMemo(
    () => [...renderedColWidths.map(w => `${w}px`), 'minmax(0, 1fr)'].join(' '),
    [renderedColWidths],
  )

  // Optional Market Cap / Next Earnings / UCT Rating columns — fetched only when at
  // least one is actually shown (fundamentals are heavy per ticker). The quote-derived
  // columns ($ chg / % from open·high·low / DCR) read prices[sym] — no meta fetch.
  const extraVisible = orderedKeys.some(k => META_KEYS.has(k))
  const { metaData } = useWatchlistMeta(extraVisible ? allTickers : [])

  // Extra data columns (Market Cap / Next Earnings / UCT Rating) toggle on/off from the
  // right-click COLUMNS menu. Checking one APPENDS it to the RIGHT of the column order
  // (the grid below shrinks the others to fit); unchecking removes it.
  const toggleExtraCol = useCallback((key) => {
    const curOrder = (Array.isArray(colCfg.order) && colCfg.order.length ? colCfg.order : DEFAULT_COL_ORDER).filter(k => COL_META[k])
    if (curOrder.includes(key)) {
      saveColCfg({ ...colCfg, order: curOrder.filter(k => k !== key) })
    } else {
      const nextHidden = { ...(colCfg.hidden || {}) }
      delete nextHidden[key]
      saveColCfg({ ...colCfg, order: [...curOrder, key], hidden: nextHidden })
    }
  }, [colCfg, saveColCfg])

  // Drag a header column onto another to reorder the columns.
  const moveColumn = (fromKey, toKey) => {
    if (!fromKey || fromKey === toKey) return
    const order = [...colOrder]
    DEFAULT_COL_ORDER.forEach(k => { if (!order.includes(k)) order.push(k) })
    const from = order.indexOf(fromKey)
    const to = order.indexOf(toKey)
    if (from < 0 || to < 0) return
    order.splice(from, 1)
    order.splice(to, 0, fromKey)
    saveColCfg({ ...colCfg, order })
  }

  // Drag a gridline (an independent divider overlaid on the header, NOT tied to a
  // header cell — so dragging never sorts/selects the column) to resize the column to
  // its LEFT. Every column (Flag included) is resizable; the filler absorbs the change.
  const startColResize = (e, key) => {
    e.preventDefault(); e.stopPropagation()
    resizingRef.current = true
    const startX = e.clientX
    const startW = colWidth(key)
    const min = COL_META[key]?.min || 40
    // Widths are stored UNSCALED but painted scaled — convert the cursor delta back
    // into unscaled space so the gridline tracks the pointer 1:1 while shrunk-to-fit.
    const rawTotal = orderedKeys.reduce((a, k) => a + colWidth(k), 0)
    const renTotal = renderedColWidths.reduce((a, b) => a + b, 0)
    const scale = (rawTotal > 0 && renTotal > 0) ? renTotal / rawTotal : 1
    const calc = (ev) => Math.max(min, Math.round(startW + (ev.clientX - startX) / (scale || 1)))
    const onMove = (ev) => setLiveResize({ key, width: calc(ev) })
    const onUp = (ev) => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      const w = calc(ev)
      setLiveResize(null)
      saveColCfg({ ...colCfg, widths: { ...(colCfg.widths || {}), [key]: w } })
      setTimeout(() => { resizingRef.current = false }, 0)   // let the trailing click be swallowed first
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }
  const toggleColHidden = (key) => saveColCfg({ ...colCfg, hidden: { ...colHidden, [key]: !colHidden[key] } })
  const handleColSort = (key) => {
    if (resizingRef.current) return   // a drag just ended — don't treat the trailing click as a sort
    const next = (!colSort || colSort.key !== key)
      ? { key, dir: key === 'sym' ? 'asc' : 'desc' }   // first click: sym A→Z, numbers high→low
      : { key, dir: colSort.dir === 'asc' ? 'desc' : 'asc' }
    saveColCfg({ ...colCfg, sort: next })
  }
  // Sort an array of symbols by the active column (used by every list render + arrow nav).
  const applyColSort = useCallback((syms) => {
    if (!colSort) return syms
    const { key, dir } = colSort
    const mul = dir === 'asc' ? 1 : -1
    // Sort against the frozen snapshot (captured at sort time), NOT live prices —
    // so ticking quotes don't constantly reshuffle rows. `sym` sorts are already
    // price-independent. Fall back to live prices only until the first snapshot
    // lands (initial load). New syms absent from the snapshot sink to the bottom
    // until the next explicit re-sort.
    const basis = (key === 'sym') ? null : (sortBasis || prices)
    const num = (s) => {
      const q = basis?.[s]
      if (key === 'price') return q?.price ?? null
      if (key === 'vol') return q?.volume ?? null
      if (key === 'chg') return q?.change_pct ?? null
      // Intraday quote-derived columns sort off the same helper the cells render from.
      if (colDerived[key]) return colDerived[key](q)
      // Extra columns sort off the meta batch, not the quote feed. Market cap arrives
      // as a display string ("$1.2T") → parse it back to a number; next earnings sorts
      // by calendar date; rating is already numeric.
      // N-day performance columns sort off the perf batch.
      if (PERF_COL_KEYS.has(key)) return perfData?.[s]?.[PERF_KEY_MAP[key]] ?? null
      const m = metaData?.[s]
      if (key === 'mcap') return parseMcap(m?.market_cap)
      if (key === 'earn') return earnSortValue(m?.next_earnings)
      if (key === 'rating') return Number.isFinite(Number(m?.composite)) ? Number(m.composite) : null
      return 0
    }
    // Text columns sort alphabetically off the meta / theme batch.
    const textVal = (s) => {
      if (key === 'sector') return metaData?.[s]?.sector || ''
      if (key === 'industry') return metaData?.[s]?.industry || ''
      if (key === 'theme') return themeData?.[s] || ''
      return ''
    }
    // Blanks always sink to the bottom in BOTH directions (they'd otherwise lead the
    // list when sorting ascending) — same rule the per-list sort already uses.
    return [...syms].sort((a, b) => {
      if (key === 'sym') return mul * String(a).localeCompare(String(b))
      if (TEXT_COLS.has(key)) {
        const sa = textVal(a), sb = textVal(b)
        if (!sa && !sb) return 0
        if (!sa) return 1
        if (!sb) return -1
        return mul * sa.localeCompare(sb)
      }
      const va = num(a), vb = num(b)
      const ba = va == null || !Number.isFinite(va)
      const bb = vb == null || !Number.isFinite(vb)
      if (ba && bb) return 0
      if (ba) return 1
      if (bb) return -1
      return mul * (va - vb)
    })
  }, [colSort, sortBasis, prices, metaData, perfData, themeData])

  // Column header. Labels click to sort / right-click to hide-show. Gridlines are
  // SEPARATE draggable dividers overlaid on the header (positioned at each column
  // boundary), so dragging a gridline only resizes — never sorts/selects a column.
  // Positions come from renderedColWidths (the SCALED widths the grid actually paints),
  // so a divider sits exactly on its gridline at any widget width / column count.
  const _gridDividers = (() => {
    let acc = 8  // header padding-left
    return orderedKeys.map((key, i) => { acc += renderedColWidths[i] ?? colWidth(key); return { key, x: acc } })
  })()
  const headerDragProps = (key) => ({
    draggable: true,
    onDragStart: (e) => { e.dataTransfer.effectAllowed = 'move'; dragColRef.current = key },
    onDragOver: (e) => { e.preventDefault() },
    onDrop: (e) => { e.preventDefault(); moveColumn(dragColRef.current, key); dragColRef.current = null },
    onDragEnd: () => { dragColRef.current = null },
  })
  const labelFor = (key) => {
    const [full, abbr] = COL_LABELS[key] || [key, key]
    return colWidth(key) >= (COL_FULL_MINW[key] ?? 0) ? full : abbr
  }
  const renderHeaderCell = (key) => {
    if (key === 'flag') return (
      <span key="flag" className={styles.hFlag} {...headerDragProps('flag')} />
    )
    const active = colSort?.key === key
    const label = labelFor(key)
    return (
      <span
        key={key}
        className={`${key === 'sym' ? styles.hSym : styles.hCol}${active ? ' ' + styles.hSortActive : ''}`}
        onClick={() => handleColSort(key)}
        {...headerDragProps(key)}
      >{label}</span>
    )
  }
  const columnHeader = (
    <div className={styles.gridHead} onContextMenu={e => { e.preventDefault(); setColMenu({ x: e.clientX, y: e.clientY }) }}>
      {orderedKeys.map(renderHeaderCell)}
      {_gridDividers.map(d => (
        <i
          key={`div-${d.key}`}
          className={styles.gridDivider}
          style={{ left: `${d.x}px` }}
          onMouseDown={e => startColResize(e, d.key)}
          title="Drag to resize column"
        />
      ))}
    </div>
  )

  // ── Stable per-row callbacks (see WatchRow). Each is referentially stable across
  // selection-change re-renders so React.memo keeps the untouched rows from re-rendering.
  // Handlers that read mutable render state reach it through a ref, so the callback identity
  // never changes even as the underlying value does. ──
  const rowStateRef = useRef({})
  rowStateRef.current = { setHubSym, toggleFlag, toggleNote, hasAlert, handleRemoveItem, setCtxMenu, myLists, communityLists }
  const onRowSelect = useCallback((sym) => { setSelectedSym(sym); rowStateRef.current.setHubSym(sym) }, [])
  const onRowFlag = useCallback((sym) => rowStateRef.current.toggleFlag(sym), [])
  const onRowIntent = useCallback((sym) => prefetchBarOnIntent(sym, 'D'), [])
  const onRowNote = useCallback((itemId, notes) => rowStateRef.current.toggleNote(itemId, notes), [])
  const onRowAlert = useCallback((sym, e) => { setAlertPopover({ sym, x: e.clientX, y: e.clientY }); setAlertPrice(''); setAlertDir('above') }, [])
  const onRowCtx = useCallback((e, sym, wlId, isOwner) => {
    e.preventDefault(); e.stopPropagation()
    const wl = (rowStateRef.current.myLists || []).find(l => l.id === wlId)
      || (rowStateRef.current.communityLists || []).find(l => l.id === wlId)
    rowStateRef.current.setCtxMenu({ x: e.clientX, y: e.clientY, id: wlId, isOwner, symbols: (wl?.items || []).map(i => i.sym), sym })
  }, [])
  const onRowRemove = useCallback((e, wlId, itemId) => { e.stopPropagation(); rowStateRef.current.handleRemoveItem(wlId, itemId) }, [])

  // Thin wrapper: compute this row's primitive props + hand it the stable callbacks.
  // `wlId` (owner watchlist rows only) enables the right-click context menu + remove button.
  function renderTickerRow({ sym, name = null, isOwner = false, itemId = null, notes = null, wlId = null }) {
    const q = prices[sym]
    return (
      <WatchRow
        key={sym}
        sym={sym}
        name={name}
        price={q?.price ?? null}
        changePct={q?.change_pct ?? null}
        volume={q?.volume ?? null}
        dchg={colDerived.dchg(q)}
        fromOpen={colDerived.fromopen(q)}
        fromHigh={colDerived.fromhigh(q)}
        fromLow={colDerived.fromlow(q)}
        dcr={colDerived.dcr(q)}
        sector={metaData[sym]?.sector ?? null}
        industry={metaData[sym]?.industry ?? null}
        theme={themeData[sym] ?? null}
        perf5d={perfData[sym]?.['5d'] ?? null}
        perf30d={perfData[sym]?.['30d'] ?? null}
        perf60d={perfData[sym]?.['60d'] ?? null}
        perf90d={perfData[sym]?.['90d'] ?? null}
        flagged={isFlagged(sym)}
        selected={selectedSym === sym}
        orderedKeys={orderedKeys}
        showLogos={wlSettings.showLogos}
        tintEnabled={wlSettings.tintEnabled}
        logoSize={rowLogoSize}
        mcap={metaData[sym]?.market_cap ?? null}
        earn={metaData[sym]?.next_earnings ?? null}
        rating={metaData[sym]?.composite ?? null}
        isOwner={isOwner}
        itemId={itemId}
        notes={notes}
        wlId={wlId}
        noteOpen={isOwner && expandedNote === itemId}
        alertOn={isOwner && hasAlert(sym)}
        onSelect={onRowSelect}
        onToggleFlag={onRowFlag}
        onIntent={onRowIntent}
        onToggleNote={onRowNote}
        onSetAlert={onRowAlert}
        onCtx={onRowCtx}
        onRemove={isOwner ? onRowRemove : null}
      />
    )
  }

  // ── Render a watchlist accordion group ──
  function renderWatchlistGroup(wl, isOwner) {
    const open = expandedLists.has(wl.id)
    const items = wl.items || []
    return (
      <div key={wl.id} className={styles.wlGroup}>
        <div className={styles.wlHeader} onClick={() => toggleList(wl.id)}>
          <span className={styles.wlCaret}>{open ? '▾' : '▸'}</span>
          {renamingId === wl.id ? (
            <input
              className={styles.renameInput}
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleRename(wl.id, renameValue)
                if (e.key === 'Escape') setRenamingId(null)
              }}
              onBlur={() => handleRename(wl.id, renameValue)}
              onClick={e => e.stopPropagation()}
              autoFocus
              maxLength={60}
            />
          ) : (
            <span
              className={styles.wlName}
              onContextMenu={e => handleContextMenu(e, wl.id, isOwner, items.map(i => i.sym))}
              {...longPressMenu(e => ({ x: Math.min(e.clientX, window.innerWidth - 220), y: Math.min(e.clientY, window.innerHeight - 300), id: wl.id, isOwner, symbols: items.map(i => i.sym) }))}
            >{wl.name}</span>
          )}
          <span className={styles.wlCount}>{items.length}</span>
          {wl.is_public && <span className={styles.pubBadge}>PUB</span>}
          {!isOwner && wl.owner_name && (
            <span className={styles.ownerTag}>{wl.owner_name}</span>
          )}
          {isOwner && (
            <div className={styles.wlActions} onClick={e => e.stopPropagation()}>
              <button
                className={`${styles.wlActionBtn}${wl.is_public ? ' ' + styles.wlActionBtnActive : ''}`}
                onClick={() => handleTogglePublic(wl)}
                title={wl.is_public ? 'Make Private' : 'Share with community'}
              >{wl.is_public ? <UIcon name="unlock" size={13} /> : <UIcon name="lock" size={13} />}</button>
              <button
                className={`${styles.wlActionBtn} ${styles.wlDeleteBtn}`}
                onClick={() => handleDeleteList(wl.id)}
                title="Delete watchlist"
              >×</button>
            </div>
          )}
        </div>

        {open && (() => {
          let sortedItems = sortAndFilterItems(items)
          if (colSort) {
            const order = applyColSort(sortedItems.map(i => i.sym))
            sortedItems = order.map(s => sortedItems.find(i => i.sym === s)).filter(Boolean)
          }
          const dragOk = isOwner && !sortBy
          return (
          <div className={styles.wlItems}>
            {wl.description && <div className={styles.wlDesc}>{wl.description}</div>}
            {/* Old per-list filter/sort header removed — the global column header now
                drives columns + sorting so every watchlist uses the same format. */}
            {sortedItems.length === 0 && <div className={styles.wlEmpty}>{items.length === 0 ? 'No symbols yet.' : 'No matches.'}</div>}
            {sortedItems.map(item => {
              const q = prices[item.sym]
              const price = q?.price ?? null
              const changePct = q?.change_pct ?? null
              const isStarred = starred.has(`${wl.id}:${item.sym}`)
              return (
                <React.Fragment key={item.id}>
                  {renderTickerRow({
                    sym: item.sym,
                    name: item.name,
                    isOwner,
                    itemId: item.id,
                    notes: item.notes,
                    wlId: wl.id,
                  })}
                  {expandedNote === item.id && (
                    <div className={styles.noteRow}>
                      {isOwner ? (
                        <textarea
                          className={styles.noteTextarea}
                          value={noteText}
                          onChange={e => setNoteText(e.target.value)}
                          onBlur={() => saveNote(wl.id, item.id, noteText)}
                          placeholder="Add a note..."
                          rows={2}
                          onClick={e => e.stopPropagation()}
                        />
                      ) : (
                        <div className={styles.noteReadonly}>{item.notes || 'No notes'}</div>
                      )}
                    </div>
                  )}
                </React.Fragment>
            )
            })}
            {isOwner && <AddItemRow onAdd={sym => handleAddItem(wl.id, sym)} />}
          </div>
          )})()}
      </div>
    )
  }

  // ── Flagged as a pseudo-watchlist group ──
  function renderFlaggedGroup() {
    const open = expandedLists.has('flagged')
    return (
      <div className={styles.wlGroup}>
        <div className={styles.wlHeader} onClick={() => toggleList('flagged')}>
          <span className={styles.wlCaret}>{open ? '▾' : '▸'}</span>
          {renamingId === 'flagged' ? (
            <input
              className={styles.renameInput}
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { renameFlagged(renameValue); setRenamingId(null) }
                if (e.key === 'Escape') setRenamingId(null)
              }}
              onBlur={() => { renameFlagged(renameValue); setRenamingId(null) }}
              onClick={e => e.stopPropagation()}
              autoFocus
              maxLength={60}
            />
          ) : (
            <span
              className={styles.wlName}
              onContextMenu={e => handleContextMenu(e, 'flagged', true, [...flagged])}
              {...longPressMenu(e => ({ x: Math.min(e.clientX, window.innerWidth - 220), y: Math.min(e.clientY, window.innerHeight - 300), id: 'flagged', isOwner: true, symbols: [...flagged] }))}
            >{flaggedName || `Flagged (${user?.display_name || 'You'})`}</span>
          )}
          <span className={styles.wlCount}>{flagged.length}</span>
          {isShared && <span className={styles.pubBadge}>PUB</span>}
          <span className={styles.flaggedHint}>Shift+F</span>
          {user && (
            <div className={styles.wlActions} onClick={e => e.stopPropagation()}>
              <button
                className={`${styles.wlActionBtn}${isShared ? ' ' + styles.wlActionBtnActive : ''}`}
                onClick={toggleShare}
                title={isShared ? 'Make Private' : 'Share with community'}
              >{isShared ? <UIcon name="unlock" size={13} /> : <UIcon name="lock" size={13} />}</button>
            </div>
          )}
        </div>

        {open && (
          <div className={styles.wlItems}>
            {flagged.length === 0 ? (
              <div className={styles.wlEmpty}>No flagged tickers. Press <strong>Shift+F</strong> on any chart.</div>
            ) : applyColSort(flagged).map(sym => renderTickerRow({ sym }))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div ref={pageRef} className={`${styles.page} ${embedded ? styles.pageEmbedded : ''}`} style={wlStyle} onPointerDown={markActiveWidget} onFocusCapture={markActiveWidget}>
      {settingsOpen && (
        <WatchlistSettingsPanel
          settings={wlSettings}
          onChange={patchSettings}
          onReset={resetSettings}
          onClose={() => setSettingsOpen(false)}
          gearEl={settingsBtnRef.current}
          hostEl={pageRef.current}
        />
      )}

      {/* ── Left panel ── */}
      <div className={styles.leftPanel}>

        {/* Pick mode (widget scoped to one list) shows a back header instead of the
            My Lists / Community tabs. */}
        {pickList ? (
          <div className={styles.pickHeader}>
            <button className={styles.pickBackBtn} onClick={() => onExitPick?.()} title="Choose a different list">‹ Lists</button>
            <span className={styles.pickTitle}>{pickName || 'Watchlist'}</span>
            {/* ⚙ Watchlist settings (replaced the share/lock toggle here for now). */}
            <button
              ref={settingsBtnRef}
              className={`${styles.wlActionBtn}${settingsOpen ? ' ' + styles.wlActionBtnActive : ''}`}
              style={{ marginLeft: 'auto' }}
              onClick={() => setSettingsOpen(o => !o)}
              title="Watchlist settings"
            ><UIcon name="gear" size={14} /></button>
          </div>
        ) : (
          <div className={styles.tabBar}>
            <button
              className={`${styles.tabBtn}${activeTab === 'mine' ? ' ' + styles.tabBtnActive : ''}`}
              onClick={() => setActiveTab('mine')}
            >My Lists</button>
            <button
              className={`${styles.tabBtn}${activeTab === 'community' ? ' ' + styles.tabBtnActive : ''}`}
              onClick={() => setActiveTab('community')}
            >Community</button>
          </div>
        )}

        {/* Sub-header (hidden in single-list pick mode) */}
        {!pickList && (
        <div className={styles.listHeader}>
          {activeTab === 'mine' && (
            <>
              <span className={styles.listMeta}>{(myLists?.length ?? 0) + 1} lists</span>
              <div className={styles.headerActions}>
                <div className={styles.colToggleWrap}>
                  <button className={styles.colToggleBtn} onClick={() => setShowPerfCols(!showPerfCols)} title="Toggle columns"><UIcon name="gear" size={14} /></button>
                  {showPerfCols && (
                    <div className={styles.colPopover}>
                      <div className={styles.presetRow}>
                        {Object.entries(COL_PRESETS).map(([name, cols]) => (
                          <button key={name} className={styles.presetBtn} onClick={() => setVisiblePerf(new Set(cols))}>{name}</button>
                        ))}
                      </div>
                      {PERF_COLS.map(([key, label]) => (
                        <label key={key} className={styles.colCheckRow}>
                          <input type="checkbox" checked={visiblePerf.has(key)} onChange={() => togglePerfCol(key)} />
                          <span>{label}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
                <button className={styles.newListBtn} onClick={() => setShowCreate(true)}>+ New List</button>
              </div>
            </>
          )}
          {activeTab === 'community' && (
            <span className={styles.listMeta}>{communityLists?.length ?? 0} shared lists</span>
          )}
        </div>
        )}

        {/* Body */}
        <div ref={listBodyRef} className={`${styles.listBody}${pickList ? ' ' + styles.pickMode : ''}`} style={{ '--wl-grid': gridTemplate }}>

          {columnHeader}

          {/* ── My Lists tab — Flagged pinned at top + tag groups + user lists ── */}
          {activeTab === 'mine' && (
            <>
              {(!pickList || pickList === 'flagged') && renderFlaggedGroup()}
              {!pickList && TAG_COLORS.map(tc => {
                const syms = Object.entries(tags).filter(([, c]) => c === tc.key).map(([s]) => s)
                if (!syms.length) return null
                const open = expandedLists.has(`tag:${tc.key}`)
                return (
                  <div key={tc.key} className={styles.wlGroup}>
                    <div className={styles.wlHeader} onClick={() => toggleList(`tag:${tc.key}`)}>
                      <span className={styles.wlCaret}>{open ? '▾' : '▸'}</span>
                      <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: tc.hex, marginRight: 6 }} />
                      <span className={styles.wlName}>{tc.label}</span>
                      <span className={styles.wlCount}>{syms.length}</span>
                      {isColorShared(tc.key) && <span className={styles.pubBadge}>PUB</span>}
                      <div className={styles.wlActions} onClick={e => e.stopPropagation()}>
                        <button
                          className={`${styles.wlActionBtn}${isColorShared(tc.key) ? ' ' + styles.wlActionBtnActive : ''}`}
                          onClick={() => toggleShareColor(tc.key)}
                          title={isColorShared(tc.key) ? 'Make Private' : 'Share with community'}
                        >{isColorShared(tc.key) ? <UIcon name="unlock" size={13} /> : <UIcon name="lock" size={13} />}</button>
                      </div>
                    </div>
                    {open && (
                      <div className={styles.wlItems}>
                        {applyColSort(syms).map(sym => renderTickerRow({ sym }))}
                      </div>
                    )}
                  </div>
                )
              })}
              {!myLists ? (
                (!pickList || pickList.startsWith('user:')) && <div className={styles.loading}>Loading…</div>
              ) : (() => {
                const shown = pickList
                  ? myLists.filter(wl => pickList === `user:${wl.id}`)
                  : myLists
                if (!pickList && myLists.length === 0) {
                  return (
                    <div className={styles.wlEmpty} style={{ padding: '12px 8px', opacity: 0.5 }}>
                      No custom lists yet. Create one above.
                    </div>
                  )
                }
                return shown.map(wl => renderWatchlistGroup(wl, true))
              })()}
            </>
          )}

          {/* ── Community tab ── */}
          {activeTab === 'community' && (
            <>
              {/* Community tag lists */}
              {!pickList && communityTags.map((ct, i) => {
                const tagKey = `pub:${ct.user_id}:${ct.color}`
                const open = expandedLists.has(tagKey)
                const tc = TAG_BY_KEY[ct.color]
                if (!tc) return null
                return (
                  <div key={tagKey} className={styles.wlGroup}>
                    <div className={styles.wlHeader} onClick={() => toggleList(tagKey)}>
                      <span className={styles.wlCaret}>{open ? '▾' : '▸'}</span>
                      <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: tc.hex, marginRight: 6 }} />
                      <span className={styles.wlName}>{tc.label}</span>
                      <span className={styles.wlCount}>{ct.symbols.length}</span>
                      <span className={styles.ownerTag}>{ct.owner_name}</span>
                    </div>
                    {open && (
                      <div className={styles.wlItems}>
                        {applyColSort(ct.symbols).map(sym => renderTickerRow({ sym }))}
                      </div>
                    )}
                  </div>
                )
              })}
              {/* Community watchlists */}
              {!communityLists ? (
                <div className={styles.loading}>Loading…</div>
              ) : communityLists.length === 0 && communityTags.length === 0 ? (
                <div className={styles.emptyList}>
                  <div className={styles.emptyText}>No community lists shared yet.</div>
                </div>
              ) : (pickList
                  ? communityLists.filter(wl => pickList === `community:${wl.id}`)
                  : communityLists
                ).map(wl => renderWatchlistGroup(wl, false))}
            </>
          )}
        </div>
      </div>

      {/* ── Right panel: chart ── */}
      {!embedded && (
        <div className={styles.rightPanel}>
          {selectedSym ? (
            <>
              <div className={styles.chartHeader}>
                <SymbolSearch sym={selectedSym} onSymbolChange={setSelectedSym} />
                {flagToast && (
                  <span className={`${styles.flagToast} ${flagToast === 'added' ? styles.flagToastAdded : styles.flagToastRemoved}`}>
                    <UIcon name="flag" size={12} style={{verticalAlign:'-1px',marginRight:3}} />{flagToast === 'added' ? 'Flagged' : 'Removed'}
                  </span>
                )}
                <button
                  className={`${styles.flagBtn}${isFlagged(selectedSym) ? ' ' + styles.flagBtnActive : ''}`}
                  onClick={() => { const willFlag = !isFlagged(selectedSym); toggleFlag(selectedSym); setFlagToast(willFlag ? 'added' : 'removed') }}
                  title={isFlagged(selectedSym) ? 'Remove from Flagged (Shift+F)' : 'Add to Flagged (Shift+F)'}
                ><UIcon name="flag" size={13} style={{verticalAlign:'-2px',marginRight:4}} />{isFlagged(selectedSym) ? 'Flagged' : 'Flag'}</button>
                <div className={styles.chartPeriodTabs}>
                  {PERIODS.map(([p, label]) => (
                    <button
                      key={p}
                      className={`${styles.chartPeriodBtn}${chartPeriod === p ? ' ' + styles.chartPeriodBtnActive : ''}`}
                      onClick={() => setChartPeriod(p)}
                    >{label}</button>
                  ))}
                </div>
              </div>
              <StockChart sym={selectedSym} tf={chartPeriod} onSymbolChange={setSelectedSym} />
            </>
          ) : (
            <div className={styles.chartEmpty}>
              <div className={styles.chartEmptyIcon}>◳</div>
              <div className={styles.chartEmptyText}>Select a ticker to view chart</div>
            </div>
          )}
        </div>
      )}

      {/* ── Create watchlist modal ── */}
      {showCreate && (
        <div className={styles.modalBackdrop} onClick={() => setShowCreate(false)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalTitle}>New Watchlist</div>
            <form onSubmit={handleCreate}>
              <div className={styles.formGroup}>
                <span className={styles.formLabel}>Name</span>
                <input
                  className={styles.input}
                  value={createForm.name}
                  onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))}
                  required
                  autoFocus
                  placeholder="e.g. Momentum Plays"
                />
              </div>
              <div className={styles.formGroup}>
                <span className={styles.formLabel}>Description</span>
                <input
                  className={styles.input}
                  value={createForm.description}
                  onChange={e => setCreateForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Optional"
                />
              </div>
              <div className={styles.checkRow}>
                <input
                  type="checkbox"
                  id="wl-public"
                  checked={createForm.is_public}
                  onChange={e => setCreateForm(f => ({ ...f, is_public: e.target.checked }))}
                />
                <label htmlFor="wl-public" className={styles.checkLabel}>Share with community</label>
              </div>
              <div className={styles.modalActions}>
                <button type="button" className={styles.cancelBtn} onClick={() => setShowCreate(false)}>Cancel</button>
                <button type="submit" className={styles.submitBtn} disabled={saving}>
                  {saving ? 'Creating…' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Import modal ── */}
      {importListId && (
        <div className={styles.modalBackdrop} onClick={() => setImportListId(null)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalTitle}>Import Tickers</div>
            <div className={styles.formGroup}>
              <span className={styles.formLabel}>Paste tickers (comma or newline separated)</span>
              <textarea
                className={`${styles.input} ${styles.importTextarea}`}
                value={importText}
                onChange={e => setImportText(e.target.value)}
                placeholder={"AAPL, MSFT, NVDA\nor one per line"}
                rows={5}
                autoFocus
              />
            </div>
            {importText && (
              <div className={styles.importPreview}>
                {parseImportText(importText).length} tickers found
              </div>
            )}
            <div className={styles.modalActions}>
              <button type="button" className={styles.cancelBtn} onClick={() => setImportListId(null)}>Cancel</button>
              <button
                className={styles.submitBtn}
                disabled={!parseImportText(importText).length}
                onClick={handleImport}
              >Import</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Column right-click menu (hide/show columns) ── */}
      {colMenu && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 2999 }} onClick={() => setColMenu(null)} onContextMenu={e => { e.preventDefault(); setColMenu(null) }} />
          <div className={styles.colMenu} style={{ left: Math.min(colMenu.x, window.innerWidth - 170), top: Math.min(colMenu.y, window.innerHeight - 260) }}>
            <div style={{ padding: '4px 10px 6px', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.8px', color: 'var(--text-muted)' }}>Columns</div>
            {OPTIONAL_COLS.map(c => (
              <button key={c.key} type="button" className={styles.colMenuItem} onClick={() => toggleColHidden(c.key)}>
                <span className={styles.colMenuCheck}>{!colHidden[c.key] ? <UIcon name="check" size={11} /> : null}</span>
                {c.label}
              </button>
            ))}
            <div className={styles.colMenuDivider} />
            {EXTRA_COLS.map(c => (
              <button key={c.key} type="button" className={styles.colMenuItem} onClick={() => toggleExtraCol(c.key)}>
                <span className={styles.colMenuCheck}>{orderedKeys.includes(c.key) ? <UIcon name="check" size={11} /> : null}</span>
                {c.label}
              </button>
            ))}
            <div className={styles.colMenuDivider} />
            <button type="button" className={styles.colMenuItem} onClick={() => { saveColCfg({}); setColMenu(null) }}>Reset columns</button>
          </div>
        </>
      )}

      {/* ── Alert popover ── */}
      {alertPopover && (
        <div className={styles.ctxBackdrop} onClick={() => setAlertPopover(null)}>
          <div className={styles.alertPopover} style={{ top: alertPopover.y, left: alertPopover.x }} onClick={e => e.stopPropagation()}>
            <div className={styles.alertPopTitle}>Alert for {alertPopover.sym}</div>
            <div className={styles.alertForm}>
              <select className={styles.alertSelect} value={alertDir} onChange={e => setAlertDir(e.target.value)}>
                <option value="above">Above</option>
                <option value="below">Below</option>
              </select>
              <input
                className={styles.alertInput}
                type="number"
                step="0.01"
                placeholder="$0.00"
                value={alertPrice}
                onChange={e => setAlertPrice(e.target.value)}
                autoFocus
              />
              <button
                className={styles.alertSubmit}
                disabled={!alertPrice || parseFloat(alertPrice) <= 0}
                onClick={() => {
                  createAlert(alertPopover.sym, parseFloat(alertPrice), alertDir)
                  setAlertPopover(null)
                }}
              >Set</button>
            </div>
            {getAlertsForSym(alertPopover.sym).length > 0 && (
              <div className={styles.alertList}>
                {getAlertsForSym(alertPopover.sym).map(a => (
                  <div key={a.id} className={styles.alertItem}>
                    <span>{a.direction} ${a.target_price.toFixed(2)}</span>
                    <button className={styles.alertDeleteBtn} onClick={() => deleteAlert(a.id)}>×</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Context menu ── */}
      {ctxMenu && (() => {
        const ctxBody = (
          <>
            {ctxMenu.isOwner && (
              <button className={styles.ctxItem} onClick={() => {
                if (ctxMenu.id === 'flagged') {
                  setRenameValue(flaggedName || `Flagged (${user?.display_name || 'You'})`)
                } else {
                  const wl = myLists?.find(w => w.id === ctxMenu.id)
                  setRenameValue(wl?.name || '')
                }
                setRenamingId(ctxMenu.id)
                setCtxMenu(null)
              }}>Rename</button>
            )}
            <button className={styles.ctxItem} onClick={() => handleCopyList(ctxMenu.symbols)}>
              Copy list to clipboard
            </button>
            {ctxMenu.isOwner && ctxMenu.id !== 'flagged' && (
              <button className={styles.ctxItem} onClick={() => {
                const wl = myLists?.find(w => w.id === ctxMenu.id)
                if (wl) exportCSV(wl)
              }}>Export CSV</button>
            )}
            {ctxMenu.isOwner && ctxMenu.id !== 'flagged' && (
              <button className={styles.ctxItem} onClick={() => {
                setImportListId(ctxMenu.id)
                setImportText('')
                setCtxMenu(null)
              }}>Import tickers</button>
            )}
            {ctxMenu.isOwner && getStarredSyms(ctxMenu.id).length > 0 && (
              <button className={`${styles.ctxItem} ${styles.ctxItemDanger}`} onClick={() => handleRemoveStarred(ctxMenu.id)}>
                Remove starred ({getStarredSyms(ctxMenu.id).length})
              </button>
            )}
            {ctxMenu.sym && (
              <div className={styles.ctxTagSection}>
                <span className={styles.ctxTagLabel}>Tag {ctxMenu.sym}</span>
                <div className={styles.tagSwatches}>
                  {TAG_COLORS.map(tc => (
                    <button
                      key={tc.key}
                      className={`${styles.tagSwatch}${getTag(ctxMenu.sym) === tc.key ? ' ' + styles.tagSwatchActive : ''}`}
                      style={{ background: tc.hex }}
                      title={tc.label}
                      onClick={() => {
                        if (getTag(ctxMenu.sym) === tc.key) removeTag(ctxMenu.sym)
                        else setTag(ctxMenu.sym, tc.key)
                        setCtxMenu(null)
                      }}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )
        // Touch → bottom sheet with big tap targets; desktop → anchored popover.
        if (isTouch) {
          return (
            <Sheet open onClose={() => setCtxMenu(null)} variant="bottom-sheet" title={ctxMenu.sym || 'List'}>
              <div className={styles.ctxSheetBody}>{ctxBody}</div>
            </Sheet>
          )
        }
        return (
          <div className={styles.ctxBackdrop} onClick={() => setCtxMenu(null)} onContextMenu={e => { e.preventDefault(); setCtxMenu(null) }}>
            <div className={styles.ctxMenu} style={{ top: ctxMenu.y, left: ctxMenu.x }} onClick={e => e.stopPropagation()}>
              {ctxBody}
            </div>
          </div>
        )
      })()}

    </div>
  )
}


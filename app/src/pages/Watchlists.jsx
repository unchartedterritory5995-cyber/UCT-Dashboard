// app/src/pages/Watchlists.jsx
//
// ⚠️ READ BEFORE CHANGING THE LAYOUT OF THIS FILE.
//
// This component has TWO modes and only ONE of them ships:
//
//   • SCOPED (`pickList` set) — the ONLY mode users ever see. Its sole render
//     site is charts/widgets/WatchlistWidget.jsx, which ALWAYS passes
//     pickList, so the widget is pinned to exactly one list.
//   • UNSCOPED (`pickList` null) — the My Lists / Community tab bar, the
//     Flagged + colour-tag groups, the multi-list stack, the per-list "+", the
//     add bar's target picker. NONE of it can render. `/watchlists` was
//     retired into /charts by 7640ef01 (Charts Hub V2) and now LegacyRedirects;
//     no nav entry points at it. This is ~half the file.
//
// It is kept (not deleted) because deleting it is a large diff in a file the
// partner also edits — do that as its own PR when the tree is quiet, not as a
// side effect of a feature.
//
// The practical rules that follow:
//   • Per-list behaviour (add a symbol, notes, reorder) → belongs here.
//   • Anything ACROSS lists (create a list, switch lists, browse community) →
//     belongs in charts/widgets/WatchlistPicker.jsx, the "Add a Watchlist"
//     screen, which is the only surface that sees more than one list.
//   • Verify in the running app. Rendering this component in a test with props
//     you chose yourself will happily exercise code no user can reach — that
//     mistake already cost one design rework (2026-07-31).
//
import React, { useState, useEffect, useMemo, useCallback, useRef, lazy, Suspense } from 'react'
import { useVirtualizer, observeElementRect } from '@tanstack/react-virtual'

// rAF-debounced rect observer for the scan-list virtualizer. At a very narrow
// widget width (a Scanner dragged/squeezed toward its minW) the list body's
// scrollbars oscillate, and react-virtual's default ResizeObserver re-measures
// synchronously on every tick → re-render → re-measure → React #185 "Maximum
// update depth exceeded" (the /charts crash when a thin scanner was squeezed).
// Deferring each measurement to the next animation frame breaks the SYNCHRONOUS
// nesting React counts, so the loop can no longer crash the page (at worst a
// harmless one-per-frame settle). Measuring a frame late is imperceptible.
function rafObserveElementRect(instance, cb) {
  let raf = 0
  const stop = observeElementRect(instance, (rect) => {
    if (raf) cancelAnimationFrame(raf)
    raf = requestAnimationFrame(() => { raf = 0; cb(rect) })
  })
  return () => { if (raf) cancelAnimationFrame(raf); if (typeof stop === 'function') stop() }
}
import useSWR from 'swr'
import UIcon from '../components/ui/UIcon'
import CompanyLogo from '../components/CompanyLogo'
import useBreadthSymbols from '../hooks/useBreadthSymbols'
import { useFlagged } from '../hooks/useFlagged'
import { useAuth } from '../context/AuthContext'
import useRealtimePrices from '../hooks/useRealtimePrices'
import useThemeIndexQuotes, { themeIndexLabel, themeIndexKey } from '../hooks/useThemeIndexQuotes'
import useWatchlistPerformance from '../hooks/useWatchlistPerformance'
import useWatchlistMeta from '../hooks/useWatchlistMeta'
import useWatchlistThemes from '../hooks/useWatchlistThemes'
import { sendCaptureToJournal } from './journal-2-0/lib/sendToJournal'
import { useJournalToast, JournalToast } from './journal-2-0/lib/useJournalToast'
import { menuThemeVars } from '../utils/dividerColor'
import useTickerTags from '../hooks/useTickerTags'
import useWatchlistAlerts from '../hooks/useWatchlistAlerts'
import { subscribeChartReadouts, getChartReadout, hasFreshReadouts } from '../lib/chartReadoutStore'
import useTagColors from '../hooks/useTagColors'
import { prefetchBars, prefetchBarsToIDB, prefetchAllTimeframes, prefetchBarOnIntent, prefetchListAllTimeframes, warmMemFromIDB } from '../utils/prefetchBars'
import { useIsTouch } from '../hooks/useBreakpoint'
import Sheet from '../components/mobile/Sheet'
import styles from './Watchlists.module.css'
import { useChartsSym } from './charts/ChartsSymContext'
import usePreferences, { parsePref } from '../hooks/usePreferences'
import WatchlistSettingsPanel from './watchlist/WatchlistSettingsPanel'
import TickerCombobox from '../components/watchlist/TickerCombobox'
import { WATCHLIST_SETTINGS_KEY, WATCHLIST_DEFAULTS, WATCHLIST_BASE_FONT_PX, mergeWatchlistSettings, watchlistStyleVars, watchlistDefaultsForTheme } from './watchlist/watchlistSettings'
import usePlacedTheme from '../hooks/usePlacedTheme'
import { useWatchlistTemplates, WL_COLS_LS } from './watchlist/watchlistTemplates'
import { resolveCommunityPick, ALIAS_PREFIX } from './watchlist/communityPick'

// ⛔ NOT `fetch(url).then(r => r.json())` — a 402 answers JSON too, and
// its `{detail}` body is truthy, so every `!data` loading guard below is
// skipped and the consumer throws on an error object. See utils/jsonFetcher.js.
import fetcher from '../utils/jsonFetcher'
const PERF_COLS = [['1d', '1D'], ['1w', '1W'], ['1m', '1M'], ['3m', '3M'], ['ytd', 'YTD']]

// The SAME chart the /charts workspace renders — identity row, session toggle,
// market clock, timeframe bar, market-cap/earnings/UCT-rating meta, settings
// gear and drawing tools. Lazy, so none of it lands in the eager entry chunk.
const ChartPane = lazy(() => import('../components/chart/pane/ChartPane'))
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
  name: { def: 150, min: 90 },
  rvol: { def: 64, min: 46 }, ipoDate: { def: 84, min: 60 },
  mcap: { def: 82, min: 56 }, earn: { def: 92, min: 62 }, rating: { def: 78, min: 54 },
  // Intraday quote-derived columns (computed client-side from the live quote).
  dchg: { def: 70, min: 50 }, fromopen: { def: 76, min: 54 }, fromhigh: { def: 76, min: 54 },
  fromlow: { def: 76, min: 54 }, dcr: { def: 58, min: 42 }, dolvol: { def: 78, min: 54 },
  // Fundamentals text columns (from the meta batch) + N-day performance (perf batch).
  sector: { def: 116, min: 70 }, industry: { def: 136, min: 80 }, theme: { def: 124, min: 74 },
  perf5d: { def: 66, min: 48 }, perf30d: { def: 68, min: 48 }, perf60d: { def: 68, min: 48 }, perf90d: { def: 70, min: 50 },
  // Custom-Period Sort: % change over a user-picked date range (fed via perfOverride).
  periodchg: { def: 84, min: 58 },
  // Custom-Period Sort GROUP rows: how many stocks are in the theme/sector/industry.
  grpcount: { def: 60, min: 44 },
  // View Holdings (ETF): the holding's weight in the fund (fed via metaOverride).
  weight: { def: 74, min: 50 },
}
const DEFAULT_COL_ORDER = ['flag', 'sym', 'price', 'vol', 'chg']   // reorderable by dragging a header
// [full label, abbreviation] + the min column width to still show the full word.
const COL_LABELS = {
  flag: ['', ''], sym: ['Symbol', 'Sym'], name: ['Company Name', 'Name'],
  price: ['Price', 'Price'], vol: ['Volume', 'Vol'], chg: ['% Change', '% Chg'],
  rvol: ['RVOL', 'RVOL'], ipoDate: ['IPO Date', 'IPO'],
  mcap: ['Market Cap', 'Mkt Cap'], earn: ['Next Earnings', 'Earnings'], rating: ['UCT Rating', 'UCT'],
  dchg: ['$ Change', '$ Chg'], fromopen: ['% from Open', '% Open'], fromhigh: ['% from High', '% High'],
  fromlow: ['% from Low', '% Low'], dcr: ['DCR', 'DCR'], dolvol: ['Dollar Volume', '$ Vol'],
  sector: ['Sector', 'Sector'], industry: ['Industry', 'Industry'], theme: ['Theme', 'Theme'],
  perf5d: ['5-Day', '5-day'], perf30d: ['30-Day', '30-day'], perf60d: ['60-Day', '60-day'], perf90d: ['90-Day', '90-day'],
  periodchg: ['% Change', '% Chg'],
  grpcount: ['Stocks', 'Stocks'],
  weight: ['Weight %', 'Wt %'],
}
const COL_FULL_MINW = {
  sym: 62, name: 140, price: 46, vol: 60, chg: 80, rvol: 52, ipoDate: 60, mcap: 78, earn: 108, rating: 82,
  dchg: 84, fromopen: 92, fromhigh: 92, fromlow: 88, dcr: 40, dolvol: 92,
  sector: 40, industry: 40, theme: 40, perf5d: 40, perf30d: 40, perf60d: 40, perf90d: 40, periodchg: 40, grpcount: 40, weight: 56,
}
// Extra data columns the user can ADD via the + button (not shown by default).
const EXTRA_COLS = [
  { key: 'name', label: 'Company Name' },
  { key: 'rvol', label: 'RVOL' },
  { key: 'ipoDate', label: 'IPO Date' },
  { key: 'mcap', label: 'Market Cap' },
  { key: 'earn', label: 'Next Earnings' },
  { key: 'rating', label: 'UCT Rating' },
  { key: 'dchg', label: '$ Change' },
  { key: 'fromopen', label: '% from Open' },
  { key: 'fromhigh', label: '% from High' },
  { key: 'fromlow', label: '% from Low' },
  { key: 'dcr', label: 'Daily Closing Range' },
  { key: 'dolvol', label: 'Dollar Volume' },
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
const META_KEYS = new Set(['name', 'rvol', 'ipoDate', 'mcap', 'earn', 'rating', 'sector', 'industry'])
// Text columns — sorted alphabetically, not numerically.
const TEXT_COLS = new Set(['name', 'sector', 'industry', 'theme'])
// N-day performance columns → their key in perfData (from /api/watchlist-performance).
const PERF_KEY_MAP = { perf5d: '5d', perf30d: '30d', perf60d: '60d', perf90d: '90d', periodchg: 'period' }
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
  // Dollar volume: today's live price × today's cumulative volume (a $ turnover figure).
  dolvol: (q) => {
    const p = q?.price, v = q?.volume
    return (Number.isFinite(p) && Number.isFinite(v)) ? p * v : null
  },
}

// ISO date → compact M/D for the Next Earnings column.
function fmtEarn(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '')
  return m ? `${+m[2]}/${+m[3]}` : '—'
}
// Dollar volume (price × volume) → compact "$1.2B" / "$482M" / "$12K".
function fmtDolVol(v) {
  if (v == null || !Number.isFinite(v)) return '—'
  const a = Math.abs(v)
  if (a >= 1e12) return `$${(v / 1e12).toFixed(1)}T`
  if (a >= 1e9) return `$${(v / 1e9).toFixed(1)}B`
  if (a >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `$${(v / 1e3).toFixed(0)}K`
  return `$${v.toFixed(0)}`
}
// IPO / first-trade date (YYYYMMDD int, or ISO string) → compact M/D/YY.
function fmtIpo(ymd) {
  const m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(ymd == null ? '' : String(ymd))
  return m ? `${+m[2]}/${+m[3]}/${m[1].slice(2)}` : '—'
}
// IPO date sorts by calendar date — YYYYMMDD int (or ISO) → YYYYMMDD number.
function ipoSortValue(ymd) {
  const m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(ymd == null ? '' : String(ymd))
  return m ? Number(`${m[1]}${m[2]}${m[3]}`) : null
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
// WL_COLS_LS is imported from ./watchlist/watchlistTemplates (single source of truth,
// shared with the create-from-template flow in the picker).
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
//
// `flashEnabled` (the "Background tint" setting) is the master switch for ALL the
// pulse effects — the bold flash AND the tint. Off = the value simply changes with
// no visual effect at all.
const FlashCell = React.memo(function FlashCell({ value, display, className, tint = false, tintSign = null, flashEnabled = true }) {
  const [dir, setDir] = useState(null)
  const prevRef = useRef(value)
  useEffect(() => {
    const p = prevRef.current
    prevRef.current = value
    if (flashEnabled && value != null && p != null && value !== p) {
      setDir(value > p ? 'up' : 'down')
      const id = setTimeout(() => setDir(null), 480)
      return () => clearTimeout(id)
    }
    return undefined
  }, [value, flashEnabled])
  const daySign = tintSign != null ? tintSign : value
  // Tinted change columns (% Chg / % Open / etc.) carry a STEADY weight that matches
  // the other columns (Price/Volume/DCR); on a tick they flash ONLY the background
  // tint, never a bold pulse. Non-tint cells (price, volume) keep the brief bold flash.
  const flash = (flashEnabled && dir)
    ? (tint ? (daySign >= 0 ? styles.tickUp : styles.tickDown) : styles.tickFlash)
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
  sym, name, price, changePct, volume, flagged, selected, orderedKeys, brandMark = false,
  displayName = null,
  showLogos = true, tintEnabled = true, logoSize = 16, mcap = null, earn = null, rating = null,
  ipoDate = null,
  dchg = null, fromOpen = null, fromHigh = null, fromLow = null, dcr = null, dolvol = null, rvol = null,
  coName = null, sector = null, industry = null, theme = null,
  perf5d = null, perf30d = null, perf60d = null, perf90d = null, periodchg = null,
  weight = null,
  isOwner, wlId,
  onSelect, onToggleFlag, onIntent, onCtx,
  // Custom-Period Sort GROUP rows (theme/sector/industry): a group row has no logo/flag,
  // an expand caret + ellipsized name, a stock-count cell, and toggles instead of selecting.
  // Member rows (a group's stocks, shown when expanded) render as normal stock rows, indented.
  isGroup = false, expanded = false, isMember = false, grpcount = null, onToggleGroup = null,
}) {
  // Signed % cell (green/red text + day-direction tint flash) — shared by the
  // %-from-open/high/low columns so they read like the % Change column.
  const pctCell = (key, v) => (
    <FlashCell key={key} value={v} tint={tintEnabled} flashEnabled={tintEnabled}
      className={`${styles.changeCell} ${v != null ? (v >= 0 ? styles.gain : styles.loss) : ''}`}
      display={v != null ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` : '—'} />
  )
  const cellFor = (key) => {
    if (key === 'flag') {
      if (isGroup) return <span key="flag" className={styles.flagStar} style={{ pointerEvents: 'none' }} />
      return (
        <button
          key="flag"
          className={`${styles.flagStar}${flagged ? ' ' + styles.flagStarActive : ''}`}
          onClick={e => { e.stopPropagation(); onToggleFlag(sym) }}
          title={flagged ? 'Remove from Flagged' : 'Add to Flagged (Shift+F)'}
        >{flagged ? <UIcon name="star-fill" size={13} /> : <UIcon name="star" size={13} />}</button>
      )
    }
    if (key === 'sym') {
      // Group row: expand caret + ellipsized name, no company logo (a theme/sector isn't a stock).
      if (isGroup) return (
        <span key="sym" className={styles.symCell} title={sym}>
          <span className={styles.grpCaret}>{expanded ? '▾' : '▸'}</span>
          <span className={styles.grpName}>{sym}</span>
        </span>
      )
      return (
        <span key="sym" className={styles.symCell} style={isMember ? { paddingLeft: 20 } : undefined} onContextMenu={wlId ? (e => onCtx(e, sym, wlId, isOwner)) : undefined}>
          {showLogos && <span className={styles.rowLogo}><CompanyLogo sym={sym} name={name} size={logoSize} round brandMark={brandMark} /></span>}
          <span className={styles.rowSym} title={displayName ? sym : undefined}>{displayName || sym}</span>
        </span>
      )
    }
    if (key === 'price') return (
      <FlashCell key="price" value={price} className={styles.priceCell} flashEnabled={tintEnabled}
        display={price != null ? price.toFixed(2) : '—'} />
    )
    if (key === 'vol') return (
      <FlashCell key="vol" value={volume} className={styles.volCell} flashEnabled={tintEnabled} display={fmtVol(volume)} />
    )
    if (key === 'chg') return (
      <FlashCell key="chg" value={changePct} tint={tintEnabled} flashEnabled={tintEnabled}
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
      <FlashCell key="dchg" value={dchg} tint={tintEnabled} flashEnabled={tintEnabled}
        className={`${styles.changeCell} ${dchg != null ? (dchg >= 0 ? styles.gain : styles.loss) : ''}`}
        display={dchg != null ? `${dchg >= 0 ? '+' : ''}${dchg.toFixed(2)}` : '—'} />
    )
    if (key === 'fromopen') return pctCell('fromopen', fromOpen)
    if (key === 'fromhigh') return pctCell('fromhigh', fromHigh)
    if (key === 'fromlow') return pctCell('fromlow', fromLow)
    if (key === 'dcr') return (
      <span key="dcr" className={styles.metaCell}>{dcr != null ? `${dcr.toFixed(0)}%` : '—'}</span>
    )
    // Dollar volume (price × volume) — compact currency, live-updating with volume.
    if (key === 'dolvol') return (
      <FlashCell key="dolvol" value={dolvol} className={styles.metaCell} flashEnabled={tintEnabled}
        display={fmtDolVol(dolvol)} />
    )
    // Relative volume: today's live volume vs the 20-session average, as a multiple
    // (2.0x = twice the average). Value is stored ×100 (sort-compatible); shown /100.
    if (key === 'rvol') return (
      <span key="rvol" className={styles.metaCell}>{rvol != null ? `${(rvol / 100).toFixed(1)}x` : '—'}</span>
    )
    // IPO / first-trade date (compact M/D/YY).
    if (key === 'ipoDate') return <span key="ipoDate" className={styles.metaCell}>{fmtIpo(ipoDate)}</span>
    // Fundamentals text columns (left-aligned, ellipsized, full value on hover).
    if (key === 'name') return <span key="name" className={styles.textCell} title={coName || ''}>{coName || '—'}</span>
    if (key === 'sector') return <span key="sector" className={styles.textCell} title={sector || ''}>{sector || '—'}</span>
    if (key === 'industry') return <span key="industry" className={styles.textCell} title={industry || ''}>{industry || '—'}</span>
    if (key === 'theme') return <span key="theme" className={styles.textCell} title={theme || ''}>{theme || '—'}</span>
    // N-day performance columns (signed %, green/red like % Change).
    if (key === 'perf5d') return pctCell('perf5d', perf5d)
    if (key === 'perf30d') return pctCell('perf30d', perf30d)
    if (key === 'perf60d') return pctCell('perf60d', perf60d)
    if (key === 'perf90d') return pctCell('perf90d', perf90d)
    if (key === 'periodchg') return pctCell('periodchg', periodchg)
    // Stock-count of a theme/sector/industry (group rows only; blank for stocks).
    if (key === 'grpcount') return <span key="grpcount" className={styles.metaCell}>{grpcount != null ? grpcount : ''}</span>
    // ETF holding weight % (View Holdings panel; fed via metaOverride).
    if (key === 'weight') return <span key="weight" className={styles.metaCell}>{weight != null ? `${weight.toFixed(2)}%` : '—'}</span>
    return null
  }
  return (
    <div
      data-watch-sym={sym}
      className={`${styles.listRow} ${styles.wlRow}${selected ? ' ' + styles.listRowSelected : ''}`}
      onClick={() => (isGroup ? onToggleGroup?.(sym) : onSelect(sym))}
      onPointerEnter={() => (isGroup ? undefined : onIntent(sym))}
      onFocus={() => (isGroup ? undefined : onIntent(sym))}
    >
      {orderedKeys.map(cellFor)}
    </div>
  )
})

// Virtualized row list for SCAN mode (read-only lists that can be thousands of rows, e.g.
// Custom-Period Sort's whole-market ranking). Renders only the visible window inside the
// shared `.listBody` scroll container (the sticky column header sits above it), and reports
// the visible symbols up so ONLY those get live-streamed — the whole point that lets a
// ~5,000-row scan render without opening ~100 SSE streams or mounting 5,000 DOM rows.
function ScanRows({ scrollRef, items, renderRow, emptyText, onVisibleChange, scrollToSym, noScrollRef }) {
  const virt = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 30,
    overscan: 12,
    // See rafObserveElementRect above — prevents the narrow-width #185 crash.
    observeElementRect: rafObserveElementRect,
  })
  const vItems = virt.getVirtualItems()
  const first = vItems.length ? vItems[0].index : 0
  const last = vItems.length ? vItems[vItems.length - 1].index : -1
  useEffect(() => {
    if (!onVisibleChange) return
    const syms = []
    // Group rows (theme/sector/industry names) have no live data — only stream real stocks.
    for (let i = first; i <= last && i < items.length; i++) { const it = items[i]; if (it?.sym && !it.isGroup) syms.push(it.sym) }
    onVisibleChange(syms)
  }, [first, last, items, onVisibleChange])
  // Scroll a searched/selected symbol INTO VIEW — ONCE, on first search. DOM querySelector
  // can't find a virtualized row that isn't rendered yet, so drive the virtualizer by index.
  // Guarded by scrolledForRef: we snap only when the target sym CHANGES (a new search), then
  // mark it done so live re-sorts / streaming `items` updates never yank the view back —
  // the user can freely scroll away. If the row isn't present yet (its group hasn't expanded),
  // we DON'T mark done, so a later `items` update (the expand) still lands the scroll once.
  const scrolledForRef = useRef(null)
  useEffect(() => {
    if (!scrollToSym) { scrolledForRef.current = null; return }
    if (scrolledForRef.current === scrollToSym) return   // already snapped to it — allow free scroll
    // A CLICK-selection (not a search): don't move the list — just mark it handled so a later
    // search of a different ticker still snaps. Only an external search scrolls the list.
    if (noScrollRef?.current === scrollToSym) { scrolledForRef.current = scrollToSym; noScrollRef.current = null; return }
    const idx = items.findIndex((it) => it?.sym === scrollToSym && !it.isGroup)
    if (idx < 0) return                                  // row not rendered yet — retry on next items change
    try { virt.scrollToIndex(idx, { align: 'center' }) } catch { /* mid-mount */ }
    scrolledForRef.current = scrollToSym
  }, [scrollToSym, items]) // eslint-disable-line react-hooks/exhaustive-deps
  if (items.length === 0) return <div className={styles.wlEmpty}>{emptyText}</div>
  return (
    <div className={styles.wlItems} style={{ height: virt.getTotalSize(), position: 'relative', width: '100%' }}>
      {vItems.map((vi) => {
        const item = items[vi.index]
        return (
          <div
            key={item.id || item.sym}
            data-index={vi.index}
            ref={virt.measureElement}
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vi.start}px)` }}
          >
            {renderRow(item)}
          </div>
        )
      })}
    </div>
  )
}

// NOTE: adding a symbol is a single predictive `TickerCombobox` inline row, opened
// from a "+" button: the per-list "+" in each list header (standalone page) and the
// "+" beside the ⚙ gear (single-list widget / pick mode). Community lists show no "+"
// — they aren't yours to write to.

export default function Watchlists({ embedded = false, pickList = null, pickName = null, onExitPick = null, activeRef = null, widgetKey = null, settingsOverride = null, onSettingsPersist = null, scanSymbols = null, backLabel = null, colStorageKey = null, scanEmptyText = null, defaultColCfg = null, metaOverride = null, perfOverride = null, scanFooter = null, scanCriteria = null, ephemeralCols = false, scanGroups = null, onScanVisibleSyms = null }) {
  // Column layout persists in localStorage. The watchlist widgets all share the
  // global key; the scanner passes its OWN key so its columns are independent.
  const _colKey = colStorageKey || WL_COLS_LS
  // SCANNER mode: render an externally-supplied symbol list (from a scan) as a
  // READ-ONLY single list — the full table (columns, resize-drag, right-click column
  // menu, sort, flag-star, live prices) but no add/remove/reorder/notes (membership
  // comes from the scan). Callers pass pickList="__scan__" + scanSymbols=[...].
  const scanMode = Array.isArray(scanSymbols)
  // Group mode (Custom-Period Sort by theme/sector/industry): scan rows ARE groups; each can
  // expand inline to its member stocks (like Theme Tracker). scanGroups maps name → members[].
  const groupMode = scanMode && scanGroups && typeof scanGroups === 'object'
  const [expandedGroups, setExpandedGroups] = useState(() => new Set())
  // Accordion: only ONE group's stocks are open at a time — clicking a new group
  // closes whichever was open (clicking the open group collapses it).
  const toggleGroupExpand = useCallback((name) => {
    setExpandedGroups(prev => (prev.has(name) ? new Set() : new Set([name])))
  }, [])
  const scanWl = useMemo(
    () => (scanMode
      ? { id: '__scan__', name: pickName || 'Scan',
          items: scanSymbols.map(s => ({ id: `__scan__:${s}`, sym: String(s).toUpperCase() })) }
      : null),
    [scanMode, scanSymbols, pickName],
  )
  // This widget is "active" (owns arrow keys + its own scroll) when hovered/focused.
  const isActiveWidget = () => !activeRef || activeRef.current == null || activeRef.current === widgetKey
  const markActiveWidget = () => { if (activeRef && widgetKey) activeRef.current = widgetKey }

  // ── Watchlist appearance settings (⚙ panel) ────────────────────────────────
  const { prefs, setPref } = usePreferences()
  // In the /charts workspace, each watchlist WIDGET owns its own appearance
  // settings (passed as settingsOverride + onSettingsPersist), so changing one
  // widget's canvas/colors never touches another. Absent (the standalone page)
  // → the shared global `watchlist_settings` pref, exactly as before. A widget
  // that hasn't diverged yet inherits the global blob as its seed.
  // An uncustomized watchlist uses the DEFAULTS FOR THE CURRENT APP THEME (light →
  // white canvas + dark text), so the ⚙ swatches and the surface both follow the
  // site theme. In WIDGET context (onSettingsPersist set) the legacy GLOBAL pref is
  // ignored — exactly like News/Profile — so a stale saved dark blob can't force the
  // widget dark on the light theme; the standalone page still reads the global.
  const placedTheme = usePlacedTheme()
  const wlSettings = useMemo(() => {
    const themeDefault = watchlistDefaultsForTheme(placedTheme)
    const base = settingsOverride
      ?? (onSettingsPersist ? themeDefault : (parsePref(prefs?.[WATCHLIST_SETTINGS_KEY], null) ?? themeDefault))
    return mergeWatchlistSettings(base)
  }, [settingsOverride, onSettingsPersist, prefs, placedTheme])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsBtnRef = useRef(null)
  const [filterOpen, setFilterOpen] = useState(false)   // scanner "criteria" popover
  const filterWrapRef = useRef(null)
  useEffect(() => {
    if (!filterOpen) return
    const onDown = (e) => { if (filterWrapRef.current && !filterWrapRef.current.contains(e.target)) setFilterOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setFilterOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [filterOpen])
  const patchSettings = useCallback((patch) => {
    const next = { ...wlSettings, ...patch }
    if (onSettingsPersist) onSettingsPersist(next)
    else setPref(WATCHLIST_SETTINGS_KEY, JSON.stringify(next))
  }, [wlSettings, setPref, onSettingsPersist])
  const resetSettings = useCallback(() => {
    // Clear back to the theme-following default (null override for a widget; the
    // theme default blob for the standalone page).
    if (onSettingsPersist) onSettingsPersist(null)
    else setPref(WATCHLIST_SETTINGS_KEY, JSON.stringify(watchlistDefaultsForTheme(placedTheme)))
  }, [setPref, onSettingsPersist, prefs])
  const wlStyle = useMemo(() => watchlistStyleVars(wlSettings), [wlSettings])
  // Canvas-matched palette for the Watchlist Settings panel (light/gold on a light
  // canvas, dark on a dark one) — same mechanism as the chart popup menus.
  const wlMenuVars = useMemo(() => {
    const canvas = wlSettings.bgMode === 'gradient' ? (wlSettings.bgGradient?.top || wlSettings.bg) : wlSettings.bg
    return menuThemeVars(canvas) || {}
  }, [wlSettings])
  // CompanyLogo sizes itself with an inline px style, so the text-size scale has to be
  // applied in JS for the logo (the CSS var handles everything else).
  const rowLogoSize = useMemo(() => {
    const px = Number(wlSettings.fontSize)
    const scale = px > 0 ? px / WATCHLIST_BASE_FONT_PX : 1
    return Math.round(16 * scale)
  }, [wlSettings.fontSize])

  const [activeTab, setActiveTab] = useState('mine')
  const [selectedSym, setSelectedSym] = useState(null)
  // A ticker the user CLICKED in the list (vs searched): the scan list must NOT scroll to
  // it — only the gold highlight moves. The list only snaps on an external SEARCH.
  const clickSelectRef = useRef(null)
  const { sym: hubSym, setSym: setHubSym } = useChartsSym()
  useEffect(() => {
    if (hubSym && hubSym !== selectedSym) setSelectedSym(hubSym)
  }, [hubSym]) // intentionally do NOT depend on selectedSym (avoid feedback loop)

  // Group mode: member sym → its group name (UPPERCASE, matching scanGroups keys + row syms).
  const memberToGroup = useMemo(() => {
    if (!groupMode || !scanGroups) return null
    const m = {}
    for (const [name, members] of Object.entries(scanGroups)) {
      for (const mem of (members || [])) m[String(mem).toUpperCase()] = name
    }
    return m
  }, [groupMode, scanGroups])
  const lastAutoExpandRef = useRef(null)   // auto-expand effect lives below metaData (needs it)

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
  const [addingToList, setAddingToList] = useState(null)  // list id whose inline "+" row is open
  const [addErr, setAddErr] = useState(null)              // { listId, msg } — last failed add

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
  // Prebuilt (curated UCT) lists are opened via a `community:<id>` key, but /api/watchlists/public
  // EXCLUDES is_prebuilt lists (they live in their own tab). So a picked prebuilt list must be
  // resolved against BOTH pools, or it opens with 0 items. `communityLists` still drives the
  // Community-tab listing (prebuilt stays out of there).
  const { data: prebuiltLists } = useSWR('/api/watchlists/prebuilt', fetcher, { refreshInterval: 60000 })
  const communityResolvable = useMemo(
    () => [...(communityLists || []), ...(prebuiltLists || [])],
    [communityLists, prebuiltLists],
  )
  // An ALIAS pick (community:alias:<alias>, e.g. "the latest Sunday Scans issue") names
  // no id up front — it resolves to whichever row carries the alias once the pools load.
  // Expand THAT list's group when it does; the first-paint effect above only knows ids.
  useEffect(() => {
    if (!pickList || !pickList.startsWith(ALIAS_PREFIX)) return
    const wl = resolveCommunityPick(communityResolvable, pickList)
    if (!wl) return
    setExpandedLists(prev => {
      if (prev.has(wl.id)) return prev
      const n = new Set(prev)
      n.add(wl.id)
      return n
    })
  }, [pickList, communityResolvable])
  const { tagColors: TAG_COLORS, tagByKey: TAG_BY_KEY } = useTagColors()
  const { tags, setTag, removeTag, getTag, isColorShared, toggleShareColor, communityTags } = useTickerTags()
  const { createAlert, deleteAlert, getAlertsForSym } = useWatchlistAlerts()
  const [alertPopover, setAlertPopover] = useState(null) // { sym, x, y }
  const [alertPrice, setAlertPrice] = useState('')
  const [alertDir, setAlertDir] = useState('above')

  // In scan mode, only the symbols in the virtualized visible window are live-streamed
  // (a ~5,000-row scan can't stream every row). The ScanRows virtualizer reports them here.
  const [scanVisibleSyms, setScanVisibleSyms] = useState([])
  // Report the visible scan window to the caller too (e.g. Custom-Period Sort warms
  // the deep chart history of what's on-screen as you scroll), then update local state.
  const handleScanVisible = useCallback((syms) => {
    onScanVisibleSyms?.(syms)
    setScanVisibleSyms(syms)
  }, [onScanVisibleSyms])
  // Collect all visible tickers for live prices
  const allTickers = useMemo(() => {
    const tickers = []
    if (scanMode) {
      const all = scanWl?.items || []
      // A whole-market scan (e.g. Custom-Period Sort, ~5,000 rows) streams ONLY the
      // visible window — streaming every row would open ~100 SSE connections. Small
      // scans (top-gainers/volume, a few hundred) still stream every row so their
      // data-dependent sorts (RVOL/meta, which need all rows) rank correctly.
      if (all.length > 800) return scanVisibleSyms
      all.forEach(i => { if (i.sym) tickers.push(i.sym) })
      return tickers
    }
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
    // communityResolvable (not communityLists) so a picked PREBUILT list's symbols are
    // collected for the live-price/meta fetch — /api/watchlists/public excludes prebuilt,
    // so without this the prebuilt list's rows show "—" for every data column.
    const lists = activeTab === 'mine' ? myLists : communityResolvable
    if (lists) {
      lists
        .filter(wl => expandedLists.has(wl.id))
        .forEach(wl => (wl.items || []).forEach(i => { if (i.sym) tickers.push(i.sym) }))
    }
    return tickers
  }, [activeTab, flagged, tags, myLists, communityResolvable, expandedLists, scanMode, scanWl, scanVisibleSyms])

  const { prices: feedPrices } = useRealtimePrices(allTickers)
  // Thematic-index rows ("$IDX:<slug>", the "UCT Thematic Indexes" prebuilt list)
  // have no Massive feed — their live daily % comes from the theme-performance
  // snapshot via a batch endpoint, fetched only when such rows are on screen.
  const hasIdxRows = useMemo(() => allTickers.some(s => typeof s === 'string' && s.startsWith('$IDX:')), [allTickers])
  const { quotes: idxQuotes } = useThemeIndexQuotes(hasIdxRows)
  // Mirror the chart: when a StockChart of the same ticker is open, its published
  // readout (the EXACT price/volume/%chg its legend + "Pre" tag + volume pane
  // show) overrides the watchlist's own polling feed, so the two never disagree.
  // Throttled to ~1/s (charts publish every 500ms) to match the live cadence
  // without extra re-render churn; non-charted rows keep the feed untouched.
  const [readoutTick, setReadoutTick] = useState(0)
  const readoutThrottleRef = useRef(0)
  useEffect(() => subscribeChartReadouts(() => {
    const now = Date.now()
    if (now - readoutThrottleRef.current >= 900) {
      readoutThrottleRef.current = now
      setReadoutTick(t => t + 1)
    }
  }), [])
  const prices = useMemo(() => {
    void readoutTick   // recompute when a fresh readout arrives
    if (!hasFreshReadouts()) return feedPrices
    const merged = { ...feedPrices }
    for (const sym of Object.keys(merged)) {
      const r = getChartReadout(sym)
      if (!r) continue
      merged[sym] = {
        ...merged[sym],
        ...(r.price != null ? { price: r.price } : {}),
        ...(r.volume != null ? { volume: r.volume } : {}),
        ...(r.changePct != null ? { change_pct: r.changePct } : {}),
      }
    }
    return merged
  }, [feedPrices, readoutTick])
  // ── Send a LIST to the Journal (page-seam capture door — panel batch 3).
  // The widget has no chrome of its own (it IS this page), so the door lives
  // on each accordion header. Payload freeze (owner-approved): {sym, note,
  // price, chgPct} rows as they stand — lists mutate and delete, so the
  // capture is the only durable record. Rendered read-only by FrozenList.
  const [journalMsg, setJournalMsg] = useJournalToast()
  const sendListToJournal = useCallback(async (watchKey, watchName, items) => {
    setJournalMsg('sending…')
    const rows = items.map((it) => {
      const sym = typeof it === 'string' ? it : it.sym
      const q = prices[sym]
      return {
        sym,
        ...(typeof it === 'object' && it.notes ? { note: it.notes } : {}),
        ...(Number.isFinite(q?.price) ? { price: q.price } : {}),
        ...(Number.isFinite(q?.change_pct) ? { chgPct: q.change_pct } : {}),
      }
    })
    setJournalMsg(await sendCaptureToJournal('watchlist', {
      watchKey, watchName, symbols: rows.map((r) => r.sym), rows,
    }, { label: watchName }))
  }, [prices, setJournalMsg])

  // UCT breadth pseudo-tickers (UCTA50 etc.) render the compass brand mark instead of
  // a company logo/monogram — they have no company logo.
  const breadth = useBreadthSymbols()
  // Column config (persisted per-user in localStorage) — declared HERE, above the
  // perf/theme fetches, so those can gate on which columns are shown.
  const [colCfg, setColCfg] = useState(() => {
    // ephemeralCols (Custom-Period Sort): ALWAYS start from the caller's default columns,
    // never a saved layout — every run shows the same column view.
    if (ephemeralCols) return defaultColCfg || {}
    // Saved config wins; otherwise the caller's default (the scanner seeds RVOL on +
    // RVOL-sorted). Once the user edits columns, saveColCfg persists over this.
    try { const s = JSON.parse(localStorage.getItem(_colKey)); if (s && typeof s === 'object') return s } catch { /* ignore */ }
    return defaultColCfg || {}
  })
  const _colKeys = Array.isArray(colCfg.order) ? colCfg.order : []
  // Perf batch: fetched when a legacy perf pill OR an N-day column is active. `periodchg`
  // is excluded — its value always arrives via perfOverride (the period scan), never the
  // /api/watchlist-performance endpoint, so it must not fire a 5,000-ticker perf fetch.
  const { perfData: rawPerfData } = useWatchlistPerformance(
    (visiblePerf.size > 0 || _colKeys.some(k => PERF_COL_KEYS.has(k) && k !== 'periodchg')) ? allTickers : [],
  )
  // Scan-provided N-day returns (the gainers scans already compute the ranking metric +
  // its reference close for EVERY result) merge over the perf batch — which is capped at
  // 100 tickers and can time out on a big list, blanking the back half. The override
  // guarantees every scan row has a value AND (via the ref close) keeps it live vs price.
  const perfData = useMemo(() => {
    if (!perfOverride) return rawPerfData
    const merged = { ...rawPerfData }
    for (const s in perfOverride) {
      const ov = perfOverride[s], base = merged[s] || {}
      merged[s] = { ...base, ...ov, refs: { ...(base.refs || {}), ...(ov.refs || {}) } }
    }
    return merged
  }, [rawPerfData, perfOverride])
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
    // User / community watchlists (whichever tab is active). communityResolvable includes
    // prebuilt lists so arrow-key nav works on a picked prebuilt list too.
    const lists = activeTab === 'mine' ? myLists : communityResolvable
    if (lists) {
      lists.filter(wl => expandedLists.has(wl.id)).forEach(wl => {
        (wl.items || []).forEach(i => push(i.sym))
      })
    }
    return out
  }, [activeTab, expandedLists, flagged, tags, TAG_COLORS, myLists, communityResolvable])

  // Keyboard nav: arrow up/down moves through every expanded list.
  const handleKeyDown = useCallback((e) => {
    // Don't hijack arrows while user is typing in an input/textarea/contenteditable
    const tgt = e.target
    if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) return
    // Only the ACTIVE watchlist widget handles arrows — otherwise all 4 widgets race
    // over one keypress (first-mounted wins) and navigate the wrong list.
    if (activeRef && activeRef.current != null && activeRef.current !== widgetKey) return

    // Space advances like ArrowDown (next ticker). Never steal it from a control
    // that uses Space (button/link/select); text inputs are already excluded above.
    const navSpace = e.key === ' ' || e.key === 'Spacebar'
    if (navSpace) {
      const t = tgt?.tagName
      if (t === 'BUTTON' || t === 'A' || t === 'SELECT' || tgt?.getAttribute?.('role') === 'button') return
    }
    const navDown = e.key === 'ArrowDown' || navSpace
    if (navDown || e.key === 'ArrowUp') {
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
        next = navDown ? 0 : len - 1
      } else {
        // WRAP at the ends: off the bottom → top, off the top → bottom.
        next = navDown ? (idx + 1) % len : (idx - 1 + len) % len
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

  // Same-frame scan paint: promote the ±6 arrow-nav neighbors' cached bars from
  // IndexedDB into the synchronous mem cache (zero network) so the NEXT press
  // paints on the first render via StockChart's memPeek fallback, instead of
  // paying the async idbGet hop (the perceptible "pop" delay while scanning).
  // Neighbors come from the DOM order (same derivation as the keydown handler)
  // so this matches the on-screen rows under any active column sort; wrap-aware
  // to mirror the nav's end-of-list wrap. memHas-skip inside warmMemFromIDB
  // makes repeat presses ~free (only the new frontier ticker reads IDB).
  useEffect(() => {
    if (!selectedSym) return
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
    const idx = flat.indexOf(selectedSym)
    if (idx < 0 || flat.length < 2) return
    const len = flat.length
    const around = new Set()
    for (let d = 1; d <= 6; d++) {
      around.add(flat[(idx + d) % len])
      around.add(flat[(idx - d + len) % len])
    }
    around.delete(selectedSym)
    warmMemFromIDB([...around])
  }, [selectedSym, visibleSymsFlat])

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

  // Admin-only: publish/unpublish a list to the picker's Prebuilt (curated UCT) tab.
  async function handleTogglePrebuilt(wl) {
    await fetch(`/api/watchlists/${wl.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_prebuilt: !wl.is_prebuilt }),
    })
    mutateMine()
    mutateCommunity()
  }

  // Returns the created/existing item so callers can tell an add from a no-op
  // re-add (the server dedupes per (list, sym) and flags it with `duplicate`).
  // 'flagged' is not a real watchlist row — it routes through useFlagged, whose
  // `toggle` would UNflag an existing symbol, so guard on isFlagged.
  async function handleAddItem(listId, sym) {
    const clean = String(sym || '').trim().toUpperCase()
    if (!clean) return null
    if (listId === 'flagged') {
      const already = isFlagged(clean)
      if (!already) toggleFlag(clean)
      return { sym: clean, duplicate: already }
    }
    const res = await fetch(`/api/watchlists/${listId}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sym: clean, notes: '' }),
    })
    if (!res.ok) throw new Error(`add failed: ${res.status}`)
    const item = await res.json().catch(() => null)
    mutateMine()
    return item
  }

  // `handleAddItem` THROWS on a non-ok POST. Every inline add row goes through this
  // wrapper so that throw always has a catcher and the failure is spoken out loud —
  // the pinned AddSymbolBar used to own that job (try/catch → aria-live "Could not
  // add NVDA"), and it was deleted without the duty being handed over. Without this,
  // a 500 is an unhandled rejection: the combobox clears, the ticker never appears,
  // and nothing on screen ever says why.
  async function addSymbolTo(listId, sym) {
    const clean = String(sym || '').trim().toUpperCase()
    setAddErr(null)
    try {
      return await handleAddItem(listId, clean)
    } catch {
      setAddErr({ listId, msg: `Could not add ${clean}` })
      return null
    }
  }

  async function handleRemoveItem(listId, itemId) {
    await fetch(`/api/watchlists/${listId}/items/${itemId}`, { method: 'DELETE' })
    mutateMine()
  }

  // Remove a symbol from a list BY TICKER (the right-click "Remove from watchlist"
  // path, which only has the sym). Flagged → unflag; a real list → look up the item
  // id then delete. Never touches community lists (guarded at the call site).
  async function handleRemoveSym(listId, sym) {
    const clean = String(sym || '').trim().toUpperCase()
    if (!clean) return
    if (listId === 'flagged') {
      if (isFlagged(clean)) toggleFlag(clean)
      return
    }
    const wl = (myLists || []).find(w => w.id === listId)
    const item = (wl?.items || []).find(i => String(i.sym).toUpperCase() === clean)
    if (item) await handleRemoveItem(listId, item.id)
  }

  // Open (or re-close) the per-symbol note editor BY TICKER — same shape as
  // `handleRemoveSym`, because the row menu only ever carries the sym. A note is a
  // column on a watchlist ITEM, so Flagged — which isn't a real list — has none.
  // Community rows never open a row menu at all, which is what keeps a shared
  // list's notes read-only (the note row's own `isOwner` branch is the backstop).
  function toggleNoteSym(listId, sym) {
    const clean = String(sym || '').trim().toUpperCase()
    if (!clean || listId === 'flagged') return
    const wl = (myLists || []).find(w => w.id === listId)
    const item = (wl?.items || []).find(i => String(i.sym).toUpperCase() === clean)
    if (item) toggleNote(item.id, item.notes)
  }

  const currentLists = activeTab === 'mine' ? myLists : communityLists

  // ── Configurable + sortable columns ── (colCfg STATE is declared earlier, above
  // the meta/perf/theme fetches, so those fetches can gate on which columns show.)
  const saveColCfg = useCallback((next) => {
    setColCfg(next)
    // ephemeralCols: in-session edits still apply, but nothing persists (so the next run
    // reverts to the default column view).
    if (ephemeralCols) return
    try { localStorage.setItem(_colKey, JSON.stringify(next)) } catch { /* ignore */ }
  }, [_colKey, ephemeralCols])
  const [liveResize, setLiveResize] = useState(null)   // {key,width} during a drag
  const [colMenu, setColMenu] = useState(null)         // {x,y} right-click menu
  const resizingRef = useRef(false)                    // suppress the header sort-click after a resize
  const dragColRef = useRef(null)                      // key of the header column being drag-reordered
  const colHidden = colCfg.hidden || {}
  const colSort = colCfg.sort || null                  // {key, dir} | null

  // ── Watchlist "look" templates (appearance + columns; NO symbols) ──
  // Managed from the ⚙ Watchlist Settings panel. Applying a template sets THIS
  // widget's appearance (patchSettings) and the shared column layout (saveColCfg);
  // saving captures the current look.
  const { templates: wlTemplates, saveTemplate: saveWlTemplate, removeTemplate: removeWlTemplate } = useWatchlistTemplates()
  // A look template applies ONLY the appearance settings (the ⚙ settings menu) — NOT the
  // column layout. Columns are per-list (e.g. Custom-Period Sort's period column must
  // survive applying a template), so a template never touches which columns show or their
  // widths. (Older templates may still carry a `cols` blob; it's deliberately ignored.)
  const applyWlTemplate = useCallback((tpl) => {
    if (tpl?.settings) patchSettings(tpl.settings)   // replaces every appearance key
  }, [patchSettings])

  // Which list this single-list widget scopes to, IF it's one the user owns
  // (community lists aren't yours to add to). Drives the header "+" add button.
  const pickOwnedId = pickList === 'flagged'
    ? 'flagged'
    : (pickList?.startsWith('user:') ? pickList.slice(5) : null)

  // Number of stocks in the picked list — shown in the widget footer (watchlist widgets).
  const pickCount = useMemo(() => {
    if (!pickList || scanMode) return 0
    if (pickList === 'flagged') return flagged.length
    if (pickList.startsWith('tag:')) {
      const color = pickList.slice(4)
      return Object.values(tags).filter(c => c === color).length
    }
    if (pickList.startsWith('user:')) {
      const wl = (myLists || []).find(w => `user:${w.id}` === pickList)
      return wl ? (wl.items || []).length : 0
    }
    if (pickList.startsWith('community:')) {
      const wl = resolveCommunityPick(communityResolvable, pickList)
      return wl ? (wl.items || []).length : 0
    }
    return 0
  }, [pickList, scanMode, flagged, tags, myLists, communityResolvable])

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
  // ⚰️ Removed a dead-state ResizeObserver here (2026-08-20). It observed the list
  // body and set a `bodyW` state that NOTHING read (shrink-to-fit was removed long
  // ago — see the note by `renderedColWidths` below). At a very narrow widget width
  // (the scanner dragged to its minW) the list body oscillates — a horizontal
  // scrollbar appears, shrinks the height, toggles the vertical scrollbar, which
  // changes the width again — firing that observer synchronously in a tight loop.
  // Setting state on every fire re-rendered Watchlists repeatedly → React #185
  // "Maximum update depth exceeded" (the crash when a thin Scanner was squeezed to
  // its minimum). With nothing consuming the measurement, the whole observer was
  // pure liability — deleted. A benign browser "ResizeObserver loop" warning may
  // still print, but it can no longer take React's render loop down with it.
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
  const { metaData: rawMetaData } = useWatchlistMeta(extraVisible ? allTickers : [])
  // Scan-provided per-symbol fields (e.g. the IPO scan's ipo_date for EVERY result,
  // beyond the meta batch's 100-ticker cap) merge over the batch meta so the column
  // + its sort see every row.
  const metaData = useMemo(() => {
    if (!metaOverride) return rawMetaData
    const merged = { ...rawMetaData }
    for (const s in metaOverride) merged[s] = { ...(merged[s] || {}), ...metaOverride[s] }
    return merged
  }, [rawMetaData, metaOverride])

  // When the linked chart's ticker belongs to one of the ranked groups, auto-OPEN that
  // group (accordion) so its row shows + the scroll-to-selected effect brings it into view.
  // PRIMARY: the backend member→group map. FALLBACK: the ticker's own industry/sector (from
  // the meta layer) matched to a group name — so a name missing from the backend member list
  // (e.g. a classification gap) still opens the right group. Fires once per selected-sym.
  useEffect(() => {
    if (!groupMode || !selectedSym || !memberToGroup) return
    if (lastAutoExpandRef.current === selectedSym) return
    const up = String(selectedSym).toUpperCase()
    let g = memberToGroup[up]
    if (!g && scanGroups) {
      const md = metaData?.[selectedSym] || metaData?.[up]
      for (const field of [md?.industry, md?.sector]) {
        if (field && scanGroups[String(field).toUpperCase()]) { g = String(field).toUpperCase(); break }
      }
    }
    if (!g) return
    lastAutoExpandRef.current = selectedSym
    setExpandedGroups(prev => {
      // A ticker can belong to SEVERAL groups (memberToGroup keeps only the last).
      // If it's already visible inside a currently-OPEN group, leave the expansion
      // as-is — clicking a member must not jump to another group it also belongs to
      // (the bug: opening MEMORY & HBM, clicking MU, and it hopping to SEMICONDUCTORS).
      for (const openName of prev) {
        if ((scanGroups?.[openName] || []).some(mem => String(mem).toUpperCase() === up)) return prev
      }
      return prev.has(g) ? prev : new Set([g])
    })
  }, [groupMode, selectedSym, memberToGroup, scanGroups, metaData])

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
      // N-day performance columns sort off the LIVE % (price vs reference close),
      // matching the displayed value; fall back to the backend's static %.
      if (PERF_COL_KEYS.has(key)) {
        const period = PERF_KEY_MAP[key]
        const ref = perfData?.[s]?.refs?.[period]
        if (Number.isFinite(ref) && ref > 0 && Number.isFinite(q?.price)) return ((q.price - ref) / ref) * 100
        return perfData?.[s]?.[period] ?? null
      }
      const m = metaData?.[s]
      if (key === 'rvol') {
        const av = m?.avg_vol_20d, v = q?.volume
        return (Number.isFinite(av) && av > 0 && Number.isFinite(v)) ? (v / av) * 100 : null
      }
      if (key === 'ipoDate') return ipoSortValue(m?.ipo_date)
      if (key === 'mcap') return parseMcap(m?.market_cap)
      if (key === 'earn') return earnSortValue(m?.next_earnings)
      if (key === 'rating') return Number.isFinite(Number(m?.composite)) ? Number(m.composite) : null
      if (key === 'weight') return Number.isFinite(m?.weight) ? m.weight : null
      return 0
    }
    // Text columns sort alphabetically off the meta / theme batch.
    const textVal = (s) => {
      if (key === 'name') return metaData?.[s]?.name || ''
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

  // Scan mode: the sorted row list, MEMOIZED so a huge (~5,000-row) scan re-sorts only
  // when the data/sort actually changes — NOT on every scroll frame (which updates
  // scanVisibleSyms → re-renders). Keyed on the sort callbacks (they already change
  // identity when prices/perfData/colSort change), so live re-sorting still works but
  // scrolling is cheap. Deliberately excludes scanVisibleSyms.
  const scanSortedItems = useMemo(() => {
    if (!scanMode) return []
    let sorted = sortAndFilterItems(scanWl.items)
    if (colSort) {
      const order = applyColSort(sorted.map(i => i.sym))
      const bySym = new Map(sorted.map(i => [i.sym, i]))   // O(n) reorder (find-in-loop is O(n²))
      sorted = order.map(s => bySym.get(s)).filter(Boolean)
    }
    if (!groupMode) return sorted
    // Group mode: flatten to [group, ...its members when expanded], members ranked by their
    // own period change (from perfData/perfOverride). The member order FOLLOWS the widget's
    // % Change sort direction — biggest-losers-first when the list is sorted losers-first —
    // so a group's stocks read the same way as the groups above them. isGroup/isMember
    // drive the row render. Missing-data members always sink to the bottom.
    const memberAsc = colSort?.key === 'periodchg' && colSort?.dir === 'asc'
    const miss = memberAsc ? 1e12 : -1e12
    const flat = []
    for (const g of sorted) {
      flat.push({ ...g, isGroup: true })
      if (expandedGroups.has(g.sym)) {
        const members = (scanGroups[g.sym] || []).slice()
        members.sort((a, b) => {
          const pa = perfData[a]?.period ?? miss, pb = perfData[b]?.period ?? miss
          return memberAsc ? (pa - pb) : (pb - pa)
        })
        for (const m of members) flat.push({ id: `${g.sym}::${m}`, sym: m, isMember: true })
      }
    }
    return flat
  }, [scanMode, scanWl, colSort, sortAndFilterItems, applyColSort, groupMode, expandedGroups, scanGroups, perfData])

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
  rowStateRef.current = { setHubSym, toggleFlag, setCtxMenu, myLists, communityLists }
  const onRowSelect = useCallback((sym) => { clickSelectRef.current = sym; setSelectedSym(sym); rowStateRef.current.setHubSym(sym) }, [])
  const onRowFlag = useCallback((sym) => rowStateRef.current.toggleFlag(sym), [])
  const onRowIntent = useCallback((sym) => prefetchBarOnIntent(sym, 'D'), [])
  const onRowCtx = useCallback((e, sym, wlId, isOwner) => {
    e.preventDefault(); e.stopPropagation()
    // Community lists aren't yours — no add/remove/notes, so no row menu at all.
    if (!isOwner) return
    rowStateRef.current.setCtxMenu({ x: e.clientX, y: e.clientY, id: wlId, isOwner, sym })
  }, [])

  // Thin wrapper: compute this row's primitive props + hand it the stable callbacks.
  // `wlId` (owner watchlist rows only) enables the right-click row menu, which is
  // where notes / price alerts / remove all live.
  function renderTickerRow({ sym, name = null, isOwner = false, wlId = null, isGroup = false, isMember = false, expanded = false }) {
    // Thematic-index row: no market feed — pull its live daily % from the batch
    // quotes map (keyed by lowercase slug), and show the theme's name instead of
    // the raw "$IDX:CYBERSECURITY" pseudo-ticker.
    const isIdx = typeof sym === 'string' && sym.startsWith('$IDX:')
    const idxq = isIdx ? idxQuotes[themeIndexKey(sym)] : null
    if (isIdx) {
      const q = { price: idxq?.price ?? null, change_pct: idxq?.change_pct ?? null, volume: null }
      const label = idxq?.name || themeIndexLabel(sym)
      return (
        <WatchRow
          key={sym} sym={sym} name={label} displayName={label} brandMark
          price={q.price} changePct={q.change_pct} volume={null}
          coName={idxq?.name ?? null}
          flagged={isFlagged(sym)} selected={selectedSym === sym} orderedKeys={orderedKeys}
          showLogos={wlSettings.showLogos} tintEnabled={wlSettings.tintEnabled} logoSize={rowLogoSize}
          isOwner={isOwner} wlId={wlId} isMember={isMember}
          onSelect={onRowSelect} onToggleFlag={onRowFlag} onIntent={onRowIntent} onCtx={onRowCtx}
        />
      )
    }
    const q = prices[sym]
    // N-day % change, computed LIVE from the current price vs the reference close N
    // trading days ago (backend `refs`), so these columns tick/flash/tint with every
    // quote update just like % Change. Falls back to the backend's static % when the
    // reference close isn't available yet.
    const perfLive = (period) => {
      const ref = perfData[sym]?.refs?.[period]
      const p = q?.price
      if (Number.isFinite(ref) && ref > 0 && Number.isFinite(p)) return ((p - ref) / ref) * 100
      return perfData[sym]?.[period] ?? null
    }
    // RVOL: today's LIVE volume vs the 20-session average (from the meta batch), as a %.
    // Live-updates because q.volume ticks; null until the average has loaded.
    const _avg20 = metaData[sym]?.avg_vol_20d
    const rvolVal = (Number.isFinite(_avg20) && _avg20 > 0 && Number.isFinite(q?.volume))
      ? (q.volume / _avg20) * 100
      : null
    return (
      <WatchRow
        key={sym}
        sym={sym}
        name={name}
        brandMark={breadth.isBreadth(sym)}
        price={q?.price ?? null}
        changePct={q?.change_pct ?? null}
        volume={q?.volume ?? null}
        dchg={colDerived.dchg(q)}
        fromOpen={colDerived.fromopen(q)}
        fromHigh={colDerived.fromhigh(q)}
        fromLow={colDerived.fromlow(q)}
        dcr={colDerived.dcr(q)}
        dolvol={colDerived.dolvol(q)}
        rvol={rvolVal}
        coName={metaData[sym]?.name ?? null}
        sector={metaData[sym]?.sector ?? null}
        industry={metaData[sym]?.industry ?? null}
        theme={themeData[sym] ?? null}
        perf5d={perfLive('5d')}
        perf30d={perfLive('30d')}
        perf60d={perfLive('60d')}
        perf90d={perfLive('90d')}
        periodchg={perfLive('period')}
        grpcount={metaData[sym]?.group_count ?? null}
        weight={metaData[sym]?.weight ?? null}
        flagged={isFlagged(sym)}
        selected={selectedSym === sym}
        orderedKeys={orderedKeys}
        showLogos={wlSettings.showLogos}
        tintEnabled={wlSettings.tintEnabled}
        logoSize={rowLogoSize}
        mcap={metaData[sym]?.market_cap ?? null}
        earn={metaData[sym]?.next_earnings ?? null}
        rating={metaData[sym]?.composite ?? null}
        ipoDate={metaData[sym]?.ipo_date ?? null}
        isOwner={isOwner}
        wlId={wlId}
        isGroup={isGroup}
        isMember={isMember}
        expanded={expanded}
        onToggleGroup={toggleGroupExpand}
        onSelect={onRowSelect}
        onToggleFlag={onRowFlag}
        onIntent={onRowIntent}
        onCtx={onRowCtx}
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
              {items.length > 0 && (
                <button
                  className={styles.wlActionBtn}
                  onClick={() => sendListToJournal(wl.id, wl.name, items)}
                  title={`Send ${wl.name} to Journal (frozen list)`}
                  aria-label={`Send ${wl.name} to Journal`}
                ><UIcon name="journal" size={13} /></button>
              )}
              {!pickList && <button
                className={`${styles.wlActionBtn}${addingToList === wl.id ? ' ' + styles.wlActionBtnActive : ''}`}
                onClick={() => {
                  setExpandedLists(prev => new Set(prev).add(wl.id))
                  setAddingToList(cur => (cur === wl.id ? null : wl.id))
                }}
                title={`Add a symbol to ${wl.name}`}
                aria-label={`Add a symbol to ${wl.name}`}
              ><UIcon name="plus" size={13} /></button>}
              {user?.role === 'admin' && (
                <button
                  className={`${styles.wlActionBtn}${wl.is_prebuilt ? ' ' + styles.wlActionBtnActive : ''}`}
                  onClick={() => handleTogglePrebuilt(wl)}
                  title={wl.is_prebuilt ? 'Unpublish from Prebuilt (UCT)' : 'Publish to Prebuilt (UCT)'}
                ><UIcon name="star" size={13} /></button>
              )}
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
            {/* Prebuilt (curated UCT) lists hide their description — the symbol list speaks
                for itself. User/community lists still show theirs. */}
            {wl.description && !wl.is_prebuilt && <div className={styles.wlDesc}>{wl.description}</div>}
            {/* Old per-list filter/sort header removed — the global column header now
                drives columns + sorting so every watchlist uses the same format. */}
            {isOwner && addingToList === wl.id && (
              <div className={styles.inlineAddRow} onClick={e => e.stopPropagation()}>
                <TickerCombobox
                  compact
                  autoFocus
                  onPick={sym => addSymbolTo(wl.id, sym)}
                  onEscape={() => setAddingToList(null)}
                  onDismiss={() => setAddingToList(null)}
                  existingSyms={new Set(items.map(i => String(i.sym).toUpperCase()))}
                  targetLabel={wl.name}
                  placeholder={`Add to ${wl.name}…`}
                />
                <button
                  className={styles.inlineAddClose}
                  onClick={() => setAddingToList(null)}
                  title="Done adding"
                  aria-label="Done adding"
                ><UIcon name="x" size={11} /></button>
                {addErr?.listId === wl.id && (
                  <span className={styles.inlineAddErr} role="status">{addErr.msg}</span>
                )}
              </div>
            )}
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
                    wlId: wl.id,
                  })}
                  {/* Note editor, opened from the row menu's "Notes" entry (and
                      closed by picking it again). Editable on YOUR lists only —
                      a shared list's notes are read-only. */}
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
            >{flaggedName || 'Flagged'}</span>
          )}
          <span className={styles.wlCount}>{flagged.length}</span>
          {isShared && <span className={styles.pubBadge}>PUB</span>}
          <span className={styles.flaggedHint}>Shift+F</span>
          {user && (
            <div className={styles.wlActions} onClick={e => e.stopPropagation()}>
              {flagged.length > 0 && (
                <button
                  className={styles.wlActionBtn}
                  onClick={() => sendListToJournal('flagged', flaggedName || 'Flagged', [...flagged])}
                  title="Send Flagged to Journal (frozen list)"
                  aria-label="Send Flagged to Journal"
                ><UIcon name="journal" size={13} /></button>
              )}
              {!pickList && <button
                className={`${styles.wlActionBtn}${addingToList === 'flagged' ? ' ' + styles.wlActionBtnActive : ''}`}
                onClick={() => {
                  setExpandedLists(prev => new Set(prev).add('flagged'))
                  setAddingToList(cur => (cur === 'flagged' ? null : 'flagged'))
                }}
                title="Add a symbol to Flagged"
                aria-label="Add a symbol to Flagged"
              ><UIcon name="plus" size={13} /></button>}
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
            {addingToList === 'flagged' && (
              <div className={styles.inlineAddRow} onClick={e => e.stopPropagation()}>
                <TickerCombobox
                  compact
                  autoFocus
                  onPick={sym => addSymbolTo('flagged', sym)}
                  onEscape={() => setAddingToList(null)}
                  onDismiss={() => setAddingToList(null)}
                  existingSyms={new Set(flagged.map(s => String(s).toUpperCase()))}
                  targetLabel="Flagged"
                  placeholder="Add to Flagged…"
                />
                <button
                  className={styles.inlineAddClose}
                  onClick={() => setAddingToList(null)}
                  title="Done adding"
                  aria-label="Done adding"
                ><UIcon name="x" size={11} /></button>
                {addErr?.listId === 'flagged' && (
                  <span className={styles.inlineAddErr} role="status">{addErr.msg}</span>
                )}
              </div>
            )}
            {flagged.length === 0 ? (
              <div className={styles.wlEmpty}>No flagged tickers. Press <strong>Shift+F</strong> on any chart.</div>
            ) : applyColSort(flagged).map(sym => renderTickerRow({ sym }))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      ref={pageRef}
      className={`${styles.page} ${embedded ? styles.pageEmbedded : ''}`}
      style={wlStyle}
      onPointerDown={markActiveWidget}
      onFocusCapture={markActiveWidget}
      // "a" opens the inline add-symbol row on the scoped list (widget pick mode).
      // Deliberately a CONTAINER handler, not a window one: it only fires when focus
      // is already inside this panel, so a second Watchlist/Chart widget on the
      // /charts workspace can never swallow it.
      onKeyDown={e => {
        if (e.key !== 'a' && e.key !== 'A') return
        if (e.metaKey || e.ctrlKey || e.altKey) return
        const t = e.target
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
        if (!pickOwnedId) return
        e.preventDefault()
        setExpandedLists(prev => new Set(prev).add(pickOwnedId))
        setAddingToList(pickOwnedId)
      }}
    >
      {/* Send-to-Journal confirmation for the list-header doors. Fixed: the
          doors live on scrolling accordion rows in both hosts (page + widget),
          so a viewport anchor is the one spot that always reads. Below the
          popup band (8500+). */}
      <JournalToast msg={journalMsg} style={{ position: 'fixed', top: 58, right: 16, zIndex: 8400 }} />
      {settingsOpen && (
        <WatchlistSettingsPanel
          settings={wlSettings}
          onChange={patchSettings}
          onReset={resetSettings}
          onClose={() => setSettingsOpen(false)}
          gearEl={settingsBtnRef.current}
          hostEl={pageRef.current}
          themeVars={wlMenuVars}
          templates={wlTemplates}
          onApplyTemplate={applyWlTemplate}
          onSaveTemplate={(name) => saveWlTemplate({ name, settings: wlSettings, cols: colCfg })}
          onDeleteTemplate={removeWlTemplate}
        />
      )}

      {/* ── Left panel ── */}
      <div className={styles.leftPanel}>

        {/* Pick mode (widget scoped to one list) shows a back header instead of the
            My Lists / Community tabs. */}
        {pickList ? (
          <div className={styles.pickHeader}>
            {/* Back-to-list-picker button only when there IS a picker to return to
                (onExitPick set). Custom-Period Sort has none, so it shows no dead button. */}
            {onExitPick && <button className={styles.pickBackBtn} onClick={() => onExitPick()} title="Choose a different list">{backLabel || '‹ Lists'}</button>}
            <span className={styles.pickTitle}>{pickName || 'Watchlist'}</span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              {/* Add a symbol — only on lists you own (community lists aren't yours).
                  Opens the same predictive inline add row used everywhere else. */}
              {pickOwnedId && (
                <button
                  className={`${styles.wlActionBtn}${addingToList === pickOwnedId ? ' ' + styles.wlActionBtnActive : ''}`}
                  onClick={() => {
                    setExpandedLists(prev => new Set(prev).add(pickOwnedId))
                    setAddingToList(cur => (cur === pickOwnedId ? null : pickOwnedId))
                  }}
                  title="Add a symbol"
                  aria-label="Add a symbol"
                ><UIcon name="plus" size={15} /></button>
              )}
              {/* Scan criteria — a read-only popover listing what the preset filters on. */}
              {scanMode && scanCriteria && scanCriteria.length > 0 && (
                <div ref={filterWrapRef} style={{ position: 'relative', display: 'flex' }}>
                  <button
                    className={`${styles.wlActionBtn}${filterOpen ? ' ' + styles.wlActionBtnActive : ''}`}
                    onClick={() => setFilterOpen(o => !o)}
                    title="Scan criteria"
                    aria-label="Scan criteria"
                  ><UIcon name="sliders" size={14} /></button>
                  {filterOpen && (
                    <div className={styles.criteriaPop} role="dialog" aria-label="Scan criteria">
                      <div className={styles.criteriaTitle}>Scan criteria</div>
                      {scanCriteria.map((c, i) => (
                        <div key={i} className={styles.criteriaItem}>
                          <span className={styles.criteriaDot}>•</span><span>{c}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {/* ⚙ Watchlist settings (canvas/colors + Templates). */}
              <button
                ref={settingsBtnRef}
                className={`${styles.wlActionBtn}${settingsOpen ? ' ' + styles.wlActionBtnActive : ''}`}
                onClick={() => setSettingsOpen(o => !o)}
                title="Watchlist settings"
              ><UIcon name="gear" size={14} /></button>
            </div>
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

          {/* ── SCANNER mode — the scan's symbols as a read-only single list ──
              Virtualized (ScanRows) so a whole-market scan (thousands of rows) renders
              only the visible window; the sticky columnHeader above stays put. */}
          {scanMode && (
            <ScanRows
              scrollRef={listBodyRef}
              items={scanSortedItems}
              renderRow={(item) => renderTickerRow({
                sym: item.sym, name: item.name, isOwner: false, wlId: null,
                isGroup: !!item.isGroup, isMember: !!item.isMember,
                expanded: item.isGroup ? expandedGroups.has(item.sym) : false,
              })}
              emptyText={scanWl.items.length === 0 ? (scanEmptyText || 'No matches yet.') : 'No matches.'}
              onVisibleChange={handleScanVisible}
              scrollToSym={selectedSym}
              noScrollRef={clickSelectRef}
            />
          )}

          {/* ── My Lists tab — Flagged pinned at top + tag groups + user lists ── */}
          {!scanMode && activeTab === 'mine' && (
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
                        {syms.length > 0 && (
                          <button
                            className={styles.wlActionBtn}
                            onClick={() => sendListToJournal(`tag:${tc.key}`, tc.label, syms)}
                            title={`Send ${tc.label} to Journal (frozen list)`}
                            aria-label={`Send ${tc.label} to Journal`}
                          ><UIcon name="journal" size={13} /></button>
                        )}
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
                    <div className={styles.noListsEmpty}>
                      <div className={styles.noListsText}>No custom lists yet.</div>
                      <button className={styles.noListsBtn} onClick={() => setShowCreate(true)}>
                        <UIcon name="plus" size={11} /> New list
                      </button>
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
              ) : communityLists.length === 0 && communityTags.length === 0 && !pickList ? (
                <div className={styles.emptyList}>
                  <div className={styles.emptyText}>No community lists shared yet.</div>
                </div>
              ) : (pickList
                  ? [resolveCommunityPick(communityResolvable, pickList)].filter(Boolean)
                  : communityLists
                ).map(wl => renderWatchlistGroup(wl, false))}
            </>
          )}
        </div>
        {/* Scanner footer (count · last updated · manual refresh) — pinned below the
            scrolling list, flex sibling of .listBody. */}
        {scanMode && scanFooter}
        {/* Watchlist widget footer — just the stock count (no refresh / last-updated). */}
        {pickList && !scanMode && (
          <div className={styles.wlCountFooter}>
            <span className={styles.wlCountText}>{pickCount} {pickCount === 1 ? 'stock' : 'stocks'}</span>
          </div>
        )}
      </div>

      {/* ── Right panel: chart ── */}
      {!embedded && (
        <div className={styles.rightPanel}>
          {selectedSym ? (
            <>
              <div className={styles.chartHeader}>
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
              </div>
              {/* ChartPane owns the identity row (ticker search + company name +
                  session toggle + clock) and the timeframe bar now — the page's
                  own SymbolSearch + period-tabs row used to sit here and would
                  just duplicate ChartPane's canonical ones, so both are retired. */}
              <Suspense fallback={<div className={styles.chartEmpty}>Loading chart…</div>}>
                <ChartPane
                  sym={selectedSym}
                  tf={chartPeriod}
                  onSymbolChange={setSelectedSym}
                  onTfChange={setChartPeriod}
                  stored={null}
                />
              </Suspense>
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
                <button type="button" className="btn btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
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
              <button type="button" className="btn btn-ghost" onClick={() => setImportListId(null)}>Cancel</button>
              <button
                className="btn btn-primary"
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
        const ctxBody = ctxMenu.sym ? (
          // Right-click on a ROW → the per-symbol actions. Only ever opened for owned
          // lists (community rows skip the menu entirely), so a shared list's notes
          // stay read-only exactly as they were when these lived on hover buttons.
          // 75729b1a retired those buttons and carried ONLY × over to this menu,
          // orphaning notes + alerts app-wide; owner decision 2026-08-01 restored
          // them HERE rather than re-cluttering the row.
          <>
            {ctxMenu.id !== 'flagged' && (
              <button
                className={styles.ctxItem}
                onClick={() => { toggleNoteSym(ctxMenu.id, ctxMenu.sym); setCtxMenu(null) }}
              >Notes</button>
            )}
            <button
              className={styles.ctxItem}
              onClick={() => {
                setAlertPopover({ sym: ctxMenu.sym, x: ctxMenu.x, y: ctxMenu.y })
                setAlertPrice('')
                setAlertDir('above')
                setCtxMenu(null)
              }}
            >Set price alert</button>
            <button
              className={`${styles.ctxItem} ${styles.ctxItemDanger}`}
              onClick={() => { handleRemoveSym(ctxMenu.id, ctxMenu.sym); setCtxMenu(null) }}
            >Remove from watchlist</button>
          </>
        ) : (
          // Right-click on a LIST HEADER → list-level actions (unchanged).
          <>
            {ctxMenu.isOwner && (
              <button className={styles.ctxItem} onClick={() => {
                if (ctxMenu.id === 'flagged') {
                  setRenameValue(flaggedName || 'Flagged')
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


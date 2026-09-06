// app/src/pages/ThemeTrackerPage.jsx
import { useState, useMemo, useEffect, useLayoutEffect, useRef, useCallback, lazy, Suspense, memo } from 'react'
import { createPortal } from 'react-dom'
import useMobileSWR from '../hooks/useMobileSWR'
import { mutate as swrMutate } from 'swr'
import { SkeletonTileContent } from '../components/Skeleton'
import styles from './ThemeTrackerPage.module.css'
import StockChart from '../components/StockChart'
import CompanyLogo from '../components/CompanyLogo'
import uctMark from '../components/intro/assets/compass-mark.png'
import useThemeIndexBars from '../hooks/useThemeIndexBars'
import { useFlagged } from '../hooks/useFlagged'
import useTickerTags from '../hooks/useTickerTags'
import { TAG_BY_KEY } from '../constants/tagColors'
import { prefetchBar, prefetchBars, prefetchAllTimeframes, prefetchBarOnIntent, prewarmVisibleList } from '../utils/prefetchBars'
import { useNeighborWarm } from '../hooks/useNeighborWarm'
import TickerActionsMenu, { useTickerActions } from '../components/TickerActions'
import UIcon from '../components/ui/UIcon'
import { useChartsSym } from './charts/ChartsSymContext'
import usePreferences, { parsePref } from '../hooks/usePreferences'
import { resolveGlobalPrefSettings, tagAppTheme } from '../components/chart/chartThemes'
import usePlacedTheme from '../hooks/usePlacedTheme'
import { menuThemeVars } from '../utils/dividerColor'
import ThemeTrackerSettingsPanel from './theme-tracker/ThemeTrackerSettingsPanel'
import { THEME_TRACKER_SETTINGS_KEY, THEME_TRACKER_DEFAULTS, THEME_TRACKER_BASE_FONT_PX, mergeThemeTrackerSettings, themeTrackerStyleVars, themeTrackerDefaultsForTheme } from './theme-tracker/themeTrackerSettings'
import useRealtimePrices from '../hooks/useRealtimePrices'
import useRealtimeBarPrices, { pickFreshPrice } from '../hooks/useRealtimeBarPrices'
import { sendCaptureToJournal } from './journal-2-0/lib/sendToJournal'
import { useJournalToast, JournalToast } from './journal-2-0/lib/useJournalToast'
import CaptureMenu from './journal-2-0/components/CaptureMenu'
import { useThemeSets, getSetDef, putSetDef } from '../hooks/useThemeSets'

// The SAME chart the /charts workspace renders — identity row, session toggle,
// market clock, timeframe bar, market-cap/earnings/UCT-rating meta, settings
// gear and drawing tools. Lazy, so none of it lands in the eager entry chunk.
// NOTE: the theme-index chart below (barsOverride/watermark/liveUpdates=false)
// stays on bare StockChart — only the normal-symbol mount adopts ChartPane.
const ChartPane = lazy(() => import('../components/chart/pane/ChartPane'))

const fetcher = (url) => fetch(url).then(r => r.json())

// "8:25 AM" in ET — matches the Scanner widget footer's timestamp format.
function fmtEtTime(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleTimeString('en-US',
      { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })
  } catch { return '' }
}

// localStorage key holding the last /api/theme-performance response, used to
// paint the tab instantly on load before the fresh (632KB) fetch returns.
const THEME_PERF_CACHE_KEY = 'uct.themePerf.v1'

function RotationBadge({ delta }) {
  if (delta == null) return null
  if (delta >= 20) return <span className={styles.rotBadgeIn}>IN {delta > 0 ? '+' : ''}{delta.toFixed(0)}</span>
  if (delta <= -20) return <span className={styles.rotBadgeOut}>OUT {delta.toFixed(0)}</span>
  return null
}

const PERIOD_LABELS = { '1d': '1D', 'open': 'Open', '1w': '1W', '1m': '1M', '3m': '3M', '1y': '1Y', 'ytd': 'YTD' }
const RANK_TABS = ['Today', '1W', '1M', '3M', '1Y', 'YTD']
const RANK_TO_KEY = { 'Today': '1d', '1W': '1w', '1M': '1m', '3M': '3m', '1Y': '1y', 'YTD': 'ytd' }

function fmtRet(val) {
  if (val === null || val === undefined) return '—'
  const sign = val >= 0 ? '+' : ''
  return `${sign}${val.toFixed(2)}%`
}

function retClass(val, styles) {
  if (val === null || val === undefined) return styles.retFlat
  if (val > 0) return styles.retPos
  if (val < 0) return styles.retNeg
  return styles.retFlat
}

// Slug for the thematic-ETF index endpoint — must match the backend _slugify.
function themeSlug(name) {
  return (name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function avgReturn(holdings, periodKey) {
  // Owner rows only (§4b): engine-overlay members never move the theme number,
  // even on this fallback path (server outage / missing group_return).
  const vals = holdings
    .filter(h => h.source !== 'engine')
    .map(h => h.returns?.[periodKey])
    .filter(v => v != null)
  if (vals.length === 0) return null
  return vals.reduce((a, b) => a + b, 0) / vals.length
}

function groupReturn(theme, periodKey) {
  return (theme.group_return?.[periodKey] != null)
    ? theme.group_return[periodKey]
    : avgReturn(theme.holdings, periodKey)
}

// Live return for a holding at `periodKey`: (livePrice − periodRef) / periodRef.
// Uses the streamed price + the per-period reference close the backend sends in
// ref_prices. Falls back to the server-computed return when live data is absent.
function liveReturn(h, periodKey, prices) {
  const px = prices?.[h.sym]
  // 1d ("today"): TRUST the feed's server-computed change_pct — the regular-session
  // move vs the OFFICIAL prev close. Deriving it from (livePrice − ref) reads 0.00%
  // whenever the live price sits at the reference (weekends / after-hours, where the
  // streamed price is Friday's close and the ref is also a close) — that was the
  // recurring "goes to 0.00%" bug. Other periods derive from the live price + the
  // backend's per-period ref close (there is no per-period change_pct from the feed).
  if (periodKey === '1d' && px?.change_pct != null) return px.change_pct
  // "From Open": measure from today's regular-session open (no overnight gap). Compute live
  // from the streamed day-open when the feed carries it; otherwise use the server overlay's
  // from-open value (refreshed ~every 10s). Pre-market (no open yet) → null → shows "—".
  if (periodKey === 'open') {
    const live = px?.price
    const open = px?.day_open
    if (live != null && Number.isFinite(live) && open != null && open > 0) {
      return ((live - open) / open) * 100
    }
    return h.returns?.open ?? null
  }
  const live = px?.price
  const ref = periodKey === '1d'
    ? (px?.prev_close ?? h.ref_prices?.['1d'])
    : h.ref_prices?.[periodKey]
  if (live != null && Number.isFinite(live) && ref != null && ref !== 0) {
    return ((live - ref) / ref) * 100
  }
  return h.returns?.[periodKey] ?? null
}

// Live group return: anchor the server's group value and apply the AVERAGE live
// delta of its holdings, so the header ticks smoothly without jumping when live
// prices engage (server group value may be ETF/NAV-based, not a plain average).
function liveGroupReturn(theme, periodKey, prices) {
  const base = groupReturn(theme, periodKey)
  if (base == null) return null
  let sum = 0, n = 0
  for (const h of theme.holdings) {
    const s = h.returns?.[periodKey]
    const l = liveReturn(h, periodKey, prices)
    if (s != null && l != null) { sum += (l - s); n++ }
  }
  return n > 0 ? base + sum / n : base
}

// A return cell that briefly flashes bold (TC2000-style) whenever its displayed
// value changes. TINT COLOR follows the DAY DIRECTION, not the tick direction: a
// holding green on the day always flashes the up-tint (even on a down-tick), one
// red on the day always flashes the down-tint. `value` IS the day return, so its
// sign == the day direction. `dir` now only GATES the flash (any change).
function ReturnCell({ value, baseClass, flashEnabled = true }) {
  const [dir, setDir] = useState(null)
  const prevRef = useRef(null)
  useEffect(() => {
    const r = value == null ? null : Math.round(value * 100) / 100
    // Tick-flash disabled in Theme Tracker Settings: keep tracking the previous
    // value (so re-enabling doesn't flash on a stale compare) but never animate.
    if (!flashEnabled) { prevRef.current = r; return }
    const p = prevRef.current
    if (r != null && p != null && r !== p) {
      setDir(r > p ? 'up' : 'down')
      prevRef.current = r
      const id = setTimeout(() => setDir(null), 480)
      return () => clearTimeout(id)
    }
    prevRef.current = r
  }, [value, flashEnabled])
  // On a tick, flash ONLY the background tint (no bold pulse) — the return cells
  // carry a steady weight that matches the symbol/other columns.
  const flashCls = dir ? (value >= 0 ? styles.flashUp : styles.flashDown) : ''
  return (
    <span className={`${baseClass} ${flashCls}`}>
      {fmtRet(value)}
    </span>
  )
}

// Isolated search box: the instant typed value lives HERE, so pressing a key
// re-renders only this ~1-node input — never the 112-group theme list below it.
// The parent hears only the DEBOUNCED value (which is what the expensive filter
// keys off), so typing stays instant no matter how large the list is.
const ThemeSearchBox = memo(function ThemeSearchBox({ onDebounced }) {
  const [val, setVal] = useState('')
  useEffect(() => {
    const t = setTimeout(() => onDebounced(val.trim()), 140)
    return () => clearTimeout(t)
  }, [val, onDebounced])
  return (
    <div className={styles.searchBar}>
      <input
        className={styles.searchInput}
        placeholder="Search themes or tickers…"
        value={val}
        onChange={e => setVal(e.target.value)}
      />
      {val && (
        <button className={styles.searchClear} onClick={() => setVal('')}>×</button>
      )}
    </div>
  )
})

// Inline "add a ticker" input used in edit mode (theme membership + custom themes).
function AddStockRow({ onAdd, autoFocus = false }) {
  const [v, setV] = useState('')
  const inputRef = useRef(null)
  // Focus straight away when the user just jumped here from "+ Add theme" — so they can
  // immediately start typing tickers into the freshly-added theme (no extra click).
  useEffect(() => {
    if (autoFocus && inputRef.current) inputRef.current.focus()
  }, [autoFocus])
  const submit = () => {
    const sym = v.trim().toUpperCase()
    if (sym) onAdd(sym)
    setV('')
  }
  return (
    <div className={`${styles.stockRow} ${styles.addStockRow}`} onClick={e => e.stopPropagation()}>
      <input
        ref={inputRef}
        className={styles.addStockInput}
        placeholder="＋ Add ticker…  (Enter)"
        value={v}
        onChange={e => setV(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit() } }}
        onClick={e => e.stopPropagation()}
      />
      {v.trim() && <button className={styles.addStockGo} onClick={submit} title="Add">Add</button>}
    </div>
  )
}

function ThemeGroup({ theme, themeKey, selectedSym, selectedNavKey, onSelectSym, activeKey, sortDir, open, onToggle, rowRefs, rotationRanking, getTag, tickerActions, onHoverSym, prices, tintEnabled = true, showLogos = true, logoSize = 16, editing = false, onHideTheme, onRemoveSym, onAddSym, groupRefs, flash = false, autoFocusAdd = false }) {
  const { isFlagged, toggle: toggleFlag } = useFlagged()
  const tk = themeKey || theme.ticker
  const isPortfolio = theme.ticker === 'UCT20'
  const groupLive = liveGroupReturn(theme, activeKey, prices)
  const momentumDelta = rotationRanking?.momentum_delta

  const sortedHoldings = useMemo(() => {
    if (editing) return theme.holdings   // fixed order while editing (adding a stock never reorders)
    return [...theme.holdings].sort((a, b) => {
      const av = a.returns?.[activeKey] ?? (sortDir === 'desc' ? -Infinity : Infinity)
      const bv = b.returns?.[activeKey] ?? (sortDir === 'desc' ? -Infinity : Infinity)
      return sortDir === 'desc' ? bv - av : av - bv
    })
  }, [theme.holdings, activeKey, sortDir, editing])


  return (
    <>
      <div
        className={`${styles.groupRow} ${flash ? styles.groupFlash : ''}`}
        ref={el => { if (groupRefs) groupRefs.current[tk] = el }}
        onClick={() => onToggle(tk)}
      >
        <span className={styles.groupName}>
          <span className={styles.groupCaret}>{open ? '▾' : '▸'}</span>
          {theme.name}
          {isPortfolio && <span className={styles.portfolioBadge}><UIcon name="star-fill" size={13} /></span>}
          <span className={styles.groupCount}>{theme.holdings.length}</span>
        </span>
        {editing && onHideTheme ? (
          <button
            className={styles.editRemove}
            onClick={e => { e.stopPropagation(); onHideTheme(theme) }}
            title={theme.is_custom ? 'Delete this custom theme' : 'Hide this theme from my set'}
          >✕</button>
        ) : (
          <ReturnCell value={groupLive} baseClass={`${styles.ret} ${styles.retActive} ${retClass(groupLive, styles)}`} flashEnabled={tintEnabled} />
        )}
      </div>

      {/* The equal-weight $IDX index row shows ONLY for an UNEDITED owner theme — a custom
          theme has no $IDX, and once membership is edited the shared $IDX no longer matches. */}
      {open && !theme.is_custom && !theme.user_edited && (() => {
        const indexSym = `$IDX:${themeSlug(theme.name)}`
        return (
          <div
            className={`${styles.stockRow} ${styles.indexRow} ${selectedSym === indexSym ? styles.selected : ''}`}
            onClick={() => onSelectSym(indexSym, `${theme.name} Index`, theme.ticker)}
            title="Equal-weight combined chart of the whole theme"
          >
            <span className={styles.stockLabel}>
              <span className={styles.stockLogo}><UIcon name="equity" size={13} /></span>
              <span className={styles.sym} style={{ fontWeight: 700 }}>{theme.name} Index</span>
              {/* The row is always the equal-weight SYNTHETIC index ($IDX). Only
                  label it "ETF" when the theme is actually ETF-backed — the 48
                  curated-only themes (incl. all 12 new narrow ones) have no ETF,
                  so "ETF" there was misleading (mega-review). */}
              <span className={styles.indexBadge}>{theme.etf_name ? 'ETF' : 'INDEX'}</span>
            </span>
            <ReturnCell value={groupLive} baseClass={`${styles.ret} ${retClass(groupLive, styles)}`} flashEnabled={tintEnabled} />
          </div>
        )
      })()}

      {open && sortedHoldings.map(h => {
        const retVal = liveReturn(h, activeKey, prices)
        const rowKey = `${theme.ticker}::${h.sym}`
        // Highlight only the SELECTED instance (by key). Falls back to the bare
        // symbol when no instance key is set (e.g. hub-driven selection).
        const isSelected = selectedNavKey ? selectedNavKey === rowKey : h.sym === selectedSym
        return (
          <div
            key={h.sym}
            ref={el => { if (rowRefs) rowRefs.current[rowKey] = el }}
            className={`${styles.stockRow} ${isSelected ? styles.selected : ''}`}
            onClick={() => onSelectSym(h.sym, h.name, theme.ticker)}
            onMouseEnter={onHoverSym ? () => onHoverSym(h.sym) : undefined}
            onFocus={onHoverSym ? () => onHoverSym(h.sym) : undefined}
            {...(tickerActions ? tickerActions.longPressProps(h.sym) : {})}
          >
            <span className={styles.stockLabel}>
              <button
                className={`${styles.flagStar}${isFlagged(h.sym) ? ' ' + styles.flagStarActive : ''}`}
                onClick={e => { e.stopPropagation(); toggleFlag(h.sym) }}
                title={isFlagged(h.sym) ? 'Remove from Flagged' : 'Add to Flagged'}
              >{isFlagged(h.sym) ? <UIcon name="star-fill" size={12} /> : <UIcon name="star" size={12} />}</button>
              {showLogos && <span className={styles.stockLogo}><CompanyLogo sym={h.sym} name={h.name} size={logoSize} round /></span>}
              {getTag && getTag(h.sym) && <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: TAG_BY_KEY[getTag(h.sym)]?.hex, marginRight: 4 }} />}
              <span className={styles.sym}>{h.sym}</span>
            </span>
            {editing && onRemoveSym ? (
              <button
                className={styles.editRemove}
                onClick={e => { e.stopPropagation(); onRemoveSym(theme, h.sym) }}
                title="Remove this stock from this theme (my set)"
              >✕</button>
            ) : (
              <ReturnCell value={retVal} baseClass={`${styles.ret} ${retClass(retVal, styles)}`} flashEnabled={tintEnabled} />
            )}
          </div>
        )
      })}

      {open && editing && onAddSym && (
        <AddStockRow onAdd={(sym) => onAddSym(theme, sym)} autoFocus={autoFocusAdd} />
      )}
    </>
  )
}

// A dropdown menu rendered in a PORTAL (document.body) positioned under an anchor, so the
// widget's overflow:hidden can never clip it — it floats on top and can spill past the edge.
function FloatingMenu({ anchorRef, onClose, width = 210, up = false, children }) {
  const [pos, setPos] = useState(null)
  useLayoutEffect(() => {
    const el = anchorRef?.current
    if (!el) return
    const r = el.getBoundingClientRect()
    let left = Math.max(6, Math.min(r.left, window.innerWidth - width - 6))
    // `up` anchors the menu ABOVE its button (via bottom) so a bottom-bar menu opens upward
    // into the widget instead of spilling off the bottom of the screen.
    if (up) setPos({ bottom: Math.max(6, window.innerHeight - r.top + 4), left })
    else setPos({ top: r.bottom + 4, left })
  }, [anchorRef, width, up])
  const style = pos
    ? ('bottom' in pos ? { bottom: pos.bottom, left: pos.left, width } : { top: pos.top, left: pos.left, width })
    : { top: -9999, left: -9999, width }
  return createPortal(
    <>
      <div className={styles.floatBackdrop} onClick={onClose} />
      <div className={styles.floatMenu} style={style}>{children}</div>
    </>,
    document.body,
  )
}

const PencilIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
)
const TrashIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
  </svg>
)

// Set picker + Edit toggle (rides the search row). Create / rename / delete all happen
// IN-WIDGET (inline inputs, 2-click delete confirm) — no browser prompt/confirm dialogs.
function SetPicker({ sets, themeSetId, activeSet, onSelect, onCreate, onRename, onDelete, editing, onToggleEdit }) {
  const [open, setOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [renamingId, setRenamingId] = useState(null)
  const [renameVal, setRenameVal] = useState('')
  const [confirmDel, setConfirmDel] = useState(null)
  const btnRef = useRef(null)
  const close = () => { setOpen(false); setRenamingId(null); setConfirmDel(null); setNewName('') }
  return (
    <div className={styles.setPicker}>
      <button ref={btnRef} className={styles.setPickerBtn} onClick={() => setOpen(o => !o)} title="Choose a preset">
        {activeSet ? activeSet.name : 'UCT Default'} <span className={styles.setCaret}>▾</span>
      </button>
      {/* Edit always available — editing UCT Default builds a draft you can save as a new preset. */}
      <button className={`${styles.setEditBtn} ${editing ? styles.setEditBtnActive : ''}`}
        onClick={onToggleEdit} title={activeSet ? 'Edit this preset' : 'Customize — then save as a preset'}>{editing ? 'Done' : 'Edit'}</button>
      {open && (
        <FloatingMenu anchorRef={btnRef} onClose={close} width={230}>
          <button className={`${styles.setMenuName} ${!themeSetId ? styles.setMenuActive : ''}`} onClick={() => { onSelect(null); close() }}>UCT Default</button>
          {sets.map(s => (
            <div key={s.id} className={styles.setMenuRow}>
              {confirmDel === s.id ? (
                <div className={styles.setConfirmRow}>
                  <span className={styles.setConfirmLabel}>Delete “{s.name}”?</span>
                  <button className={styles.setConfirmYes} onClick={() => { onDelete(s.id); close() }}>Delete</button>
                  <button className={styles.setConfirmNo} onClick={() => setConfirmDel(null)}>Cancel</button>
                </div>
              ) : renamingId === s.id ? (
                <input autoFocus className={styles.setInline} value={renameVal}
                  onChange={e => setRenameVal(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { onRename(s.id, renameVal.trim() || s.name); setRenamingId(null) }
                    if (e.key === 'Escape') setRenamingId(null)
                  }}
                  onBlur={() => setRenamingId(null)} />
              ) : (
                <>
                  <button className={`${styles.setMenuName} ${s.id === themeSetId ? styles.setMenuActive : ''}`} onClick={() => { onSelect(s.id); close() }}>{s.name}</button>
                  <button className={styles.setRowBtn} title="Rename" aria-label="Rename set"
                    onClick={() => { setRenamingId(s.id); setRenameVal(s.name); setConfirmDel(null) }}><PencilIcon /></button>
                  <button className={`${styles.setRowBtn} ${styles.setRowTrash}`} title="Delete set" aria-label="Delete set"
                    onClick={() => setConfirmDel(s.id)}><TrashIcon /></button>
                </>
              )}
            </div>
          ))}
          <div className={styles.setMenuSep} />
          <div className={styles.setNewRow}>
            <input className={styles.setInline} placeholder="New preset name…" value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && newName.trim()) { onCreate(newName.trim()); close() } }} />
            <button className={styles.setNewGo} disabled={!newName.trim()} onClick={() => { if (newName.trim()) { onCreate(newName.trim()); close() } }}>＋ New</button>
          </div>
        </FloatingMenu>
      )}
    </div>
  )
}

// Add-theme picker (edit mode): search the full theme list + click to add (watchlist-style),
// or type a name to create a custom theme. One "Add" affordance.
function AddThemePicker({ palette, inSet, onAdd, onCreateCustom, up = false }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [cname, setCname] = useState('')
  const btnRef = useRef(null)
  const ql = q.trim().toLowerCase()
  const list = palette.filter(t => !ql || t.name.toLowerCase().includes(ql)).slice(0, 80)
  const close = () => { setOpen(false); setQ(''); setCname('') }
  return (
    <div className={styles.addThemeWrap}>
      <button ref={btnRef} className={styles.editBarAdd} onClick={() => setOpen(o => !o)}>＋ Add theme</button>
      {open && (
        <FloatingMenu anchorRef={btnRef} onClose={close} width={260} up={up}>
          <input autoFocus className={styles.addThemeSearch} placeholder="Search themes…" value={q} onChange={e => setQ(e.target.value)} />
          <div className={styles.addThemeList}>
            {list.map(t => {
              const has = inSet.has(t.slug)
              return (
                <button key={t.slug} className={`${styles.addThemeItem} ${has ? styles.addThemeItemIn : ''}`}
                  onClick={() => { if (!has) { onAdd(t.slug); close() } }}>
                  <span className={styles.addThemeName}>{t.name}</span>
                  <span className={styles.addThemeMark}>{has ? '✓' : '＋'}</span>
                </button>
              )
            })}
            {list.length === 0 && <div className={styles.addThemeEmpty}>No themes match</div>}
          </div>
          <div className={styles.setMenuSep} />
          <div className={styles.setNewRow}>
            <input className={styles.setInline} placeholder="Create custom theme…" value={cname}
              onChange={e => setCname(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && cname.trim()) { onCreateCustom(cname.trim()); close() } }} />
            <button className={styles.setNewGo} disabled={!cname.trim()} onClick={() => { if (cname.trim()) { onCreateCustom(cname.trim()); close() } }}>Create</button>
          </div>
        </FloatingMenu>
      )}
    </div>
  )
}

export default function ThemeTrackerPage({ embedded = false, activeRef = null, widgetKey = null, opts = null, onOptsChange = null }) {
  // Per-widget persistence (opts) — the Close/Open basis and the chosen theme set stick
  // per widget instance via the workspace's debounced layout save.
  const patchOpts = useCallback((patch) => {
    if (onOptsChange) onOptsChange({ ...(opts || {}), ...patch })
  }, [onOptsChange, opts])
  // Arrow-key nav is LOCKED to whichever list widget you last clicked (theme
  // tracker vs a Watchlist widget), via a single shared activeRef in the charts
  // workspace. Claiming it on click means arrows keep scanning THIS list until
  // you click into another — they never jump to the watchlist just from hover.
  const isActiveWidget = () => !activeRef || activeRef.current == null || activeRef.current === widgetKey
  const markActiveWidget = () => { if (activeRef && widgetKey) activeRef.current = widgetKey }

  // ── Theme Tracker appearance settings (⚙ panel) — mirrors the watchlist's ──
  const { prefs, setPref } = usePreferences()
  const placedTheme = usePlacedTheme()
  // Uncustomized (no saved pref) → DEFAULTS FOR THE CURRENT APP THEME (light → white
  // canvas + dark text), so the ⚙ swatches and the surface follow the site theme.
  const ttSettings = useMemo(
    () => mergeThemeTrackerSettings(resolveGlobalPrefSettings(parsePref(prefs?.[THEME_TRACKER_SETTINGS_KEY], null), placedTheme, themeTrackerDefaultsForTheme)),
    [prefs, placedTheme],
  )
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsBtnRef = useRef(null)
  const pageRef = useRef(null)
  const patchSettings = useCallback((patch) => {
    setPref(THEME_TRACKER_SETTINGS_KEY, JSON.stringify(tagAppTheme({ ...ttSettings, ...patch }, placedTheme)))
  }, [ttSettings, setPref, placedTheme])
  const resetSettings = useCallback(() => {
    setPref(THEME_TRACKER_SETTINGS_KEY, JSON.stringify(themeTrackerDefaultsForTheme(placedTheme)))
  }, [setPref, prefs])
  const ttStyle = useMemo(() => themeTrackerStyleVars(ttSettings), [ttSettings])
  // Canvas-matched palette for the settings panel (light/gold on a light canvas,
  // dark on a dark one) — same mechanism as the chart/watchlist popup menus.
  const ttMenuVars = useMemo(() => {
    const canvas = ttSettings.bgMode === 'gradient' ? (ttSettings.bgGradient?.top || ttSettings.bg) : ttSettings.bg
    return menuThemeVars(canvas) || {}
  }, [ttSettings])
  // CompanyLogo sizes itself with an inline px style, so the text-size scale is
  // applied in JS for the logo (the CSS vars handle everything else).
  const rowLogoSize = useMemo(() => {
    const px = Number(ttSettings.fontSize)
    const scale = px > 0 ? px / THEME_TRACKER_BASE_FONT_PX : 1
    return Math.round(16 * scale)
  }, [ttSettings.fontSize])

  const [activeTab, setActiveTab] = useState('Today')  // always open on Today (not persisted → resets every load)
  // Today basis: 'close' = vs previous close (includes the overnight gap, the classic "today");
  // 'open' = vs today's regular-session open (gap excluded). Only affects the Today column.
  // Seeded from + persisted to per-widget opts.
  const [todayBasis, setTodayBasisRaw] = useState(opts?.todayBasis === 'open' ? 'open' : 'close')
  const setTodayBasis = useCallback((b) => { setTodayBasisRaw(b); patchOpts({ todayBasis: b }) }, [patchOpts])
  // 'open' is a Today-only basis (no historical meaning), so it maps in only when Today is active.
  // Defined here (before the set-editor memos that depend on it) to avoid a TDZ reference.
  const activeKey = (activeTab === 'Today' && todayBasis === 'open') ? 'open' : RANK_TO_KEY[activeTab]

  // ── Personal theme SETS (flag-gated) — additive, optimistic editor ─────────
  const { enabled: themeSetsEnabled, sets, createSet, deleteSet, renameSet } = useThemeSets()
  const [themeSetId, setThemeSetId] = useState(opts?.themeSetId || null)
  const [editing, setEditing] = useState(false)
  // Editor state, materialized so every edit is INSTANT (optimistic) with no reflow:
  const [themeOrder, setThemeOrder] = useState(null)   // ordered owner slugs (null = all-defaults, not yet materialized)
  const [removedMap, setRemovedMap] = useState({})     // {slug:[sym]} per-theme stock removes
  const [addedMap, setAddedMap] = useState({})         // {slug:[sym]} per-theme stock adds
  const [customThemes, setCustomThemes] = useState([]) // [{key,name,members}]
  // Bottom edit-bar flow: which theme we're actively adding tickers to (jumped to on add),
  // the "save as preset" name, and a highlight for the just-added theme.
  const [addingTo, setAddingTo] = useState(null)       // { key, name } or null
  const [saveName, setSaveName] = useState('')
  const [flashKey, setFlashKey] = useState(null)
  const groupRefs = useRef({})                         // theme-group row refs, for scroll-into-view
  // Accordion open-theme state lives up HERE (not by the other view state further down) so the
  // edit ops below can jump the tracker to a freshly-added theme without a TDZ reference.
  const [openTheme, setOpenTheme] = useState(null)
  // If the persisted set was deleted elsewhere, fall back to Default.
  useEffect(() => {
    if (themeSetId && themeSetsEnabled && sets.length && !sets.some(s => s.id === themeSetId)) {
      setThemeSetId(null); patchOpts({ themeSetId: null })
    }
  }, [themeSetId, themeSetsEnabled, sets, patchOpts])
  const activeSet = themeSetId ? sets.find(s => s.id === themeSetId) : null
  const selectSet = useCallback((id) => {
    setThemeSetId(id); patchOpts({ themeSetId: id }); setEditing(false)
  }, [patchOpts])
  // Load the active set's diff into editor state.
  useEffect(() => {
    let cancel = false
    if (themeSetId) {
      getSetDef(themeSetId).then(d => {
        if (cancel || !d) return
        setThemeOrder(Array.isArray(d.themes) ? d.themes : null)
        setRemovedMap(d.removed || {}); setAddedMap(d.added || {}); setCustomThemes(d.custom || [])
      })
    } else {
      setThemeOrder(null); setRemovedMap({}); setAddedMap({}); setCustomThemes([]); setEditing(false)
    }
    return () => { cancel = true }
  }, [themeSetId])
  // Instant paint: seed SWR from the LAST cached response so the tab renders
  // immediately on refresh (like the chart's IDB cache) instead of showing a ~1s
  // skeleton while the 632KB payload round-trips. SWR then revalidates in the
  // background and swaps in fresh %s. Read once on mount.
  const themeFallback = useMemo(() => {
    try {
      const raw = localStorage.getItem(THEME_PERF_CACHE_KEY)
      const p = raw ? JSON.parse(raw) : null
      return p?.themes?.length ? p : undefined
    } catch { return undefined }
  }, [])
  // A selected personal set overlays server-side via ?set=<id>. Default = shared tracker.
  const perfUrl = themeSetId ? `/api/theme-performance?set=${encodeURIComponent(themeSetId)}` : '/api/theme-performance'
  const { data, isLoading, mutate } = useMobileSWR(perfUrl, fetcher, {
    // 10s so the theme %s stay near-live and the leaderboard re-sorts in order.
    // (The server overlay is cached at the same 10s window — see _LIVE_1D_TTL —
    // so this polls no faster than the data actually refreshes.) Theme %s are
    // aggregates of up to ~2,050 holdings; we can't stream them tick-by-tick
    // like the watchlist (that would fan out the single-process SSE backend),
    // so a short server-refresh window is the live-enough, safe approach.
    fallbackData: themeSetId ? undefined : themeFallback,
    refreshInterval: (d) => d?.status === 'computing' ? 15_000 : 10_000,
    dedupingInterval: 8_000,
    revalidateOnFocus: false,
  })
  const isComputing = data?.status === 'computing'

  // Full default dataset — fetched ONLY while editing, as the palette + data source so
  // add/remove/reorder edits render instantly from local state (no server round-trip, no reflow).
  const { data: allData } = useMobileSWR(editing ? '/api/theme-performance' : null, fetcher, {
    dedupingInterval: 30_000, revalidateOnFocus: false,
  })
  // Prefer the full default dataset (the palette); fall back to the current ?set= data so the
  // editor is never blank in the moment before allData loads.
  const editSource = (allData?.themes?.length ? allData : data) || null
  const _k = (s) => (s || '').toUpperCase().replace(/\./g, '-')
  const allIndex = useMemo(() => {
    const m = {}
    for (const t of (editSource?.themes || [])) { const s = themeSlug(t.name); if (s && !(s in m)) m[s] = t }
    return m
  }, [editSource])
  const symIndex = useMemo(() => {
    const m = {}
    for (const t of (editSource?.themes || [])) for (const h of (t.holdings || [])) { const k = _k(h.sym); if (k && !(k in m)) m[k] = h }
    return m
  }, [editSource])
  // The Add-theme palette — every owner theme, searchable.
  const themePalette = useMemo(() =>
    (editSource?.themes || []).map(t => ({ slug: themeSlug(t.name), name: t.name })), [editSource])

  // Persist edits: keep the latest body in a ref, PUT on a short debounce. flushPersist()
  // fires the pending PUT immediately — used when the user clicks Done so the finished view
  // shows the saved edits right away (no manual refresh).
  const persistRef = useRef(null)
  const pendingBodyRef = useRef(null)
  const inflightRef = useRef(Promise.resolve())
  const editDisplayRef = useRef(null)   // latest edit-mode themes → the optimistic Done view
  const doPut = useCallback((body) => {
    const p = putSetDef(themeSetId, body).catch(() => {})
    inflightRef.current = p
    return p
  }, [themeSetId])
  const persist = useCallback((next) => {
    if (!themeSetId) return
    const body = { themes: next.themeOrder, removed: next.removedMap, added: next.addedMap, custom: next.customThemes }
    pendingBodyRef.current = body
    clearTimeout(persistRef.current)
    persistRef.current = setTimeout(() => { pendingBodyRef.current = null; doPut(body) }, 350)
  }, [themeSetId, doPut])
  const flushPersist = useCallback(async () => {
    clearTimeout(persistRef.current)
    if (pendingBodyRef.current) { const b = pendingBodyRef.current; pendingBodyRef.current = null; await doPut(b) }
    await inflightRef.current   // wait for any IN-FLIGHT save to actually land before we revalidate
  }, [doPut])
  // Done: show the edited set INSTANTLY (optimistic), save, then revalidate for exact numbers —
  // so the finished view never shows the pre-edit state (the "have to refresh" bug).
  const stopEditing = useCallback(async () => {
    // Only a saved preset keeps its edited view optimistically; an unsaved Default draft is
    // discarded on Done (the revalidate below restores the real default) — matches Breadth.
    const edited = editDisplayRef.current
    if (themeSetId && edited && data) mutate({ ...data, themes: edited }, { revalidate: false })
    setEditing(false); setAddingTo(null); setFlashKey(null)
    await flushPersist()
    mutate()
  }, [themeSetId, data, flushPersist, mutate])
  const materializeOrder = useCallback(() =>
    themeOrder ?? (data?.themes || []).map(t => themeSlug(t.name)), [themeOrder, data])
  const applyEdit = useCallback((patch) => {
    const next = {
      themeOrder: 'themeOrder' in patch ? patch.themeOrder : themeOrder,
      removedMap: patch.removedMap || removedMap,
      addedMap: patch.addedMap || addedMap,
      customThemes: patch.customThemes || customThemes,
    }
    if ('themeOrder' in patch) setThemeOrder(patch.themeOrder)
    if (patch.removedMap) setRemovedMap(patch.removedMap)
    if (patch.addedMap) setAddedMap(patch.addedMap)
    if (patch.customThemes) setCustomThemes(patch.customThemes)
    persist(next)
  }, [themeOrder, removedMap, addedMap, customThemes, persist])

  // Jump the tracker to a just-added theme: open it, highlight it, and arm the bottom bar's
  // "adding tickers" hint. New themes go to the TOP of the order so they're never buried.
  const jumpToTheme = useCallback((key, name) => {
    if (!key) return
    setOpenTheme(key); setFlashKey(key); setAddingTo({ key, name })
  }, [])
  const addThemeToSet = useCallback((slug) => {
    const order = materializeOrder()
    applyEdit({ themeOrder: [slug, ...order.filter(s => s !== slug)] })
    const base = allIndex[slug]
    if (base) jumpToTheme(base.ticker, base.name)
  }, [materializeOrder, applyEdit, allIndex, jumpToTheme])
  const removeTheme = useCallback((theme) => {
    if (theme.is_custom) applyEdit({ customThemes: customThemes.filter(c => c.key !== theme.custom_key) })
    else applyEdit({ themeOrder: materializeOrder().filter(s => s !== themeSlug(theme.name)) })
  }, [customThemes, materializeOrder, applyEdit])
  const removeSym = useCallback((theme, sym) => {
    const S = sym.toUpperCase()
    if (theme.is_custom) {
      applyEdit({ customThemes: customThemes.map(c => c.key === theme.custom_key
        ? { ...c, members: (c.members || []).filter(m => m.toUpperCase() !== S) } : c) })
    } else {
      const slug = themeSlug(theme.name)
      const nextRemoved = { ...removedMap, [slug]: Array.from(new Set([...(removedMap[slug] || []), S])) }
      const nextAdded = { ...addedMap }
      if (nextAdded[slug]) nextAdded[slug] = nextAdded[slug].filter(x => x.toUpperCase() !== S)
      applyEdit({ removedMap: nextRemoved, addedMap: nextAdded })
    }
  }, [customThemes, removedMap, addedMap, applyEdit])
  const addSym = useCallback((theme, sym) => {
    const S = sym.toUpperCase()
    if (theme.is_custom) {
      applyEdit({ customThemes: customThemes.map(c => c.key === theme.custom_key
        ? { ...c, members: Array.from(new Set([...(c.members || []), S])) } : c) })
    } else {
      const slug = themeSlug(theme.name)
      const nextAdded = { ...addedMap, [slug]: Array.from(new Set([...(addedMap[slug] || []), S])) }
      const nextRemoved = { ...removedMap }
      if (nextRemoved[slug]) nextRemoved[slug] = nextRemoved[slug].filter(x => x.toUpperCase() !== S)
      applyEdit({ addedMap: nextAdded, removedMap: nextRemoved })
    }
  }, [customThemes, removedMap, addedMap, applyEdit])
  const createCustomTheme = useCallback((name) => {
    const key = 'custom:' + Date.now().toString(36)
    const nm = (name || '').trim() || 'My Theme'
    applyEdit({ customThemes: [{ key, name: nm, members: [] }, ...customThemes] })
    jumpToTheme(key, nm)
  }, [customThemes, applyEdit, jumpToTheme])
  // Reset the whole draft back to the UCT default (clears every add/remove/custom). For a named
  // preset this also persists the cleared diff; for Default it just resets the local draft.
  const resetToDefault = useCallback(() => {
    setThemeOrder(null); setRemovedMap({}); setAddedMap({}); setCustomThemes([])
    setAddingTo(null); setFlashKey(null)
    persist({ themeOrder: null, removedMap: {}, addedMap: {}, customThemes: [] })
  }, [persist])
  // Save the current Default draft as a NEW named preset, then switch to it (Breadth-style).
  const saveAsPreset = useCallback(async (name) => {
    const nm = (name || '').trim(); if (!nm) return
    const order = themeOrder ?? (data?.themes || []).map(t => themeSlug(t.name))
    const edited = editDisplayRef.current   // the full edited view (customs + owner), with holdings
    const s = await createSet(nm)
    if (!s) return
    await putSetDef(s.id, { name: nm, themes: order, removed: removedMap, added: addedMap, custom: customThemes })
    setSaveName('')
    // Seed the new preset's SWR cache with the edited view so the switch shows the full set
    // INSTANTLY — a brand-new set's first read can momentarily miss the just-written def
    // (showing an empty "No theme data" flash). revalidate then swaps in the exact numbers.
    if (edited && data) {
      try { swrMutate(`/api/theme-performance?set=${encodeURIComponent(s.id)}`, { ...data, themes: edited, status: 'ok' }, { revalidate: true }) } catch { /* best-effort seed */ }
    }
    selectSet(s.id)   // switch to (and stop editing) the freshly-saved preset
  }, [themeOrder, data, removedMap, addedMap, customThemes, createSet, selectSet])

  // Locally-built, fixed-order display for edit mode (owner themes in set order, then customs).
  const editDisplayThemes = useMemo(() => {
    if (!editing) return null
    const order = themeOrder ?? (data?.themes || []).map(t => themeSlug(t.name))
    // A user-added stock is ALWAYS its own row (source 'user' → full brightness, counts in the
    // aggregate), never inheriting an engine source from wherever it was found in the palette.
    const mk = (sym) => {
      const found = symIndex[_k(sym)]
      return found ? { ...found, source: 'user' }
        : { sym: (sym || '').toUpperCase(), name: (sym || '').toUpperCase(), returns: {}, ref_prices: {}, source: 'user', unresolved: true }
    }
    const owner = order.map(slug => {
      const base = allIndex[slug]
      if (!base) return null
      const rem = new Set((removedMap[slug] || []).map(_k))
      let holdings = (base.holdings || []).filter(h => !rem.has(_k(h.sym)))
      const have = new Set(holdings.map(h => _k(h.sym)))
      for (const sym of (addedMap[slug] || [])) { const k = _k(sym); if (!have.has(k)) { holdings = [...holdings, mk(sym)]; have.add(k) } }
      const edited = (removedMap[slug]?.length || 0) > 0 || (addedMap[slug]?.length || 0) > 0
      return { ...base, holdings, group_return: { [activeKey]: avgReturn(holdings, activeKey) }, user_edited: edited }
    }).filter(Boolean)
    const customs = customThemes.map(c => {
      const holdings = (c.members || []).map(mk)
      return { ticker: 'INDEX', name: c.name, sector: 'Custom', is_custom: true, custom_key: c.key, holdings, group_return: { [activeKey]: avgReturn(holdings, activeKey) } }
    })
    // Your own themes sit at the TOP so a freshly-created one is right there (not buried).
    return [...customs, ...owner]
  }, [editing, themeOrder, data, allIndex, symIndex, removedMap, addedMap, customThemes, activeKey])
  editDisplayRef.current = editDisplayThemes   // keep the optimistic-Done source current

  // ── Footer (embedded widget): "N stocks · Updated H:MM ET · ⟳" ──
  // Count = unique stocks tracked across every theme. Refresh re-pulls live-overlaid numbers
  // (server busts its 10s live cache via ?refresh=1) so the leaderboard re-ranks on demand.
  // Count from the ACTUALLY-DISPLAYED themes so it updates live while editing (remove/add a
  // stock or theme) and shows the fresh total the moment editing ends.
  const stockCount = useMemo(() => {
    const src = (editing && editDisplayThemes) ? editDisplayThemes : (data?.themes || [])
    const s = new Set()
    for (const t of src) {
      for (const h of (t.holdings || [])) {
        const sym = typeof h === 'string' ? h : h?.sym
        if (sym) s.add(String(sym).toUpperCase())
      }
    }
    return s.size
  }, [data, editing, editDisplayThemes])
  const [refreshing, setRefreshing] = useState(false)
  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      const fresh = await fetcher(`${perfUrl}${perfUrl.includes('?') ? '&' : '?'}refresh=1`)
      if (fresh && !fresh.error) await mutate(fresh, { revalidate: false })
    } catch {
      try { await mutate() } catch { /* ignore */ }
    } finally {
      setRefreshing(false)
    }
  }, [mutate, perfUrl])

  // Persist the freshest full response for next load's instant paint. Throttled +
  // idle-deferred so the 632KB JSON.stringify never janks the main thread.
  const lastPersistRef = useRef(0)
  useEffect(() => {
    if (!data?.themes?.length) return
    const now = Date.now()
    if (now - lastPersistRef.current < 20_000) return
    lastPersistRef.current = now
    const write = () => { try { localStorage.setItem(THEME_PERF_CACHE_KEY, JSON.stringify(data)) } catch { /* quota / private mode */ } }
    if (typeof requestIdleCallback === 'function') requestIdleCallback(write, { timeout: 3000 })
    else setTimeout(write, 0)
  }, [data])

  const { data: rotationData } = useMobileSWR('/api/theme-rotation', fetcher, {
    refreshInterval: 900_000,   // 15 min — matches backend cache
    dedupingInterval: 60_000,
    revalidateOnFocus: false,
  })
  const rotationRankings = rotationData?.rankings || {}

  const { sym: hubSym, setSym: setHubSym } = useChartsSym()
  const [selectedSym, setSelectedSym] = useState(null)
  // Which INSTANCE is selected — `${themeTicker}::${sym}`. A ticker can appear in
  // several open themes, so arrow-nav + row highlight key off this, not the bare
  // symbol (else navigating a duplicate jumps to the other theme's copy).
  const [selectedNavKey, setSelectedNavKey] = useState(null)
  const [selectedName, setSelectedName] = useState('')
  const [sortDir, setSortDir] = useState('desc')
  // Accordion: at most ONE theme open at a time (null = none) — `openTheme` state is
  // declared higher up (near the editor state) so the edit ops can jump to a new theme.
  // chartPeriod is declared up here (not later in the file) because
  // toggleTheme + handleHoverSym below close over it; a `const` declared
  // *after* those would be in the temporal dead zone at render time.
  const [chartPeriod, setChartPeriod] = useState('D')
  const [flagToast, setFlagToast] = useState(null)

  // ── Thematic-ETF ── A theme's equal-weight index is a pseudo-ticker
  // ("$IDX:<slug>") selected from an "… Index" row in the holdings list, so it
  // flows through the SAME selection path as any ticker (right panel here; the
  // linked chart widget when embedded). The hook fetches its bars for barsOverride.
  const themeIdx = useThemeIndexBars(selectedSym, chartPeriod)
  const indexTf = ['D', 'W', 'M'].includes(chartPeriod) ? chartPeriod : 'D'

  const rowRefs = useRef({})

  function handleTabClick(tab) {
    if (tab === activeTab) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    } else {
      setActiveTab(tab)
      setSortDir('desc')
    }
  }

  function toggleTheme(ticker) {
    // A manual toggle means the user has taken over navigation → end the "adding tickers" hint
    // (the jump-to-new-theme flow opens groups directly via setOpenTheme, not through here).
    setAddingTo(null)
    setOpenTheme(prev => {
      if (prev === ticker) return null   // clicking the open one collapses it
      // Bulk-warm bars + ticker-meta for every holding in the just-opened
      // group so any click within it lands on a populated SWR cache. Server
      // disk cache makes this cheap (~10ms each, parallelised by the
      // browser), and prefetchBars dedups against in-flight requests.
      const theme = data?.themes?.find(t => t.ticker === ticker)
      if (theme?.holdings?.length) {
        const syms = theme.holdings.map(h => h.sym)
        // Warm the WHOLE just-opened group so arrowing/scrolling it is instant.
        // Daily-only + idle-deferred via the shared helper — NOT all timeframes,
        // which 503-floods the origin at market open and starves the visible chart
        // (see prewarmVisibleList). Intraday warms on-demand per clicked symbol.
        prewarmVisibleList(syms, { chartTf: chartPeriod })
      }
      return ticker                      // opening a new one closes the previous
    })
  }

  // Row-hover prefetch: by the time the click commits (~200ms of mouse-down
  // latency on average), the bars are already in flight or cached.
  const handleHoverSym = useCallback(sym => {
    prefetchBarOnIntent(sym, chartPeriod)
  }, [chartPeriod])

  const chartRef = useRef(null)

  useEffect(() => {
    // External (hub-driven) selection isn't tied to a specific theme instance,
    // so drop the instance key → highlight/nav fall back to the bare symbol.
    if (hubSym && hubSym !== selectedSym) { setSelectedSym(hubSym); setSelectedNavKey(null) }
  }, [hubSym])  // intentionally do NOT depend on selectedSym (avoid feedback loop)

  function handleSelect(sym, name, themeTicker) {
    markActiveWidget()   // clicking a name locks arrow-nav to this list widget
    setSelectedSym(sym)
    setSelectedNavKey(themeTicker ? `${themeTicker}::${sym}` : null)
    setHubSym(sym)
    setSelectedName(name || sym)
    // On mobile (stacked layout), scroll chart into view after selection
    if (window.innerWidth <= 900) {
      setTimeout(() => {
        chartRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 50)
    }
  }

  const sortedThemes = useMemo(() => {
    if (!data?.themes) return []
    return [...data.themes].sort((a, b) => {
      const av = groupReturn(a, activeKey) ?? (sortDir === 'desc' ? -Infinity : Infinity)
      const bv = groupReturn(b, activeKey) ?? (sortDir === 'desc' ? -Infinity : Infinity)
      return sortDir === 'desc' ? bv - av : av - bv
    })
  }, [data, activeKey, sortDir])

  // The debounced query drives the expensive filter. The instant typed value
  // lives inside <ThemeSearchBox> (memoized) so a keystroke never re-renders
  // this whole page — setDebouncedSearch is a stable useState setter, so the
  // search box never re-renders because of the parent either.
  const [debouncedSearch, setDebouncedSearch] = useState('')

  // Shared matcher: name/ticker/sector match on any length; the expensive
  // per-holding substring scan is gated to queries ≥ 2 chars so a single char
  // ("a") doesn't pull in every theme via some random holding (mega-review: noisy).
  const themeMatches = useCallback((theme, q) =>
    theme.name.toLowerCase().includes(q) ||
    theme.ticker.toLowerCase().includes(q) ||
    (theme.sector || '').toLowerCase().includes(q) ||
    (q.length >= 2 && theme.holdings.some(h => h.sym.toLowerCase().includes(q))),
  [])

  const filteredThemes = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase()
    if (!q) return sortedThemes
    return sortedThemes.filter(theme => themeMatches(theme, q))
  }, [sortedThemes, debouncedSearch, themeMatches])

  // What actually renders: edit mode uses the locally-built, FIXED-ORDER list (no re-sort on
  // edit, so adding a stock never reorders the tracker); view mode uses the sorted leaderboard.
  const renderThemes = useMemo(() => {
    if (!editing || !editDisplayThemes) return filteredThemes
    const q = debouncedSearch.trim().toLowerCase()
    return q ? editDisplayThemes.filter(theme => themeMatches(theme, q)) : editDisplayThemes
  }, [editing, editDisplayThemes, filteredThemes, debouncedSearch, themeMatches])

  // Just added a theme → scroll it into view and pulse-highlight it (deps include renderThemes so
  // the scroll retries the moment the new row is actually in the DOM). Highlight fades after ~1.8s.
  useEffect(() => {
    if (!flashKey) return
    const el = groupRefs.current[flashKey]
    if (el?.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    const t = setTimeout(() => setFlashKey(null), 1800)
    return () => clearTimeout(t)
  }, [flashKey, renderThemes])

  // ── Send the ranking to the Journal (page-seam capture door — panel batch
  // 3). The widget has no chrome of its own (it IS this page), so the door
  // rides the search row beside the gear. Payload freeze (owner-approved):
  // the VISIBLE leaderboard — ETF ticker, theme name, period return, top
  // holdings — as it stands; the taxonomy versions forward and returns have
  // no as-of endpoint, so the capture is the only record of that ranking.
  const [journalMsg, setJournalMsg] = useJournalToast()
  // Wave 1 (P1-1): the destination+comment picker state; {anchor, capture}.
  const [captureMenu, setCaptureMenu] = useState(null)
  const themesCaptureLabel = `Themes ${PERIOD_LABELS[activeKey] || activeKey}`
  // Freeze exactly what the page shows right now — shared by the one-click
  // default send AND the destination-picker, so both paths capture the
  // identical payload rather than re-deriving it a second time at Send.
  const buildThemesCapture = useCallback(() => {
    const rows = filteredThemes.slice(0, 40).map((t) => {
      const pct = groupReturn(t, activeKey)
      const top = [...(t.holdings || [])]
        .sort((a, b) => (b.returns?.[activeKey] ?? -Infinity) - (a.returns?.[activeKey] ?? -Infinity))
        .slice(0, 3).map((h) => h.sym).join(' · ')
      return {
        sym: t.ticker,
        note: t.name,
        ...(Number.isFinite(pct) ? { chgPct: pct } : {}),
        ...(top ? { extraValue: top } : {}),
      }
    })
    return {
      period: activeKey, sortDir,
      ...(openTheme ? { openTheme } : {}),
      ...(debouncedSearch.trim() ? { search: debouncedSearch.trim() } : {}),
      rows,
    }
  }, [filteredThemes, activeKey, sortDir, openTheme, debouncedSearch])
  const sendThemesToJournal = useCallback(async () => {
    setJournalMsg('sending…')
    setJournalMsg(await sendCaptureToJournal('themes', buildThemesCapture(), { label: themesCaptureLabel }))
  }, [buildThemesCapture, themesCaptureLabel, setJournalMsg])

  // While searching, open the FIRST matching theme (accordion stays single-open).
  useEffect(() => {
    const q = debouncedSearch.trim().toLowerCase()
    if (!q || !sortedThemes.length) return
    const match = sortedThemes.find(theme => themeMatches(theme, q))
    if (match) setOpenTheme(match.ticker)
  }, [debouncedSearch, sortedThemes, themeMatches])

  // All themes CLOSED by default — reset on load, timeframe switch, and set switch.
  // The accordion stays single-open; the user opens a theme by clicking it.
  const lastCloseKeyRef = useRef(null)
  useEffect(() => {
    const key = `${activeKey}|${themeSetId || 'default'}`
    if (lastCloseKeyRef.current !== key) {
      setOpenTheme(null)
      lastCloseKeyRef.current = key
    }
  }, [activeKey, themeSetId])

  // Flat list for keyboard navigation — must match visual sort order
  const allStocks = useMemo(() =>
    filteredThemes.flatMap(theme => {
      const sorted = [...theme.holdings].sort((a, b) => {
        const av = a.returns?.[activeKey] ?? (sortDir === 'desc' ? -Infinity : Infinity)
        const bv = b.returns?.[activeKey] ?? (sortDir === 'desc' ? -Infinity : Infinity)
        return sortDir === 'desc' ? bv - av : av - bv
      })
      return sorted.map(h => ({ sym: h.sym, name: h.name, themeTicker: theme.ticker, key: `${theme.ticker}::${h.sym}` }))
    }), [filteredThemes, activeKey, sortDir])

  // ── Live percentages ── Stream real-time prices for the holdings of EXPANDED
  // themes only (bounded, user-controlled — never the whole ~2k-symbol universe,
  // which would fan out the single-process SSE backend). Each % is recomputed
  // client-side from the live price + the per-period ref close (see liveReturn).
  const expandedSyms = useMemo(() => {
    const s = new Set()
    for (const theme of filteredThemes) {
      if (openTheme === theme.ticker) {
        for (const h of theme.holdings) if (h.sym) s.add(h.sym)
      }
    }
    return [...s]
  }, [filteredThemes, openTheme])

  // Prices come from TWO feeds, merged:
  //   • useRealtimePrices → the official prev_close (REST) + a Finnhub fallback.
  //   • useRealtimeBarPrices → the Massive bars WS tick price (T/A/AM), the SAME
  //     reliable tick-by-tick feed the chart uses. Finnhub drops/rotates symbols
  //     (OKTA sat 400s+ stale), so the bars price is the authoritative live tick.
  const { prices: rtPrices } = useRealtimePrices(expandedSyms)
  const barPrices = useRealtimeBarPrices(expandedSyms)
  const tickPrices = useMemo(() => {
    const now = Date.now()
    const out = {}
    for (const sym of expandedSyms) {
      const rt = rtPrices[sym]
      const bp = barPrices[sym]
      // freshest-wins: recent Massive tick, else fresh Finnhub — so a gap in
      // either feed never freezes the %. prev_close etc. still come from rt.
      const price = pickFreshPrice(bp, rt, now)
      if (price != null) out[sym] = { ...rt, price }
      else if (rt) out[sym] = rt
    }
    return out
  }, [rtPrices, barPrices, expandedSyms])

  const handleKeyDown = useCallback((e) => {
    // Space advances like ArrowDown (next ticker).
    const navSpace = e.key === ' ' || e.key === 'Spacebar'
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && !navSpace) return
    // Another list widget owns the arrows (user last clicked it) — don't fight it.
    if (activeRef && activeRef.current != null && activeRef.current !== widgetKey) return
    // Don't hijack arrows while user is typing in the search input,
    // any inline editor, etc.
    const tgt = e.target
    if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) return
    // Space also never steals from a control that uses it.
    if (navSpace) {
      const t = tgt?.tagName
      if (t === 'BUTTON' || t === 'A' || t === 'SELECT' || tgt?.getAttribute?.('role') === 'button') return
    }
    const navDown = e.key === 'ArrowDown' || navSpace
    if (!allStocks.length) return
    // Locate by the exact INSTANCE (theme::sym) so navigating a ticker that also
    // lives in another open theme steps to its true neighbor instead of jumping
    // to the other theme's copy. Fall back to the bare symbol (click without a
    // theme, hub sync) — first match, same as before.
    let idx = selectedNavKey ? allStocks.findIndex(s => s.key === selectedNavKey) : -1
    if (idx < 0) idx = allStocks.findIndex(s => s.sym === selectedSym)
    // If selection is not in THIS widget's universe, don't fight another
    // widget's arrow handler (e.g., a Watchlist widget on the same page).
    if (idx < 0 && selectedSym) return
    e.preventDefault()
    e.stopImmediatePropagation()   // this widget owns the arrow — don't double-handle
    markActiveWidget()             // keep the lock here as you keep scanning
    const nextIdx = idx < 0
      ? (navDown ? 0 : allStocks.length - 1)
      : (navDown
          ? Math.min(idx + 1, allStocks.length - 1)
          : Math.max(idx - 1, 0))
    if (nextIdx === idx) return
    const stock = allStocks[nextIdx]
    // Accordion: arrow-navving into a stock opens its theme and closes any other
    // (so scrolling off the end of one theme into the next collapses the first).
    setOpenTheme(stock.themeTicker)
    setSelectedSym(stock.sym)
    setSelectedNavKey(stock.key)
    setSelectedName(stock.name || stock.sym)
    // Publish to hub so a paired Chart widget on the same color group follows.
    setHubSym(stock.sym)
    setTimeout(() => {
      rowRefs.current[stock.key]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }, 30)
  }, [allStocks, selectedSym, selectedNavKey, setHubSym, activeRef, widgetKey])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  // Prefetch all timeframes for current ticker + adjacent tickers for active TF
  useEffect(() => {
    if (!selectedSym || !allStocks.length) return
    prefetchAllTimeframes(selectedSym)
    const idx = allStocks.findIndex(s => s.sym === selectedSym)
    if (idx < 0) return
    const upcoming = allStocks.slice(idx + 1, idx + 6).map(s => s.sym)
    prefetchBars(upcoming, chartPeriod)
  }, [selectedSym, allStocks, chartPeriod])

  // Same-frame scan paint: promote the ±6 arrow-nav neighbors into the synchronous
  // mem cache (and fetch any cold ones) so the NEXT arrow press paints on the first
  // render via StockChart's memPeek fallback — the accelerator Watchlists had and
  // Theme Tracker was missing. Order matches the arrow handler (allStocks).
  const allStockSyms = useMemo(() => allStocks.map(s => s.sym), [allStocks])
  useNeighborWarm(allStockSyms, selectedSym, chartPeriod)
  const { isFlagged, toggle: toggleFlag } = useFlagged()
  const { getTag } = useTickerTags()
  const tickerActions = useTickerActions()

  // Clear flag toast after 1.5s
  useEffect(() => {
    if (!flagToast) return
    const t = setTimeout(() => setFlagToast(null), 1500)
    return () => clearTimeout(t)
  }, [flagToast])

  // Shift+F to flag selected ticker
  useEffect(() => {
    if (!selectedSym) return
    const handler = (e) => {
      // ⛔ `(e.key === 'F' || e.key === 'f')` AND `!e.repeat` ARE BOTH LOAD-BEARING.
      // With CapsLock on, Shift+F yields the LOWERCASE 'f', so an 'F'-only test
      // silently stops flagging. And a held chord auto-repeats ~30x/sec, which on
      // a TOGGLE leaves the flag on whichever parity the release happens to catch.
      // Reported 2026-08-29.
      if (e.shiftKey && (e.key === 'F' || e.key === 'f') && !e.repeat) {
        const willFlag = !isFlagged(selectedSym)
        toggleFlag(selectedSym)
        setFlagToast(willFlag ? 'added' : 'removed')
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selectedSym, isFlagged, toggleFlag])

  return (
    <div
      ref={pageRef}
      className={`${styles.page} ${embedded ? styles.pageEmbedded : ''}`}
      style={ttStyle}
      onPointerDown={markActiveWidget}
      onFocusCapture={markActiveWidget}
    >
      {settingsOpen && (
        <ThemeTrackerSettingsPanel
          settings={ttSettings}
          onChange={patchSettings}
          onReset={resetSettings}
          onClose={() => setSettingsOpen(false)}
          gearEl={settingsBtnRef.current}
          hostEl={pageRef.current}
          themeVars={ttMenuVars}
        />
      )}
      {/* Send-to-Journal confirmation for the ranking door (fixed: reads the
          same in page and widget hosts; below the popup band). */}
      <JournalToast msg={journalMsg} style={{ position: 'fixed', top: 58, right: 16, zIndex: 8400 }} />

      {/* ── Left panel ── */}
      <div className={styles.leftPanel}>

        {/* Period tabs + the Journal / ⚙ cluster on the right (same layout as the
            Watchlist / Scanner pickers — buttons ride the tab row, not the search). */}
        <div className={styles.periodBar}>
          {RANK_TABS.map(tab => (
            <button
              key={tab}
              className={`${styles.periodTab} ${activeTab === tab ? styles.periodTabActive : ''}`}
              onClick={() => handleTabClick(tab)}
            >
              {tab}{activeTab === tab ? (sortDir === 'desc' ? ' ↑' : ' ↓') : ''}
            </button>
          ))}
          <span className={styles.periodBarSpacer} />
          {/* → Journal: freeze the visible ranking into a note (payload capture). */}
          {filteredThemes.length > 0 && (
            <>
              <button
                className={`${styles.settingsBtn} ${styles.journalBtn}`}
                onClick={sendThemesToJournal}
                title="Send this ranking to Journal (frozen list)"
                aria-label="Send this ranking to Journal"
              ><UIcon name="journal" size={14} /></button>
              <button
                className={styles.settingsBtn}
                onClick={(e) => setCaptureMenu({ anchor: { x: e.clientX, y: e.clientY }, capture: buildThemesCapture() })}
                title="Send to Journal — choose where"
                aria-label="Send to Journal — choose where"
              ><UIcon name="chevronDown" size={14} /></button>
              {captureMenu && (
                <CaptureMenu
                  open
                  onClose={() => setCaptureMenu(null)}
                  anchor={captureMenu.anchor}
                  widgetId="themes"
                  capture={captureMenu.capture}
                  label={themesCaptureLabel}
                  onSent={setJournalMsg}
                />
              )}
            </>
          )}
          <button
            ref={settingsBtnRef}
            className={`${styles.settingsBtn} ${styles.gearBtn}${settingsOpen ? ' ' + styles.settingsBtnActive : ''}`}
            onClick={() => setSettingsOpen(o => !o)}
            title="Theme Tracker settings"
            aria-label="Theme Tracker settings"
          ><UIcon name="gear" size={14} /></button>
        </div>

        {/* Search row — the set picker rides alongside the search (no dedicated header row). */}
        {themeSetsEnabled ? (
          <div className={styles.searchRow}>
            <SetPicker
              sets={sets} themeSetId={themeSetId} activeSet={activeSet}
              onSelect={selectSet}
              onCreate={async (name) => { const s = await createSet(name); if (s) selectSet(s.id) }}
              onRename={renameSet}
              onDelete={async (id) => { await deleteSet(id); if (id === themeSetId) selectSet(null) }}
              editing={editing} onToggleEdit={() => editing ? stopEditing() : setEditing(true)}
            />
            <ThemeSearchBox onDebounced={setDebouncedSearch} />
          </div>
        ) : (
          <ThemeSearchBox onDebounced={setDebouncedSearch} />
        )}
        <div className={styles.tableHeader}>
          <span className={styles.themeCol}>
            <span className={styles.thMark} aria-hidden="true">◆</span>
            <span className={styles.colLabel}>Theme</span>
          </span>
          {activeTab === 'Today' ? (
            // Today column header holds the Close|Open basis switch AND the clickable "1D"
            // sort label (asc/desc) — no extra header height (it overflows left into the
            // empty header space). The pill conveys the basis; the label stays "1D".
            <span className={styles.headerBasis}>
              <span className={styles.basisToggle} role="group" aria-label="Today basis">
                <button
                  type="button"
                  className={`${styles.basisBtn} ${todayBasis === 'close' ? styles.basisBtnActive : ''}`}
                  onClick={() => setTodayBasis('close')}
                  title="Measure today from the previous close (includes the overnight gap)"
                >Close</button>
                <button
                  type="button"
                  className={`${styles.basisBtn} ${todayBasis === 'open' ? styles.basisBtnActive : ''}`}
                  onClick={() => setTodayBasis('open')}
                  title="Measure today from the market open (excludes the overnight gap)"
                >Open</button>
              </span>
              <button
                type="button"
                className={`${styles.colLabel} ${styles.colLabelActive} ${styles.sortBtn}`}
                onClick={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')}
                title={sortDir === 'desc' ? 'Sorted high → low (click for low → high)' : 'Sorted low → high (click for high → low)'}
              >
                1D
                <span className={styles.sortCaret}>{sortDir === 'desc' ? '▼' : '▲'}</span>
              </button>
            </span>
          ) : (
            <button
              type="button"
              className={`${styles.colLabel} ${styles.colLabelActive} ${styles.sortBtn}`}
              onClick={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')}
              title={sortDir === 'desc' ? 'Sorted high → low (click for low → high)' : 'Sorted low → high (click for high → low)'}
            >
              {PERIOD_LABELS[activeKey]}
              <span className={styles.sortCaret}>{sortDir === 'desc' ? '▼' : '▲'}</span>
            </button>
          )}
        </div>

        <div className={styles.tableBody}>
          {/* Skeleton ONLY when there's genuinely nothing to show yet. With cached/fallback data
              present the list renders instantly — never a skeleton stacked on top of real rows. */}
          {!editing && (isLoading || isComputing) && filteredThemes.length === 0 && (
            isComputing
              ? <p className={styles.loading}>Computing returns… ready in ~30s</p>
              : <SkeletonTileContent lines={6} />
          )}
          {!editing && !isLoading && !isComputing && (!data || data.themes?.length === 0) && (
            <p className={styles.loading}>No theme data — run the morning wire engine to populate.</p>
          )}
          {editing && renderThemes.length === 0 && (
            <p className={styles.loading}>No themes yet — use ＋ Add theme below to build your list.</p>
          )}
          {renderThemes.map(theme => {
            const tk = theme.custom_key || theme.ticker   // custom themes share ticker "INDEX"
            return (
            <ThemeGroup key={tk} themeKey={tk} theme={theme} selectedSym={selectedSym} selectedNavKey={selectedNavKey} onSelectSym={handleSelect}
              activeKey={activeKey} sortDir={sortDir} open={openTheme === tk} onToggle={toggleTheme}
              rowRefs={rowRefs} rotationRanking={rotationRankings[theme.ticker]} getTag={getTag}
              tickerActions={tickerActions} onHoverSym={handleHoverSym}
              prices={openTheme === tk ? tickPrices : null}
              tintEnabled={ttSettings.tintEnabled} showLogos={ttSettings.showLogos} logoSize={rowLogoSize}
              editing={editing} onHideTheme={removeTheme} onRemoveSym={removeSym} onAddSym={addSym}
              groupRefs={groupRefs} flash={flashKey === tk} autoFocusAdd={addingTo?.key === tk} />
            )
          })}
        </div>
      </div>

      {/* ── Edit command bar — the taller bottom bar shown ONLY while editing. Holds
          "＋ Add theme", Reset, and either the save-as-preset input (editing Default) or
          the auto-save hint (editing a preset); flips to an "adding tickers" hint after a
          theme is added (the actual ticker input is inline in the highlighted theme above). ── */}
      {editing && themeSetsEnabled && (
        <div className={styles.editBar}>
          <AddThemePicker
            up
            palette={themePalette}
            inSet={new Set(themeOrder ?? (data?.themes || []).map(t => themeSlug(t.name)))}
            onAdd={addThemeToSet} onCreateCustom={createCustomTheme}
          />
          <button className={styles.editBarReset} onClick={resetToDefault} title="Reset back to the UCT default">Reset</button>
          <span className={styles.editBarSpacer} />
          {addingTo ? (
            <div className={styles.editBarAdding}>
              <span className={styles.editBarAddingLabel}>Adding to <b>{addingTo.name}</b> ↑</span>
              <button className={styles.editBarDone} onClick={() => setAddingTo(null)}>Done</button>
            </div>
          ) : activeSet ? (
            <span className={styles.editBarHint}>{stockCount} {stockCount === 1 ? 'stock' : 'stocks'} · saved automatically</span>
          ) : (
            <div className={styles.editBarSaveAs}>
              <input
                className={styles.editBarSaveInput}
                placeholder="Name to save as preset…"
                value={saveName}
                onChange={e => setSaveName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && saveName.trim()) saveAsPreset(saveName) }}
              />
              <button className={styles.editBarSaveGo} disabled={!saveName.trim()} onClick={() => saveAsPreset(saveName)}>Save preset</button>
            </div>
          )}
        </div>
      )}

      {/* ── Footer (embedded widget only): stock count · last-updated · manual refresh ── */}
      {embedded && !editing && (
        <div className={styles.ttFooter}>
          <span className={styles.ttFooterCount}>{stockCount} {stockCount === 1 ? 'stock' : 'stocks'}</span>
          {(data?.live_as_of || data?.generated_at) && (
            <span className={styles.ttFooterUpdated}>· Updated {fmtEtTime(data.live_as_of || data.generated_at)} ET</span>
          )}
          <button
            type="button"
            className={styles.ttFooterRefresh}
            onClick={onRefresh}
            title="Refresh themes"
            aria-label="Refresh themes"
          >
            <UIcon name="refresh" size={12} gold={false}
              className={refreshing ? styles.ttFooterRefreshSpin : undefined} />
          </button>
        </div>
      )}

      {/* ── Right panel — hidden in embedded mode ── */}
      {!embedded && (
        <div className={styles.rightPanel} ref={chartRef}>
          {themeIdx.isIndex ? (
            <>
              <div className={styles.chartHeader}>
                {/* Thematic indexes have no company ticker → no logo.dev logo.
                    Use the Uncharted Territory compass mark as the brand logo. */}
                <span className={styles.stockLogo} style={{ width: 20, height: 20 }}>
                  {/* 20px (vs 16 for company logos): the mark has transparent padding
                      + pointed arms and isn't clipped to a filled circle, so it reads
                      smaller at the same box size. */}
                  <img src={uctMark} alt="Uncharted Territory" width={20} height={20} style={{ display: 'block', objectFit: 'contain' }} />
                </span>
                <span className={styles.chartName} style={{ fontWeight: 700, color: 'var(--ut-gold)' }}>{themeIdx.name || selectedName}</span>
                <span className={styles.chartName} style={{ opacity: 0.55 }}>Equal-Weight Index</span>
                <div className={styles.chartPeriodTabs}>
                  {[['D', 'Daily'], ['W', 'Weekly'], ['M', 'Monthly']].map(([p, label]) => (
                    <button
                      key={p}
                      className={`${styles.chartPeriodBtn} ${indexTf === p ? styles.chartPeriodBtnActive : ''}`}
                      onClick={() => setChartPeriod(p)}
                    >{label}</button>
                  ))}
                </div>
              </div>
              <StockChart
                sym={selectedSym}
                tf={indexTf}
                barsOverride={themeIdx.bars}
                barsOverridePending={themeIdx.loading}
                watermark={themeIdx.name || selectedName.replace(/ Index$/, '')}
                watermarkName={`${themeIdx.name || selectedName.replace(/ Index$/, '')} Index`}
                liveUpdates={false}
                hidePriceLine
              />
              <div className={styles.newsLabel}>Equal-weight index — {themeIdx.name || selectedName}</div>
            </>
          ) : selectedSym ? (
            <>
              <div className={styles.chartHeader}>
                <span className={styles.chartName}>{selectedName}</span>
                {flagToast && (
                  <span className={`${styles.flagToast} ${flagToast === 'added' ? styles.flagToastAdded : styles.flagToastRemoved}`}>
                    {flagToast === 'added' ? <><UIcon name="flag" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />Flagged</> : <><UIcon name="flag" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />Removed</>}
                  </span>
                )}
                <button
                  className={`${styles.flagBtn}${isFlagged(selectedSym) ? ' ' + styles.flagBtnActive : ''}`}
                  onClick={() => { const willFlag = !isFlagged(selectedSym); toggleFlag(selectedSym); setFlagToast(willFlag ? 'added' : 'removed') }}
                  title={isFlagged(selectedSym) ? 'Remove from Flagged (Shift+F)' : 'Add to Flagged (Shift+F)'}
                ><UIcon name="flag" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />{isFlagged(selectedSym) ? 'Flagged' : 'Flag'}</button>
              </div>
              {/* ChartPane owns the identity row (ticker search + company name +
                  session toggle + clock) and the timeframe bar now — the page's
                  own SymbolSearch + period-tabs row used to sit here and would
                  just duplicate ChartPane's canonical ones, so both are retired. */}
              <Suspense fallback={<div className={styles.chartEmpty}>Loading chart…</div>}>
                <ChartPane
                  sym={selectedSym}
                  tf={chartPeriod}
                  onSymbolChange={(s) => { setSelectedSym(s); setSelectedName('') }}
                  onTfChange={setChartPeriod}
                  stored={null}
                />
              </Suspense>
              <div className={styles.newsLabel}>News — {selectedSym}</div>
            </>
          ) : (
            <div className={styles.chartEmpty}>
              Select a ticker to view chart
            </div>
          )}
        </div>
      )}
      {tickerActions.menu && <TickerActionsMenu menu={tickerActions.menu} onClose={tickerActions.closeMenu} />}
    </div>
  )
}

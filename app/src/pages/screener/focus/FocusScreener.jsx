// FocusScreener — the Focus layout's orchestrator (spec 2026-10-13): one top bar,
// a slim results list, one big chart that follows the selection. Table mode is
// today's page (ScannerShell), unchanged, under a slim bar that only switches back.
//
// The two modes never run at once: each owns its own useScreenSpec, and both
// read the working screen from the URL on mount, so a screen built in one mode
// is the screen the other opens on.
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AuthContext } from '../../../context/AuthContext'
import useScreenerMeta from '../hooks/useScreenerMeta'
import useScreenerScan from '../hooks/useScreenerScan'
import useScreenerCount from '../hooks/useScreenerCount'
import useSavedScreens from '../hooks/useSavedScreens'
import useScreenSpec, { REQUIRED_COLS } from '../shell/useScreenSpec'
import { scanErrorText } from '../shell/scanErrorText'
import { LIVE_WINDOW } from '../shell/VirtualResults'
import { LIVE_SORTABLE, sortRowsLive } from '../shell/liveSort'
import { exportScreen } from '../shell/csvExport'
import { buildScreenerCapture } from '../shell/notebookCapture'
import ScannerShell from '../shell/ScannerShell'
import { DEFAULT_SORT, SPEC_PARAM } from '../shell/specUrl'
import { SAVED_SCREEN_PARAM } from '../shell/useScreenSpec'
import { SHARED_SCREEN_PARAM } from '../screenShareLink'
import FlaggedActions from '../shell/FlaggedActions'
import { joinedScanReceipts } from '../ScanFilterChip'
import { COLUMN_DEFS } from '../columnDefs'
import { exportQuota, downloadExport } from '../../../lib/dataExport'
import useRealtimePrices from '../../../hooks/useRealtimePrices'
import usePreferences, { parsePref } from '../../../hooks/usePreferences'
import { useFlagged } from '../../../hooks/useFlagged'
import { prefetchBars } from '../../../utils/prefetchBars'
import { chartsLinkPath } from '../../../lib/chartDeepLink'
import { SkipLinkPortal } from '../../../components/skipLinks'
import Sheet from '../../../components/mobile/Sheet'
import MethodologyPanel from '../../../components/screener/MethodologyPanel'
import StructureProvenance from '../../../components/screener/StructureProvenance'
import { approvedChecklist } from '../../../components/howTo/howToChecklists'
import HowToChecklist from '../../../components/howTo/HowToChecklist'
import useScreenerHubSection from '../../../hub/sections/screenerSection'
import { useHubEligible } from '../../../hub/useHubActive'
import FocusTopBar, { ModeSwitch } from './FocusTopBar'
import ScreenMenu from './ScreenMenu'
import FiltersDrawer from './FiltersDrawer'
import SaveMenu from './SaveMenu'
import MoreMenu from './MoreMenu'
import HelpMenu from './HelpMenu'
import Menu, { MenuItem, MenuHeading } from './Menu'
import DataReceipt, { coverageHasDrop } from './DataReceipt'
import ResultList from './ResultList'
import ChartPane from './ChartPane'
import { ListSkeleton, EmptyState, ErrorState } from './FocusStates'
import useFocusSelection from './useFocusSelection'
import useWatchlistTarget from './useWatchlistTarget'
import { whyItsHere, whyColumns } from './whyItsHere'
import { describeEmptying } from './emptyUndo'
import { migratePinned } from './screenGroups'
import { useNameDialog } from './useNameDialog'
import {
  useRadar, useSaveDoors, poolOptions, createScreen, updateScreen,
  saveFrozenList, saveStandingAlert, saveToNotebook,
} from './focusActions'
import styles from './FocusScreener.module.css'

// Every column the list, the chart header and the setup line read. Each must be a
// real snapshot column: the scan refuses an unknown one with a 400.
const LIST_COLUMNS = ['base_render', 'vol_ratio', 'rs_rank', 'market_cap', 'adr_pct', 'industry', 'sector', 'next_earnings_date']
const MODE_KEY = 'uct.screener.layout'
const PIN_KEY = 'uct.screener.pinned'
const DENSITY_KEY = 'uct.screener.density'
const COMPANY_KEY = 'uct.screener.showCompany'
const POOL_KEYS = ['universe', 'list']
const TOAST_MS = 4500
const readLS = (k, d) => { try { return localStorage.getItem(k) ?? d } catch { return d } }
const writeLS = (k, v) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } }
const fmtN = v => Number(v || 0).toLocaleString('en-US')

// The comparable part of a screen: its criteria, never its pool, sort or columns.
function normalSpec(sp) {
  const f = (sp?.filters || []).filter(x => x && !POOL_KEYS.includes(x.key))
    .map(({ key, op, min, max, value, values }) => ({ key, op, min, max, value, values }))
    .sort((a, b) => String(a.key).localeCompare(String(b.key)))
  return JSON.stringify({ f, logic: sp?.logic || null, rank: sp?.rank || null })
}

export default function FocusScreener() {
  const [mode, setMode] = useState(() => (readLS(MODE_KEY, 'list') === 'table' ? 'table' : 'list'))
  const onMode = useCallback(m => { setMode(m); writeLS(MODE_KEY, m) }, [])
  if (mode === 'table') {
    return (
      <div className={styles.page} data-testid="focus-screener" data-mode="table">
        <header className={styles.topBar}>
          <span className={styles.spacer} />
          <ModeSwitch mode={mode} onMode={onMode} />
        </header>
        <div className={styles.tableMode}>
          {/* Screener.jsx hides its own checklist while the Focus layout is on; Table mode keeps it reachable. */}
          <HowToChecklist surface="screener.stocks" />
          <ScannerShell />
        </div>
      </div>
    )
  }
  return <FocusList onMode={onMode} />
}

function FocusList({ onMode }) {
  const navigate = useNavigate()
  const { meta, error: metaError, retry: retryMeta } = useScreenerMeta()
  const viewColumnsFor = useMemo(() => {
    const map = Object.fromEntries((meta?.views || []).map(v => [v.key, v.columns]))
    return key => map[key] || map.overview || null
  }, [meta])
  const s = useScreenSpec({ viewColumnsFor })

  // ── the scan ─────────────────────────────────────────────────────────────
  // Retry must change the spec's JSON or useScreenerScan refires nothing (ScannerShell's recipe).
  const [retryNonce, setRetryNonce] = useState(0)
  const columns = useMemo(() => [...new Set([...REQUIRED_COLS, ...LIST_COLUMNS, ...whyColumns(s.filters)])], [s.filters])
  const scanSpec = useMemo(() => ({ ...s.scanSpec, columns, ...(retryNonce ? { _retry: retryNonce } : {}) }), [s.scanSpec, columns, retryNonce])
  const { result, isLoading, error } = useScreenerScan(scanSpec)
  const { count, isLoading: countLoading } = useScreenerCount(s.baseSpec)

  // The screen's identity for the selection: a new screen starts at row 0; paging,
  // a live re-sort or a retry of the same screen keep the selected stock.
  const screenSig = JSON.stringify({ f: s.filters, l: s.logic, r: s.rank, sort: s.sort })

  // Each new scan answer is folded in ONCE, during render (React's "adjust state when an
  // input changes" pattern), so the rows, the selection's reset key and the empty-state
  // bookkeeping all move in the same render as the answer:
  //  · rows accumulate across pages, as in ScannerShell;
  //  · the reset key moves only on a page-1 answer, to the screen it answered, so a new
  //    screen starts at row 0 while paging, a live re-sort or a retry keep the stock;
  //  · `prev` is the last screen that had rows, for "your last change took it to 0".
  //  · a later page that comes back EMPTY ends paging (`exhausted`), whatever `total`
  //    says, so the list's load-more re-arm cannot ask for the same empty page forever.
  const [answered, setAnswered] = useState({ result: null, rows: [], total: null, rowsKey: '', exhausted: false,
    prev: { filters: null, baseSpec: null, total: null }, lastChange: null })
  if (result && result !== answered.result) {
    const page1 = result.page === 1
    let { prev, lastChange: change } = answered
    if (page1) {
      const defs = Object.fromEntries((meta?.filters || []).map(f => [f.key, f]))
      const desc = describeEmptying({ prevSpec: { filters: prev.filters }, prevTotal: prev.total,
        nextSpec: { filters: s.filters }, nextTotal: result.total, defs })
      change = desc ? { ...desc, undo: prev } : null
      if (result.total > 0) prev = { filters: s.filters, baseSpec: s.baseSpec, total: result.total }
    }
    setAnswered({
      result, total: result.total, prev, lastChange: change,
      rows: page1 ? (result.rows || []) : [...answered.rows, ...(result.rows || [])],
      rowsKey: page1 ? screenSig : answered.rowsKey,
      exhausted: page1 ? false : !(result.rows || []).length,
    })
  }
  const { rows, total, rowsKey, lastChange, exhausted } = answered
  const hasMore = total != null && rows.length < total && !exhausted

  const liveTickers = useMemo(() => rows.slice(0, LIVE_WINDOW).map(r => r.ticker), [rows])
  const { prices = {} } = useRealtimePrices(liveTickers) || {}
  useEffect(() => { if (rows.length) prefetchBars(rows.slice(0, 30).map(r => r.ticker), 'D') }, [rows])
  const [liveSortOn, setLiveSortOn] = useState(false)
  const liveSortEligible = LIVE_SORTABLE.has(s.sort?.key)
  const displayRows = useMemo(() => (liveSortOn && liveSortEligible ? sortRowsLive(rows, s.sort, prices) : rows),
    [liveSortOn, liveSortEligible, rows, s.sort, prices])

  // ── toast ────────────────────────────────────────────────────────────────
  const [toast, setToast] = useState(null) // {msg, changeList}
  const toastTimer = useRef(null)
  const armToast = useCallback(() => {
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS)
  }, [])
  const say = useCallback((msg, opts = {}) => { if (!msg) return; setToast({ msg, ...opts }); armToast() }, [armToast])
  useEffect(() => () => clearTimeout(toastTimer.current), [])
  const holdToast = () => clearTimeout(toastTimer.current)

  // ── row actions ──────────────────────────────────────────────────────────
  const { toggle: toggleFlag, isFlagged } = useFlagged()
  const watch = useWatchlistTarget()
  const watchAdd = watch.add
  const onWatch = useCallback(async row => {
    const out = await watchAdd(row.ticker)
    say(out.message, { changeList: true })
  }, [watchAdd, say])
  const onFlag = useCallback(row => toggleFlag(row.ticker), [toggleFlag])
  const onOpen = useCallback(row => navigate(chartsLinkPath({ symbol: row.ticker, tf: 'D' })), [navigate])
  const pageRef = useRef(null)
  // After choosing a list, focus goes back to the results so the next W adds there.
  const pickList = l => {
    watch.setTarget(l.id)
    say(`W now adds to ${l.name}`, { changeList: true })
    pageRef.current?.querySelector('[data-focus-list]')?.focus()
  }

  const sel = useFocusSelection({ rows: displayRows, resetKey: rowsKey, hasMore, onLoadMore: s.loadMore, onOpen, onFlag, onWatch })

  // ── the joystick hub (phones/tablets), registered over the rows AS SHOWN, like ScannerShell.
  // Its screens door opens the screen menu. Where the hub cannot exist (useHubEligible, the gate
  // its own mount uses) its cursor is ignored entirely: no row props, no sync.
  const screenMenuApi = useRef(null)
  const openScreens = useCallback(() => { screenMenuApi.current?.open() }, [])
  const hubOn = useHubEligible()
  const { resultsRef: hubResultsRef, hubMount, cursor: hubCursor } = useScreenerHubSection({ displayRows, filters: s.filters, prices, hasMore, loadMore: s.loadMore, onOpenScans: openScreens })
  const hubIndex = hubCursor.index
  const hubScrubTo = hubCursor.scrubTo
  const selectRow = sel.select
  // Where the hub can exist, the list selection and the hub cursor are kept in step BOTH ways.
  // The cursor has no setIndex; scrubTo(i / (count - 1)) lands exactly on i. A local move (keys,
  // click) or a new screen (reset to row 0) is written into the cursor; a cursor move from the
  // pad is written into the selection. A new screen wins over the cursor's follow-the-ticker.
  const sync = useRef({ sel: sel.index, hub: hubIndex, key: rowsKey })
  useEffect(() => {
    const prev = sync.current
    sync.current = { sel: sel.index, hub: hubIndex, key: rowsKey }
    if (!hubOn || !displayRows.length || sel.index === hubIndex) return
    if (prev.key !== rowsKey || prev.sel !== sel.index) {
      const n = displayRows.length
      hubScrubTo?.(n > 1 ? sel.index / (n - 1) : 0)
    } else if (prev.hub !== hubIndex && hubIndex >= 0) {
      selectRow(hubIndex)
    }
  }, [hubOn, sel.index, hubIndex, rowsKey, displayRows.length, hubScrubTo, selectRow])
  const radar = useRadar(displayRows)

  // ── drawer and sheets ────────────────────────────────────────────────────
  const [filtersOpen, setFiltersOpen] = useState(false)
  const focusSearchNext = useRef(false)
  const openFilters = useCallback((focusSearch = false) => { focusSearchNext.current = focusSearch; setFiltersOpen(true) }, [])
  // The drawer focuses its first control in its own effect; a parent effect runs
  // after a child's, so "/" can move focus on to "Find a filter" here.
  useEffect(() => {
    if (!filtersOpen || !focusSearchNext.current) return
    focusSearchNext.current = false
    document.querySelector('[role="dialog"][aria-label="Filters"] input[aria-label="Find a filter"]')?.focus()
  }, [filtersOpen])
  const selKeyDown = sel.onKeyDown
  const onListKeyDown = useCallback(e => {
    if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.isComposing) { e.preventDefault(); openFilters(true); return }
    selKeyDown(e)
  }, [selKeyDown, openFilters])
  const [sheet, setSheet] = useState(null) // 'howto' | 'methodology' | 'library' | null
  const howToOn = useContext(AuthContext)?.howToChecklistsEnabled === true
  const howTo = howToOn ? approvedChecklist('screener.stocks') : null

  // ── screen identity (which starter or saved screen is applied) ───────────
  const { saved, starters, error: savedError, loaded: savedLoaded, refresh } = useSavedScreens()
  const [askName, nameDialog] = useNameDialog()
  const [current, setCurrent] = useState(null) // {id, name, kind, spec}
  const isEdited = !!current && normalSpec(current.spec) !== normalSpec(s.baseSpec)
  const { prefs } = usePreferences()
  const [pinned, setPinned] = useState(() => { try { const v = JSON.parse(readLS(PIN_KEY, 'null')); return Array.isArray(v) ? v.map(String) : null } catch { return null } })
  // Until the member pins something here, Pinned is migrated from the old favourites and
  // chip prefs (read only; nothing is written back to them).
  const effectivePinned = useMemo(() => pinned ?? migratePinned({
    favorites: parsePref(prefs.screener_favorite_screens, []).filter(k => typeof k === 'string' && k.startsWith('starter:')).map(k => k.slice(8)),
    chipPrefs: parsePref(prefs.screener_preset_chips, []).filter(k => typeof k === 'string'),
    starters,
  }), [pinned, prefs.screener_favorite_screens, prefs.screener_preset_chips, starters])
  const togglePin = id => {
    const k = String(id)
    const next = effectivePinned.includes(k) ? effectivePinned.filter(x => x !== k) : [...effectivePinned, k]
    setPinned(next); writeLS(PIN_KEY, JSON.stringify(next))
  }
  const applyScreen = (spec, item) => { s.applySpec(spec); setCurrent({ id: item.id, name: item.name, kind: item.kind, spec }) }
  // First load lands on a named screen: with no spec and no door in the URL, the first pinned
  // screen is applied once per mount, through the same path the screen menu uses. A URL that
  // carried a spec or a door at mount, or any filter the member has already set, wins.
  const arrivedBare = useRef(null)
  if (arrivedBare.current === null) {
    const q = new URLSearchParams(window.location.search)
    arrivedBare.current = ![SPEC_PARAM, SHARED_SCREEN_PARAM, SAVED_SCREEN_PARAM].some(k => q.has(k))
  }
  const autoApplied = useRef(false)
  useEffect(() => {
    if (autoApplied.current) return
    if (!arrivedBare.current || current) { autoApplied.current = true; return }
    if (!savedLoaded) return
    autoApplied.current = true
    if (Object.keys(s.filters).some(k => s.filters[k] && !POOL_KEYS.includes(k))) return
    const hit = effectivePinned.map(id => {
      const st = starters.find(x => String(x.id) === String(id))
      if (st) return { ...st, kind: 'starter' }
      const sv = saved.find(x => String(x.id) === String(id))
      return sv ? { ...sv, kind: 'saved' } : null
    }).find(Boolean)
    if (hit) applyScreen(hit.spec || { filters: [] }, hit)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedLoaded, effectivePinned, starters, saved, current])
  const myScans = useMemo(() => ((meta?.filters || []).find(f => f.key === 'scan')?.scans || [])
    .filter(x => x?.def_hash).map(x => ({ hash: x.def_hash, name: x.name || 'Untitled scan' })), [meta])
  const applyScanFilter = (hash, name) => {
    // Adds to any scan filter already on, as ScannerShell's escape hatch does.
    const cur = s.filters?.scan
    const have = cur ? (Array.isArray(cur.value) ? cur.value : [cur.value]) : []
    const value = have.includes(hash) ? have : [...have, hash]
    s.setFilter('scan', { op: 'in', value: value.length === 1 ? value[0] : value, label: name })
  }

  // ── empty-state undo ─────────────────────────────────────────────────
  const undoLast = () => {
    const u = lastChange?.undo
    if (!u?.baseSpec) return
    s.applySpec(u.baseSpec)
    // applySpec carries the current pool forward on purpose; an undo restores the old one exactly.
    for (const k of POOL_KEYS) s.setFilter(k, u.filters?.[k] || null)
  }

  // ── exports ──────────────────────────────────────────────────────────────
  const [serverExport, setServerExport] = useState(null)
  useEffect(() => { let live = true; exportQuota().then(q => { if (live) setServerExport(q) }); return () => { live = false } }, [])
  const exportBody = { ...s.baseSpec, columns }
  const serverExportAs = async format => {
    try {
      const out = await downloadExport('/api/exports/screener', { method: 'POST', format, body: exportBody })
      say(`Exported ${fmtN(out.rows)} rows (${format.toUpperCase()})`)
      exportQuota().then(setServerExport)
    } catch (e) { say(`${e?.message || 'Export failed.'} Nothing was downloaded.`) }
  }
  const exportCsv = async () => {
    if (serverExport) { await serverExportAs('csv'); return }
    try {
      const labels = Object.fromEntries(columns.map(c => [c, COLUMN_DEFS[c]?.label || c]))
      const out = await exportScreen({ spec: exportBody, columns, labels, snapshotDate: result?.snapshot_date })
      say(`Exported ${fmtN(out.rows)} rows${out.truncated ? ' (capped at 5,000)' : ''}`)
    } catch { say('Export failed. Nothing was downloaded.') }
  }

  // ── save outcomes (spec §8.1): each offered only when its door is open ───
  const doors = useSaveDoors()
  const scanReceipts = useMemo(() => joinedScanReceipts({
    scans: (meta?.filters || []).find(f => f.key === 'scan')?.scans, scanJoins: result?.scan_joins,
  }), [meta, result])
  const saveAsScreen = async () => {
    const name = await askName({ title: 'Save as a screen', label: 'Screen name', initial: current?.kind === 'saved' ? '' : current?.name || '' })
    if (!name) return
    const out = await createScreen(name, s.baseSpec)
    refresh()
    if (!out.ok) { say(out.error); return }
    setCurrent({ id: out.screen?.id, name, kind: 'saved', spec: s.baseSpec })
    say(`Saved "${name}"`)
  }
  const saveChanges = async () => {
    const out = await updateScreen(current.id, { spec: s.baseSpec })
    refresh()
    if (!out.ok) { say(out.error); return }
    setCurrent(c => ({ ...c, spec: s.baseSpec }))
    say(`Saved changes to "${current.name}"`)
  }
  const rename = async () => {
    const name = await askName({ title: 'Rename this screen', label: 'Screen name', initial: current.name, submitLabel: 'Rename' })
    if (!name || name === current.name) return
    const out = await updateScreen(current.id, { name })
    refresh()
    if (!out.ok) { say(out.error); return }
    setCurrent(c => ({ ...c, name }))
    say(`Renamed to "${name}"`)
  }
  const frozenList = async () => {
    const name = await askName({ title: "Save today's list", label: 'Watchlist name', initial: current?.name || 'Screen results' })
    if (!name) return
    say(await saveFrozenList(s.baseSpec, name))
    refresh()
  }
  const standingAlert = async () => {
    const name = await askName({ title: 'Alert me on new names', label: 'Alert name', initial: current?.name || 'My screen', submitLabel: 'Set alert' })
    if (!name) return
    say(await saveStandingAlert(s.baseSpec, name))
    refresh()
  }
  const toNotebook = async () => {
    say('Saving…')
    say(await saveToNotebook(buildScreenerCapture({
      meta, filters: s.filters, visibleColumns: columns, displayRows, livePrices: prices,
      spec: { filters: s.filters, sort: s.sort, view: s.view, columns: s.columns, rank: s.rank },
      total, snapshotDate: result?.snapshot_date, snapshot: result?.snapshot, scanReceipts,
    })))
  }
  const hasResult = !!result && total != null

  // "Skip to save results": the keyboard door straight to the Save menu.
  const saveSlotRef = useRef(null)
  const skipToSave = e => { e.preventDefault(); saveSlotRef.current?.querySelector('button')?.focus() }

  // ── derived view state ───────────────────────────────────────────────────
  const filterCount = Object.keys(s.filters).filter(k => s.filters[k] && !POOL_KEYS.includes(k)).length + (s.logic ? 1 : 0)
  const selected = sel.selected
  const why = useMemo(() => whyItsHere({ filters: s.filters, logic: s.logic, rank: s.rank, metaFilters: meta?.filters, row: selected || {} }),
    [s.filters, s.logic, s.rank, meta, selected])
  const lists = useMemo(() => poolOptions(meta), [meta])
  const sortKey = s.sort?.key
  const colLabel = k => (meta?.filters || []).find(f => f.key === k || f.column === k)?.label || COLUMN_DEFS[k]?.label || k
  const sortArrow = s.sort?.dir === 'asc' ? '↑' : '↓'
  const sortLabel = s.rank ? 'Your ranking' : `${colLabel(sortKey) || 'Default'} ${sortArrow}`
  // The sortable set is the table's own: in Table mode every column header sorts (VirtualResults),
  // and those headers are the view's columns from meta (the server sorts by any snapshot column).
  // The current sort key is always offered, so a sort set elsewhere can be seen and reversed.
  const sortKeys = [...new Set([DEFAULT_SORT.key, ...(sortKey ? [sortKey] : []), ...(s.visibleColumns || result?.view_columns || [])])]
    .filter(k => k && k !== 'ticker' && k !== 'company')
  const sortMenu = (
    <Menu label={`Sort: ${sortLabel}`} trigger={<>Sort: <span className={styles.listHeadValue}>{sortLabel}</span></>}
      triggerClassName={styles.linkBtn} width={240} testId="focus-sort-menu">
      <MenuHeading>Sort by</MenuHeading>
      {sortKeys.map(k => (
        <MenuItem key={k} hint={!s.rank && k === sortKey ? sortArrow : undefined}
          onSelect={() => s.setSort({ key: k, dir: k === sortKey && !s.rank ? s.sort.dir : 'desc' })}>{colLabel(k)}</MenuItem>
      ))}
      {!s.rank && (
        <MenuItem onSelect={() => s.setSort({ key: sortKey, dir: s.sort?.dir === 'asc' ? 'desc' : 'asc' })}
          hint={s.sort?.dir === 'asc' ? '↓' : '↑'}>Reverse order</MenuItem>
      )}
    </Menu>
  )
  const [density, setDensity] = useState(() => (readLS(DENSITY_KEY, 'compact') === 'comfortable' ? 'comfortable' : 'compact'))
  const [showCompany, setShowCompany] = useState(() => readLS(COMPANY_KEY, '0') === '1')

  const drops = []
  if (coverageHasDrop(result?.coverage)) {
    drops.push(`${fmtN((result.coverage.dropped || 0) + (result.coverage.not_computable || 0))} stocks could not be checked against every filter. They are left out of this list.`)
  }
  for (const r of scanReceipts) {
    if (coverageHasDrop(r.latest)) drops.push(`The scan filter ${r.label} could not check ${fmtN((r.latest.dropped || 0) + (r.latest.not_computable || 0))} stocks in its last run.`)
  }

  let body
  if (error) {
    // The list is UNMOUNTED on a scan error: its load-more re-arms when a load
    // settles, so a mounted list would retry a failing page in a loop.
    body = <ErrorState message={scanErrorText(error)} onRetry={() => setRetryNonce(n => n + 1)} />
  } else if (!result) {
    body = <div className={styles.body}><div className={styles.listWrap}><ListSkeleton /></div><div className={styles.pane} aria-hidden="true" /></div>
  } else if (total === 0) {
    body = <EmptyState filterCount={filterCount} lastChange={lastChange} onUndo={undoLast} onOpenFilters={() => openFilters()} />
  } else {
    body = (
      <div className={styles.body}>
        <ResultList ref={hubResultsRef} itemProps={hubOn ? hubCursor.itemProps : undefined} rows={displayRows} index={sel.index} onSelect={sel.select} onKeyDown={onListKeyDown}
          livePrices={prices} radar={radar} sortLabel={sortLabel} sortMenu={sortMenu} total={total} hasMore={hasMore}
          onLoadMore={s.loadMore} isLoading={isLoading} showCompany={showCompany} />
        <ChartPane row={selected} livePrice={selected ? prices[selected.ticker] : null} why={why}
          onOpenFilters={() => openFilters()} onFlag={onFlag} isFlagged={selected ? isFlagged(selected.ticker) : false} onWatch={onWatch} />
      </div>
    )
  }

  return (
    <div ref={pageRef} className={styles.page} data-testid="focus-screener" data-mode="list" data-density={density}>
      <SkipLinkPortal>
        <a href="#focus-save" className={styles.skipLink} onClick={skipToSave}>Skip to save results</a>
      </SkipLinkPortal>
      <FocusTopBar
        screenMenu={<ScreenMenu apiRef={screenMenuApi} currentName={current?.name} currentId={current?.id} isEdited={isEdited} count={total}
          starters={starters} saved={saved} pinned={effectivePinned} onTogglePin={togglePin} onApply={applyScreen}
          onSaveChanges={current?.kind === 'saved' && isEdited ? saveChanges : null}
          onSaveAsNew={savedLoaded && !savedError ? saveAsScreen : null}
          onRename={current?.kind === 'saved' ? rename : null}
          onNewScreen={() => { s.clearFilters(); s.setLogic(null); setCurrent(null); openFilters() }}
          myScans={myScans} onUseScan={applyScanFilter} />}
        filterCount={filterCount} onOpenFilters={() => openFilters()}
        dataReceipt={<DataReceipt snapshotDate={result?.snapshot_date} live={result?.snapshot?.live?.state === 'live'} coverage={result?.coverage} />}
        mode="list" onMode={m => { s.flush(); onMode(m) }}
        saveMenu={(
          <span ref={saveSlotRef} id="focus-save" className={styles.saveSlot}>
            <SaveMenu canSaveScreen={savedLoaded && !savedError} canFrozenList={doors.promote && hasResult && total > 0}
              canAlert={doors.alert} canNotebook={hasResult} count={total}
              onSaveScreen={saveAsScreen} onFrozenList={frozenList} onAlert={standingAlert} onNotebook={toNotebook} />
          </span>
        )}
        moreMenu={<MoreMenu onExportCsv={exportCsv} onExportXlsx={serverExport ? () => serverExportAs('xlsx') : null}
          liveSortEligible={liveSortEligible} liveSortOn={liveSortOn} onToggleLiveSort={() => setLiveSortOn(v => !v)}
          density={density} onDensity={d => { setDensity(d); writeLS(DENSITY_KEY, d) }}
          showCompany={showCompany} onToggleCompany={() => setShowCompany(v => { writeLS(COMPANY_KEY, v ? '0' : '1'); return !v })} />}
        helpMenu={<HelpMenu onHowTo={howTo ? () => setSheet('howto') : null} onMethodology={() => setSheet('methodology')}
          onLibrary={() => setSheet('library')} onGlossary={() => openFilters()}
          onShortcuts={() => say('↑ ↓ move · Shift+F flag · W watchlist · Enter full chart · / filters')} />}
      />
      {metaError && !meta && (
        // The list still renders with the current screen; only the filter registry is missing.
        <div className={styles.metaNote} role="alert">
          <span>Filters couldn&apos;t be loaded, so the drawer is empty for now.</span>
          <button type="button" className={styles.btn} onClick={retryMeta}>Retry</button>
        </div>
      )}
      <div className={styles.flagBar}><FlaggedActions /></div>
      {drops.length > 0 && <p className={styles.dropNote} role="status">{drops.join(' ')}</p>}
      {body}
      <FiltersDrawer open={filtersOpen} onClose={() => setFiltersOpen(false)} meta={meta} filters={s.filters} logic={s.logic}
        onSetFilter={s.setFilter} onClear={() => { s.clearFilters(); s.setLogic(null) }} onSetLogic={s.setLogic}
        count={count} countLoading={countLoading} lists={lists} />
      <Sheet open={sheet === 'howto'} onClose={() => setSheet(null)} variant="auto" title={howTo?.title || 'How to use this screen'}
        ariaLabel="How to use this screen" maxWidth={560}>
        {sheet === 'howto' && howTo && <ol className={styles.howToSteps}>{howTo.steps.map((t, i) => <li key={i}>{t}</li>)}</ol>}
      </Sheet>
      <Sheet open={sheet === 'methodology'} onClose={() => setSheet(null)} variant="auto" title="Methodology" ariaLabel="Methodology" maxWidth={880}>
        {sheet === 'methodology' && <MethodologyPanel />}
      </Sheet>
      <Sheet open={sheet === 'library'} onClose={() => setSheet(null)} variant="auto" title="Structure library" ariaLabel="Structure library" maxWidth={880}>
        {sheet === 'library' && <StructureProvenance />}
      </Sheet>
      {hubMount}
      {nameDialog}
      {toast && (
        <div className={styles.toast} role="status" aria-live="polite" data-testid="focus-toast"
          onMouseEnter={holdToast} onMouseLeave={armToast} onFocus={holdToast} onBlur={armToast}>
          <span>{toast.msg}</span>
          {toast.changeList && watch.lists.length > 1 && (
            <Menu label="Change list" trigger="Change list" triggerClassName={styles.toastBtn} align="right" width={220}>
              <MenuHeading>W adds to</MenuHeading>
              {watch.lists.map(l => (
                <MenuItem key={l.id} onSelect={() => pickList(l)} hint={String(l.id) === String(watch.target?.id) ? 'now' : undefined}>{l.name}</MenuItem>
              ))}
            </Menu>
          )}
        </div>
      )}
    </div>
  )
}

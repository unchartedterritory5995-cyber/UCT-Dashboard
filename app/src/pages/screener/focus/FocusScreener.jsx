// FocusScreener — the Focus layout's orchestrator (spec 2026-10-13): one top bar,
// a slim results list, one big chart that follows the selection. Table mode is
// today's page (ScannerShell), unchanged, under a slim bar that only switches back.
//
// The two modes never run at once: each owns its own useScreenSpec, and both
// read the working screen from the URL on mount, so a screen built in one mode
// is the screen the other opens on.
import { Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
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
import { DEFAULT_SORT, SPEC_PARAM } from '../shell/specUrl'
import { SAVED_SCREEN_PARAM } from '../shell/useScreenSpec'
import { SHARED_SCREEN_PARAM } from '../screenShareLink'
import FlaggedActions from '../shell/FlaggedActions'
import { joinedScanReceipts } from '../ScanFilterChip'
import { COLUMN_DEFS } from '../columnDefs'
import { nextSort } from '../../../lib/presentation/dataGrid/gridSort'
import { exportQuota, downloadExport } from '../../../lib/dataExport'
import useRealtimePrices from '../../../hooks/useRealtimePrices'
import usePreferences, { parsePref } from '../../../hooks/usePreferences'
import { useFlagged } from '../../../hooks/useFlagged'
import { prefetchBars } from '../../../utils/prefetchBars'
import { chartsLinkPath } from '../../../lib/chartDeepLink'
import { SkipLinkPortal, SkipLink } from '../../../components/skipLinks'
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
import { activeStructures, structureLabels } from './setupLine'
import { plainColumnLabel } from './plainWords'
import { sortableColumns } from './sortKeys'
import { capToTopN, poolOf } from './counts'
import { livePriceOf } from './livePrice'
import ChartPane from './ChartPane'
import { ListSkeleton, EmptyState, ErrorState } from './FocusStates'
import useFocusSelection from './useFocusSelection'
import useWatchlistTarget from './useWatchlistTarget'
import { whyItsHere, whyColumns } from './whyItsHere'
import { describeEmptying } from './emptyUndo'
import { migratePinned } from './screenGroups'
import { useNameDialog } from './useNameDialog'
import { useShortcutsSheet } from './useShortcutsSheet'
import lazy from '../../../utils/lazyWithRetry'
import { SkeletonTable } from '../../../components/Skeleton'
import { ZERO_MATCH_NOTE } from './NameDialog'
import {
  useRadar, useSaveDoors, poolOptions, createScreen, updateScreen,
  saveFrozenList, saveStandingAlert, saveToNotebook,
} from './focusActions'
import styles from './FocusScreener.module.css'

// Every column the list, the chart header and the setup line read. Each must be a
// real snapshot column: the scan refuses an unknown one with a 400.
const LIST_COLUMNS = ['base_render', 'base_pivot_px', 'vol_ratio', 'rs_rank', 'market_cap', 'adr_pct', 'industry', 'sector', 'next_earnings_date']
const MODE_KEY = 'uct.screener.layout'
const PIN_KEY = 'uct.screener.pinned'
const DENSITY_KEY = 'uct.screener.density'
const COMPANY_KEY = 'uct.screener.showCompany'
const POOL_KEYS = ['universe', 'list']
const TOAST_MS = 4500
// How long a bare first open waits for the saved screens and the member's preferences before
// landing with whatever has answered (the whole universe if neither has).
const LANDING_WAIT_MS = 3000
const readLS = (k, d) => { try { return localStorage.getItem(k) ?? d } catch { return d } }
const writeLS = (k, v) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } }
const fmtN = v => Number(v || 0).toLocaleString('en-US')
// Table mode is today's page, loaded only when a member switches to it (List never ships it).
const ScannerShell = lazy(() => import('../shell/ScannerShell'))

// The comparable part of a screen: its criteria, never its pool, sort or columns.
function normalSpec(sp) {
  const f = (sp?.filters || []).filter(x => x && !POOL_KEYS.includes(x.key))
    .map(({ key, op, min, max, value, values }) => ({ key, op, min, max, value, values }))
    .sort((a, b) => String(a.key).localeCompare(String(b.key)))
  return JSON.stringify({ f, logic: sp?.logic || null, rank: sp?.rank || null })
}
// What the list is an answer to: criteria, pool and sort (not columns or page).
const screenSigOf = sp => JSON.stringify({ f: sp?.filters || [], l: sp?.logic || null, r: sp?.rank || null, sort: sp?.sort || null })

// The named screen (starter or saved) the working spec came from, kept per tab so it
// survives List→Table→List and comes back on back/forward. Keyed by the normalised spec:
// a spec that no longer matches gets no name.
const NAMED_KEY = 'uct.screener.named'
const NAMED_MAX = 25
function readNamed() {
  try { const v = JSON.parse(sessionStorage.getItem(NAMED_KEY) || '{}'); return v && typeof v === 'object' ? v : {} } catch { return {} }
}
function rememberNamed(item) {
  if (!item?.spec) return
  try {
    const sig = normalSpec(item.spec)
    // One entry per screen id: a screen whose spec was saved over is not named at its old spec.
    const rest = Object.entries(readNamed()).filter(([k, v]) => k !== sig && String(v?.id) !== String(item.id))
    const next = Object.fromEntries([...rest.slice(-(NAMED_MAX - 1)), [sig, { id: item.id, name: item.name, kind: item.kind, spec: item.spec }]])
    sessionStorage.setItem(NAMED_KEY, JSON.stringify(next))
  } catch { /* private mode or full: the name is just not kept */ }
}

export default function FocusScreener() {
  const [mode, setMode] = useState(() => (readLS(MODE_KEY, 'list') === 'table' ? 'table' : 'list'))
  const onMode = useCallback(m => { setMode(m); writeLS(MODE_KEY, m) }, [])
  if (mode === 'table') {
    return (
      <div className={styles.page} data-testid="focus-screener" data-mode="table">
        <div className={styles.tableMode}>
          {/* Screener.jsx hides its own checklist while the Focus layout is on; Table mode keeps it reachable. */}
          <HowToChecklist surface="screener.stocks" />
          {/* ONE bar in Table mode: the List|Table switch leads the table's own toolbar (P14). */}
          <Suspense fallback={<SkeletonTable rows={12} cols={6} />}>
            <ScannerShell toolbarLead={<ModeSwitch mode={mode} onMode={onMode} />} />
          </Suspense>
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

  // A bare first open (no spec or door in the URL) lands on the first pinned screen. Until that
  // decision is made the scan and the count are held, so the page asks for the landing screen
  // once instead of the whole universe first and the pinned screen second. A URL that carried
  // a spec or a door decides at mount: nothing is held.
  const arrivedBare = useRef(null)
  if (arrivedBare.current === null) {
    const q = new URLSearchParams(window.location.search)
    arrivedBare.current = ![SPEC_PARAM, SHARED_SCREEN_PARAM, SAVED_SCREEN_PARAM].some(k => q.has(k))
  }
  const [landed, setLanded] = useState(() => !arrivedBare.current)

  // ── the scan ─────────────────────────────────────────────────────────────
  // Retry must change the spec's JSON or useScreenerScan refires nothing (ScannerShell's recipe).
  const [retryNonce, setRetryNonce] = useState(0)
  const columns = useMemo(() => [...new Set([...REQUIRED_COLS, ...LIST_COLUMNS, ...whyColumns(s.filters)])], [s.filters])
  // The screen's identity for the selection: a new screen starts at row 0; paging,
  // a live re-sort or a retry of the same screen keep the selected stock.
  const screenSig = screenSigOf(s.baseSpec)
  // Every spec handed to the scan remembers the screen it was built from, so an answer
  // is filed under the screen that ASKED for it, never under whatever is on screen when it
  // lands (an answer for A arriving after the member moved to B is A's, not B's).
  const askedBy = useRef(new WeakMap())
  const scanSpec = useMemo(() => {
    const sp = { ...s.scanSpec, columns, ...(retryNonce ? { _retry: retryNonce } : {}) }
    askedBy.current.set(sp, { sig: screenSig, filters: s.filters, logic: s.logic, rank: s.rank, baseSpec: s.baseSpec })
    return sp
  }, [s.scanSpec, columns, retryNonce, screenSig, s.filters, s.logic, s.rank, s.baseSpec])
  const { result, answeredSpec, isLoading, error } = useScreenerScan(landed ? scanSpec : null, { leading: true })
  const { count, isLoading: countLoading, error: countError } = useScreenerCount(landed ? s.baseSpec : null)

  // Each new scan answer is folded in ONCE, during render (React's "adjust state when an
  // input changes" pattern), so the rows, the selection's reset key and the empty-state
  // bookkeeping all move in the same render as the answer. Everything is read from the
  // screen the answer was asked for (`asked`), never from the screen shown now:
  //  · rows accumulate across pages, as in ScannerShell; a later page skips any ticker
  //    already loaded, and a later page for a screen other than the one listed is dropped;
  //  · the reset key moves only on a page-1 answer, to the screen it answered, so a new
  //    screen starts at row 0 while paging, a live re-sort or a retry keep the stock;
  //  · `prev` is the last screen that had rows, for "your last change took it to 0", and
  //    the undo it offers survives further changes while the list stays at 0;
  //  · a later page that comes back EMPTY ends paging (`exhausted`), whatever `total`
  //    says, so the list's load-more re-arm cannot ask for the same empty page forever.
  const [answered, setAnswered] = useState({ result: null, rows: [], total: null, rowsKey: '', exhausted: false,
    shown: null, prev: { filters: null, baseSpec: null, total: null }, lastChange: null, dropped: {} })
  // A page-1 answer for the screen now set, folded in as the list.
  const foldPage1 = (base, res, asked) => {
    let { prev, lastChange: change } = base
    const defs = Object.fromEntries((meta?.filters || []).map(f => [f.key, f]))
    const desc = describeEmptying({ prevSpec: { filters: prev.filters }, prevTotal: prev.total,
      nextSpec: { filters: asked.filters }, nextTotal: res.total, defs })
    // A 0→0 step keeps the offer: the undo still goes back to the last screen with rows.
    change = desc ? { ...desc, undo: prev } : (res.total === 0 && base.total === 0 ? change : null)
    // the "took the list from N to 0" number is the count the member saw (S2: capped at top_n)
    if (res.total > 0) prev = { filters: asked.filters, baseSpec: asked.baseSpec, total: capToTopN(res.total, asked) }
    const { [asked.sig]: _used, ...dropped } = base.dropped
    return {
      ...base, result: res, total: res.total, prev, lastChange: change, rows: res.rows || [], rowsKey: asked.sig,
      exhausted: false, shown: { filters: asked.filters, logic: asked.logic, rank: asked.rank, baseSpec: asked.baseSpec }, dropped,
    }
  }
  if (result && result !== answered.result) {
    // A spec this mount did not build is never filed under the screen on view: dropped.
    const asked = (answeredSpec && askedBy.current.get(answeredSpec)) || null
    const page1 = result.page === 1
    if (!asked) {
      setAnswered({ ...answered, result })
    } else if (page1 && asked.sig !== screenSig && asked.sig !== answered.rowsKey) {
      // A superseded intermediate screen: never shown and never the undo target. Its answer is
      // kept aside (the last few, one per screen) in case the member returns to that screen
      // before anything newer is asked: the scan does not ask again for a spec it already sent.
      const kept = Object.entries(answered.dropped).filter(([k]) => k !== asked.sig).slice(-4)
      setAnswered({ ...answered, result, dropped: Object.fromEntries([...kept, [asked.sig, { result, asked }]]) })
    } else if (page1) {
      setAnswered(foldPage1(answered, result, asked))
    } else if (asked.sig !== answered.rowsKey) {
      setAnswered({ ...answered, result }) // a later page counts only for the screen listed
    } else {
      const have = new Set(answered.rows.map(r => r.ticker))
      const fresh = (result.rows || []).filter(r => !have.has(r.ticker) && have.add(r.ticker))
      setAnswered({ ...answered, result, rows: [...answered.rows, ...fresh], exhausted: !fresh.length })
    }
  } else if (answered.rowsKey !== screenSig && answered.dropped[screenSig]) {
    // Back on a screen whose answer arrived while it was not current: adopt it now.
    const d = answered.dropped[screenSig]
    setAnswered({ ...foldPage1(answered, d.result, d.asked), result: answered.result })
  }
  const { rows, total, rowsKey, lastChange, exhausted } = answered
  // The listed rows answer an earlier screen than the one now set: the new screen's answer
  // is still on its way, so the list is shown dimmed and cannot be clicked.
  const pending = !!result && rowsKey !== screenSig
  const shown = answered.shown || { filters: s.filters, logic: s.logic, rank: s.rank }
  // S2: a ranked screen lists at most its top_n; every count shown for the list says so.
  const shownTotal = capToTopN(total, shown)
  const hasMore = shownTotal != null && rows.length < shownTotal && !exhausted && !pending
  // Row actions (Enter, W, Shift+F, the hub's actions) do nothing while the rows are the
  // previous screen's; arrow keys may still move the highlight.
  const pendingRef = useRef(pending)
  pendingRef.current = pending

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
  const watchRow = useCallback(async row => {
    const out = await watchAdd(row.ticker)
    say(out.message, { changeList: true })
  }, [watchAdd, say])
  const onWatch = useCallback(row => { if (!pendingRef.current) watchRow(row) }, [watchRow])
  const onFlag = useCallback(row => { if (!pendingRef.current) toggleFlag(row.ticker) }, [toggleFlag])
  // Write any pending URL change first, so Back from the full chart returns to this screen.
  const flushSpec = s.flush
  const onOpen = useCallback(row => { if (pendingRef.current) return; flushSpec(); navigate(chartsLinkPath({ symbol: row.ticker, tf: 'D' })) }, [flushSpec, navigate])
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
  const { resultsRef: hubResultsRef, hubMount, cursor: hubCursor } = useScreenerHubSection({ displayRows, filters: shown.filters, prices, hasMore, loadMore: s.loadMore, onOpenScans: openScreens, busy: pending })
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
  const shortcuts = useShortcutsSheet()
  // {id, name, kind, spec}. Rehydrated from this tab's named screens when the spec this
  // mount opened on still matches one (List→Table→List remounts this component). A bare
  // arrival carries no spec to match, so it lands on the first pinned screen as before.
  const [current, setCurrent] = useState(() => (arrivedBare.current ? null : readNamed()[normalSpec(s.baseSpec)] || null))
  const specKey = normalSpec(s.baseSpec)
  const isEdited = !!current && normalSpec(current.spec) !== specKey
  useEffect(() => { if (current) rememberNamed(current) }, [current])
  // Spec changes made here (drawer, sort, undo, picking a screen) keep the name, shown as
  // edited. Any other change came from outside: back/forward, the `S:<id>` door, a shared
  // link. Those are named from this tab's named screens or the starter and saved screens
  // when the spec matches one, and lose the old name when it does not.
  const localEdit = useRef(false)
  const ed = useMemo(() => {
    const mine = fn => (...a) => { localEdit.current = true; return fn(...a) }
    return { setFilter: mine(s.setFilter), clearFilters: mine(s.clearFilters), setLogic: mine(s.setLogic),
      setSort: mine(s.setSort), applySpec: mine(s.applySpec) }
  }, [s.setFilter, s.clearFilters, s.setLogic, s.setSort, s.applySpec])
  const seenBase = useRef(s.baseSpec)
  const needsName = useRef(!arrivedBare.current && !current)
  useEffect(() => {
    if (seenBase.current !== s.baseSpec) {
      seenBase.current = s.baseSpec
      needsName.current = !localEdit.current
      localEdit.current = false
    }
    if (!needsName.current) return
    if (current && normalSpec(current.spec) === specKey) { needsName.current = false; return }
    const hit = readNamed()[specKey] || [...starters.map(x => ({ ...x, kind: 'starter' })), ...saved.map(x => ({ ...x, kind: 'saved' }))]
      .find(it => it.spec && normalSpec(it.spec) === specKey)
    if (hit) { needsName.current = false; setCurrent({ id: hit.id, name: hit.name, kind: hit.kind, spec: hit.spec }) }
    else if (current) setCurrent(null)
  }, [s.baseSpec, specKey, starters, saved, current])
  const { prefs, loading: prefsLoading } = usePreferences()
  // Pinned is migrated from the member's prefs, so the landing decision waits for them to answer
  // (a failed read settles too and lands on the defaults). Neither read is waited on forever.
  const [landingWaitOver, setLandingWaitOver] = useState(false)
  useEffect(() => { const t = setTimeout(() => setLandingWaitOver(true), LANDING_WAIT_MS); return () => clearTimeout(t) }, [])
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
  const applyScreen = (spec, item) => { ed.applySpec(spec); setCurrent({ id: item.id, name: item.name, kind: item.kind, spec }) }
  // First load lands on a named screen: with no spec and no door in the URL, the first pinned
  // screen is applied once per mount, through the same path the screen menu uses. A URL that
  // carried a spec or a door at mount, or any filter the member has already set, wins. The
  // decision waits for the saved screens AND the prefs Pinned is migrated from, then releases
  // the held scan (`landed`) in the same render as the applied spec.
  const autoApplied = useRef(false)
  useEffect(() => {
    if (autoApplied.current) return
    const decide = () => { autoApplied.current = true; setLanded(true) }
    if (!arrivedBare.current || current) { decide(); return }
    if (Object.keys(s.filters).some(k => s.filters[k] && !POOL_KEYS.includes(k))) { decide(); return }
    if (!landingWaitOver && (!savedLoaded || prefsLoading)) return
    decide()
    const hit = effectivePinned.map(id => {
      const st = starters.find(x => String(x.id) === String(id))
      if (st) return { ...st, kind: 'starter' }
      const sv = saved.find(x => String(x.id) === String(id))
      return sv ? { ...sv, kind: 'saved' } : null
    }).find(Boolean)
    if (hit) applyScreen(hit.spec || { filters: [] }, hit)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedLoaded, prefsLoading, landingWaitOver, effectivePinned, starters, saved, current])
  const myScans = useMemo(() => ((meta?.filters || []).find(f => f.key === 'scan')?.scans || [])
    .filter(x => x?.def_hash).map(x => ({ hash: x.def_hash, name: x.name || 'Untitled scan' })), [meta])
  const applyScanFilter = (hash, name) => {
    // Adds to any scan filter already on, as ScannerShell's escape hatch does.
    const cur = s.filters?.scan
    const have = cur ? (Array.isArray(cur.value) ? cur.value : [cur.value]) : []
    const value = have.includes(hash) ? have : [...have, hash]
    ed.setFilter('scan', { op: 'in', value: value.length === 1 ? value[0] : value, label: name })
  }

  // ── empty-state undo ─────────────────────────────────────────────────
  const undoLast = () => {
    const u = lastChange?.undo
    if (!u?.baseSpec) return
    ed.applySpec(u.baseSpec)
    // applySpec carries the current pool forward on purpose; an undo restores the old one exactly.
    for (const k of POOL_KEYS) ed.setFilter(k, u.filters?.[k] || null)
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
    const name = await askName({ title: 'Save as a screen', label: 'Screen name', initial: current?.kind === 'saved' ? '' : current?.name || '',
      note: total === 0 ? ZERO_MATCH_NOTE : undefined })
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
      total: shownTotal, snapshotDate: result?.snapshot_date, snapshot: result?.snapshot, scanReceipts,
    })))
  }
  const hasResult = !!result && total != null

  // "Skip to save results": the keyboard door straight to the Save menu.
  const saveSlotRef = useRef(null)
  const skipToSave = e => { e.preventDefault(); saveSlotRef.current?.querySelector('button')?.focus() }

  // ── derived view state ───────────────────────────────────────────────────
  const filterCount = Object.keys(s.filters).filter(k => s.filters[k] && !POOL_KEYS.includes(k)).length + (s.logic ? 1 : 0)
  const selected = sel.selected
  // B5: the strip reads the same live price the row and the pane header show.
  const selLive = selected ? prices[selected.ticker] : null
  const snapshotDate = result?.snapshot_date
  const why = useMemo(() => whyItsHere({ filters: shown.filters, logic: shown.logic, rank: shown.rank, metaFilters: meta?.filters,
    row: selected || {}, live: selected ? livePriceOf(selected, selLive) : null, snapshotDate }),
  [shown.filters, shown.logic, shown.rank, meta, selected, selLive, snapshotDate])
  // S3: the screen menu counts each screen in the member's universe/list.
  const poolKey = JSON.stringify(poolOf(s.baseSpec))
  const pool = useMemo(() => JSON.parse(poolKey), [poolKey])
  const lists = useMemo(() => poolOptions(meta), [meta])
  const sortKey = s.sort?.key
  // Structures the rows on screen were screened for: read from the ANSWERED filters, so a
  // structure being edited in the drawer does not relabel rows that answer the previous screen.
  const structures = useMemo(() => ({ matched: activeStructures(shown.filters, meta?.filters), labels: structureLabels(meta?.filters) }),
    [shown.filters, meta])
  const colLabel = k => plainColumnLabel(k) || (meta?.filters || []).find(f => f.key === k || f.column === k)?.label || COLUMN_DEFS[k]?.label || k
  const sortArrow = s.sort?.dir === 'asc' ? '↑' : '↓'
  const sortLabel = s.rank ? 'Your ranking' : `${colLabel(sortKey) || 'Default'} ${sortArrow}`
  // The sortable set is the view's columns from meta (the server sorts by any snapshot column),
  // restricted to NUMERIC ones: a text column sorts alphabetically, so "Structure ↓" ran Z→A.
  // A column is numeric when meta carries a range filter over it — the type is the server's,
  // never a list typed here. The default sort is always offered; a text sort set elsewhere still
  // shows in the trigger and "Reverse order" still flips it.
  const sortKeys = sortableColumns({ meta, columns: s.visibleColumns || result?.view_columns || [], sortKey, defaultKey: DEFAULT_SORT.key })
  const sortMenu = (
    <Menu label={`Sort: ${sortLabel}`} trigger={<>Sort: <span className={styles.listHeadValue}>{sortLabel}</span></>}
      triggerClassName={styles.linkBtn} width={240} testId="focus-sort-menu">
      <MenuHeading>Sort by</MenuHeading>
      {sortKeys.map(k => (
        <MenuItem key={k} hint={!s.rank && k === sortKey ? sortArrow : undefined}
          onSelect={() => ed.setSort({ key: k, dir: k === sortKey && !s.rank ? s.sort.dir : 'desc' })}>{colLabel(k)}</MenuItem>
      ))}
      {!s.rank && (
        <MenuItem onSelect={() => ed.setSort(nextSort({ key: sortKey, dir: s.sort?.dir }, sortKey))}
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
    // The pills are built from the screen that CAME BACK empty, never the live spec: a filter
    // being edited in the drawer must not grow a pill for a screen nobody has run yet.
    body = <EmptyState filterCount={filterCount} lastChange={lastChange} onUndo={undoLast} onOpenFilters={() => openFilters()}
      spec={answered.shown?.baseSpec || null} meta={meta} onRemoveFilter={k => ed.setFilter(k, null)} onRemoveLogic={() => ed.setLogic(null)} />
  } else {
    body = (
      <div className={styles.body}>
        <ResultList ref={hubResultsRef} itemProps={hubOn ? hubCursor.itemProps : undefined} rows={displayRows} index={sel.index} onSelect={sel.select} onKeyDown={onListKeyDown}
          livePrices={prices} radar={radar} sortLabel={sortLabel} sortMenu={sortMenu} total={shownTotal} hasMore={hasMore}
          onLoadMore={s.loadMore} isLoading={isLoading} showCompany={showCompany} pending={pending} structures={structures} />
        <ChartPane row={selected} livePrice={selected ? prices[selected.ticker] : null} why={why}
          onOpenFilters={() => openFilters()} onFlag={onFlag} isFlagged={selected ? isFlagged(selected.ticker) : false} onWatch={onWatch} structures={structures} />
      </div>
    )
  }

  return (
    <div ref={pageRef} className={styles.page} data-testid="focus-screener" data-mode="list" data-density={density} onKeyDown={shortcuts.onKeyDown}>
      <SkipLinkPortal>
        <SkipLink href="#focus-results" className={styles.skipLink} target={() => pageRef.current?.querySelector('[data-focus-list]')}>Skip to results</SkipLink>
        <a href="#focus-save" className={styles.skipLink} onClick={skipToSave}>Skip to save results</a>
      </SkipLinkPortal>
      <FocusTopBar
        screenMenu={<ScreenMenu apiRef={screenMenuApi} landing={!landed} pool={pool} currentName={current?.name} currentId={current?.id} isEdited={isEdited} count={shownTotal} countPending={pending && !error}
          starters={starters} saved={saved} pinned={effectivePinned} onTogglePin={togglePin} onApply={applyScreen}
          onSaveChanges={current?.kind === 'saved' && isEdited ? saveChanges : null}
          onSaveAsNew={savedLoaded && !savedError ? saveAsScreen : null}
          onRename={current?.kind === 'saved' ? rename : null}
          onNewScreen={() => { ed.clearFilters(); ed.setLogic(null); setCurrent(null); openFilters() }}
          myScans={myScans} onUseScan={applyScanFilter} />}
        filterCount={filterCount} onOpenFilters={() => openFilters()}
        dataReceipt={<DataReceipt snapshotDate={result?.snapshot_date} live={result?.snapshot?.live?.state === 'live'} coverage={result?.coverage} />}
        mode="list" onMode={m => { s.flush(); onMode(m) }}
        saveMenu={(
          <span ref={saveSlotRef} id="focus-save" className={styles.saveSlot}>
            <SaveMenu canSaveScreen={savedLoaded && !savedError} canFrozenList={doors.promote && hasResult && total > 0}
              canAlert={doors.alert} canNotebook={hasResult} count={shownTotal} hasResult={hasResult}
              onSaveScreen={saveAsScreen} onFrozenList={frozenList} onAlert={standingAlert} onNotebook={toNotebook} />
          </span>
        )}
        moreMenu={<MoreMenu onExportCsv={exportCsv} onExportXlsx={serverExport ? () => serverExportAs('xlsx') : null}
          liveSortEligible={liveSortEligible} liveSortOn={liveSortOn} onToggleLiveSort={() => setLiveSortOn(v => !v)}
          density={density} onDensity={d => { setDensity(d); writeLS(DENSITY_KEY, d) }}
          showCompany={showCompany} onToggleCompany={() => setShowCompany(v => { writeLS(COMPANY_KEY, v ? '0' : '1'); return !v })} />}
        helpMenu={<HelpMenu onHowTo={howTo ? () => setSheet('howto') : null} onMethodology={() => setSheet('methodology')}
          onLibrary={() => setSheet('library')} onGlossary={() => openFilters()} shortcuts={shortcuts} />}
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
        onSetFilter={ed.setFilter} onClear={() => { ed.clearFilters(); ed.setLogic(null) }} onSetLogic={ed.setLogic}
        count={capToTopN(count, s.baseSpec)} countLoading={countLoading} countError={countError} lists={lists} />
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
      {shortcuts.sheet}
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

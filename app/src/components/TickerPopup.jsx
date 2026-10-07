// app/src/components/TickerPopup.jsx
import { useState, useEffect, useRef, lazy, Suspense } from 'react'
import { useNavigate } from 'react-router-dom'
import { createPortal } from 'react-dom'
import useRealtimePrices from '../hooks/useRealtimePrices'
import UIcon from './ui/UIcon'
import { useDarkPoolBars } from './chart/useDarkPoolBars'
import { setVoicePageHint } from '../context/VoiceContext'
import { useFlagged } from '../hooks/useFlagged'
import useTickerTags from '../hooks/useTickerTags'
import useFilingWatch from '../hooks/useFilingWatch'
import { TAG_BY_KEY } from '../constants/tagColors'
import TickerActionsMenu, { useTickerActions } from './TickerActions'
import { useTickerHub } from './mobile/TickerHubContext'
import { useIsTouch } from '../hooks/useBreakpoint'
import { prefetchAllTimeframes, prefetchBar } from '../utils/prefetchBars'
import JournalBacklinks from './JournalBacklinks'
import useAppFocus from '../hooks/useAppFocus'
import useFocusTrap, { focusableWithin } from './mobile/useFocusTrap'
import SymbolSearch from './chart/SymbolSearch'
import styles from './TickerPopup.module.css'
import { chordById, matchesChord } from '../pages/command/chords.js'

// The SAME chart the /charts workspace renders — identity row, session toggle,
// market clock, timeframe bar, market-cap/earnings/UCT-rating meta, settings
// gear and drawing tools. Lazy, so none of it lands in the eager entry chunk.
const ChartPane = lazy(() => import('./chart/pane/ChartPane'))
const FundamentalSnapshot = lazy(() => import('./FundamentalSnapshot'))
const AboutPanel = lazy(() => import('./fundamentals/AboutPanel'))
const TheStreetPanel = lazy(() => import('./fundamentals/TheStreetPanel'))

// `tab` is still this component's state (the voice page hint reads it, and it
// seeds ChartPane's timeframe), but the visible button row is ChartPane's now.
const TAB_TO_TF = { '1min': '1', '5min': '5', '15min': '15', '30min': '30', '1hr': '60', 'Daily': 'D', 'Weekly': 'W', 'Monthly': 'M' }
const TF_TO_TAB = Object.fromEntries(Object.entries(TAB_TO_TF).map(([k, v]) => [v, k]))

// S2 CP6 — resolved ONCE at module scope: a lookup inside the handler would
// re-scan the table on every keystroke, and a miss would silently disable
// the binding. Mirrors ChartPane.jsx / GridChartCell.jsx / Watchlists.jsx /
// ThemeTrackerPage.jsx.
const SHIFT_F = chordById('SHIFT_F')

// RW-NEW-02 (a11y second review, 2026-10-01): the capture result's life.
// Success is transient -- the member already sees the chart/header update,
// so a short beat is enough. A refusal (the locked-note message) or a
// generic failure is different: the member has to READ it, understand WHY
// nothing landed, and go act on it (unlock the note, retry) -- the rewalk's
// own probe lost a race against the old 2500ms on a machine "no slower than
// an average member's", which is the sighted-reader version of the same
// problem a screen reader has with zero role/aria-live at all. 8s is chosen
// as comfortably past that: long enough to read a one-sentence refusal and
// decide what to do, without becoming a stuck banner that outlives the
// member's next click. Never role="alert" (below) for either case, and
// never used for the routine success.
const CAPTURE_TOAST_SUCCESS_MS = 2500
const CAPTURE_TOAST_HOLD_MS = 8000
// Every success line this door produces ends this way (captureFinancialFact.js);
// every failure/refusal line does not (`captureFinancialFact.test.js` pins both
// shapes) -- so this is a safe, cheap classifier without a second success/
// failure flag threaded through the two capture functions.
function isCaptureSuccessMessage(msg) {
  return typeof msg === 'string' && /captured to Notebook$/.test(msg)
}

export default function TickerPopup({ sym, as: Tag = 'span', customChartFn, className, children, markers = null, priceLines = null, stopPrice = null, anchorDate = null, darkPool = false, flowMeta = null, open: openProp, onClose, focusable = true }) {
  // Controlled mode (open/onClose provided): no trigger element renders and the
  // parent owns open state — used for delegated $TICKER-chip clicks in The Floor,
  // where chips are sanitized static HTML, not React children. Uncontrolled mode
  // (every existing call site) is byte-identical in behavior.
  const [modalOpenState, setModalOpen] = useState(false)
  const controlled = openProp !== undefined
  const modalOpen = controlled ? openProp : modalOpenState
  const closeModal = () => { if (controlled) onClose?.(); else setModalOpen(false) }
  // A2R-05 (a11y second review, 2026-10-01): the trigger below used to render
  // as `<Tag role="button">` with no tabIndex and no key handler — reachable
  // by mouse only, on every call site that did not pass `as="button"` (26 of
  // 37). `triggerRef` is assigned to the trigger element itself; the actual
  // close-time restore (RW-NEW-01, below) captures `document.activeElement`
  // generically via `invokerRef` so the SAME mechanism covers both this
  // trigger (uncontrolled mode) and the seven controlled-mode call sites that
  // render no trigger at all. `focusable` is an explicit opt-out for the rare
  // call site that already sits inside its OWN focusable ancestor (a
  // `role="button"` row, a native `<a>`) — nesting a second focus stop there
  // would be the thing this fix exists to avoid, not a fix for it. See
  // UCT20.jsx and NewsFeed.jsx.
  const triggerRef = useRef(null)
  // RW-NEW-01 (a11y second review, 2026-10-01): Enter/click on the trigger
  // opened the modal but never moved focus into it -- Tab then walked
  // through 26 stops of BACKGROUND page content (every other ticker chip,
  // the nav rail, the Compass orb) on /dashboard before ever reaching the
  // dialog's own controls. The old restore-only effect below also skipped
  // controlled mode outright (`|| controlled`), so the seven call sites that
  // render this with `open`/`onClose` and no trigger never got focus back
  // either. This single effect now handles BOTH shapes identically:
  //  · uncontrolled -- this component stays mounted, `modalOpen` toggles;
  //  · controlled -- the caller mounts this fresh with `open` already true
  //    and unmounts it (not just flips the prop) to close.
  // A dependency change (open -> false) and an unmount both run the same
  // returned cleanup, so one effect covers both lifecycles without a
  // `wasOpenRef` guard -- the exact shape ShortcutCheatSheet's own A2R-04 fix
  // uses for the identical always-mounted-vs-mount-while-shown split.
  const modalRef = useRef(null)
  const invokerRef = useRef(null)
  useEffect(() => {
    if (!modalOpen) return undefined
    // Capture whatever had focus before the dialog opened (the trigger, in
    // uncontrolled mode; whatever the controlled caller's own trigger was,
    // in controlled mode -- there is no `triggerRef` to fall back on there).
    invokerRef.current = document.activeElement
    // Move focus into the dialog, onto its FIRST focusable control -- never
    // the Close button specifically. The header packs the "Switch ticker"
    // field plus six action buttons (Research/Ask AI/Save price/Save
    // consensus/Compare/Flag) BEFORE Close, so landing on Close would put
    // "Save ... price to Notebook" multiple dialog-widths of Tabs away
    // (through the whole mode row and the chart pane's own controls before
    // wrapping) -- exactly the kind of long detour this fix exists to kill.
    // `focusableWithin` reads the REAL DOM (the same helper the trap below
    // uses), so this adapts automatically if the header's control order
    // ever changes, and is never behind the lazy ChartPane chunk -- it fires
    // the instant the dialog's OWN header chrome mounts, before the Suspense
    // fallback even has a chance to resolve. Because this runs once per open
    // transition (not on every render), a later Suspense->chart swap never
    // re-steals focus away from wherever the member has since tabbed to.
    focusableWithin(modalRef.current)[0]?.focus()
    return () => {
      // By now the dialog's nodes are gone (portal content un-rendered):
      // focus that was inside it has already fallen to <body>.
      const active = document.activeElement
      const lost = !active || active === document.body
      if (!lost) return
      const invoker = invokerRef.current
      if (invoker && invoker !== document.body && invoker.isConnected
          && typeof invoker.focus === 'function') {
        invoker.focus()
      }
    }
  }, [modalOpen])
  // Tab/Shift+Tab stay inside the dialog while it is open -- the ONE shared
  // trap (ConfirmModal, ShortcutCheatSheet and the intro animation all
  // consume the same hook; see its own file header for why a fifth
  // hand-written copy is exactly the defect it was extracted to end).
  // Background content, including this popup's own trigger, is never
  // removed from the DOM -- this is what actually stops Tab from reaching it.
  useFocusTrap(modalOpen, modalRef)
  const [tab, setTab] = useState('Daily')
  const [view, setView] = useState('chart') // 'chart' | 'fundamentals'
  // Anchored+reveal (Desk recordings): open positioned at the session date; the
  // chart's "⟲ Back to today" pill un-anchors. Re-arm on every open so the next
  // look at the recording starts back at the session again.
  const [anchored, setAnchored] = useState(true)
  useEffect(() => { if (modalOpen) setAnchored(true) }, [modalOpen])
  const [flagToast, setFlagToast] = useState(null)
  const [captureToast, setCaptureToast] = useState(null)
  const [capturing, setCapturing] = useState(false)
  const [consensusCapturing, setConsensusCapturing] = useState(false)
  const [compareSymbol, setCompareSymbol] = useState('')

  // Header symbol search. The popup opens on the caller's `sym`, but the header
  // ticker is a search box (same predictive dropdown as /charts) so the user can
  // pull up any other chart in place. `searchSym` overrides while the popup is
  // open; it clears whenever the caller re-opens on a different symbol so the
  // next chip-click always shows what was clicked, not the last thing searched.
  const [searchSym, setSearchSym] = useState(null)
  const activeSym = searchSym || sym
  useEffect(() => { setSearchSym(null) }, [sym, modalOpen])

  // Dark-pool overlay toggle (only meaningful when `darkPool` is passed, e.g.
  // the Live Flow chart popup). Default ON, persisted so the choice sticks.
  const [showDarkPool, setShowDarkPool] = useState(() => {
    try { return localStorage.getItem('uct_liveflow_show_darkpool') !== '0' } catch { return true }
  })
  useEffect(() => {
    try { localStorage.setItem('uct_liveflow_show_darkpool', showDarkPool ? '1' : '0') } catch {}
  }, [showDarkPool])
  const darkPoolBars = useDarkPoolBars(activeSym, darkPool && showDarkPool && view === 'chart')

  const { isFlagged, toggle: toggleFlag } = useFlagged()
  const { getTag } = useTickerTags()
  const tagColor = getTag(activeSym)
  // S7 filing watch — "Notify me about new SEC filings for {sym}". Re-checks
  // as activeSym changes (ticker switched inside the popup via SwitchTickerBox).
  const filingWatch = useFilingWatch()
  const filingWatchState = filingWatch.watchState(activeSym)
  const onFilingWatchClick = () => {
    if (filingWatchState === 'CREATING' || filingWatchState === 'SUSPENDING' || filingWatchState === 'LOADING') return
    if (filingWatchState === 'ACTIVE') {
      const w = filingWatch.getWatch(activeSym)
      if (w) filingWatch.suspend(w.id, activeSym)
    } else {
      filingWatch.createOrReactivate(activeSym)
    }
  }
  const FILING_WATCH_LABEL = {
    NOT_WATCHING: `Notify me about new SEC filings for ${activeSym}`,
    ACTIVE: 'Watching SEC filings — click to suspend',
    SUSPENDED: `Filing watch suspended — reactivate for ${activeSym}`,
    CREATING: 'Setting up filing watch…',
    SUSPENDING: 'Suspending filing watch…',
    ERROR: 'Filing watch failed — click to retry',
    LOADING: 'Filing watch',
  }[filingWatchState] || 'Filing watch'
  const tickerActions = useTickerActions()
  const { openTicker } = useTickerHub()
  const isTouch = useIsTouch()
  const navigate = useNavigate()

  // Full Research / Ask AI — the shared door into the canonical /research/:sym
  // Ask AI surface (ticker_explain.py), never the separate ai_search.py
  // assistant. Close first so the destination page mounts clean, matching
  // TickerHubSheet's own go() helper.
  const goToResearch = () => { closeModal(); navigate(`/research/${activeSym}`) }
  const goToAskAi = () => { closeModal(); navigate(`/research/${activeSym}?section=ai`) }
  // Compare entry point (closes the BROKEN dead end — Portfolio/Position
  // Intelligence Convergence V1 Part A1). Same canonical route + picker
  // ResearchHeader's own "+ Compare" uses; NOT the compareSymbol/
  // onCompareChange on-chart overlay further down (that's a separate,
  // unrelated mechanism and is left untouched).
  const goToCompare = (comparator) => { closeModal(); navigate(`/research/${activeSym}/compare/${comparator.toUpperCase()}`) }

  // Fetch live price only when modal is open
  const { prices } = useRealtimePrices(modalOpen && activeSym ? [activeSym] : [])
  const liveData = prices[activeSym]

  // Clear flag toast after 1.5s
  useEffect(() => {
    if (!flagToast) return
    const t = setTimeout(() => setFlagToast(null), 1500)
    return () => clearTimeout(t)
  }, [flagToast])

  // RW-NEW-02: success keeps CAPTURE_TOAST_SUCCESS_MS (longer than flagToast's
  // 1.5s -- this one names a destination note, worth a beat longer to read);
  // a refusal or failure holds for CAPTURE_TOAST_HOLD_MS. Re-firing a capture
  // (another action) replaces `captureToast` with a new value, which restarts
  // this effect and its timer the normal React way.
  useEffect(() => {
    if (!captureToast) return
    const ms = isCaptureSuccessMessage(captureToast) ? CAPTURE_TOAST_SUCCESS_MS : CAPTURE_TOAST_HOLD_MS
    const t = setTimeout(() => setCaptureToast(null), ms)
    return () => clearTimeout(t)
  }, [captureToast])

  // Wave F: "Save price to Notebook" (checkpoint decision 29's second
  // material entry point, alongside the note editor's own /price command).
  const captureCurrentPrice = async () => {
    if (capturing) return
    setCapturing(true)
    try {
      const { capturePriceToNotebook } = await import('../pages/journal-2-0/lib/captureFinancialFact')
      const msg = await capturePriceToNotebook(activeSym)
      setCaptureToast(msg)
    } finally {
      setCapturing(false)
    }
  }

  // G-062 (wave 10, lane G62): "Save analyst consensus to Notebook" -- the
  // second capture door, mirroring captureCurrentPrice exactly (same shape,
  // a separate capturing flag so the two buttons never disable each other).
  // Active since the owner's 2026-09-25 FMP licensing approval.
  const captureCurrentConsensus = async () => {
    if (consensusCapturing) return
    setConsensusCapturing(true)
    try {
      const { captureConsensusToNotebook } = await import('../pages/journal-2-0/lib/captureFinancialFact')
      const msg = await captureConsensusToNotebook(activeSym)
      setCaptureToast(msg)
    } finally {
      setConsensusCapturing(false)
    }
  }

  useEffect(() => {
    if (!modalOpen) return
    const handleKey = (e) => {
      if (e.key === 'Escape') { closeModal(); return }
      // S2 CP6 — reads the DECLARED chord table instead of spelling the modifier
      // set out inline. Behaviour is identical by construction and proved so in
      // TickerPopup.chordAdoption.test.jsx.
      // ⛔ `!e.repeat` stays HERE, not in the table: a held chord auto-repeats
      // ~30x/sec and this binding is a TOGGLE, a property of the binding, not
      // the chord's identity.
      if (matchesChord(e, SHIFT_F) && !e.repeat) {
        const willFlag = !isFlagged(activeSym)
        toggleFlag(activeSym)
        setFlagToast(willFlag ? 'added' : 'removed')
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [modalOpen, activeSym, isFlagged, toggleFlag])

  // App focus: opening a chart on a ticker IS "what I'm looking at", and this
  // popup is the app's universal ticker surface — so it's the one writer that
  // covers every list, table and tile at once. Storage is charts Group A (see
  // useAppFocus), so this is the same value /charts already persists, not a
  // second one. Set on OPEN only; a hover preview must never move focus.
  const { setSymbol: setFocusSymbol } = useAppFocus()
  useEffect(() => {
    if (modalOpen && activeSym) setFocusSymbol(activeSym)
  }, [modalOpen, activeSym, setFocusSymbol])

  // P4-F unification: while this ticker modal is open, tell Compass the
  // user is looking at this symbol. So if they open the orb from inside
  // the modal, Compass starts the session knowing the ticker context.
  useEffect(() => {
    if (!modalOpen || !activeSym) return
    const tabHint = tab && tab !== 'Daily' ? `, ${tab}` : ''
    setVoicePageHint(`chart of ${activeSym}${tabHint}`)
    return () => setVoicePageHint(null)
  }, [modalOpen, activeSym, tab])

  return (
    <>
      {!controlled && (
      <Tag
        ref={triggerRef}
        className={`${styles.trigger}${className ? ` ${className}` : ''}`}
        onClick={() => {
          // On touch, a tap opens the universal Ticker Hub sheet; desktop keeps
          // the full chart modal.
          if (isTouch) { openTicker(sym); return }
          setModalOpen(true); setTab('Daily'); setView('chart'); prefetchAllTimeframes(sym)
        }}
        onKeyDown={!focusable ? undefined : (e) => {
          // Enter AND Space activate it, same as a native <button> — this
          // trigger is a <span> by default (`as` defaults to 'span'), which
          // carries neither behavior on its own. preventDefault on Space stops
          // the page from scrolling; on Enter it is a no-op but keeps both
          // branches symmetric. `focusable=false` call sites skip this prop
          // entirely rather than attach a handler that can never fire (no
          // tabIndex means it is never the active element on a keydown).
          if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
            e.preventDefault()
            if (isTouch) { openTicker(sym); return }
            setModalOpen(true); setTab('Daily'); setView('chart'); prefetchAllTimeframes(sym)
          }
        }}
        onMouseEnter={() => {
          prefetchBar(sym, 'D')
          // Warm the ChartPane CHUNK too, not just the bars. The pane pulls the
          // symbol search, day gain, market clock and settings modal with it, so
          // on a cold first open the module fetch — not the data — is what holds
          // the "Loading chart…" fallback up. Hovering a ticker is the earliest
          // reliable signal that a popup is coming.
          import('./chart/pane/ChartPane')
        }}
        {...tickerActions.longPressProps(sym)}
        {...(focusable ? { tabIndex: 0 } : null)}
        role="button"
        aria-label={`View chart for ${sym}`}
        data-testid={`ticker-${sym}`}
      >
        {tagColor && <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: TAG_BY_KEY[tagColor]?.hex, marginRight: 3, verticalAlign: 'middle' }} />}
        {children ?? sym}
      </Tag>
      )}
      {tickerActions.menu && <TickerActionsMenu menu={tickerActions.menu} onClose={tickerActions.closeMenu} />}

      {modalOpen && createPortal(
        <div
          className={styles.overlay}
          onClick={closeModal}
          data-testid="chart-modal"
        >
          <div
            ref={modalRef}
            className={styles.modal}
            onClick={e => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={`${activeSym} chart`}
          >
            <div className={styles.modalHeader}>
              <div className={styles.modalHeaderLeft}>
                {tagColor && <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: TAG_BY_KEY[tagColor]?.hex, marginRight: 5 }} />}
                <span className={styles.modalSym}>{activeSym}</span>
                {/* Flow context (BULL/BEAR · premium · trades) when opened from a flow
                    row. Hidden once the user searches to a different ticker — the
                    flow figures belong to the ticker the caller opened, not the next. */}
                {flowMeta && !searchSym && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, marginLeft: 10 }}>
                    <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.5, padding: '2px 7px', borderRadius: 4, color: 'var(--bg)', background: flowMeta.bull ? 'var(--gain)' : 'var(--loss)' }}>
                      {flowMeta.bull ? 'BULL' : 'BEAR'}
                    </span>
                    {flowMeta.premium && <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--ut-gold)', background: 'var(--ut-gold-dim)', padding: '2px 8px', borderRadius: 4 }}>{flowMeta.premium}</span>}
                    {flowMeta.trades != null && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{flowMeta.trades} trades</span>}
                  </span>
                )}
                {liveData && (
                  <>
                    <span className={styles.modalPrice}>${liveData.price?.toFixed(2)}</span>
                    <span className={`${styles.modalChange} ${liveData.change_pct >= 0 ? styles.modalChangeUp : styles.modalChangeDown}`}>
                      {liveData.change_pct >= 0 ? '+' : ''}{liveData.change_pct?.toFixed(2)}%
                    </span>
                  </>
                )}
                {flagToast && (
                  <span className={`${styles.flagToast} ${flagToast === 'added' ? styles.flagToastAdded : styles.flagToastRemoved}`}>
                    <UIcon name="flag" size={12} style={{ verticalAlign: '-1px', marginRight: 3 }} />{flagToast === 'added' ? 'Flagged' : 'Removed'}
                  </span>
                )}
                {/* RW-NEW-02 (a11y second review, 2026-10-01): this span used
                    to mount ONLY once a message existed, with no role and no
                    aria-live -- a region inserted together with its text is
                    often never announced (confirmed live: a page-wide
                    live-region census at the moment of a refusal found
                    nothing on the page, even though the toast genuinely
                    inserted). The region is now ALWAYS mounted, empty,
                    before any capture -- assistive tech has already
                    discovered it by the time a message lands. The inner
                    badge only renders once there is something to show, so a
                    mouse user still sees no empty pill. role="status" (never
                    "alert") for both success and a refusal/failure -- a
                    routine save is not an interruption; see
                    CAPTURE_TOAST_HOLD_MS above for why a refusal stays up
                    longer. */}
                <span
                  role="status"
                  aria-live="polite"
                  aria-atomic="true"
                  className={styles.captureStatus}
                  data-testid="capture-status"
                >
                  {captureToast && (
                    <span className={styles.captureStatusBadge}>
                      <UIcon name="camera" size={12} style={{ verticalAlign: '-1px', marginRight: 3 }} />{captureToast}
                    </span>
                  )}
                </span>
                {/* The journal, visible from the app's universal ticker
                    surface: "4 entries" → click through to them. Keyed to
                    activeSym, so searching another ticker in place re-points
                    the backlinks with it. enabled is tied to the MODAL being
                    open — this component also renders a hover preview, and
                    fetching there would fire one request per mouse-over of
                    every ticker chip on screen. */}
                <JournalBacklinks symbol={activeSym} enabled={modalOpen} style={{ marginLeft: 6 }} />
              </div>
              <div className={styles.modalHeaderRight}>
                {/* Type a symbol → Enter (or click a match) pulls up that chart in
                    place. A real <input>, not a click-to-open dropdown, so it's
                    directly typeable inside the modal. */}
                <SwitchTickerBox onPick={setSearchSym} />
                <button
                  className={styles.actionBtn}
                  onClick={goToResearch}
                  title="Open full research"
                  aria-label={`Open full research for ${activeSym}`}
                >
                  <UIcon name="book" size={14} />
                </button>
                <button
                  className={styles.actionBtn}
                  onClick={goToAskAi}
                  title="Ask AI about this security"
                  aria-label={`Ask AI about ${activeSym}`}
                >
                  <UIcon name="sparkle" size={14} />
                </button>
                {/* Wave F: capture this ticker's CURRENT price as an immutable
                    financial fact into the member's Notebook (last-active
                    note, or a fresh one) — checkpoint decision 29. */}
                <button
                  className={styles.actionBtn}
                  onClick={captureCurrentPrice}
                  disabled={capturing}
                  title="Save price to Notebook"
                  aria-label={`Save ${activeSym}'s current price to Notebook`}
                >
                  <UIcon name="camera" size={14} />
                </button>
                {/* G-062: capture this ticker's analyst price-target CONSENSUS
                    as an immutable financial fact into the member's Notebook --
                    same door shape as the price capture above, one entry point
                    lower. Active since the owner's 2026-09-25 FMP licensing
                    approval. */}
                <button
                  className={styles.actionBtn}
                  onClick={captureCurrentConsensus}
                  disabled={consensusCapturing}
                  title="Save analyst consensus to Notebook"
                  aria-label={`Save ${activeSym}'s analyst consensus to Notebook`}
                >
                  <UIcon name="dollar" size={14} />
                </button>
                <span className={styles.compareEntry} data-testid="ticker-popup-compare-entry">
                  <SymbolSearch sym={activeSym} displayLabel="+ Compare" onSymbolChange={goToCompare} />
                </span>
                {/* Dark until S7_FILING_WATCH_ENABLED; the gate is owned by useFilingWatch. */}
                {filingWatch.enabled && (
                <button
                  className={styles.actionBtn}
                  onClick={onFilingWatchClick}
                  disabled={filingWatchState === 'CREATING' || filingWatchState === 'SUSPENDING' || filingWatchState === 'LOADING'}
                  title={FILING_WATCH_LABEL}
                  aria-label={FILING_WATCH_LABEL}
                  aria-pressed={filingWatchState === 'ACTIVE'}
                >
                  <UIcon name="document" size={14} gold={filingWatchState === 'ACTIVE'} />
                </button>
                )}
                <button
                  className={`${styles.flagBtn}${isFlagged(activeSym) ? ' ' + styles.flagBtnActive : ''}`}
                  onClick={() => { const willFlag = !isFlagged(activeSym); toggleFlag(activeSym); setFlagToast(willFlag ? 'added' : 'removed') }}
                  title={isFlagged(activeSym) ? 'Remove from Flagged (Shift+F)' : 'Add to Flagged (Shift+F)'}
                  aria-label={isFlagged(activeSym) ? 'Remove from flagged list' : 'Add to flagged list'}
                >
                  <UIcon name="flag" size={14} gold={isFlagged(activeSym)} />
                </button>
                <button
                  className={styles.closeBtn}
                  onClick={closeModal}
                  title="Close"
                  aria-label="Close chart"
                >
                  <UIcon name="x" size={15} gold={false} />
                </button>
              </div>
            </div>

            <div className={styles.modalModeRow}>
              <div className={styles.modalModeToggle} role="tablist" aria-label="View mode">
                <button
                  className={`${styles.modalModeBtn} ${view === 'chart' ? styles.modalModeBtnActive : ''}`}
                  onClick={() => setView('chart')}
                  role="tab"
                  aria-selected={view === 'chart'}
                >
                  Chart
                </button>
                <button
                  className={`${styles.modalModeBtn} ${view === 'about' ? styles.modalModeBtnActive : ''}`}
                  onClick={() => setView('about')}
                  role="tab"
                  aria-selected={view === 'about'}
                >
                  About
                </button>
                <button
                  className={`${styles.modalModeBtn} ${view === 'fundamentals' ? styles.modalModeBtnActive : ''}`}
                  onClick={() => setView('fundamentals')}
                  role="tab"
                  aria-selected={view === 'fundamentals'}
                >
                  Fundamentals
                </button>
                <button
                  className={`${styles.modalModeBtn} ${view === 'street' ? styles.modalModeBtnActive : ''}`}
                  onClick={() => setView('street')}
                  role="tab"
                  aria-selected={view === 'street'}
                >
                  The Street
                </button>
              </div>
              {/* The timeframe row used to live here. ChartPane owns it now — it
                  renders the same bar /charts does, honouring the user's own
                  favourites, so a second row here would duplicate it. */}
            </div>

            <div className={styles.chartArea}>
              {view === 'chart' ? (
                <Suspense fallback={<div className={styles.chartLoading}>Loading chart…</div>}>
                  {/* `stored={null}` with no `onStore` = THE user's own chart:
                      ChartPane reads and writes the global chart_settings blob, so
                      this popup renders whatever they configured on /charts.
                      `onSymbolChange` is deliberately omitted here — the popup's
                      OWN header ticker is the search box (drives `activeSym`), so
                      ChartPane's identity row stays a static company label. */}
                  <ChartPane
                    sym={activeSym}
                    tf={TAB_TO_TF[tab]}
                    onTfChange={next => setTab(TF_TO_TAB[next] || tab)}
                    stored={null}
                    slots={darkPool ? {
                      // Gold-pill "Dark Pools" toggle in the TF-bar right slot —
                      // matches the OptionsFlow chart chrome (top-right, same style).
                      tfBarRight: (
                        <button
                          onClick={() => setShowDarkPool(v => !v)}
                          title={showDarkPool ? 'Hide dark-pool prints on the chart' : 'Show dark-pool prints on the chart'}
                          aria-pressed={showDarkPool}
                          style={{
                            padding: '2px 8px', borderRadius: 3,
                            border: '1px solid ' + (showDarkPool ? 'var(--ut-gold)' : 'var(--border-accent)'),
                            background: showDarkPool ? 'var(--ut-gold-dim)' : 'transparent',
                            color: showDarkPool ? 'var(--ut-gold)' : 'var(--text-muted)',
                            fontSize: 9, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                            display: 'flex', alignItems: 'center', gap: 4,
                          }}
                        >
                          <span style={{
                            width: 6, height: 6, borderRadius: '50%',
                            background: showDarkPool ? 'var(--ut-gold)' : 'transparent',
                            border: '1px solid ' + (showDarkPool ? 'var(--ut-gold)' : 'var(--text-muted)'),
                            display: 'inline-block',
                          }} />
                          Dark Pools
                        </button>
                      ),
                    } : undefined}
                    stockChartProps={{
                      height: 'min(820px, 68vh)',
                      markers,
                      priceLines,
                      darkPoolBars,
                      compareSymbol: compareSymbol || null,
                      onCompareChange: setCompareSymbol,
                      ...(anchorDate && anchored ? {
                        anchorDate,
                        exitReplayLabel: '⟲ Back to today',
                        onExitReplay: () => setAnchored(false),
                      } : {}),
                    }}
                  />
                </Suspense>
              ) : view === 'about' ? (
                <Suspense fallback={<div className={styles.chartLoading}>Loading…</div>}>
                  <AboutPanel
                    sym={activeSym}
                    onSwitch={(s) => { setSearchSym(String(s).toUpperCase()); setView('chart') }}
                  />
                </Suspense>
              ) : view === 'street' ? (
                <Suspense fallback={<div className={styles.chartLoading}>Loading…</div>}>
                  <TheStreetPanel sym={activeSym} />
                </Suspense>
              ) : (
                <Suspense fallback={<div className={styles.chartLoading}>Loading fundamentals…</div>}>
                  <FundamentalSnapshot sym={activeSym} enabled={view === 'fundamentals'} />
                </Suspense>
              )}
            </div>

          </div>
        </div>,
        document.body
      )}
    </>
  )
}

// "Switch ticker…" search box in the popup header — a REAL text input (not a
// click-to-open dropdown), so you type a symbol and Enter opens that chart in
// place. Predictive matches from /api/ticker-search drop down beneath it; Enter
// takes the typed symbol unless you've arrow-navigated to a suggestion. Rendered
// inline (no portal) so it's reliably typeable + visible inside the modal.
function SwitchTickerBox({ onPick }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const boxRef = useRef(null)

  useEffect(() => {
    const t = q.trim()
    if (!t) { setResults([]); return undefined }
    const ctrl = new AbortController()
    const id = setTimeout(() => {
      fetch(`/api/ticker-search?q=${encodeURIComponent(t)}&limit=8`, { signal: ctrl.signal })
        .then(r => (r.ok ? r.json() : null))
        .then(d => { if (d) { setResults(d.results || []); setActive(0) } })
        .catch(() => {})
    }, 130)
    return () => { clearTimeout(id); ctrl.abort() }
  }, [q])

  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const submit = (ticker) => {
    const clean = String(ticker != null ? ticker : q).trim().toUpperCase()
    if (clean) onPick(clean)
    setQ(''); setResults([]); setOpen(false)
  }

  const onKey = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      // Enter takes the TYPED symbol unless you arrowed onto a suggestion.
      submit(active > 0 ? (results[active]?.ticker || q) : q)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault(); setActive(i => Math.min(i + 1, Math.max(0, results.length - 1)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault(); setActive(i => Math.max(i - 1, 0))
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div ref={boxRef} className={styles.switchWrap}>
      <input
        className={styles.switchInput}
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true) }}
        onFocus={() => { if (results.length) setOpen(true) }}
        onKeyDown={onKey}
        placeholder="Switch ticker…"
        aria-label="Switch ticker — type a symbol to open its chart"
        spellCheck={false}
        autoComplete="off"
      />
      {open && results.length > 0 && (
        <div className={styles.switchMenu} role="listbox">
          {results.map((r, i) => (
            <button
              type="button"
              key={r.ticker}
              className={`${styles.switchOpt} ${i === active ? styles.switchOptActive : ''}`}
              onMouseDown={(e) => { e.preventDefault(); submit(r.ticker) }}
              onMouseEnter={() => setActive(i)}
              role="option"
              aria-selected={i === active}
            >
              <span className={styles.switchOptSym}>{r.ticker}</span>
              {r.name && <span className={styles.switchOptName}>{r.name}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// app/src/components/TickerPopup.jsx
import { useState, useEffect, useRef, lazy, Suspense } from 'react'
import { createPortal } from 'react-dom'
import useRealtimePrices from '../hooks/useRealtimePrices'
import UIcon from './ui/UIcon'
import { useDarkPoolBars } from './chart/useDarkPoolBars'
import { setVoicePageHint } from '../context/VoiceContext'
import { useFlagged } from '../hooks/useFlagged'
import useTickerTags from '../hooks/useTickerTags'
import { TAG_BY_KEY } from '../constants/tagColors'
import TickerActionsMenu, { useTickerActions } from './TickerActions'
import { useTickerHub } from './mobile/TickerHubContext'
import { useIsTouch } from '../hooks/useBreakpoint'
import { prefetchAllTimeframes, prefetchBar } from '../utils/prefetchBars'
import JournalBacklinks from './JournalBacklinks'
import useAppFocus from '../hooks/useAppFocus'
import styles from './TickerPopup.module.css'

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

export default function TickerPopup({ sym, tvSym, as: Tag = 'span', customChartFn, className, children, markers = null, priceLines = null, stopPrice = null, anchorDate = null, darkPool = false, flowMeta = null, open: openProp, onClose }) {
  // Controlled mode (open/onClose provided): no trigger element renders and the
  // parent owns open state — used for delegated $TICKER-chip clicks in The Floor,
  // where chips are sanitized static HTML, not React children. Uncontrolled mode
  // (every existing call site) is byte-identical in behavior.
  const [modalOpenState, setModalOpen] = useState(false)
  const controlled = openProp !== undefined
  const modalOpen = controlled ? openProp : modalOpenState
  const closeModal = () => { if (controlled) onClose?.(); else setModalOpen(false) }
  const [tab, setTab] = useState('Daily')
  const [view, setView] = useState('chart') // 'chart' | 'fundamentals'
  // Anchored+reveal (Desk recordings): open positioned at the session date; the
  // chart's "⟲ Back to today" pill un-anchors. Re-arm on every open so the next
  // look at the recording starts back at the session again.
  const [anchored, setAnchored] = useState(true)
  useEffect(() => { if (modalOpen) setAnchored(true) }, [modalOpen])
  const [flagToast, setFlagToast] = useState(null)
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
  const tickerActions = useTickerActions()
  const { openTicker } = useTickerHub()
  const isTouch = useIsTouch()

  // Fetch live price only when modal is open
  const { prices } = useRealtimePrices(modalOpen && activeSym ? [activeSym] : [])
  const liveData = prices[activeSym]

  // Clear flag toast after 1.5s
  useEffect(() => {
    if (!flagToast) return
    const t = setTimeout(() => setFlagToast(null), 1500)
    return () => clearTimeout(t)
  }, [flagToast])

  useEffect(() => {
    if (!modalOpen) return
    const handleKey = (e) => {
      if (e.key === 'Escape') { closeModal(); return }
      if (e.shiftKey && e.key === 'F') {
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
        className={`${styles.trigger}${className ? ` ${className}` : ''}`}
        onClick={() => {
          // On touch, a tap opens the universal Ticker Hub sheet; desktop keeps
          // the full chart modal.
          if (isTouch) { openTicker(sym); return }
          setModalOpen(true); setTab('Daily'); setView('chart'); prefetchAllTimeframes(sym)
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
                    <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.5, padding: '2px 7px', borderRadius: 4, color: '#0a0e12', background: flowMeta.bull ? '#34d399' : '#f2555a' }}>
                      {flowMeta.bull ? 'BULL' : 'BEAR'}
                    </span>
                    {flowMeta.premium && <span style={{ fontSize: 12, fontWeight: 800, color: '#c9a84c', background: '#c9a84c18', padding: '2px 8px', borderRadius: 4 }}>{flowMeta.premium}</span>}
                    {flowMeta.trades != null && <span style={{ fontSize: 11, color: '#8a8a90' }}>{flowMeta.trades} trades</span>}
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
                            border: '1px solid ' + (showDarkPool ? '#c9a84c' : '#ffffff30'),
                            background: showDarkPool ? '#c9a84c22' : 'transparent',
                            color: showDarkPool ? '#c9a84c' : '#8a8a90',
                            fontSize: 9, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                            display: 'flex', alignItems: 'center', gap: 4,
                          }}
                        >
                          <span style={{
                            width: 6, height: 6, borderRadius: '50%',
                            background: showDarkPool ? '#c9a84c' : 'transparent',
                            border: '1px solid ' + (showDarkPool ? '#c9a84c' : '#8a8a90'),
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

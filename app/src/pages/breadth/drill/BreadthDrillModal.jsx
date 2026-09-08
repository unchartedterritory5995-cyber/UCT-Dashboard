import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import UIcon from '../../../components/ui/UIcon'
import usePreferences from '../../../hooks/usePreferences'
import { WorkspaceContext } from '../../charts/WorkspaceContext'
import { widgetOwnChrome, chartTypeCanvasEntry } from '../../charts/widgetChrome'
import useDrillWorkspace from './drillWorkspace'
import { DrillSourceContext } from './DrillSourceContext'
import BreadthDrillBoard from './BreadthDrillBoard'
import PopoutWindow from '../../charts/popout/PopoutWindow'
import PopoutShell from '../../charts/popout/PopoutShell'
import WidgetHost from '../../charts/WidgetHost'
import { DRILL_BOARD_PREF, LIST_WIDGET_ID, parseBoard, serializeBoard } from './drillBoardPrefs'
import styles from './BreadthDrillModal.module.css'

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

// The portaled menus a widget can have open above this modal. Kept in sync with
// `WidgetHeader.jsx` by a rail that reads that file, not by memory.
export const WIDGET_MENU_SELECTOR = '[data-wtab-add-menu],[data-float-tab-menu]'

const POPUP_BLOCKED_MSG = 'Your browser blocked the pop-out window. Allow pop-ups for this site and try again.'

// The breadth cell drill: a two-widget charts board in an overlay.
//
// The overlay + title bar are all this file owns. Everything inside is the real
// charts workspace machinery — a complete WorkspaceContext (drillWorkspace.js),
// WidgetHost, Watchlists in scan mode, ChartWidget.

export default function BreadthDrillModal({ drill, latestDate, onRetry, onClose }) {
  const { prefs, setPref } = usePreferences()
  // Same expression ChartsWorkspace uses, deliberately — not a near-equivalent.
  const chartsTheme = prefs?.charts_theme || 'default'

  // ── Board state, seeded from the stored pref ────────────────────────────────
  // Seeded ONCE per open. A later pref round-trip must not stomp the board the
  // user is currently dragging.
  const [board, setBoard] = useState(() => parseBoard(prefs?.[DRILL_BOARD_PREF]))
  const onBoardChange = useCallback((fn) => {
    setBoard(prev => (typeof fn === 'function' ? fn(prev) : fn))
  }, [])

  // ── Pop-out ─────────────────────────────────────────────────────────────────
  // "Separate popouts but linked": a widget ejected into its own window keeps
  // running inside THIS React tree (PopoutWindow is a portal), so it stays on
  // colour group A and the list still drives the chart across windows.
  // ⛔ NOT persisted: a popped window dies with its opener, so restoring a
  // "popped" flag on the next open would leave a widget that renders nowhere.
  // ── Phone: one pane at a time ───────────────────────────────────────────────
  // Rendered always; CSS hides the toggle above 640px and ignores `data-pane`.
  const [mobilePane, setMobilePane] = useState('list')

  const [poppedIds, setPoppedIds] = useState([])
  const [popNotice, setPopNotice] = useState(null)
  const popOut = useCallback((id) => {
    setPoppedIds(prev => (prev.includes(id) ? prev : [...prev, id]))
  }, [])
  const dock = useCallback((id) => {
    setPoppedIds(prev => prev.filter(x => x !== id))
  }, [])
  useEffect(() => {
    if (!popNotice) return
    const t = setTimeout(() => setPopNotice(null), 6000)
    return () => clearTimeout(t)
  }, [popNotice])

  // Debounced persist, mirroring the workspace's own 500ms layout save. A split
  // drag emits on every pointermove; writing each one would hammer the prefs API.
  const saveTimer = useRef(null)
  const boardRef = useRef(board)
  useEffect(() => { boardRef.current = board }, [board])
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      setPref(DRILL_BOARD_PREF, serializeBoard(boardRef.current))
    }, 500)
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current) }
  }, [board, setPref])
  // Flush on unmount so the last arrangement always lands, rather than depending
  // on the 500ms window having elapsed before the modal closed.
  useEffect(() => () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      setPref(DRILL_BOARD_PREF, serializeBoard(boardRef.current))
    }
  }, [setPref])

  // ── The workspace value ─────────────────────────────────────────────────────
  // Per-widget chrome so each widget's frame follows ITS OWN canvas, and the
  // chart's type default so an uncustomized drill chart is framed exactly like an
  // uncustomized chart on /charts. Watchlists deliberately have no type entry.
  const widgetCanvasById = useMemo(() => {
    const out = {}
    for (const w of board.widgets) {
      const entry = widgetOwnChrome(w, chartsTheme)
      if (entry) out[w.id] = entry
    }
    return out
  }, [board.widgets, chartsTheme])
  const widgetCanvasByType = useMemo(
    () => ({ chart: chartTypeCanvasEntry(prefs?.chart_settings, chartsTheme) }),
    [prefs?.chart_settings, chartsTheme],
  )

  const firstSym = drill?.items?.[0]?.t || null
  const baseWorkspace = useDrillWorkspace({
    initialSym: firstSym,
    chartsTheme,
    widgetCanvasByType,
    widgetCanvasById,
  })

  // On a PHONE, picking a row must show you the chart — otherwise the tap looks
  // like it did nothing, because the chart it updated is the hidden pane.
  //
  // Done by wrapping setGroupSym rather than watching the value in an effect:
  // this is a USER ACTION, and reacting to the derived state instead would both
  // trip react-hooks/set-state-in-effect and fire on the open-time seed.
  // ⛔ `matchMedia` is read HERE, at event time — never during render.
  // useMediaQuery seeds at mount and only updates on a `change` event, so in a
  // fixed mobile viewport a render-time read is stale on first paint.
  const lastSymRef = useRef(null)
  const workspace = useMemo(() => ({
    ...baseWorkspace,
    setGroupSym: (color, sym) => {
      const prev = lastSymRef.current
      lastSymRef.current = sym
      baseWorkspace.setGroupSym(color, sym)
      // `prev` is null for the seeded first symbol, so opening still lands on
      // the list rather than jumping straight to the chart.
      if (!prev || !sym || sym === prev) return
      try {
        if (window.matchMedia('(max-width: 640px)').matches) setMobilePane('chart')
      } catch { /* no matchMedia — stay put rather than guess */ }
    },
  }), [baseWorkspace])

  // ── The drill payload ───────────────────────────────────────────────────────
  const source = useMemo(() => ({
    items: drill?.items ?? [],
    label: drill?.label ?? '',
    date: drill?.date ?? null,
    live: !!drill?.live,
    asOf: drill?.asOf ?? null,
    latestDate: latestDate ?? null,
    // `loading` is items === null (not yet answered); `error` is a request that
    // FAILED. Neither is an empty result, and the list must not render either
    // one as "nothing matched".
    loading: drill?.items == null && !drill?.error,
    error: drill?.error ?? null,
    onRetry: onRetry ?? null,
  }), [drill, latestDate, onRetry])

  // Escape closes. Bound on the overlay's own document so a popped-out widget's
  // window cannot swallow it.
  //
  // ⛔⛔ ...BUT NOT WHILE A WIDGET MENU IS OPEN. `WidgetHeader`'s portaled menus
  // close themselves on Escape via a listener on `document`; this one is on
  // `window`, which is the next step in the same bubble path. So ONE Escape ran
  // both: the menu closed AND the whole drill closed under it. Measured live —
  // dismissing a dropdown threw away the board, the selection and the chart.
  //
  // The menu is still in the DOM when this runs (its own handler only calls
  // `setState`, which React has not flushed yet), so presence is a reliable test
  // for "something inside just handled this".
  //
  // ⛔ The selector is DERIVED, not judged: `BreadthDrillModal.a11y.test.jsx`
  // reads every `data-*-menu` attribute out of `WidgetHeader.jsx` and fails by
  // name if one is missing here, so a menu added tomorrow cannot quietly
  // reintroduce this.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      if (document.querySelector(WIDGET_MENU_SELECTOR)) return
      onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // ── Focus ───────────────────────────────────────────────────────────────────
  // `aria-modal` tells assistive tech the rest of the page is inert; it does NOT
  // move or contain focus. Without the three things below, opening the drill left
  // focus on the breadth cell behind it — so a screen reader announced nothing,
  // Tab walked the page UNDER the overlay, and closing dropped focus to the top
  // of the document instead of the cell you came from.
  const dialogRef = useRef(null)
  useEffect(() => {
    const opener = document.activeElement
    // Focus the PANEL, not its first control: a dialog that opens with some button
    // focused announces that button's label instead of the dialog's, and a stray
    // Enter would activate it.
    dialogRef.current?.focus()
    return () => {
      // Back to the cell that opened this, so a keyboard user resumes where they
      // were. `isConnected` guards a cell that re-rendered away while open.
      if (opener && typeof opener.focus === 'function' && opener.isConnected) opener.focus()
    }
  }, [])

  // Tab must not escape into the page behind the overlay. Bound to the PANEL, not
  // the window, so a popped-out widget in its own window is unaffected.
  const onDialogKeyDown = useCallback((e) => {
    if (e.key !== 'Tab') return
    const root = dialogRef.current
    if (!root) return
    const all = Array.from(root.querySelectorAll(FOCUSABLE))
    // `offsetParent` drops display:none controls — which is how the phone-only
    // List/Chart toggle stays out of the DESKTOP tab cycle without a second
    // breakpoint read. ⛔ But jsdom does no layout and reports null for EVERY
    // element, so filtering blindly leaves zero nodes and pins focus to the panel.
    // Fall back to the unfiltered set: a layout this code cannot measure must
    // never be allowed to strand a keyboard user.
    const visible = all.filter(el => el.offsetParent !== null)
    const nodes = visible.length ? visible : all
    if (!nodes.length) { e.preventDefault(); root.focus(); return }
    const first = nodes[0]
    const last = nodes[nodes.length - 1]
    const here = root.ownerDocument.activeElement
    if (e.shiftKey && (here === first || here === root)) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && here === last) { e.preventDefault(); first.focus() }
  }, [])

  const count = source.items.length
  const whenLabel = source.live ? 'LIVE' : source.date

  return (
    // ⛔ The dialog role belongs to the PANEL, not the backdrop. It was on this
    // overlay, which meant the accessible dialog included the dimmed background and
    // its click-to-close — so the region announced as the dialog was not the region
    // the user could actually operate.
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={styles.dialog}
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={`${source.label} constituents`}
        onKeyDown={onDialogKeyDown}
        onClick={e => e.stopPropagation()}
      >
        <div className={styles.bar}>
          <span className={styles.title}>
            {source.label}
            {drill?.items && <span className={styles.count}> · {count.toLocaleString()} {count === 1 ? 'stock' : 'stocks'}</span>}
          </span>
          {whenLabel && <span className={styles.when}>{whenLabel}</span>}
          <div className={styles.paneToggle} role="group" aria-label="Show list or chart">
            <button
              type="button"
              className={mobilePane === 'list' ? styles.paneOn : undefined}
              onClick={() => setMobilePane('list')}
              aria-pressed={mobilePane === 'list'}
            >List</button>
            <button
              type="button"
              className={mobilePane === 'chart' ? styles.paneOn : undefined}
              onClick={() => setMobilePane('chart')}
              aria-pressed={mobilePane === 'chart'}
            >Chart</button>
          </div>
          <button className={styles.close} onClick={onClose} aria-label="Close">
            <UIcon name="x" size={14} />
          </button>
        </div>

        {popNotice && <div className={styles.notice}>{popNotice}</div>}

        <WorkspaceContext.Provider value={workspace}>
          <DrillSourceContext.Provider value={source}>
            <BreadthDrillBoard
              board={board}
              onBoardChange={onBoardChange}
              onPopOut={popOut}
              poppedIds={poppedIds}
              mobilePane={mobilePane}
            />

            {/* Ejected widgets. Rendered from the SAME board state and inside the
                SAME providers, so a popped list still publishes into colour group
                A and the chart in the modal follows it — and vice versa. */}
            {board.widgets.filter(w => poppedIds.includes(w.id)).map(w => (
              <PopoutWindow
                key={w.id}
                title={`UCT — ${w.id === LIST_WIDGET_ID ? source.label || 'Breadth' : 'Chart'}`}
                width={w.id === LIST_WIDGET_ID ? 620 : 1100}
                height={800}
                onClose={() => dock(w.id)}
                onBlocked={() => { dock(w.id); setPopNotice(POPUP_BLOCKED_MSG) }}
              >
                <PopoutShell theme={chartsTheme}>
                  <WidgetHost
                    widget={w}
                    // Docking back is what the window's own close does; a ✕ INSIDE
                    // the popped widget would have to mean "delete", and this board
                    // is exactly two widgets.
                    onColorChange={(c) => onBoardChange(b => ({ ...b, widgets: b.widgets.map(x => (x.id === w.id ? { ...x, color: c } : x)) }))}
                    onOptsChange={(opts) => onBoardChange(b => ({ ...b, widgets: b.widgets.map(x => (x.id === w.id ? { ...x, opts } : x)) }))}
                    onReplaceWidget={(id, next) => onBoardChange(b => ({ ...b, widgets: b.widgets.map(x => (x.id === id ? next : x)) }))}
                    onDock={() => dock(w.id)}
                    floating
                  />
                </PopoutShell>
              </PopoutWindow>
            ))}
          </DrillSourceContext.Provider>
        </WorkspaceContext.Provider>
      </div>
    </div>
  )
}

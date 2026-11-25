import { lazy, Suspense, useCallback, useMemo, useRef, useState, useLayoutEffect, cloneElement, Profiler } from 'react'
// ⛔ MEASUREMENT ONLY (measure/next-row-40ms-trace, never merged): each widget's React render, as a user-timing measure
function __rpOnRender(id, phase, actual, _base, start) { try { performance.measure('rp:' + id + ':' + phase, { start, duration: actual }) } catch { /* measurement only */ } }
import { WidgetDoorContext } from './widgetDoors'
import { PanelSlotContext } from './panelSlot'
import ChartWidget from './widgets/ChartWidget'
import WatchlistWidget from './widgets/WatchlistWidget'
import ThemesWidget from './widgets/ThemesWidget'
import ScannerWidget from './widgets/ScannerWidget'
import FundamentalsWidget from './widgets/FundamentalsWidget'
import BreadthWidget from './widgets/BreadthWidget'
import IndexesWidget from './widgets/IndexesWidget'
import MarketContextWidget from './widgets/MarketContextWidget'
import AiSearchWidget from './widgets/AiSearchWidget'
import NewsWidget from './widgets/NewsWidget'
// Lazy — the Notebook pulls the TipTap bundle; keep it OUT of the base charts chunk
// so it only loads when a Notebook widget is actually mounted.
const NotebookWidget = lazy(() => import('./widgets/NotebookWidget'))
import ProfileWidget from './widgets/ProfileWidget'
import AlertsWidget from './widgets/AlertsWidget'
import CalendarWidget from './widgets/CalendarWidget'
import OptionsFlowWidget from './widgets/OptionsFlowWidget'
import PeriodSortWidget from './widgets/PeriodSortWidget'
import NewHighsLowsWidget from './widgets/NewHighsLowsWidget'
import NhnlPulseWidget from './widgets/NhnlPulseWidget'
import VolumeScanWidget from './widgets/VolumeScanWidget'
import ScatterWidget from './widgets/ScatterWidget'
import TradeExchangeNewsWidget from './widgets/TradeExchangeNewsWidget'
import WidgetHeader from './WidgetHeader'
import { useBodySurface } from './uctSurface'
import { UctHeaderSlotContext, UCT_ONE_ROW_MIN_W, UCT_ICON_ONLY_TITLE } from './uctHeaderSlot'
import { WidgetChromeContext } from './widgetChromeContext'
import { effectiveGroup } from './colorGroups'
import useExtraGroupsEnabled from './useExtraGroupsEnabled'
import ErrorBoundary from '../../components/ErrorBoundary'
import { noteChartFault } from './chartFaults'
import { useWorkspace } from './WorkspaceContext'
import usePlacedTheme, { PlacedThemeContext } from '../../hooks/usePlacedTheme'
import {
  resolveActiveTab, orderedWidgetTabList, moveWidgetTab,
  addWidgetTab, closeWidgetTab, setActiveWidgetTab, renameWidgetTab,
  patchActiveTabColor, patchActiveTabOpts,
} from './widgetTabs'
import { labelMap, THEME_FOLLOW_TYPES, catalogMeta } from '../../widgets/registry'
import { menuVarsForCanvas, luminance, parseColor } from '../../utils/dividerColor'
import styles from './ChartsWorkspace.module.css'

const TYPE_LABEL = labelMap('header')

// THE /charts host binding: registry id → { component, props }. The metadata
// registry (src/widgets/registry.js) deliberately carries no component refs, so
// each host owns its binding map; registry.test.js pins that every registered
// id has an entry here AND that each props builder keeps the EXACT prop shape
// the old WidgetBody switch passed — those shapes are load-bearing (breadth
// takes no `color`, themes no `onOptsChange`, aisearch only `color`, and only
// chart gets `chartId`).
const standardProps = ({ colorKey, opts, onOptsChange }) => ({ color: colorKey, opts, onOptsChange })
export const WORKSPACE_WIDGETS = {
  // ⭐ `chartId` (Phase C Task 12): the slot's own PERSISTED id, which is what
  // makes a chart's alerts scopable to it. `groupId` is already per-tab and
  // already stable across reloads — see its declaration in `WidgetHost`.
  chart: {
    component: ChartWidget,
    props: ({ colorKey, opts, onOptsChange, groupId }) => ({ color: colorKey, opts, onOptsChange, chartId: groupId }),
  },
  watchlist: { component: WatchlistWidget, props: standardProps },
  themes: { component: ThemesWidget, props: ({ colorKey, opts, onOptsChange }) => ({ color: colorKey, opts, onOptsChange }) },
  scanner: { component: ScannerWidget, props: standardProps },
  fundamentals: { component: FundamentalsWidget, props: standardProps },
  breadth: { component: BreadthWidget, props: ({ opts, onOptsChange }) => ({ opts, onOptsChange }) },
  // Market-wide readings: no symbol, so no `color` — the breadth prop shape.
  indexes: { component: IndexesWidget, props: ({ opts, onOptsChange }) => ({ opts, onOptsChange }) },
  // …and market context has no per-widget options either, so it receives NONE
  // (the aisearch idiom: a widget takes what it uses). Growing one is a
  // decision the registry rail makes visible.
  marketcontext: { component: MarketContextWidget, props: () => ({}) },
  aisearch: { component: AiSearchWidget, props: ({ colorKey }) => ({ color: colorKey }) },
  news: { component: NewsWidget, props: standardProps },
  notebook: { component: NotebookWidget, props: standardProps },
  profile: { component: ProfileWidget, props: standardProps },
  alerts: { component: AlertsWidget, props: standardProps },
  calendar: { component: CalendarWidget, props: standardProps },
  optionsflow: { component: OptionsFlowWidget, props: standardProps },
  periodsort: { component: PeriodSortWidget, props: standardProps },
  nhnl: { component: NewHighsLowsWidget, props: standardProps },
  nhnlPulse: { component: NhnlPulseWidget, props: standardProps },
  volumescan: { component: VolumeScanWidget, props: standardProps },
  scatter: { component: ScatterWidget, props: standardProps },
  tradeExchangeNews: { component: TradeExchangeNewsWidget, props: standardProps },
  // RETIRED (UCT News V2): a Research Library already in a saved layout opens as UCT News
  // on its Saved Headlines view, with the same filters (collection / ticker / sort opts).
  // The layout is never rewritten and the instance is never dropped.
  researchLibrary: { component: TradeExchangeNewsWidget, props: (p) => ({ ...standardProps(p), defaultView: 'saved' }) },
}

// TD-02 (S1 CP3, gate fc609961a): a widget that throws during render used to take
// the whole /charts board down to App.jsx's RouteErrorBoundary — one bad ticker or
// a bad opts shape in ONE panel cost every other open widget. `WidgetBody` is the
// single render path every widget type goes through (see WORKSPACE_WIDGETS above),
// so one boundary here isolates every widget kind without a per-type wrapper.
// TERM-027: `withHeader` is the PANEL-level fallback (see WidgetHost's render), used
// when the header itself threw. It cannot re-render WidgetHeader — that is what
// failed — so it draws a bare bar: still a drag handle, still a way to remove the
// panel. A panel that loses its header on error is a worse failure than the error.
function WidgetErrorFallback({ type, onRemove, withHeader = false }) {
  const label = TYPE_LABEL[type] || type || 'widget'
  const message = (
    <div className={styles.unknownWidget} role="alert" data-widget-error-type={type || ''}>
      This {label} hit an error. Remove and re-add it, or reload the page.
    </div>
  )
  if (!withHeader) return message
  return (
    <>
      <div className={`${styles.widgetHeader} charts-widget-drag-handle`} style={{ cursor: 'grab' }}>
        <span className={styles.widgetLabel}>{label}</span>
        <span className={styles.headerSpacer} />
        {onRemove && (
          <button type="button" className={styles.closeBtn} onClick={onRemove} aria-label="Close widget" title="Remove this widget">×</button>
        )}
      </div>
      <div className={styles.widgetBody}>{message}</div>
    </>
  )
}

function WidgetBody({ groupId, type, color, opts, onOptsChange, slotReady }) {
  // Color 'N' = "not linked": give the surface a UNIQUE group key so it reads/writes
  // its own ticker instead of sharing a color group with anything else (every widget
  // links purely off this `color` prop via groupSyms[color]). `groupId` is per-TAB,
  // so two "not linked" tabs in the same slot stay independent.
  // COV-10 remainder: a stored E-H while CHARTS_EXTRA_GROUPS_ENABLED is off reads as
  // not linked too (colorGroups.effectiveGroup) — the layout keeps the colour, the
  // widget stops sharing an unnamed fifth group.
  const extraGroupsOn = useExtraGroupsEnabled()
  const key = effectiveGroup(color, extraGroupsOn) === 'N' ? `N:${groupId}` : color
  const binding = WORKSPACE_WIDGETS[type]
  if (!binding) return <div className={styles.unknownWidget}>Unknown widget type: {type}</div>
  const Widget = binding.component
  // Suspense boundary for the lazy Notebook (a no-op passthrough for the eagerly
  // imported widgets, which never suspend). `key={groupId}` on the boundary itself
  // resets a tripped boundary if the widget's identity changes under it (a tab
  // swap reusing the same DOM slot), so a stale error state can't outlive its cause.
  return (
    <ErrorBoundary key={groupId} fallback={<WidgetErrorFallback type={type} />} onError={type === 'chart' ? () => noteChartFault(String(groupId).replace(':', '~')) : undefined}>
      <Suspense fallback={<div style={{ padding: 14, fontSize: 12, color: 'var(--text-muted, #8b8674)' }}>Loading…</div>}>
        <WidgetDoorContext.Provider value={groupId}>
          <PanelSlotContext.Provider value={slotReady}>
            <Profiler id={`${type}:${groupId}`} onRender={__rpOnRender}><Widget {...binding.props({ colorKey: key, opts, onOptsChange, groupId })} /></Profiler>
          </PanelSlotContext.Provider>
        </WidgetDoorContext.Provider>
      </Suspense>
    </ErrorBoundary>
  )
}

export default function WidgetHost({ widget, onRemove, onColorChange, onOptsChange, onReplaceWidget, onPopOut, headerAtBottom = false, merged = false,
  // In-canvas float (pop the widget onto another widget). onFloat = grid mode;
  // floating + onDock/floatTabTargets/onFloatToTab/onHeaderDragStart = while floating.
  onFloat, floating = false, onDock, floatTabTargets = [], onFloatToTab, onHeaderDragStart,
  // T3 integrated chart header — opt-in, passed only by the /charts board grid. A single
  // chart (no widget-level tabs, not merged, not floating) then has NO header bar: its
  // identity row becomes the title bar, hosting the link dot + window controls and acting
  // as the drag handle (WidgetChromeContext). Every other host is unaffected.
  integratedChartHeader = false,
  // UCT frame (owner 11-13) — opt-in, passed by the /charts board (grid, floating, pop-out
  // windows): every non-merged widget wears the chart widget's style — a titled one-surface
  // header (icon + link badge · name · quiet window controls), rounded corners, soft shadow.
  uctFrame = false,
  // No "+ Add a tab" (the breadth drill: its two panes are fixed, a tab there means nothing).
  noTabs = false,
  // S1 CP3 mount cap: defaults true so every caller that doesn't pass it (popped
  // boards, the single popout window, every existing test) is unaffected. Only
  // the main board's renderGrid call site passes false while this widget is
  // still queued behind PANEL_MOUNT_CAP concurrent mounts.
  mounted = true,
  // The main board's mount queue: called with this widget's id once its first content is up.
  onPanelReady }) {
  const slotReady = useCallback(() => onPanelReady?.(widget.id), [onPanelReady, widget.id])
  // The slot can hold several widgets of different types as tabs; resolve the one
  // currently showing. A tab-less slot resolves to the base widget unchanged.
  const active = resolveActiveTab(widget)
  const tabList = orderedWidgetTabList(widget)   // strip order (owner 11-14); each tab carries its storage index
  // Per-tab group id so two "not linked" tabs in one slot don't collide.
  const groupId = active.isMain ? widget.id : `${widget.id}:${active.tabId}`

  // All tab/color/opts mutations replace the whole widget object via onReplaceWidget
  // (the reducer routes each edit to the active tab). Fall back to the legacy
  // whole-widget callbacks for callers that don't supply it (base tab only).
  const replace = (nextWidget) => onReplaceWidget?.(widget.id, nextWidget)
  const handleActiveColorChange = (c) => (onReplaceWidget ? replace(patchActiveTabColor(widget, c)) : onColorChange?.(c))
  const handleActiveOptsChange = (opts) => (onReplaceWidget ? replace(patchActiveTabOpts(widget, opts)) : onOptsChange?.(opts))
  const handleAddTab = onReplaceWidget && !noTabs ? (type) => replace(addWidgetTab(widget, { type, color: active.color })) : undefined
  // Non-chart widgets follow the app theme when uncustomized: on the light theme
  // the workspace otherwise keeps this .widget dark (border + chrome). This flag
  // lets the CSS re-flip the light tokens (incl. the border) for the whole widget.
  // Membership lives on the registry (themeFollow — every type except chart).
  const themeFollow = THEME_FOLLOW_TYPES.includes(active.type) && !active.opts?.settings
  const handleSelectTab = onReplaceWidget ? (i) => replace(setActiveWidgetTab(widget, i)) : undefined
  const handleCloseTab = onReplaceWidget ? (tabId) => replace(closeWidgetTab(widget, tabId)) : undefined
  const handleRenameTab = onReplaceWidget ? (tabId, name) => replace(renameWidgetTab(widget, tabId, name)) : undefined
  const handleMoveTab = onReplaceWidget ? (tabId, dir) => replace(moveWidgetTab(widget, tabId, dir)) : undefined

  // Publish THIS widget's own canvas color to its own subtree, so its chrome (panel,
  // border, header bar, and its interior top rows) matches the surface it wraps.
  // Scoped per widget on purpose: only types with a user-facing canvas setting appear
  // in the map, so Fundamentals / Theme Tracker / AI Search / Scanner get no variable
  // and keep the default tokens until they gain settings of their own. Setting this on
  // the workspace root instead would leak the chart's color into every widget.
  const { widgetCanvasByType, widgetCanvasById, chartsTheme } = useWorkspace() || {}
  // FREEZE a theme-following widget's app theme at placement. `frozenTheme` drives TWO
  // things that must agree: the JS body colors (published on PlacedThemeContext, read by
  // the widget's usePlacedTheme) and the chrome tokens (the .widgetFrozenLight class for
  // a light placement — a dark placement needs none, the workspace default is already
  // dark). This replaces the old reactive `.widgetThemeFollow`, which re-flipped live off
  // the *app* [data-theme] and recolored existing widgets on every theme switch. Only NEW
  // widgets (a fresh usePlacedTheme capture / a fresh opts.placedTheme stamp) pick up the
  // current theme. Skipped under Sunrise (its own [data-charts-theme] palette owns the
  // look) and until prefs load (null → the live fallback holds for that first tick).
  const placedTheme = usePlacedTheme(active.opts?.placedTheme)
  // Provided to the whole widget subtree ALWAYS — even once the widget is customized —
  // so surfaces that still resolve from the app theme (e.g. the picker's own chrome,
  // reset handlers) keep using the PLACEMENT theme rather than falling back to the live
  // one. (Only the chrome-token CLASS below is gated on themeFollow.)
  const ctxTheme = (chartsTheme !== 'sunrise' && placedTheme) ? placedTheme : null
  // The .widgetFrozenLight chrome-token class is only for an UNCUSTOMIZED light-placed
  // widget; a customized widget carries its own canvas (opts.settings → widgetCanvasById
  // for the chrome + --wl-bg for the body).
  const frozenTheme = ctxTheme   // (name kept for the render below)
  const frozenLightOn = themeFollow && ctxTheme === 'light'
  // Per-widget chrome wins (each widget owns its settings now); fall back to the
  // per-type global default for a widget that hasn't diverged.
  const chrome = widgetCanvasById?.[widget.id] || widgetCanvasByType?.[active.type] || null
  // --widget-divider keeps the hairlines BETWEEN header rows visible at any canvas
  // color: they were fixed near-white and disappeared on a light canvas.
  const chromeStyle = chrome?.canvas
    ? {
        '--widget-canvas': chrome.canvas,
        ...(chrome.divider ? { '--widget-divider': chrome.divider } : {}),
        ...(chrome.dividerStrong ? { '--widget-divider-strong': chrome.dividerStrong } : {}),
        // Text/accent for chrome sitting on the canvas — session toggle, market clock.
        // Gold on white is barely legible, so the accent darkens with the canvas too.
        ...(chrome.chrome ? {
          '--widget-text': chrome.chrome.text,
          '--widget-text-strong': chrome.chrome.textStrong,
          '--widget-accent': chrome.chrome.accent,
          '--widget-accent-bg': chrome.chrome.accentBg,
          '--widget-row-hover': chrome.rowHover,
        } : {}),
        // The clock's hover popup floats over the canvas, so it matches it like the
        // chart's own legend panels do.
        ...(chrome.panel ? {
          '--widget-popup-bg': chrome.panel.bg,
          '--widget-popup-border': chrome.panel.border,
        } : {}),
      }
    : undefined

  // When this widget's header docks at the BOTTOM (another widget sits directly
  // above it) and the canvas is a GRADIENT, override the header's canvas/divider to
  // the gradient's BOTTOM stop so the bar matches the bottom of the gradient it caps
  // — not the top color the rest of the widget chrome uses.
  const bottomChrome = headerAtBottom ? chrome?.bottom : null
  const headerStyle = bottomChrome?.canvas
    ? {
        '--widget-canvas': bottomChrome.canvas,
        ...(bottomChrome.divider ? { '--widget-divider': bottomChrome.divider } : {}),
        ...(bottomChrome.dividerStrong ? { '--widget-divider-strong': bottomChrome.dividerStrong } : {}),
        ...(bottomChrome.chrome ? {
          '--widget-text': bottomChrome.chrome.text,
          '--widget-text-strong': bottomChrome.chrome.textStrong,
          '--widget-accent': bottomChrome.chrome.accent,
          '--widget-accent-bg': bottomChrome.chrome.accentBg,
          '--widget-row-hover': bottomChrome.rowHover,
        } : {}),
      }
    : undefined

  // The add-tab ("+") menu wears THIS widget's canvas color instead of the fixed
  // dark menu palette (owner request) — derived from the same canvas its chrome uses.
  const addMenuTheme = chrome?.canvas ? menuVarsForCanvas(chrome.canvas) : null

  // Merged board (owner 11-14): widgets keep the UCT frame (header, controls and the
  // board-only interior styling); only the outer card (radius, shadow, gaps) goes flush.
  const uct = uctFrame
  // UCT frame: the header wears the colour the body actually paints (one surface).
  const bodyRef = useRef(null)
  // One-row slot: the header's slot element, offered to the body only while the header is
  // wide enough (and the slot shows a single widget — tabs take that space otherwise).
  const [slotEl, setSlotEl] = useState(null)
  const [ctrlSlotEl, setCtrlSlotEl] = useState(null)
  // A tabbed slot (owner 11-14): the tab strip takes the title row, so a widget's own title-row
  // content (Calendar's week, a note's path, the Theme Tracker's periods) gets a row of its own
  // just under the header — and its buttons still go top-right, in the controls slot.
  const [subSlotEl, setSubSlotEl] = useState(null)
  const [wideHeader, setWideHeader] = useState(false)
  // "Wide" = the widget's row actually FITS beside the icon and controls. While the row is up
  // there and overflows, the header width it would need is remembered, so the header drops
  // to two rows below that width and comes back above it (no flip-flop at the edge).
  // Remembered per row (rowKey, claimed by the widget's body), so the picker's long tab row
  // and an open list's short name row each get their own fit.
  const needWRef = useRef(new Map())
  const [rowKey, setRowKey] = useState(null)
  useLayoutEffect(() => {
    const head = slotEl?.parentElement
    const view = head?.ownerDocument?.defaultView
    if (!head || !view?.ResizeObserver) return undefined
    const needs = needWRef.current
    const check = () => {
      const row = slotEl.firstElementChild
      let need = needs.get(rowKey) ?? UCT_ONE_ROW_MIN_W
      if (row) {
        const over = row.scrollWidth - slotEl.clientWidth
        if (over > 1) { need = Math.max(need, head.clientWidth + over + 8); needs.set(rowKey, need) }
      }
      setWideHeader(head.clientWidth >= need)
    }
    const ro = new view.ResizeObserver(check)
    ro.observe(head)
    ro.observe(slotEl)
    const mo = view.MutationObserver ? new view.MutationObserver(check) : null
    mo?.observe(slotEl, { childList: true })
    return () => { ro.disconnect(); mo?.disconnect() }
  }, [slotEl, rowKey])
  const uctSurface = useBodySurface(bodyRef, uct && !(integratedChartHeader && !floating && active.type === 'chart' && !(Array.isArray(tabList) && tabList.length > 1)), `${active.type}|${mounted}`)
  const header = (
    <WidgetHeader
      label={TYPE_LABEL[active.type] || active.type}
      color={active.color}
      onColorChange={handleActiveColorChange}
      onRemove={onRemove}
      onPopOut={onPopOut}
      atBottom={headerAtBottom}
      style={uct && uctSurface ? { ...(headerStyle || {}), '--uct-head-bg': uctSurface } : headerStyle}
      addMenuTheme={addMenuTheme}
      tabs={tabList}
      activeIndex={active.index}
      onSelectTab={handleSelectTab}
      onCloseTab={handleCloseTab}
      onRenameTab={handleRenameTab}
      onMoveTab={handleMoveTab}
      onAddTab={handleAddTab}
      onFloat={onFloat}
      floating={floating}
      onDock={onDock}
      floatTabTargets={floatTabTargets}
      onFloatToTab={onFloatToTab}
      onHeaderDragStart={onHeaderDragStart}
      look={uct ? 'uct' : null}
      slotRef={uct ? setSlotEl : null}
      ctrlSlotRef={uct ? setCtrlSlotEl : null}
      iconOnly={uct && UCT_ICON_ONLY_TITLE.includes(active.type)}
      icon={uct ? catalogMeta(active.type).icon : null}
    />
  )
  const integrated = integratedChartHeader && (uct || !merged) && !floating
    && active.type === 'chart' && !(Array.isArray(tabList) && tabList.length > 1)
  const integratedChrome = integrated
    ? {
        left: cloneElement(header, { part: 'dot' }),
        right: cloneElement(header, { part: 'controls' }),
        dragHandleClass: 'charts-widget-drag-handle',
      }
    : null
  // Integrated chart header on a DARK canvas: chrome text in the site's own white /
  // light grey instead of the canvas-derived warm greys. (No canvas known = the dark default.)
  const canvasRgb = chrome?.canvas ? parseColor(chrome.canvas) : null
  const darkCanvas = !canvasRgb || luminance(canvasRgb) <= 0.5
  // UCT frame (owner 11-13): the same crisp site white / grey as the chart's header, on
  // every widget — judged on the surface the body actually paints when it is known.
  const surfaceRgb = uctSurface ? parseColor(uctSurface) : null
  const uctDark = surfaceRgb ? luminance(surfaceRgb) <= 0.5 : darkCanvas
  const widgetStyle0 = (integrated && darkCanvas) || (uct && !integrated && uctDark)
    ? {
        ...(chromeStyle || {}),
        '--widget-text': 'var(--text-muted, #cfcac0)',
        '--widget-text-strong': 'var(--text-bright, #f8f7f3)',
      }
    : chromeStyle
  // Surface-aware accents (owner 11-14, light themes): a recessed "drawer" shade and the UCT
  // gold, chosen by the colour the body ACTUALLY paints — a light widget on a dark app theme
  // (or the reverse) still gets a faint drawer and a readable gold. Inner CSS reads these.
  const widgetStyle = uct && !integrated
    ? {
        ...(widgetStyle0 || {}),
        '--uct-recess': uctDark ? 'rgba(0, 0, 0, 0.28)' : 'rgba(0, 0, 0, 0.045)',
        '--uct-recess-shadow': uctDark ? 'inset 0 6px 8px -6px rgba(0, 0, 0, 0.7)' : 'inset 0 6px 8px -6px rgba(0, 0, 0, 0.16)',
        '--uct-gold': uctDark ? '#dcbb5e' : '#8a6a14',
      }
    : widgetStyle0
  // Merged mode keeps NO header chrome, but a multi-tab slot still needs its tab
  // strip or the tabs become unreachable. This renders ONLY the strip (returns null
  // for a single-tab slot, so the seamless look is untouched there).
  const mergedTabs = (
    <WidgetHeader
      tabsOnly
      tabs={tabList}
      activeIndex={active.index}
      color={active.color}
      onColorChange={handleActiveColorChange}
      onRemove={onRemove}
      onSelectTab={handleSelectTab}
      onCloseTab={handleCloseTab}
      onRenameTab={handleRenameTab}
      onMoveTab={handleMoveTab}
    />
  )
  const tabbedUct = uct && !integrated && Array.isArray(tabList) && tabList.length > 1
  const headerSlots = useMemo(() => ({
    row: uct && wideHeader ? slotEl : null,
    rowAlways: uct ? (slotEl || (tabbedUct ? subSlotEl : null)) : null,
    rowIsSub: !!(uct && !slotEl && tabbedUct && subSlotEl),
    controls: uct ? ctrlSlotEl : null,
    claim: uct ? setRowKey : null,
  }), [uct, wideHeader, slotEl, ctrlSlotEl, tabbedUct, subSlotEl])
  const subRow = tabbedUct ? <div className={styles.uctSubRow} ref={setSubSlotEl} data-uct-subrow="" /> : null
  const body = (
    <div className={styles.widgetBody} ref={bodyRef}>
      {mounted
        ? (
          <UctHeaderSlotContext.Provider value={headerSlots}>
            <WidgetBody
              groupId={groupId}
              type={active.type}
              color={active.color}
              opts={active.opts}
              onOptsChange={handleActiveOptsChange}
              slotReady={onPanelReady ? slotReady : null}
            />
          </UctHeaderSlotContext.Provider>
        )
        // Header/chrome above still renders — RGL's geometry and the layout the
        // member sees never jump — only the widget's own data-fetching body waits.
        : <div style={{ padding: 14, fontSize: 12, color: 'var(--text-muted, #8b8674)' }}>Loading…</div>}
    </div>
  )
  // Merged view: no border, no header bar — the widgets blend into one seamless board
  // (except a multi-tab slot's minimal tab strip). Otherwise, when another widget sits
  // directly above this one, drop the drag/close bar to the BOTTOM so the two widgets
  // blend together at the seam (no header in the middle).
  return (
    <PlacedThemeContext.Provider value={frozenTheme}>
      <div
        className={`${styles.widget}${merged ? ' ' + styles.widgetMerged : ''}${integrated ? ' ' + styles.widgetIntegrated : ''}${uct && !integrated ? ' ' + styles.widgetUct + ' uct-frame' : ''}${
          frozenLightOn
            ? ' ' + styles.widgetFrozenLight            /* UNCUSTOMIZED light placement → force light chrome regardless of app theme */
            : (themeFollow && !ctxTheme ? ' ' + styles.widgetThemeFollow : '')  /* loading/sunrise: live fallback */
        }`}
        style={widgetStyle}
      >
        {/* TERM-027: WidgetBody's boundary covers only the body, and the header used
            to render outside it — a header-side throw escaped to the route boundary
            and took the whole board. This panel-level boundary catches it for THIS
            panel only. A body throw is still caught first by WidgetBody's inner
            boundary, so it keeps the real header; only a header throw lands here. */}
        <ErrorBoundary key={groupId} fallback={<WidgetErrorFallback type={active.type} onRemove={onRemove} withHeader />}>
          {merged && !uct
            ? <>{mergedTabs}{body}</>
            : integrated
              ? <WidgetChromeContext.Provider value={integratedChrome}>{body}</WidgetChromeContext.Provider>
              : (headerAtBottom ? <>{subRow}{body}{header}</> : <>{header}{subRow}{body}</>)}
        </ErrorBoundary>
      </div>
    </PlacedThemeContext.Provider>
  )
}

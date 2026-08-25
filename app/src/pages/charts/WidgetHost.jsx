import ChartWidget from './widgets/ChartWidget'
import WatchlistWidget from './widgets/WatchlistWidget'
import ThemesWidget from './widgets/ThemesWidget'
import ScannerWidget from './widgets/ScannerWidget'
import FundamentalsWidget from './widgets/FundamentalsWidget'
import BreadthWidget from './widgets/BreadthWidget'
import AiSearchWidget from './widgets/AiSearchWidget'
import NewsWidget from './widgets/NewsWidget'
import ProfileWidget from './widgets/ProfileWidget'
import AlertsWidget from './widgets/AlertsWidget'
import CalendarWidget from './widgets/CalendarWidget'
import OptionsFlowWidget from './widgets/OptionsFlowWidget'
import PeriodSortWidget from './widgets/PeriodSortWidget'
import NewHighsLowsWidget from './widgets/NewHighsLowsWidget'
import NhnlPulseWidget from './widgets/NhnlPulseWidget'
import WidgetHeader from './WidgetHeader'
import { useWorkspace } from './WorkspaceContext'
import usePlacedTheme, { PlacedThemeContext } from '../../hooks/usePlacedTheme'
import {
  resolveActiveTab, widgetTabList,
  addWidgetTab, closeWidgetTab, setActiveWidgetTab, renameWidgetTab,
  patchActiveTabColor, patchActiveTabOpts,
} from './widgetTabs'
import { labelMap, THEME_FOLLOW_TYPES } from '../../widgets/registry'
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
  themes: { component: ThemesWidget, props: ({ colorKey, opts }) => ({ color: colorKey, opts }) },
  scanner: { component: ScannerWidget, props: standardProps },
  fundamentals: { component: FundamentalsWidget, props: standardProps },
  breadth: { component: BreadthWidget, props: ({ opts, onOptsChange }) => ({ opts, onOptsChange }) },
  aisearch: { component: AiSearchWidget, props: ({ colorKey }) => ({ color: colorKey }) },
  news: { component: NewsWidget, props: standardProps },
  profile: { component: ProfileWidget, props: standardProps },
  alerts: { component: AlertsWidget, props: standardProps },
  calendar: { component: CalendarWidget, props: standardProps },
  optionsflow: { component: OptionsFlowWidget, props: standardProps },
  periodsort: { component: PeriodSortWidget, props: standardProps },
  nhnl: { component: NewHighsLowsWidget, props: standardProps },
  nhnlPulse: { component: NhnlPulseWidget, props: standardProps },
}

function WidgetBody({ groupId, type, color, opts, onOptsChange }) {
  // Color 'N' = "not linked": give the surface a UNIQUE group key so it reads/writes
  // its own ticker instead of sharing a color group with anything else (every widget
  // links purely off this `color` prop via groupSyms[color]). `groupId` is per-TAB,
  // so two "not linked" tabs in the same slot stay independent.
  const key = color === 'N' ? `N:${groupId}` : color
  const binding = WORKSPACE_WIDGETS[type]
  if (!binding) return <div className={styles.unknownWidget}>Unknown widget type: {type}</div>
  const Widget = binding.component
  return <Widget {...binding.props({ colorKey: key, opts, onOptsChange, groupId })} />
}

export default function WidgetHost({ widget, onRemove, onColorChange, onOptsChange, onReplaceWidget, onPopOut, headerAtBottom = false, merged = false,
  // In-canvas float (pop the widget onto another widget). onFloat = grid mode;
  // floating + onDock/floatTabTargets/onFloatToTab/onHeaderDragStart = while floating.
  onFloat, floating = false, onDock, floatTabTargets = [], onFloatToTab, onHeaderDragStart }) {
  // The slot can hold several widgets of different types as tabs; resolve the one
  // currently showing. A tab-less slot resolves to the base widget unchanged.
  const active = resolveActiveTab(widget)
  const tabList = widgetTabList(widget)
  // Per-tab group id so two "not linked" tabs in one slot don't collide.
  const groupId = active.isMain ? widget.id : `${widget.id}:${active.tabId}`

  // All tab/color/opts mutations replace the whole widget object via onReplaceWidget
  // (the reducer routes each edit to the active tab). Fall back to the legacy
  // whole-widget callbacks for callers that don't supply it (base tab only).
  const replace = (nextWidget) => onReplaceWidget?.(widget.id, nextWidget)
  const handleActiveColorChange = (c) => (onReplaceWidget ? replace(patchActiveTabColor(widget, c)) : onColorChange?.(c))
  const handleActiveOptsChange = (opts) => (onReplaceWidget ? replace(patchActiveTabOpts(widget, opts)) : onOptsChange?.(opts))
  const handleAddTab = onReplaceWidget ? (type) => replace(addWidgetTab(widget, { type, color: active.color })) : undefined
  // Non-chart widgets follow the app theme when uncustomized: on the light theme
  // the workspace otherwise keeps this .widget dark (border + chrome). This flag
  // lets the CSS re-flip the light tokens (incl. the border) for the whole widget.
  // Membership lives on the registry (themeFollow — every type except chart).
  const themeFollow = THEME_FOLLOW_TYPES.includes(active.type) && !active.opts?.settings
  const handleSelectTab = onReplaceWidget ? (i) => replace(setActiveWidgetTab(widget, i)) : undefined
  const handleCloseTab = onReplaceWidget ? (tabId) => replace(closeWidgetTab(widget, tabId)) : undefined
  const handleRenameTab = onReplaceWidget ? (tabId, name) => replace(renameWidgetTab(widget, tabId, name)) : undefined

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

  const header = (
    <WidgetHeader
      label={TYPE_LABEL[active.type] || active.type}
      color={active.color}
      onColorChange={handleActiveColorChange}
      onRemove={onRemove}
      onPopOut={onPopOut}
      atBottom={headerAtBottom}
      style={headerStyle}
      tabs={tabList}
      activeIndex={active.index}
      onSelectTab={handleSelectTab}
      onCloseTab={handleCloseTab}
      onRenameTab={handleRenameTab}
      onAddTab={handleAddTab}
      onFloat={onFloat}
      floating={floating}
      onDock={onDock}
      floatTabTargets={floatTabTargets}
      onFloatToTab={onFloatToTab}
      onHeaderDragStart={onHeaderDragStart}
    />
  )
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
    />
  )
  const body = (
    <div className={styles.widgetBody}>
      <WidgetBody
        groupId={groupId}
        type={active.type}
        color={active.color}
        opts={active.opts}
        onOptsChange={handleActiveOptsChange}
      />
    </div>
  )
  // Merged view: no border, no header bar — the widgets blend into one seamless board
  // (except a multi-tab slot's minimal tab strip). Otherwise, when another widget sits
  // directly above this one, drop the drag/close bar to the BOTTOM so the two widgets
  // blend together at the seam (no header in the middle).
  return (
    <PlacedThemeContext.Provider value={frozenTheme}>
      <div
        className={`${styles.widget}${merged ? ' ' + styles.widgetMerged : ''}${
          frozenLightOn
            ? ' ' + styles.widgetFrozenLight            /* UNCUSTOMIZED light placement → force light chrome regardless of app theme */
            : (themeFollow && !ctxTheme ? ' ' + styles.widgetThemeFollow : '')  /* loading/sunrise: live fallback */
        }`}
        style={chromeStyle}
      >
        {merged
          ? <>{mergedTabs}{body}</>
          : (headerAtBottom ? <>{body}{header}</> : <>{header}{body}</>)}
      </div>
    </PlacedThemeContext.Provider>
  )
}

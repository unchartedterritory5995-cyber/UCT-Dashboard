import ChartWidget from './widgets/ChartWidget'
import WatchlistWidget from './widgets/WatchlistWidget'
import ThemesWidget from './widgets/ThemesWidget'
import ScannerWidget from './widgets/ScannerWidget'
import FundamentalsWidget from './widgets/FundamentalsWidget'
import BreadthWidget from './widgets/BreadthWidget'
import AiSearchWidget from './widgets/AiSearchWidget'
import NewsWidget from './widgets/NewsWidget'
import ProfileWidget from './widgets/ProfileWidget'
import WidgetHeader from './WidgetHeader'
import { useWorkspace } from './WorkspaceContext'
import {
  resolveActiveTab, widgetTabList,
  addWidgetTab, closeWidgetTab, setActiveWidgetTab, renameWidgetTab,
  patchActiveTabColor, patchActiveTabOpts,
} from './widgetTabs'
import styles from './ChartsWorkspace.module.css'

const TYPE_LABEL = {
  chart: 'Chart',
  watchlist: 'Watchlist',
  themes: 'Themes',
  scanner: 'Scanner',
  fundamentals: 'Fundamentals',
  breadth: 'Breadth',
  aisearch: 'AI Search',
  news: 'News',
  profile: 'Profile',
}

function WidgetBody({ groupId, type, color, opts, onOptsChange }) {
  // Color 'N' = "not linked": give the surface a UNIQUE group key so it reads/writes
  // its own ticker instead of sharing a color group with anything else (every widget
  // links purely off this `color` prop via groupSyms[color]). `groupId` is per-TAB,
  // so two "not linked" tabs in the same slot stay independent.
  const key = color === 'N' ? `N:${groupId}` : color
  switch (type) {
    case 'chart':     return <ChartWidget     color={key} opts={opts} onOptsChange={onOptsChange} />
    case 'watchlist': return <WatchlistWidget color={key} opts={opts} onOptsChange={onOptsChange} />
    case 'themes':    return <ThemesWidget    color={key} opts={opts} />
    case 'scanner':   return <ScannerWidget   color={key} opts={opts} />
    case 'fundamentals': return <FundamentalsWidget color={key} opts={opts} onOptsChange={onOptsChange} />
    case 'breadth':   return <BreadthWidget opts={opts} onOptsChange={onOptsChange} />
    case 'aisearch':  return <AiSearchWidget color={key} />
    case 'news':      return <NewsWidget color={key} opts={opts} onOptsChange={onOptsChange} />
    case 'profile':   return <ProfileWidget color={key} opts={opts} onOptsChange={onOptsChange} />
    default:          return <div className={styles.unknownWidget}>Unknown widget type: {type}</div>
  }
}

export default function WidgetHost({ widget, onRemove, onColorChange, onOptsChange, onReplaceWidget, onPopOut, headerAtBottom = false, merged = false }) {
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
  // News/Profile follow the app theme when uncustomized: on the light theme the
  // workspace otherwise keeps this .widget dark (border + chrome). This flag lets the
  // CSS re-flip the light tokens (incl. the border) for the whole widget.
  const themeFollow = ['news', 'profile', 'watchlist'].includes(active.type) && !active.opts?.settings
  const handleSelectTab = onReplaceWidget ? (i) => replace(setActiveWidgetTab(widget, i)) : undefined
  const handleCloseTab = onReplaceWidget ? (tabId) => replace(closeWidgetTab(widget, tabId)) : undefined
  const handleRenameTab = onReplaceWidget ? (tabId, name) => replace(renameWidgetTab(widget, tabId, name)) : undefined

  // Publish THIS widget's own canvas color to its own subtree, so its chrome (panel,
  // border, header bar, and its interior top rows) matches the surface it wraps.
  // Scoped per widget on purpose: only types with a user-facing canvas setting appear
  // in the map, so Fundamentals / Theme Tracker / AI Search / Scanner get no variable
  // and keep the default tokens until they gain settings of their own. Setting this on
  // the workspace root instead would leak the chart's color into every widget.
  const { widgetCanvasByType, widgetCanvasById } = useWorkspace() || {}
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
    <div
      className={`${styles.widget}${merged ? ' ' + styles.widgetMerged : ''}${themeFollow ? ' ' + styles.widgetThemeFollow : ''}`}
      style={chromeStyle}
    >
      {merged
        ? <>{mergedTabs}{body}</>
        : (headerAtBottom ? <>{body}{header}</> : <>{header}{body}</>)}
    </div>
  )
}

import ChartWidget from './widgets/ChartWidget'
import WatchlistWidget from './widgets/WatchlistWidget'
import ThemesWidget from './widgets/ThemesWidget'
import ScannerWidget from './widgets/ScannerWidget'
import FundamentalsWidget from './widgets/FundamentalsWidget'
import AiSearchWidget from './widgets/AiSearchWidget'
import WidgetHeader from './WidgetHeader'
import { useWorkspace } from './WorkspaceContext'
import styles from './ChartsWorkspace.module.css'

const TYPE_LABEL = {
  chart: 'Chart',
  watchlist: 'Watchlist',
  themes: 'Themes',
  scanner: 'Scanner',
  fundamentals: 'Fundamentals',
  aisearch: 'AI Search',
}

function WidgetBody({ widget, onOptsChange }) {
  switch (widget.type) {
    case 'chart':     return <ChartWidget     color={widget.color} opts={widget.opts} onOptsChange={onOptsChange} />
    case 'watchlist': return <WatchlistWidget color={widget.color} opts={widget.opts} onOptsChange={onOptsChange} />
    case 'themes':    return <ThemesWidget    color={widget.color} opts={widget.opts} />
    case 'scanner':   return <ScannerWidget   color={widget.color} opts={widget.opts} />
    case 'fundamentals': return <FundamentalsWidget color={widget.color} opts={widget.opts} onOptsChange={onOptsChange} />
    case 'aisearch':  return <AiSearchWidget color={widget.color} />
    default:          return <div className={styles.unknownWidget}>Unknown widget type: {widget.type}</div>
  }
}

export default function WidgetHost({ widget, onRemove, onColorChange, onOptsChange, headerAtBottom = false, merged = false }) {
  // Publish THIS widget's own canvas color to its own subtree, so its chrome (panel,
  // border, header bar, and its interior top rows) matches the surface it wraps.
  // Scoped per widget on purpose: only types with a user-facing canvas setting appear
  // in the map, so Fundamentals / Theme Tracker / AI Search / Scanner get no variable
  // and keep the default tokens until they gain settings of their own. Setting this on
  // the workspace root instead would leak the chart's color into every widget.
  const { widgetCanvasByType } = useWorkspace() || {}
  const chrome = widgetCanvasByType?.[widget.type] || null
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

  const header = (
    <WidgetHeader
      label={TYPE_LABEL[widget.type] || widget.type}
      color={widget.color}
      onColorChange={onColorChange}
      onRemove={onRemove}
      atBottom={headerAtBottom}
    />
  )
  const body = (
    <div className={styles.widgetBody}>
      <WidgetBody widget={widget} onOptsChange={onOptsChange} />
    </div>
  )
  // Merged view: no border, no header bar — the widgets blend into one seamless board.
  // Otherwise, when another widget sits directly above this one, drop the drag/close bar
  // to the BOTTOM so the two widgets blend together at the seam (no header in the middle).
  return (
    <div
      className={`${styles.widget}${merged ? ' ' + styles.widgetMerged : ''}`}
      style={chromeStyle}
    >
      {merged
        ? body
        : (headerAtBottom ? <>{body}{header}</> : <>{header}{body}</>)}
    </div>
  )
}

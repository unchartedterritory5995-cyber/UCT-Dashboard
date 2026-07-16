import ChartWidget from './widgets/ChartWidget'
import WatchlistWidget from './widgets/WatchlistWidget'
import ThemesWidget from './widgets/ThemesWidget'
import ScannerWidget from './widgets/ScannerWidget'
import FundamentalsWidget from './widgets/FundamentalsWidget'
import AiSearchWidget from './widgets/AiSearchWidget'
import WidgetHeader from './WidgetHeader'
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
    case 'watchlist': return <WatchlistWidget color={widget.color} opts={widget.opts} />
    case 'themes':    return <ThemesWidget    color={widget.color} opts={widget.opts} />
    case 'scanner':   return <ScannerWidget   color={widget.color} opts={widget.opts} />
    case 'fundamentals': return <FundamentalsWidget color={widget.color} opts={widget.opts} onOptsChange={onOptsChange} />
    case 'aisearch':  return <AiSearchWidget color={widget.color} />
    default:          return <div className={styles.unknownWidget}>Unknown widget type: {widget.type}</div>
  }
}

export default function WidgetHost({ widget, onRemove, onColorChange, onOptsChange }) {
  return (
    <div className={styles.widget}>
      <WidgetHeader
        label={TYPE_LABEL[widget.type] || widget.type}
        color={widget.color}
        onColorChange={onColorChange}
        onRemove={onRemove}
      />
      <div className={styles.widgetBody}>
        <WidgetBody widget={widget} onOptsChange={onOptsChange} />
      </div>
    </div>
  )
}

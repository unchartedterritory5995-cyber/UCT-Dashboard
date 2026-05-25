import ChartWidget from './widgets/ChartWidget'
import WatchlistWidget from './widgets/WatchlistWidget'
import ThemesWidget from './widgets/ThemesWidget'
import ScannerWidget from './widgets/ScannerWidget'
import WidgetHeader from './WidgetHeader'
import styles from './ChartsWorkspace.module.css'

const TYPE_LABEL = {
  chart: 'Chart',
  watchlist: 'Watchlist',
  themes: 'Themes',
  scanner: 'Scanner',
}

function WidgetBody({ widget }) {
  switch (widget.type) {
    case 'chart':     return <ChartWidget     color={widget.color} opts={widget.opts} />
    case 'watchlist': return <WatchlistWidget color={widget.color} opts={widget.opts} />
    case 'themes':    return <ThemesWidget    color={widget.color} opts={widget.opts} />
    case 'scanner':   return <ScannerWidget   color={widget.color} opts={widget.opts} />
    default:          return <div className={styles.unknownWidget}>Unknown widget type: {widget.type}</div>
  }
}

export default function WidgetHost({ widget, onRemove, onColorChange }) {
  return (
    <div className={styles.widget}>
      <WidgetHeader
        label={TYPE_LABEL[widget.type] || widget.type}
        color={widget.color}
        onColorChange={onColorChange}
        onRemove={onRemove}
      />
      <div className={styles.widgetBody}>
        <WidgetBody widget={widget} />
      </div>
    </div>
  )
}

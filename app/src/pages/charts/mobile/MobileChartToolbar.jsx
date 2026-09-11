import UIcon from '../../../components/ui/UIcon'
import styles from './MobileCharts.module.css'

/* The thumb-zone control strip under the phone chart. Four doors: chart type,
 * indicators, the watchlist (the scan → tap → chart loop TradingView/Deepvue
 * live on — the watchlist page shares the chart's color group, so tapping a
 * row retargets the chart), and the More sheet (alert / flag / settings /
 * other widgets). 44px+ targets throughout.
 *
 * ⚰️ The timeframe pill led this row until 2026-09-11. It now sits at the
 * top-right of the symbol strip (`MobileSymbolStrip`) — the owner wants this
 * bottom row free for shortcut tools. Don't reintroduce a second timeframe
 * door here.
 */
export default function MobileChartToolbar({ onOpenType, onOpenIndicators, onOpenWatchlist, onOpenMore, indicatorCount = 0 }) {
  return (
    <div className={styles.toolbar} role="toolbar" aria-label="Chart controls" data-testid="mobile-chart-toolbar">
      <button type="button" className={styles.tbBtn} onClick={onOpenType} aria-label="Chart type" aria-haspopup="dialog">
        <UIcon name="chart" size={19} gold={false} />
      </button>
      <button
        type="button"
        className={styles.tbBtn}
        onClick={onOpenIndicators}
        aria-label="Indicators"
        aria-haspopup="dialog"
      >
        {/* Count badge is visual-only: the accessible name stays the stable
            "Indicators" (builderDoor.wire.test queries it by exact name, and
            AT users shouldn't hear a label mutate under them). */}
        <span className={styles.tbIconWrap}>
          <UIcon name="wave" size={19} gold={false} />
          {indicatorCount > 0 && <span className={styles.tbBadge} aria-hidden="true">{indicatorCount}</span>}
        </span>
      </button>
      <button type="button" className={styles.tbBtn} onClick={onOpenWatchlist} aria-label="Watchlist">
        <UIcon name="star" size={19} gold={false} />
      </button>
      <button type="button" className={styles.tbBtn} onClick={onOpenMore} aria-label="More tools" aria-haspopup="dialog">
        <UIcon name="more" size={19} gold={false} />
      </button>
    </div>
  )
}

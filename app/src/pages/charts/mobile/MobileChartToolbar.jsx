import UIcon from '../../../components/ui/UIcon'
import { tfLabel } from '../../../components/chart/timeframes'
import styles from './MobileCharts.module.css'

/* The thumb-zone control strip under the phone chart. Four doors, every one a
 * bottom sheet: timeframe (the gold pill — the control traders hit most),
 * chart type, indicators, and the More sheet (flag / settings / the layout's
 * other widgets). 44px+ targets throughout; labels under the glyphs so no
 * button needs guessing.
 */
export default function MobileChartToolbar({ tf, onOpenTf, onOpenType, onOpenIndicators, onOpenMore }) {
  return (
    <div className={styles.toolbar} role="toolbar" aria-label="Chart controls" data-testid="mobile-chart-toolbar">
      <button
        type="button"
        className={`${styles.tbBtn} ${styles.tbTf}`}
        onClick={onOpenTf}
        aria-label={`Timeframe — ${tfLabel(tf)}`}
        aria-haspopup="dialog"
      >
        {tfLabel(tf)}
      </button>
      <button type="button" className={styles.tbBtn} onClick={onOpenType} aria-label="Chart type" aria-haspopup="dialog">
        <UIcon name="chart" size={19} gold={false} />
      </button>
      <button type="button" className={styles.tbBtn} onClick={onOpenIndicators} aria-label="Indicators" aria-haspopup="dialog">
        <UIcon name="wave" size={19} gold={false} />
      </button>
      <button type="button" className={styles.tbBtn} onClick={onOpenMore} aria-label="More tools" aria-haspopup="dialog">
        <UIcon name="more" size={19} gold={false} />
      </button>
    </div>
  )
}

import { useEffect, useState } from 'react'
import StockChart from '../../components/StockChart'
import TickerPopup from '../../components/TickerPopup'
import styles from './ScannerPro.module.css'

const PAGE = 24

// Paged grid of mini daily charts for the matched rows. Windowed so we never
// mount hundreds of charts at once. Charts render `frozen` (static exhibit) so
// the mouse wheel scrolls the page instead of zooming 24 tiny charts, and with
// all chrome hidden — a 120px card has no room for toolbars/legends.
export default function ChartsGallery({ rows, livePrices }) {
  const [page, setPage] = useState(0)
  const count = (rows || []).length
  const pages = Math.ceil(count / PAGE)

  // A filter change can shrink the match set below the current page start —
  // snap back to the first page instead of stranding the user on a blank grid.
  useEffect(() => {
    if (page > 0 && page * PAGE >= count) setPage(0)
  }, [count, page])

  const slice = (rows || []).slice(page * PAGE, page * PAGE + PAGE)

  return (
    <div>
      <div className={styles.gallery}>
        {slice.map(r => {
          const lp = livePrices?.[r.ticker]
          const chg = lp?.change_pct ?? r.chg_pct_1d
          return (
            <div key={r.ticker} className={styles.galleryCard}>
              <div className={styles.galleryHead}>
                <TickerPopup sym={r.ticker}>
                  <span className={styles.symCell}>{r.ticker}</span>
                </TickerPopup>
                <span className={chg == null ? '' : chg >= 0 ? styles.heatG : styles.heatR}>
                  {chg == null ? '—' : `${chg >= 0 ? '+' : ''}${chg.toFixed(1)}%`}
                </span>
              </div>
              <div className={styles.galleryChart}>
                <StockChart sym={r.ticker} tf="D" liveUpdates={false} frozen
                  showDrawingTools={false} hideLegend hideCrosshair hideCountdown
                  hideReplay hidePatterns hideCompare hideLastValue hidePriceLine
                  disableHvc />
              </div>
            </div>
          )
        })}
      </div>
      {pages > 1 && (
        <div className={styles.galleryPager}>
          <button type="button" disabled={page === 0} onClick={() => setPage(p => p - 1)}>‹ Prev</button>
          <span>{page + 1} / {pages}</span>
          <button type="button" disabled={page >= pages - 1} onClick={() => setPage(p => p + 1)}>Next ›</button>
        </div>
      )}
    </div>
  )
}

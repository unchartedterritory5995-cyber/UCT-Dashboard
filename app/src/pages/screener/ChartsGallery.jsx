import { useState } from 'react'
import StockChart from '../../components/StockChart'
import styles from './ScannerPro.module.css'

const PAGE = 24

// Paged grid of mini daily charts for the matched rows. Windowed so we never
// mount hundreds of charts at once.
export default function ChartsGallery({ rows, livePrices }) {
  const [page, setPage] = useState(0)
  const slice = (rows || []).slice(page * PAGE, page * PAGE + PAGE)
  const pages = Math.ceil((rows || []).length / PAGE)

  return (
    <div>
      <div className={styles.gallery}>
        {slice.map(r => {
          const lp = livePrices?.[r.ticker]
          const chg = lp?.change_pct ?? r.chg_pct_1d
          return (
            <div key={r.ticker} className={styles.galleryCard}>
              <div className={styles.galleryHead}>
                <span className={styles.symCell}>{r.ticker}</span>
                <span className={chg >= 0 ? styles.heatG : styles.heatR}>
                  {chg == null ? '—' : `${chg >= 0 ? '+' : ''}${chg.toFixed(1)}%`}
                </span>
              </div>
              <div className={styles.galleryChart}>
                <StockChart sym={r.ticker} tf="D" liveUpdates={false} compact />
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

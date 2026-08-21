import { useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import TickerPopup from '../../../components/TickerPopup'
import TickerActionsMenu, { useTickerActions } from '../../../components/TickerActions'
import { COLUMN_DEFS } from '../columnDefs'
import { REQUIRED_COLS } from './useScreenSpec'
import styles from './ScannerShell.module.css'

// The phone door: a virtualized card list. Line 1 = live dot + ticker + company
// + price/chg (live-overlaid). Line 2 = the first THREE visible non-required
// columns as label/value stats — picker-driven by construction, since
// `columns` is exactly what ColumnPicker handed the shell.
export default function ResultCards({ rows, columns, livePrices,
  hasMore, onLoadMore, isLoading, virtualOpts }) {
  const ta = useTickerActions()
  const scrollRef = useRef(null)
  const statCols = columns.filter(c => !REQUIRED_COLS.includes(c)).slice(0, 3)
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 64,
    overscan: 8,
    ...(virtualOpts || {}),
  })
  return (
    <div className={styles.cardsScroll} ref={scrollRef}>
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map(vi => {
          const row = rows[vi.index]
          const lp = livePrices?.[row.ticker]
          const price = lp?.price ?? row.price
          const chg = lp?.change_pct ?? row.chg_pct_1d
          return (
            <div key={row.ticker} className={styles.card}
              style={{ position: 'absolute', top: vi.start, left: 0, right: 0 }}>
              <div className={styles.cardTop}>
                <span className={lp ? styles.dotLive : styles.dotStatic} />
                <span {...ta.longPressProps(row.ticker)} className={styles.cardSym}>
                  <TickerPopup sym={row.ticker}>{row.ticker}</TickerPopup>
                </span>
                <span className={styles.cardCompany}>{row.company || ''}</span>
                <span className={styles.cardPx}>
                  {price != null ? `$${Number(price).toFixed(2)}` : '—'}
                  <span className={chg == null ? '' : chg >= 0 ? styles.pos : styles.neg}>
                    {chg == null ? '' : ` ${chg >= 0 ? '+' : ''}${Number(chg).toFixed(2)}%`}
                  </span>
                </span>
              </div>
              <div className={styles.cardStats}>
                {statCols.map(c => {
                  const def = COLUMN_DEFS[c] || { label: c, fmt: v => v ?? '—' }
                  return (
                    <span key={c} className={styles.cardStat}>
                      <span className={styles.cardStatLabel}>{def.label}</span>
                      <span className={styles.cardStatVal}>{def.fmt(row[c], row)}</span>
                    </span>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
      {hasMore && (
        <div className={styles.loadMoreRow}>
          <button type="button" className={styles.loadMoreBtn} onClick={onLoadMore} disabled={isLoading}>
            {isLoading ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
      {ta.menu && <TickerActionsMenu menu={ta.menu} onClose={ta.closeMenu} />}
    </div>
  )
}

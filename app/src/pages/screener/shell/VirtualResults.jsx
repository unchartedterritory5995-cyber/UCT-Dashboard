import { useEffect, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import TickerPopup from '../../../components/TickerPopup'
import TickerActionsMenu, { useTickerActions } from '../../../components/TickerActions'
import PatternFeedbackChip from '../../../components/PatternFeedbackChip'
import { COLUMN_DEFS } from '../columnDefs'
import { sortRowsLive } from './liveSort'
import styles from './ScannerShell.module.css'

// The virtualized grid-table door: an ARIA grid on top of @tanstack/react-virtual.
// Rows are positioned by `top`, NEVER `transform` — a transformed ancestor
// breaks position:sticky on the ticker column, so the live-price overlay and
// the load-more append both have to happen without ever touching that.
export const LIVE_WINDOW = 300
const ROW_H = { compact: 30, comfortable: 38 }
const colWidth = key =>
  key === 'ticker' ? '128px'
  : key === 'company' ? 'minmax(150px, 1.4fr)'
  : ['sector', 'industry', 'theme', 'patterns'].includes(key) ? 'minmax(120px, 1fr)'
  : '92px'

export default function VirtualResults({ rows, columns, sort, onSort, livePrices,
  liveSortOn, density = 'compact', view, hasMore, onLoadMore, isLoading, virtualOpts }) {
  const ta = useTickerActions()
  const scrollRef = useRef(null)
  const displayRows = liveSortOn ? sortRowsLive(rows, sort, livePrices) : rows
  const rowH = ROW_H[density] || ROW_H.compact

  const virtualizer = useVirtualizer({
    count: displayRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowH,
    overscan: 12,
    ...(virtualOpts || {}),
  })
  const items = virtualizer.getVirtualItems()

  // auto-append near the end (the explicit button below remains)
  const last = items[items.length - 1]
  useEffect(() => {
    if (!last) return
    if (hasMore && !isLoading && last.index >= displayRows.length - 20) onLoadMore()
  }, [last?.index, hasMore, isLoading, displayRows.length, onLoadMore])

  const gridCols = columns.map(colWidth).join(' ')
  const toggleSort = key => onSort(s => s && s.key === key
    ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' }
    : { key, dir: 'desc' })
  const ariaSort = key => sort?.key === key
    ? (sort.dir === 'desc' ? 'descending' : 'ascending') : 'none'

  const cellValue = (row, key) => {
    const lp = livePrices?.[row.ticker]
    if (key === 'price' && lp?.price != null) return lp.price
    if (key === 'chg_pct_1d' && lp?.change_pct != null) return lp.change_pct
    return row[key]
  }

  return (
    <div className={styles.gridScroll} ref={scrollRef} data-density={density}>
      <div role="table" aria-label="Scan results" aria-rowcount={displayRows.length}
        className={styles.grid} style={{ '--grid-cols': gridCols }}>
        <div role="row" className={`${styles.gridRow} ${styles.gridHead}`}>
          {columns.map(c => (
            <div role="columnheader" aria-sort={ariaSort(c)} key={c}
              className={`${styles.hcell} ${c === 'ticker' ? styles.stickyCol : ''}`}>
              <button type="button" className={styles.hbtn} onClick={() => toggleSort(c)}>
                {COLUMN_DEFS[c]?.label || c}
                {sort?.key === c && <span aria-hidden="true">{sort.dir === 'desc' ? ' ↓' : ' ↑'}</span>}
              </button>
            </div>
          ))}
        </div>
        <div className={styles.gridBody} style={{ height: virtualizer.getTotalSize() }}>
          {items.map(vi => {
            const row = displayRows[vi.index]
            const live = !!livePrices?.[row.ticker]
            return (
              <div role="row" key={row.ticker} className={styles.gridRow}
                style={{ position: 'absolute', top: vi.start, left: 0, right: 0, height: vi.size }}>
                {columns.map(c => {
                  if (c === 'ticker') {
                    return (
                      <div role="cell" key={c} className={`${styles.cell} ${styles.symCell} ${styles.stickyCol}`}>
                        <span className={live ? styles.dotLive : styles.dotStatic}
                          title={live ? 'live price' : 'beyond the live window — snapshot values'} />
                        <span {...ta.longPressProps(row.ticker)}>
                          <TickerPopup sym={row.ticker}>{row.ticker}</TickerPopup>
                        </span>
                        {/* Admin curation chip: hover-revealed on pointer
                            devices so a scanned grid stays clean; always
                            visible where hover doesn't exist (touch). */}
                        <span className={styles.rowFb}>
                          <PatternFeedbackChip ticker={row.ticker}
                            setup={`scan:${view || 'screener'}`} source="scanner" compact />
                        </span>
                      </div>
                    )
                  }
                  const def = COLUMN_DEFS[c] || { fmt: v => v ?? '—' }
                  const val = cellValue(row, c)
                  const heat = def.heat ? def.heat(val) : ''
                  const cls = heat === 'g' ? styles.heatG : heat === 'g1' ? styles.heatG1
                    : heat === 'r' ? styles.heatR : ''
                  return (
                    <div role="cell" key={c} className={`${styles.cell} ${styles.numCell} ${cls}`}>
                      {def.fmt(val, row)}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
      {hasMore && (
        <div className={styles.loadMoreRow}>
          <button type="button" className={styles.loadMoreBtn} onClick={onLoadMore} disabled={isLoading}>
            {isLoading ? 'Loading…' : `Load more (${rows.length.toLocaleString()} loaded)`}
          </button>
        </div>
      )}
      {ta.menu && <TickerActionsMenu menu={ta.menu} onClose={ta.closeMenu} />}
    </div>
  )
}

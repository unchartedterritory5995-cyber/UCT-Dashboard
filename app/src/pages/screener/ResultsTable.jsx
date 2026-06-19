import { useState } from 'react'
import TickerPopup from '../../components/TickerPopup'
import TickerActionsMenu, { useTickerActions } from '../../components/TickerActions'
import { COLUMN_DEFS } from './columnDefs'
import { toCsv, downloadCsv, fetchAllRows } from './exportCsv'
import styles from './ScannerPro.module.css'

// Sortable, view-swappable results table. Live prices overlay price/Chg cells
// for display only (filtering remains on the snapshot). Ticker cell wraps the
// existing TickerPopup (click → chart) + TickerActions (right-click). Results
// paginate via Load more; CSV export pulls the FULL match set (not just shown).
export default function ResultsTable({ result, view, setView, views, sort, setSort,
                                       livePrices, spec, hasMore, onLoadMore, isLoading }) {
  const ta = useTickerActions()
  const [exporting, setExporting] = useState(false)
  if (!result) return null
  const cols = result.view_columns || []

  const toggleSort = key =>
    setSort(s => s && s.key === key
      ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' }
      : { key, dir: 'desc' })
  const arrow = key => sort?.key === key ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : ''

  const cellValue = (row, key) => {
    const lp = livePrices?.[row.ticker]
    if (key === 'price' && lp?.price != null) return lp.price
    if (key === 'chg_pct_1d' && lp?.change_pct != null) return lp.change_pct
    return row[key]
  }

  // Export the FULL match set (pages through the scan), not just the loaded rows.
  const exportNow = async () => {
    setExporting(true)
    try {
      const labels = Object.fromEntries(cols.map(c => [c, COLUMN_DEFS[c]?.label || c]))
      const all = await fetchAllRows(spec || {})
      const exportCols = all.view_columns?.length ? all.view_columns : cols
      downloadCsv(`screen_${result.snapshot_date || 'export'}.csv`, toCsv(all.rows, exportCols, labels))
    } catch {
      // fall back to the rows already on screen
      const labels = Object.fromEntries(cols.map(c => [c, COLUMN_DEFS[c]?.label || c]))
      downloadCsv(`screen_${result.snapshot_date || 'export'}.csv`, toCsv(result.rows, cols, labels))
    } finally {
      setExporting(false)
    }
  }

  const shown = result.rows.length
  const total = result.total ?? shown

  return (
    <div className={styles.resultsWrap}>
      <div className={styles.viewBar}>
        {(views || []).map(v => (
          <button key={v.key} type="button"
            className={`${styles.viewTab} ${view === v.key ? styles.viewTabOn : ''}`}
            onClick={() => setView(v.key)}>{v.label}</button>
        ))}
        <span className={styles.resultMeta}>
          {shown.toLocaleString()} of {total.toLocaleString()} · snapshot {result.snapshot_date || '—'}
        </span>
        <button type="button" className={styles.csvBtn} disabled={exporting} onClick={exportNow}>
          {exporting ? 'Exporting…' : 'Export CSV'}
        </button>
      </div>
      <table className={styles.table}>
        <thead>
          <tr>
            {cols.map(c => (
              <th key={c} className={styles.sortable} onClick={() => toggleSort(c)}>
                {(COLUMN_DEFS[c]?.label) || c}{arrow(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map(row => (
            <tr key={row.ticker} className={styles.row}>
              {cols.map(c => {
                const def = COLUMN_DEFS[c] || { fmt: v => v ?? '—' }
                const val = cellValue(row, c)
                const heat = def.heat ? def.heat(val) : ''
                const cls = heat === 'g' ? styles.heatG
                  : heat === 'g1' ? styles.heatG1
                  : heat === 'r' ? styles.heatR : ''
                if (c === 'ticker') {
                  return (
                    <td key={c} className={styles.symCell}>
                      <span {...ta.longPressProps(row.ticker)}>
                        <TickerPopup sym={row.ticker}>{row.ticker}</TickerPopup>
                      </span>
                    </td>
                  )
                }
                return <td key={c} className={cls}>{def.fmt(val, row)}</td>
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {hasMore && (
        <div className={styles.loadMoreRow}>
          <button type="button" className={styles.loadMoreBtn} onClick={onLoadMore} disabled={isLoading}>
            {isLoading ? 'Loading…' : `Load more (${shown.toLocaleString()} of ${total.toLocaleString()})`}
          </button>
        </div>
      )}
      {ta.menu && <TickerActionsMenu menu={ta.menu} onClose={ta.closeMenu} />}
    </div>
  )
}

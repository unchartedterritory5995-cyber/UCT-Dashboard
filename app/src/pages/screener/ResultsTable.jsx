import TickerPopup from '../../components/TickerPopup'
import TickerActionsMenu, { useTickerActions } from '../../components/TickerActions'
import { COLUMN_DEFS } from './columnDefs'
import { toCsv, downloadCsv } from './exportCsv'
import styles from './ScannerPro.module.css'

// Sortable, view-swappable results table. Live prices overlay price/Chg cells
// for display only (filtering remains on the snapshot). Ticker cell wraps the
// existing TickerPopup (click → chart) + TickerActions (right-click).
export default function ResultsTable({ result, view, setView, views, sort, setSort, livePrices }) {
  const ta = useTickerActions()
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

  const exportNow = () => {
    const labels = Object.fromEntries(cols.map(c => [c, COLUMN_DEFS[c]?.label || c]))
    downloadCsv(`screen_${result.snapshot_date || 'export'}.csv`, toCsv(result.rows, cols, labels))
  }

  return (
    <div className={styles.resultsWrap}>
      <div className={styles.viewBar}>
        {(views || []).map(v => (
          <button key={v.key} type="button"
            className={`${styles.viewTab} ${view === v.key ? styles.viewTabOn : ''}`}
            onClick={() => setView(v.key)}>{v.label}</button>
        ))}
        <span className={styles.resultMeta}>
          {result.total} results · snapshot {result.snapshot_date || '—'}
        </span>
        <button type="button" className={styles.csvBtn} onClick={exportNow}>Export CSV</button>
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
      {ta.menu && <TickerActionsMenu menu={ta.menu} onClose={ta.closeMenu} />}
    </div>
  )
}

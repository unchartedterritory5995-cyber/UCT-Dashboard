import { useIsPhone } from '../../hooks/useBreakpoint'
import styles from './ResponsiveTable.module.css'

/* ResponsiveTable — one config, two renderings.
 *
 * Desktop / tablet: a real <table>.
 * Phone (<=640px): either
 *   - mode="card"   → each row becomes a card (primary fields headline,
 *                     secondary fields label/value grid, hideOnPhone dropped)
 *   - mode="scroll" → table in a horizontal-scroll container, optional frozen
 *                     first column (for dense comparison grids).
 *
 * Pick mode per surface (see the decision rule in CLAUDE.md "Responsive"):
 *   card   = rows are entities acted on individually, few fields matter.
 *   scroll = dense comparison grid where per-cell color/heat is the point.
 *
 * columns: [{
 *   key, header,
 *   render?(row, i) -> node   (defaults to row[key])
 *   primary?  boolean         (card headline)
 *   secondary? boolean        (card label/value grid; default true if not primary)
 *   hideOnPhone? boolean      (dropped from card view)
 *   align? 'left'|'right'|'center'
 *   className?                (applied to th/td)
 * }]
 */
export default function ResponsiveTable({
  columns = [],
  rows = [],
  rowKey,
  mode = 'card',
  freezeFirst = false,
  onRowClick,
  cardTitle,
  className = '',
  emptyText = 'No data',
}) {
  const isPhone = useIsPhone()

  const keyOf = (row, i) =>
    rowKey ? rowKey(row, i) : (row.id ?? row.key ?? i)

  const cellValue = (col, row, i) =>
    col.render ? col.render(row, i) : row[col.key]

  // ── Real table (desktop, tablet, or phone scroll mode) ──
  const renderTable = (phoneScroll) => (
    <div
      className={`${styles.tableWrap} ${phoneScroll ? styles.phoneScroll : ''} ${
        phoneScroll && freezeFirst ? styles.freezeFirst : ''
      }`}
    >
      <table className={`${styles.table} ${className}`}>
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={col.className}
                style={{ textAlign: col.align || 'left' }}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={keyOf(row, i)}
              onClick={onRowClick ? () => onRowClick(row, i) : undefined}
              className={onRowClick ? styles.clickable : ''}
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={col.className}
                  style={{ textAlign: col.align || 'left' }}
                >
                  {cellValue(col, row, i)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <div className={styles.empty}>{emptyText}</div>}
    </div>
  )

  if (!isPhone || mode === 'scroll') {
    return renderTable(isPhone && mode === 'scroll')
  }

  // ── Phone card mode ──
  const primaryCols = columns.filter((c) => c.primary)
  const headlineCols = primaryCols.length ? primaryCols : columns.slice(0, 1)
  const detailCols = columns.filter(
    (c) => !c.hideOnPhone && !headlineCols.includes(c) && c.secondary !== false,
  )

  if (rows.length === 0) {
    return <div className={styles.empty}>{emptyText}</div>
  }

  return (
    <div className={`${styles.cards} ${className}`}>
      {rows.map((row, i) => (
        <div
          key={keyOf(row, i)}
          className={`${styles.card} ${onRowClick ? styles.clickable : ''}`}
          onClick={onRowClick ? () => onRowClick(row, i) : undefined}
        >
          <div className={styles.cardHead}>
            {cardTitle
              ? cardTitle(row, i)
              : headlineCols.map((col) => (
                  <span key={col.key} className={styles.cardHeadCell}>
                    {cellValue(col, row, i)}
                  </span>
                ))}
          </div>
          {detailCols.length > 0 && (
            <div className={styles.cardGrid}>
              {detailCols.map((col) => (
                <div key={col.key} className={styles.cardField}>
                  <span className={styles.cardLabel}>{col.header}</span>
                  <span
                    className={styles.cardVal}
                    style={{ textAlign: col.align || 'left' }}
                  >
                    {cellValue(col, row, i)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

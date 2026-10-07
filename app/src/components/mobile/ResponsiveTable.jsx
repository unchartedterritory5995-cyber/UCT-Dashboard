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
  // D-40 (2026-09-22): an optional `(row, i) => {attrName: value}` spread
  // onto the ROW ROOT in BOTH renderings -- generic on purpose, so this
  // shared primitive never hardcodes any one caller's attribute name (e.g.
  // the Notebook hub's `data-note-card-id` contract, R-18). Every
  // pre-existing caller omits it and is unaffected.
  rowDataAttrs,
  // F4 / A2R-02: an optional `(row, i) => string` naming what activating a
  // row DOES ("Open NVDA thesis"). Only read when `onRowClick` is set.
  rowLabel,
  // The table's accessible name (WCAG 1.3.1): what the grid lists ("Notes"). Rendered as
  // `aria-label` on the table element; a caller that omits it keeps an unnamed table.
  label,
}) {
  const isPhone = useIsPhone()

  const keyOf = (row, i) =>
    rowKey ? rowKey(row, i) : (row.id ?? row.key ?? i)

  const cellValue = (col, row, i) =>
    col.render ? col.render(row, i) : row[col.key]

  const dataAttrsOf = (row, i) => (rowDataAttrs ? rowDataAttrs(row, i) : undefined)

  // ⛔⛔ F4 / A2R-02 (WCAG 2.1.1): A ROW THAT OPENS ON CLICK OPENS ON THE KEYBOARD TOO.
  // Lane 10E-2's keyboard walk found a Table-view row opened only on a mouse click -- no
  // tabindex, no key handler -- so a keyboard member could not open a note from the table
  // at all. When `onRowClick` is set the row is a Tab stop and Enter or Space activates
  // it, in BOTH renderings. ⛔ Only a key pressed ON THE ROW ITSELF: a checkbox's Space and
  // a button's Enter inside the row belong to that control. ⛔ Without `onRowClick` the row
  // stays exactly what it was -- not focusable, no handler -- so a read-only table grows no
  // dead Tab stops. The <tr> keeps its row role (a row with a name); the phone card, which
  // has no role of its own, takes `group` so it may carry that name.
  const activationProps = (row, i, { card = false } = {}) => {
    if (!onRowClick) return {}
    const label = rowLabel ? rowLabel(row, i) : undefined
    return {
      tabIndex: 0,
      onKeyDown: (e) => {
        if (e.target !== e.currentTarget || e.repeat) return
        if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return
        e.preventDefault()
        onRowClick(row, i)
      },
      ...(label ? { 'aria-label': label, ...(card ? { role: 'group' } : {}) } : {}),
    }
  }

  // ── Real table (desktop, tablet, or phone scroll mode) ──
  const renderTable = (phoneScroll) => (
    <div
      className={`${styles.tableWrap} ${phoneScroll ? styles.phoneScroll : ''} ${
        phoneScroll && freezeFirst ? styles.freezeFirst : ''
      }`}
    >
      <table className={`${styles.table} ${className}`} aria-label={label || undefined}>
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={col.className}
                style={{ textAlign: col.align || 'left' }}
                // D-40's sibling, FX2 (wave 10, proof-walk item 2): an optional
                // `aria-sort` on the HEADER CELL — the host-language semantic
                // WAI-ARIA defines for a sortable `<th>`, distinct from any
                // `aria-pressed`/`aria-selected` a control inside it might carry.
                // Generic on purpose (same "an optional field, undefined by every
                // pre-existing caller" shape as `rowDataAttrs`): only a column
                // whose `header` is itself sort-driven passes it.
                {...(col.ariaSort ? { 'aria-sort': col.ariaSort } : {})}
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
              {...activationProps(row, i)}
              {...dataAttrsOf(row, i)}
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
          {...activationProps(row, i, { card: true })}
          {...dataAttrsOf(row, i)}
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

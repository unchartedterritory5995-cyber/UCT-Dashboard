import { tableModelOf, SMALL_SAMPLE } from './builtModel'
import styles from './builtViews.module.css'
import { snapshotStyles as s, toneOf } from '../SnapshotFrame'

/**
 * Built widgets (wave 8, Task 8.13): the Table view, and until Task 8.14 the drawing for every view that has no
 * view of its own yet (bar, line, scatter, heat map, list, compare, progress). It lays out the view's own rows
 * (`tableModelOf`): a table, bar or list its rows, a line its series, a heat map its cells, a scatter its points.
 * Rendered from params alone; it never fetches.
 */
export default function TableView({ params, label = 'Widget rows, as captured' }) {
  const model = tableModelOf(params || {})
  if (!model.rows.length) return <p className={s.empty}>{'No rows to show.'}</p>
  return (
    <div className={s.tableWrap} data-testid="built-table-view">
      <table className={s.table} aria-label={label}>
        <thead>
          <tr>{model.columns.map((c) => <th key={c.key} scope="col">{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {model.rows.map((r) => (
            <tr key={r.key}>
              {r.cells.map((c, i) => (
                <td key={model.columns[i]?.key || i} className={c.hidden ? '' : toneOf(i > 0 ? c.value : null)}>
                  {c.text}
                  {i === 0 && r.flagged && <span className={styles.flagged}>Flagged</span>}
                  {c.small && <span className={styles.badge}>{SMALL_SAMPLE}</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

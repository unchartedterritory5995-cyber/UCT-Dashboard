import { tableModelOf, SMALL_SAMPLE } from './builtModel'
import { useCellGroup, drillFor } from './cellGroup'
import styles from './builtViews.module.css'
import { snapshotStyles as s, toneOf } from '../SnapshotFrame'

/**
 * Built widgets (wave 8, Task 8.13): the Table view. It lays out the view's own rows (`tableModelOf`, which every
 * view reads, so a shared widget's account names are numbered here too). Rendered from params alone; it never
 * fetches. Task 8.14: each row is focusable (one Tab stop, the arrow keys move), and Enter or a click opens the
 * rows behind it (`onDrill`, absent on a shared page).
 */
export default function TableView({ params, onDrill, label = 'Widget rows, as captured' }) {
  const model = tableModelOf(params || {})
  const group = useCellGroup()
  if (!model.rows.length) return <p className={s.empty}>{'No rows to show.'}</p>
  return (
    <div className={s.tableWrap} data-testid="built-table-view">
      <table className={s.table} aria-label={label}>
        <thead>
          <tr>{model.columns.map((c) => <th key={c.key} scope="col">{c.label}</th>)}</tr>
        </thead>
        <tbody {...group.groupProps}>
          {model.rows.map((r, ri) => {
            const what = r.label2 ? `${r.label} · ${r.label2}` : r.label
            const drill = drillFor(onDrill, r, what)
            const mark = group.itemProps(ri, drill, what, { native: true })
            return (
              <tr key={r.key} {...mark} className={drill ? styles.drillRow : undefined}>
                {r.cells.map((c, i) => (
                  <td key={model.columns[i]?.key || i} className={c.hidden ? '' : toneOf(i > 0 ? c.value : null)}>
                    {c.text}
                    {i === 0 && r.flagged && <span className={styles.flagged}>Flagged</span>}
                    {c.small && <span className={styles.badge}>{SMALL_SAMPLE}</span>}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

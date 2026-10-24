import { tableModelOf, SMALL_SAMPLE } from './builtModel'
import styles from './builtViews.module.css'
import { snapshotStyles as s } from '../SnapshotFrame'

/**
 * Built widgets (wave 8, Task 8.13): "Show as table", the data-table alternative for every chart view (spec 5.11).
 * A plain HTML `<table>` of the SAME rows the view draws (`tableModelOf`), with a caption a screen reader reads.
 */
export default function TableAlt({ params }) {
  const model = tableModelOf(params || {})
  const title = typeof params?.title === 'string' && params.title ? params.title : 'Widget'
  return (
    <div className={s.tableWrap} data-testid="built-table-alt">
      <table className={s.table}>
        <caption className={styles.altCaption}>{`${title}, as a table`}</caption>
        <thead>
          <tr>{model.columns.map((c) => <th key={c.key} scope="col">{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {model.rows.length === 0 ? (
            <tr><td colSpan={model.columns.length}>No rows to show.</td></tr>
          ) : model.rows.map((r) => (
            <tr key={r.key}>
              {r.cells.map((c, i) => (
                <td key={model.columns[i]?.key || i}>
                  {c.text}
                  {i === 0 && r.flagged ? ' (Flagged)' : ''}
                  {c.small ? ` (${SMALL_SAMPLE})` : ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

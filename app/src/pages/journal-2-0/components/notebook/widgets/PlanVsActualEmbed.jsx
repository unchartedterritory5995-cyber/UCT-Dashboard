// Wave 10 (Task 10.15): Plan vs actual -- one closed trade against its frozen plan (shelf_compose.my_plan_vs_actual,
// ruling W10-R38). The rows are a table (Entry, Stop, Target, R): the planned and actual figures through the phase 1
// formatters, and each row's own server sentence ("Stop: Planned $96.00. No stop set on the trade.") beside them.
import { rMultiple } from '../../../../../lib/journal-2-0/format'
import { fmtPrice, snapshotStyles as s } from './SnapshotFrame'
import { DedicatedShell, Lines, isNum, strings, dedicatedStyles as d } from './DedicatedParts'

export const KIND = 'myPlanVsActual'
/** A figure the plan or the trade does not have: the words "not set", visible, never a dash or the other column's
 *  figure (review M-5). */
export const NOT_SET = 'not set'

function figure(row, v) {
  if (!isNum(v)) return <span className={s.none}>{NOT_SET}</span>
  return row?.label === 'R' ? rMultiple(v) : fmtPrice(v)
}

export default function PlanVsActualEmbed({ attrs, height = 320, editable = false, onUpdateParams, uid }) {
  const p = attrs?.params || {}
  const rows = Array.isArray(p.rows) ? p.rows.filter((r) => r && typeof r === 'object') : []
  const rowTexts = new Set(rows.map((r) => r.text))
  const rest = strings(p.lines).filter((t) => !rowTexts.has(t))
  return (
    <DedicatedShell kind={KIND} attrs={attrs} height={height} editable={editable} onUpdateParams={onUpdateParams}
      uid={uid} testId="plan-vs-actual-embed">
      {p.available !== false && p.symbol && (
        <p className={d.heading}>
          <span className={s.sym}>{p.symbol}</span>
          {p.side && <span className={s.side}>{p.side}</span>}
        </p>
      )}
      {rows.length > 0 && (
        <div className={s.tableWrap}>
          <table className={s.table} aria-label="Plan against the fills" data-testid="pva-table">
            <thead>
              <tr><th scope="col">Row</th><th scope="col">Planned</th><th scope="col">Actual</th><th scope="col">What happened</th></tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} data-row={r.label}>
                  <th scope="row">{r.label}</th>
                  <td data-col="planned">{figure(r, r.planned)}</td>
                  <td data-col="actual">{figure(r, r.actual)}</td>
                  <td className={d.line}>{r.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Lines lines={rest} testId="pva-lines" />
    </DedicatedShell>
  )
}

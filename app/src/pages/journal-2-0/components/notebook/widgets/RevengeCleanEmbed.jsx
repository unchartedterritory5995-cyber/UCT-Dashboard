// Wave 10 (Task 10.15): Revenge trades -- clean days in the last 30 finished sessions
// (shelf_discipline.my_revenge_clean_days, ruling W10-R12). One cell per session: clean, a revenge re-entry
// (HATCHED), or not checked (a dashed outline). Every cell carries its label as text, so colour never carries it alone.
//
// ⚠️ The payload carries COUNTS per state, not a state per date, so the cells are grouped by state (clean, then
// re-entry days, then not checked) rather than laid out by date; the flagged days and their dates are in the table.
import { fmtDay, snapshotStyles as s } from './SnapshotFrame'
import { DedicatedShell, Lines, isNum, useTableToggle, dedicatedStyles as d } from './DedicatedParts'

export const KIND = 'myRevengeClean'
/** Each cell's text label (and the legend's). */
export const CELL_LABELS = { clean: 'Clean', flagged: 'Revenge re-entry', notChecked: 'Not checked' }
const CELL_CLASS = { clean: d.cellClean, flagged: d.cellFlagged, notChecked: d.cellNotChecked }
const SWATCH_CLASS = { clean: d.swClean, flagged: d.swFlagged, notChecked: d.swNotChecked }

const count = (v) => (isNum(v) && v > 0 ? Math.floor(v) : 0)

/** The cells, from the carried counts only: clean, the checked days that were not clean, the days not checked. */
export function revengeCells(p) {
  const window = count(p?.window)
  if (!window || !isNum(p?.clean) || !isNum(p?.checked)) return []
  const clean = count(p.clean)
  const flagged = Math.max(0, count(p.checked) - clean)
  const notChecked = count(p.notChecked) + count(p.notRead) + count(p.tooMany) + count(p.olderNotRead)
  const cells = [
    ...Array(clean).fill('clean'), ...Array(flagged).fill('flagged'), ...Array(notChecked).fill('notChecked'),
  ]
  return cells.slice(0, window)
}

/** The carried counts as table rows; a count of none is left out (never a 0 on screen). */
const COUNT_ROWS = [
  ['clean', 'Clean days'],
  ['checked', 'Days checked'],
  ['notChecked', 'Days with dates only (not checked)'],
  ['notRead', 'Days not read (older than the newest trades)'],
  ['tooMany', 'Days with too many trades in one symbol to check'],
  ['olderNotRead', 'Days whose older trades could not all be read'],
]

function RevengeTable({ p }) {
  const flagged = Array.isArray(p.flagged) ? p.flagged : []
  const rows = COUNT_ROWS.filter(([k]) => count(p[k]) > 0)
  return (
    <>
      {rows.length > 0 && (
        <div className={s.tableWrap}>
          <table className={s.table} aria-label="Revenge trades by day, as a table">
            <tbody>
              {rows.map(([k, label]) => (
                <tr key={k}><th scope="row">{label}</th><td>{String(count(p[k]))}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {flagged.length > 0 && (
        <div className={s.tableWrap}>
          <table className={s.table} aria-label="Revenge re-entries">
            <thead><tr><th scope="col">Day</th><th scope="col">Symbol</th><th scope="col">Minutes apart</th></tr></thead>
            <tbody>
              {flagged.map((f, i) => (
                <tr key={i}>
                  <td>{fmtDay(f?.day) || f?.day}</td>
                  <td className={s.sym}>{f?.symbol}</td>
                  <td>{isNum(f?.minutesApart) ? `${f.minutesApart} min` : <span className={s.none}>no data</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {count(p.truncated) > 0 && <p className={`${d.line} ${d.quiet}`}>{`${count(p.truncated)} more not shown.`}</p>}
    </>
  )
}

export default function RevengeCleanEmbed({ attrs, height = 340, editable = false, onUpdateParams, uid }) {
  const p = attrs?.params || {}
  const [asTable, toggle] = useTableToggle()
  const cells = revengeCells(p)
  const present = Object.keys(CELL_LABELS).filter((k) => cells.includes(k))
  return (
    <DedicatedShell kind={KIND} attrs={attrs} height={height} editable={editable} onUpdateParams={onUpdateParams}
      uid={uid} testId="revenge-clean-embed">
      <Lines lines={p.lines} testId="revenge-lines" />
      {cells.length > 0 && (asTable ? <RevengeTable p={p} /> : (
        <div className={d.section}>
          <ul className={d.cells} aria-label="The last 30 trading days" data-testid="revenge-cells">
            {cells.map((k, i) => (
              <li key={i} className={`${d.cell} ${CELL_CLASS[k]}`} title={CELL_LABELS[k]} data-cell={k}>
                <span className={d.srOnly}>{CELL_LABELS[k]}</span>
              </li>
            ))}
          </ul>
          <ul className={d.legend}>
            {present.map((k) => (
              <li key={k} className={d.legendItem}><span className={`${d.swatch} ${SWATCH_CLASS[k]}`} />{CELL_LABELS[k]}</li>
            ))}
          </ul>
        </div>
      ))}
      {cells.length > 0 && toggle}
    </DedicatedShell>
  )
}

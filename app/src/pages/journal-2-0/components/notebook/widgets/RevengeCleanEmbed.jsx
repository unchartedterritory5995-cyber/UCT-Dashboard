// Wave 10 (Task 10.15): Revenge trades -- the last 30 finished sessions (shelf_discipline.my_revenge_clean_days,
// ruling W10-R54). A DATED strip drawn from the payload's own `days` list, oldest first: clean, a revenge re-entry
// (HATCHED), no trades (a dotted outline) or not checked (a dashed outline). Every cell carries its day and its state as
// text, so colour never carries it alone.
//
// ⛔ The strip is drawn from `days` ONLY. It is never rebuilt from the counts: a `days` list that is missing, the wrong
// length or holds a state this file does not know draws no strip at all (the server's sentences still render).
import { formatDuration } from '../../../../../components/chart/drawingMeasure'
import { fmtDay, snapshotStyles as s } from './SnapshotFrame'
import { DedicatedShell, Lines, NoData, isNum, useTableToggle, dedicatedStyles as d } from './DedicatedParts'

export const KIND = 'myRevengeClean'
/** Each state's text label (the cell's, the legend's and the table's), in the server's closed vocabulary. */
export const DAY_LABELS = {
  clean: 'Clean',
  flagged: 'Revenge re-entry',
  no_trades: 'No trades',
  not_checked: 'Not checked',
}
const CELL_CLASS = { clean: d.cellClean, flagged: d.cellFlagged, no_trades: d.cellNoTrades, not_checked: d.cellNotChecked }
const SWATCH_CLASS = { clean: d.swClean, flagged: d.swFlagged, no_trades: d.swNoTrades, not_checked: d.swNotChecked }

/** The payload's `days`, when it is exactly the window long and every entry is a dated, known state; else null. */
export function revengeDays(p) {
  const days = p?.days
  if (!Array.isArray(days) || !isNum(p?.window) || days.length !== p.window || days.length === 0) return null
  const ok = days.every((x) => x && typeof x.day === 'string' && x.day && Object.hasOwn(DAY_LABELS, x.state))
  return ok ? days : null
}

const dayText = (day) => fmtDay(day) || day
const cellLabel = (x) => `${dayText(x.day)}: ${DAY_LABELS[x.state]}`

/** Minutes between a loss and the re-entry, through the shared duration formatter ("20m", "<1m"). */
function minutesCell(v) {
  return isNum(v) && v >= 0 ? formatDuration(v * 60) : <NoData />
}

function RevengeTable({ p, days }) {
  const flagged = Array.isArray(p.flagged) ? p.flagged : []
  return (
    <>
      <div className={s.tableWrap}>
        <table className={s.table} aria-label="Revenge trades by day, as a table">
          <thead><tr><th scope="col">Day</th><th scope="col">What happened</th></tr></thead>
          <tbody>
            {days.map((x) => (
              <tr key={x.day}><th scope="row">{dayText(x.day)}</th><td>{DAY_LABELS[x.state]}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      {flagged.length > 0 && (
        <div className={s.tableWrap}>
          <table className={s.table} aria-label="Revenge re-entries">
            <thead><tr><th scope="col">Day</th><th scope="col">Symbol</th><th scope="col">Minutes apart</th></tr></thead>
            <tbody>
              {flagged.map((f, i) => (
                <tr key={i}>
                  <td>{dayText(f?.day)}</td>
                  <td className={s.sym}>{f?.symbol}</td>
                  <td>{minutesCell(f?.minutesApart)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

export default function RevengeCleanEmbed({ attrs, height = 340, editable = false, onUpdateParams, uid }) {
  const p = attrs?.params || {}
  const [asTable, toggle] = useTableToggle()
  const days = revengeDays(p)
  const present = days ? Object.keys(DAY_LABELS).filter((k) => days.some((x) => x.state === k)) : []
  return (
    <DedicatedShell kind={KIND} attrs={attrs} height={height} editable={editable} onUpdateParams={onUpdateParams}
      uid={uid} testId="revenge-clean-embed">
      <Lines lines={p.lines} testId="revenge-lines" />
      {days && (asTable ? <RevengeTable p={p} days={days} /> : (
        <div className={d.section}>
          <ul className={d.cells} aria-label={`The last ${days.length} trading days, oldest first`}
            data-testid="revenge-cells">
            {days.map((x) => (
              <li key={x.day} className={`${d.cell} ${CELL_CLASS[x.state]}`} data-cell={x.state}>
                <span className={d.srOnly}>{cellLabel(x)}</span>
              </li>
            ))}
          </ul>
          <p className={d.stripEnds} data-testid="revenge-ends">
            <span>{dayText(days[0].day)}</span>
            <span>{dayText(days[days.length - 1].day)}</span>
          </p>
          <ul className={d.legend}>
            {present.map((k) => (
              <li key={k} className={d.legendItem}><span className={`${d.swatch} ${SWATCH_CLASS[k]}`} />{DAY_LABELS[k]}</li>
            ))}
          </ul>
        </div>
      ))}
      {days && toggle}
    </DedicatedShell>
  )
}

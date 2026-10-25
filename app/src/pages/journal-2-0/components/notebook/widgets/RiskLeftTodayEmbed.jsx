// Wave 10 (Task 10.15): Risk left today -- per account, the room under its daily loss limit and the open risk to its
// stops (shelf_discipline.my_risk_left_today, rulings W10-R9, W10-R32, W10-R34). One 44 px bar per account with a
// limit (used against left, HATCHED past the limit), every block's sentences verbatim, and "Show as table".
import { snapshotStyles as s } from './SnapshotFrame'
import { DedicatedShell, LimitBar, Lines, isNum, moneyCell, useTableToggle, dedicatedStyles as d } from './DedicatedParts'

export const KIND = 'myRiskLeftToday'
export const DAILY_LIMIT_LABEL = 'Daily loss limit'

const blocksOf = (p) => (Array.isArray(p?.accounts) ? p.accounts.filter((b) => b && typeof b === 'object') : [])

function RiskTable({ blocks }) {
  return (
    <div className={s.tableWrap}>
      <table className={s.table} aria-label="Risk left today, as a table">
        <thead>
          <tr><th scope="col">Account</th><th scope="col">Daily limit</th><th scope="col">Used today</th>
            <th scope="col">Left</th><th scope="col">Open risk</th><th scope="col">If every stop is hit</th></tr>
        </thead>
        <tbody>
          {blocks.map((b, i) => (
            <tr key={b.accountId || `unlinked-${i}`}>
              <th scope="row">{b.name}</th>
              <td>{moneyCell(b.limit)}</td>
              <td>{moneyCell(b.used)}</td>
              <td>{moneyCell(b.left, { signed: true })}</td>
              <td>{moneyCell(b.openRisk)}</td>
              <td>{moneyCell(b.afterStops, { signed: true })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function RiskLeftTodayEmbed({ attrs, height = 360, editable = false, onUpdateParams, uid }) {
  const p = attrs?.params || {}
  const [asTable, toggle] = useTableToggle()
  const blocks = blocksOf(p)
  const charted = blocks.some((b) => isNum(b.limit))
  return (
    <DedicatedShell kind={KIND} attrs={attrs} height={height} editable={editable} onUpdateParams={onUpdateParams}
      uid={uid} testId="risk-left-today-embed">
      {asTable && charted ? <RiskTable blocks={blocks} /> : blocks.map((b, i) => (
        <section key={b.accountId || `unlinked-${i}`} className={d.section} data-testid="risk-block">
          {b.name && <h3 className={d.heading}>{b.name}</h3>}
          {isNum(b.limit) && (
            <LimitBar label={DAILY_LIMIT_LABEL} limit={b.limit} used={b.used} left={b.left} testId="risk-bar" />
          )}
          <Lines lines={b.lines} />
        </section>
      ))}
      {asTable && charted && blocks.map((b, i) => <Lines key={b.accountId || `u-${i}`} lines={b.lines} />)}
      <Lines lines={p.lines} testId="risk-lines" />
      {charted && toggle}
    </DedicatedShell>
  )
}

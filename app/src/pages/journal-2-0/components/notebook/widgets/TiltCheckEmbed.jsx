// Wave 10 (Task 10.15): Tilt check -- trades entered soon after a losing exit against every other trade
// (shelf_discipline.my_tilt_check). Two 44 px bars, one per group, each the group's win rate with the server's own
// summary ("5 trades, 40% win rate, −$20 average") as its value label, and "Show as table".
import { fmtRatioPct, snapshotStyles as s } from './SnapshotFrame'
import {
  BAR_W, BAR_H, DedicatedShell, Lines, NoData, SmallBadge, isNum, moneyCell, useTableToggle, dedicatedStyles as d,
} from './DedicatedParts'

export const KIND = 'myTiltCheck'
/** The two groups, in the order the server reports them. Labels only: every figure is the payload's. */
export const TILT_GROUPS = [['after', 'After a loss'], ['other', 'Other trades']]
const ABOUT_EVEN = 'about even'

const groupOf = (p, key) => (p && typeof p[key] === 'object' && p[key]) || null

function RateBar({ label, group }) {
  const rate = isNum(group?.winRate) ? Math.min(1, Math.max(0, group.winRate)) : null
  return (
    <div className={d.barRow} data-testid={`tilt-bar-${label}`}>
      <span className={d.barLabel}>
        {label}: {group?.text}
        {group?.sample === 'small' && <SmallBadge />}
      </span>
      {rate !== null && (
        <svg data-bar="" className={d.bar} viewBox={`0 0 ${BAR_W} ${BAR_H}`} preserveAspectRatio="none" height={BAR_H}
          aria-hidden="true" focusable="false">
          <rect className={d.track} x="0" y="0" width={BAR_W} height={BAR_H} />
          {rate > 0 && <rect className={d.rate} data-bar-rate="" x="0" y="0" width={rate * BAR_W} height={BAR_H} />}
        </svg>
      )}
    </div>
  )
}

function rateCell(v) {
  if (!isNum(v)) return <NoData />
  return v === 0 ? <span className={s.none}>no wins</span> : fmtRatioPct(v)
}

function TiltTable({ p }) {
  return (
    <div className={s.tableWrap}>
      <table className={s.table} aria-label="Tilt check, as a table">
        <thead>
          <tr><th scope="col">Group</th><th scope="col">Trades</th><th scope="col">Win rate</th>
            <th scope="col">Average</th><th scope="col">Net</th></tr>
        </thead>
        <tbody>
          {TILT_GROUPS.map(([key, label]) => {
            const g = groupOf(p, key)
            return (
              <tr key={key}>
                <th scope="row">{label}</th>
                <td>{isNum(g?.n) && g.n > 0 ? String(g.n) : <span className={s.none}>none</span>}</td>
                <td>{rateCell(g?.winRate)}</td>
                <td>{moneyCell(g?.avg, { signed: true, zero: ABOUT_EVEN })}</td>
                <td>{moneyCell(g?.net, { signed: true, zero: ABOUT_EVEN })}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** ⛔ No group with a win rate (a new member, dates-only trades, too few trades): no chart, the sentences say why. */
export default function TiltCheckEmbed({ attrs, height = 340, editable = false, onUpdateParams, uid }) {
  const p = attrs?.params || {}
  const [asTable, toggle] = useTableToggle()
  const charted = TILT_GROUPS.some(([key]) => isNum(groupOf(p, key)?.winRate))
  return (
    <DedicatedShell kind={KIND} attrs={attrs} height={height} editable={editable} onUpdateParams={onUpdateParams}
      uid={uid} testId="tilt-check-embed">
      <Lines lines={p.lines} testId="tilt-lines" />
      {charted && (asTable ? <TiltTable p={p} /> : (
        <div className={d.section} data-testid="tilt-chart">
          {TILT_GROUPS.map(([key, label]) => <RateBar key={key} label={label} group={groupOf(p, key)} />)}
        </div>
      ))}
      {charted && toggle}
    </DedicatedShell>
  )
}

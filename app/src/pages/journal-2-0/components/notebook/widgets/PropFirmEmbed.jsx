// Wave 10 (Task 10.15): Prop-firm rules -- a daily loss limit and a trailing max drawdown the member types, with the
// room left under each (shelf_discipline.my_prop_firm, ruling W10-R9). One 44 px bar per limit set (used against
// left, HATCHED past the limit), the server's sentences, notices and footnotes verbatim, and "Show as table".
import { snapshotStyles as s } from './SnapshotFrame'
import { DedicatedShell, LimitBar, Lines, isNum, moneyCell, useTableToggle } from './DedicatedParts'

export const KIND = 'myPropFirm'
/** [label, payload key, the key holding what has been used] for each limit. */
export const PROP_LIMITS = [['Daily loss limit', 'daily', 'used'], ['Max drawdown', 'trailing', 'drawdown']]

const limitOf = (p, key) => (p && typeof p[key] === 'object' && p[key] && isNum(p[key].limit) ? p[key] : null)

function PropTable({ p }) {
  return (
    <div className={s.tableWrap}>
      <table className={s.table} aria-label="Prop-firm rules, as a table">
        <thead><tr><th scope="col">Rule</th><th scope="col">Limit</th><th scope="col">Used</th><th scope="col">Left</th></tr></thead>
        <tbody>
          {PROP_LIMITS.map(([label, key, usedKey]) => {
            const l = limitOf(p, key)
            if (!l) return null
            return (
              <tr key={key}>
                <th scope="row">{label}</th>
                <td>{moneyCell(l.limit)}</td>
                <td>{moneyCell(l[usedKey])}</td>
                <td>{moneyCell(l.left, { signed: true })}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default function PropFirmEmbed({ attrs, height = 340, editable = false, onUpdateParams, uid }) {
  const p = attrs?.params || {}
  const [asTable, toggle] = useTableToggle()
  const charted = PROP_LIMITS.some(([, key]) => limitOf(p, key))
  return (
    <DedicatedShell kind={KIND} attrs={attrs} height={height} editable={editable} onUpdateParams={onUpdateParams}
      uid={uid} testId="prop-firm-embed">
      <Lines lines={p.notices} testId="prop-notices" />
      <Lines lines={p.lines} testId="prop-lines" />
      {charted && (asTable ? <PropTable p={p} /> : PROP_LIMITS.map(([label, key, usedKey]) => {
        const l = limitOf(p, key)
        return l ? (
          <LimitBar key={key} label={label} limit={l.limit} used={l[usedKey]} left={l.left} testId={`prop-bar-${key}`} />
        ) : null
      }))}
      {charted && toggle}
      <Lines lines={p.notes} testId="prop-notes" />
    </DedicatedShell>
  )
}

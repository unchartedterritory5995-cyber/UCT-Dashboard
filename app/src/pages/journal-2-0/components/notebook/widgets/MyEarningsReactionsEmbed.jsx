import { embedAutoCaption } from '../../../lib/widgetEmbedCore'
import { formatCompact } from '../../../../../lib/presentation/presentationPrimitives'
import { fmtShortDay } from '../../../lib/earningsPrepShared'
import SnapshotFrame, { useSnapshotFrame, numCell, NA, toneOf, fmtChangePct, snapshotStyles as s } from './SnapshotFrame'

const fmtEps = (v) => (v < 0 ? `-$${Math.abs(v).toFixed(2)}` : `$${v.toFixed(2)}`)
/** TERM-066: revenue's ladder, passed to the ONE K/M/B decision (presentationPrimitives.formatCompact). */
const REVENUE_TIERS = Object.freeze([
  Object.freeze({ at: 1e9, suffix: 'B', decimals: 1 }),
  Object.freeze({ at: 1e6, suffix: 'M', decimals: 1 }),
])
/** Revenue in the units a trader reads it in: $25.1B, $412.3M; under a million, whole dollars with separators. */
export function fmtRevenue(v) {
  if (Math.abs(v) >= 1e6) return formatCompact(v, { tiers: REVENUE_TIERS, prefix: '$' })
  const sign = v < 0 ? '-' : ''
  return `${sign}$${Math.round(Math.abs(v)).toLocaleString('en-US')}`
}

/** "actual vs estimate": each side n/a with its own reason, so an unknown is never 0. */
function versus(actual, est, fmt, what) {
  return (
    <>
      <span>{numCell(actual, fmt, `No reported ${what} found`)}</span>
      <span className={s.side}>vs</span>{' '}
      <span>{numCell(est, fmt, `No ${what} estimate found`)}</span>
    </>
  )
}

/**
 * Notebook widgets: My earnings reactions. Rendered from `attrs.params` only.
 * ⛔ The next-day move is null until that session closes; it shows n/a with that reason, never 0%.
 */
export default function MyEarningsReactionsEmbed({ attrs, height = 280, editable = false, onUpdateParams, uid }) {
  const p = attrs?.params || {}
  const frame = useSnapshotFrame('myEarningsReactions', attrs, { editable, onUpdateParams, uid })
  const rows = Array.isArray(p.rows) ? p.rows : []
  const notes = ['Your names that reported in the last 7 days.',
    p.partial === true ? 'Some figures could not be read in time.' : '',
    Number(p.truncated) > 0 ? `${p.truncated} more not shown.` : ''].filter(Boolean).join(' ')

  return (
    <div style={{ height }} role="figure" aria-label={embedAutoCaption(attrs)} data-testid="my-earnings-reactions-embed">
      <SnapshotFrame {...frame} sourceLine={notes}>
        {rows.length === 0 ? (
          <p className={s.empty}>{(typeof p.empty === 'string' && p.empty) || 'None of your names reported in the last 7 days.'}</p>
        ) : (
          <div className={s.tableWrap}>
            <table className={s.table} aria-label="Earnings reactions on your names, as captured">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Reported</th>
                  <th scope="col">EPS</th>
                  <th scope="col">Revenue</th>
                  <th scope="col">Next-day move</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r?.symbol || 'row'}-${i}`}>
                    <td><span className={s.sym}>{r?.symbol || '?'}</span></td>
                    <td>{r?.day ? fmtShortDay(r.day) : <NA reason="Report day not recorded" />}</td>
                    <td>{versus(r?.epsActual, r?.epsEst, fmtEps, 'EPS')}</td>
                    <td>{versus(r?.revActual, r?.revEst, fmtRevenue, 'revenue')}</td>
                    {r?.timingUnknown === true ? (
                      // F1: no BMO/AMC timing, so no reaction is shown; the server says why, in words.
                      <td><span className={s.none}>{r?.nextDayNote || "Report time unknown, so the reaction isn't shown."}</span></td>
                    ) : (
                      <td className={toneOf(r?.nextDayPct)}>
                        {numCell(r?.nextDayPct, fmtChangePct, 'The session after the report has not closed yet, or its bars are not held')}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SnapshotFrame>
    </div>
  )
}

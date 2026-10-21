import { embedAutoCaption } from '../../../lib/widgetEmbedCore'
import SnapshotFrame, {
  useSnapshotFrame, numCell, toneOf, fmtMoneySigned, fmtDay, accountSourceLine, snapshotStyles as s,
} from './SnapshotFrame'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
  'October', 'November', 'December']

/** 'YYYY-MM' as "October 2026", or null when it is not a month. */
export function monthTitle(month) {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(month || ''))
  return m && MONTHS[Number(m[2]) - 1] ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : null
}

/** Every calendar day of the month, each with its P&L when the payload has one: [{day, n, pnl, traded}]. */
export function monthCells(month, days) {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(month || ''))
  if (!m) return []
  const by = new Map((Array.isArray(days) ? days : []).filter((d) => d && d.day).map((d) => [String(d.day), d.pnl]))
  const count = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate()
  return Array.from({ length: count }, (_, i) => {
    const day = `${m[1]}-${m[2]}-${String(i + 1).padStart(2, '0')}`
    return { day, n: i + 1, pnl: by.get(day), traded: by.has(day) }
  })
}

/** The cell's words: what a screen reader hears, and what the tooltip shows. Never colour alone. */
function cellText(c) {
  if (!c.traded) return `${fmtDay(c.day)}: no closed trades`
  return typeof c.pnl === 'number' && Number.isFinite(c.pnl)
    ? `${fmtDay(c.day)}: ${fmtMoneySigned(c.pnl)}`
    : `${fmtDay(c.day)}: P&L not available`
}
/** A visible mark beside the day number, so the sign reads without colour. */
const mark = (c) => (!c.traded ? '' : !(typeof c.pnl === 'number') ? '?' : c.pnl > 0 ? '+' : c.pnl < 0 ? '−' : '0')

/** Notebook widgets: My P&L calendar. Rendered from `attrs.params` only. */
export default function MyPnlCalendarEmbed({ attrs, height = 280, editable = false, onUpdateParams, uid }) {
  const p = attrs?.params || {}
  const frame = useSnapshotFrame('myPnlCalendar', attrs, { editable, onUpdateParams, uid })
  const title = monthTitle(p.month)
  const cells = monthCells(p.month, p.days)
  const noTrades = typeof p.empty === 'string' && p.empty
  const extreme = (label, d, reason) => (
    <div className={s.row}>
      <dt>{label}</dt>
      <dd>
        <span className={toneOf(d?.pnl)}>{numCell(d?.pnl, fmtMoneySigned, reason)}</span>
        {d?.day ? ` on ${fmtDay(d.day)}` : ''}
      </dd>
    </div>
  )

  return (
    <div style={{ height }} role="figure" aria-label={embedAutoCaption(attrs)} data-testid="my-pnl-calendar-embed">
      <SnapshotFrame {...frame} sourceLine={accountSourceLine(p)}>
        <p className={s.range}>{title || 'Month not recorded'}</p>
        {noTrades ? (
          <p className={s.empty}>{p.empty}</p>
        ) : (
          <>
            <ol className={s.heat} aria-label={`Net P&L by day, ${title || 'this month'}`}>
              {cells.map((c) => (
                <li
                  key={c.day} title={cellText(c)} data-day={c.day}
                  className={`${s.heatCell} ${c.traded ? toneOf(c.pnl) : s.heatIdle}`}
                >
                  <span aria-hidden="true">{c.n}{mark(c)}</span>
                  <span className={s.srOnly}>{cellText(c)}</span>
                </li>
              ))}
            </ol>
            <dl className={s.dl}>
              {extreme('Best day', p.best, 'No best day this month')}
              {extreme('Worst day', p.worst, 'No worst day this month')}
            </dl>
          </>
        )}
      </SnapshotFrame>
    </div>
  )
}

import { embedAutoCaption } from '../../../lib/widgetEmbedCore'
import { rMultiple } from '../../../../../lib/journal-2-0/format'
import SnapshotFrame, {
  useSnapshotFrame, numCell, toneOf, fmtMoneySigned, fmtRatioPct, fmtDay, accountSourceLine, snapshotStyles as s,
} from './SnapshotFrame'

const VIEW_W = 300
const VIEW_H = 54

/** The equity curve as SVG polyline points (an inline line, not the chart engine). Points with
 *  no value are skipped; fewer than two drawable points draw nothing. */
export function equityPoints(equity) {
  const vals = (Array.isArray(equity) ? equity : [])
    .map((pt) => (Array.isArray(pt) ? pt[1] : null))
    .filter((v) => typeof v === 'number' && Number.isFinite(v))
  if (vals.length < 2) return ''
  const lo = Math.min(...vals)
  const hi = Math.max(...vals)
  const span = hi - lo || 1
  const step = VIEW_W / (vals.length - 1)
  return vals
    .map((v, i) => `${(i * step).toFixed(1)},${(VIEW_H - 2 - ((v - lo) / span) * (VIEW_H - 4)).toFixed(1)}`)
    .join(' ')
}

/**
 * Notebook widgets: My P&L and stats. Rendered from `attrs.params` only.
 *
 * ⛔ A range with no closed trades shows the server's `empty` sentence, never a row of $0s.
 */
export default function MyPnlStatsEmbed({ attrs, height = 260, editable = false, onUpdateParams }) {
  const p = attrs?.params || {}
  const frame = useSnapshotFrame('myPnlStats', attrs, { editable, onUpdateParams })
  const from = fmtDay(p.range?.from)
  const to = fmtDay(p.range?.to)
  const points = equityPoints(p.equity)
  const noTrades = typeof p.empty === 'string' && p.empty

  return (
    <div style={{ height }} role="figure" aria-label={embedAutoCaption(attrs)} data-testid="my-pnl-stats-embed">
      <SnapshotFrame {...frame} sourceLine={accountSourceLine(p)}>
        {from && to && <p className={s.range}>{`${from} to ${to}`}</p>}
        {noTrades ? (
          <p className={s.empty}>{p.empty}</p>
        ) : (
          <>
            <div className={s.stats}>
              <div className={s.stat}>
                <div className={s.statLabel}>Net P&amp;L</div>
                <div className={`${s.statValue} ${toneOf(p.netPnl)}`}>{numCell(p.netPnl, fmtMoneySigned, 'No closed P&L in this range')}</div>
              </div>
              <div className={s.stat}>
                <div className={s.statLabel}>Win rate</div>
                <div className={s.statValue}>{numCell(p.winRate, fmtRatioPct, 'No decisive trades in this range')}</div>
              </div>
              <div className={s.stat}>
                <div className={s.statLabel}>Average R</div>
                <div className={`${s.statValue} ${toneOf(p.avgR)}`}>
                  {numCell(p.avgR, rMultiple, 'Fewer than 10 decisive trades, too few for an average R')}
                </div>
              </div>
              <div className={s.stat}>
                <div className={s.statLabel}>Trades</div>
                <div className={s.statValue}>{numCell(p.tradeCount, (v) => String(v), 'Trade count not available')}</div>
              </div>
            </div>
            {points && (
              <svg className={s.spark} viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="none" role="img" aria-label="Equity over the range">
                <polyline className={s.sparkLine} points={points} />
              </svg>
            )}
          </>
        )}
      </SnapshotFrame>
    </div>
  )
}

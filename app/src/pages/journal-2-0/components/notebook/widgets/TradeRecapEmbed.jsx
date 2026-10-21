import { embedAutoCaption } from '../../../lib/widgetEmbedCore'
import { rMultiple } from '../../../../../lib/journal-2-0/format'
import { humanizeMistake } from './MyMistakesEmbed'
import SnapshotFrame, {
  useSnapshotFrame, numCell, toneOf, fmtPrice, fmtMoneySigned, fmtDay, accountSourceLine, snapshotStyles as s,
} from './SnapshotFrame'

const VIEW_W = 300
const VIEW_H = 64

/** One label/value pair. */
function Row({ label, children }) {
  return (
    <div className={s.row}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

/** The daily closes as SVG polyline points plus the x of the entry and exit sessions (an inline line, never
 *  the chart engine). Bars without a close are skipped; fewer than two drawable closes draw nothing. */
export function recapChart(bars, entryDate, exitDate) {
  const pts = (Array.isArray(bars) ? bars : [])
    .filter((b) => b && typeof b.c === 'number' && Number.isFinite(b.c))
  if (pts.length < 2) return null
  const closes = pts.map((b) => b.c)
  const lo = Math.min(...closes)
  const span = Math.max(...closes) - lo || 1
  const step = VIEW_W / (pts.length - 1)
  const x = (i) => Number((i * step).toFixed(1))
  // The first session on or after the day: a recap's bars are thinned, so the exact day may be absent.
  const at = (day) => {
    const i = day ? pts.findIndex((b) => String(b.t) >= day) : -1
    return i < 0 ? null : x(i)
  }
  return {
    points: pts.map((b, i) => `${x(i)},${(VIEW_H - 2 - ((b.c - lo) / span) * (VIEW_H - 4)).toFixed(1)}`).join(' '),
    entryX: at(entryDate),
    exitX: at(exitDate),
    from: pts[0].t,
    to: pts[pts.length - 1].t,
  }
}

/**
 * Notebook widgets: Trade recap. Rendered from `attrs.params` only.
 * ⛔ `tradeId` is the request key See it now re-asks with; it is never drawn (and never leaves on a public page).
 */
export default function TradeRecapEmbed({ attrs, height = 300, editable = false, onUpdateParams }) {
  const p = attrs?.params || {}
  const frame = useSnapshotFrame('tradeRecap', attrs, { editable, onUpdateParams })
  const chart = recapChart(p.bars, p.entryDate, p.exitDate)
  const mistakes = (Array.isArray(p.mistakes) ? p.mistakes : []).map(humanizeMistake)
  const dayOf = (d) => (d ? ` on ${fmtDay(d)}` : '')

  return (
    <div style={{ height }} role="figure" aria-label={embedAutoCaption(attrs)} data-testid="trade-recap-embed">
      <SnapshotFrame {...frame} sourceLine={accountSourceLine(p.source)}>
        <p className={s.range}>
          <span className={s.sym}>{p.symbol || 'Ticker'}</span>
          {p.side && <span className={s.side}>{String(p.side).toLowerCase()}</span>}
        </p>
        <dl className={s.dl}>
          <Row label="Entry">{numCell(p.entryPrice, fmtPrice, 'No entry price recorded')}{dayOf(p.entryDate)}</Row>
          <Row label="Exit">{numCell(p.exitPrice, fmtPrice, 'No exit price recorded')}{dayOf(p.exitDate)}</Row>
          <Row label="R">
            <span className={toneOf(p.r)}>{numCell(p.r, rMultiple, 'No stop and no excursion recorded, so no R')}</span>
          </Row>
          <Row label="P&L">
            <span className={toneOf(p.pnl)}>{numCell(p.pnl, fmtMoneySigned, 'No net P&L recorded for this trade')}</span>
          </Row>
          <Row label="Setup">{p.setup || <span className={s.na} title="No setup tagged on this trade">n/a</span>}</Row>
          <Row label="Hold">
            {numCell(p.holdDays, (v) => `${v} ${v === 1 ? 'day' : 'days'}`, 'Hold time not recorded')}
          </Row>
          <Row label="Mistakes">{mistakes.length ? mistakes.join(', ') : 'None tagged'}</Row>
        </dl>
        {chart ? (
          <svg
            className={s.spark} viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="none" role="img"
            aria-label={`Daily closes from ${fmtDay(chart.from)} to ${fmtDay(chart.to)}, entry${dayOf(p.entryDate)}, exit${dayOf(p.exitDate)}`}
          >
            <polyline className={s.sparkLine} points={chart.points} />
            {chart.entryX != null && <line x1={chart.entryX} x2={chart.entryX} y1="0" y2={VIEW_H} className={s.recapEntry} />}
            {chart.exitX != null && <line x1={chart.exitX} x2={chart.exitX} y1="0" y2={VIEW_H} className={s.recapExit} />}
          </svg>
        ) : (
          <p className={s.empty}>No daily bars held for this trade, so no chart.</p>
        )}
      </SnapshotFrame>
    </div>
  )
}

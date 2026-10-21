import { embedAutoCaption } from '../../../lib/widgetEmbedCore'
import UIcon from '../../../../../components/ui/UIcon'
import { fmtShortDay } from '../../../lib/earningsPrepShared'
import SnapshotFrame, {
  useSnapshotFrame, numCell, earningsCell, toneOf, fmtPrice, fmtChangePct, fmtMoneySigned, fmtRatioPct, snapshotStyles as s,
} from './SnapshotFrame'

const NO_PRICE = 'No price available right now'
const fmtMove = (v) => `±${v.toFixed(1)}%`

/** One label/value pair of the card. */
function Row({ label, children }) {
  return (
    <div className={s.row} data-card-row="">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

/** Notebook widgets: the ticker card. Rendered from `attrs.params` only. */
export default function TickerCardEmbed({ attrs, height = 240, editable = false, onUpdateParams, uid }) {
  const p = attrs?.params || {}
  const frame = useSnapshotFrame('tickerCard', attrs, { editable, onUpdateParams, uid })
  const sym = p.symbol || 'Ticker'
  const h = p.history && typeof p.history === 'object' ? p.history : null

  return (
    <div style={{ height }} role="figure" aria-label={embedAutoCaption(attrs)} data-testid="ticker-card-embed">
      <SnapshotFrame {...frame} title={sym} sourceLine={frame.sourceDetail ? null : 'Market data, and your own trades in this name.'}>
        <dl className={s.dl}>
          <Row label="Last">
            {numCell(p.price, fmtPrice, NO_PRICE)}{' '}
            <span className={toneOf(p.changePct)}>{numCell(p.changePct, fmtChangePct, 'No move available right now')}</span>
          </Row>
          <Row label="10-day / 50-day">
            {numCell(p.ma10, fmtPrice, 'Not enough daily bars for a 10-day average')}
            {' / '}
            {numCell(p.ma50, fmtPrice, 'Not enough daily bars for a 50-day average')}
          </Row>
          <Row label="Earnings">
            {p.earningsDay ? (
              <>
                {fmtShortDay(p.earningsDay)}
                {' · '}
                {numCell(p.impliedMovePct, fmtMove, 'No options-implied move available')}
              </>
            ) : earningsCell(null, p.earningsUnknown)}
          </Row>
          {/* R58 (UX I-9): the member's own trades in this name are theirs alone; the card stays neutral on
              shared pages, so this row is the one that says so. */}
          <Row label={(
            <>
              <span>Your history</span>{' '}
              <span className={s.chip} data-snapshot-lock="">
                <UIcon name="lock" size={12} gold={false} />
                <span>Only you</span>
              </span>
            </>
          )}>
            {h && Number(h.trades) > 0 ? (
              <>
                {`${h.trades} trade${Number(h.trades) === 1 ? '' : 's'} · `}
                {numCell(h.winRate, fmtRatioPct, 'No decisive trades yet')}
                {' wins · '}
                <span className={toneOf(h.netPnl)}>{numCell(h.netPnl, fmtMoneySigned, 'No closed P&L yet')}</span>
              </>
            ) : `No trades in ${sym} yet.`}
          </Row>
        </dl>
      </SnapshotFrame>
    </div>
  )
}

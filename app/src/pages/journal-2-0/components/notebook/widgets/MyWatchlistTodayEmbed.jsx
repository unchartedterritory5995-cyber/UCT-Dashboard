import { embedAutoCaption } from '../../../lib/widgetEmbedCore'
import { useFirstLiveWidget } from '../../../lib/firstLiveWidget'
import EmptyNamesAsk, { NAMES_ASK } from '../EmptyNamesAsk'
import { fmtShortDay } from '../../../lib/earningsPrepShared'
import SnapshotFrame, {
  useSnapshotFrame, numCell, earningsCell, toneOf, fmtPrice, fmtChangePct, snapshotStyles as s,
} from './SnapshotFrame'

/** Notebook widgets: My watchlist today. Rendered from `attrs.params` only. */
export default function MyWatchlistTodayEmbed({ attrs, height = 300, editable = false, onUpdateParams, uid }) {
  const p = attrs?.params || {}
  const frame = useSnapshotFrame('myWatchlistToday', attrs, { editable, onUpdateParams, uid })
  const rows = Array.isArray(p.rows) ? p.rows : []
  const list = p.listLabel ? `From your ${p.listLabel} list.` : ''
  const extra = Number(p.truncated) > 0 ? `${p.truncated} more not shown.` : ''
  const partial = p.partial === true ? 'Some figures could not be read in time.' : ''
  const sourceLine = [list, partial, extra].filter(Boolean).join(' ') || null

  // S20 "First aha": the first time this widget shows the member's own tickers (once per browser).
  useFirstLiveWidget('watchlist', rows.length)

  // S17 (M7): with no names it ASKS -- one sentence, an inline input, three suggestions -- and it reserves no blank
  // space: the fixed height applies only to the table. A read-only copy says what it needs, nothing to press.
  const empty = rows.length === 0
  return (
    <div style={empty ? undefined : { height }} role="figure" aria-label={embedAutoCaption(attrs)} data-testid="my-watchlist-today-embed">
      <SnapshotFrame {...frame} sourceLine={sourceLine}>
        {empty ? (
          frame.editable && frame.onRefresh
            ? <EmptyNamesAsk onAdded={() => frame.onRefresh()} />
            : <p className={s.empty}>{NAMES_ASK}</p>
        ) : (
          <div className={s.tableWrap}>
            <table className={s.table} aria-label="Watchlist names, as captured">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Price</th>
                  <th scope="col">Today</th>
                  <th scope="col">Earnings</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r?.symbol || 'row'}-${i}`}>
                    <td><span className={s.sym}>{r?.symbol || '?'}</span></td>
                    <td>{numCell(r?.price, fmtPrice, 'No price available right now')}</td>
                    <td className={toneOf(r?.changePct)}>{numCell(r?.changePct, fmtChangePct, 'No move available right now')}</td>
                    <td>{earningsCell(r?.earningsDay, p.earningsUnknown, fmtShortDay)}</td>
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

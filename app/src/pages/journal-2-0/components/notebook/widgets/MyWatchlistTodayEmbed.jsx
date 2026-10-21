import { embedAutoCaption } from '../../../lib/widgetEmbedCore'
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

  return (
    <div style={{ height }} role="figure" aria-label={embedAutoCaption(attrs)} data-testid="my-watchlist-today-embed">
      <SnapshotFrame {...frame} sourceLine={sourceLine}>
        {rows.length === 0 ? (
          <p className={s.empty}>No names on this list yet.</p>
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

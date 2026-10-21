import { embedAutoCaption } from '../../../lib/widgetEmbedCore'
import SnapshotFrame, { useSnapshotFrame, numCell, snapshotStyles as s } from './SnapshotFrame'

const count = (v) => String(v)

/**
 * Notebook widgets: Room buzz on my names. Rendered from `attrs.params` only.
 * ⛔ COUNTS ONLY: the store holds no message text and the payload carries none, so a row is a symbol, how many
 * mentions and how many people.
 */
export default function RoomBuzzOnMyNamesEmbed({ attrs, height = 260, editable = false, onUpdateParams, uid }) {
  const p = attrs?.params || {}
  const frame = useSnapshotFrame('roomBuzzOnMyNames', attrs, { editable, onUpdateParams, uid })
  const rows = Array.isArray(p.rows) ? p.rows : []
  const notes = ['Mentions in the room since the session open, your names only.',
    Number(p.truncated) > 0 ? `${p.truncated} more not shown.` : ''].filter(Boolean).join(' ')

  return (
    <div style={{ height }} role="figure" aria-label={embedAutoCaption(attrs)} data-testid="room-buzz-embed">
      <SnapshotFrame {...frame} sourceLine={notes}>
        {rows.length === 0 ? (
          <p className={s.empty}>{(typeof p.empty === 'string' && p.empty) || "The room hasn't mentioned your names today."}</p>
        ) : (
          <div className={s.tableWrap}>
            <table className={s.table} aria-label="Room mentions of your names, as captured">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Mentions</th>
                  <th scope="col">People</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r?.symbol || 'row'}-${i}`}>
                    <td><span className={s.sym}>{r?.symbol || '?'}</span></td>
                    <td>{numCell(r?.mentions, count, 'Mention count not available')}</td>
                    <td>{numCell(r?.people, count, 'People count not available')}</td>
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

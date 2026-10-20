import { embedAutoCaption } from '../../../lib/widgetEmbedCore'
import { fmtShortDay, sourceLabel, timingLabel } from '../../../lib/earningsPrepShared'
import SnapshotFrame, { useSnapshotFrame, numCell, snapshotStyles as s } from './SnapshotFrame'

const fmtMove = (v) => `±${v.toFixed(1)}%`

/** The report day as a date, never "Tomorrow": a snapshot is read long after it was taken. */
function whenText(r) {
  const day = r?.day ? fmtShortDay(r.day) : 'Day unknown'
  const t = timingLabel(r?.timing)
  return t ? `${day}, ${t}` : `${day}, time not announced`
}

/** Notebook widgets: My names reporting. Rendered from `attrs.params` only. */
export default function MyNamesReportingEmbed({ attrs, height = 260, editable = false, onUpdateParams }) {
  const p = attrs?.params || {}
  const frame = useSnapshotFrame('myNamesReporting', attrs, { editable, onUpdateParams })
  const rows = Array.isArray(p.rows) ? p.rows : []
  const notes = [
    'Only names on your watchlists or in your positions.',
    p.partial === true ? 'Some figures could not be read in time.' : '',
    Number(p.truncated) > 0 ? `${p.truncated} more not shown.` : '',
  ].filter(Boolean).join(' ')

  return (
    <div style={{ height }} role="figure" aria-label={embedAutoCaption(attrs)} data-testid="my-names-reporting-embed">
      <SnapshotFrame {...frame} sourceLine={notes}>
        {rows.length === 0 ? (
          <p className={s.empty}>None of your names report in the next seven days.</p>
        ) : (
          <div className={s.tableWrap}>
            <table className={s.table} aria-label="Names reporting earnings, as captured">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">When</th>
                  <th scope="col">Expected move</th>
                  <th scope="col">Why it is listed</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r?.symbol || 'row'}-${i}`}>
                    <td><span className={s.sym}>{r?.symbol || '?'}</span></td>
                    <td>{whenText(r)}</td>
                    <td>{numCell(r?.impliedMovePct, fmtMove, 'No options-implied move available')}</td>
                    <td>{(Array.isArray(r?.sources) ? r.sources : []).map(sourceLabel).join(', ')}</td>
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

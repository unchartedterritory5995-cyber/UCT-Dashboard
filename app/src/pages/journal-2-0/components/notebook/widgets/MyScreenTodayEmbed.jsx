import { embedAutoCaption } from '../../../lib/widgetEmbedCore'
import CoverageLine from '../../../../../components/provenance/CoverageLine'
import SnapshotFrame, {
  useSnapshotFrame, numCell, toneOf, fmtPrice, fmtChangePct, fmtDay, snapshotStyles as s,
} from './SnapshotFrame'

/** The payload's coverage in the receipt shape CoverageLine reads (the Screener's own component, so the four
 *  counts, `withheld` beside them and the "a gap in what we hold, not a quiet market" sentence are its words). */
export function receiptOf(c) {
  if (!c || typeof c !== 'object') return null
  return { evaluated: c.evaluated, answered: c.answered, dropped: c.dropped, not_computable: c.notComputable,
    withheld: c.withheld }
}

/**
 * Notebook widgets: My screen today. Rendered from `attrs.params` only.
 * ⛔ The four counts are never collapsed: zero hits beside a receipt reads as what it is (CoverageLine), never as
 * a quiet market. `definitionId` is the request key See it now re-asks with; it is never drawn.
 */
export default function MyScreenTodayEmbed({ attrs, height = 300, editable = false, onUpdateParams, uid }) {
  const p = attrs?.params || {}
  const frame = useSnapshotFrame('myScreenToday', attrs, { editable, onUpdateParams, uid })
  const hits = Array.isArray(p.hits) ? p.hits : []
  const receipt = receiptOf(p.coverage)
  const notReady = !receipt && typeof p.empty === 'string' && p.empty
  // Nothing answered and something not computable: CoverageLine says it is a gap in our data, so this
  // embed adds no "no hits" line that would read as a quiet market.
  const gap = receipt && Number(receipt.answered) === 0 && Number(receipt.not_computable) > 0
  const notes = [p.session ? `Swept session of ${fmtDay(p.session)}.` : '',
    p.truncated === true ? 'More hits than shown here.' : ''].filter(Boolean).join(' ') || null

  return (
    <div style={{ height }} role="figure" aria-label={embedAutoCaption(attrs)} data-testid="my-screen-today-embed">
      <SnapshotFrame {...frame} sourceLine={notes}>
        <p className={s.range}>{p.name || 'Saved screen'}</p>
        {notReady ? (
          <p className={s.empty}>{p.empty}</p>
        ) : (
          <>
            {hits.length === 0 ? (
              !gap && <p className={s.empty}>No hits in the last swept session.</p>
            ) : (
              <div className={s.tableWrap}>
                <table className={s.table} aria-label="Screen hits, as captured">
                  <thead>
                    <tr>
                      <th scope="col">Name</th>
                      <th scope="col">Price</th>
                      <th scope="col">Move today</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hits.map((h, i) => (
                      <tr key={`${h?.symbol || 'row'}-${i}`}>
                        <td><span className={s.sym}>{h?.symbol || '?'}</span></td>
                        <td>{numCell(h?.price, fmtPrice, 'No price available at capture')}</td>
                        <td className={toneOf(h?.changePct)}>{numCell(h?.changePct, fmtChangePct, 'No move available at capture')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <CoverageLine coverage={receipt} density="embed" />
          </>
        )}
      </SnapshotFrame>
    </div>
  )
}

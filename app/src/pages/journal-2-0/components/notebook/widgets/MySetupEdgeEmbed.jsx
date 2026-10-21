import { embedAutoCaption } from '../../../lib/widgetEmbedCore'
import { rMultiple } from '../../../../../lib/journal-2-0/format'
import SnapshotFrame, {
  useSnapshotFrame, numCell, toneOf, fmtRatioPct, accountSourceLine, snapshotStyles as s,
} from './SnapshotFrame'

const NO_SETUPS = 'No setups with closed trades yet.'

/**
 * Notebook widgets: My setup edge. Rendered from `attrs.params` only.
 * ⛔ A thin sample is LABELLED, never dropped: the server marks it (`thin`, under personal_edge's mute floor) and
 * the row says "Thin sample" in words beside the count.
 */
export default function MySetupEdgeEmbed({ attrs, height = 260, editable = false, onUpdateParams }) {
  const p = attrs?.params || {}
  const frame = useSnapshotFrame('mySetupEdge', attrs, { editable, onUpdateParams })
  const rows = Array.isArray(p.rows) ? p.rows : []
  const extra = Number(p.truncated) > 0 ? `${p.truncated} more not shown.` : ''
  const sourceLine = [accountSourceLine(p.source), extra].filter(Boolean).join(' · ') || null

  return (
    <div style={{ height }} role="figure" aria-label={embedAutoCaption(attrs)} data-testid="my-setup-edge-embed">
      <SnapshotFrame {...frame} sourceLine={sourceLine}>
        {rows.length === 0 ? (
          <p className={s.empty}>{(typeof p.empty === 'string' && p.empty) || NO_SETUPS}</p>
        ) : (
          <div className={s.tableWrap}>
            <table className={s.table} aria-label="Edge by setup, as captured">
              <thead>
                <tr>
                  <th scope="col">Setup</th>
                  <th scope="col">Trades</th>
                  <th scope="col">Expectancy</th>
                  <th scope="col">Win rate</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r?.setup || 'row'}-${i}`}>
                    <td>{r?.setup || 'No setup'}</td>
                    <td>
                      {numCell(r?.n, (v) => String(v), 'Trade count not available')}
                      {r?.thin === true && <span className={s.side}>Thin sample</span>}
                    </td>
                    <td className={toneOf(r?.expectancyR)}>
                      {numCell(r?.expectancyR, rMultiple, 'No R recorded on these trades')}
                    </td>
                    <td>{numCell(r?.winRate, fmtRatioPct, 'No decisive trades in this setup')}</td>
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

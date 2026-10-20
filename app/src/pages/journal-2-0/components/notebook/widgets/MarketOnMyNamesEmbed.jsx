import { embedAutoCaption } from '../../../lib/widgetEmbedCore'
import SnapshotFrame, {
  useSnapshotFrame, numCell, NA, toneOf, fmtChangePct, snapshotStyles as s,
} from './SnapshotFrame'

const BASIS_LINES = { 'your names': 'Sector figure: the average of your names in that sector.' }

/**
 * Notebook widgets: Market on my names (wave 3). Rendered from `attrs.params` only.
 * Each figure is a signed percent, so a lagging name reads as lagging without its colour.
 */
export default function MarketOnMyNamesEmbed({ attrs, height = 300, editable = false, onUpdateParams }) {
  const p = attrs?.params || {}
  const frame = useSnapshotFrame('marketOnMyNames', attrs, { editable, onUpdateParams })
  const rows = Array.isArray(p.rows) ? p.rows : []
  const extra = Number(p.truncated) > 0 ? `${p.truncated} more not shown.` : ''
  const sourceLine = [BASIS_LINES[p.sectorBasis], extra].filter(Boolean).join(' ') || null

  return (
    <div style={{ height }} role="figure" aria-label={embedAutoCaption(attrs)} data-testid="market-on-my-names-embed">
      <SnapshotFrame {...frame} sourceLine={sourceLine}>
        {rows.length === 0 ? (
          <p className={s.empty}>{(typeof p.empty === 'string' && p.empty) || 'No names yet.'}</p>
        ) : (
          <div className={s.tableWrap}>
            <table className={s.table} aria-label="Your names against their sector, as captured">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">5 days</th>
                  <th scope="col">Sector</th>
                  <th scope="col">Sector, 5 days</th>
                  <th scope="col">Vs sector</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r?.symbol || 'row'}-${i}`}>
                    <td><span className={s.sym}>{r?.symbol || '?'}</span></td>
                    <td className={toneOf(r?.ret5d)}>{numCell(r?.ret5d, fmtChangePct, 'Fewer than six daily bars on record')}</td>
                    <td>{r?.sector || <NA reason="Not in the theme taxonomy" />}</td>
                    <td className={toneOf(r?.sectorRet5d)}>
                      {numCell(r?.sectorRet5d, fmtChangePct,
                        r?.sector ? 'Only one of your names is in this sector' : 'No sector for this name')}
                    </td>
                    <td className={toneOf(r?.vsSector)}>
                      {numCell(r?.vsSector, fmtChangePct, "Needs both the name's and the sector's 5-day figure")}
                    </td>
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

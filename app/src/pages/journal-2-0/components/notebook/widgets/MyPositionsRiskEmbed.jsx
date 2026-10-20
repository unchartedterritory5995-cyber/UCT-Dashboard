import { embedAutoCaption } from '../../../lib/widgetEmbedCore'
import SnapshotFrame, {
  useSnapshotFrame, numCell, NA, toneOf, fmtMoneySigned, fmtPrice, fmtPctPlain, accountSourceLine, snapshotStyles as s,
} from './SnapshotFrame'

/** Where a member sets a stop. The Journal reads only the tab (it has no per-position param). */
export const SET_STOP_HREF = '/journal?j2tab=positions'

/**
 * Notebook widgets: My open positions and risk. Rendered from `attrs.params` only.
 *
 * ⛔ `distToStopPct` is the server's distance from ENTRY to stop (portfolio_heat), never from the
 * live price, and the column says so. ⛔ A placeholder stop (`noStop: true`) is "No stop set" with
 * the way to set one; it is never drawn as a 0% distance.
 */
export default function MyPositionsRiskEmbed({ attrs, height = 320, editable = false, onUpdateParams }) {
  const p = attrs?.params || {}
  const frame = useSnapshotFrame('myPositionsRisk', attrs, { editable, onUpdateParams })
  const rows = Array.isArray(p.rows) ? p.rows : []
  const hasAccount = typeof p.accountSize === 'number' && Number.isFinite(p.accountSize)
  const sizeReason = hasAccount ? 'No price available right now' : 'No account size set in Journal'
  const extra = Number(p.truncated) > 0 ? `${p.truncated} more not shown.` : ''
  const sourceLine = [accountSourceLine(p.source), extra].filter(Boolean).join(' · ') || null

  return (
    <div style={{ height }} role="figure" aria-label={embedAutoCaption(attrs)} data-testid="my-positions-risk-embed">
      <SnapshotFrame {...frame} sourceLine={sourceLine}>
        {rows.length === 0 ? (
          <p className={s.empty}>{p.empty || 'No open positions.'}</p>
        ) : (
          <div className={s.tableWrap}>
            <table className={s.table} aria-label="Open positions, as captured">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Size (% of account)</th>
                  <th scope="col">Open P&amp;L</th>
                  <th scope="col">Stop</th>
                  <th scope="col">Stop distance (from entry)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r?.symbol || 'row'}-${i}`}>
                    <td>
                      <span className={s.sym}>{r?.symbol || '?'}</span>
                      {r?.side === 'short' && <span className={s.side}>short</span>}
                    </td>
                    <td>{numCell(r?.sizePct, (v) => fmtPctPlain(v), sizeReason)}</td>
                    <td className={toneOf(r?.openPnl)}>{numCell(r?.openPnl, fmtMoneySigned, 'No price available right now')}</td>
                    {r?.noStop === true ? (
                      <>
                        <td>
                          <span>No stop set</span>
                          <a className={s.link} href={SET_STOP_HREF}>Set it in Journal</a>
                        </td>
                        <td><NA reason="No stop set, so there is no distance to it" /></td>
                      </>
                    ) : r?.noStop === false ? (
                      <>
                        <td>{numCell(r?.stopPrice, fmtPrice, 'Stop price not available')}</td>
                        <td>{numCell(r?.distToStopPct, (v) => fmtPctPlain(v), 'Stop distance not available')}</td>
                      </>
                    ) : (
                      <>
                        <td><NA reason="Stop not known: this position was not in the risk read" /></td>
                        <td><NA reason="Stop not known: this position was not in the risk read" /></td>
                      </>
                    )}
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

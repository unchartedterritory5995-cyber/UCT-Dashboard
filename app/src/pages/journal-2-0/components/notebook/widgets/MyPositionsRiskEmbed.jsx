import { embedAutoCaption } from '../../../lib/widgetEmbedCore'
import SnapshotFrame, {
  useSnapshotFrame, numCell, NA, own, toneOf, fmtMoneySigned, fmtPrice, fmtPctPlain, accountSourceLine, snapshotStyles as s,
} from './SnapshotFrame'

/** How open P&L and size were priced (F1 `priceBasis`), said only when the server sent no `sourceDetail`. */
const PRICE_BASIS = {
  live: 'Open P&L and size: live market prices.',
  broker: 'Open P&L and size: broker marks.',
  mixed: 'Open P&L and size: live prices and broker marks.',
}
/** An option row's stop cells (F1: options carry no stop). */
export const OPTION_STOP = 'Not applicable to options'
/** An option row's P&L and size come from the stored broker value (F1); before a sync stores one they are unknown. */
export const OPTION_NO_MARK = 'No broker mark stored for this option yet'

/** Where a member sets a stop. The Journal reads only the tab (it has no per-position param). */
export const SET_STOP_HREF = '/journal?j2tab=positions'

/**
 * Notebook widgets: My open positions and risk. Rendered from `attrs.params` only.
 *
 * ⛔ `distToStopPct` is the server's distance from ENTRY to stop (portfolio_heat), never from the
 * live price, and the column says so. ⛔ A placeholder stop (`noStop: true`) is "No stop set" with
 * the way to set one; it is never drawn as a 0% distance.
 */
export default function MyPositionsRiskEmbed({ attrs, height = 320, editable = false, onUpdateParams, uid }) {
  const p = attrs?.params || {}
  const frame = useSnapshotFrame('myPositionsRisk', attrs, { editable, onUpdateParams, uid })
  const rows = Array.isArray(p.rows) ? p.rows : []
  const hasAccount = typeof p.accountSize === 'number' && Number.isFinite(p.accountSize)
  const sizeReason = hasAccount ? 'No price available right now' : 'No account size set in Journal'
  const extra = Number(p.truncated) > 0 ? `${p.truncated} more not shown.` : ''
  const basis = p.sourceDetail ? null : own(PRICE_BASIS, p.priceBasis)
  const sourceLine = [accountSourceLine(p), basis, extra].filter(Boolean).join(' · ') || null
  const usesDefault = p.accountSizeSource === 'default' && hasAccount

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
                      {r?.kind === 'option'
                        ? r?.side && <span className={s.side}>{r.side}</span>
                        : r?.side === 'short' && <span className={s.side}>short</span>}
                    </td>
                    <td>{numCell(r?.sizePct, (v) => fmtPctPlain(v), r?.kind === 'option' && hasAccount ? OPTION_NO_MARK : sizeReason)}</td>
                    <td className={toneOf(r?.openPnl)}>
                      {numCell(r?.openPnl, fmtMoneySigned, r?.kind === 'option' ? OPTION_NO_MARK : 'No price available right now')}
                    </td>
                    {r?.kind === 'option' ? (
                      <>
                        <td><span className={s.none}>{OPTION_STOP}</span></td>
                        <td><span className={s.none}>{OPTION_STOP}</span></td>
                      </>
                    ) : r?.noStop === true ? (
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
        {rows.length > 0 && usesDefault && (
          <p className={s.empty} data-testid="default-account-note">
            {`Size % uses the default ${fmtPrice(p.accountSize)} account size. Set yours in Journal settings.`}
          </p>
        )}
      </SnapshotFrame>
    </div>
  )
}

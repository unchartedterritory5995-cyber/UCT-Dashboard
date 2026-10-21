import { embedAutoCaption } from '../../../lib/widgetEmbedCore'
import SnapshotFrame, { useSnapshotFrame, numCell, NA, own, snapshotStyles as s } from './SnapshotFrame'

const NO_NET = 'The flow record for this name carries no net premium figure'
const SIDE = { C: 'Call', P: 'Put' }
const DIRECTION = { Bull: 'Bullish', Bear: 'Bearish', Mixed: 'Mixed', Unclear: 'Unclear' }

/** Premium in dollars, short: $85K, $1.25M. */
export function fmtPremium(v) {
  const a = Math.abs(v)
  if (a >= 1e9) return `$${+(v / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `$${+(v / 1e6).toFixed(2)}M`
  if (a >= 1e3) return `$${+(v / 1e3).toFixed(1)}K`
  return `$${Math.round(v)}`
}

function Row({ label, children }) {
  return (
    <div className={s.row} data-card-row="">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

/**
 * Notebook widgets: Options flow on a ticker (wave 3). Rendered from `attrs.params` only.
 * The direction is a word (Bullish, Bearish), so colour is never the only signal.
 */
export default function TickerFlowEmbed({ attrs, height = 300, editable = false, onUpdateParams }) {
  const p = attrs?.params || {}
  const frame = useSnapshotFrame('tickerFlow', attrs, { editable, onUpdateParams })
  const sym = p.symbol || 'Ticker'
  const prints = Array.isArray(p.topPrints) ? p.topPrints : []

  return (
    <div style={{ height }} role="figure" aria-label={embedAutoCaption(attrs)} data-testid="ticker-flow-embed">
      <SnapshotFrame {...frame} title={`Options flow — ${sym}`}
        sourceLine={frame.sourceDetail ? null : 'Options flow as the Options Flow page reads it.'}>
        {prints.length > 0 && (
          <dl className={s.dl}>
            <Row label="Window">{typeof p.window === 'string' && p.window ? p.window : <NA reason="The window was not recorded" />}</Row>
            <Row label="Bullish premium">{numCell(p.bullPremium, fmtPremium, NO_NET)}</Row>
            <Row label="Bearish premium">{numCell(p.bearPremium, fmtPremium, NO_NET)}</Row>
          </dl>
        )}
        {prints.length === 0 ? (
          // F1: a failed read is said as a failure, never as "no flow".
          <p className={p.failed === true ? s.failed : s.empty}>
            {(typeof p.empty === 'string' && p.empty) || (p.failed === true ? "Couldn't load options flow right now." : `No options flow on record for ${sym} today.`)}
          </p>
        ) : (
          <div className={s.tableWrap}>
            <table className={s.table} aria-label="Largest contracts, as captured">
              <thead>
                <tr>
                  <th scope="col">Contract</th>
                  <th scope="col">Premium</th>
                  <th scope="col">Volume</th>
                  <th scope="col">Read</th>
                </tr>
              </thead>
              <tbody>
                {prints.map((c, i) => (
                  <tr key={`${c?.cp}-${c?.strike}-${c?.exp}-${i}`}>
                    <td>{`${c?.strike ?? '?'} ${own(SIDE, c?.cp) || 'Option'}, ${c?.exp || 'no expiry'}`}</td>
                    <td>{numCell(c?.premium, fmtPremium, 'No premium on record for this contract')}</td>
                    <td>{numCell(c?.volume, (v) => v.toLocaleString('en-US'), 'No volume on record for this contract')}</td>
                    <td>{own(DIRECTION, c?.direction) || <NA reason="No direction on record for this contract" />}</td>
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

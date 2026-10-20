import { embedAutoCaption } from '../../../lib/widgetEmbedCore'
import SnapshotFrame, { useSnapshotFrame, numCell, NA, snapshotStyles as s } from './SnapshotFrame'

const NO_TOTALS = 'The flow record does not total calls and puts'
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
      <SnapshotFrame {...frame} title={`Options flow — ${sym}`} sourceLine="Today's options flow, as the Options Flow page reads it.">
        <dl className={s.dl}>
          <Row label="Calls premium">{numCell(p.callPremium, fmtPremium, NO_TOTALS)}</Row>
          <Row label="Puts premium">{numCell(p.putPremium, fmtPremium, NO_TOTALS)}</Row>
          <Row label="Put/call ratio">{numCell(p.ratio, (v) => v.toFixed(2), NO_TOTALS)}</Row>
        </dl>
        {prints.length === 0 ? (
          <p className={s.empty}>{(typeof p.empty === 'string' && p.empty) || `No options flow on record for ${sym} today.`}</p>
        ) : (
          <div className={s.tableWrap}>
            <table className={s.table} aria-label="Largest contracts today, as captured">
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
                    <td>{`${c?.strike ?? '?'} ${SIDE[c?.cp] || 'Option'}, ${c?.exp || 'no expiry'}`}</td>
                    <td>{numCell(c?.premium, fmtPremium, 'No premium on record for this contract')}</td>
                    <td>{numCell(c?.volume, (v) => v.toLocaleString('en-US'), 'No volume on record for this contract')}</td>
                    <td>{DIRECTION[c?.direction] || <NA reason="No direction on record for this contract" />}</td>
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

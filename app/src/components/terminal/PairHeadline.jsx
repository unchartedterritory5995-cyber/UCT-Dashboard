// The one-line headline of a CURRENCY PAIR (BTCUSD) under a terminal panel's title:
// `BTCUSD 67,123.45 ▲+1.20% · Bitcoin · FMP, as of Nov 14, 7:00 AM ET`.
//
// SecurityHeadline renders this instead of the stock line when the security is a pair the
// server admits this member to (lib/cryptoPairs.js; dark behind CRYPTO_BARS_ENABLED). The
// price is the pair quote (`GET /api/crypto/quote/{sym}`, FMP), under one SWR key, so every
// panel on the pair shares one request.
//
// ⛔ NEVER "LIVE", and never a market-session clause: a pair has no close. The line names the
//    source and FMP's own time for the price; without a time it says there is none.
// ⛔ No price is said in words ("no price"), never drawn as 0.
import { pairQuoteView, useCryptoQuote } from '../../lib/cryptoPairs'
import styles from './SecurityHeadline.module.css'

export default function PairHeadline({ pair }) {
  const sym = pair.symbol
  const read = useCryptoQuote(sym)
  const view = pairQuoteView(read.quote)
  if (view.kind !== 'price') {
    const state = read.loading || view.kind === 'waiting' ? 'loading' : 'unavailable'
    return (
      <div className={`${styles.strip} ${styles.muted}`} role="status" aria-live="polite"
        data-testid="security-headline" data-state={state} data-pair="true">
        {state === 'loading'
          ? `Loading the ${sym} price…`
          : <>No price for <b className={styles.sym}>{sym}</b> from {view.source} right now</>}
      </div>
    )
  }
  return (
    <div className={`${styles.strip} ${view.stale ? styles.closed : ''}`} role="group" aria-label={`${sym} headline`}
      data-testid="security-headline" data-state={view.stale ? 'stale' : 'priced'} data-pair="true">
      <b className={styles.sym}>{sym}</b>
      <span className={styles.num} data-testid="security-headline-price">{view.price}</span>
      {view.pct && (
        <span className={`${styles.num} ${styles[view.dir]}`} data-testid="security-headline-pct">
          <span aria-hidden="true">{view.dir === 'up' ? '▲' : view.dir === 'down' ? '▼' : ''}</span>{view.pct}
        </span>
      )}
      {pair.name !== sym && <span className={styles.part}>· {pair.name}</span>}
      <span className={styles.part} data-testid="security-headline-source">
        · {view.source}{view.asOf ? `, as of ${view.asOf}` : ', no time sent'}{view.failed ? ' (last read failed)' : ''}
      </span>
    </div>
  )
}

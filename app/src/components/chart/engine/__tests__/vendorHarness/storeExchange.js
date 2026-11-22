// app/src/components/chart/engine/__tests__/vendorHarness/storeExchange.js
//
// ONE AUTHORITY, TWO HARNESS SIDES: the store exchange a captured listing is handed under, read by `ourSide.js`
// (the indicator door) and by `strategyHarness.js` (the broker run), so the two sides of the harness bind a
// capture's symbol exactly as a member's chart does. Moved here unchanged from `ourSide.js` (2026-11-16).
import SYMBOL_SCOPE from '../../ast/symbolScope.json'

/** OUR STORE's exchange spelling for a captured listing — the key
 *  `symbolScope.json::confirmed` is written in. A capture carries TradingView's
 *  spelling (`AMEX` for SPY), and the store's (`NYSE Arca`) is linked to it only
 *  by a confirmed row's WITNESS: the row whose witness IS this listing answers.
 *  Failing that, a store key that is its own Pine spelling (`NYSE`, `NASDAQ`,
 *  `OTC`) is the same string in both worlds. `AMEX` without a witness is
 *  ambiguous (`NYSE Arca` and `NYSE American` both answer it): null. */
export function storeExchangeOfCapture(cap, tvExchange) {
  const pro = String((cap.symbol && (cap.symbol.pro_name || cap.symbol.full_name)) || '').toUpperCase()
  const confirmed = (SYMBOL_SCOPE && SYMBOL_SCOPE.confirmed) || {}
  for (const [store, row] of Object.entries(confirmed)) {
    if (store.startsWith('_') || !row || typeof row !== 'object') continue
    if (String(row.witness || '').toUpperCase() === pro) return store
  }
  const tv = typeof tvExchange === 'string' ? tvExchange : ''
  const own = confirmed[tv]
  return own && typeof own === 'object' && own.pine === tv ? tv : null
}

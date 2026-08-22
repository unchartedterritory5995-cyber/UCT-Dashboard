// app/src/pages/cot/cotProxies.js
//
// Which liquid ETF stands in for a futures contract when the COT tab needs a
// price series. Positioning is reported on the futures; the price history we
// can fetch cheaply (`/api/bars/{ETF}?tf=W`) is the ETF. The map is deliberately
// conservative — no proxy beats a misleading one — and every entry carries a
// note so the UI can say what the price actually is.
//
// Unmapped on purpose (→ null): VI, AL, HO, FL, ZM, ZL, ZR, MW, OA, CT, OJ, KC,
// CC, LB, LE, GF, HE, DF, BJ, ZQ, SR3, M6, N6, L6, ETH — either no liquid ETF,
// or one whose price tracks the contract too loosely to learn from.
// VI is null because VIX ETFs decay structurally (contango roll), so forward
// returns on them would mislead — they say nothing about where the index went.

/** COT symbol → ETF ticker whose weekly closes proxy the contract's price. */
export const PRICE_PROXY = {
  // Equity indices
  ES: 'SPY', NQ: 'QQQ', YM: 'DIA', QR: 'IWM', EW: 'MDY', NK: 'EWJ',
  // Metals
  GC: 'GLD', SI: 'SLV', HG: 'CPER', PL: 'PPLT', PA: 'PALL',
  // Energies
  CL: 'USO', RB: 'UGA', NG: 'UNG', BZ: 'BNO',
  // Grains & softs
  ZW: 'WEAT', ZC: 'CORN', ZS: 'SOYB', KE: 'WEAT', SB: 'CANE',
  // Rates
  ZB: 'TLT', UD: 'TLT', ZN: 'IEF', ZF: 'IEI', ZT: 'SHY',
  // Currencies
  DX: 'UUP', B6: 'FXB', D6: 'FXC', J6: 'FXY', S6: 'FXF', E6: 'FXE', A6: 'FXA',
  // Crypto
  BTC: 'BITO',
}

// ETFs that hold futures rather than the physical: their price carries roll
// drag, so a multi-month forward return understates the contract's own move.
// (GLD/SLV/PPLT/PALL hold metal; the rate and currency funds hold the asset.)
const ROLL_DRAG = new Set(['CPER', 'USO', 'UGA', 'UNG', 'BNO', 'WEAT', 'CORN', 'SOYB', 'CANE'])

const SPECIAL_NOTE = {
  BITO: ' (ETF proxy, history from Oct 2021)',
}

/**
 * Resolve the price proxy for a COT symbol.
 * @param {string} symbol  COT symbol, e.g. 'ES'
 * @returns {{ ticker: string, note: string } | null}  null when no honest proxy exists.
 *   `note` is a short attribution for the UI, e.g. 'via SPY' or
 *   'via USO (ETF proxy — roll drag)'.
 */
export function proxyFor(symbol) {
  const key = String(symbol || '').toUpperCase()
  const ticker = PRICE_PROXY[key]
  if (!ticker) return null
  const suffix = SPECIAL_NOTE[ticker] || (ROLL_DRAG.has(ticker) ? ' (ETF proxy — roll drag)' : '')
  return { ticker, note: `via ${ticker}${suffix}` }
}

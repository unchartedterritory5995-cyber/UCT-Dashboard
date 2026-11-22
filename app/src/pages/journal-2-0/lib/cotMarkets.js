// S13.6 remainder: the COT tab's market list (`GET /api/cot/symbols`, cot_service SYMBOL_GROUPS/SYMBOL_NAMES),
// read the way its picker reads it. ONE helper for the Insert panel's market list and the /cot capture's
// market name. Kept apart from captures/cotCapture.js so the Insert panel never loads the COT math.

export const COT_SYMBOLS_URL = '/api/cot/symbols'

/** A CFTC market code as the COT tab writes it (CotEmbed.cotHref's rule): ES, J6, SR3 -- not an equity ticker. */
export const COT_MARKET_RE = /^[A-Za-z][A-Za-z0-9]{0,5}$/

/** The markets, flattened and de-duplicated, in the COT tab's order: [{symbol, name}]. */
export function cotMarkets(symbolsBody) {
  const seen = new Set()
  const out = []
  const groups = symbolsBody?.groups && typeof symbolsBody.groups === 'object' ? symbolsBody.groups : {}
  for (const rows of Object.values(groups)) {
    for (const r of Array.isArray(rows) ? rows : []) {
      if (!r?.symbol || seen.has(r.symbol)) continue
      seen.add(r.symbol)
      out.push({ symbol: r.symbol, name: r.name || r.symbol })
    }
  }
  return out
}

/** One market's display name, or null. */
export const cotMarketName = (symbolsBody, market) =>
  cotMarkets(symbolsBody).find((m) => m.symbol === market && m.name !== market)?.name || null

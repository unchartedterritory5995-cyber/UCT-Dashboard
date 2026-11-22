// The market view word three panels share (2026-11-21): `DVD MARKET`, `MNA MARKET`, `IDXC MARKET`. No React.
//
// DVD, MNA and IDXC each have a market variant and a per-stock variant. On a board whose panel follows a group,
// the shell gives such a panel the group's stock (boardModel.panelSym, TerminalShell resolvePanel), so the bare
// code shows THAT stock. The word MARKET asks for the whole market whatever stock the panel follows, so the
// market view is one word (or one chip) away on every board. Both variants of each code declare it (args.js
// `marketView`, a copy of MARKET_VIEW_ARG_WORDS pinned by functions.marketView.test.js).
//
// ALL is not a view word: it is a stock the site follows (`DVD ALL` is that stock's dividends).

export const MARKET_VIEW_WORD = 'MARKET'
export const MARKET_VIEW_ARG_WORDS = Object.freeze({ MARKET: 'market', MKT: 'market' })

export function parseMarketView(tok) {
  const key = String(tok ?? '').trim().toUpperCase()
  return Object.prototype.hasOwnProperty.call(MARKET_VIEW_ARG_WORDS, key) ? MARKET_VIEW_ARG_WORDS[key] : null
}
/** True for the market view. */
export const isMarketView = (v) => v === 'market'
/** The argument that asks for the market view, or none. */
export const marketViewArgs = (market) => (market ? [MARKET_VIEW_WORD] : [])

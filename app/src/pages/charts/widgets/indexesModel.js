// Indexes widget — the pure model. No React, no CSS: the snapshot payload in,
// the rows the widget renders AND freezes out. Kept beside the component (the
// newsFeedModel / earningsRows / chartEarningsStripModel idiom) so the shape
// question has ONE answer that both the live board and a frozen note embed
// resolve through.

/** The house index set + display order — the same six MorningWireIndexes
 *  renders (index futures were dropped 2026-07-27, owner call).
 *
 *  ⭐ `label` names what the symbol actually IS. SPY prints 645.12 and the S&P
 *  500 prints 6,451, so labelling that row "S&P 500" would put a false number
 *  under a true name. It is DERIVED at render and never stored in a capture:
 *  a rename is a display change and must not be able to rewrite a frozen row. */
export const INDEX_SYMBOLS = [
  { sym: 'SPY', label: 'S&P 500 ETF' },
  { sym: 'QQQ', label: 'Nasdaq 100 ETF' },
  { sym: 'DIA', label: 'Dow 30 ETF' },
  { sym: 'IWM', label: 'Russell 2000 ETF' },
  { sym: 'BTC', label: 'Bitcoin' },
  { sym: 'VIX', label: 'Volatility Index' },
]

export const INDEX_LABELS = Object.fromEntries(INDEX_SYMBOLS.map((e) => [e.sym, e.label]))

/** BTC is the lone survivor of the snapshot payload's `futures` block; every
 *  other reading (VIX included) rides in `etfs`. Mirrors MorningWireIndexes'
 *  `pick` — one shape question, one answer. */
export function pickEntry(data, sym) {
  if (!data) return null
  return sym === 'BTC' ? (data.futures?.BTC || null) : (data.etfs?.[sym] || null)
}

/** Direction from the CHANGE STRING, for the live and the frozen path alike.
 *  ⛔ The server also emits its own `css` flag, and storing BOTH it and `chg`
 *  would put two authorities on one fact — a frozen row whose tint disagreed
 *  with its own number is exactly the drift this derives away.
 *  `massive._fmt_chg` renders '+0.43%' / '-1.20%'; anything else (an em dash
 *  for a missing reading) is neutral. */
export function chgDirection(chg) {
  const s = String(chg ?? '')
  if (s.startsWith('-')) return 'neg'
  if (s.startsWith('+')) return 'pos'
  return ''
}

/** The rows the widget shows — and, byte for byte, the rows a capture freezes.
 *  ONE array feeds the render AND the Send-to-Journal door, so a note can never
 *  freeze a set the member wasn't looking at. `hidden` is a Set of symbols. */
export function rowsFromSnapshot(data, hidden) {
  const skip = hidden instanceof Set ? hidden : new Set(hidden || [])
  const out = []
  for (const { sym } of INDEX_SYMBOLS) {
    if (skip.has(sym)) continue
    const e = pickEntry(data, sym)
    if (!e) continue
    out.push({ sym, price: e.price, chg: e.chg })
  }
  return out
}

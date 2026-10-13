// The words for a setups board card's price and distance (Wave 13 lane 13J). Pure: no React, no
// imports, no network. The board's card (components/notebook/BoardCard.jsx) and the daily prep
// pack's key levels block both say a card's state in these words, so the two can never describe one
// card two ways. Every number is the server's (`setups_board.py`); nothing is recomputed here.

export const money = (v) => (typeof v === 'number' && Number.isFinite(v) ? `$${v.toFixed(2)}` : '—')
const pct = (v) => `${Math.abs(v).toFixed(2)}%`
const r = (v) => `${Math.abs(v).toFixed(2)}R`

/** One sentence for where price stands against the trigger. Pure. */
export function distanceText(card) {
  const { state, distancePct, distanceR } = card || {}
  if (state === 'no_price' || distancePct == null) return 'No price yet'
  const rPart = distanceR == null ? '' : ` · ${r(distanceR)}`
  if (state === 'triggered') return `Triggered · ${pct(distancePct)} through the entry${rPart}`
  if (state === 'invalidated') return `Through the stop · ${pct(distancePct)} from the entry${rPart}`
  return `${pct(distancePct)} to the entry${rPart}`
}

export const STATE_LABEL = {
  waiting: 'Waiting', watching: 'Watching', triggered: 'Triggered', invalidated: 'Invalidated', no_price: 'No price',
}

/** Where a card stands, said once: the state's word followed by the distance sentence, except where the
 *  sentence already carries the state ("Triggered · 0.94% through the entry", "Through the stop · …",
 *  "No price yet"), which stands alone. Pure. */
export function stateAndDistance(card) {
  const d = distanceText(card)
  const carried = d === 'No price yet' || card?.state === 'triggered' || card?.state === 'invalidated'
  return carried ? d : `${STATE_LABEL[card?.state] || card?.state} · ${d}`
}

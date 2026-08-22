// app/src/pages/cot/cotCompose.js
//
// The ONE composition of the COT positioning analytics for a single report
// week. The Positioning rail runs it in the browser on every hover tick; the
// Node CLI (cotFactsEntry.js → dist/cot-facts.cjs) runs the very same function
// so the backend can pre-compute the facts the browser would compute — one
// authority, no Python port.
//
// The order and the inputs mirror PositioningRail.jsx exactly:
//   snapshot → read → analogs (searched in the read's direction, sharing a
//   per-rows snapshot memo) → divergences (only when price is aligned) →
//   narrative facts.
//
// Facts are built for EVERY week; whether they go anywhere (the rail only
// sends the latest week's to the narrative endpoint) is the caller's call.
import { computeSnapshot, buildRead } from './cotRead'
import { computeAnalogs, alignPrice } from './cotAnalogs'
import { detectDivergences } from './cotDivergence'
import { narrativeFacts } from './cotFacts'

/**
 * Compose the full positioning read for week `idx`.
 * @param {Array} rows  `/api/cot/{symbol}` records, ascending by date
 * @param {number} idx  which week (0..rows.length−1)
 * @param {{
 *   symbol?: string, name?: string,
 *   bars?: Array|null,                 weekly proxy bars (see cotAnalogs.alignPrice)
 *   priceAligned?: Array|null,         one close per row; derived from bars when omitted
 *   proxy?: {ticker: string, note: string}|null,
 *   snapshots?: Array,                 per-week computeSnapshot memo, read AND filled
 * }} [opts]
 * @returns {{ snap, read, analogs, divergences, facts, isLatest: boolean }}
 * @throws {Error} on empty rows or an out-of-range idx
 */
export function composeWeek(
  rows, idx,
  { symbol, name, bars = null, priceAligned = null, proxy = null, snapshots } = {},
) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('composeWeek: rows is empty — nothing to compute')
  }
  if (!Number.isInteger(idx) || idx < 0 || idx >= rows.length) {
    throw new Error(`composeWeek: idx ${idx} out of range (0..${rows.length - 1})`)
  }

  const isLatest = idx === rows.length - 1
  const snap = computeSnapshot(rows, idx)
  const read = buildRead(snap, { symbol, name })
  const analogs = computeAnalogs(rows, bars || [], idx, { direction: read.bias.tone, snapshots })

  const aligned = priceAligned || (bars && bars.length ? alignPrice(rows, bars) : null)
  const divergences = aligned ? detectDivergences(rows, aligned, idx) : []

  const facts = narrativeFacts({ symbol, name, snap, read, analogs, divergences, proxy })

  return { snap, read, analogs, divergences, facts, isLatest }
}

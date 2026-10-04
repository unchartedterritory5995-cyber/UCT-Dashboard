// app/src/components/chart/engine/listingDeepen.js
//
// ─── B1P — DEEPEN A GRID CELL'S DAILY SERIES TO THE LISTING, BOUNDED ──────────
//
// A switched Pine recurrence (`accum` with the `(0/0) * seed` mark) is exact only
// when the series starts at the symbol's first session (ruling R-W, `listingSeed.js`);
// off the listing `interpret` publishes it only where the bounded window can prove
// the state was forgotten, and withholds the rest (`interpret.js::rangeSwitchedColumn`).
// A standalone daily chart's first paint is already the full depth
// (`StockChart._deepFirstPaint`). A multi-chart grid cell is NOT: it passes
// `backgroundWarm={false}` and first-paints `FIRST_PAINT_BARS`, so a member pane
// carrying such a recurrence stays withheld across long stretches until the member
// maximizes or pans the cell.
//
// This module decides when a cell should deepen ONLY its daily request to the full
// depth (`fullBarsFor('D')`), and BOUNDS how many cells may do so at once.
//
// ⛔ THE GRID HERD RULES (CLAUDE.md, "Multi-Chart Grid Mode") ARE KEPT:
//   - `GridChartCell` keeps `backgroundWarm={false}`; this never turns the all-TF
//     warm chain on.
//   - ONE timeframe ('D') per cell, through the cell's own on-demand fetch path
//     (`setFetchDepth`, the same lever pan-backfill and the maximized cell's dwell use).
//   - At most `LISTING_DEEPEN_MAX` deepens in flight across the whole page — the same
//     width as the grid warm's `_IDB_MAX` in `utils/prefetchBars.js` — so a 16-cell
//     board of such panes is 16 queued deepens, 3 at a time, never 16 at once.

import { readsSwitchedState } from './ast/interpret.js'

const PINE_ORIGIN = 'pine'   // `nativeRegistry.PINE_RECURRENCE_ORIGIN`

/** Concurrency width. Mirrors `prefetchBars._IDB_MAX` (3). */
export const LISTING_DEEPEN_MAX = 3
/** A slot that never sees its bars arrive is released after this long. */
export const LISTING_DEEPEN_SAFETY_MS = 20000

/** Does this definition carry a recurrence that is withheld off the listing?
 *  Only a document the Pine member door built declares Pine recurrence semantics
 *  (`meta.recurrenceOrigin === 'pine'`, the same declaration `historyFromListingFor`
 *  reads); a TC2000 `CountTrue` window is an `accum` too and is NOT "carried since
 *  the first bar". Every tree in the document is asked (`ast` keys, at any depth). */
export function definitionWithholdsOffListing(def) {
  if (!def || typeof def !== 'object') return false
  if (!def.meta || def.meta.recurrenceOrigin !== PINE_ORIGIN) return false
  const stack = [def]
  const seen = new Set()
  while (stack.length) {
    const n = stack.pop()
    if (!n || typeof n !== 'object' || seen.has(n)) continue
    seen.add(n)
    if (Array.isArray(n)) { for (const v of n) stack.push(v); continue }
    for (const [k, v] of Object.entries(n)) {
      if (k === 'ast' && v && typeof v === 'object') {
        if (readsSwitchedState(v)) return true
        continue
      }
      if (v && typeof v === 'object') stack.push(v)
    }
  }
  return false
}

/** Should THIS chart deepen its daily request for the listing? Pure. */
export function wantsListingDeepen({ backgroundWarm, deepWarm, tf, carries, pinned } = {}) {
  if (backgroundWarm !== false) return false   // a standalone chart already first-paints full depth
  if (deepWarm === true) return false          // the maximized cell already deepens on its dwell
  if (tf !== 'D') return false                 // the listing statement is daily-only
  if (pinned === true) return false            // entry/exact/replay/override charts fetch their own window
  return carries === true
}

/** A page-wide gate: `request(onGrant)` runs `onGrant(release)` when a slot is free
 *  (at once, or later in FIFO order) and returns a `cancel` that withdraws a queued
 *  request or releases a granted one. `release` and `cancel` are idempotent. */
export function createListingDeepenGate({
  max = LISTING_DEEPEN_MAX,
  safetyMs = LISTING_DEEPEN_SAFETY_MS,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
} = {}) {
  let active = 0
  const queue = []
  const grant = (ticket) => {
    active += 1
    ticket.state = 'granted'
    ticket.timer = setTimer(() => ticket.release(), safetyMs)
    try { ticket.onGrant(ticket.release) } catch { ticket.release() }
  }
  const pump = () => {
    while (active < max && queue.length) grant(queue.shift())
  }
  return {
    request(onGrant) {
      const ticket = { state: 'queued', timer: null, onGrant }
      ticket.release = () => {
        if (ticket.state !== 'granted') return
        ticket.state = 'done'
        if (ticket.timer !== null) clearTimer(ticket.timer)
        active -= 1
        pump()
      }
      if (active < max) grant(ticket)
      else queue.push(ticket)
      return () => {
        if (ticket.state === 'queued') {
          const i = queue.indexOf(ticket)
          if (i >= 0) queue.splice(i, 1)
          ticket.state = 'done'
        } else ticket.release()
      }
    },
    inFlight: () => active,
    queued: () => queue.length,
  }
}

/** The one page-wide gate every chart shares. */
export const listingDeepenGate = createListingDeepenGate()

/**
 * Wave 13 lane 13G-2 -- thesis chips, the client half.
 *
 * A row for a symbol a member has written about shows a small chip: the note's own
 * `builtin:thesis_status` and the distance from the row's OWN current price to the
 * note's stop (the server's `j2_note_levels` price, verbatim -- see
 * `api/services/journal_two/thesis_chips.py`). This module computes nothing the server
 * did not already hand it except the one piece of arithmetic no batch endpoint needs to
 * carry twice: a plain percent from a price the row already has to a price the server
 * already sent.
 */
import { notebookFlag } from './offline/notebookFlags'

export const THESIS_CHIPS_FLAG = 'notebook_thesis_chips_enabled'
export const THESIS_CHIPS_URL = '/api/j2/thesis-chips'

export function thesisChipsEnabled() {
  return notebookFlag(THESIS_CHIPS_FLAG) === true
}

/** Mirrors `note_properties.BUILTIN_PROPERTY_DEFS['builtin:thesis_status'].options` --
 *  the ONE other place these four values and their colors are declared. A status this
 *  table does not know renders with no color, never a guess. */
export const STATUS_META = Object.freeze({
  watching: { label: 'Watching', color: 'blue' },
  active: { label: 'Active', color: 'green' },
  invalidated: { label: 'Invalidated', color: 'red' },
  closed: { label: 'Closed', color: 'gray' },
})

/** A plain dollar level, 2dp, or null -> '—'. Kept local (not `lib/journal-2-0`'s
 *  `money`) so this module has no dependency the Watchlist widget's own bundle would
 *  need to carry just for one chip. */
export function formatLevel(n) {
  if (n == null || !Number.isFinite(n)) return '—'
  return `$${n.toFixed(2)}`
}

/**
 * The distance from `currentPrice` to the chip's stop, as a signed percent string, or
 * null when either input is missing. The LEVEL (`chip.stop`) is never recomputed here --
 * only the arithmetic from it to a price the row already holds.
 */
export function stopDistanceText(chip, currentPrice) {
  const stop = chip?.stop
  if (stop == null || !Number.isFinite(stop)) return null
  if (currentPrice == null || !Number.isFinite(currentPrice) || currentPrice === 0) return null
  const pct = ((currentPrice - stop) / currentPrice) * 100
  const sign = pct >= 0 ? '+' : ''
  const word = pct >= 0 ? 'above stop' : 'below stop'
  return `${sign}${pct.toFixed(1)}% ${word}`
}

/** The short label the chip itself shows (distance when there is a stop, else the
 *  status, else a neutral dash -- never blank, so the chip is never an empty button). */
export function chipLabel(chip, currentPrice) {
  const dist = stopDistanceText(chip, currentPrice)
  if (dist) return dist
  // An OWN key only: STATUS_META is a plain object, so `constructor` or `toString` would
  // otherwise be "found" on its prototype and give a chip with no text.
  const status = chip?.thesisStatus
  const meta = typeof status === 'string' && Object.hasOwn(STATUS_META, status) ? STATUS_META[status] : null
  return meta ? meta.label : 'Thesis'
}

// app/src/components/chart/barInfoFields.js — WHICH FIELDS THE BAR INFO STRIP PRINTS
//
// ⭐⭐ THE SAME SHAPE AS `legendMode.js`, AND THAT IS DELIBERATE RATHER THAN
// STYLISTIC. One key that anything WRITES (`cs.header.barInfo`), one function
// that everything READS (`barInfoFieldsOf`), and a default that lives HERE and is
// resolved on every read instead of being declared in `CHART_DEFAULTS`.
//
// ⛔ IT IS NOT DECLARED IN `CHART_DEFAULTS`, FOR THE MEASURED REASON `legendMode`
// records: a schema entry is spread into every merged blob, and the merged blob
// is what every settings write persists — so the default would be written back as
// though the member had chosen it, and no later default could ever outrank it.
// That is exactly what happened to `legendMode` on 2026-08-16 (`legendStamp.test.js`).
//
// ⭐ THE STORED VALUE IS A SET, NOT AN ORDER. `barInfoFieldsOf` always answers in
// `BAR_INFO_FIELDS` order and filters by membership, so a blob cannot reorder the
// strip into `C H O L` — the reading order of a bar is a design decision, not a
// stored one, and an array that carried order would make it one.
//
// ⚰️ THIS REPLACES `header.legendLayout` ('vertical' | 'horizontal'). There is one
// legend now — a horizontal BAR INFO strip above a vertical STUDY STACK — so the
// layout choice has no subject. The old key is neither read nor migrated: a stored
// 'vertical' and a stored 'horizontal' both open on the one layout, which is the
// backward-compatible reader strategy rather than a rewrite of every saved chart.

/**
 * Every field the strip can print, IN THE ORDER IT PRINTS THEM.
 *
 * `short` is what the strip stamps before the number (`O`, `H`, `L`, `C`); the
 * date and the two change fields carry no label at all — a date reads as a date
 * and a signed number beside it reads as a change, and `Chg -4.64` is a label
 * earning nothing. `label` is what Chart Settings calls the field.
 *
 * ⛔ VOLUME IS NOT HERE, AND THAT IS THE POINT OF THE SPLIT. Volume is a PLOT —
 * it has a colour, a pane, a visibility and a popover — so it belongs in the
 * study stack with the moving averages, not in a readout of the candle.
 */
export const BAR_INFO_FIELDS = Object.freeze([
  { id: 'date', label: 'Date', short: '' },
  { id: 'open', label: 'Open', short: 'O' },
  { id: 'high', label: 'High', short: 'H' },
  { id: 'low', label: 'Low', short: 'L' },
  { id: 'close', label: 'Close', short: 'C' },
  { id: 'change', label: 'Net Chg', short: '' },
  { id: 'changePct', label: '% Chg', short: '' },
].map(Object.freeze))

/** The ids, in canonical order. */
export const BAR_INFO_FIELD_IDS = Object.freeze(BAR_INFO_FIELDS.map((f) => f.id))

const _VALID = new Set(BAR_INFO_FIELD_IDS)

/**
 * The complete set — what a member who has never touched this gets.
 *
 * ⭐ ALL SEVEN. The strip replaces a legend that printed all of them, so the
 * default has to be the status quo or the change would silently take fields away
 * from every existing chart.
 */
export const DEFAULT_BAR_INFO_FIELDS = BAR_INFO_FIELD_IDS

/**
 * The set the member EXPLICITLY chose, or `undefined` when they never did.
 *
 * ⛔ THE ONE VALIDITY RULE, AND THE ONLY THING THE MERGE MAY PERSIST. An empty
 * array is a REAL CHOICE — "print no fields" — and must survive, so the test is
 * `Array.isArray`, never truthiness of the length.
 *
 * ⚠️ AN UNKNOWN ID IS DROPPED, NOT REFUSED. A blob written by a later version
 * naming a field this one does not have should degrade to the fields it does
 * have, not blank the strip.
 */
export function explicitBarInfoFields(cs) {
  const header = (cs && typeof cs === 'object' && cs.header && typeof cs.header === 'object')
    ? cs.header : null
  const raw = header?.barInfo
  if (!Array.isArray(raw)) return undefined
  const seen = new Set()
  for (const id of raw) if (typeof id === 'string' && _VALID.has(id)) seen.add(id)
  // Canonical order, always — see the header.
  return BAR_INFO_FIELD_IDS.filter((id) => seen.has(id))
}

/** The fields this chart's settings ask for, in print order. */
export function barInfoFieldsOf(cs) {
  const explicit = explicitBarInfoFields(cs)
  return explicit || DEFAULT_BAR_INFO_FIELDS
}

/** Does the strip print `id` on this chart? */
export function barInfoShows(cs, id) {
  return barInfoFieldsOf(cs).indexOf(id) >= 0
}

/**
 * The array to STORE after toggling one field — canonical order, deduped.
 *
 * ⭐ IT ALWAYS RETURNS AN EXPLICIT ARRAY, including the full set. Toggling a
 * field off and back on is a choice the member made and it is recorded as one;
 * silently reverting to "absent = default" would make the control lie the moment
 * a future default differs from today's.
 */
export function withBarInfoField(cs, id, on) {
  if (!_VALID.has(id)) return barInfoFieldsOf(cs).slice()
  const cur = new Set(barInfoFieldsOf(cs))
  if (on) cur.add(id); else cur.delete(id)
  return BAR_INFO_FIELD_IDS.filter((f) => cur.has(f))
}

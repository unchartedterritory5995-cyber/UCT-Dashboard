// app/src/components/chart/engine/labelText.js
//
// ─── SLICE 2 — A SHORT LABEL IS A DISPLAY, NEVER THE NAME ────────────────────
//
// The Formula Builder stores a user definition's `meta.shortName` as
// `chipName(meta.name)` — a 12-character, word-boundary cut made for the old
// fixed-width chip. The NAME (`meta.name`) is always stored whole. Where a
// surface now has room (or truncates visually, with the full name in its title),
// it should show the name, not the cut. `isChipCut` recognises exactly that cut
// so a display can undo it without any stored document changing.
//
// Engine-neutral on purpose: the builder (which writes the cut) and the legend
// (which displays it) both import from here.

export const CHIP_NAME_MAX = 12

/** A chip-sized name: at most `CHIP_NAME_MAX`, cut at a word boundary when there
 *  is a usable one, and never left with a trailing space.
 *
 *  ⚰️ `trimmed.slice(0, 12)` ALONE PRODUCED "Above 50 on  settings". Measured in
 *  production 2026-08-11: saving "Above 50 on volume" gave a chip reading
 *  "Above 50 on " — cut mid-word, trailing space intact — and the controls built
 *  from it read `Hide Above 50 on ` and `Above 50 on  settings`, double space and
 *  all. The cap itself is real (the chip strip is narrow); the ragged edge was not.
 */
export function chipName(name) {
  const trimmed = String(name || '').trim()
  if (trimmed.length <= CHIP_NAME_MAX) return trimmed
  const cut = trimmed.slice(0, CHIP_NAME_MAX)
  const lastSpace = cut.lastIndexOf(' ')
  // Only prefer the word boundary when it leaves something worth reading —
  // "Above" beats "Above 50 on", but a single stub is worse than a clean cut.
  const out = lastSpace >= Math.ceil(CHIP_NAME_MAX / 2) ? cut.slice(0, lastSpace) : cut
  return out.trim()
}

/** True when `label` is exactly the builder's chip cut of a LONGER `name`. */
export function isChipCut(name, label) {
  if (typeof name !== 'string' || typeof label !== 'string') return false
  const full = name.trim()
  return full.length > CHIP_NAME_MAX && label !== full && chipName(full) === label
}

/** The label to display for a user definition: the whole name where the stored
 *  short label is only the chip cut of it; otherwise the label unchanged. */
export function untruncatedLabel(def, label) {
  const name = def && def.meta && def.meta.name
  return isChipCut(name, label) ? String(name).trim() : label
}

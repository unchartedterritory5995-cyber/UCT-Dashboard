// app/src/components/chart/engine/objectDefaults.js
//
// ─── ⭐⭐ C37 — THE DEFAULT COLOURS THAT DEPEND ON THE SCRIPT'S PINE VERSION ────
//
// A drawing whose script names no colour is drawn in Pine's default for that
// slot — and for a handful of slots the default is not one colour across
// versions. Each row below was read off a vendor capture whose script leaves
// that colour UNSET (the object records hold what TradingView drew;
// `colourCensus.measure.test.js` is the column they were counted in, and
// `vendorHarness.c37ObjectColours.test.js` the rail):
//
//   v4  line.color, label.color   `color.blue` of v4, `#2196F3`
//                                 (rsi-swing-indicator: 10 lines;
//                                  fibonacci-pivot-points-cc: 7 labels)
//   v4  label.textcolor           `color.black`, `#363A45` (rsi-swing: 11 labels)
//   v5  label.textcolor           `color.black`, `#363A45` (vw-object-gc-a/b/c,
//                                  vdubus: 245 labels). v6 draws WHITE (4 labels
//                                  on the 2026-09-30 probes) — the base default.
//   v5  box.bgcolor               `color.blue`, OPAQUE `#2962FF` (vw-object-gc:
//                                  241 boxes) — not the base default's 20% fill
//   v5  box.text_color            `color.black`, `#363A45` (745 boxes)
//   v5  cell.text_color           `color.black`, `#363A45` (htf-liquidity, vold,
//                                  keltner-center-of-gravity: 32 cells)
//
//   ⭐ H11 (CAP5, `vw-cap5-version-defaults-v6-rddt-1d-2026-10-04` /
//   `-v4-…`, 3 boxes + 2-3 cells each, every colour left UNSET on purpose):
//   v6  box.bgcolor               `color.blue`, OPAQUE `#2962FF` (as v5)
//   v6  cell.text_color           `color.black`, `#363A45` (as v5)
//   v4  box.border_color          `color.blue` of v4, `#2196F3`
//   v4  box.bgcolor               `color.blue` of v4, OPAQUE `#2196F3`
//   v4  cell.text_color           `color.black`, `#363A45`
//   (v6's unset box border is `#2962FF`, the base default — no row.)
//
// ⛔ ONLY THE (version, slot) PAIRS A CAPTURE SHOWS. A v6 / v4 box's text colour
// and every v1-v3 slot are unwitnessed: they keep the base default
// (`objectRenderState.js::OBJECT_DEFAULTS`; a cell's is the table renderer's own)
// until a capture says otherwise.
// ⛔ The hexes come from the palette authority (`pinePalette.js`) AT THAT
// VERSION, never typed here — `color.blue` is `#2196F3` in v4 and `#2962FF`
// from v5.
//
// Kept apart from `objectRenderState.js` so the translator can ask WHICH
// versions carry such defaults without importing the render state.

import { pineColourHex } from './pinePalette.js'

const VERSION_DEFAULTS = Object.freeze({
  4: Object.freeze({
    line: Object.freeze({ color: 'color.blue' }),
    label: Object.freeze({ color: 'color.blue', textcolor: 'color.black' }),
    box: Object.freeze({ border_color: 'color.blue', bgcolor: 'color.blue' }),
    cell: Object.freeze({ text_color: 'color.black' }),
  }),
  5: Object.freeze({
    label: Object.freeze({ textcolor: 'color.black' }),
    box: Object.freeze({ bgcolor: 'color.blue', text_color: 'color.black' }),
    cell: Object.freeze({ text_color: 'color.black' }),
  }),
  6: Object.freeze({
    box: Object.freeze({ bgcolor: 'color.blue' }),
    cell: Object.freeze({ text_color: 'color.black' }),
  }),
})

/** The versions whose defaults differ from the base — the only ones an object
 *  program needs to state (`pine.js` stamps `pineVersion` for exactly these). */
export const VERSIONS_WITH_OBJECT_DEFAULTS = Object.freeze(Object.keys(VERSION_DEFAULTS).map(Number))

/** ⭐ H11 — the versions stamped on EVERY program of theirs (v4, v5, as C37 shipped
 *  them). v6's rows reach only boxes and cells, so a v6 program states its version
 *  only when it draws one (`versionStampedFor`): every other v6 program — lines,
 *  labels, linefills — keeps its bytes. */
const STAMPED_ALWAYS = Object.freeze([4, 5])

/** Whether a program of `pineVersion` that uses `families` (an iterable of object
 *  families, `cell` for a table cell) states its version. */
export function versionStampedFor(pineVersion, families) {
  if (!VERSIONS_WITH_OBJECT_DEFAULTS.includes(pineVersion)) return false
  if (STAMPED_ALWAYS.includes(pineVersion)) return true
  const reached = Object.keys(VERSION_DEFAULTS[pineVersion] || {})
  for (const f of families || []) if (reached.includes(f)) return true
  return false
}

const memo = new Map()

/** `{family: {slot: '#RRGGBB'}}` — the witnessed defaults of `pineVersion` that
 *  differ from the base, or an empty map for any other version (or none). */
export function versionObjectDefaults(pineVersion) {
  const key = Number.isInteger(pineVersion) && Object.hasOwn(VERSION_DEFAULTS, pineVersion) ? pineVersion : 0
  const hit = memo.get(key)
  if (hit) return hit
  const out = {}
  for (const [family, slots] of Object.entries(key ? VERSION_DEFAULTS[key] : {})) {
    const named = {}
    for (const [slot, name] of Object.entries(slots)) {
      const hex = pineColourHex(name, key)
      if (hex) named[slot] = hex
    }
    out[family] = Object.freeze(named)
  }
  const frozen = Object.freeze(out)
  memo.set(key, frozen)
  return frozen
}

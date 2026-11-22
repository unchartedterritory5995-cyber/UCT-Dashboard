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
//   v4  cell.text_color           `color.black`, `#363A45` (vw-tf-tick-format-idiom-v4
//                                  spy / eurusd 2026-11-20)
//   v6  cell.text_color           `color.black`, `#363A45` (vw-w3-format-date,
//                                  -loop-helper-text, -str-repeat-length 2026-11-16;
//                                  vw-tf-*, vw-lastbar-forming 2026-11-20: 12 captures)
//   ⭐ e93 (2026-11-21): so a cell's unset text colour is `color.black` in EVERY version
//   that draws one, a NAMED default (`NAMED_OBJECT_DEFAULTS.cell`), never a per-version row.
//   ⚰️ Witnessed for v5 only until then, v4 and v6 cells fell to the table renderer's fixed
//   `#D1D4DC` (`objectTableDom.js`), a light grey where TradingView draws near-black.
//
// ⛔ ONLY THE (version, slot) PAIRS A CAPTURE SHOWS. A v6 box's unset fill, a v4
// box's border are unwitnessed: they keep the base default
// (`objectRenderState.js::OBJECT_DEFAULTS`) until a capture says otherwise.
// ⛔ The hexes come from the palette authority (`pinePalette.js`) AT THAT
// VERSION, never typed here — `color.blue` is `#2196F3` in v4 and `#2962FF`
// from v5.
//
// Kept apart from `objectRenderState.js` so the translator can ask WHICH
// versions carry such defaults without importing the render state.

import { pineColourHex } from './pinePalette.js'

/** ⭐⭐ LEGACY SEMANTICS (B5, 2026-11-15) — EVERY DEFAULT COLOUR IS A PINE COLOUR NAME, resolved at
 *  the script's version through the one palette (`pinePalette.js`), never a hex typed here or in
 *  `objectRenderState.js::OBJECT_DEFAULTS`. Pine's reference states each default by NAME
 *  (`box.new`'s `border_color = color.blue`, `bgcolor = color.blue` at 80 transparency; `line.new` /
 *  `label.new`'s `color = color.blue`; `label.new`'s `textcolor = color.white`; `linefill.new`'s
 *  `color = color.blue` at 80), and the hex a name draws is the version's. ⚰️ `OBJECT_DEFAULTS` carried
 *  `#2962FF` (v5/v6 blue) for every version, so a v4 box with no `border_color` drew `#2962FF` where
 *  TradingView draws v4's `color.blue`, `#2196F3`: `inside-bar-boxes-rddt-1d-2026-11-14` (committed,
 *  //@version=4, 52 boxes, every border `#2196F3`, the script setting only `bgcolor`).
 *  `[name, opacity]`; `opacity` null is opaque. */
export const NAMED_OBJECT_DEFAULTS = Object.freeze({
  line: Object.freeze({ color: Object.freeze(['color.blue', null]) }),
  label: Object.freeze({ color: Object.freeze(['color.blue', null]), textcolor: Object.freeze(['color.white', null]) }),
  box: Object.freeze({ border_color: Object.freeze(['color.blue', null]), bgcolor: Object.freeze(['color.blue', 0.2]) }),
  linefill: Object.freeze({ color: Object.freeze(['color.blue', 0.2]) }),
  // `table.cell`'s `text_color = color.black`, witnessed in v4, v5 and v6 (the header)
  cell: Object.freeze({ text_color: Object.freeze(['color.black', null]) }),
})
/** The version an object program that states none is drawn at: the base (`pine.js` stamps
 *  `pineVersion` only for `VERSIONS_WITH_OBJECT_DEFAULTS`). */
export const BASE_OBJECT_VERSION = 6
/** The first version with drawing objects (`line` / `label` / `box` came with v4). */
export const FIRST_OBJECT_VERSION = 4

const rgbaOf = (hex, opacity) => {
  const n = parseInt(hex.slice(1, 7), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${opacity.toFixed(2)})`
}
const namedMemo = new Map()
/** `{family: {slot: colour}}` — `NAMED_OBJECT_DEFAULTS` at `pineVersion` (`#RRGGBB`, or `rgba(…)` where
 *  the default is translucent), the spelling `OBJECT_DEFAULTS` has always carried. */
export function namedObjectDefaults(pineVersion) {
  // Drawing objects exist from v4 on; any other version (v1-v3 cannot draw one, an unknown or a
  // future one has no witness) is drawn at the base, never at its own palette.
  const key = Number.isInteger(pineVersion) && pineVersion >= FIRST_OBJECT_VERSION
    && pineVersion <= BASE_OBJECT_VERSION ? pineVersion : BASE_OBJECT_VERSION
  const hit = namedMemo.get(key)
  if (hit) return hit
  const out = {}
  for (const [family, slots] of Object.entries(NAMED_OBJECT_DEFAULTS)) {
    const named = {}
    for (const [slot, [name, opacity]] of Object.entries(slots)) {
      const hex = pineColourHex(name, key)
      if (hex) named[slot] = opacity === null ? hex : rgbaOf(hex, opacity)
    }
    out[family] = Object.freeze(named)
  }
  const frozen = Object.freeze(out)
  namedMemo.set(key, frozen)
  return frozen
}

const VERSION_DEFAULTS = Object.freeze({
  4: Object.freeze({
    line: Object.freeze({ color: 'color.blue' }),
    label: Object.freeze({ color: 'color.blue', textcolor: 'color.black' }),
  }),
  5: Object.freeze({
    label: Object.freeze({ textcolor: 'color.black' }),
    box: Object.freeze({ bgcolor: 'color.blue', text_color: 'color.black' }),
    // (a cell's text colour is `color.black` in every version: `NAMED_OBJECT_DEFAULTS.cell`)
  }),
})

/** The versions whose defaults differ from the base — the only ones an object
 *  program needs to state (`pine.js` stamps `pineVersion` for exactly these). */
export const VERSIONS_WITH_OBJECT_DEFAULTS = Object.freeze(Object.keys(VERSION_DEFAULTS).map(Number))

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

// app/src/components/chart/engine/colorInt.js
//
// ─── THE COLORER INTEGER — `0xTTBBGGRR`, AND THE BYTE ORDER IS THE TRAP ─────
//
// A Pine `colorer` plot does not emit a colour. It emits a 32-bit INTEGER, and
// every drawing decision downstream depends on reading its bytes in the right
// order. TradingView packs it as:
//
//     0xTT BB GG RR      transparency, then BLUE, GREEN, RED
//                        ↑ NOT alpha, and NOT R-G-B
//
// ⛔⛔ READING THOSE THREE BYTES AS RGB PRODUCES A PLAUSIBLE COLOUR THAT IS WRONG.
// Measured on Uncharted Clouds: `226597128` = `0x0D819908`. Read as RGB the colour
// is `#819908`, a perfectly reasonable olive that renders without complaint and
// looks like a deliberate choice. Read correctly it is `#089981` — which is
// `color.teal`, a Pine palette constant. **That is the tell: the correct byte
// order lands exactly on named palette constants and the wrong one lands on
// nothing.** A renderer with the bytes reversed draws a chart that looks fine to
// everyone who has not seen the original.
//
// ⚠️ AND THE HIGH BYTE IS TRANSPARENCY, NOT ALPHA — they run in opposite
// directions. Pine's transparency is 0 = fully opaque, 100 = invisible; CSS alpha
// is 1 = opaque, 0 = invisible. Passing the byte straight into an `rgba()` alpha
// slot inverts every fade in the script.
//
// Provenance: docs/pine/render-rules.md rule 3, proven against
// tests/fixtures/vendor/reference/A/clouds-volume-spy-1d-250.csv.

/** The byte layout, named so a reader never has to count shifts. */
export const BYTE_ORDER = Object.freeze({ transparency: 24, blue: 16, green: 8, red: 0 })

/** Pine transparency is 0-100; the packed byte is 0-255. */
export const TRANSPARENCY_MAX = 100
export const BYTE_MAX = 255

/** ⭐⭐ C29 — THE TRANSPARENCY A PINE COLOUR HOLDS: a WHOLE number, TRUNCATED
 *  (measured, `vw-gradient-spy-1d-2026-09-30`: `color.new(c, 70.5)` and
 *  `(c, 70.4)` both hold 70). ONE authority for every lane. Snapped to 1e-9
 *  FIRST, so an arithmetic 19.999999999999996 (`(1 − 0.8) × 100`) is the 20 it
 *  names, never 19; a real fraction still truncates. Non-finite passes through. */
export function wholeTransparency(t) {
  const n = Number(t)
  if (!Number.isFinite(n)) return n
  return Math.trunc(Math.round(n * 1e9) / 1e9)
}

/** ⭐⭐ RT9 — WHAT `color.new` AND `color.rgb` MAKE OF AN `na` ARGUMENT, MEASURED.
 *
 *  Capture `vw-rt6-runtime-colour` (NYSE:RDDT 1D from the listing, 636 bars, and
 *  AMEX:SPY 1D, 1,800 bars, CAP3 2026-10-03), the same answer on every bar of both:
 *
 *    C03  `color.new(color(na), 40)`       → `#00000099`  an `na` BASE is black
 *    C04  `color.new(color.red, <na>)`     → `#ff525200`  an `na` TRANSPARENCY is 100
 *    C05  `color.rgb(<na>, 0, 0)`          → `#000000ff`  an `na` CHANNEL is 0
 *
 *  None of the three is Pine's `na` colour (a plot point TradingView hides, C06):
 *  each is a real colour the vendor's colorer records. ⛔ ONE AUTHORITY for every
 *  lane that folds or computes these two calls — the host plot fold
 *  (`pine.js::staticColourOf` / `colourHelperAlpha`), the host object runtime's
 *  `{c:'new'}` (`objectRuntime.js`) and the per-bar runtime lane
 *  (`runtime/colours.js`) — so the three cannot disagree about one colour.
 *  ⚠️ `color.rgb`'s FOURTH argument `na` has no witness and is not answered here. */
export const NA_BASE_RGB = Object.freeze({ r: 0, g: 0, b: 0 })
export const NA_BASE_HEX = '#000000'
export const NA_TRANSPARENCY = TRANSPARENCY_MAX
export const NA_CHANNEL = 0

/** `color.new`'s transparency argument as Pine holds it: `na` → 100 (C04). */
export function colorNewTransparency(t) {
  const n = Number(t)
  return Number.isNaN(n) ? NA_TRANSPARENCY : n
}

/** One `color.rgb` channel as Pine holds it: `na` → 0 (C05). */
export function colorRgbChannel(v) {
  const n = Number(v)
  return Number.isNaN(n) ? NA_CHANNEL : n
}

function requireInt(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) throw new Error(`colorer value is not a number: ${v}`)
  // >>> 0 both truncates and coerces to unsigned, which is what the packing is.
  return n >>> 0
}

/**
 * Unpack a colorer integer.
 *
 * @returns {{hex: string, r: number, g: number, b: number,
 *            transparencyByte: number, transparency: number, alpha: number}}
 *
 * `transparency` is Pine's 0-100 scale. `alpha` is the CSS 0-1 value, which is
 * its INVERSE — provided here so no call site has to remember to flip it.
 */
export function unpackColor(value) {
  const v = requireInt(value)
  const transparencyByte = (v >>> BYTE_ORDER.transparency) & 0xff
  const b = (v >>> BYTE_ORDER.blue) & 0xff
  const g = (v >>> BYTE_ORDER.green) & 0xff
  const r = (v >>> BYTE_ORDER.red) & 0xff
  const hex2 = (x) => x.toString(16).toUpperCase().padStart(2, '0')
  return {
    hex: `#${hex2(r)}${hex2(g)}${hex2(b)}`,
    r, g, b,
    transparencyByte,
    transparency: (transparencyByte / BYTE_MAX) * TRANSPARENCY_MAX,
    alpha: 1 - transparencyByte / BYTE_MAX,
  }
}

/** The CSS the renderer should actually paint with. */
export function toCss(value) {
  const c = unpackColor(value)
  return c.transparencyByte === 0
    ? c.hex
    : `rgba(${c.r}, ${c.g}, ${c.b}, ${Number(c.alpha.toFixed(4))})`
}

/**
 * Pack back to a colorer integer. Round-trips `unpackColor`.
 *
 * ⚠️ Exists so the round trip is TESTABLE, not because the renderer needs to
 * emit these — nothing downstream of us produces colorer values.
 */
export function packColor({ r = 0, g = 0, b = 0, transparencyByte = 0 } = {}) {
  const clamp = (x) => Math.min(Math.max(Math.trunc(Number(x) || 0), 0), 255)
  return (
    ((clamp(transparencyByte) << BYTE_ORDER.transparency) >>> 0) +
    ((clamp(b) << BYTE_ORDER.blue) >>> 0) +
    ((clamp(g) << BYTE_ORDER.green) >>> 0) +
    clamp(r)
  ) >>> 0
}

/**
 * The WRONG reading, exported on purpose.
 *
 * ⭐ A rail needs to be able to say "and here is what the bug produces". Keeping
 * the defect reachable by name means the test can assert the two DIFFER on real
 * captured data, rather than asserting only that the correct one is correct —
 * which passes just as happily when both are the same.
 */
export function unpackColorRgbOrder(value) {
  const v = requireInt(value)
  const hex2 = (x) => x.toString(16).toUpperCase().padStart(2, '0')
  return `#${hex2((v >>> 16) & 0xff)}${hex2((v >>> 8) & 0xff)}${hex2(v & 0xff)}`
}

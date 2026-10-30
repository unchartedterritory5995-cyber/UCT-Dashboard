// app/src/components/chart/engine/colorInt.js
//
// ─── THE COLORER INTEGER — BYTE ORDER `0x··BBGGRR`, AND TWO MEANINGS OF THE HIGH BYTE ─
//
// A Pine `colorer` plot does not emit a colour. It emits a 32-bit INTEGER, and
// every drawing decision downstream depends on reading its bytes in the right
// order. The three colour bytes run BLUE, GREEN, RED from high to low:
//
//     0x·· BB GG RR      ↑ NOT R-G-B
//
// ⛔⛔ READING THOSE THREE BYTES AS RGB PRODUCES A PLAUSIBLE COLOUR THAT IS WRONG.
// Measured on Uncharted Clouds: `226597128` = `0x0D819908`. Read as RGB the colour
// is `#819908`, a perfectly reasonable olive that renders without complaint and
// looks like a deliberate choice. Read correctly it is `#089981` — which is
// `color.teal`, a Pine palette constant. **That is the tell: the correct byte
// order lands exactly on named palette constants and the wrong one lands on
// nothing.**
//
// ⛔⛔ THE HIGH BYTE MEANS DIFFERENT THINGS IN THE TWO WORDS THIS FILE SEES.
//
//   • TRADINGVIEW'S word (a vendor capture's colorer column, an `input.color`
//     in a study title) is `0xAABBGGRR`: the high byte is OPACITY — 255 opaque,
//     0 invisible. Proven by the capture's own inputs: `color.teal` (opaque) is
//     `4,286,683,400` = `0xFF819908`, `color.new(color.white, 100)` is
//     `16,777,215` = `0x00FFFFFF`. Clouds' band 0 above, `0x0D…`, is 13/255 =
//     5% opaque — the script's `maxTransparency = 95`. Decode it with
//     `unpackVendorColor`.
//   • THIS ENGINE'S runtime word (`runtime/colours.js` packs it, `unpackColor`
//     reads it) keeps TRANSPARENCY in that byte, `255 − opacity`, so 0 is
//     opaque. That is an internal convention and every reader of it agrees.
//
// ⚰️ This header used to say TradingView's high byte was transparency, and its
// rail decoded the vendor capture with `unpackColor`: band 0 came out 95%
// OPAQUE and the Clouds fade read backwards ("fades AWAY from the fast MA").
// The hues were right, which is why nobody noticed. Passing either byte into an
// `rgba()` slot without knowing which word it came from inverts every fade.
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
 *  names, never 19; a real fraction still truncates. Non-finite passes through.
 *  ⚠️ C29 measured what `color.t` READS BACK, not what a colour PAINTS: Uncharted
 *  Clouds' `color.new(c, 87.5)` paints alpha 32 on TradingView (exact t), not the
 *  33 a truncated 87 would give. The columnar plot/fill lane paints the exact float
 *  (`pine.js::colourHelperAlpha`); the runtime lane's packed word still holds a
 *  whole transparency (`runtime/colours.js::pineTransparency`). */
export function wholeTransparency(t) {
  const n = Number(t)
  if (!Number.isFinite(n)) return n
  return Math.trunc(Math.round(n * 1e9) / 1e9)
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

/**
 * Unpack a TRADINGVIEW colour integer, `0xAABBGGRR` — the high byte is OPACITY.
 * This is the decoder for vendor captures; `unpackColor` is the engine's own word.
 *
 * @returns {{hex: string, r: number, g: number, b: number, alphaByte: number, alpha: number}}
 */
export function unpackVendorColor(value) {
  const v = requireInt(value)
  const alphaByte = (v >>> 24) & 0xff
  const b = (v >>> BYTE_ORDER.blue) & 0xff
  const g = (v >>> BYTE_ORDER.green) & 0xff
  const r = (v >>> BYTE_ORDER.red) & 0xff
  const hex2 = (x) => x.toString(16).toUpperCase().padStart(2, '0')
  return { hex: `#${hex2(r)}${hex2(g)}${hex2(b)}`, r, g, b, alphaByte, alpha: alphaByte / BYTE_MAX }
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

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

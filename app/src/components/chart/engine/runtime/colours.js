// app/src/components/chart/engine/runtime/colours.js
//
// ─── ⭐⭐ A COLOUR IS A VALUE HERE, AND IT IS AN INTEGER ─────────────────────
//
// `bgcolor`, `barcolor` and `fill` all refused for one reason and it was the
// same reason: a colour is not something this lane could hold. The columnar
// lane refuses one by name at `pine:colour-value` — correctly, because you
// cannot SCREEN on a colour, and that lane exists to produce screenable
// columns. This lane computes bar-by-bar values for DRAWING, where a colour is
// exactly as much a value as a price is.
//
// ⭐ AND IT IS ALREADY AN INTEGER EVERYWHERE ELSE IN THIS ENGINE. `colorInt.js`
// opens with *"A Pine `colorer` plot does not emit a colour. It emits a 32-bit
// INTEGER"* — `0xTTBBGGRR`, transparency then BLUE, GREEN, RED. So a colour
// needs no new carrier in the VM: it rides the numeric stack like any other
// number. What it needs is a KIND, so it cannot be mistaken for a price.
//
// ⛔⛔ THE BYTE ORDER IS THE TRAP AND IT IS NOT MINE TO RESTATE. Everything here
// packs through `colorInt.packColor`, whose header records why reading those
// three bytes as RGB produces a plausible colour that is wrong — `0x0D819908`
// read as RGB is a perfectly reasonable olive, and read correctly is
// `color.teal`. A second packer in this file would be a second chance to get
// that backwards.
//
// ⚠️ `packColor` CARRIED A NOTE SAYING *"nothing downstream of us produces
// colorer values"*, and this module is the first thing that does. It is no
// longer test-only scaffolding; it is load-bearing. Said here because the note
// is in a file whose author could not have known.
//
// ⚠️ THE HALF-STEP ROUNDING IS UNMEASURED. Pine's transparency is 0-100 and the
// packed byte is 0-255, so 50 lands on 127.5. This rounds, which makes it the
// exact inverse of `unpackColor`'s `(byte / 255) * 100` — the convention this
// repo already renders with. What TradingView itself does at the half-step has
// not been observed on a chart. It is a difference of 1/255 in alpha, invisible
// to a member and visible to a byte-for-byte vendor comparison, so it is
// recorded rather than presented as measured.
import { packColor, unpackColor, wholeTransparency, TRANSPARENCY_MAX, BYTE_MAX } from '../colorInt.js'

/** Thrown for a colour a member could have written differently. */
export class ColourError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ColourError'
  }
}

/** Pine transparency (0-100) → the packed byte (0-255). */
export function transparencyToByte(t) {
  const n = Number(t)
  if (!Number.isFinite(n)) return 0
  const clamped = Math.min(Math.max(n, 0), TRANSPARENCY_MAX)
  // ⭐⭐ C29 — THE BYTE IS THE COMPLEMENT OF TRADINGVIEW'S OPACITY BYTE, not a
  // rounding of its own. The vendor's packed colour is 0xAABBGGRR with opacity
  // `round((1 − t/100) × 255)` (measured: `color.new(c, 70)` → 0x4D = 77); this
  // lane's word keeps TRANSPARENCY in that byte (`colorInt.js`), so it stores
  // `255 − opacity` and every reader recovers the vendor's opacity EXACTLY
  // (`255 − byte`). ⚰️ It was `round(t × 2.55)` — 179 for t = 70, whose
  // complement 76 is not the vendor's 77 (C20's "served opaque only").
  return BYTE_MAX - Math.round((1 - clamped / TRANSPARENCY_MAX) * BYTE_MAX)
}

/** ⭐⭐ C29 (C20, measured 2026-09-30, `vw-gradient-spy-1d-2026-09-30.json`) —
 *  THE TRANSPARENCY A PINE COLOUR HOLDS IS A WHOLE NUMBER, TRUNCATED:
 *  `color.t(color.new(c, 70.5))` reads 70, and so does 70.4. So a fractional
 *  transparency is truncated BEFORE it is packed, which also keeps every byte
 *  this lane packs an exact image of a whole transparency (`byteTransparency`
 *  inverts it). `na` / non-finite stays as `transparencyToByte` reads it. */
export function pineTransparency(t) {
  const n = Number(t)
  return wholeTransparency(n)
}

/** The whole transparency a packed byte of THIS lane holds (the inverse of
 *  `transparencyToByte` over whole numbers). */
export function byteTransparency(byte) {
  return Math.round((Number(byte) / BYTE_MAX) * TRANSPARENCY_MAX)
}

/** ⭐⭐ C29 — `color.from_gradient(value, bottom, top, a, b)`, as MEASURED on the
 *  vendor (`vw-gradient-spy-1d-2026-09-30.json`): the position `w = (value −
 *  bottom) / (top − bottom)` CLAMPED to [0, 1] (w < 0 is endpoint `a`, w > 1 is
 *  `b`), then red, green, blue AND transparency each interpolated LINEARLY and
 *  TRUNCATED to a whole number (v = 0.5: 127.5 → 127; v = 0.01: 2.55 → 2,
 *  99.5 → 99, 198.5 → 198; transparency 0 → 100 reads 100·v). Answers null for
 *  what no capture pins (an `na` value or bound, `top == bottom`). */
export function fromGradient(value, bottom, top, a, b) {
  const v = Number(value), lo = Number(bottom), hi = Number(top)
  if (![v, lo, hi].every(Number.isFinite) || hi === lo) return null
  const w = Math.min(1, Math.max(0, (v - lo) / (hi - lo)))
  const A = unpackColor(Number(a) >>> 0)
  const B = unpackColor(Number(b) >>> 0)
  // ⭐⭐ THE OPACITY BYTES BLEND, AND THE CHANNELS BLEND PREMULTIPLIED BY THEM,
  // then divide by the blended opacity; the result's opacity byte is that blend
  // TRUNCATED. The ONE model (of the dozens tried, each scored bar for bar) that
  // reproduces all 300 bars of every gradient the probe asks — the float cases
  // (`v = 0.04`: b 193, not 194), the packed colorer (`0x4C…` where both ends are
  // `0x4D`: 77 × (1 − w) + 77 × w is 76.99…), a transparency sweep (`t` 29 at
  // v = 0.29), and a fully transparent end (`g4`: r 40 at v = 0.95, 0 at v = 1,
  // where the blended opacity is zero).
  const opA = BYTE_MAX - A.transparencyByte
  const opB = BYTE_MAX - B.transparencyByte
  const opO = opA * (1 - w) + opB * w
  const aA = opA / BYTE_MAX
  const aB = opB / BYTE_MAX
  const aO = opO / BYTE_MAX
  const ch = (x, y) => (aO === 0 ? 0 : Math.trunc((x * aA * (1 - w) + y * aB * w) / aO))
  return packColor({
    r: ch(A.r, B.r), g: ch(A.g, B.g), b: ch(A.b, B.b),
    transparencyByte: BYTE_MAX - Math.trunc(opO),
  })
}

/** `#RRGGBB` (or `#RGB`) + a Pine transparency → the colorer integer. */
export function hexToPacked(hex, transparency = 0) {
  const s = String(hex || '').replace('#', '')
  const full = s.length === 3 ? s.split('').map((c) => c + c).join('') : s
  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    throw new ColourError(`not a colour this engine can read: \`${hex}\``)
  }
  return packColor({
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
    transparencyByte: transparencyToByte(pineTransparency(transparency)),
  })
}

/** Replace a packed colour's transparency, keeping its red, green and blue.
 *
 *  ⛔ THE THREE COLOUR BYTES ARE CARRIED THROUGH UNTOUCHED rather than unpacked
 *  and repacked. `color.new(c, t)` changes exactly one byte, and a round trip
 *  through a hex string is three more chances to reorder them. */
function withTransparency(packed, transparency) {
  const v = Number(packed) >>> 0
  const byte = transparencyToByte(pineTransparency(transparency))
  return (((byte << 24) >>> 0) + (v & 0x00ffffff)) >>> 0
}

/** ⭐ THE TWO COLOUR PRODUCERS REAL SCRIPTS WRITE.
 *
 *  Measured across the 266-script committed corpus — scripts using each call:
 *
 *      color.new            161
 *      color.rgb             47
 *      color.from_gradient   21      ← NOT served; see below
 *      color.t / .r / .g / .b  4,1,1,1
 *
 *  A table built for calls nobody makes reads as support in every summary while
 *  serving no one, so this holds the two that carry the demand.
 *
 *  ⚠️ `color.from_gradient` IS THE NEXT ONE AND IS DELIBERATELY ABSENT. It maps
 *  a value through a two-colour ramp, which is interpolation rather than
 *  packing, and TradingView's own interpolation curve has not been observed —
 *  guessing it would put a colour on screen that is close enough to look right
 *  and wrong enough to be a different colour from the vendor's. Named here so
 *  it is a known gap rather than a discovery.
 *
 *  ⛔ `args` IS DECLARED PER ENTRY, and the VM checks kinds from the entry's own
 *  declaration rather than each function checking for itself — the rule
 *  `text.js` states and for the same reason: hand-written checks drift, and the
 *  one that drifts is the one nobody reads again.
 */
export const COLOUR_FNS = Object.freeze({
  // `color.new(base, transp)` — base is already a packed colour.
  // ⛔ THE DECLARED KINDS ARE THE VM'S VOCABULARY, WHICH HAS NO `colour`.
  // At run time a colour IS a number — a packed `0xTTBBGGRR` integer — and
  // `kindOf` can only answer number/string/array. Whether the number in a
  // colour slot is a COLOUR rather than a price is a compile-time question, and
  // it is the FRONT END's to police, exactly as a typed array's element type
  // is (`vm.js`: *"a typed array's element type is the FRONT END's to police,
  // not the VM's"*). Declaring `colour` here would make every correct call fail
  // the VM's kind check.
  'color.new': {
    args: ['number', 'number'], returns: 'colour', minArgs: 2, maxArgs: 2,
    fn: (a) => withTransparency(a[0], a[1]),
  },
  // `color.rgb(r, g, b, transp = 0)` — three channels, Pine's own order.
  'color.rgb': {
    args: ['number', 'number', 'number', 'number'],
    returns: 'colour',
    minArgs: 3,
    maxArgs: 4,
    fn: (a) => packColor({
      r: a[0], g: a[1], b: a[2], transparencyByte: transparencyToByte(pineTransparency(a.length > 3 ? a[3] : 0)),
    }),
  },
  // ⭐⭐ C18 — `color.from_gradient(value, bottom, top, bottomColour, topColour)`
  // COMPILES, and its colour is NEVER invented. TradingView's interpolation curve
  // is still unmeasured (the note above), so without a caller's probe the run
  // stops here by name, exactly as before. With one
  // (`collections.js::probedEmpty` — `budget.unmeasured`) it answers the PROBE
  // colour and records the hit: the caller runs twice at two probes and serves
  // only what did not move, so a gradient that feeds nothing but a drawing
  // (max-pain's heatmap boxes, which the object program holds) costs nothing,
  // and one that reaches a served value withholds it.
  'color.from_gradient': {
    args: ['number', 'number', 'number', 'number', 'number'],
    returns: 'colour',
    minArgs: 5,
    maxArgs: 5,
    // ⭐⭐ C29 — COMPUTED, the vendor's curve (`fromGradient`). Only what no
    // capture pins — an `na` value or bound, an empty range — keeps the old
    // unmeasured path: the probe colour where the caller probes, else a stop by name.
    fn: (a, budget) => {
      const c = fromGradient(a[0], a[1], a[2], a[3], a[4])
      if (c !== null) return c
      const u = budget && budget.unmeasured
      if (!u) {
        throw new ColourError('`color.from_gradient` with an `na` value or an empty range — '
          + 'unmeasured, and a colour is never invented')
      }
      u.hits.push('color.from_gradient')
      return u.colourProbe
    },
  },
})

export const COLOUR_NAMES = Object.freeze(Object.keys(COLOUR_FNS))

/** Does this builtin PRODUCE a colour? */
export const producesColour = (name) => (
  Object.prototype.hasOwnProperty.call(COLOUR_FNS, name)
  && COLOUR_FNS[name].returns === 'colour')

/** The declared kind of one operand, for the VM's single check site. */
export const colourArgKind = (spec, i) => {
  const declared = spec.args[i]
  return declared === undefined ? spec.args[spec.args.length - 1] : declared
}

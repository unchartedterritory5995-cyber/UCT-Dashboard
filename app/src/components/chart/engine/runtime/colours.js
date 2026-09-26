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
import { packColor, TRANSPARENCY_MAX, BYTE_MAX } from '../colorInt.js'

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
  return Math.round((clamped / TRANSPARENCY_MAX) * BYTE_MAX)
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
    transparencyByte: transparencyToByte(transparency),
  })
}

/** Replace a packed colour's transparency, keeping its red, green and blue.
 *
 *  ⛔ THE THREE COLOUR BYTES ARE CARRIED THROUGH UNTOUCHED rather than unpacked
 *  and repacked. `color.new(c, t)` changes exactly one byte, and a round trip
 *  through a hex string is three more chances to reorder them. */
function withTransparency(packed, transparency) {
  const v = Number(packed) >>> 0
  const byte = transparencyToByte(transparency)
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
      r: a[0], g: a[1], b: a[2], transparencyByte: transparencyToByte(a.length > 3 ? a[3] : 0),
    }),
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

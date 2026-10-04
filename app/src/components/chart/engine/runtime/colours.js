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
import {
  packColor, unpackColor, wholeTransparency, TRANSPARENCY_MAX, BYTE_MAX,
  colorNewTransparency, colorRgbChannel,
} from '../colorInt.js'

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

/** ⭐⭐ C48 — THE COLOUR A DEGENERATE GRADIENT HOLDS: red 0, blue 0,
 *  transparency 100 on every bar, whatever the value — a NUMBER, never `na`.
 *  Capture `vw-colour-components-spy-1d-2026-10-01`, rows E01–E03 (`top ==
 *  bottom`), X01 / X02 (an `na` bound), X03 / X04 (an `na` value), 300 / 300
 *  each. ⚠️ Green is not a row of the probe; it is 0 here as the other two
 *  channels are. */
export const GRADIENT_ZERO_COLOUR = packColor({ r: 0, g: 0, b: 0, transparencyByte: BYTE_MAX })

/** ⭐⭐ C29 — `color.from_gradient(value, bottom, top, a, b)`, as MEASURED on the
 *  vendor (`vw-gradient-spy-1d-2026-09-30.json`): the position `w = (value −
 *  bottom) / (top − bottom)` CLAMPED to [0, 1] (w < 0 is endpoint `a`, w > 1 is
 *  `b`), then red, green, blue AND transparency each interpolated LINEARLY and
 *  TRUNCATED to a whole number (v = 0.5: 127.5 → 127; v = 0.01: 2.55 → 2,
 *  99.5 → 99, 198.5 → 198; transparency 0 → 100 reads 100·v).
 *  ⭐⭐ C48 — the edges `vw-colour-components-spy-1d-2026-10-01` measured:
 *    · an `na` value or bound, or `top == bottom` → `GRADIENT_ZERO_COLOUR`;
 *    · `top < bottom` (rows E04 / E05, bounds 1 → 0, `v` sweeping 0 … 1) → the
 *      BOTTOM colour at every value between the two bounds — not the mirrored
 *      blend this function used to answer.
 *  Answers null for what no capture pins: a value outside reversed bounds, an
 *  infinite value or bound. */
export function fromGradient(value, bottom, top, a, b) {
  const v = Number(value), lo = Number(bottom), hi = Number(top)
  if (Number.isNaN(v) || Number.isNaN(lo) || Number.isNaN(hi)) return GRADIENT_ZERO_COLOUR
  if (![v, lo, hi].every(Number.isFinite)) return null
  if (hi === lo) return GRADIENT_ZERO_COLOUR
  if (hi < lo) return v >= hi && v <= lo ? (Number(a) >>> 0) : null
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

/** ⭐⭐ C38 — `fromGradient`, WRITTEN AS A CANONICAL TREE, one component of it.
 *
 *  The columnar lane cannot call a function per bar; it evaluates a tree. So the
 *  component a script PLOTS (`plot(color.r(color.from_gradient(…)))`) is this:
 *  the arithmetic above, node for node and in the SAME ORDER, so both lanes give
 *  the same double on every bar. `value` is the gradient's value as a canonical
 *  tree; `lo` / `hi` are numbers (two different finite ones — the caller refuses
 *  anything else); `a` / `b` are packed colours.
 *
 *  ⛔⛔ THIS IS A SECOND SPELLING OF ONE FORMULA, AND IT IS RAILED AS ONE:
 *  `colourComponents.test.js` evaluates this tree and `fromGradient` over a
 *  dense sweep and requires the same number on every point, and
 *  `vendorHarness.c38ColourValue.test.js` grades it against the vendor's 300
 *  bars. Change either spelling alone and both go red. `floor` stands for
 *  `Math.trunc` (every quantity here is ≥ 0) and `round` is
 *  `byteTransparency`'s.
 *
 *  ⭐⭐ C48 — the edges, as `fromGradient` holds them (same capture, same rows):
 *  `lo` / `hi` may each be a NUMBER (a bound the script wrote) or a canonical
 *  TREE (a per-bar bound — rows B01–B04, `low` … `high` at `close`). A bar whose
 *  value or bound is `na`, or whose bounds are equal, holds the zero colour's
 *  component; reversed bounds hold the bottom colour's between them and are
 *  not computable outside them. ⛔ Two numeric bounds in order keep the tree
 *  they always had, wrapped in ONE test for an `na` value. */
export function gradientChannelTree({ value, lo, hi, a, b }, channel) {
  const op = (name, args) => ({ type: 'op', name, args })
  const call = (name, args) => ({ type: 'call', name, args })
  // a negative literal is `u-` of a positive one — the canonical spelling
  const num = (v) => (v < 0 ? op('u-', [{ type: 'num', value: -v }]) : { type: 'num', value: v })
  const A = unpackColor(Number(a) >>> 0)
  const B = unpackColor(Number(b) >>> 0)
  const NA = op('/', [num(0), num(0)])
  /** The zero colour's component, and the bottom colour's — as numbers. */
  const zero = num(channel === 't' ? TRANSPARENCY_MAX : 0)
  const bottom = num(channel === 't' ? byteTransparency(A.transparencyByte) : A[channel])
  const isNumber = (x) => typeof x === 'number'
  const tree = (x) => (isNumber(x) ? num(x) : x)
  /** The blend itself, for bounds in order — `fromGradient`'s arithmetic. */
  const blend = () => {
    // `(value − lo) / (hi − lo)`; `x − 0` and `x / 1` are `x` exactly, so they are not written
    const above = lo === 0 ? value : op('-', [value, tree(lo)])
    const span = isNumber(lo) && isNumber(hi) ? hi - lo : op('-', [hi, tree(lo)])
    const w = call('min', [num(1), call('max', [num(0), span === 1 ? above : op('/', [above, tree(span)])])])
    const rest = op('-', [num(1), w])
    const opA = BYTE_MAX - A.transparencyByte
    const opB = BYTE_MAX - B.transparencyByte
    const opO = op('+', [op('*', [num(opA), rest]), op('*', [num(opB), w])])
    if (channel === 't') {
      // `byteTransparency(BYTE_MAX − trunc(opO))`
      return call('round', [op('*', [
        op('/', [op('-', [num(BYTE_MAX), call('floor', [opO])]), num(BYTE_MAX)]), num(TRANSPARENCY_MAX)])])
    }
    const aA = opA / BYTE_MAX
    const aB = opB / BYTE_MAX
    const aO = op('/', [opO, num(BYTE_MAX)])
    const mixed = op('+', [op('*', [num(A[channel] * aA), rest]), op('*', [num(B[channel] * aB), w])])
    return op('?:', [op('==', [aO, num(0)]), num(0), call('floor', [op('/', [mixed, aO])])])
  }
  /** `x == x` is false exactly for `na`. */
  const known = (x) => op('==', [x, x])
  /** Reversed bounds: the bottom colour between them, not computable outside. */
  const reversed = () => op('?:', [op('&&', [op('>=', [value, tree(hi)]), op('<=', [value, tree(lo)])]), bottom, NA])
  if (isNumber(lo) && isNumber(hi)) {
    // an `na` or EQUAL pair of written bounds: the zero colour on every bar
    if (Number.isNaN(lo) || Number.isNaN(hi) || lo === hi) return zero
    return op('?:', [known(value), hi > lo ? blend() : reversed(), zero])
  }
  // a per-bar bound: which case a bar is in is read on the bar
  const L = tree(lo)
  const H = tree(hi)
  const ordered = op('&&', [op('>', [H, L]), known(value)])
  const crossed = op('&&', [op('<', [H, L]), known(value)])
  return op('?:', [ordered, blend(), op('?:', [crossed, reversed(), zero])])
}

/** ⭐⭐ C37 — THE OBJECT LANE'S COLOUR STRING ⇄ THE PACKED INTEGER.
 *
 *  A drawing's colour is ONE string — `#RRGGBB`, or `#RRGGBBAA` whose last byte
 *  is TradingView's OPACITY (`objectProgram.js::withObjectTransparency`). The
 *  gradient blends packed integers whose top byte is the opacity's COMPLEMENT
 *  (`transparencyToByte`). These two are that conversion, in both directions,
 *  for every caller that hands a static endpoint to `fromGradient` or reads its
 *  result back (the object runtime's `{c:'grad'}`, the plot pool's gradient).
 *  Byte-exact both ways: an opacity byte is never routed through a 0-100
 *  transparency, which would lose it (`0x4C` has no whole transparency).
 *  `null` for anything that is not such a string — a theme reference, a CSS
 *  name — so a caller holds the colour rather than blending a guess. */
export function objectHexToPacked(hex) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/i.exec(String(hex ?? ''))
  if (!m) return null
  return packColor({
    r: parseInt(m[1], 16),
    g: parseInt(m[2], 16),
    b: parseInt(m[3], 16),
    transparencyByte: m[4] === undefined ? 0 : BYTE_MAX - parseInt(m[4], 16),
  })
}

export function packedToObjectHex(packed) {
  // `Number.isInteger` is false for everything that is not a number (`null`, a
  // string), so the gradient's own "unmeasured" answer (`null`) stays `null`.
  if (!Number.isInteger(packed) || packed < 0 || packed > 0xffffffff) return null
  const v = packed
  const u = unpackColor(v)
  if (u.transparencyByte === 0) return u.hex
  return u.hex + (BYTE_MAX - u.transparencyByte).toString(16).padStart(2, '0').toUpperCase()
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
  // ⚰️ RT6 made an `na` operand answer `na` (no colour), unwitnessed at the time.
  // ⭐⭐ RT9 — CAP3 WITNESSED ALL THREE EDGES (`vw-rt6-runtime-colour`, RDDT and SPY
  // 1D, every bar), and none of them is `na`: `color.new(na, 40)` is `#00000099`
  // (an `na` base is black), `color.new(color.red, na)` is `#ff525200` (an `na`
  // transparency is 100), `color.rgb(na, 0, 0)` is `#000000ff` (an `na` channel is
  // 0). The rule lives in `colorInt.js` (`NA_BASE_RGB`, `colorNewTransparency`,
  // `colorRgbChannel`), shared with the host lane's fold, never restated here.
  // ⛔ `color.rgb`'s fourth argument `na` has no witness: it still answers `na`.
  'color.new': {
    args: ['number', 'number'], returns: 'colour', minArgs: 2, maxArgs: 2,
    // ⭐ An `na` base needs no branch: `withTransparency` keeps the base's three
    // colour bytes, and NaN reads as 0 there — black, the witnessed answer. A
    // separate branch for it was mutation-tested and changed nothing (RT9).
    fn: (a) => withTransparency(a[0], colorNewTransparency(a[1])),
  },
  // `color.rgb(r, g, b, transp = 0)` — three channels, Pine's own order.
  'color.rgb': {
    args: ['number', 'number', 'number', 'number'],
    returns: 'colour',
    minArgs: 3,
    maxArgs: 4,
    fn: (a) => (a.length > 3 && Number.isNaN(Number(a[3])) ? NaN : packColor({
      r: colorRgbChannel(a[0]), g: colorRgbChannel(a[1]), b: colorRgbChannel(a[2]),
      transparencyByte: transparencyToByte(pineTransparency(a.length > 3 ? a[3] : 0)),
    })),
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
      // ⭐ F8 — a caller probing only some unmeasured values (the runtime pane:
      // `array.sum` / `array.avg`) keeps this stop.
      if (!u || (Array.isArray(u.only) && !u.only.includes('color.from_gradient'))) {
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

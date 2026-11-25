// tools/vendor_harness/compare.mjs
//
// ─── THE COMPARATOR: vendor plots → our columns, bar by bar ───────────────────
//
// Input: a v1 capture (schema.mjs) and OUR SIDE — what the member door produced
// when handed the vendor's own bars (built by the vitest-side runner, which
// is the only place the engine can be imported). Output: one verdict per plot
// and one per capture, each exactly one of
//
//     MATCH         every compared bar agrees, and at least one bar was compared
//     DIVERGE       at least one steady-state bar disagrees — MEASURED, with the
//                   first divergent bar and both readings
//     INCONCLUSIVE  could not compare — unmapped plot, refused script, missing
//                   bars, a broken receipt. Never folded into either of the two
//                   above, because "we could not tell" and "it is right" are
//                   different facts and a member acts on the second.
//     MATCH_SUBSTITUTED  (L7, 2026-11-14) everything agrees, but our side ran with
//                   one or more SUBSTITUTED inputs (a vendor-only fact the member
//                   door answers from UCT data: `syminfo.industry` from our
//                   classification, a seed with no public mirror) and was FED the
//                   vendor's own value of each, read off the capture. It proves the
//                   translation; it does NOT prove the UCT value a member is served.
//                   ⛔ ITS OWN BUCKET: never MATCH, never folded into MATCH by any
//                   consumer (coverage map, evidence ledger, capability admission).
//
// ⛔ PURE. No engine import, no filesystem. The same function grades a real
// capture and a perturbed copy of it, which is what makes the controls in the
// test file mean something.

// ── TOLERANCE POLICY ─────────────────────────────────────────────────────────
//
// ⛔ EXACT for na-ness: a value on one side and `na` on the other is a
// divergence at ANY magnitude. A warm-up that ends one bar early is precisely
// the defect this harness exists to see, and a tolerance cannot express it.
//
// ⛔ EXACT for colour: a palette index is an integer and a colour is a hex; there
// is no "close enough" red.
//
// Floats: a pair AGREES when |ours − vendor| ≤ ABS  OR  |ours − vendor| ≤ REL·|vendor|.
//
//   REL = 1e-9. The owner's ruling for this exact question (seriesCompare.js,
//         T5, 2026-09-12: "floats max rel ≤ 1e-9"). Both sides are IEEE doubles
//         running the same arithmetic on the same bars; what can legitimately
//         differ is ORDER of operations (a running sum against a re-summed
//         window), which costs ~1e-15 per operation and stays far below 1e-9
//         even across thousands of bars. A maths difference — a seed, a
//         denominator, an off-by-one window — is orders of magnitude above it.
//
//   ABS = 1e-6 / pricescale ("a millionth of the symbol's tick"). Relative
//         error is meaningless at zero (a MACD histogram crossing zero reads
//         5e-15 on one side and 0 on the other), so a floor is needed there and
//         ONLY there. The symbol's own tick is the natural unit: TradingView
//         cannot display anything finer than 1/pricescale, so 1e-6 of it is six
//         orders of magnitude below any difference a member could ever see, and
//         still ~7 orders above double noise at price magnitudes. It is never
//         the thing that decides a price-sized value — REL is.
//         pricescale unknown ⇒ ABS = 1e-12 (the double-noise floor), stated on
//         the verdict rather than guessed.
//
//   A LEGACY capture that recorded rounded values declares `readDecimals`; the
//   floor then becomes half a unit in that last place, because that is the
//   vendor's own display precision and the README's rule is "the tolerance in an
//   observation states the vendor's own display precision, and nothing else".
//   ⛔ NEVER WIDEN THESE TO MAKE A DELTA GO AWAY.
import { isFillTarget } from './schema.mjs'
import { startsAtBar0Holds } from './history_claim.mjs'

export const REL_TOL = 1e-9
export const ABS_TICK_FRACTION = 1e-6
export const ABS_FLOOR_UNKNOWN_SCALE = 1e-12

export const VERDICTS = Object.freeze(['MATCH', 'MATCH_SUBSTITUTED', 'DIVERGE', 'INCONCLUSIVE'])
export const MATCH_SUBSTITUTED = 'MATCH_SUBSTITUTED'

// ── L7: SUBSTITUTED INPUTS (owner ruling 2026-11-14, option (a)) ─────────────
//
// THE CONTRACT our side (`ourSide.js::runOurSide`) fills, on its result:
//
//   substituted: [{ name, source, vendorValueFrom, value }]
//     name             the Pine name the door answers from UCT data, e.g. 'syminfo.industry'
//     source           where the MEMBER's value comes from (what the door discloses as
//                      "UCT data"), e.g. 'uct:ticker_meta'
//     vendorValueFrom  where the value our side was FED for this grade came from:
//                        'capture.<dotted path>'  a field of this capture (verified here:
//                                                 it must resolve, and equal `value`);
//                        'committed:<repo path>'  a committed capture our side's own
//                                                 supply read (the C26 other-symbol path,
//                                                 for a seed series); stated by our side,
//                                                 not re-read here (this file is pure)
//     value            the value our side was fed (required for a 'capture.' source)
//
// ⛔ An entry that was NOT fed the vendor's value (no `vendorValueFrom`, an unresolvable
// path, a fed value that is not the capture's) grades INCONCLUSIVE: a grade over UCT
// data cannot tell an engine defect from a data difference, so it proves nothing.
// An empty or absent list is the run every capture had before L7: plain MATCH.
export const SUBSTITUTED_FROM_CAPTURE = 'capture.'
export const SUBSTITUTED_FROM_COMMITTED = 'committed:'

/** The vendor's value at `vendorValueFrom` ('capture.<dotted path>') on this capture:
 *  `{found, value}`. The ONE resolver: our side feeds with it, the comparator checks with it. */
export function vendorValueOf(capture, vendorValueFrom) {
  if (typeof vendorValueFrom !== 'string' || !vendorValueFrom.startsWith(SUBSTITUTED_FROM_CAPTURE)) return { found: false, value: undefined }
  let cur = capture
  for (const k of vendorValueFrom.slice(SUBSTITUTED_FROM_CAPTURE.length).split('.')) {
    if (!k || cur === null || typeof cur !== 'object' || !Object.prototype.hasOwnProperty.call(cur, k)) return { found: false, value: undefined }
    cur = cur[k]
  }
  return cur === undefined ? { found: false, value: undefined } : { found: true, value: cur }
}

/** Why our side's `substituted` declaration cannot stand behind a grade, or [] when it can. */
export function substitutionProblems(capture, substituted) {
  if (substituted === undefined || substituted === null) return []
  if (!Array.isArray(substituted)) return ["our side's `substituted` is not a list"]
  const out = []
  const seen = new Set()
  for (const e of substituted) {
    const name = e && typeof e.name === 'string' && e.name ? e.name : null
    if (!name) { out.push('a substituted input names no `name`'); continue }
    if (seen.has(name)) out.push(`substituted input ${name} is declared twice`)
    seen.add(name)
    if (typeof e.source !== 'string' || !e.source) out.push(`substituted input ${name} names no \`source\` (the UCT data a member is served)`)
    const from = e.vendorValueFrom
    if (typeof from !== 'string' || !from) {
      out.push(`substituted input ${name} was not fed the vendor's value (no \`vendorValueFrom\`): a grade over UCT data proves nothing about the engine`)
    } else if (from.startsWith(SUBSTITUTED_FROM_CAPTURE)) {
      const got = vendorValueOf(capture, from)
      if (!got.found) out.push(`substituted input ${name}: the vendor's value is not on this capture (${from})`)
      else if (!Object.prototype.hasOwnProperty.call(e, 'value')) out.push(`substituted input ${name} does not say what our side was fed`)
      else if (JSON.stringify(e.value) !== JSON.stringify(got.value)) out.push(`substituted input ${name}: our side was fed ${JSON.stringify(e.value)}, not the vendor's ${JSON.stringify(got.value)} (${from})`)
    } else if (!(from.startsWith(SUBSTITUTED_FROM_COMMITTED) && from.length > SUBSTITUTED_FROM_COMMITTED.length)) {
      out.push(`substituted input ${name}: vendorValueFrom ${JSON.stringify(from)} is neither 'capture.<path>' nor 'committed:<path>'`)
    }
  }
  return out
}

/** The record a substituted grade carries: which inputs, the UCT source a member is served,
 *  and where the vendor value the grade was fed came from. (The fed VALUE is not carried: a
 *  seed series is a column, and the ledger never files bulk.) */
export function substitutedRecord(substituted) {
  return substituted.map((e) => ({
    name: e.name, source: e.source, vendorValueFrom: e.vendorValueFrom,
    checked: e.vendorValueFrom.startsWith(SUBSTITUTED_FROM_CAPTURE) ? 'by the comparator, against the capture' : 'stated by our side (a committed capture it supplied)',
  }))
}

/** MATCH -> MATCH_SUBSTITUTED; every other verdict unchanged. ⛔ The only place the new
 *  bucket is minted, so it can never be minted from a DIVERGE or an INCONCLUSIVE. */
const asSubstituted = (v) => (v === 'MATCH' ? MATCH_SUBSTITUTED : v)

export function tolerancePolicy(capture) {
  const ps = Number(capture && capture.symbol && capture.symbol.pricescale)
  const declared = capture && capture.tolerance && Number.isInteger(capture.tolerance.readDecimals)
    ? capture.tolerance.readDecimals : null
  let abs
  let absReason
  if (Number.isFinite(ps) && ps > 0) {
    abs = ABS_TICK_FRACTION / ps
    absReason = `1e-6 of the tick (pricescale ${ps})`
  } else {
    abs = ABS_FLOOR_UNKNOWN_SCALE
    absReason = 'pricescale unknown — double-noise floor 1e-12'
  }
  if (declared !== null) {
    // ⛔ `0.5 / 10 ** d`, not `0.5 * 10 ** -d`: a NEGATIVE exponent is not correctly
    // rounded on every engine (V8 in Node 20, CI's Node: `10 ** -4` = 0.00009999999999999999),
    // while 10^d for a whole d >= 0 is exact and a division is correctly rounded, so this
    // is the nearest double to half a unit in the d-th decimal on every engine (2026-11-08).
    const half = 0.5 / 10 ** declared
    if (half > abs) {
      abs = half
      absReason = `half a unit in the ${declared}th decimal — the capture's declared readDecimals (legacy)`
    }
  }
  return { rel: REL_TOL, abs, absReason }
}

const isNa = (v) => v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v))

export function valuesAgree(ours, vendor, tol, floor = 0) {
  if (isNa(ours) || isNa(vendor)) return isNa(ours) && isNa(vendor)
  const d = Math.abs(ours - vendor)
  // ⭐ ENGINE 56 (S4-4) — `floor`: the float-order floor of a plot a running total feeds
  // (`ourSide.js::floatOrderFloorOf`, 8 ulps of the total's magnitude so far), 0 elsewhere
  return d <= tol.abs || d <= tol.rel * Math.abs(vendor) || (floor > 0 && d <= floor)
}

/** A colour to `#rrggbbaa`, lowercase, or null when it cannot be read.
 *  Accepts `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb(…)`, `rgba(…)`. */
export function normalizeColor(c) {
  if (typeof c !== 'string') return null
  const s = c.trim().toLowerCase()
  let m = /^#([0-9a-f]{3})$/.exec(s)
  if (m) return `#${m[1].split('').map((x) => x + x).join('')}ff`
  m = /^#([0-9a-f]{6})$/.exec(s)
  if (m) return `#${m[1]}ff`
  m = /^#([0-9a-f]{8})$/.exec(s)
  if (m) return `#${m[1]}`
  m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(s)
  if (m) {
    const h = (n) => Math.max(0, Math.min(255, Math.round(Number(n)))).toString(16).padStart(2, '0')
    const a = m[4] === undefined ? 1 : Number(m[4])
    return `#${h(m[1])}${h(m[2])}${h(m[3])}${h(a * 255)}`
  }
  return null
}

/** ⭐⭐ THE ABSENT COLOUR. Pine's `na` colour draws nothing, and TradingView
 *  reports it two ways: a static `color = na` style is `rgba(0,0,0,0)`, and a
 *  colorer bar whose colour is `na` reads `null` (see `vendorColorsFor`). Our
 *  renderer draws `na` as a palette entry at alpha 0, whatever its RGB. Every
 *  fully transparent colour is the SAME drawing — nothing — so it canonicalises
 *  to one spelling before two readings are compared. */
export const NO_COLOUR = '#00000000'

/** ⭐⭐ ENGINE 58 — OUR SIDE'S COLOUR FOR A BAR WHERE IT WITHHELD THE COLOUR BY
 *  NAME (`plots[].colorWithheld.points`: a colour rule with no colour on that bar,
 *  drawn in none). Not a colour: such a bar is not compared, it is COUNTED, and a
 *  plot with any (on a bar TradingView coloured) is INCONCLUSIVE with the count —
 *  never MATCH having compared nothing there, never DIVERGE against a colour our
 *  side never claimed. `ourSide.js` writes it. */
export const COLOUR_WITHHELD_POINT = 'withheld'
/** ⭐⭐ ENGINE 58 — A THEME REFERENCE IS GRADED ON ITS ALPHA BYTE ALONE. Its hue is
 *  the chart's (`chart.fg_color` is our chart's text colour, TradingView's is its own
 *  theme's — the C37 rule, theme-relative), but its TRANSPARENCY is the script's
 *  (`color.new(chart.fg_color, 85)` is alpha `26` on every chart). So both sides are
 *  reduced to `#000000<alpha>` and compared as colours: the alpha has to agree, the
 *  hue is not asked. A non-colour (`null`, `undefined`, `COLOUR_WITHHELD_POINT`) is
 *  passed through unchanged. */
export function alphaOnlyColour(c) {
  if (typeof c !== 'string' || c === COLOUR_WITHHELD_POINT) return c
  const n = normalizeColor(c)
  return n ? `#000000${n.slice(7)}` : c
}

export function canonicalColour(c) {
  return typeof c === 'string' && /^#[0-9a-f]{6}00$/.test(c) ? NO_COLOUR : c
}

/** Two `#rrggbbaa` readings are the same drawing when they are the same
 *  canonical colour, or the same RGB whose alphas differ by ONE 8-bit unit.
 *
 *  ⭐ THE ONE UNIT IS QUANTISATION, NOT TOLERANCE FOR A WRONG ANSWER.
 *  TradingView stores alpha as an 8-bit integer from `1 - transp/100` in
 *  doubles; our renderer is handed an `rgba(…)` float at four decimals, which
 *  the reading rounds to 8 bits. At a half-unit boundary the two roundings
 *  split: `color.new(c, 90)` is 25.5 units — TradingView's double
 *  (`1 - 0.9 = 0.0999…`) lands on `0x19`, our `0.1` on `0x1a`. Measured
 *  2026-09-28, Momentum Volatility Scanner's Vol Upper/Lower, 613 bars each.
 *  ⛔ ONE unit only: adjacent whole transparencies are 2.55 units apart, so a
 *  one-percent transparency error can never hide inside it. */
export function coloursAgree(a, b) {
  const x = canonicalColour(a)
  const y = canonicalColour(b)
  if (x === y) return true
  if (typeof x !== 'string' || typeof y !== 'string') return false
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})$/
  const mx = m.exec(x)
  const my = m.exec(y)
  if (!mx || !my || mx[1] !== my[1]) return false
  return Math.abs(parseInt(mx[2], 16) - parseInt(my[2], 16)) <= 1
}

/** ⭐⭐ A PALETTE-LESS COLORER'S VALUE IS THE COLOUR ITSELF, PACKED.
 *
 *  A Pine v5/v6 study whose colour is an EXPRESSION (not a closed set the
 *  compiler could enumerate) gets a colorer plot with NO `palette` at all, and
 *  its per-bar value is a 32-bit colour: `0xAABBGGRR` — alpha in the top byte,
 *  RED in the LOWEST. Measured on the 2026-09-28 RDDT captures, against colours
 *  the source states literally:
 *
 *      sector-rotation  0xff5252ff → #ff5252ff  (v5 `color.red`)
 *      sector-rotation  0xff50af4c → #4caf50ff  (v5 `color.green`)
 *      dual-view        0xff35d8fd → #fdd835ff  (`input.color(color.yellow)`)
 *      momentum-vol     0xb39e9e9e → #9e9e9eb3  (`color.new(color.gray, 30)`)
 *      artemis          0x4dd4bc00 → #00bcd44d  (`color.new(#00bcd4, 70)`)
 *
 *  ⚰️ Before this, every such colorer read "names palette undefined, which the
 *  capture does not carry", and the comparator blamed OUR side ("our side's
 *  colour could not be resolved") — or, where our side had a colour, graded the
 *  plot MATCH having compared no colour at all.
 *
 *  ⛔ ONLY an integer in [0, 2^32). Anything else is not a packed colour and
 *  answers null, never a guess. */
export function decodePackedColour(n) {
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 0xffffffff) return null
  const h = (x) => x.toString(16).padStart(2, '0')
  const r = n & 0xff
  const g = (n >>> 8) & 0xff
  const b = (n >>> 16) & 0xff
  const a = (n >>> 24) & 0xff
  return `#${h(r)}${h(g)}${h(b)}${h(a)}`
}

/** TradingView hands a study's titles through `metaInfo()` HTML-ESCAPED:
 *  `plot(ph, "Pivot High's")` reads back `Pivot High&#039;s` (measured,
 *  extrapolated-pivot-connector-rddt-1d-2026-09-28). The member reads the
 *  unescaped title on both platforms, so that is the one the mapping compares.
 *  ⛔ Only the five entities HTML escaping emits (plus the numeric forms); an
 *  unknown `&name;` is left exactly as written rather than guessed. */

// ── VENDOR PLOT ROLES ────────────────────────────────────────────────────────
//
// `metaInfo().plots[i].type`:
//   line / shapes / chars / arrows / bar_colorer? — the VALUE plots a member sees
//   colorer                                       — a palette index for `target`
//   alertcondition                                — draws nothing on TradingView
//                                                   either; not a visual claim
// Anything else (bar/bg colorers, ohlc_*, data_offset, …) is carried in the
// capture and reported as NOT COMPARED BY v1, by name — never silently dropped.
const VALUE_TYPES = new Set(['line', 'shapes', 'chars', 'arrows'])

// ⭐⭐ THE VENDOR'S STUDY METAINFO ARRIVES HTML-ESCAPED. Measured on the
// 2026-09-28 batch: `extrapolated-pivot-connector` titles its plots
// `Pivot High&#039;s` / `Pivot Low&#039;s` (the script writes `Pivot High's`),
// and `makuchaku039s-…` / `poor-man039s-…` carry `&#039;` in their study
// description. Compared raw, the title mapping (M1) looked for a plot of ours
// literally named `Pivot High&#039;s` and reported both plots UNMAPPED — a
// verdict about the capture's encoding, not about either engine.
//
// ⛔ METAINFO ONLY. Every entity in the 47 captures sits in a study/plot/style
// TITLE or DESCRIPTION; not one object text (label, cell) carries one. A label
// text is the script's own string, so decoding it would rewrite a literal
// `&amp;` an author typed — an unmeasured transformation applied to data.
//
// ⛔ ONE PASS. `&amp;#039;` decodes to `&#039;`, never to `'`: decoding twice
// would turn a title that genuinely contains the text `&#039;` into something
// the author did not write.
const NAMED_ENTITIES = Object.freeze({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })
export function decodeVendorText(s) {
  if (typeof s !== 'string' || s.indexOf('&') < 0) return s
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
    }
    const named = NAMED_ENTITIES[body.toLowerCase()]
    return named === undefined ? whole : named
  })
}

/** The same decode, under the name the colour lane's plot-title mapping
 *  (`vendorPlotRoles`, M1) was written against. ONE implementation: two copies
 *  of an entity decoder drift the first time one of them learns an entity. */
export const unescapeVendorTitle = decodeVendorText

// ⭐⭐ e97 U5 (phase A) — A `plotcandle` / `plotbar` IS FOUR VALUE PLOTS AND UP TO THREE COLORERS, all
// targeting one `plotcandle_N` / `plotbar_N`. The four prices are compared now (`candles`, paired by
// `pairCandles`); the colorers are NOT, by name. ⚰️ All seven read "plot type ohlc_open is not compared by
// v1", so the 52 candles of 37 committed captures carried no TradingView grade at all.
const CANDLE_PART_TYPES = Object.freeze({ ohlc_open: 'open', ohlc_high: 'high', ohlc_low: 'low', ohlc_close: 'close' })
const CANDLE_COLOUR_TYPES = Object.freeze({ ohlc_colorer: 'body', wick_colorer: 'wick', border_colorer: 'border' })
export const CANDLE_ROLES = Object.freeze(['open', 'high', 'low', 'close'])
const CANDLE_TARGET = /^(plotcandle|plotbar)_(\d+)$/
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k)

export function vendorPlotRoles(capture) {
  const plots = (capture.study && capture.study.plots) || []
  const styles = (capture.study && capture.study.styles) || {}
  const value = []
  const colorers = []
  const notDrawn = []
  const notCompared = []
  const candleByTarget = new Map()
  plots.forEach((p, idx) => {
    const title = decodeVendorText((p.title !== undefined ? p.title : (styles[p.id] && styles[p.id].title)) ?? null)
    const rec = { ...p, title, column: idx + 1 }
    const candleAt = typeof p.target === 'string' ? CANDLE_TARGET.exec(p.target) : null
    if (candleAt && hasOwn(CANDLE_PART_TYPES, p.type)) {
      if (!candleByTarget.has(p.target)) {
        candleByTarget.set(p.target, { target: p.target, kind: candleAt[1], index: Number(candleAt[2]), parts: {} })
      }
      candleByTarget.get(p.target).parts[CANDLE_PART_TYPES[p.type]] = { ...rec, candlePart: CANDLE_PART_TYPES[p.type] }
      return
    }
    if (candleAt && hasOwn(CANDLE_COLOUR_TYPES, p.type)) {
      notCompared.push({ ...rec, candleColour: true, why: `candle ${CANDLE_COLOUR_TYPES[p.type]} colour (${p.target}) — not compared (phase A)` })
      return
    }
    if (VALUE_TYPES.has(p.type)) value.push(rec)
    // ⛔ A colorer on a FILLED AREA colours the fill, not a plot. v1 does not
    // grade fills, so it is reported NOT COMPARED by name, never dropped.
    else if (p.type === 'colorer' && isFillTarget(p.target)) notCompared.push({ ...rec, why: `fill colour (${p.target})` })
    else if (p.type === 'colorer') colorers.push(rec)
    else if (p.type === 'alertcondition') notDrawn.push(rec)
    else notCompared.push(rec)
  })
  const candles = [...candleByTarget.values()].sort((a, b) => (a.kind === b.kind ? a.index - b.index : a.kind < b.kind ? -1 : 1))
  return { value, colorers, notDrawn, notCompared, candles }
}

/** Is this one of OUR plots a part of a candle (`plotcandle` / `plotbar`, carrying its Pine role)? */
export function isOurCandlePart(o) {
  return !!o && (o.kind === 'plotcandle' || o.kind === 'plotbar')
}

/** ⭐⭐ e97 U5 (phase A) — PAIR THE VENDOR'S CANDLES WITH OURS, or say why not.
 *
 *  A candle carries no title on either side (TradingView's `plotcandle_N` plots are untitled, and no capture
 *  records `ohlcPlots` titles), so the one identity both sides expose is ORDER: TradingView numbers a study's
 *  candles in declaration order (`plotcandle_0`, `plotcandle_1`, ...), and the translator emits one group of
 *  four outputs per `plotcandle(...)` statement in source order (`MULTI_OUTPUT_CALLS`). So, per kind:
 *    C1  the N-th vendor candle is paired with our N-th candle group, part by part (`open` with `open`, ...),
 *        ONLY when both sides hold the same number of candles of that kind and every group is whole
 *        (each of the four roles exactly once);
 *    ⛔  anything else is UNMAPPED, by name, as `mapPlots` leaves a plot it would have to guess.
 *  Our candle parts never enter `mapPlots`' pool: a candle part is not a line, and four untitled outputs in the
 *  leftover pool broke M2's positional pairing for every untitled plot beside them. */
export function pairCandles(vendorCandles, ourPlots) {
  const pairs = []
  const unmappedVendor = []
  const usedOurs = new Set()
  const ourGroups = { plotcandle: [], plotbar: [] }
  let open = null
  for (const o of ourPlots || []) {
    if (!isOurCandlePart(o)) { open = null; continue }
    if (!open || o.roleIndex === 0 || open.kind !== o.kind || open.parts[o.role] !== undefined) {
      open = { kind: o.kind, parts: {}, count: 0 }
      ourGroups[o.kind].push(open)
    }
    open.parts[o.role] = o
    open.count += 1
  }
  const whole = (g) => g.count === CANDLE_ROLES.length && CANDLE_ROLES.every((r) => g.parts[r])
  for (const kind of ['plotcandle', 'plotbar']) {
    const vendors = (vendorCandles || []).filter((c) => c.kind === kind)
    const ours = ourGroups[kind]
    const vendorWhole = vendors.every((c) => CANDLE_ROLES.every((r) => c.parts[r]))
    const pairable = vendors.length === ours.length && vendorWhole && ours.every(whole)
    for (const [n, c] of vendors.entries()) {
      for (const role of CANDLE_ROLES) {
        const v = c.parts[role]
        if (!v) continue
        if (!pairable) {
          const reason = vendors.length !== ours.length
            ? `the capture holds ${vendors.length} ${kind}(s) and our side ${ours.length}: a candle is paired only by its order, and the counts disagree`
            : !vendorWhole ? `${c.target} does not record all four prices`
              : `one of our ${kind} groups does not carry all four roles (${CANDLE_ROLES.join(', ')})`
          unmappedVendor.push({ vendor: v, reason })
          continue
        }
        const o = ours[n].parts[role]
        pairs.push({ vendor: v, ours: o, rule: `C1-candle-order (${c.target}.${role})` })
        usedOurs.add(o)
      }
    }
  }
  const unmappedOurs = (ourPlots || []).filter((o) => isOurCandlePart(o) && !usedOurs.has(o))
  return { pairs, unmappedVendor, unmappedOurs }
}

// ── MAPPING ──────────────────────────────────────────────────────────────────
//
// THE RULE, in the order it is applied, and every step can only REFUSE:
//
//   M0  A plot carrying an explicit `selector` is mapped by it and nothing else
//       (legacy observations name their plot by our translation's formula).
//   M1  By TITLE, exact string equality, when the title is present and unique on
//       BOTH sides. A plot's title is what the member reads in the legend on
//       both platforms, so it is the one identity both sides expose.
//   M2  What is left is paired BY POSITION only if the two leftover lists are
//       the same length AND every leftover title on both sides is a default
//       (empty, or TradingView's "Plot"/"Plot N") — i.e. nothing on either side
//       names a plot that the positional pairing would contradict.
//   ⛔  Anything else is UNMAPPED and its verdict is INCONCLUSIVE, loudly, with
//       the reason. A mapping the harness had to guess is a comparison of two
//       unrelated columns wearing one plot's name.
//
// ⭐ TradingView's defaults are PER CALL, and all three are MEASURED: an untitled
// `plot` is "Plot", an untitled `plotshape` is "Shapes", an untitled `plotchar`
// is "Chars" (probe-default-colour-v{3,4,6}-rddt-1d-2026-09-27). Knowing only
// "Plot" left every untitled marker UNMAPPED and its colour never compared.
const DEFAULT_TITLE = /^((plot|shapes|chars)( \d+)?)?$/i

export function mapPlots(vendorValuePlots, ourPlots) {
  const pairs = []
  const unmappedVendor = []
  const usedOurs = new Set()
  const byTitle = new Map()
  for (const o of ourPlots) {
    const k = o.title == null ? '' : String(o.title)
    byTitle.set(k, (byTitle.get(k) || 0) + 1)
  }
  const vendorTitleCount = new Map()
  for (const v of vendorValuePlots) {
    const k = v.title == null ? '' : String(v.title)
    vendorTitleCount.set(k, (vendorTitleCount.get(k) || 0) + 1)
  }

  const leftVendor = []
  for (const v of vendorValuePlots) {
    // M0
    if (v.selector && typeof v.selector === 'object') {
      const hits = ourPlots.filter((o) => !usedOurs.has(o)
        && (v.selector.formula === undefined || o.formula === v.selector.formula)
        && (v.selector.title === undefined || o.title === v.selector.title))
      if (hits.length === 1) { pairs.push({ vendor: v, ours: hits[0], rule: 'M0-selector' }); usedOurs.add(hits[0]); continue }
      unmappedVendor.push({ vendor: v, reason: hits.length === 0
        ? `selector ${JSON.stringify(v.selector)} matches none of our plots`
        : `selector ${JSON.stringify(v.selector)} matches ${hits.length} of our plots — ambiguous` })
      continue
    }
    const t = v.title == null ? '' : String(v.title)
    if (t && !DEFAULT_TITLE.test(t) && vendorTitleCount.get(t) === 1 && byTitle.get(t) === 1) {
      const o = ourPlots.find((x) => String(x.title) === t)
      if (!usedOurs.has(o)) { pairs.push({ vendor: v, ours: o, rule: 'M1-title' }); usedOurs.add(o); continue }
    }
    leftVendor.push(v)
  }
  const leftOurs = ourPlots.filter((o) => !usedOurs.has(o))

  const allDefault = (xs) => xs.every((x) => DEFAULT_TITLE.test(x.title == null ? '' : String(x.title)))
  if (leftVendor.length && leftVendor.length === leftOurs.length && allDefault(leftVendor) && allDefault(leftOurs)) {
    leftVendor.forEach((v, i) => { pairs.push({ vendor: v, ours: leftOurs[i], rule: 'M2-position-untitled' }); usedOurs.add(leftOurs[i]) })
  } else {
    for (const v of leftVendor) {
      const t = v.title == null ? '' : String(v.title)
      let reason
      if (vendorTitleCount.get(t) > 1) reason = `vendor title ${JSON.stringify(t)} is not unique in the study`
      else if ((byTitle.get(t) || 0) > 1) reason = `our side carries ${byTitle.get(t)} plots titled ${JSON.stringify(t)}`
      else if (!byTitle.get(t)) reason = `no plot on our side is titled ${JSON.stringify(t)}`
      else reason = `title ${JSON.stringify(t)} could not be paired unambiguously`
      unmappedVendor.push({ vendor: v, reason })
    }
  }
  const unmappedOurs = ourPlots.filter((o) => !usedOurs.has(o))
  return { pairs, unmappedVendor, unmappedOurs }
}

// ── ONE PLOT ─────────────────────────────────────────────────────────────────

/**
 * @param {object} a
 * @param {Array} a.times            the vendor bar times, index-aligned with ours
 * @param {Array} a.vendor           vendor value per bar; `undefined` = no row
 * @param {ArrayLike} a.ours         our value per bar
 * @param {Array|null} a.vendorColors normalised hex per bar, or null (not measured)
 * @param {Array|null} a.ourColors    normalised hex per bar, or null (unresolvable)
 * @param {number} a.warmupBars      bars [0, W) are the warm-up region
 * @param {number} [a.colorWarmupBars] bars [0, C) are the COLOUR's warm-up: a
 *                                   colour is compared from bar C on (default W).
 *                                   See `colourWarmupOf`.
 * @param {object} a.tol             from `tolerancePolicy`
 */
// ─── ⭐⭐ INDEX PROVENANCE (coordinator ruling 2026-11-22, option 3) ───────────────────────────────────────────────────────
// Since 2026-11-22 our server serves SPX / NDX intraday bars from THREE sources: Yahoo's own (the newest 60 days on 1-30m,
// 730 on 60m), FMP's settled history before them (`index:fmp`: FMP's own 5m / 1m bars; `index:fmp-rollup`: FMP's 5m
// rolled to 15 / 30 / 60), and slots FMP never answered completed from the ETF (`index:etf-fill`). A chart bar whose
// other-symbol read lands on a non-Yahoo bar IS compared, but into the plot's `provenance` block
// (`{class: {compared, equal, worst}}`), NEVER into `matching`: that keeps the evidence of how close FMP and the fill
// really are to TradingView without letting it stand as a MATCH.
// ⛔ GUARD 1: the plot's verdict speaks ONLY for the Yahoo-sourced bars, and they must reach PROVENANCE_SOURCED_MIN on
// their own, or the plot is INCONCLUSIVE ("too few vendor-sourced bars"). GUARD 2: provenance equality never counts
// toward a MATCH tally or capability admission (`evidence_engine.py` shows each row's provenance share beside it).
export const PROVENANCE_CLASSES = Object.freeze(['index:fmp', 'index:fmp-rollup', 'index:etf-fill'])
/** ⛔ GUARD 1's floor: the Yahoo-sourced steady bars a provenance-bearing plot must compare on their own. 200: it
 *  MIRRORS the floor the L10 value cases use (coordinator ruling 2026-11-22), so there is one number for "enough bars to
 *  speak". A capture whose Yahoo window holds fewer is INCONCLUSIVE by Guard 1, which is correct. */
export const PROVENANCE_SOURCED_MIN = 200
/** ⭐⭐ BIN (v) (coordinator ruling 2026-11-23, option a): the chart's LAST regular-hours bar of a session served from
 *  the FMP prefix reads the session's closing value from the older intraday history, where FMP's closing value and
 *  TradingView's differ (30m 15:30: TradingView equals ours on 332 of 666 FMP-prefix sessions; 117 of 125 inside our 1m
 *  window, 60 of 60 Yahoo-window sessions; the 15:59 one-minute close does not explain it, 5 vs 4). Its own named class,
 *  per BAR from the supply's provenance (never a date constant). A Yahoo-sourced session-last bar is graded as before. */
export const SESSION_LAST_CLASS = 'index:fmp-session-last'
/** Why each provenance class is not a MATCH, in words (the summary prints it once per class present). */
export const PROVENANCE_REASONS = Object.freeze({
  [SESSION_LAST_CLASS]: "the session's last bar from the older intraday history, where our vendor's closing value and TradingView's differ",
})

const _ET_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit',
  day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
function _etDayMin(sec) {
  const parts = Object.fromEntries(_ET_FMT.formatToParts(new Date(sec * 1000)).map((x) => [x.type, x.value]))
  return { day: `${parts.year}-${parts.month}-${parts.day}`, min: (Number(parts.hour) % 24) * 60 + Number(parts.minute) }
}

/**
 * The provenance class of every capture bar (aligned with `times`), or null when no bar has one.
 * `provenance` = our side's `indexProvenance`: `[{symbol, class, deepFrom, deepThrough, filled: [iso]}]`, one per
 * index series the run read. A bar on session `d` reads that session's bar: `index:etf-fill` on a filled session,
 * the series' class from `deepFrom` through `deepThrough`, else Yahoo's own (null). ⭐ A bar BEFORE 09:30 ET on the
 * session after `deepThrough` reads the prefix's last bar (an extended-hours chart's pre-market): the prefix class.
 * Daily (ISO-dated) captures carry none: the daily index rows are FMP's primary, never a deep prefix.
 * ⭐ BIN (v): on an INTRADAY capture (`intraday`: its own contiguous grid), the session's last regular-hours bar
 * (the day's last bar inside 09:30-16:00 ET, so a 13:00 half-day's last too) of a prefix session is SESSION_LAST_CLASS.
 */
/** An intraday capture: a numeric (minutes) timeframe such as `5`, `30`, `60`, `1` or `5m`; never `1D` / `D` / `W` / `M`. */
export function isIntradayCapture(capture) {
  return /^\d+m?$/.test(String((capture && capture.timeframe) || ''))
}

export function provenanceBarsOf(times, provenance, { intraday = false } = {}) {
  const list = Array.isArray(provenance) ? provenance.filter((e) => e && PROVENANCE_CLASSES.includes(e.class)) : []
  if (!list.length || !Array.isArray(times) || !times.length) return null
  let any = false
  const out = times.map((t) => {
    if (typeof t !== 'number' || !Number.isFinite(t)) return null
    const { day, min } = _etDayMin(t > 1e11 ? t / 1000 : t)
    for (const e of list) {
      if (Array.isArray(e.filled) && e.filled.includes(day)) { any = true; return 'index:etf-fill' }
      if (e.deepFrom && e.deepThrough && day >= e.deepFrom && day <= e.deepThrough) { any = true; return e.class }
      if (e.deepThrough && day > e.deepThrough && min < 570 && e.firstOwnSession === day) { any = true; return e.class }
    }
    return null
  })
  if (any && intraday) {
    const lastOfDay = new Map()
    times.forEach((t, i) => {
      if (typeof t !== 'number' || !Number.isFinite(t)) return
      const { day, min } = _etDayMin(t > 1e11 ? t / 1000 : t)
      if (min >= 570 && min < 960) lastOfDay.set(day, i)
    })
    for (const i of lastOfDay.values()) if (out[i] === 'index:fmp' || out[i] === 'index:fmp-rollup') out[i] = SESSION_LAST_CLASS
  }
  return any ? out : null
}

// ─── ⭐⭐ INDEX ROUNDING (coordinator ruling 2026-11-23) ─────────────────────────────────────────────────────────────────
// TradingView's historical SPX is one index TICK (0.01) away from two vendors that agree with each other. An RS-style plot
// reads value = close / X(t) * k, so a one-tick difference in X moves it by at most a relative 0.01 / (X - 0.01), which
// 0.0101 / X(t) bounds for every X above 1. A Yahoo-sourced bar (a provenance bar never gets here: it is graded in its
// block, above) whose value DIFFERS beyond the tolerance and lies within that bound is ROUNDING-EQUAL. Its SUB-TICK part
// (|rel| < 0.005 / X(t)) is TradingView's daily close carrying a third decimal (3936.691 against our 3936.69).
// X(t) is OUR index value read on that bar (`ours.indexReadValues`, `ourSide.js::indexReadValuesOf`: the engine's own
// `sym` read of the index close over the run's own bind and supply), never the vendor's and never a second source.
// ⛔ A ROUNDING-EQUAL BAR IS NEVER A MATCH: it leaves `valueMismatches` for its own column (`roundingEqual`), never
// enters `matching`, and a plot whose only steady divergences are rounding-equal stays DIVERGE with the class named in
// its reason (`plotVerdict`). DIVERGE, not a new verdict: the verdict set is what every consumer (the coverage map, the
// evidence ledger, capability admission) reads, and none of them may be told MATCH by this class.
// ⛔ "EXACT" STAYS EXACT: a bar inside the normal tolerance is `matching` as before. A capture that reads no index, and a
// bar on which our side read none, grade exactly as before.
export const INDEX_TICK_REL = 0.0101
export const INDEX_SUB_TICK_REL = 0.005

/** One differing bar against the index-rounding bound: `{rel, ticks, subTick}`, or null when it is not rounding-equal
 *  (no index read on the bar, an `na` on either side, or a difference above one index tick through the ratio).
 *  `ticks` = the difference in index ticks, rel · X / 0.01 (at most 1.01). */
export function indexRoundingOf(ours, vendor, x) {
  if (typeof x !== 'number' || !Number.isFinite(x) || x <= 0 || isNa(ours) || isNa(vendor) || vendor === 0) return null
  const rel = Math.abs(Number(ours) - vendor) / Math.abs(vendor)
  if (!(rel <= INDEX_TICK_REL / x)) return null
  return { rel, ticks: (rel * x) / 0.01, subTick: rel < INDEX_SUB_TICK_REL / x }
}

/** The rounding-equal column as words: `12 (sub-tick 9, worst 0.98 tick)`. */
export function roundingText(re) {
  return `${re.compared} (sub-tick ${re.subTick}, worst ${Number(re.worst).toFixed(2)} tick)`
}

export function comparePlot({ times, vendor, ours, vendorColors = null, ourColors = null, warmupBars = 0, colorWarmupBars = warmupBars, tol, oursUnreadAfter = null, withheldBars = null, floatOrderFloor = null, unsettledBars = null, behindBars = null, provenanceBars = null, indexRead = null }) {
  const n = times.length
  const res = {
    bars: n,
    compared: 0,
    // Bars our side cannot report the vendor's quantity for (see `leadBy`).
    oursUnread: 0,
    // ⭐ ENGINE 56 — bars our side withheld BY NAME on this plot (a per-bar witness code):
    // not compared, and counted with how many of them TradingView drew a value on
    withheldBars: 0,
    withheldVendorValued: 0,
    withheldWarmupVendorValued: 0,
    floatOrderFloorUsed: 0,
    matching: 0,
    vendorRowsMissing: 0,
    naMismatches: 0,
    valueMismatches: 0,
    colorMismatches: 0,
    colorCompared: 0,
    // ⭐ ENGINE 58 — bars TradingView coloured where our side withheld the colour
    // by name (`COLOUR_WITHHELD_POINT`).
    colorWithheld: 0,
    // Bars where the VENDOR drew a value in a known colour — the bars a colour
    // claim is about. Counted whether or not our side's colour resolved, so a
    // plot that never draws anything is told apart from one we could not read.
    colorComparable: 0,
    valued: 0,
    maxAbs: 0,
    maxRel: 0,
    firstDivergence: null,
    warmup: { bars: Math.min(warmupBars, n), compared: 0, divergent: 0, first: null },
    steady: { bars: Math.max(0, n - warmupBars), compared: 0, divergent: 0, first: null, last: null },
  }
  let firstRowSeen = false
  let gapAfterRows = 0
  const steadyComparedBars = []
  const steadyDivergentBars = []
  // SUPPLY-ATTRIBUTED (2026-11-17): every steady divergent bar with its time and kind, kept OFF the
  // serialised stats (non-enumerable, below) so a verdicts file does not grow by a list per plot
  const steadyDivergent = []
  for (let i = 0; i < n; i++) {
    const v = vendor[i]
    if (v === undefined) {
      // No vendor row for this bar. Leading gaps are the study not having
      // started; a gap AFTER rows began is a hole in what was read.
      res.vendorRowsMissing += 1
      if (firstRowSeen) gapAfterRows += 1
      continue
    }
    firstRowSeen = true
    if (Number.isInteger(oursUnreadAfter) && i >= oursUnreadAfter) { res.oursUnread += 1; continue }
    // OTHER-SYMBOL UNSETTLED (coordinator ruling on #1541): a bar TradingView's own captures disagree about
    // is not compared; it is named on the plot (`otherSymbolUnsettled`) and counted here, never a gap
    if (unsettledBars && unsettledBars[i]) { res.unsettledBars = (res.unsettledBars || 0) + 1; continue }
    // SUPPLY BEHIND THE CAPTURE (coordinator ruling, 2026-11-18): the forming newest bar a recorded supply cannot
    // answer (`supplyAttribution.js::supplyBehindOf`) is not compared; it is named on the plot (`supplyBehind`)
    if (behindBars && behindBars[i]) { res.supplyBehindBars = (res.supplyBehindBars || 0) + 1; continue }
    // ⭐⭐ INDEX PROVENANCE: compared into its own block, NEVER into `matching` / `compared` / `steady` (above)
    if (provenanceBars && provenanceBars[i]) {
      if (withheldBars && withheldBars[i]) continue
      const cls = provenanceBars[i]
      if (!res.provenance) res.provenance = {}
      const blk = res.provenance[cls] || (res.provenance[cls] = { compared: 0, equal: 0, naMismatches: 0, worst: 0 })
      const o = ours[i]
      blk.compared += 1
      if (isNa(v) === isNa(o)) {
        if (isNa(v)) blk.equal += 1
        else {
          const rel = Math.abs(o - v) / Math.max(Math.abs(v), Number.MIN_VALUE)
          if (rel > blk.worst) blk.worst = rel
          const floor = floatOrderFloor && Number.isFinite(floatOrderFloor[i]) ? floatOrderFloor[i] : 0
          if (valuesAgree(o, v, tol) || (floor > 0 && valuesAgree(o, v, tol, floor))) blk.equal += 1
        }
      } else blk.naMismatches += 1
      continue
    }
    if (withheldBars && withheldBars[i]) {
      res.withheldBars += 1
      // only a steady-state bar weighs on the verdict; a warm-up bar is reported, as a warm-up
      // divergence is (`warmup.divergent`)
      if (!isNa(v)) { if (i >= warmupBars) res.withheldVendorValued += 1; else res.withheldWarmupVendorValued += 1 }
      continue
    }
    const o = ours[i]
    res.compared += 1
    if (!isNa(v)) res.valued += 1
    const region = i < warmupBars ? res.warmup : res.steady
    region.compared += 1
    let kind = null
    // ⭐⭐ INDEX ROUNDING: a differing bar within one index tick through the ratio (`indexRoundingOf`)
    let rounding = null
    if (isNa(v) !== isNa(o)) { kind = 'na'; res.naMismatches += 1 }
    else if (!isNa(v)) {
      const d = Math.abs(o - v)
      const rel = d / Math.max(Math.abs(v), Number.MIN_VALUE)
      if (d > res.maxAbs) res.maxAbs = d
      if (Math.abs(v) > 0 && rel > res.maxRel) res.maxRel = rel
      const floor = floatOrderFloor && Number.isFinite(floatOrderFloor[i]) ? floatOrderFloor[i] : 0
      if (!valuesAgree(o, v, tol)) {
        if (floor > 0 && valuesAgree(o, v, tol, floor)) res.floatOrderFloorUsed += 1
        else if (indexRead && (rounding = indexRoundingOf(o, v, indexRead[i]))) {
          const re = res.roundingEqual || (res.roundingEqual = { compared: 0, subTick: 0, steady: 0, worst: 0, first: null })
          re.compared += 1
          if (rounding.subTick) re.subTick += 1
          if (region === res.steady) re.steady += 1
          if (rounding.ticks > re.worst) re.worst = rounding.ticks
          if (!re.first && region === res.steady) re.first = { bar: i, time: times[i], vendor: v, ours: Number(o), index: indexRead[i], ticks: rounding.ticks }
        } else { kind = 'value'; res.valueMismatches += 1 }
      }
    }
    if (vendorColors && !isNa(v) && vendorColors[i] !== undefined && vendorColors[i] !== null) res.colorComparable += 1
    // ⛔ a rounding-equal bar's colour is not graded, as a differing value's is not: its value is not the vendor's
    if (!kind && !rounding && vendorColors && ourColors && !isNa(v) && i >= colorWarmupBars) {
      const vc = vendorColors[i]
      const oc = ourColors[i]
      if (oc === COLOUR_WITHHELD_POINT) {
        if (vc !== undefined && vc !== null) res.colorWithheld += 1
      } else if (vc !== undefined && vc !== null && oc !== undefined) {
        res.colorCompared += 1
        if (!coloursAgree(vc, oc)) { kind = 'color'; res.colorMismatches += 1 }
      }
    }
    if (kind) {
      const rec = {
        bar: i, time: times[i], kind,
        vendor: isNa(v) ? null : v, ours: isNa(o) ? null : Number(o),
        ...(kind === 'color' ? { vendorColor: vendorColors[i], ourColor: ourColors[i] } : {}),
      }
      if (!res.firstDivergence) res.firstDivergence = rec
      region.divergent += 1
      if (!region.first) region.first = rec
      if (region === res.steady) {
        res.steady.last = rec
        steadyDivergentBars.push(i)
        steadyDivergent.push({ bar: i, time: times[i], kind })
      }
    } else if (!rounding) {
      // ⛔ a rounding-equal bar is counted in its own column above, NEVER here
      res.matching += 1
    }
    if (region === res.steady) steadyComparedBars.push(i)
  }
  res.vendorRowGapsAfterStart = gapAfterRows
  res.steady.pattern = divergencePattern(steadyComparedBars, steadyDivergentBars, res.steady)
  Object.defineProperty(res, 'steadyDivergent', { value: steadyDivergent, enumerable: false })
  return res
}

// ── SUPPLY-ATTRIBUTED DIVERGENCE (coordinator ruling on #1541, 2026-11-17) ──────────────
//
// A capture that reads ANOTHER symbol is graded on the bars OUR SERVER serves for it (RS RATING L8, never
// on TradingView's own: `ourSide.js::recordedSupplyOf`). Where that supply differs from TradingView's own
// series, the plot differs because the DATA differs, not the engine. Where (and only where) the supply
// symbol has a committed TradingView WITNESS of that symbol (`requestWitnesses.json` row `witness`,
// committed), a DIVERGE plot is graded MATCH_SUBSTITUTED when ALL of:
//   1. it reads no window (`lookback === 0`): a windowed plot spanning a differing date stays DIVERGE;
//   2. EVERY steady divergent bar is a VALUE difference on a date where our supply differs from the
//      witness (`attributableToSupply`): one difference on an agreeing date keeps it DIVERGE;
//   3. our side, run again on the supply with the witness's values on those dates (the counterfactual,
//      `vendorHarness/supplyAttribution.js`), agrees with TradingView on every bar of that plot.
// The record names the UCT source, the witness and N of M dates (`supplyAttributed`). The grade a member
// reads stays on OUR supply; the counterfactual only proves which side of the difference is the data.

// ── OTHER-SYMBOL UNSETTLED (coordinator ruling on #1541, 2026-11-17) ───────────────────────
//
// When committed TradingView evidence disagrees with ITSELF about another symbol's value on a bar, that bar
// is UNSETTLED, not a divergence. This capture's own read is implied by our side: run again with that
// symbol read as a candidate value on that bar (`supplyAttribution.js::otherSymbolUnsettledOf`), it
// reproduces the capture's value there. If at least one OTHER committed TradingView witness of that symbol
// and date reads a different value, the bar grades INCONCLUSIVE by name and the plot's verdict follows from
// the remaining bars. A single uncontradicted source never unsettles a bar.
export const UNSETTLED_MAX_BARS = 3

/** The `otherSymbolUnsettled` record for one bar, or null when no committed witness contradicts this
 *  capture's implied read (no witness of that date, or every witness reads the same value). */
export function unsettledRecord({ symbol, date, implied, capture, witnesses }) {
  const ws = Array.isArray(witnesses) ? witnesses.filter((w) => w && typeof w.value === 'number') : []
  if (!ws.length || !Number.isFinite(implied) || ws.every((w) => w.value === implied)) return null
  return { symbol, date, readBy: [{ ...capture, value: implied }, ...ws.map((w) => ({ id: w.id, capturedAtUTC: w.capturedAtUTC || null, value: w.value }))] }
}

/** Is every steady divergence of a zero-lookback plot a value difference on a supply-differing date?
 *  @param {{lookback: number|null, divergent: {time: number, kind: string}[], diffDays: Set<string>,
 *            dayOf: (t: number) => string|null}} arg */
export function attributableToSupply({ lookback, divergent, diffDays, dayOf }) {
  if (lookback !== 0 || !Array.isArray(divergent) || !divergent.length || !diffDays || !diffDays.size) return false
  return divergent.every((d) => d.kind === 'value' && diffDays.has(dayOf(d.time)))
}

/**
 * The SHAPE of the steady-state divergences, as a diagnostic beside the verdict
 * (it never changes the verdict).
 *
 *   converging-prefix  the divergences start at the first steady-state bar, stop
 *                      before the last compared bar, every bar AFTER the last
 *                      one agrees (a tail at least as long as the divergent
 *                      span), and the error at the end is smaller than at the
 *                      start — the signature of a recursive state seeded at the
 *                      capture window's first bar while the vendor's already
 *                      carried history (a DATA-axis cause: missing history, not
 *                      a maths difference). Re-capturing from bar 0 settles it.
 *                      `contiguous` says whether the run had agreeing bars inside
 *                      it (an error hovering at the tolerance near its end).
 *   persistent         divergences continue to the last compared bar.
 *   scattered          anything else.
 */
function divergencePattern(compared, divergent, steady) {
  if (!divergent.length) return null
  const firstIdx = compared.indexOf(divergent[0])
  const lastCompared = compared[compared.length - 1]
  const lastDivergent = divergent[divergent.length - 1]
  const lastIdx = compared.indexOf(lastDivergent)
  const contiguous = (lastIdx - firstIdx + 1) === divergent.length
  const tail = compared.length - 1 - lastIdx
  const errAt = (rec) => (rec && rec.kind === 'value' ? Math.abs(rec.ours - rec.vendor) : null)
  const e0 = errAt(steady.first)
  const e1 = errAt(steady.last)
  if (firstIdx === 0 && lastDivergent < lastCompared && tail >= (lastIdx - firstIdx + 1)
      && e0 !== null && e1 !== null && e1 < e0) {
    return { kind: 'converging-prefix', lastDivergentBar: lastDivergent, agreeingAfter: tail, contiguous, absErrFirst: e0, absErrLast: e1 }
  }
  if (lastDivergent === lastCompared) return { kind: 'persistent', lastDivergentBar: lastDivergent }
  return { kind: 'scattered', lastDivergentBar: lastDivergent }
}

/** ⭐⭐ F2 (2026-10-02) — A COLOUR HAS A WARM-UP OF ITS OWN.
 *
 *  A capture that does not start at the listing excuses the first `maxLookback`
 *  bars of each plot's VALUE tree (`warmupBars`): TradingView computed them from
 *  history before the window, which neither side of the comparison holds. A plot's
 *  per-bar COLOUR is a second tree (`colorIndex` / `colorCondition` /
 *  `colorGradient`), and it can reach further back than the value: CPR draws
 *  `DayPivot` (reach 1) in `DayPivot != DayPivot[1] ? na : color.blue` (reach 2).
 *  ⚰️ MEASURED (CAP2, `cpr-with-mas-super-trend-vwap` SPY 1D from 2019-08-06): on
 *  bar 1 TradingView compared against its bar 0 pivot (284.58, history before the
 *  window) and drew no colour; ours compared against a bar before the window and
 *  drew blue — on CP, BC, TC, D-S1 and D-R1, bar 1 only. The colour there is
 *  exactly as unknowable as a value inside the value's warm-up, and it is excused
 *  by the same rule: no further, and never on a capture from the listing.
 *  ⛔ ONLY THE COLOUR: the value is still compared from `warmupBars` on. */
export function colourWarmupOf({ bar0, capture, warmupBars, colorLookback, replayedBars = 0 }) {
  if (bar0) return warmupBars
  if (capture && capture.warmup && Number.isInteger(capture.warmup.bars)) return warmupBars
  // ⭐ DIV-1 — our side replayed `replayedBars` of proved prehistory first, so the
  // colour rule's reach is covered for that many bars too (as the value's is).
  const reach = Number.isInteger(colorLookback) ? Math.max(0, colorLookback - (replayedBars > 0 ? replayedBars : 0)) : null
  return reach !== null && reach > warmupBars ? reach : warmupBars
}

/** The provenance block as words: `index:fmp-rollup 812/830 equal (worst 1.2e-3)`. */
export function provenanceText(prov) {
  return Object.entries(prov || {}).map(([k, b]) => `${k} ${b.equal}/${b.compared} equal (worst ${Number(b.worst).toExponential(1)})`).join('; ')
}

/** One plot's verdict from its comparison, with the reason written out. */
export function plotVerdict(r, { colorMeasured, colorResolvable, vendorColorReason = null, ourColorReason = null, ourColorWithheldBy = null }) {
  if (r.vendorRowGapsAfterStart > 0) {
    return { verdict: 'INCONCLUSIVE', reason: `${r.vendorRowGapsAfterStart} bars have no vendor row after the study had started — a hole in what was read, not an answer` }
  }
  if (r.steady.divergent > 0) {
    const f = r.steady.first
    const p = r.steady.pattern
    const shape = p && p.kind === 'converging-prefix'
      ? ` — a CONVERGING PREFIX: bars ${f.bar}..${p.lastDivergentBar}${p.contiguous ? '' : ' (with agreeing bars inside the run)'} differ with |err| falling ${p.absErrFirst.toExponential(2)} → ${p.absErrLast.toExponential(2)}, then all ${p.agreeingAfter} later bars agree (the recursive-state-seeded-at-the-window signature)`
      : p ? ` — ${p.kind}, last at bar ${p.lastDivergentBar}` : ''
    const also = r.roundingEqual && r.roundingEqual.steady > 0
      ? `; ${r.roundingEqual.steady} more differ only by index rounding, counted apart (rounding-equal ${roundingText(r.roundingEqual)})` : ''
    return { verdict: 'DIVERGE', reason: `${r.steady.divergent} steady-state bars disagree; first at bar ${f.bar} (${readingOf(f)})${shape}${also}` }
  }
  // ⭐⭐ INDEX ROUNDING: a plot whose ONLY steady divergences are rounding-equal is never MATCH. It stays DIVERGE, the
  // class named (checked before Guard 1, as a measured divergence is: a difference is reported over "too few bars")
  if (r.roundingEqual && r.roundingEqual.steady > 0) {
    const re = r.roundingEqual
    const f = re.first
    return { verdict: 'DIVERGE', reason: `${re.steady} steady-state bars differ, every one ROUNDING-EQUAL (index rounding: within `
      + `one index tick through the ratio, |rel| <= ${INDEX_TICK_REL} / X(t); ${roundingText(re)}); first at bar ${f.bar} `
      + `(value: vendor ${fmt(f.vendor)} vs ours ${fmt(f.ours)}, index ${fmt(f.index)}); never a MATCH` }
  }
  // ⛔ GUARD 1 (index provenance): a plot with provenance bars speaks only for its Yahoo-sourced bars, which must reach
  // the floor on their own (checked before "no bar compared", so a wholly-provenance plot names why)
  const provN = r.provenance ? Object.values(r.provenance).reduce((a, b) => a + b.compared, 0) : 0
  if (provN > 0 && r.steady.compared < PROVENANCE_SOURCED_MIN) {
    return { verdict: 'INCONCLUSIVE', reason: `too few vendor-sourced bars; ${provN} compared under provenance `
      + `(${provenanceText(r.provenance)}), ${r.steady.compared} Yahoo-sourced (the floor is ${PROVENANCE_SOURCED_MIN})` }
  }
  if (r.steady.compared === 0) {
    return { verdict: 'INCONCLUSIVE', reason: r.compared === 0 ? 'no bar was compared' : 'every compared bar is inside the warm-up region — nothing in steady state to judge' }
  }
  // ⭐ ENGINE 56 — a bar our side withheld BY NAME where TradingView drew a value is not a
  // wrong value and not a match: the plot is INCONCLUSIVE, with the count, until it is served
  if (r.withheldVendorValued > 0) {
    return { verdict: 'INCONCLUSIVE', reason: `${r.steady.compared} compared bars agree; ${r.withheldVendorValued} bar(s) where TradingView draws a value are withheld by name on our side (not compared)` }
  }
  // ⛔ A COLOUR THE CAPTURE HOLDS BUT THE HARNESS COULD NOT DECODE IS NOT A MATCH.
  // ⚰️ It was: a palette-less colorer read `colors: null`, our side had colours,
  // and the plot graded MATCH having compared no colour on any bar.
  if (colorMeasured && vendorColorReason && (r.valued === undefined || r.valued > 0)) {
    return { verdict: 'INCONCLUSIVE', reason: `values agree, but the capture's per-bar colour could not be decoded — ${vendorColorReason}` }
  }
  // ⭐ …AND A PLOT THAT NEVER DRAWS HAS NO COLOUR TO DISAGREE ABOUT. When no bar
  // carries a vendor value in a known colour (every bar `na` — a plot gated off
  // by a default input, an intraday-only marker on a daily chart), nobody sees a
  // colour on either platform, so "our colour could not be resolved" is not a gap
  // in the comparison: it is complete on values alone.
  // ⛔ ONLY at zero. One vendor bar drawn in a known colour against an unresolved
  // colour on our side is INCONCLUSIVE exactly as before.
  if (colorMeasured && !colorResolvable && (r.colorComparable === undefined || r.colorComparable > 0)) {
    return { verdict: 'INCONCLUSIVE', reason: `values agree, but the capture records per-bar colour and our side's colour could not be resolved${ourColorReason ? ` (${ourColorReason})` : ''}` }
  }
  // ⭐ ENGINE 58 — a colour our side withheld by name on some bars TradingView
  // coloured: the bars it did colour agree, and the rest are not an answer.
  if (colorMeasured && r.colorWithheld > 0) {
    return { verdict: 'INCONCLUSIVE', reason: `values agree, and the colour agrees on ${r.colorCompared} bars; on ${r.colorWithheld} bars our side withheld it by name${ourColorWithheldBy ? ` (${ourColorWithheldBy})` : ''} — nothing is drawn there rather than a colour the script does not choose` }
  }
  return { verdict: 'MATCH', reason: `${r.steady.compared} steady-state bars agree`
    + (r.floatOrderFloorUsed ? ` (${r.floatOrderFloorUsed} of them within the float-order floor of the running total the plot is a linear combination of)` : '')
    + (r.warmup.divergent ? ` (${r.warmup.divergent} warm-up bars differ, reported separately)` : '')
    + (r.roundingEqual && r.roundingEqual.compared ? ` (${r.roundingEqual.compared} warm-up bars rounding-equal, reported separately)` : '') }
}

const fmt = (x) => (x === null || x === undefined ? 'na' : typeof x === 'number' ? String(x) : JSON.stringify(x))

/** One divergent bar's two readings, in the unit that disagreed. ⚰️ A colour
 *  divergence printed the two VALUES ("color: vendor 50 vs ours 50") — equal by
 *  construction, since a colour is only compared on a bar whose values agree —
 *  which reads as a harness that mistook a number for a colour. */
export function readingOf(f) {
  if (f && f.kind === 'color') {
    return `color: vendor ${f.vendorColor ?? 'none'} vs ours ${f.ourColor ?? 'none'} at value ${fmt(f.vendor)}`
  }
  return `${f.kind}: vendor ${fmt(f.vendor)} vs ours ${fmt(f.ours)}`
}

/** ⭐⭐ A POSITIVE `offset = N` IS IN OUR TREE, AND NOT IN THE VENDOR'S EXPORT.
 *
 *  Our translator writes `plot(x, offset = N)` as the column `x[N]` (what stands
 *  at bar j is bar j-N's value — the drawing). TradingView's study data holds
 *  the UNSHIFTED series, keyed to the bar that COMPUTED it, and draws it N bars
 *  right. Measured 2026-09-28 on position-size-calculator (`offset = 20`,
 *  `show_last = 20`): the vendor reads 0 on bars 0..19, where a displaced series
 *  would be na, and holds values on all 632 bars. The tree alone cannot tell
 *  `offset = N` from `x[N]`, so the translator hands the shift over on the row
 *  (`_treeShift`), and this reads our column N bars AHEAD: ours'[i] = ours[i+N].
 *  Colours ride the same index — the point the renderer drew at bar i+N holds
 *  bar i's value, and its colour is the one being claimed.
 *  ⛔ The last N bars' values were never drawn on our chart (they sit right of
 *  the last bar), so they are UNREAD, counted, and never graded — not "na". */
export function leadBy(arr, n) {
  if (!arr || !n) return arr
  return Array.from({ length: arr.length }, (_, i) => (i + n < arr.length ? arr[i + n] : undefined))
}

// ── ONE CAPTURE ──────────────────────────────────────────────────────────────

/** TradingView keeps a plot's transparency (0..100) BESIDE an opaque colour;
 *  fold it into the alpha so it compares with our `opacity`. ONE rule for the
 *  static-colour path and the colorer path. */
function withStyleTransparency(c, style) {
  if (c && c.endsWith('ff') && style && Number.isFinite(style.transparency) && style.transparency > 0) {
    const a = Math.round(((100 - style.transparency) / 100) * 255).toString(16).padStart(2, '0')
    return `${c.slice(0, 7)}${a}`
  }
  return c
}

/** The vendor's per-bar colour for a value plot, or null when no colour was
 *  captured. A colorer's value is a palette INDEX (through `valToIndex` when the
 *  palette declares one); a plot with no colorer wears its style colour. */
export function vendorColorsFor(capture, valuePlot, colorers, rowsByTime, times) {
  const study = capture.study || {}
  const colorer = colorers.find((c) => c.target === valuePlot.id)
  const style = (study.styleState && study.styleState[valuePlot.id]) || null
  if (colorer && (colorer.palette === undefined || colorer.palette === null)) {
    // ⭐ NO PALETTE ⇒ THE VALUE IS THE COLOUR (`decodePackedColour`). The plot's
    // style transparency folds in by the SAME rule as the palette path below.
    const out = times.map((t) => {
      const row = rowsByTime.get(String(t))
      if (!row) return undefined
      const raw = row[colorer.column]
      if (raw === undefined) return undefined
      if (raw === null) return NO_COLOUR // the `na` colour — see the palette path below
      return withStyleTransparency(decodePackedColour(raw), style)
    })
    const bad = out.findIndex((c) => c === null)
    if (bad >= 0) {
      return { colors: null, measured: true, reason: `colorer ${colorer.id} has no palette and its value ${JSON.stringify(rowsByTime.get(String(times[bad]))[colorer.column])} at bar ${bad} is not a packed colour` }
    }
    return { colors: out, measured: true, reason: null }
  }
  if (colorer) {
    const pid = colorer.palette
    // The RESOLVED colours are the study's property state (what the member's
    // chart wears); `metaInfo().defaults` is the fallback. `valToIndex` lives on
    // `metaInfo().palettes` only.
    const statePal = study.paletteState && study.paletteState[pid]
    const metaPal = study.palettes && study.palettes[pid]
    const colorsTable = (statePal && statePal.colors) || (metaPal && metaPal.colors) || null
    if (!colorsTable) return { colors: null, measured: true, reason: `colorer ${colorer.id} names palette ${pid}, which the capture does not carry` }
    const v2i = (metaPal && metaPal.valToIndex) || (statePal && statePal.valToIndex) || null
    // ⛔ THE PLOT'S OWN STYLE TRANSPARENCY APPLIES TO A COLORER'S COLOURS TOO.
    // TradingView keeps the palette entries opaque and draws them at the plot's
    // `transparency`. Measured 2026-09-27 on Cumulative Volume Delta's histogram
    // (`transp=61`, palette `#FF5252`/`#4CAF50`, style transparency 61): folding
    // it only on the static-colour path graded a correct `#ff525263` as wrong.
    const colorOf = (idx) => {
      const c = colorsTable[idx]
      return withStyleTransparency(normalizeColor(c && typeof c === 'object' ? c.color : c), style)
    }
    const out = times.map((t) => {
      const row = rowsByTime.get(String(t))
      if (!row) return undefined
      const raw = row[colorer.column]
      if (raw === undefined) return undefined
      // ⭐⭐ A COLORER THAT READS `null` ON A BAR THE STUDY REPORTED IS THE `na`
      // COLOUR — TradingView drew nothing there. ⚰️ It was read as "no colour
      // captured" and skipped, so a line WE drew where TradingView drew none
      // graded MATCH. Measured 2026-09-28 (RDDT 1D): Ultimate Pivot Points'
      // `x == nz(x[1]) ? color.new(color.green, 10) : na` reads palette index 4
      // on the one bar where x repeats and `null` on the other 630 — its palette
      // has no entry for the `na` branch at all; Artemis' `adaptZones ?
      // color.new(thOb, 0) : na` (adaptZones defaults false) reads `null` on all
      // 632 bars of a line TradingView leaves invisible, while its VP Bull
      // colorer reports a colour even on bars whose VALUE is na — so `null` is
      // the colour, not a missing row.
      if (raw === null) return NO_COLOUR
      const idx = v2i && v2i[raw] !== undefined ? v2i[raw] : raw
      return colorOf(idx)
    })
    return { colors: out, measured: true, reason: null }
  }
  if (style && typeof style.color === 'string') {
    const c = withStyleTransparency(normalizeColor(style.color), style)
    return { colors: times.map(() => c), measured: c !== null, reason: c ? null : `unreadable style colour ${style.color}` }
  }
  return { colors: null, measured: false, reason: 'no colour captured for this plot' }
}

/**
 * The whole capture.
 *
 * @param {object} capture  a v1 capture (already validated by the caller; the
 *        schema/receipt outcome is passed in as `integrity`)
 * @param {object} ours     from the runner: `{ok, refusal, plots:[{title,
 *        formula, key, column, colors, lookback, drawn}], objects}`
 * @param {object} [opts]
 * @param {{ok:boolean, errors:string[]}} [opts.integrity]
 */
export function compareCapture(capture, ours, opts = {}) {
  const base = {
    id: capture && capture.id,
    script: capture && capture.study && decodeVendorText(capture.study.title || capture.study.shortDescription),
    symbol: capture && capture.symbol && (capture.symbol.pro_name || capture.symbol.name),
    timeframe: capture && capture.timeframe,
    format: capture && capture.adaptedFrom ? capture.adaptedFrom.format : 'harness-v1',
    ...(capture && capture.explains ? { explains: capture.explains } : {}),
    plots: [],
    notCompared: [],
    notMeasured: [],
  }
  const inconclusive = (reason) => ({ ...base, verdict: 'INCONCLUSIVE', reason })

  const integrity = opts.integrity || { ok: true, errors: [] }
  if (!integrity.ok) return inconclusive(`capture failed validation: ${integrity.errors.slice(0, 3).join('; ')}${integrity.errors.length > 3 ? ` (+${integrity.errors.length - 3} more)` : ''}`)
  // ⛔ v1 RUNS OUR SIDE AT THE SCRIPT'S DEFAULT INPUTS. A study the vendor ran
  // with an edited input is a different script as far as the numbers go, and
  // grading it against the defaults would report the edit as a divergence.
  const changed = nonDefaultInputs(capture)
  // ⭐⭐ SETTINGS PARITY (2c) — UNLESS OUR SIDE RAN AT THE SAME SETTINGS. `ourSide.js` now computes a
  // capture at the inputs TradingView recorded in it (`captureInputs.js`) and reports them
  // (`ours.capturedInputs`: Pine name -> the vendor's value, one per moved input); a capture whose
  // every moved input our side moved too is graded like any other, and says which settings it
  // graded (`settings`). One our side did not move, or could not, stays INCONCLUSIVE by name.
  const tookSettings = changed.length && ours && ours.ok && ours.capturedInputs
    && typeof ours.capturedInputs === 'object' && Object.keys(ours.capturedInputs).length === changed.length
  if (tookSettings) base.settings = { ...ours.capturedInputs }
  const movedText = changed.map((i) => `${i.name || i.id}=${JSON.stringify(i.value)} vs default ${JSON.stringify(i.defval)}`).join(', ')
  // ⭐ (track 4, 2026-11-22) OUR OWN REFUSAL IS NAMED FIRST. A capture taken at moved settings of a script our side
  // refuses was reported as "v1 compares at default inputs only — re-capture at defaults": the seven built-in VWAP
  // anchor rows (s4-vwap-anchors-retake3-2026-11-21) read so, though settings parity (2c) would have graded them and
  // the wall is our side's (the built-in VWAP is refused on both lanes). A re-capture at defaults would not move them.
  // The moved settings stay in the sentence, so neither cause is lost.
  if (!ours || !ours.ok) {
    return inconclusive(`refused on our side: ${(ours && ours.refusal) || 'no result'}`
      + (changed.length ? ` (the vendor study also ran with non-default inputs: ${movedText})` : ''))
  }
  if (changed.length && !tookSettings) return inconclusive(`the vendor study ran with non-default inputs (${movedText}); v1 compares at default inputs only — re-capture at defaults`)
  // ⭐ L7 — a substituted input must have been FED the vendor's own value, or nothing below
  // proves the engine (`substitutionProblems`).
  const subProblems = substitutionProblems(capture, ours.substituted)
  if (subProblems.length) return inconclusive(`substituted inputs: ${subProblems.join('; ')}`)
  const substituted = Array.isArray(ours.substituted) && ours.substituted.length ? substitutedRecord(ours.substituted) : null

  const tol = tolerancePolicy(capture)
  base.tolerance = tol
  const times = capture.bars.rows.map((r) => r[0])
  // SUPPLY BEHIND THE CAPTURE: ONLY the newest bar, ONLY when `supplyBehindOf` found its supply behind it
  const supplyBehind = opts.supplyBehind || null
  const behindBars = supplyBehind && times.length ? times.map((_, i) => i === times.length - 1) : null
  // ⭐⭐ INDEX PROVENANCE: one mask for the capture (every plot of a script that reads the series depends on it)
  const provenanceBars = provenanceBarsOf(times, ours.indexProvenance, { intraday: isIntradayCapture(capture) })
  // ⭐⭐ INDEX ROUNDING: our side's index read X(t) on every capture bar (`indexReadValues`); a capture that reads no index,
  // or a column not aligned with these bars, carries none and grades exactly as before (fail closed)
  const indexRead = Array.isArray(ours.indexReadValues) && ours.indexReadValues.length === times.length ? ours.indexReadValues : null
  const rowsByTime = new Map((capture.plotValues.rows || []).map((r) => [String(r[0]), r]))
  const roles = vendorPlotRoles(capture)
  for (const p of roles.notDrawn) base.notCompared.push({ id: p.id, title: p.title, type: p.type, why: 'alertcondition — draws nothing on TradingView either; not a visual claim' })
  // ⭐ e97 U5 — a candle colour keeps its own sentence ("not compared (phase A)"); every other type reads as before
  for (const p of roles.notCompared) base.notCompared.push({ id: p.id, title: p.title, type: p.type, why: p.candleColour ? p.why : `plot type ${p.type} is not compared by v1` })

  // History: a capture that provably starts at bar 0 has no pre-window state our
  // side lacks, so there is no warm-up excuse and every bar counts.
  // ⛔⛔ read through `history_claim.mjs`: a claim the capture's own bar_index row contradicts is FALSE
  const bar0 = startsAtBar0Holds(capture)

  // ⭐⭐ e97 U5 (phase A) — candles are paired by their own rule (`pairCandles`) and graded below as value plots;
  // our candle parts are kept out of `mapPlots`' pool, whatever the capture holds.
  const candleMap = pairCandles(roles.candles, ours.plots || [])
  const map = mapPlots(roles.value, (ours.plots || []).filter((o) => !isOurCandlePart(o)))
  map.pairs.push(...candleMap.pairs)
  map.unmappedVendor.push(...candleMap.unmappedVendor)
  for (const o of candleMap.unmappedOurs) {
    base.notCompared.push({ ours: o.key, title: o.title, why: `our ${o.kind} ${o.role ?? ''} has no vendor candle it can be paired with` })
  }
  for (const u of map.unmappedVendor) {
    base.plots.push({ id: u.vendor.id, title: u.vendor.title, verdict: 'INCONCLUSIVE', reason: `UNMAPPED — ${u.reason}` })
  }
  for (const pair of map.pairs) {
    const v = pair.vendor
    const o = pair.ours
    // ⭐ A SHAPE OR CHARACTER MARKER IS DRAWN OR IT IS NOT. TradingView reports a
    // plotshape/plotchar series as 0 on a bar where the condition is false — and
    // also during warm-up, where Pine's `and`/`or` read an `na` operand as false —
    // while an engine that carries the `na` reports na. Both draw NOTHING. Measured
    // 2026-09-27 (live captures): EngulfingCandle 16/631 and ATR Trailing
    // Stoploss 1/631 bars were `vendor 0 vs ours na`, identical on the chart.
    // ⛔ ONLY `shapes`/`chars`, and ONLY 0-vs-na: a marker on the wrong bar (1 vs 0,
    // or 1 vs na) still diverges, and `arrows` carry a sign and are left alone.
    const drawnOnly = v.type === 'shapes' || v.type === 'chars'
    const notDrawn = (x) => (drawnOnly && x === 0 ? null : x)
    // ⭐⭐ A NATIVE CAPTURE'S MISSING ROW IS AN ANSWER: every plot was `na`.
    // TradingView's study store keeps a row only when at least one plot has a
    // value. Measured live 2026-09-27 (probe-sparse-rows-rddt-1d-2026-09-27.json):
    // `plot(bar_index % 2 == 0 ? na : close)` over 631 bars stored exactly the 315
    // odd bars. So for a harness-v1 capture a bar with no row reads `na` on every
    // plot — and QQE Signals (30 rows) / Trendlines (266 rows) become comparable
    // instead of "a hole in what was read".
    // ⛔ ADAPTED legacy formats keep the conservative reading: their row sets were
    // assembled by other readers whose gaps may be genuine holes.
    const sparseNative = !capture.adaptedFrom
    const vendorVals = times.map((t) => {
      const row = rowsByTime.get(String(t))
      if (row) return notDrawn(row[v.column])
      return sparseNative ? null : undefined
    })
    // ⭐ 2026-11-09 — a plot our side WITHHELD BY NAME on every bar (`withheldBy`, a
    // chart-clock code) is graded the way a missing column is: not compared, with the
    // reason. ⚰️ Graded as its all-`na` column it read DIVERGE — the verdict a WRONG
    // value gets — on 13 captures (triage lane WN, 2026-11-08).
    // ⭐ e97 U5 — a candle our door did not draw is graded by the DOOR'S reason (`ourSide.js::candleNotDrawnOf`: hidden
    // by its author, or withheld by name), never as "a missing column": INCONCLUSIVE, with that sentence.
    if (v.candlePart && o.candleNotDrawn && !o.column) {
      base.plots.push({ id: v.id, title: v.title, ours: o.key || null, rule: pair.rule, verdict: 'INCONCLUSIVE',
        candleNotDrawn: o.candleNotDrawn, reason: o.missingReason })
      continue
    }
    if (!o.column || o.withheldBy) {
      base.plots.push({ id: v.id, title: v.title, ours: o.key || null, rule: pair.rule, verdict: 'INCONCLUSIVE',
        ...(o.withheldBy ? { withheld: o.withheldBy } : {}),
        reason: `our side produced no column for this plot${o.missingReason ? ` — ${o.missingReason}` : ''}` })
      continue
    }
    // ⭐ e97 U5 (phase A) — a candle part's colour is the candle's (its body / wick / border colorers, named
    // "not compared (phase A)"), never the part's own style colour, which draws nothing.
    const vc = v.candlePart ? { colors: null, measured: false, reason: null, candle: true }
      : vendorColorsFor(capture, v, roles.colorers, rowsByTime, times)
    const treeShift = Number.isInteger(o.treeShift) && o.treeShift > 0 ? o.treeShift : 0
    const ourColors = vc.measured ? (leadBy(o.colors, treeShift) || null) : null
    let warmupBars
    let warmupSource
    if (bar0) { warmupBars = 0; warmupSource = 'capture starts at bar 0 — no warm-up excuse' }
    else if (capture.warmup && Number.isInteger(capture.warmup.bars)) { warmupBars = capture.warmup.bars; warmupSource = `declared by the capture (${capture.warmup.source || 'unstated'})` }
    // ⭐⭐ DIV-1 (2026-11-09) — OUR SIDE HAD THE HISTORY TRADINGVIEW HAD. `ourSide.js`
    // computed this plot over [proved prehistory + window] (`warmBarsSupply`, the RC1
    // supplier), so the window's first bars are no longer "computed from history
    // neither side holds": the excuse shrinks by the bars replayed (to 0 whenever the
    // replay reaches back past the plot's own lookback, i.e. every SPY 1D capture).
    else if (o.historyReplayed && Number.isInteger(o.historyReplayed.bars) && o.historyReplayed.bars > 0) {
      warmupBars = Number.isInteger(o.lookback) ? Math.max(0, o.lookback - o.historyReplayed.bars) : 0
      warmupSource = `our side replayed ${o.historyReplayed.bars} bars of proved prehistory (${o.historyReplayed.file}) before the window`
        + (Number.isInteger(o.lookback) ? ` against a maxLookback of ${o.lookback}` : '')
    }
    else if (Number.isInteger(o.lookback)) { warmupBars = o.lookback; warmupSource = 'derived: our evaluator\'s maxLookback for this plot' }
    else { warmupBars = 0; warmupSource = 'lookback unknown — no warm-up region' }
    const colorWarmupBars = colourWarmupOf({ bar0, capture, warmupBars, colorLookback: o.colorLookback,
      replayedBars: o.historyReplayed && Number.isInteger(o.historyReplayed.bars) ? o.historyReplayed.bars : 0 })
    const oursCol = leadBy(drawnOnly && o.column ? Array.from(o.column, notDrawn) : o.column, treeShift)
    // ⭐ A plot TradingView does not display (style `display: 0`, i.e. the author's
    // `display = display.none`) has no colour anyone sees, so its colour is not
    // graded. Its VALUES still are — they feed alerts and other plots.
    // ⛔ The colours are withheld from comparePlot itself, not only from the
    // verdict: a stats block whose firstDivergence says "colour" for a plot whose
    // colour was not graded names the wrong disagreement to whoever reads it.
    const vStyle = (capture.study && capture.study.styleState && capture.study.styleState[v.id]) || null
    const hiddenOnVendor = !!(vStyle && vStyle.display === 0)
    // ⭐ …and the same for a `plotchar` whose glyph is EMPTY. `plotchar(x, "", "")`
    // is the idiom for a value that belongs in the data window and nowhere on
    // the chart: TradingView draws no glyph and no text, and still reports the
    // plot's colour on every bar. The capture records the glyph itself
    // (`metaInfo().styles[id].char`), so this reads the vendor's own statement —
    // measured on liquidation-levels-rddt-1d-2026-09-28 (`char: ""`, no `text`,
    // colour `#2962FF` on 632 bars of a glyph nobody can see).
    const metaStyle = (capture.study && capture.study.styles && capture.study.styles[v.id]) || null
    const emptyGlyph = v.type === 'chars' && !!metaStyle && metaStyle.char === '' && !metaStyle.text
    // ⭐ ENGINE 58 — a plot coloured `chart.fg_color` / `chart.bg_color` is drawn in
    // OUR chart's colour, not TradingView's theme: THEME-RELATIVE, the C37 rule the
    // object colours already follow (`objectTheme.js`; `themeRelative` agrees).
    // ⭐ …graded on its ALPHA byte alone (`alphaOnlyColour`): the transparency is the
    // script's, only the hue is the chart's.
    const themeRelative = o.colorsThemeRelative === true
    const colourUngraded = hiddenOnVendor || emptyGlyph
    const gradedVendorColors = themeRelative && vc.colors ? vc.colors.map(alphaOnlyColour) : vc.colors
    const gradedOurColors = themeRelative && ourColors ? ourColors.map(alphaOnlyColour) : ourColors
    // ⭐⭐ ENGINE 55 — the NEWEST bar our side withheld BY NAME (`withheldNewest`: the
    // `request:htf-newest-unconfirmed` code, a finished newest bar whose period end is
    // the next session's date) is not compared, exactly as a whole-series withholding
    // is not: our side drew nothing there, and drew it on purpose. Every other bar is.
    const unreadAfter = [treeShift ? times.length - treeShift : null, o.withheldNewest === true ? times.length - 1 : null]
      .filter((x) => x !== null)
    const plotArgs = { times, vendor: vendorVals, ours: oursCol, vendorColors: colourUngraded ? null : gradedVendorColors, ourColors: colourUngraded ? null : gradedOurColors, warmupBars, colorWarmupBars, tol, oursUnreadAfter: unreadAfter.length ? Math.min(...unreadAfter) : null,
      withheldBars: leadBy(o.withheldBars, treeShift) || null, floatOrderFloor: leadBy(o.floatOrderFloor, treeShift) || null, behindBars, provenanceBars, indexRead }
    let r = comparePlot(plotArgs)
    const verdictOpts = {
      colorMeasured: vc.measured && !colourUngraded,
      colorResolvable: !!ourColors,
      vendorColorReason: vc.measured && !vc.colors ? vc.reason : null,
      ourColorReason: o.colorsReason || null,
      ourColorWithheldBy: o.colorsWithheldBy || null,
    }
    let pv = plotVerdict(r, verdictOpts)
    // OTHER-SYMBOL UNSETTLED (see `unsettledRecord`): a zero-lookback plot whose ONLY steady divergences
    // (at most UNSETTLED_MAX_BARS, values) are bars where this capture's own read of another symbol is
    // contradicted by another committed TradingView witness of that symbol and date
    const ou = opts.otherSymbolUnsettled || null
    if (pv.verdict === 'DIVERGE' && ou && o.lookback === 0 && Array.isArray(r.steadyDivergent)
      && r.steadyDivergent.length && r.steadyDivergent.length <= UNSETTLED_MAX_BARS
      && r.steadyDivergent.every((d) => d.kind === 'value')) {
      const recs = []
      for (const d of r.steadyDivergent) {
        let rec = null
        for (const cand of ou.candidatesFor(d.time)) {
          const cf = cand.run()
          const co = cf && cf.ok ? (cf.plots || []).find((x) => x && x.key === o.key && x.column) : null
          const col = co ? leadBy(drawnOnly ? Array.from(co.column, notDrawn) : co.column, treeShift) : null
          if (col && !isNa(col[d.bar]) && !isNa(vendorVals[d.bar]) && valuesAgree(col[d.bar], vendorVals[d.bar], tol)) {
            rec = unsettledRecord({ symbol: ou.symbol, date: ou.dayOf(d.time), implied: cand.read,
              capture: { id: capture.id, capturedAtUTC: capture.capturedAtUTC || null }, witnesses: ou.witnessesFor(d.time) })
            break
          }
        }
        if (!rec) break
        recs.push({ bar: d.bar, time: d.time, ...rec })
      }
      if (recs.length === r.steadyDivergent.length) {
        const mask = times.map(() => false)
        for (const x of recs) mask[x.bar] = true
        r = comparePlot({ ...plotArgs, unsettledBars: mask })
        pv = plotVerdict(r, verdictOpts)
        pv = { ...pv,
          reason: `${pv.reason}; ${recs.length} bar(s) INCONCLUSIVE by name: TradingView's own captures disagree on ${ou.symbol} there (otherSymbolUnsettled)`,
          otherSymbolUnsettled: recs.map((x) => ({ verdict: 'INCONCLUSIVE', ...x })) }
      }
    }
    // SUPPLY-ATTRIBUTED (see `attributableToSupply`): rules 1 and 2 here, rule 3 on the counterfactual run
    const sa = opts.supplyAttribution || null
    if (pv.verdict === 'DIVERGE' && sa && attributableToSupply({ lookback: o.lookback, divergent: r.steadyDivergent,
      diffDays: sa.diffDays, dayOf: sa.dayOf })) {
      const cf = typeof sa.counterfactual === 'function' ? sa.counterfactual() : null
      const co = cf && cf.ok ? (cf.plots || []).find((x) => x && x.key === o.key && x.column) : null
      const cr = co ? comparePlot({ times, vendor: vendorVals, ours: leadBy(drawnOnly ? Array.from(co.column, notDrawn) : co.column, treeShift),
        vendorColors: null, ourColors: null, warmupBars, colorWarmupBars, tol,
        oursUnreadAfter: unreadAfter.length ? Math.min(...unreadAfter) : null,
        withheldBars: leadBy(co.withheldBars, treeShift) || null, floatOrderFloor: leadBy(co.floatOrderFloor, treeShift) || null, behindBars }) : null
      if (cr && cr.steady.divergent === 0 && cr.steady.compared > 0) {
        // ⭐ THE ROUNDING-EQUAL BARS ARE ATTRIBUTED TOO: the counterfactual run (no rounding bound: it is compared
        // without `indexRead`) agrees on EVERY bar, those included, so every steady bar that differed is the supply's;
        // the rounding column only says how many of them differed by no more than an index tick
        const rounded = r.roundingEqual ? r.roundingEqual.steady : 0
        const n = r.steady.divergent + rounded
        pv = {
          verdict: MATCH_SUBSTITUTED,
          reason: `${n} steady-state bars differ${rounded ? ` (${rounded} of them only by index rounding)` : ''}, every one a value on a date where UCT's ${sa.record.symbol} `
            + `(${sa.record.source}) differs from TradingView's (witness ${sa.record.witness.join(', ')}: `
            + `${sa.record.datesDiffer} of ${sa.record.datesCompared} dates differ); on the witness's values every bar agrees`,
          supplyAttributed: { ...sa.record, bars: n },
        }
      }
    }
    if (supplyBehind && r.supplyBehindBars) {
      const last = times.length - 1
      const { sentence, ...rec } = supplyBehind
      pv = { ...pv,
        reason: `${pv.reason}; the newest bar INCONCLUSIVE by name: ${sentence} (supplyBehind)`,
        supplyBehind: { verdict: 'INCONCLUSIVE', bar: last, time: times[last], ...rec } }
    }
    base.plots.push({
      id: v.id, title: v.title ?? o.title, ours: o.key, rule: pair.rule, ...pv,
      warmupBars, warmupSource, derivedLookback: Number.isInteger(o.lookback) ? o.lookback : null,
      ...(colorWarmupBars !== warmupBars ? { colorWarmupBars, colorWarmupSource: `derived: the colour rule's own maxLookback (${o.colorLookback})` } : {}),
      ...(treeShift ? { treeShift, treeShiftNote: `offset = ${treeShift}: our column read ${treeShift} bars ahead to meet the vendor's unshifted series; the last ${treeShift} bars are unread` } : {}),
      ...(o.withheldNewest === true ? { withheldNewest: 'request:htf-newest-unconfirmed', withheldNewestNote: 'the newest bar is withheld by name on our side (a finished bar whose week or month end is the date of the next session) and is not compared' } : {}),
      color: vc.candle ? 'not compared (phase A) — a candle\'s body, wick and border colours are the candle\'s colorers'
        : !vc.measured ? 'not captured'
        : colourUngraded ? (emptyGlyph ? 'not graded — an empty plotchar glyph draws nothing' : 'not graded — hidden on TradingView (display none)')
          : !vc.colors ? 'undecodable in the capture'
            : r.colorComparable === 0 ? 'nothing drawn on any bar — no colour to compare'
              : ourColors ? (themeRelative ? 'compared on alpha only — a theme reference (chart.fg_color / chart.bg_color) takes its hue from the chart (C37)' : 'compared') : 'unresolvable on our side',
      stats: r,
    })
  }
  for (const o of map.unmappedOurs) base.notCompared.push({ ours: o.key, title: o.title, why: 'our plot has no vendor counterpart (hidden helper or a plot TradingView did not report)' })

  // Objects — counts of what each side KEEPS, and the text they carry.
  // ⭐ OTHER-SYMBOL UNSETTLED, FOR THE DRAWINGS TOO (`unsettledBarsOf`): a drawing placed on a bar the plot grade
  // found unsettled is not compared, by the same name.
  if (capture.objects || (ours.objects && ours.objects.drawsObjects)) {
    base.objects = compareObjects(capture.objects || null, ours.objects || null, opts.objectColours || null, opts.objectRecords || null,
      unsettledBarsOf(base.plots, capture))
    // ⭐⭐ A v1 MATCH CANNOT STAND WHEN v2 DIVERGES (`v2Overrules`, coordinator ruling 2026-11-21)
    base.objects = v2Overrules(base.objects, opts.objectRecords || null, ours)
  }

  // Paints — `bgcolor` / `barcolor` (B1, step 61). Graded only where the caller
  // paired them (`opts.paints`, the runner's `paintColours.js::gradePaints`), and
  // a row exists only where either side paints at all.
  const paintRow = opts.paints ? comparePaints(opts.paints) : null
  if (paintRow) base.paints = paintRow

  if (!capture.plotValues || !capture.study) base.notMeasured.push('plot values')
  if (!roles.colorers.length && !Object.keys((capture.study && capture.study.styleState) || {}).length) base.notMeasured.push('colour')

  const plotVerdicts = base.plots.map((p) => p.verdict)
  const overallOf = (verdicts) => {
    const n = (x) => verdicts.filter((y) => y === x).length
    if (n('DIVERGE')) return { verdict: 'DIVERGE', reason: `${n('DIVERGE')} of ${verdicts.length} compared items diverge` }
    if (n('INCONCLUSIVE')) return { verdict: 'INCONCLUSIVE', reason: `${n('INCONCLUSIVE')} of ${verdicts.length} items could not be compared` }
    return { verdict: 'MATCH', reason: `all ${verdicts.length} items agree` }
  }
  // ⭐ B1 — the verdict BEFORE paints joined it is computed first and kept, so a
  // capture whose verdict moves because of a paint is named, never mistaken for
  // a regression elsewhere.
  const verdictsBeforePaints = base.objects ? [...plotVerdicts, base.objects.verdict] : plotVerdicts
  const paintJoins = !!(base.paints && base.paints.verdict)
  const verdicts = paintJoins ? [...verdictsBeforePaints, base.paints.verdict] : verdictsBeforePaints
  if (!verdicts.length) return { ...base, verdict: 'INCONCLUSIVE', reason: 'nothing on either side could be compared' }
  const out = { ...base, ...overallOf(verdicts) }
  if (paintJoins) {
    out.verdictWithoutPaints = verdictsBeforePaints.length
      ? overallOf(verdictsBeforePaints).verdict
      : 'INCONCLUSIVE'
  }
  // ⭐ C44 — BOTH NUMBERS, SIDE BY SIDE. Where object colour was graded, the
  // capture also carries the verdict it had BEFORE colour joined it, so a score
  // that moves because of colour is never mistaken for a regression: an entry
  // whose two verdicts differ changed for that reason and no other.
  // (Paints stay IN this one: each "without" number differs from the verdict by
  // its own cause and no other.)
  if (base.objects && base.objects.verdictWithoutColour) {
    out.verdictWithoutColour = overallOf([...plotVerdicts, base.objects.verdictWithoutColour, ...(paintJoins ? [base.paints.verdict] : [])]).verdict
  }
  // ⭐⭐ L7 — A RUN WITH SUBSTITUTED INPUTS NEVER READS MATCH. Applied LAST, after every
  // roll-up above, so DIVERGE / INCONCLUSIVE are decided exactly as before. Every plot is
  // relabelled too: the engine does not yet say which outputs a substitution reaches, so
  // every output is taken to (fail closed). The objects and paints sub-records keep their
  // own grades (other functions read them as inputs); the capture's verdict carries the tag.
  // SUPPLY-ATTRIBUTED — a capture with an attributed plot never reads MATCH (as L7 below)
  const attributed = base.plots.filter((p) => p.supplyAttributed)
  if (attributed.length) {
    out.supplyAttributed = { ...attributed[0].supplyAttributed, plots: attributed.map((p) => p.title ?? p.id) }
    delete out.supplyAttributed.bars
    out.verdict = asSubstituted(out.verdict)
    if (out.verdictWithoutPaints) out.verdictWithoutPaints = asSubstituted(out.verdictWithoutPaints)
    if (out.verdictWithoutColour) out.verdictWithoutColour = asSubstituted(out.verdictWithoutColour)
  }
  // SUPPLY BEHIND THE CAPTURE — the capture names the bar it could not judge and the plots it was withheld from;
  // the verdict is the other bars' (never lifted to MATCH by it, never lowered)
  const behind = base.plots.filter((p) => p.supplyBehind)
  if (behind.length) out.supplyBehind = { ...behind[0].supplyBehind, plots: behind.map((p) => p.title ?? p.id) }
  if (substituted) {
    out.substituted = substituted
    out.verdict = asSubstituted(out.verdict)
    if (out.verdict === MATCH_SUBSTITUTED) out.reason = `${out.reason}, with substituted inputs fed the vendor's value (${substituted.map((e) => e.name).join(', ')}); the UCT data a member is served is not proven`
    if (out.verdictWithoutPaints) out.verdictWithoutPaints = asSubstituted(out.verdictWithoutPaints)
    if (out.verdictWithoutColour) out.verdictWithoutColour = asSubstituted(out.verdictWithoutColour)
    out.plots = out.plots.map((p) => (p.verdict === 'MATCH' ? { ...p, verdict: MATCH_SUBSTITUTED } : p))
  }
  // ⭐⭐ T4 B2 (coordinator ruling 2026-11-22) — A RUN THAT READS UCT BREADTH NEVER READS MATCH. A `USI:` spelling is served
  // from UCT's own counts (`app/src/components/chart/engine/pineBreadth.js`), which differ from the exchanges' official
  // issue counts by construction: an all-agree grade is MATCH_SUBSTITUTED, anything else stays what it is (a DIVERGE is
  // the named divergence the reason carries). Fail closed, as L7: every plot is relabelled. `ours.breadth` is our side's
  // own report (`{spellings, words}`: the engine's words, never restated here).
  const breadth = ours && ours.breadth && Array.isArray(ours.breadth.spellings) && ours.breadth.spellings.length ? ours.breadth : null
  if (breadth) {
    out.breadthRead = { spellings: [...breadth.spellings], words: String(breadth.words || '') }
    out.verdict = asSubstituted(out.verdict)
    const said = `${out.breadthRead.words} (${out.breadthRead.spellings.join(', ')})`
    out.reason = out.verdict === MATCH_SUBSTITUTED ? `${out.reason}, on ${said}` : `${out.reason}; this script reads ${said}`
    if (out.verdictWithoutPaints) out.verdictWithoutPaints = asSubstituted(out.verdictWithoutPaints)
    if (out.verdictWithoutColour) out.verdictWithoutColour = asSubstituted(out.verdictWithoutColour)
    out.plots = out.plots.map((p) => (p.verdict === 'MATCH' ? { ...p, verdict: MATCH_SUBSTITUTED } : p))
  }
  // ⭐⭐ T4 F1b (Studio ruling 2026-11-14) — A RUN THAT READ UCT DATA IN PLACE OF TRADINGVIEW'S FIGURES NEVER READS
  // MATCH. Our side names each such read (`ours.uctData`: `[{name, source}]`, e.g. `request.financial` from company
  // filings) and was NOT fed the vendor's value, so nothing here can prove the number: whatever agreed is graded
  // INCONCLUSIVE, named a UCT-data substitution. Applied LAST, after L7, so DIVERGE is decided exactly as before, and
  // every plot is relabelled (which outputs a read reaches is not traced: fail closed).
  const uctData = uctDataOf(ours)
  if (uctData) {
    out.uctData = uctData
    const why = uctDataSentence(uctData)
    const agreed = (v) => v === 'MATCH' || v === MATCH_SUBSTITUTED
    if (agreed(out.verdict)) { out.verdict = 'INCONCLUSIVE'; out.reason = why }
    if (agreed(out.verdictWithoutPaints)) out.verdictWithoutPaints = 'INCONCLUSIVE'
    if (agreed(out.verdictWithoutColour)) out.verdictWithoutColour = 'INCONCLUSIVE'
    out.plots = out.plots.map((p) => (agreed(p.verdict) ? { ...p, verdict: 'INCONCLUSIVE', reason: why, uctData: true } : p))
  }
  return out
}

/** ⭐⭐ T4 F1b — our side's UCT-data reads (`[{name, source}]`), or null when it read none. A malformed entry still
 *  counts (it can only take a MATCH away, never give one). */
export function uctDataOf(ours) {
  const list = ours && Array.isArray(ours.uctData) ? ours.uctData : []
  if (!list.length) return null
  return list.map((e) => ({ name: e && typeof e.name === 'string' && e.name ? e.name : 'a UCT data read',
    source: e && typeof e.source === 'string' && e.source ? e.source : 'UCT data' }))
}

/** The words a UCT-data substitution is graded with. */
export function uctDataSentence(uctData) {
  return `a UCT-data substitution: ${uctData.map((e) => `${e.name} reads ${e.source}`).join('; ')}; it is never graded `
    + "as TradingView's figures, so nothing here counts MATCH"
}

/** The member-visible inputs whose captured value differs from the declared
 *  default. Hidden inputs (TradingView's own `pineId`, `text`, …) are ignored;
 *  an input whose value was not read (`null`) is not evidence of a change. */
export function nonDefaultInputs(capture) {
  const inputs = (capture && capture.study && capture.study.inputs) || []
  return inputs.filter((i) => i && !i.isHidden && i.value !== null && i.value !== undefined
    && JSON.stringify(i.value) !== JSON.stringify(i.defval))
}

// ── OBJECT COLOUR (C44) ──────────────────────────────────────────────────────
//
// ⭐⭐ AN OBJECT FAMILY GRADES MATCH ONLY WHEN ITS COLOURS AGREE TOO (integrator
// ruling 2026-10-01 on the question C37 left: `colourColumn.js` was a census,
// and a drawing in the wrong colour graded MATCH). The pairing is the runner's
// (`vendorHarness/objectColours.js::pairObjects` — every live object paired with
// the capture's own record BY VALUE, one row per colour slot); this function
// says, ONCE, what each slot state means for the verdict:
//
//   agree, agreeByDefault   agrees
//   themeRelative           agrees — `chart.fg_color` / `chart.bg_color` are the
//                           colours of the chart the script runs on; the capture
//                           records TradingView's theme and our chart wears its
//                           own, so the slot is correct in OUR colours and is
//                           not compared with the capture's (§ C37)
//   carriedDiffers          DIFFERS — we carry a colour and it is not the vendor's
//   notCarried              DIFFERS — the script names one, we carry none, and
//                           the default drawn in its place is not the vendor's
//   vendorUndecodable       NOT GRADED — a verdict about the capture's encoding,
//                           not about either engine; counted and reported
//   undrawn                 NOT GRADED — the object is held at an `na` coordinate
//                           on BOTH sides, so neither platform draws it and a
//                           member sees nothing (integrator ruling: the verdict
//                           measures what a member sees). ⛔ COUNTED, never
//                           dropped: `undrawn` slots and, of those, how many hold
//                           a colour that differs (`undrawnDiffering`, with the
//                           first one named) stay in the row and in the reason,
//                           so a difference in HELD state stays on the books
//
// One row per object family that paired at least one slot. A family that paired
// none has no row: nothing was graded, and nothing is claimed.
// ⛔ ONLY PAIRED OBJECTS ARE GRADED. An object our side holds that no vendor
// record matches by value is `unpaired` (reported): its position or text already
// differs, which is the count / text rows' business (and v1 compares no
// coordinate).
const COLOUR_FAMILY_OF = Object.freeze({ line: 'lines', label: 'labels', box: 'boxes', table: 'tables', cell: 'tableCells' })
const COLOUR_FAMILY_ORDER = Object.freeze(['lines', 'labels', 'boxes', 'tables', 'tableCells'])
const COLOUR_AGREES = new Set(['agree', 'agreeByDefault', 'themeRelative'])
const COLOUR_DIFFERS = new Set(['carriedDiffers', 'notCarried'])
const COLOUR_UNGRADED = new Set(['vendorUndecodable'])
const COLOUR_UNDRAWN = 'undrawn'

export function objectColourRows(pairing) {
  const by = new Map()
  for (const r of (pairing && pairing.rows) || []) {
    const family = COLOUR_FAMILY_OF[r.kind]
    // ⛔ FAIL CLOSED: a kind or a state this table does not name is never
    // quietly read as agreeing.
    if (!family) throw new Error(`object colour: unknown object kind ${JSON.stringify(r.kind)}`)
    if (!by.has(family)) {
      by.set(family, { family: `${family} colour`, agree: null, slots: 0, agreeing: 0, themeRelative: 0, differing: 0, undecodable: 0, undrawn: 0, undrawnDiffering: 0, first: null, firstUndrawn: null })
    }
    const row = by.get(family)
    row.slots += 1
    if (COLOUR_DIFFERS.has(r.state)) {
      row.differing += 1
      if (!row.first) row.first = { slot: `${r.kind}.${r.slot}`, state: r.state, vendor: r.vendor, ours: r.ours, where: r.where }
    } else if (r.state === COLOUR_UNDRAWN) {
      row.undrawn += 1
      if (COLOUR_DIFFERS.has(r.wouldBe)) {
        row.undrawnDiffering += 1
        if (!row.firstUndrawn) row.firstUndrawn = { slot: `${r.kind}.${r.slot}`, state: r.wouldBe, vendor: r.vendor, ours: r.ours, where: r.where }
      }
    } else if (COLOUR_UNGRADED.has(r.state)) {
      row.undecodable += 1
    } else if (COLOUR_AGREES.has(r.state)) {
      row.agreeing += 1
      if (r.state === 'themeRelative') row.themeRelative += 1
    } else {
      throw new Error(`object colour: unknown slot state ${JSON.stringify(r.state)}`)
    }
  }
  const rows = COLOUR_FAMILY_ORDER.filter((f) => by.has(f)).map((f) => by.get(f))
  for (const row of rows) row.agree = row.agreeing + row.differing === 0 ? null : row.differing === 0
  return rows
}

/** Objects: the LIVE set at the last bar on each side.
 *  @param {{rows: object[], unpaired: object}|null} [colour] the paired colour
 *    slots (C44). `null` — a caller that did not pair them — grades counts and
 *    texts only, exactly as before, and its reason reads as it always did. */
/** ⭐⭐ DISCLOSED PARTIAL — the guard a partly withheld family is graded under (`compareObjects`). */
export const OBJECTS_PARTIAL_GUARD = 'objects:partial'
/** ⭐⭐ …and the one it is graded under when a drawn record's PLACE (x) could not be compared: the capture predates the
 *  x table and has no sidecar (coordinator ruling 2026-11-19). Never a lift: `host_divergence.py` keeps a script's
 *  entry on this grade, and only a capture WITH the x table can lift it. */
export const OBJECTS_PARTIAL_UNPOSITIONED_GUARD = 'objects:partial-unpositioned'
/** The families a disclosed partial is graded on record by record (the ones v2 pairs by value). */
const PARTIAL_GRADED = new Set(['lines', 'labels', 'boxes'])
/** Does every record our side DRAWS in family `f` pair with one of TradingView's and agree field by field?
 *  `{agree, first}` — `first` names the first record that does not. Fails closed: no pairing, or any field that
 *  differs (x included), is not agreement. */
function drawnRecordsAgree(records, f) {
  const p = records && records.families ? records.families[f] : null
  if (!p) return { agree: false, first: 'no record of it was paired field by field' }
  // (every record of ours is paired: a partial holds fewer than TradingView, and `alignByValue` pairs the smaller side whole)
  let unpositioned = false
  for (const pair of p.pairs || []) {
    for (const r of pair.fields || []) {
      if (V2_DIFFERS.has(r.state)) return { agree: false, first: { field: r.field, vendor: r.vendor, ours: r.ours, where: pair.where, vendorId: pair.vendorId } }
      if (r.x === true && V2_X_MISSING.has(r.state)) unpositioned = true
    }
  }
  return { agree: true, first: null, unpositioned }
}
/** Is every item of `sub` in `all`, as many times (both sorted)? */
function subMultiset(sub, all) {
  const left = new Map()
  for (const x of all) left.set(x, (left.get(x) || 0) + 1)
  for (const x of sub) {
    const n = left.get(x) || 0
    if (!n) return false
    left.set(x, n - 1)
  }
  return true
}

// ── OTHER-SYMBOL UNSETTLED, FOR THE DRAWINGS (coordinator, 2026-11-21) ─────────────────────
//
// The plot grade leaves a bar UNSETTLED where TradingView's own captures disagree about another symbol's value there
// (`unsettledRecord`): that bar is not compared, by name. A drawing PLACED on such a bar reads the same unsettled value,
// so it is not compared either, by the same name: a paired record (lines, labels, boxes: `objectRecords.js::pairRecords`)
// any of whose x coordinates resolves, on either side, to an unsettled bar is taken out of the counts, the texts and the
// records before the drawing is graded, and named on the grade (`otherSymbolUnsettled`). The verdict follows from the
// drawings that remain; with none left on either side it is INCONCLUSIVE.
// ⚰️ rs-rating-fred6724-pm-alab-1d-2026-11-16: its plots agree on 667 of 668 bars and the newest is unsettled (SPX
// 7416.59 in this capture, 7561.67 in the other three of that date), yet the RS label drawn ON that bar graded DIVERGE
// (y 91.6678 vs 89.9090: exactly the SPX ratio; text "74" vs "69").
// ⛔ FAIL CLOSED: only PAIRED records are taken out (an unpaired one stays a count difference), a text that cannot be
// matched to the counted texts leaves the grade exactly as it was, and a colour the colour pairing grades is not touched.

// ── SUPPLY BEHIND THE CAPTURE, FOR THE DRAWINGS (coordinator ruling 2026-11-21) ──────────────────────────────────
//
// The plot grade leaves the forming newest bar INCONCLUSIVE by name when the other-symbol supply recorded beside the
// capture predates the session that bar read (`supplyAttribution.js::supplyBehindOf`, `supplyBehind`). A drawing PLACED
// on that bar reads the same value, so it is not compared either, by that name, the same way as an unsettled bar
// (`unsettledCutOf`), and named on the grade apart (`supplyBehind`).
// ⚰️ rs-rating-fred6724-w-{nvda,rddt}-1w-2026-11-17 (runtime-on): the two RS labels sit at `y = rs` on the forming week;
// TradingView's y equals its own RS Line on that bar exactly (62.2642 / 37.8408, read with the 2026-11-17 SPX close),
// ours read the harness's 2026-11-16 SPX: the y "differed" while x and the rating text agreed. v1, which compares no
// coordinate, read MATCH; v2 read DIVERGE. Neither was a judgement of that bar.

/** The capture-bar indexes the plot grade left unsettled (`otherSymbolUnsettled`, by time) or could not answer from
 *  the recorded supply (`supplyBehind`, the newest bar), each named with its rule, or null. */
export function unsettledBarsOf(plots, capture) {
  const recs = (plots || []).flatMap((p) => (p && Array.isArray(p.otherSymbolUnsettled) ? p.otherSymbolUnsettled : []))
  const behind = (plots || []).map((p) => p && p.supplyBehind).filter((s) => s && Number.isFinite(s.time))
  if (!recs.length && !behind.length) return null
  const rows = (capture && capture.bars && capture.bars.rows) || []
  const at = new Map(rows.map((r, i) => [r[0], i]))
  const bars = new Set()
  const names = new Map()
  for (const r of recs) {
    const i = at.get(r.time)
    if (!Number.isInteger(i)) continue
    bars.add(i)
    names.set(i, { time: r.time, symbol: r.symbol, date: r.date })
  }
  for (const s of behind) {
    const i = at.get(s.time)
    if (!Number.isInteger(i) || bars.has(i)) continue
    bars.add(i)
    names.set(i, { rule: 'supplyBehind', time: s.time, symbol: s.symbol, session: s.session, newestRow: s.newestRow })
  }
  return bars.size ? { bars, names } : null
}

const UNSETTLED_FAMILIES = ['lines', 'labels', 'boxes']

/** Both sides with the paired records placed on an unsettled bar taken out, and the list of what was, or null when
 *  nothing is taken out (or the cut cannot be made exactly: then the grade is the one it always was). */
export function unsettledCutOf(vendorObjs, ourObjs, records, unsettled) {
  if (!unsettled || !unsettled.bars || !unsettled.bars.size || !records || !records.families) return null
  if (!vendorObjs || !ourObjs || !ourObjs.ok || ourObjs.drawsObjects === false) return null
  const onUnsettled = (pair) => (pair.fields || []).some((r) => r.x === true
    && ((Number.isInteger(r.vendor) && unsettled.bars.has(r.vendor)) || (Number.isInteger(r.ours) && unsettled.bars.has(r.ours))))
  const excluded = []
  const families = { ...records.families }
  for (const f of UNSETTLED_FAMILIES) {
    const p = records.families[f]
    if (!p || !Array.isArray(p.pairs)) continue
    const out = p.pairs.filter(onUnsettled)
    if (!out.length) continue
    families[f] = { ...p, pairs: p.pairs.filter((x) => !onUnsettled(x)) }
    for (const pair of out) {
      const xr = (pair.fields || []).find((r) => r.x === true
        && ((Number.isInteger(r.vendor) && unsettled.bars.has(r.vendor)) || (Number.isInteger(r.ours) && unsettled.bars.has(r.ours))))
      const bar = unsettled.bars.has(xr.vendor) ? xr.vendor : xr.ours
      const text = (pair.fields || []).find((r) => r.field === 'text')
      excluded.push({ family: f, vendorId: pair.vendorId, ourId: pair.ourId, where: pair.where, bar, ...unsettled.names.get(bar),
        ...(text ? { vendorText: text.vendor, ourText: text.ours } : {}) })
    }
  }
  if (!excluded.length) return null
  const vCounts = { ...(vendorObjs.counts || {}) }
  const oCounts = { ...(ourObjs.counts || {}) }
  for (const e of excluded) {
    if (!Number.isFinite(vCounts[e.family]) || !Number.isFinite(oCounts[e.family])) return null
    vCounts[e.family] -= 1
    oCounts[e.family] -= 1
  }
  // a label's text leaves the counted texts with it: one occurrence each side, or no cut at all
  const drop = (list, x) => {
    const i = list.indexOf(x)
    if (i < 0) return false
    list.splice(i, 1)
    return true
  }
  const vTexts = { ...(vendorObjs.texts || {}) }
  const oTexts = { ...(ourObjs.texts || {}) }
  const labels = excluded.filter((e) => e.family === 'labels')
  if (labels.length) {
    const vt = Array.isArray(vTexts.labels) ? vTexts.labels.map(String) : null
    const ot = Array.isArray(oTexts.labels) ? oTexts.labels.map(String) : null
    if (vt && ot) {
      for (const e of labels) {
        if (typeof e.vendorText !== 'string' || typeof e.ourText !== 'string') return null
        if (!drop(vt, e.vendorText) || !drop(ot, e.ourText)) return null
      }
      vTexts.labels = vt
      oTexts.labels = ot
    }
  }
  const remaining = UNSETTLED_FAMILIES.concat(['tables', 'tableCells'])
    .reduce((n, f) => n + (Number.isFinite(vCounts[f]) ? vCounts[f] : 0) + (Number.isFinite(oCounts[f]) ? oCounts[f] : 0), 0)
  return {
    vendor: { ...vendorObjs, counts: vCounts, texts: vTexts },
    ours: { ...ourObjs, counts: oCounts, texts: oTexts },
    records: { ...records, families },
    excluded: excluded.map(({ vendorText, ourText, ...e }) => ({ verdict: 'INCONCLUSIVE', ...e })),
    remaining,
  }
}

/** @param {object|null} [records] `objectRecords.js::pairRecords`' pairing (by value where counts differ): a family
 *  our side drew fewer of BY NAME (`ourObjs.partialFamilies`, coordinator ruling 2026-11-19) is graded on what it
 *  draws. `null` grades exactly as before.
 *  @param {object|null} [unsettled] `unsettledBarsOf`: the drawings placed on those bars are not compared, by name. */
export function compareObjects(vendorObjs, ourObjs, colour = null, records = null, unsettled = null) {
  const cut = unsettledCutOf(vendorObjs, ourObjs, records, unsettled)
  if (!cut) return gradeObjects(vendorObjs, ourObjs, colour, records)
  const graded = gradeObjects(cut.vendor, cut.ours, colour, cut.records)
  const symbolsOf = (list) => [...new Set(list.map((e) => e.symbol).filter(Boolean))].join(', ') || 'another symbol'
  const osu = cut.excluded.filter((e) => e.rule !== 'supplyBehind')
  const behind = cut.excluded.filter((e) => e.rule === 'supplyBehind').map(({ rule, ...e }) => e)
  const parts = []
  if (osu.length) parts.push(`${osu.length} drawing object(s) placed on a bar where TradingView's own captures disagree on ${symbolsOf(osu)} are not compared (otherSymbolUnsettled)`)
  if (behind.length) {
    parts.push(`${behind.length} drawing object(s) placed on the forming newest bar, which the ${symbolsOf(behind)} supply recorded `
      + `beside this capture (newest row ${behind[0].newestRow}) cannot answer for session ${behind[0].session}, are not compared (supplyBehind)`)
  }
  const said = parts.join('; ')
  const named = { ...(osu.length ? { otherSymbolUnsettled: osu } : {}), ...(behind.length ? { supplyBehind: behind } : {}) }
  // (a DIVERGE that remains, a colour the colour pairing grades among them, is never softened)
  if (!cut.remaining && graded.verdict !== 'DIVERGE') {
    return { ...graded, verdict: 'INCONCLUSIVE', ...(graded.verdictWithoutColour ? { verdictWithoutColour: 'INCONCLUSIVE' } : {}),
      reason: `every drawing object is on such a bar: ${said}`, ...named }
  }
  return { ...graded, reason: `${graded.reason}; ${said}`, ...named }
}

function gradeObjects(vendorObjs, ourObjs, colour = null, records = null) {
  if (!vendorObjs) return { verdict: 'INCONCLUSIVE', reason: 'our side draws objects but the capture recorded none — re-capture with graphics' }
  // ⭐ OUR SCRIPT HAS NO DRAWING PROGRAM AT ALL. That is an answer, not a missing
  // one: if TradingView drew nothing either, the two agree; if it drew something,
  // we are missing drawings — a DIVERGE, measured. (Measured 2026-09-27: every
  // plot-only live capture read INCONCLUSIVE here while both sides drew zero.)
  if (ourObjs && ourObjs.drawsObjects === false) {
    const vc = vendorObjs.counts || {}
    const vendorTotal = ['lines', 'labels', 'boxes', 'tables', 'tableCells', 'linefills']
      .reduce((n, f) => n + (Number.isFinite(vc[f]) ? vc[f] : 0), 0)
    const unreadable = Array.isArray(vendorObjs.unreadable) && vendorObjs.unreadable.length
    if (unreadable) return { verdict: 'INCONCLUSIVE', reason: `our script draws no objects; the capture could not read ${vendorObjs.unreadable.join(', ')}` }
    if (vendorTotal === 0) return { verdict: 'MATCH', reason: 'neither side draws an object' }
    // ⭐ F3 — a drawing the door WITHHELD BY NAME is a gap with a name, not a
    // script without a drawing program (the same rule `comparePaints` applies to
    // a withheld paint).
    if (ourObjs.withheld) {
      return { verdict: 'DIVERGE', withheld: ourObjs.withheld, reason: `TradingView holds ${vendorTotal} drawing object(s) at the last bar and our drawing is withheld by name (${ourObjs.withheld}) — ${ourObjs.reason}` }
    }
    return { verdict: 'DIVERGE', reason: `TradingView holds ${vendorTotal} drawing object(s) at the last bar and our script has no drawing program` }
  }
  if (!ourObjs || !ourObjs.ok) return { verdict: 'INCONCLUSIVE', reason: `our object lane did not run: ${(ourObjs && ourObjs.reason) || 'no result'}` }
  const families = ['lines', 'labels', 'boxes', 'tables', 'tableCells']
  // ⭐ W-C22-DEL — a family our run WITHHELD WHOLE, by name (`withheldFamilies`,
  // runtime family names): not compared, and never part of a MATCH. A gap with a
  // name, the way F3 grades a withheld drawing — and where every other family
  // agrees the verdict is INCONCLUSIVE, since what TradingView holds of the
  // withheld family is not what we hold.
  const RUNTIME_FAMILY = { lines: 'line', labels: 'label', boxes: 'box', tables: 'table', tableCells: 'table' }
  const withheldFams = new Set(Array.isArray(ourObjs.withheldFamilies) ? ourObjs.withheldFamilies : [])
  // ⭐⭐ DISCLOSED PARTIAL (coordinator ruling 2026-11-19) — a family our side drew FEWER of than TradingView holds, BY
  // NAME (a create the program lost, an object the run withheld: `ourSide.js` `partialFamilies`), is graded on what it
  // DRAWS: every record of ours paired (by value) with one of TradingView's and agreeing field by field is a gap with a
  // name (WITHHELD, `objects:partial`), never a count DIVERGE; one record that does not agree is still a DIVERGE. A
  // family we hold MORE of, one nobody named, or one whose records were not paired, grades on its count as before.
  // ⚰️ rsi-support-resistance-by-dgt: its 5 level lines equal TradingView's bit for bit, its 200 oscillator lines and 5
  // labels are named at the door ("6 of 52 drawing elements aren't supported yet"), and it graded DIVERGE on count.
  const partialNamed = new Set(Array.isArray(ourObjs.partialFamilies) ? ourObjs.partialFamilies : [])
  const partialOf = (f) => partialNamed.has('*') || partialNamed.has(RUNTIME_FAMILY[f])
  const partial = new Map()
  const rows = []
  let diverge = 0
  let withheldHeld = 0
  for (const f of families) {
    const v = vendorObjs.counts ? vendorObjs.counts[f] : undefined
    const o = ourObjs.counts ? ourObjs.counts[f] : undefined
    if (withheldFams.has(RUNTIME_FAMILY[f])) {
      if (Number.isFinite(v) && v > 0) withheldHeld += 1
      rows.push({ family: f, vendor: v ?? null, ours: null, agree: null, withheld: true })
      continue
    }
    if (v === undefined || o === undefined) { rows.push({ family: f, vendor: v ?? null, ours: o ?? null, agree: null }); continue }
    const agree = v === o
    if (!agree && o < v && PARTIAL_GRADED.has(f) && partialOf(f)) {
      const drawn = drawnRecordsAgree(records, f)
      if (drawn.agree) {
        partial.set(f, { vendor: v, ours: o, unpositioned: drawn.unpositioned })
        rows.push({ family: f, vendor: v, ours: o, agree: null, withheld: true, partial: true, ...(drawn.unpositioned ? { unpositioned: true } : {}) })
        continue
      }
      diverge += 1
      rows.push({ family: f, vendor: v, ours: o, agree: false, partial: true, drawnDiffers: drawn.first })
      continue
    }
    if (!agree) diverge += 1
    rows.push({ family: f, vendor: v, ours: o, agree })
  }
  const textRows = []
  for (const f of ['labels', 'tableCells']) {
    if (withheldFams.has(RUNTIME_FAMILY[f])) continue
    const vt = vendorObjs.texts && vendorObjs.texts[f]
    const ot = ourObjs.texts && ourObjs.texts[f]
    if (!Array.isArray(vt) || !Array.isArray(ot)) continue
    const a = [...vt].map(String).sort()
    const b = [...ot].map(String).sort()
    // a disclosed partial's texts: every text we draw is one TradingView's holds (the rest are withheld by name)
    const agree = partial.has(f) ? subMultiset(b, a) : a.length === b.length && a.every((x, i) => x === b[i])
    if (!agree) diverge += 1
    textRows.push({ family: `${f} text`, agree, onlyVendor: a.filter((x) => !b.includes(x)).slice(0, 10), onlyOurs: b.filter((x) => !a.includes(x)).slice(0, 10) })
  }
  const measured = rows.filter((r) => r.agree !== null || r.partial).length + textRows.length
  if (!measured) return { verdict: 'INCONCLUSIVE', reason: 'no object family was recorded on both sides', counts: rows }
  // (a colour that differs on a family we DO draw still diverges)
  const shownColourDiffers = colour
    ? objectColourRows(colour).some((r) => r.agree === false && !withheldFams.has(RUNTIME_FAMILY[r.family]))
    : false
  if ((withheldHeld || partial.size) && !diverge && !shownColourDiffers) {
    const names = rows.filter((r) => r.withheld && !r.partial).map((r) => r.family).join(', ')
    const said = []
    let guards = []
    if (withheldHeld) {
      // ⭐ OZ — a family withheld by another named guard (`withheldGuards`) says that
      // guard and the member's sentence; the collector-only reason is unchanged.
      guards = Array.isArray(ourObjs.withheldGuards) && ourObjs.withheldGuards.length
        ? [...ourObjs.withheldGuards] : ['objects:collector']
      const onlyCollector = guards.length === 1 && guards[0] === 'objects:collector'
      said.push(onlyCollector
        ? `our ${names} are withheld by name (TradingView's object limit may have removed some of them; objects:collector)`
        : `our ${names} are withheld by name (${guards.join(', ')}: ${ourObjs.withheldWhy || 'no sentence'})`)
    }
    if (partial.size) {
      const each = [...partial].map(([f, c]) => `${f} ${c.ours} of ${c.vendor}`).join(', ')
      // ⛔ a drawn record whose PLACE (x) this capture cannot compare is not witnessed: its own grade, never a lift
      if ([...partial.values()].some((c) => c.unpositioned)) {
        guards.push(OBJECTS_PARTIAL_UNPOSITIONED_GUARD)
        said.push(`our drawing is a disclosed partial (${each} drawn): each one drawn pairs with a record of TradingView's and agrees on every field this capture can compare, but where it sits on the chart (x) is not in this capture (it predates the x table), so its place is not witnessed; the rest are withheld by name (${OBJECTS_PARTIAL_UNPOSITIONED_GUARD})`)
      } else {
        guards.push(OBJECTS_PARTIAL_GUARD)
        said.push(`our drawing is a disclosed partial (${each} drawn): each one drawn pairs with a record of TradingView's and agrees field by field, and the rest are withheld by name (${OBJECTS_PARTIAL_GUARD})`)
      }
    }
    return {
      verdict: 'INCONCLUSIVE',
      withheld: guards.join(','),
      reason: `${said.join('; ')}; every other object family's counts and texts agree`,
      counts: rows,
      texts: textRows,
      // the colours of what we DO draw, paired with TradingView's, are still graded
      // (a differing one would have made this a DIVERGE above)
      ...(colour ? { colours: objectColourRows(colour), colourUnpaired: colour.unpaired || null } : {}),
    }
  }
  if (!colour) {
    return {
      verdict: diverge ? 'DIVERGE' : 'MATCH',
      reason: diverge ? `${diverge} object families differ (count or text); coordinates are NOT compared by v1` : 'object counts and texts agree; coordinates are NOT compared by v1',
      counts: rows,
      texts: textRows,
    }
  }
  // ⭐ C44 — colour joins the verdict. `verdictWithoutColour` is the verdict
  // exactly as it was computed before (counts and texts), kept beside the new one.
  const colours = objectColourRows(colour)
  const colourDiverge = colours.filter((r) => r.agree === false)
  const graded = colours.reduce((n, r) => n + r.agreeing + r.differing, 0)
  const theme = colours.reduce((n, r) => n + r.themeRelative, 0)
  const undrawn = colours.reduce((n, r) => n + r.undrawn, 0)
  const undrawnDiffering = colours.reduce((n, r) => n + r.undrawnDiffering, 0)
  // ⛔ said in the reason, MATCH or not: held state that differs on objects nobody draws
  const undrawnSaid = undrawn
    ? `; ${undrawn} slot${undrawn === 1 ? '' : 's'} on objects neither side draws not graded${undrawnDiffering ? ` (${undrawnDiffering} of them hold a colour that differs)` : ''}`
    : ''
  const first = colourDiverge.length ? colourDiverge[0].first : null
  const colourSaid = !graded ? 'no colour slot was paired, so no colour was graded'
    : first
      ? `${colourDiverge.length} object ${colourDiverge.length === 1 ? 'family differs' : 'families differ'} in COLOUR (first: ${first.slot} of ${first.where} — vendor ${first.vendor ?? 'none'}, ours ${first.ours ?? 'none'}, ${first.state})`
      : `colours agree on ${graded} paired slots${theme ? ` (${theme} theme-relative)` : ''}`
  return {
    verdict: diverge || colourDiverge.length ? 'DIVERGE' : 'MATCH',
    verdictWithoutColour: diverge ? 'DIVERGE' : 'MATCH',
    reason: `${diverge ? `${diverge} object families differ (count or text)` : 'object counts and texts agree'}; ${colourSaid}${undrawnSaid}; coordinates are NOT compared by v1`,
    counts: rows,
    texts: textRows,
    colours,
    colourUnpaired: colour.unpaired || null,
  }
}

// ── OBJECTS v2 — EVERY PAIRED RECORD, FIELD BY FIELD ────────────────────────
//
// ⭐⭐ v1 (`compareObjects`) grades a drawing by its COUNTS, its TEXTS and (C44)
// the colours of objects it pairs BY VALUE. Nothing in v1 asks WHERE a drawing
// is: a line at the wrong price pairs with nothing, is filed `unpaired`, and the
// family still grades MATCH when the counts and texts agree. v2 pairs each of
// our records with the capture's record of the same family by CREATION ORDER
// and compares every field the capture holds.
//
// ⛔⛔ v2 IS A SEPARATE REPORT, NOT THE VERDICT. `compareCapture` and every
// ratchet keep reading v1; `harness.js::gradeCapture` hands v2 back beside the
// verdict (`objectsV2`). A stricter grade that silently replaced v1 would turn
// ratchets red on the progress they measure, or force them to be loosened.
//
// THE PAIRING (`vendorHarness/objectRecords.js`, the only reader of records):
//   lines, labels, boxes  equal counts: both sides sorted by id (creation order), paired in order.
//            ⭐⭐ COUNTS THAT DIFFER (coordinator ruling 2026-11-19): paired BY VALUE, never by position
//            (`objectRecords.js::alignByValue`): each record of the smaller side takes the record of
//            the other it agrees with best on every field the capture holds, ties going to the
//            newest-end position (the object limit takes the oldest). ⚰️ Aligned at the newest end,
//            rsi-support-resistance-by-dgt's 5 level lines (equal to TradingView's bit for bit) were
//            graded against its 5 newest oscillator lines. The extra records are counted `unpaired`.
//   tables   by creation order; cells by (paired table, column, row).
//   linefills by their two lines (one fill per pair of lines, Pine's rule), the
//            lines mapped through the line pairing.
//
// ⛔⛔ ONLY THE FIELDS THE CAPTURE HOLDS ARE GRADED, AND A FIELD IT LACKS IS NAMED.
// `tv_capture.js::readGraphics` records `_primitivesDataById` verbatim. Its `x`,
// `x1`, `x2` are small integers (0 … a few hundred on a 1,800-bar chart): a
// POSITION in the study's own `_indexes` table, whose entries are model bar
// indices (object-semantics-spy-1d-2026-09-08). Not a bar index, not a time.
// ⭐⭐ U13 (G1) — x IS GRADED, kind `x`: the vendor's position is resolved through
// the table the capture now records (`objects.xIndex`, `tv_capture.js::readXIndex`)
// to a bar of the capture's own window; ours through the bars our object lane ran
// on (`ourSide.js` `objects.xFrame`, both lanes), honouring `xloc` exactly as the
// render state places it (`objectRenderState.js::makeBarClock`). EXACT bar
// alignment: one bar off is a difference. A future bar is the window's length
// plus the bars past the last one, on both sides.
// ⛔ AN x NEITHER SIDE CAN RESOLVE IS NEVER A MATCH. A capture taken before U13
// holds no table, so its x is `xMissing` (named, counted), and a v2 MATCH needs
// every paired line / label / box to have its x graded: otherwise the capture is
// INCONCLUSIVE, with the reason. `verdictWithoutX` keeps the pre-U13 grade, so
// the two baselines are read side by side from ONE run.
// `xloc` itself is not recorded by the vendor: TradingView resolves both modes to
// a model bar, which is what the x grade compares.
//
// ⛔ A VENDOR CODE THIS TABLE CANNOT DECODE IS NOT GRADED (state `undecoded`,
// counted with the code). Read as a mismatch it would invent a defect; read as
// a match it would invent a pass.
//
// Each field: `vendor` key in the capture's record, `ours` property on our live
// object, `kind`:
//   price   `valuesAgree` under the capture's tolerance (na agrees only with na)
//   number  exact
//   enum    the vendor code decoded through `codes`, then exact
//   text    exact string
//   colour  the C44 reading (`objectColours.js`): theme-relative is not graded
//   x       a bar of the capture's window, both sides (U13): exact
// `default`: Pine's own default (v6 reference) for a property the script left
// unset, so our absent property is compared as what Pine draws.
const EXTEND_CODES = Object.freeze({ n: 'none', r: 'right', b: 'both' })
// ⛔ EVERY CODE BELOW IS WITNESSED: in the 2026-11-12 re-grade each one met ONLY
// that value of ours on paired records (docs/pine/evidence/2026-11-12-objects-v2).
// A code no paired record has shown (`l` for extend, `cir`, `ab`, `al` …) is left out on
// purpose: it reads `undecoded` (named, not graded) until a capture pairs it.
const LINE_STYLE_CODES = Object.freeze({ sol: 'solid', dsh: 'dashed', dot: 'dotted', ar: 'arrow_right' })
const LABEL_STYLE_CODES = Object.freeze({
  n: 'none', ldn: 'label_down', lup: 'label_up', lcn: 'label_center', llf: 'label_left', lrg: 'label_right',
})
const YLOC_CODES = Object.freeze({ pr: 'price', ab: 'abovebar', bl: 'belowbar' })
const SAME = (...names) => Object.freeze(Object.fromEntries(names.map((n) => [n, n])))
const SIZE_CODES = SAME('auto', 'tiny', 'small', 'normal', 'large', 'huge')
const HALIGN_CODES = SAME('left', 'center', 'right')
const VALIGN_CODES = SAME('top', 'center', 'bottom')
const WRAP_CODES = SAME('none', 'auto')
const POSITION_CODES = SAME('top_left', 'top_center', 'top_right', 'middle_left', 'middle_center', 'middle_right',
  'bottom_left', 'bottom_center', 'bottom_right')
const FONT_CODES = SAME('default', 'monospace')

const XLOC_UNRECORDED = 'TradingView records no xloc: it resolves both modes to a model bar, and that bar is graded as x (U13)'
export const OBJECTS_V2_FIELDS = Object.freeze({
  lines: Object.freeze({
    ourFamily: 'line',
    fields: Object.freeze([
      { field: 'x1', vendor: 'x1', ours: 'x1', kind: 'x' },
      { field: 'y1', vendor: 'y1', ours: 'y1', kind: 'price' },
      { field: 'x2', vendor: 'x2', ours: 'x2', kind: 'x' },
      { field: 'y2', vendor: 'y2', ours: 'y2', kind: 'price' },
      { field: 'extend', vendor: 'ex', ours: 'extend', kind: 'enum', codes: EXTEND_CODES, default: 'none' },
      { field: 'style', vendor: 'st', ours: 'style', kind: 'enum', codes: LINE_STYLE_CODES, default: 'solid' },
      { field: 'width', vendor: 'w', ours: 'width', kind: 'number', default: 1 },
      { field: 'color', vendor: 'ci', ours: 'color', kind: 'colour' },
    ]),
    vendorKeysNotGraded: Object.freeze(['fo']),
    ungraded: Object.freeze({ xloc: XLOC_UNRECORDED, force_overlay: 'recorded on some captures only (`fo`), and our side does not carry it' }),
  }),
  labels: Object.freeze({
    ourFamily: 'label',
    fields: Object.freeze([
      // y is graded only where the label is placed BY PRICE on both sides: at
      // abovebar / belowbar neither platform draws it at y.
      { field: 'x', vendor: 'x', ours: 'x', kind: 'x' },
      { field: 'y', vendor: 'y', ours: 'y', kind: 'price', onlyAtPrice: true },
      { field: 'yloc', vendor: 'yl', ours: 'yloc', kind: 'enum', codes: YLOC_CODES, default: 'price' },
      { field: 'text', vendor: 't', ours: 'text', kind: 'text', default: '' },
      { field: 'style', vendor: 'st', ours: 'style', kind: 'enum', codes: LABEL_STYLE_CODES, default: 'label_down' },
      { field: 'size', vendor: 'sz', ours: 'size', kind: 'enum', codes: SIZE_CODES, default: 'normal' },
      { field: 'textalign', vendor: 'ta', ours: 'textalign', kind: 'enum', codes: HALIGN_CODES, default: 'center' },
      { field: 'tooltip', vendor: 'tt', ours: 'tooltip', kind: 'text', default: '' },
      { field: 'color', vendor: 'ci', ours: 'color', kind: 'colour' },
      { field: 'textcolor', vendor: 'tci', ours: 'textcolor', kind: 'colour', onlyWithText: true },
    ]),
    vendorKeysNotGraded: Object.freeze(['fo']),
    ungraded: Object.freeze({ xloc: XLOC_UNRECORDED, text_font_family: 'not recorded by the capture', text_formatting: 'not recorded by the capture', force_overlay: 'recorded on some captures only (`fo`), and our side does not carry it' }),
  }),
  boxes: Object.freeze({
    ourFamily: 'box',
    fields: Object.freeze([
      { field: 'left', vendor: 'x1', ours: 'left', kind: 'x' },
      { field: 'top', vendor: 'y1', ours: 'top', kind: 'price' },
      { field: 'right', vendor: 'x2', ours: 'right', kind: 'x' },
      { field: 'bottom', vendor: 'y2', ours: 'bottom', kind: 'price' },
      { field: 'extend', vendor: 'ex', ours: 'extend', kind: 'enum', codes: EXTEND_CODES, default: 'none' },
      { field: 'border_style', vendor: 'st', ours: 'border_style', kind: 'enum', codes: LINE_STYLE_CODES, default: 'solid' },
      { field: 'border_width', vendor: 'w', ours: 'border_width', kind: 'number', default: 1 },
      { field: 'text', vendor: 't', ours: 'text', kind: 'text', default: '' },
      { field: 'text_size', vendor: 'ts', ours: 'text_size', kind: 'enum', codes: SIZE_CODES, default: 'auto', onlyWithText: true },
      { field: 'text_halign', vendor: 'tha', ours: 'text_halign', kind: 'enum', codes: HALIGN_CODES, default: 'center', onlyWithText: true },
      { field: 'text_valign', vendor: 'tva', ours: 'text_valign', kind: 'enum', codes: VALIGN_CODES, default: 'center', onlyWithText: true },
      { field: 'text_wrap', vendor: 'tw', ours: 'text_wrap', kind: 'enum', codes: WRAP_CODES, default: 'none', onlyWithText: true },
      { field: 'border_color', vendor: 'c', ours: 'border_color', kind: 'colour' },
      { field: 'bgcolor', vendor: 'bc', ours: 'bgcolor', kind: 'colour' },
      { field: 'text_color', vendor: 'tc', ours: 'text_color', kind: 'colour', onlyWithText: true },
    ]),
    vendorKeysNotGraded: Object.freeze([]),
    ungraded: Object.freeze({ xloc: XLOC_UNRECORDED, text_font_family: 'not recorded by the capture', text_formatting: 'not recorded by the capture', force_overlay: 'not recorded by the capture for boxes' }),
  }),
  tables: Object.freeze({
    ourFamily: 'table',
    fields: Object.freeze([
      { field: 'position', vendor: 'pos', ours: 'position', kind: 'enum', codes: POSITION_CODES },
      { field: 'columns', vendor: 'cols', ours: 'columns', kind: 'number' },
      { field: 'rows', vendor: 'rows', ours: 'rows', kind: 'number' },
      { field: 'frame_width', vendor: 'frmw', ours: 'frame_width', kind: 'number', default: 0 },
      { field: 'border_width', vendor: 'brdw', ours: 'border_width', kind: 'number', default: 0 },
      { field: 'bgcolor', vendor: 'bgc', ours: 'bgcolor', kind: 'colour' },
      { field: 'frame_color', vendor: 'frmc', ours: 'frame_color', kind: 'colour', onlyIfVendor: 'frmw' },
      { field: 'border_color', vendor: 'brdc', ours: 'border_color', kind: 'colour', onlyIfVendor: 'brdw' },
    ]),
    vendorKeysNotGraded: Object.freeze([]),
    ungraded: Object.freeze({ force_overlay: 'not recorded by the capture' }),
  }),
  tableCells: Object.freeze({
    ourFamily: 'cell',
    fields: Object.freeze([
      { field: 'text', vendor: 't', ours: 'text', kind: 'text', default: '' },
      { field: 'text_halign', vendor: 'tha', ours: 'text_halign', kind: 'enum', codes: HALIGN_CODES, default: 'center', onlyWithText: true },
      { field: 'text_valign', vendor: 'tva', ours: 'text_valign', kind: 'enum', codes: VALIGN_CODES, default: 'center', onlyWithText: true },
      // ⭐ WITNESSED, not the reference's: the reference states `size.normal`, but
      // TradingView records `auto` for a cell whose script names no size
      // (k-clustering, 8 cells), and our renderer draws `auto` and `normal` alike.
      { field: 'text_size', vendor: 'ts', ours: 'text_size', kind: 'enum', codes: SIZE_CODES, default: 'auto', onlyWithText: true },
      { field: 'tooltip', vendor: 'tt', ours: 'tooltip', kind: 'text', default: '' },
      // `tf` is absent from a record whose font is the default (658 of 702 cells)
      { field: 'text_font_family', vendor: 'tf', ours: 'text_font_family', kind: 'enum', codes: FONT_CODES, default: 'default', vendorDefault: 'default', onlyWithText: true },
      { field: 'text_color', vendor: 'tc', ours: 'text_color', kind: 'colour', onlyWithText: true },
      { field: 'bgcolor', vendor: 'bgc', ours: 'bgcolor', kind: 'colour' },
    ]),
    // `tid` / `col` / `row` are the cell's address: the pairing, not a graded field
    pairingKeys: Object.freeze(['tid', 'col', 'row']),
    vendorKeysNotGraded: Object.freeze(['w', 'h', 'colspan', 'rowspan']),
    ungraded: Object.freeze({
      width: 'the capture holds null on every cell record (702 of 702)',
      height: 'the capture holds null on every cell record (702 of 702)',
      text_formatting: 'not recorded by the capture',
      colspan: 'a merge is held on our table, not on the cell; not paired by v2',
      rowspan: 'a merge is held on our table, not on the cell; not paired by v2',
    }),
  }),
  linefills: Object.freeze({
    ourFamily: 'linefill',
    fields: Object.freeze([
      { field: 'color', vendor: 'ci', ours: 'color', kind: 'colour' },
    ]),
    // a fill is PAIRED by its two lines (one fill per pair, Pine's rule), so they
    // are the pairing; a fill between other lines is unpaired, a count difference
    pairingKeys: Object.freeze(['line1', 'line2']),
    vendorKeysNotGraded: Object.freeze([]),
    ungraded: Object.freeze({}),
  }),
})
export const OBJECTS_V2_FAMILIES = Object.freeze(Object.keys(OBJECTS_V2_FIELDS))

/** What each field state means for the v2 grade — said ONCE, here. */
export const V2_AGREES = new Set(['agree'])
export const V2_DIFFERS = new Set(['differ'])
/** Not graded, and counted: the capture cannot be decoded, the slot is
 *  theme-relative, the object is drawn by neither side, or the field does not
 *  apply (label y off price, text colour of an empty text). */
// ⭐ Engine 52 — `pointSize`: our side drew a v6 int text size (typographic points); no capture
// records a point size's pixels, so it is served and NOT graded (`objectRecords.js::fieldRow`).
export const V2_NOT_GRADED = new Set(['undecoded', 'themeRelative', 'undrawn', 'notApplicable', 'pointSize'])
/** ⭐ U13 — an x one side cannot resolve to a bar (no x table in the capture, our
 *  side's frame absent, an `na` x, a `bar_time` off the loaded bars). Not graded,
 *  counted with its reason, and it BLOCKS a MATCH: a capture whose drawings' x was
 *  not witnessed is INCONCLUSIVE (coordinator ruling G1), never passed. */
export const V2_X_MISSING = new Set(['xMissing'])

/**
 * The v2 report for one capture.
 * @param {object} v1        `compareObjects`' result (the verdict v1 gave)
 * @param {object|null} pairing  `objectRecords.js::pairRecords`, or null when
 *        no record could be paired (our object lane did not run, or the capture
 *        recorded no objects)
 */
export function compareObjectsV2(v1, pairing, oursWithheldFamilies = []) {
  const ungraded = Object.fromEntries(OBJECTS_V2_FAMILIES.map((f) => [f, Object.keys(OBJECTS_V2_FIELDS[f].ungraded)]))
  if (!v1) return null
  if (!pairing) {
    // ⚠️ `pairedNothing`: this verdict is v1's, carried; v2 graded nothing (review #1150 note 6)
    return { verdict: v1.verdict, verdictWithoutX: v1.verdict, v1: v1.verdict, pairedNothing: true, x: null, reason: `no record was paired; v1: ${v1.reason}`, families: [], ungraded }
  }
  // ⭐ OTHER-SYMBOL UNSETTLED (`unsettledCutOf`): the records v1 took out, by their pair, are not graded here either —
  // ONE decision, v1's, read off its own lists (and the newest bar SUPPLY BEHIND the capture, the same way)
  const osuOut = Array.isArray(v1.otherSymbolUnsettled) ? v1.otherSymbolUnsettled : []
  const behindOut = Array.isArray(v1.supplyBehind) ? v1.supplyBehind : []
  const unsettledOut = [...osuOut, ...behindOut]
  if (unsettledOut.length) {
    const out = new Set(unsettledOut.map((e) => `${e.family}|${e.vendorId}|${e.ourId}`))
    const fams = { ...pairing.families }
    for (const f of UNSETTLED_FAMILIES) {
      const p = pairing.families[f]
      if (p && Array.isArray(p.pairs)) fams[f] = { ...p, pairs: p.pairs.filter((x) => !out.has(`${f}|${x.vendorId}|${x.ourId}`)) }
    }
    pairing = { ...pairing, families: fams }
  }
  const families = []
  // ⛔ A FAMILY v1 FOUND WITHHELD BY NAME (W-C22-DEL / OZ: `counts[].withheld`)
  // is a gap with a name, already graded as one; v2 does not pair it again and
  // never counts its missing records as a difference (the cells go with their
  // tables, as in v1's RUNTIME_FAMILY, and the fills with their lines).
  const withheld = new Set((v1.counts || []).filter((r) => r && r.withheld && !r.partial).map((r) => r.family))
  if (withheld.has('tables')) withheld.add('tableCells')
  // ⭐⭐ DISCLOSED PARTIAL — a family v1 graded on what it draws (`compareObjects`, `objects:partial`): its paired records
  // are graded here as always; the records TradingView holds that our side withheld by name are counted, never a difference
  const partialFams = new Set((v1.counts || []).filter((r) => r && r.withheld && r.partial).map((r) => r.family))
  // ⛔ What OUR side withheld by name is read from its own list
  // (`ourSide.js` withheldFamilies, our family names), never inferred: a fill
  // our side still holds is graded even when its lines were withheld
  // (review #1150 note 3).
  const OUR_TO_V2 = { line: 'lines', label: 'labels', box: 'boxes', table: 'tables', linefill: 'linefills' }
  for (const fam of oursWithheldFamilies || []) {
    const f = OUR_TO_V2[fam]
    if (f) withheld.add(f)
    if (f === 'tables') withheld.add('tableCells')
  }
  // a fill lives between two lines: withheld lines explain fills our side does
  // NOT hold, and only those. A fill our side still holds is graded.
  const lf = pairing.families.linefills
  if (withheld.has('lines') && lf && lf.pairs.length === 0 && lf.unpairedOurs === 0) withheld.add('linefills')
  for (const f of OBJECTS_V2_FAMILIES) {
    const p = pairing.families[f]
    if (!p) continue
    if (withheld.has(f)) {
      families.push({ family: f, withheld: true, paired: 0, unpairedVendor: 0, unpairedOurs: 0, graded: 0, agreeing: 0,
        differing: 0, notGraded: 0, undecoded: {}, byField: {}, first: null, firstWithoutX: null, agree: null, agreeWithoutX: null,
        x: null, xIncomplete: false, differsOnlyByCreationOrder: false })
      continue
    }
    const row = {
      family: f, paired: p.pairs.length, unpairedVendor: p.unpairedVendor, unpairedOurs: p.unpairedOurs,
      graded: 0, agreeing: 0, differing: 0, notGraded: 0, undecoded: {}, byField: {}, first: null, firstWithoutX: null,
      agree: null, agreeWithoutX: null,
      // ⭐ U13 — the x grade, tallied APART so the pre-U13 tallies above stay comparable
      x: { graded: 0, agreeing: 0, differing: 0, missing: 0, missingWhy: {}, first: null },
      xIncomplete: false,
    }
    for (const pair of p.pairs) {
      for (const r of pair.fields) {
        const bf = row.byField[r.field] || (row.byField[r.field] = { agree: 0, differ: 0, notGraded: 0 })
        const at = { field: r.field, vendor: r.vendor, ours: r.ours, vendorId: pair.vendorId, ourId: pair.ourId, where: pair.where }
        if (r.x === true) {
          if (V2_AGREES.has(r.state)) { row.x.graded += 1; row.x.agreeing += 1; bf.agree += 1 } else if (V2_DIFFERS.has(r.state)) {
            row.x.graded += 1
            row.x.differing += 1
            bf.differ += 1
            if (!row.x.first) row.x.first = at
            if (!row.first) row.first = at
          } else if (V2_X_MISSING.has(r.state)) {
            bf.notGraded += 1
            row.x.missing += 1
            const why = r.why || 'unstated'
            row.x.missingWhy[why] = (row.x.missingWhy[why] || 0) + 1
          } else {
            // ⛔ FAIL CLOSED, as below: an x state this table does not name is never agreeing.
            throw new Error(`objects v2: unknown x field state ${JSON.stringify(r.state)}`)
          }
          continue
        }
        if (V2_AGREES.has(r.state)) { row.graded += 1; row.agreeing += 1; bf.agree += 1 } else if (V2_DIFFERS.has(r.state)) {
          row.graded += 1
          row.differing += 1
          bf.differ += 1
          if (!row.firstWithoutX) row.firstWithoutX = at
          if (!row.first) row.first = at
        } else if (V2_NOT_GRADED.has(r.state)) {
          row.notGraded += 1
          bf.notGraded += 1
          if (r.state === 'undecoded') row.undecoded[`${r.field}=${r.vendor}`] = (row.undecoded[`${r.field}=${r.vendor}`] || 0) + 1
        } else {
          // ⛔ FAIL CLOSED: a state this table does not name is never read as agreeing.
          throw new Error(`objects v2: unknown field state ${JSON.stringify(r.state)}`)
        }
      }
    }
    row.agreeWithoutX = row.graded === 0 ? null : row.differing === 0
    // ⛔ A record one side holds and the other does not is a difference a member
    // sees (for lines … cells v1's counts already say so; for linefills only v2 does).
    if (partialFams.has(f) && p.unpairedVendor && !p.unpairedOurs) {
      row.withheldUnpaired = p.unpairedVendor
    } else if (p.unpairedVendor || p.unpairedOurs) {
      row.agreeWithoutX = false
      const count = { field: 'count', vendor: row.paired + p.unpairedVendor, ours: row.paired + p.unpairedOurs, where: `${f} held` }
      if (!row.firstWithoutX) row.firstWithoutX = count
      if (!row.first) row.first = count
    }
    if (p.pairedByValue) row.pairedByValue = true
    // ⭐ ORPHAN FILLS (`objectRecords.js`, coordinator ruling 2026-11-21): TradingView's fill records whose lines the
    // object limit removed are not drawable; counted apart and named, never a count difference
    if (Number.isInteger(p.orphanVendor) && p.orphanVendor > 0) row.orphanVendor = p.orphanVendor
    // ⭐ U13 — with x: any difference diverges; an x not resolved (and nothing that
    // differs) leaves the family UNGRADED (`xIncomplete`), never agreeing.
    if (row.agreeWithoutX === false || row.x.differing > 0) row.agree = false
    else if (row.x.missing > 0) { row.agree = null; row.xIncomplete = true } else if (row.agreeWithoutX === true || row.x.graded > 0) row.agree = true
    else row.agree = null
    row.differsOnlyByCreationOrder = !!p.differsOnlyByCreationOrder
    families.push(row)
  }
  const divergingWithoutX = families.filter((r) => r.agreeWithoutX === false)
  const diverging = families.filter((r) => r.agree === false)
  const incomplete = families.filter((r) => r.xIncomplete)
  const graded = families.reduce((n, r) => n + r.graded, 0)
  const xt = { graded: 0, agreeing: 0, differing: 0, missing: 0, missingWhy: {} }
  for (const r of families) {
    if (!r.x) continue
    xt.graded += r.x.graded; xt.agreeing += r.x.agreeing; xt.differing += r.x.differing; xt.missing += r.x.missing
    for (const [k, n] of Object.entries(r.x.missingWhy)) xt.missingWhy[k] = (xt.missingWhy[k] || 0) + n
  }
  const firstOf = (list, key) => (list.length ? { family: list[0].family, ...list[0][key] } : null)
  const first = firstOf(diverging, 'first')
  const firstWithoutX = firstOf(divergingWithoutX, 'firstWithoutX')
  // ⭐ v2 never makes a v1 DIVERGE or INCONCLUSIVE better; it can only find a
  // MATCH whose records are in the wrong place.
  let verdictWithoutX = v1.verdict
  if (v1.verdict === 'MATCH' && divergingWithoutX.length) verdictWithoutX = 'DIVERGE'
  // ⭐⭐ U13 (G1) — and, with x: a MATCH needs every paired line / label / box on
  // the SAME bar as TradingView's; an x that could not be resolved is INCONCLUSIVE.
  let verdict = v1.verdict
  if (v1.verdict === 'MATCH' && diverging.length) verdict = 'DIVERGE'
  else if (v1.verdict === 'MATCH' && incomplete.length) verdict = 'INCONCLUSIVE'
  const fieldsSaid = graded || xt.graded
    ? (first
      ? `${diverging.length} object ${diverging.length === 1 ? 'family differs' : 'families differ'} field by field (first: ${first.family} ${first.field} of ${first.where} — vendor ${JSON.stringify(first.vendor)}, ours ${JSON.stringify(first.ours)})${diverging.every((r) => r.differsOnlyByCreationOrder) ? ' — ONLY in creation order: paired by equal ids, every field agrees' : ''}`
      : `every paired record agrees on ${graded} graded fields`)
    : 'no field of a paired record was graded'
  const orphans = families.reduce((n, r) => n + (r.orphanVendor || 0), 0)
  const orphansSaid = orphans
    ? `; ${orphans} of TradingView's fill records are between lines the object limit removed (not drawable, not graded: orphanFills)`
    : ''
  const topWhy = Object.entries(xt.missingWhy).sort((a, b) => b[1] - a[1])[0]
  const xSaid = xt.missing
    ? `x: ${xt.graded} graded (${xt.differing} differ), ${xt.missing} not resolvable to a bar (${topWhy[0]})${verdict === 'INCONCLUSIVE' && v1.verdict === 'MATCH' ? ', so x is not witnessed and this is not a MATCH (G1)' : ''}`
    : `x: ${xt.graded} graded, ${xt.differing} differ (exact bar)`
  return {
    verdict,
    verdictWithoutX,
    v1: v1.verdict,
    pairedNothing: false,
    differsOnlyByCreationOrder: diverging.length > 0 && diverging.every((r) => r.differsOnlyByCreationOrder),
    reason: `${fieldsSaid}${orphansSaid}; ${xSaid}; v1: ${v1.reason}; not graded: xloc (TradingView records none; the bar it resolves to is the x grade)`,
    first,
    firstWithoutX,
    x: { ...xt, incompleteFamilies: incomplete.map((r) => r.family) },
    families,
    ungraded,
    ...(orphans ? { orphanFills: orphans } : {}),
    ...(osuOut.length ? { otherSymbolUnsettled: osuOut } : {}),
    ...(behindOut.length ? { supplyBehind: behindOut } : {}),
  }
}

// ── A v1 MATCH CANNOT STAND WHEN v2 DIVERGES (coordinator ruling 2026-11-21) ─────────────────────────────────────
//
// v1 grades a drawing by its counts, its texts and the colours it pairs by value: no coordinate, no fill count. v2
// grades every paired record field by field. Until this ruling v2 was "a separate report, not the verdict", so a
// capture whose labels sat at another price, or whose lines sat one bar off, read MATCH on v1 while v2 said DIVERGE
// (htf-candle-footprint-cartel-console: label y 147.06 vs 144.41; average-day-range-adr-pivots: lines x2 666 vs 665).
// Now the objects grade is v1's, except that a v1 MATCH whose v2 report DIVERGEs is DIVERGE, by name (`overruledBy`),
// with v1's own grade kept beside it (`v1Verdict`, `v1Reason`). v2 never improves a v1 DIVERGE or INCONCLUSIVE, and an
// x v2 could not resolve leaves the v1 MATCH as it is (G1 makes the v2 REPORT INCONCLUSIVE; the verdict is not
// lowered for a field nobody could compare). ⛔ Nor does a v2 DIVERGE that v2 itself names ONLY CREATION ORDER
// (`differsOnlyByCreationOrder`: paired by equal ids, every field agrees): the same drawings, made in another order, are
// the same picture (vw-call-site-history-{rddt,spy}-1d-2026-10-01: 24 labels, every field agreeing id for id). `verdictWithoutColour` (C44) moves with it only where v2 differs on more
// than colour, so a capture whose two verdicts differ still differs for colour and no other reason.
// ⛔ It reads the SAME pairing the v2 report does (`objectRecords.js::pairRecords`); with no pairing it changes nothing.

/** Does this v2 report differ on anything but a colour field (a count, an x, a coordinate, a text, a style)? */
export function v2DiffersBeyondColour(v2) {
  for (const r of (v2 && v2.families) || []) {
    if (r.agree !== false) continue
    if ((r.unpairedVendor || r.unpairedOurs) && !r.withheldUnpaired) return true
    const spec = OBJECTS_V2_FIELDS[r.family]
    const kindOf = (field) => ((spec && spec.fields.find((x) => x.field === field)) || {}).kind
    for (const [field, s] of Object.entries(r.byField || {})) {
      if (s && s.differ > 0 && kindOf(field) !== 'colour') return true
    }
  }
  return false
}

/** The objects grade with the v2 rule applied (see the header): `v1` itself unless v1 reads MATCH and v2 DIVERGEs. */
export function v2Overrules(v1, records, ours) {
  if (!v1 || v1.verdict !== 'MATCH' || !records) return v1
  const v2 = compareObjectsV2(v1, records, (ours && ours.objects && ours.objects.withheldFamilies) || [])
  // a DIVERGE v2 itself says is ONLY creation order (paired by equal ids, every field agrees) is the same picture
  if (!v2 || v2.verdict !== 'DIVERGE' || v2.differsOnlyByCreationOrder === true) return v1
  const f = v2.first || {}
  const said = `the records differ field by field (objectsV2, first: ${f.family} ${f.field} of ${f.where} — vendor `
    + `${JSON.stringify(f.vendor)}, ours ${JSON.stringify(f.ours)}); v1, which compares no coordinate and no fill count, `
    + `read MATCH: ${v1.reason}`
  return {
    ...v1,
    verdict: 'DIVERGE',
    ...(v1.verdictWithoutColour === 'MATCH' && v2DiffersBeyondColour(v2) ? { verdictWithoutColour: 'DIVERGE' } : {}),
    overruledBy: 'objectsV2',
    v1Verdict: v1.verdict,
    v1Reason: v1.reason,
    reason: said,
  }
}

// ── PAINTS (B1, step 61) ─────────────────────────────────────────────────────
//
// ⭐⭐ `bgcolor` / `barcolor` JOIN THE VERDICT (integrator ruling 2026-10-02, the
// way C44 joined object colour). The pairing and the per-bar grade are the
// runner's (`vendorHarness/paintColours.js::gradePaints`: every vendor
// `bg_colorer` / `bar_colorer` paired with the translator's paint of that kind by
// source order); this function says, ONCE, what each state means for the verdict:
//
//   agree, naBoth, hiddenBoth   agrees — the same picture on every bar
//   differ, naDiffers           DIFFERS — a bar is painted differently
//   titleMismatch               DIFFERS — the pairing itself disagrees
//   hiddenVendorOnly            DIFFERS — we draw a paint TradingView does not
//   hiddenOursOnly              DIFFERS — TradingView draws a paint we hide
//   withheld (with a reason)    INCONCLUSIVE — the door refused it BY NAME: nothing
//                               is drawn, and the member is told why. Graded the
//                               way a plot withheld by name is (coordinator ruling
//                               2026-11-15, G5 of s245-bugs-1115). ⚰️ It graded
//                               DIFFERS until then ("a GAP, counted as one"), so a
//                               paint the bind refused by name kept a capture
//                               DIVERGE when its plots were INCONCLUSIVE.
//                               Where TradingView does not draw it either, neither
//                               side paints a bar: NOT GRADED (`undrawn`)
//   withheld (no reason)        DIFFERS — a withholding nobody can read is not
//                               "by name" (fail closed)
//   notDrawn                    DIFFERS where TradingView painted a bar; where it
//                               painted NONE (every bar `na` at the defaults) the
//                               picture agrees and the paint is NOT GRADED —
//                               ⛔ COUNTED, never dropped (`undrawn`, named)
//   vendorUnreadable            NOT GRADED — a verdict about the capture
//   (unpaired)                  DIFFERS — the two sides paint a different number
//                               of times; nothing was paired by guess
//
// No paint on either side ⇒ no row, and nothing is claimed.
const PAINT_AGREES = new Set(['agree', 'naBoth', 'hiddenBoth'])
const PAINT_DIFFERS = new Set(['differ', 'naDiffers', 'titleMismatch', 'hiddenVendorOnly', 'hiddenOursOnly'])

export function comparePaints(grade) {
  if (!grade || grade.refused) return null
  const rows = grade.rows || []
  const unpaired = grade.unpaired || []
  if (!rows.length && !unpaired.length) return null
  let agreeing = 0
  let undrawn = 0
  let undecodable = 0
  const differing = []
  const undrawnIds = []
  const withheldByName = []
  for (const r of rows) {
    const s = r.state
    if (PAINT_AGREES.has(s)) agreeing += 1
    else if (PAINT_DIFFERS.has(s)) differing.push(r)
    else if (s === 'withheld') {
      // ⭐ ENGINE 58 (S11) — …and one TradingView paints on NO bar is undrawn on both
      // sides too, by the same rule as `notDrawn` below (dot-dynamics).
      if (r.displayed === false || r.vendorPainted === 0) { undrawn += 1; undrawnIds.push(r.id) }
      else if (typeof r.reason === 'string' && r.reason.trim()) withheldByName.push(r)
      else differing.push(r)
    } else if (s === 'notDrawn') {
      if (r.vendorPainted === 0) { undrawn += 1; undrawnIds.push(r.id) } else differing.push(r)
    } else if (s === 'vendorUnreadable') undecodable += 1
    // ⛔ FAIL CLOSED: a state this table does not name is never read as agreeing.
    else throw new Error(`paints: unknown paint state ${JSON.stringify(s)}`)
  }
  const unpairedSaid = unpaired.map((u) => `${u.kind}: TradingView ${u.vendor}, ours ${u.ours}`)
  const graded = agreeing + differing.length + unpaired.length
  const undrawnSaid = undrawn ? `; ${undrawn} paint${undrawn === 1 ? '' : 's'} neither side draws not graded (${undrawnIds.join(', ')})` : ''
  const undecodableSaid = undecodable ? `; ${undecodable} unreadable in the capture` : ''
  const w0 = withheldByName[0]
  const withheldSaid = w0
    ? `; ${withheldByName.length} paint${withheldByName.length === 1 ? '' : 's'} withheld by name, not graded (first: ${w0.kind} ${w0.id}${w0.title ? ` "${w0.title}"` : ''} — ${w0.reason})`
    : ''
  // ⭐⭐ (2026-11-19, held evidence) each row says which of OUR paints it is (`line`, `title`) and whether it DIFFERS, so a
  // licence-held capture's ledger row can name the one paint to withhold (`held_evidence.lane_withholds`)
  const rowsOut = () => rows.map((r) => ({ id: r.id, kind: r.kind, state: r.state, ...(r.reason ? { reason: r.reason } : {}),
    ...(Number.isInteger(r.line) ? { line: r.line } : {}), ...(r.title ? { title: r.title } : {}),
    differs: differing.includes(r) }))
  if (!graded) {
    // ⭐ G5 — a paint withheld BY NAME is an item that could not be compared, as a plot is
    if (withheldByName.length) {
      return { verdict: 'INCONCLUSIVE', reason: `no paint was graded${withheldSaid}${undrawnSaid}${undecodableSaid}`, agreeing, differing: 0, withheld: withheldByName.length, undrawn, undecodable, unpaired, rows: rowsOut() }
    }
    return { verdict: null, reason: `no paint was graded${undrawnSaid}${undecodableSaid}`, agreeing, differing: 0, undrawn, undecodable, unpaired }
  }
  const first = differing[0]
  const firstSaid = first
    ? `${first.kind} ${first.id}${first.title ? ` "${first.title}"` : ''} ${first.state}${first.reason ? ` (${first.reason})` : ''}${first.first ? ` — bar ${first.first.bar} vendor ${first.first.vendor} ours ${first.first.ours}` : ''}`
    : null
  const diverge = differing.length + unpaired.length
  return {
    verdict: diverge ? 'DIVERGE' : (withheldByName.length ? 'INCONCLUSIVE' : 'MATCH'),
    reason: diverge
      ? `${diverge} paint${diverge === 1 ? '' : 's'} differ${diverge === 1 ? 's' : ''}${firstSaid ? ` (first: ${firstSaid})` : ''}${unpairedSaid.length ? `; unpaired — ${unpairedSaid.join('; ')}` : ''}${withheldSaid}${undrawnSaid}${undecodableSaid}`
      : `${agreeing} paint${agreeing === 1 ? '' : 's'} agree bar for bar${withheldSaid}${undrawnSaid}${undecodableSaid}`,
    agreeing,
    differing: differing.length,
    withheld: withheldByName.length,
    undrawn,
    undecodable,
    unpaired,
    rows: rowsOut(),
  }
}

// ── REPORT ───────────────────────────────────────────────────────────────────

export function renderSummary(results) {
  const pad = (s, n) => String(s ?? '').slice(0, n).padEnd(n)
  const lines = [
    `${pad('capture', 44)} ${pad('symbol/tf', 16)} ${pad('plots', 6)} ${pad('verdict', 17)} first divergence / reason`,
    `${'-'.repeat(44)} ${'-'.repeat(16)} ${'-'.repeat(6)} ${'-'.repeat(17)} ${'-'.repeat(40)}`,
  ]
  for (const r of results) {
    const plots = (r.plots || []).length
    let tail = r.reason || ''
    const d = (r.plots || []).find((p) => p.verdict === 'DIVERGE')
    if (d && d.stats && d.stats.steady.first) {
      const f = d.stats.steady.first
      tail = f.kind === 'color'
        ? `${d.title}: bar ${f.bar} t=${f.time} color vendor=${f.vendorColor ?? 'none'} ours=${f.ourColor ?? 'none'}`
        : `${d.title}: bar ${f.bar} t=${f.time} ${f.kind} vendor=${fmt(f.vendor)} ours=${fmt(f.ours)}`
    } else if (d && d.stats && d.stats.roundingEqual && d.stats.roundingEqual.first) {
      const f = d.stats.roundingEqual.first
      tail = `${d.title}: bar ${f.bar} t=${f.time} rounding-equal vendor=${fmt(f.vendor)} ours=${fmt(f.ours)} index=${fmt(f.index)}`
    }
    lines.push(`${pad(r.id, 44)} ${pad(`${r.symbol || '?'} ${r.timeframe || '?'}`, 16)} ${pad(plots, 6)} ${pad(r.verdict, 17)} ${tail}`)
    for (const p of (r.plots || [])) {
      const s = p.stats
      const detail = s ? `cmp ${s.compared} ok ${s.matching} warm ${s.warmup.divergent}/${s.warmup.compared} steady ${s.steady.divergent}/${s.steady.compared} maxRel ${s.maxRel.toExponential(2)}` : ''
      // ⛔ GUARD 2 (index provenance): the provenance block beside the verdict, never inside `ok`
      const prov = s && s.provenance ? ` · provenance ${provenanceText(s.provenance)}` : ''
      // ⭐⭐ INDEX ROUNDING: its own column beside `ok`, never inside it
      const rnd = s && s.roundingEqual ? ` · rounding-equal ${roundingText(s.roundingEqual)}` : ''
      lines.push(`    ${pad(p.title ?? p.id, 40)} ${pad(p.verdict, 17)} ${detail}${prov}${rnd}${p.verdict !== 'MATCH' && p.verdict !== MATCH_SUBSTITUTED ? ` — ${p.reason}` : ''}`)
    }
    if (r.objects) lines.push(`    ${pad('objects', 40)} ${pad(r.objects.verdict, 13)} ${r.objects.reason}`)
    if (r.paints) lines.push(`    ${pad('paints', 40)} ${pad(r.paints.verdict || 'NOT GRADED', 13)} ${r.paints.reason}`)
  }
  const tally = Object.fromEntries(VERDICTS.map((v) => [v, results.filter((r) => r.verdict === v).length]))
  lines.push('')
  // ⛔ GUARD 2 (index provenance): every row that counts toward a tally shows its provenance share beside it
  const provShare = (r) => {
    let prov = 0
    let own = 0
    for (const p of r.plots || []) {
      const st = p && p.stats
      if (!st) continue
      own += st.compared || 0
      for (const b of Object.values(st.provenance || {})) prov += b.compared || 0
    }
    return prov ? { prov, share: prov / (prov + own) } : null
  }
  const provRows = results.map((r) => [r, provShare(r)]).filter(([, x]) => x)
  if (provRows.length) {
    lines.push(`INDEX PROVENANCE (${provRows.length} captures; those bars compared into a provenance block, never into a MATCH): `
      + provRows.map(([r, x]) => `${r.id} ${r.verdict} ${(100 * x.share).toFixed(1)}% provenance (${x.prov} bars)`).join('; '))
    const named = new Set(results.flatMap((r) => (r.plots || []).flatMap((pl) => Object.keys((pl && pl.stats && pl.stats.provenance) || {}))))
    for (const cls of Object.keys(PROVENANCE_REASONS)) if (named.has(cls)) lines.push(`  ${cls}: ${PROVENANCE_REASONS[cls]}`)
  }
  // ⭐⭐ INDEX ROUNDING: every capture with rounding-equal bars, by name, with its count beside its verdict
  const rndRows = results.map((r) => {
    let n = 0
    let sub = 0
    for (const p of r.plots || []) {
      const re = p && p.stats && p.stats.roundingEqual
      if (re) { n += re.compared || 0; sub += re.subTick || 0 }
    }
    return [r, n, sub]
  }).filter(([, n]) => n > 0)
  if (rndRows.length) {
    lines.push(`INDEX ROUNDING (${rndRows.length} captures; bars within one index tick through the ratio, |rel| <= ${INDEX_TICK_REL} / X(t), `
      + 'counted apart, never into a MATCH): ' + rndRows.map(([r, n, sub]) => `${r.id} ${r.verdict} ${n} rounding-equal bars (sub-tick ${sub})`).join('; '))
  }
  lines.push(`TOTAL ${results.length} captures — MATCH ${tally.MATCH} · DIVERGE ${tally.DIVERGE} · INCONCLUSIVE ${tally.INCONCLUSIVE}`
    + (tally.MATCH_SUBSTITUTED ? ` · MATCH_SUBSTITUTED ${tally.MATCH_SUBSTITUTED} (verified with substituted inputs; never counted as MATCH)` : ''))
  // ⭐ C44 — the same total as it read before object colour joined the verdict,
  // and every capture colour moved, by name.
  const coloured = results.filter((r) => r.verdictWithoutColour)
  if (coloured.length) {
    const before = Object.fromEntries(VERDICTS.map((v) => [v, results.filter((r) => (r.verdictWithoutColour || r.verdict) === v).length]))
    const moved = results.filter((r) => r.verdictWithoutColour && r.verdictWithoutColour !== r.verdict)
    lines.push(`WITHOUT OBJECT COLOUR (the verdict before C44; colour graded on ${coloured.length} captures) — MATCH ${before.MATCH} · DIVERGE ${before.DIVERGE} · INCONCLUSIVE ${before.INCONCLUSIVE}`)
    lines.push(`CHANGED BY OBJECT COLOUR (${moved.length}): ${moved.map((r) => `${r.id} ${r.verdictWithoutColour} → ${r.verdict}`).join('; ') || 'none'}`)
  }
  // ⭐ B1 — the same total as it read before paints joined the verdict, and every
  // capture a paint moved, by name.
  const painted = results.filter((r) => r.verdictWithoutPaints)
  if (painted.length) {
    const before = Object.fromEntries(VERDICTS.map((v) => [v, results.filter((r) => (r.verdictWithoutPaints || r.verdict) === v).length]))
    const moved = results.filter((r) => r.verdictWithoutPaints && r.verdictWithoutPaints !== r.verdict)
    lines.push(`WITHOUT PAINTS (the verdict before B1; paints graded on ${painted.length} captures) — MATCH ${before.MATCH} · DIVERGE ${before.DIVERGE} · INCONCLUSIVE ${before.INCONCLUSIVE}`)
    lines.push(`CHANGED BY PAINTS (${moved.length}): ${moved.map((r) => `${r.id} ${r.verdictWithoutPaints} → ${r.verdict}`).join('; ') || 'none'}`)
  }
  return lines.join('\n')
}

// ═══ W9-T2: THE STRATEGY GRADE (design 5.2 E) ═══════════════════════════════════
//
// Pure. Applied IN ORDER; the first step that decides, decides.
//
//   0. THE REFERENCE FLOOR, decided from the TradingView capture alone BEFORE our run
//      is read. Fewer than STRATEGY_FLOOR closed trades in the graded span is
//      UNGRADABLE on that symbol, and OUR RUN IS NEVER CONSULTED: our trade count is
//      not read, compared or logged here (a spy on `ours.trades` proves it).
//      ⛔ The floor is NEVER applied to our count: a broker that under- or over-trades
//      against a reference at or above the floor is a DIVERGE, never a hidden script.
//   1. EXPECTED-REFUSAL: our run refused by rule 11 or another wave wall. Tallied
//      apart from the W9 DIVERGE count. Any other refusal against a TradingView value
//      is a DIVERGE.
//   2. BAR IDENTITY (and the data settings): OHLCV identical to the tick over the span,
//      else INCONCLUSIVE "bars differ". ⭐ A script with NO literal settings reads
//      INCONCLUSIVE on the settings agreement ('strategy-settings:nothing-compared'):
//      that is the absence of a comparison, not a disagreement, and it never blocks.
//      Only a real disagreement, or no strategy() declaration at all, blocks.
//   3. SIGNAL IDENTITY, method (b) only: the script own plots identical inside
//      [X, Y), else INCONCLUSIVE "the warm-up has not converged".
//   4. TRADES AND VALUES. Counts differ: DIVERGE, naming the first unmatched fill by
//      time and its `rule`. Equal counts: JOINED ON BAR TIME, NEVER BAR INDEX (on
//      method (b) the indexes differ by a constant). Prices to the tick, quantities
//      exactly, currency to REL_TOL. All equal: MATCH; else DIVERGE naming the rule.
//   5. FILLS (U14), when the reference carries TradingView's fill list. Fill BY FILL,
//      grouped by bar time: the same bars, and on each bar the same fills by side,
//      role (the order COMMAND: entry, exit / close, or strategy.order) and price to the tick, quantities summed exactly (TradingView logs
//      a bracket's exit once per trade it closes and a close-all once; a sum per key
//      makes the two loggings one fact), and every entry / exit id ours names among
//      TradingView's. Fills that cannot be placed in time are INCONCLUSIVE, never skipped.
//   6. REPORT SLOTS (U14), when given: every slot BOTH sides state is compared (counts
//      exactly, everything else to REL_TOL); a slot either side does not state is listed
//      as ungraded with its reason, never compared against a default.
//   7. VALUE SERIES, when given: every plot of the capture against our output of the same plot,
//      bar by bar, joined on time (`na` only equals `na`; numbers to REL_TOL). The caller pairs the
//      plots and refuses a pairing it cannot prove (INCONCLUSIVE, never paired anyway). A differing
//      bar is DIVERGE naming the plot, the bar and both values.
//   8. DRAWN TEXTS, when given: the label texts per bar, as multisets. Texts the caller could not
//      draw are listed in `ungradedTexts` with the reason, never dropped and never compared.
//   ⭐ `graded` says what the MATCH covered. A MATCH with `graded.fills === false` is a
//      trade-list match only, and `evidence_engine.resolve_pins` never pins from one.
//   ⛔ Step 2 also blocks on the run's EFFECTIVE settings disagreeing with the read-back
//      (`settings.effectiveDisagreements`) and on an unread Properties input the run
//      depends on (`settings.unreadDependedOn`, strategy_reference.mjs).

export const STRATEGY_FLOOR = 5
export const STRATEGY_VERDICTS = Object.freeze(['MATCH', 'DIVERGE', 'INCONCLUSIVE', 'UNGRADABLE', 'EXPECTED-REFUSAL'])

const inSpan = (t, span) => !span || ((span.from === undefined || t >= span.from) && (span.to === undefined || t < span.to))
const sameTick = (a, b, tick) => Math.abs(a - b) < tick / 2
const sameCurrency = (a, b) => Math.abs(a - b) <= REL_TOL * Math.abs(b) || Math.abs(a - b) <= ABS_FLOOR_UNKNOWN_SCALE

function barsDiffer(refBars, ourBars, span, tick) {
  if (!Array.isArray(refBars) || !Array.isArray(ourBars)) return 'bars are missing on a side'
  const a = refBars.filter((b) => inSpan(b.time, span))
  const b = ourBars.filter((x) => inSpan(x.time, span))
  if (a.length === 0) return 'no reference bars in the span'
  if (a.length !== b.length) return `bar counts differ (${a.length} against ${b.length})`
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].time !== b[i].time) return `bar times differ at ${a[i].time}`
    for (const k of ['open', 'high', 'low', 'close']) if (!sameTick(a[i][k], b[i][k], tick)) return `${k} differs at ${a[i].time}`
    if (a[i].volume !== b[i].volume) return `volume differs at ${a[i].time}`
  }
  return null
}

function signalsDiffer(ref, our, graded, tol) {
  const names = Object.keys(ref || {})
  if (names.length === 0 || !our) return 'no plots to compare'
  for (const name of names) {
    const a = (ref[name] || []).filter((p) => inSpan(p.time, graded))
    const m = new Map((our[name] || []).filter((p) => inSpan(p.time, graded)).map((p) => [p.time, p.value]))
    if (m.size !== a.length) return `plot ${name} has a different bar count inside the graded span`
    for (const p of a) if (!m.has(p.time) || !valuesAgree(m.get(p.time), p.value, tol)) return `plot ${name} differs at ${p.time}`
  }
  return null
}

const ruleOf = (t) => (t && t.rule) || 'unattributed'

/** ⭐ (2026-11-17) the closed trades of each ENTRY BAR, in one canonical order: exit time, then exit price, then
 *  quantity. One entry fill can close as SEVERAL trades (a margin call or a partial exit closes part of a trade,
 *  which keeps its entry): w9-q-s1i-short-v6 lists trades 4-8 all entered on one bar, two of them exited on one bar
 *  (60 at 108.19, 316 at 113.8). ⚰️ This joined on the entry time alone (a Map, one trade per time), so the second
 *  trade of a bar silently replaced the first and was compared against the reference's first. Both sides are put in
 *  the same canonical order, so two lists that hold the same trades pair them whatever order each side lists them
 *  in; a bar whose count differs is a DIVERGE. */
function tradesByEntry(list) {
  const m = new Map()
  for (const t of list) {
    if (!m.has(t.entryTime)) m.set(t.entryTime, [])
    m.get(t.entryTime).push(t)
  }
  for (const g of m.values()) g.sort((x, y) => (x.exitTime - y.exitTime) || (x.exitPrice - y.exitPrice) || (x.qty - y.qty))
  return m
}
function compareTrades(refTrades, ourTrades, tick) {
  const byEntry = tradesByEntry(ourTrades)
  const refEntries = new Set(refTrades.map((t) => t.entryTime))
  if (refTrades.length !== ourTrades.length) {
    const ref = [...refTrades].sort((x, y) => x.entryTime - y.entryTime)
    const first = ref.find((t) => !byEntry.has(t.entryTime))
      || [...ourTrades].sort((x, y) => x.entryTime - y.entryTime).find((t) => !refEntries.has(t.entryTime))
    return { verdict: 'DIVERGE', reason: `trade counts differ (reference ${refTrades.length}, ours ${ourTrades.length})`, first: first ? { time: first.entryTime, rule: ruleOf(first) } : null }
  }
  const refByEntry = tradesByEntry(refTrades)
  for (const [entryTime, refGroup] of [...refByEntry.entries()].sort((x, y) => x[0] - y[0])) {
    const ourGroup = byEntry.get(entryTime) || []
    if (ourGroup.length && ourGroup.length !== refGroup.length) {
      return { verdict: 'DIVERGE', reason: `the trades entered at ${entryTime} differ in number (reference ${refGroup.length}, ours ${ourGroup.length})`, first: { time: entryTime, rule: ruleOf(ourGroup[0]) } }
    }
    for (const [k, r] of refGroup.entries()) {
      const o = ourGroup[k]
      if (!o) return { verdict: 'DIVERGE', reason: `no fill of ours at ${r.entryTime}`, first: { time: r.entryTime, rule: ruleOf(r) } }
      const bad = [
        o.direction !== r.direction && 'direction',
        o.exitTime !== r.exitTime && 'exitTime',
        !sameTick(o.entryPrice, r.entryPrice, tick) && 'entryPrice',
        !sameTick(o.exitPrice, r.exitPrice, tick) && 'exitPrice',
        o.qty !== r.qty && 'qty',
        !sameCurrency(o.profit, r.profit) && 'profit',
      ].find(Boolean)
      if (bad) return { verdict: 'DIVERGE', reason: `${bad} differs at ${r.entryTime}`, first: { time: r.entryTime, rule: ruleOf(r) } }
    }
  }
  return { verdict: 'MATCH', reason: 'every trade and value equal', first: null }
}

/**
 * @param {{reference:{trades:object[]}, ours:object, method?:'a'|'b', span?:{from?:number,to?:number},
 *          graded?:{from?:number,to?:number}, tick?:number, settings?:object, refBars?:object[], ourBars?:object[],
 *          refSignals?:object, ourSignals?:object, slots?:object}} g
 *   `reference.fills` (U14: strategy_reference.mjs, with `fillsTimed` / `fillsReason`) and
 *   `ours.fills` (`{time, side, role, price, qty, id, labelled, rule}`) add step 5; `slots` step 6.
 */
export function gradeStrategy(g) {
  const { reference, ours, method = 'a', span, graded, tick = 0.01, settings, refBars, ourBars, refSignals, ourSignals, slots, values, texts } = g
  // 0. the reference floor: the TradingView capture alone.
  const listed = (reference && reference.trades) || null
  if (!Array.isArray(listed)) return { verdict: 'INCONCLUSIVE', step: 0, reason: 'the capture carries no trade list' }
  // U14: a reference lists its open trades too (`open: true`, strategy_reference.mjs); the floor and the
  // trade grade read CLOSED trades only (an open trade's entry is graded with the fills)
  const refTrades = listed.filter((t) => t.open !== true)
  const inGraded = (t) => inSpan(t.exitTime !== undefined ? t.exitTime : t.entryTime, graded || span)
  const refCount = refTrades.filter(inGraded).length
  if (refCount < STRATEGY_FLOOR) {
    return { verdict: 'UNGRADABLE', step: 0, reason: `the reference has too few trades (${refCount}, floor ${STRATEGY_FLOOR})` }
  }
  // 1. expected refusals.
  const refusal = ours && ours.refusal
  if (refusal) {
    return refusal.expected
      ? { verdict: 'EXPECTED-REFUSAL', step: 1, reason: `refused by ${refusal.rule}`, rule: refusal.rule }
      : { verdict: 'DIVERGE', step: 1, reason: `our run refused (${refusal.rule}) against a TradingView value`, rule: refusal.rule }
  }
  // 2. settings and bar identity.
  if (settings) {
    const hasDisagreement = Array.isArray(settings.disagreements) && settings.disagreements.length > 0
    const noDeclaration = typeof settings.reason === 'string' && settings.reason.startsWith('strategy-settings:no-declaration')
    if (hasDisagreement || noDeclaration) {
      return { verdict: 'INCONCLUSIVE', step: 2, reason: hasDisagreement ? 'the data settings differ' : 'no strategy() declaration to read the settings from' }
    }
    const eff = Array.isArray(settings.effectiveDisagreements) ? settings.effectiveDisagreements : []
    if (eff.length) {
      return { verdict: 'INCONCLUSIVE', step: 2, reason: `the run's settings differ from the read-back: ${eff.map((d) => d.key).join(', ')}` }
    }
    const unread = Array.isArray(settings.unreadDependedOn) ? settings.unreadDependedOn : []
    if (unread.length) {
      return { verdict: 'INCONCLUSIVE', step: 2, reason: `the read-back lacks input(s) the run depends on: ${unread.join(', ')}` }
    }
  }
  const bd = barsDiffer(refBars, ourBars, span, tick)
  if (bd) return { verdict: 'INCONCLUSIVE', step: 2, reason: `bars differ: ${bd}` }
  // 3. signal identity, method (b) only.
  if (method === 'b') {
    // `ourSignals` may be a function (U14), so a caller's run is read only here
    const sd = signalsDiffer(typeof refSignals === 'function' ? refSignals() : refSignals, typeof ourSignals === 'function' ? ourSignals() : ourSignals, graded, { rel: REL_TOL, abs: ABS_FLOOR_UNKNOWN_SCALE })
    if (sd) return { verdict: 'INCONCLUSIVE', step: 3, reason: `the warm-up has not converged: ${sd}` }
  }
  // 4. trades and values (our trade list is read for the first time here).
  const r = compareTrades(refTrades.filter(inGraded), (ours.trades || []).filter(inGraded), tick)
  const covered = { trades: true, fills: false, slots: 0, values: 0, texts: 0 }
  if (r.verdict !== 'MATCH') return { ...r, step: 4, graded: covered }
  // 5. fills, fill by fill (U14).
  const refFills = reference.fills
  if (Array.isArray(refFills)) {
    if (reference.fillsTimed !== true) {
      return { verdict: 'INCONCLUSIVE', step: 5, reason: `the reference fills cannot be placed in time: ${reference.fillsReason || 'untimed'}`, first: null, graded: covered }
    }
    const inFills = (f) => inSpan(f.time, graded || span)
    const f = compareFills(refFills.filter(inFills), (Array.isArray(ours.fills) ? ours.fills : []).filter(inFills), tick)
    if (f.verdict !== 'MATCH') return { ...f, step: 5, graded: covered }
    covered.fills = true
  }
  // 6. the report slots (U14). `slots` may be a function, so a caller's run is read only here.
  let done = { ...r, step: covered.fills ? 5 : 4 }
  let ungradedSlots
  const slotsNow = typeof slots === 'function' ? slots() : slots
  if (slotsNow) {
    const s = compareSlots(slotsNow)
    covered.slots = s.compared.length
    ungradedSlots = s.ungraded
    if (s.verdict !== 'MATCH') return { verdict: s.verdict, reason: s.reason, first: null, step: 6, graded: covered, ungradedSlots }
    done = { verdict: 'MATCH', step: 6, reason: 'every trade, fill and stated report slot equal', first: null }
  }
  const extra = ungradedSlots ? { ungradedSlots } : {}
  // 7. the value series (the script's own plots, bar by bar). A function, read only here.
  const valuesNow = typeof values === 'function' ? values() : values
  if (valuesNow) {
    if (valuesNow.status !== 'ok') {
      return { verdict: 'INCONCLUSIVE', step: 7, reason: `the value series cannot be paired: ${valuesNow.reason || 'unpaired'}`, first: null, graded: covered, ...extra }
    }
    // a slot paired by identity whose value is not a series compared here (a colour, an alert condition) is
    // LISTED with the call it serves, never dropped (2026-11-17: the paint grade grades colours)
    if (Array.isArray(valuesNow.notCompared) && valuesNow.notCompared.length) extra.ungradedValues = valuesNow.notCompared
    const v = compareValueSeries(valuesNow.series, graded || span)
    if (v.verdict !== 'MATCH') return { ...v, step: 7, graded: covered, ...extra }
    covered.values = valuesNow.series.length
    done = { verdict: 'MATCH', step: 7, reason: `${done.reason}; every value series equal bar by bar`, first: null }
  }
  // 8. the texts the script draws (label texts, by bar). Ungraded texts are LISTED, never dropped.
  const textsNow = typeof texts === 'function' ? texts() : texts
  if (textsNow) {
    if (textsNow.status === 'ungraded') extra.ungradedTexts = [{ what: textsNow.what || 'labels', why: textsNow.reason || 'ungraded' }]
    else if (textsNow.status !== 'ok') {
      return { verdict: 'INCONCLUSIVE', step: 8, reason: `the drawn texts cannot be read: ${textsNow.reason || 'unread'}`, first: null, graded: covered, ...extra }
    } else {
      const t = compareTexts(textsNow.reference, textsNow.ours, graded || span)
      if (t.verdict !== 'MATCH') return { ...t, step: 8, graded: covered, ...extra }
      covered.texts = t.compared
      done = { verdict: 'MATCH', step: 8, reason: `${done.reason}; every drawn text equal`, first: null }
    }
  }
  return { ...done, graded: covered, ...extra }
}

// ── step 7: the value series ──────────────────────────────────────────────────
/** A value's tolerance: the corpus harness's (`REL_TOL`, the unknown-scale floor); `na` only equals `na`. */
const VALUE_TOL = Object.freeze({ rel: REL_TOL, abs: ABS_FLOOR_UNKNOWN_SCALE })
/**
 * `series`: `[{ title, reference: [{time, value}], ours: [{time, value}], rule? }]`, one per plot of the
 * capture, ALREADY PAIRED by the caller (which refuses a pairing it cannot prove). Every bar of the
 * reference inside `span` must have a bar of ours at that time with an agreeing value.
 */
function compareValueSeries(series, span) {
  for (const s of series) {
    const ref = (s.reference || []).filter((p) => inSpan(p.time, span))
    const our = new Map((s.ours || []).filter((p) => inSpan(p.time, span)).map((p) => [p.time, p.value]))
    const rule = s.rule || 'B-VAL'
    if (our.size !== ref.length) {
      return { verdict: 'DIVERGE', reason: `value series ${s.title} has ${our.size} bars of ours against ${ref.length}`, first: { time: ref.length ? ref[0].time : null, rule } }
    }
    for (const p of ref) {
      if (!our.has(p.time) || !valuesAgree(our.get(p.time), p.value, VALUE_TOL)) {
        const o = our.has(p.time) ? our.get(p.time) : undefined
        return { verdict: 'DIVERGE', reason: `value series ${s.title} differs at ${p.time} (reference ${isNa(p.value) ? 'na' : p.value}, ours ${o === undefined ? 'no bar' : isNa(o) ? 'na' : o})`, first: { time: p.time, rule } }
      }
    }
  }
  return { verdict: 'MATCH', reason: 'every value series equal', first: null }
}

// ── ruling D11: THE FIRST DIFFERENCE of a run that diverges, found mechanically ─────────────────
/**
 * The earliest bar on which our run and TradingView's differ, over everything the grade places on a bar: the
 * fills (step 5), the value series (step 7) and the drawn texts (step 8). Trades are checked through their
 * fills; a report slot has no bar and never sets it.
 *
 * `prefixExact` is the proof ruling D11 asks for: restricted to the bars STRICTLY BEFORE that bar, the closed
 * trades, the fills, every value series and every text are equal. It is computed here, never asserted, and it
 * FAILS CLOSED: plots that could not be paired, texts that could not be read, or reference fills that could
 * not be placed in time make it false.
 *
 * @returns {{bar:number, step:5|7|8, prefixExact:boolean} | null}  null when no fill, value or text differs
 *   (a difference in a profit or a report slot alone): there is then no event to scope a culprit to.
 */
export function strategyFirstDifference({ reference, ours, tick = 0.01, span, graded, values, texts }) {
  const within = graded || span
  const inS = (t) => inSpan(t, within)
  const refFills = reference && Array.isArray(reference.fills) ? reference.fills : null
  if (!refFills || reference.fillsTimed !== true) return null
  const ourFills = Array.isArray(ours && ours.fills) ? ours.fills : []
  const valuesOk = !!values && values.status === 'ok'
  const textsOk = !!texts && texts.status === 'ok'
  const textsGraded = !texts || texts.status === 'ungraded' || textsOk // absent / ungraded texts are not a graded step
  const f = compareFills(refFills.filter((x) => inS(x.time)), ourFills.filter((x) => inS(x.time)), tick)
  const fillAt = f.verdict === 'MATCH' ? null : f.first.time
  let valueAt = null
  if (valuesOk) {
    for (const s of values.series) {
      const our = new Map((s.ours || []).map((p) => [p.time, p.value]))
      for (const p of s.reference || []) {
        if (!inS(p.time) || (valueAt !== null && p.time >= valueAt)) continue
        if (!our.has(p.time) || !valuesAgree(our.get(p.time), p.value, VALUE_TOL)) valueAt = p.time
      }
    }
  }
  let textAt = null
  if (textsOk) {
    const t = compareTexts(texts.reference, texts.ours, within)
    if (t.verdict !== 'MATCH') textAt = t.first.time
  }
  const at = [fillAt, valueAt, textAt].filter((x) => x !== null)
  if (!at.length) return null
  const bar = Math.min(...at)
  const step = fillAt === bar ? 5 : valueAt === bar ? 7 : 8
  const before = { from: within && within.from, to: within && within.to !== undefined ? Math.min(within.to, bar) : bar }
  const inB = (t) => inSpan(t, before)
  const closedBefore = (list) => (list || []).filter((t) => t.open !== true && t.exitTime !== null && t.exitTime !== undefined && inB(t.exitTime))
  const tradesExact = compareTrades(closedBefore(reference.trades), closedBefore(ours && ours.trades), tick).verdict === 'MATCH'
  const fillsExact = compareFills(refFills.filter((x) => inB(x.time)), ourFills.filter((x) => inB(x.time)), tick).verdict === 'MATCH'
  const valuesExact = valuesOk && compareValueSeries(values.series, before).verdict === 'MATCH'
  const textsExact = textsGraded && (!textsOk || compareTexts(texts.reference, texts.ours, before).verdict === 'MATCH')
  return { bar, step, prefixExact: tradesExact && fillsExact && valuesExact && textsExact }
}

// ── step 8: the drawn texts ───────────────────────────────────────────────────
/** `reference` / `ours`: `[{ time, text }]`. The same texts on the same bars, as multisets per bar. */
function compareTexts(reference, ours, span) {
  const bag = (rows) => {
    const m = new Map()
    for (const r of rows || []) {
      if (!inSpan(r.time, span)) continue
      if (!m.has(r.time)) m.set(r.time, [])
      m.get(r.time).push(String(r.text))
    }
    for (const v of m.values()) v.sort()
    return m
  }
  const a = bag(reference)
  const b = bag(ours)
  let compared = 0
  for (const t of [...new Set([...a.keys(), ...b.keys()])].sort((x, y) => x - y)) {
    const x = a.get(t) || []
    const y = b.get(t) || []
    if (x.length !== y.length || x.some((v, i) => v !== y[i])) {
      return { verdict: 'DIVERGE', reason: `the drawn texts at ${t} differ (reference ${JSON.stringify(x)}, ours ${JSON.stringify(y)})`, first: { time: t, rule: 'B-VAL' } }
    }
    compared += x.length
  }
  return { verdict: 'MATCH', compared }
}

// ── U14 step 5: fills ─────────────────────────────────────────────────────────
const fillKey = (f, tick) => `${f.side}|${f.role}|${Math.round(f.price / tick)}`
function fillGroups(fills, tick) {
  const byTime = new Map()
  for (const f of fills) {
    if (!byTime.has(f.time)) byTime.set(f.time, new Map())
    const g = byTime.get(f.time)
    const k = fillKey(f, tick)
    if (!g.has(k)) g.set(k, { qty: 0, ids: new Set(), fills: [] })
    const e = g.get(k)
    e.qty += f.qty
    if (typeof f.id === 'string') e.ids.add(f.id)
    e.fills.push(f)
  }
  return byTime
}
function compareFills(refFills, ourFills, tick) {
  const a = fillGroups(refFills, tick)
  const b = fillGroups(ourFills, tick)
  const times = [...new Set([...a.keys(), ...b.keys()])].sort((x, y) => x - y)
  for (const t of times) {
    const ra = a.get(t)
    const ob = b.get(t)
    const ourRule = ob ? ruleOf([...ob.values()][0].fills[0]) : 'unattributed'
    if (!ra) return { verdict: 'DIVERGE', reason: `a fill of ours at ${t} that TradingView does not have`, first: { time: t, rule: ourRule } }
    if (!ob) return { verdict: 'DIVERGE', reason: `no fill of ours at ${t}`, first: { time: t, rule: 'unattributed' } }
    for (const k of new Set([...ra.keys(), ...ob.keys()])) {
      const x = ra.get(k)
      const y = ob.get(k)
      const rule = y ? ruleOf(y.fills[0]) : ourRule
      if (!x || !y) return { verdict: 'DIVERGE', reason: `the fills at ${t} differ (${k} on ${x ? "TradingView's" : 'our'} side only)`, first: { time: t, rule } }
      if (Math.abs(x.qty - y.qty) > 1e-9 * Math.max(1, Math.abs(x.qty))) {
        return { verdict: 'DIVERGE', reason: `the ${k} quantity at ${t} differs (reference ${x.qty}, ours ${y.qty})`, first: { time: t, rule } }
      }
      for (const of of y.fills) {
        if (of.labelled === true && typeof of.id === 'string' && !x.ids.has(of.id)) {
          return { verdict: 'DIVERGE', reason: `the ${k} fill at ${t} is ${of.id} on our side and ${[...x.ids].join(' / ') || 'unnamed'} on TradingView's`, first: { time: t, rule: ruleOf(of) } }
        }
      }
    }
  }
  return { verdict: 'MATCH', reason: 'every fill equal', first: null }
}

// ── U14 step 6: the report slots ──────────────────────────────────────────────
/** `slots`: `{ slot: { kind: 'count'|'value', reference: {status, value?}, ours: {status, value?, guard?} } }`. */
function compareSlots(slots) {
  const compared = []
  const ungraded = []
  for (const [slot, s] of Object.entries(slots)) {
    const ref = s && s.reference
    const our = s && s.ours
    if (!ref || ref.status !== 'ok') { ungraded.push({ slot, why: `reference ${ref ? ref.status : 'absent'}` }); continue }
    if (!our || our.status !== 'served') { ungraded.push({ slot, why: `ours ${our ? (our.guard || our.status) : 'absent'}` }); continue }
    compared.push(slot)
    const same = s.kind === 'count' ? our.value === ref.value : sameCurrency(our.value, ref.value)
    if (!same) return { verdict: 'DIVERGE', reason: `report slot ${slot} differs (reference ${ref.value}, ours ${our.value})`, compared, ungraded }
  }
  return { verdict: 'MATCH', compared, ungraded }
}

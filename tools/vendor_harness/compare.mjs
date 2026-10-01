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

export const REL_TOL = 1e-9
export const ABS_TICK_FRACTION = 1e-6
export const ABS_FLOOR_UNKNOWN_SCALE = 1e-12

export const VERDICTS = Object.freeze(['MATCH', 'DIVERGE', 'INCONCLUSIVE'])

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
    const half = 0.5 * 10 ** (-declared)
    if (half > abs) {
      abs = half
      absReason = `half a unit in the ${declared}th decimal — the capture's declared readDecimals (legacy)`
    }
  }
  return { rel: REL_TOL, abs, absReason }
}

const isNa = (v) => v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v))

export function valuesAgree(ours, vendor, tol) {
  if (isNa(ours) || isNa(vendor)) return isNa(ours) && isNa(vendor)
  const d = Math.abs(ours - vendor)
  return d <= tol.abs || d <= tol.rel * Math.abs(vendor)
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

export function vendorPlotRoles(capture) {
  const plots = (capture.study && capture.study.plots) || []
  const styles = (capture.study && capture.study.styles) || {}
  const value = []
  const colorers = []
  const notDrawn = []
  const notCompared = []
  plots.forEach((p, idx) => {
    const title = decodeVendorText((p.title !== undefined ? p.title : (styles[p.id] && styles[p.id].title)) ?? null)
    const rec = { ...p, title, column: idx + 1 }
    if (VALUE_TYPES.has(p.type)) value.push(rec)
    // ⛔ A colorer on a FILLED AREA colours the fill, not a plot. v1 does not
    // grade fills, so it is reported NOT COMPARED by name, never dropped.
    else if (p.type === 'colorer' && isFillTarget(p.target)) notCompared.push({ ...rec, why: `fill colour (${p.target})` })
    else if (p.type === 'colorer') colorers.push(rec)
    else if (p.type === 'alertcondition') notDrawn.push(rec)
    else notCompared.push(rec)
  })
  return { value, colorers, notDrawn, notCompared }
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
 * @param {object} a.tol             from `tolerancePolicy`
 */
export function comparePlot({ times, vendor, ours, vendorColors = null, ourColors = null, warmupBars = 0, tol, oursUnreadAfter = null }) {
  const n = times.length
  const res = {
    bars: n,
    compared: 0,
    // Bars our side cannot report the vendor's quantity for (see `leadBy`).
    oursUnread: 0,
    matching: 0,
    vendorRowsMissing: 0,
    naMismatches: 0,
    valueMismatches: 0,
    colorMismatches: 0,
    colorCompared: 0,
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
    const o = ours[i]
    res.compared += 1
    if (!isNa(v)) res.valued += 1
    const region = i < warmupBars ? res.warmup : res.steady
    region.compared += 1
    let kind = null
    if (isNa(v) !== isNa(o)) { kind = 'na'; res.naMismatches += 1 }
    else if (!isNa(v)) {
      const d = Math.abs(o - v)
      const rel = d / Math.max(Math.abs(v), Number.MIN_VALUE)
      if (d > res.maxAbs) res.maxAbs = d
      if (Math.abs(v) > 0 && rel > res.maxRel) res.maxRel = rel
      if (!valuesAgree(o, v, tol)) { kind = 'value'; res.valueMismatches += 1 }
    }
    if (vendorColors && !isNa(v) && vendorColors[i] !== undefined && vendorColors[i] !== null) res.colorComparable += 1
    if (!kind && vendorColors && ourColors && !isNa(v)) {
      const vc = vendorColors[i]
      const oc = ourColors[i]
      if (vc !== undefined && vc !== null && oc !== undefined) {
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
      }
    } else {
      res.matching += 1
    }
    if (region === res.steady) steadyComparedBars.push(i)
  }
  res.vendorRowGapsAfterStart = gapAfterRows
  res.steady.pattern = divergencePattern(steadyComparedBars, steadyDivergentBars, res.steady)
  return res
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

/** One plot's verdict from its comparison, with the reason written out. */
export function plotVerdict(r, { colorMeasured, colorResolvable, vendorColorReason = null, ourColorReason = null }) {
  if (r.vendorRowGapsAfterStart > 0) {
    return { verdict: 'INCONCLUSIVE', reason: `${r.vendorRowGapsAfterStart} bars have no vendor row after the study had started — a hole in what was read, not an answer` }
  }
  if (r.steady.divergent > 0) {
    const f = r.steady.first
    const p = r.steady.pattern
    const shape = p && p.kind === 'converging-prefix'
      ? ` — a CONVERGING PREFIX: bars ${f.bar}..${p.lastDivergentBar}${p.contiguous ? '' : ' (with agreeing bars inside the run)'} differ with |err| falling ${p.absErrFirst.toExponential(2)} → ${p.absErrLast.toExponential(2)}, then all ${p.agreeingAfter} later bars agree (the recursive-state-seeded-at-the-window signature)`
      : p ? ` — ${p.kind}, last at bar ${p.lastDivergentBar}` : ''
    return { verdict: 'DIVERGE', reason: `${r.steady.divergent} steady-state bars disagree; first at bar ${f.bar} (${readingOf(f)})${shape}` }
  }
  if (r.steady.compared === 0) {
    return { verdict: 'INCONCLUSIVE', reason: r.compared === 0 ? 'no bar was compared' : 'every compared bar is inside the warm-up region — nothing in steady state to judge' }
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
  return { verdict: 'MATCH', reason: `${r.steady.compared} steady-state bars agree` + (r.warmup.divergent ? ` (${r.warmup.divergent} warm-up bars differ, reported separately)` : '') }
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
  if (changed.length) return inconclusive(`the vendor study ran with non-default inputs (${changed.map((i) => `${i.name || i.id}=${JSON.stringify(i.value)} vs default ${JSON.stringify(i.defval)}`).join(', ')}); v1 compares at default inputs only — re-capture at defaults`)
  if (!ours || !ours.ok) return inconclusive(`refused on our side: ${(ours && ours.refusal) || 'no result'}`)

  const tol = tolerancePolicy(capture)
  base.tolerance = tol
  const times = capture.bars.rows.map((r) => r[0])
  const rowsByTime = new Map((capture.plotValues.rows || []).map((r) => [String(r[0]), r]))
  const roles = vendorPlotRoles(capture)
  for (const p of roles.notDrawn) base.notCompared.push({ id: p.id, title: p.title, type: p.type, why: 'alertcondition — draws nothing on TradingView either; not a visual claim' })
  for (const p of roles.notCompared) base.notCompared.push({ id: p.id, title: p.title, type: p.type, why: `plot type ${p.type} is not compared by v1` })

  // History: a capture that provably starts at bar 0 has no pre-window state our
  // side lacks, so there is no warm-up excuse and every bar counts.
  const bar0 = capture.history && capture.history.startsAtBar0 === true

  const map = mapPlots(roles.value, ours.plots || [])
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
    if (!o.column) {
      base.plots.push({ id: v.id, title: v.title, ours: o.key || null, rule: pair.rule, verdict: 'INCONCLUSIVE',
        reason: `our side produced no column for this plot${o.missingReason ? ` — ${o.missingReason}` : ''}` })
      continue
    }
    const vc = vendorColorsFor(capture, v, roles.colorers, rowsByTime, times)
    const treeShift = Number.isInteger(o.treeShift) && o.treeShift > 0 ? o.treeShift : 0
    const ourColors = vc.measured ? (leadBy(o.colors, treeShift) || null) : null
    let warmupBars
    let warmupSource
    if (bar0) { warmupBars = 0; warmupSource = 'capture starts at bar 0 — no warm-up excuse' }
    else if (capture.warmup && Number.isInteger(capture.warmup.bars)) { warmupBars = capture.warmup.bars; warmupSource = `declared by the capture (${capture.warmup.source || 'unstated'})` }
    else if (Number.isInteger(o.lookback)) { warmupBars = o.lookback; warmupSource = 'derived: our evaluator\'s maxLookback for this plot' }
    else { warmupBars = 0; warmupSource = 'lookback unknown — no warm-up region' }
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
    const colourUngraded = hiddenOnVendor || emptyGlyph
    const r = comparePlot({ times, vendor: vendorVals, ours: oursCol, vendorColors: colourUngraded ? null : vc.colors, ourColors: colourUngraded ? null : ourColors, warmupBars, tol, oursUnreadAfter: treeShift ? times.length - treeShift : null })
    const pv = plotVerdict(r, {
      colorMeasured: vc.measured && !colourUngraded,
      colorResolvable: !!ourColors,
      vendorColorReason: vc.measured && !vc.colors ? vc.reason : null,
      ourColorReason: o.colorsReason || null,
    })
    base.plots.push({
      id: v.id, title: v.title ?? o.title, ours: o.key, rule: pair.rule, ...pv,
      warmupBars, warmupSource, derivedLookback: Number.isInteger(o.lookback) ? o.lookback : null,
      ...(treeShift ? { treeShift, treeShiftNote: `offset = ${treeShift}: our column read ${treeShift} bars ahead to meet the vendor's unshifted series; the last ${treeShift} bars are unread` } : {}),
      color: !vc.measured ? 'not captured'
        : colourUngraded ? (emptyGlyph ? 'not graded — an empty plotchar glyph draws nothing' : 'not graded — hidden on TradingView (display none)')
          : !vc.colors ? 'undecodable in the capture'
            : r.colorComparable === 0 ? 'nothing drawn on any bar — no colour to compare'
              : ourColors ? 'compared' : 'unresolvable on our side',
      stats: r,
    })
  }
  for (const o of map.unmappedOurs) base.notCompared.push({ ours: o.key, title: o.title, why: 'our plot has no vendor counterpart (hidden helper or a plot TradingView did not report)' })

  // Objects — counts of what each side KEEPS, and the text they carry.
  if (capture.objects || (ours.objects && ours.objects.drawsObjects)) {
    base.objects = compareObjects(capture.objects || null, ours.objects || null, opts.objectColours || null)
  }

  if (!capture.plotValues || !capture.study) base.notMeasured.push('plot values')
  if (!roles.colorers.length && !Object.keys((capture.study && capture.study.styleState) || {}).length) base.notMeasured.push('colour')

  const plotVerdicts = base.plots.map((p) => p.verdict)
  const overallOf = (verdicts) => {
    const n = (x) => verdicts.filter((y) => y === x).length
    if (n('DIVERGE')) return { verdict: 'DIVERGE', reason: `${n('DIVERGE')} of ${verdicts.length} compared items diverge` }
    if (n('INCONCLUSIVE')) return { verdict: 'INCONCLUSIVE', reason: `${n('INCONCLUSIVE')} of ${verdicts.length} items could not be compared` }
    return { verdict: 'MATCH', reason: `all ${verdicts.length} items agree` }
  }
  const verdicts = base.objects ? [...plotVerdicts, base.objects.verdict] : plotVerdicts
  if (!verdicts.length) return { ...base, verdict: 'INCONCLUSIVE', reason: 'nothing on either side could be compared' }
  const out = { ...base, ...overallOf(verdicts) }
  // ⭐ C44 — BOTH NUMBERS, SIDE BY SIDE. Where object colour was graded, the
  // capture also carries the verdict it had BEFORE colour joined it, so a score
  // that moves because of colour is never mistaken for a regression: an entry
  // whose two verdicts differ changed for that reason and no other.
  if (base.objects && base.objects.verdictWithoutColour) {
    out.verdictWithoutColour = overallOf([...plotVerdicts, base.objects.verdictWithoutColour]).verdict
  }
  return out
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

export function objectColourRows(pairing) {
  const by = new Map()
  for (const r of (pairing && pairing.rows) || []) {
    const family = COLOUR_FAMILY_OF[r.kind]
    // ⛔ FAIL CLOSED: a kind or a state this table does not name is never
    // quietly read as agreeing.
    if (!family) throw new Error(`object colour: unknown object kind ${JSON.stringify(r.kind)}`)
    if (!by.has(family)) {
      by.set(family, { family: `${family} colour`, agree: null, slots: 0, agreeing: 0, themeRelative: 0, differing: 0, undecodable: 0, first: null })
    }
    const row = by.get(family)
    row.slots += 1
    if (COLOUR_DIFFERS.has(r.state)) {
      row.differing += 1
      if (!row.first) row.first = { slot: `${r.kind}.${r.slot}`, state: r.state, vendor: r.vendor, ours: r.ours, where: r.where }
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
export function compareObjects(vendorObjs, ourObjs, colour = null) {
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
    return vendorTotal === 0
      ? { verdict: 'MATCH', reason: 'neither side draws an object' }
      : { verdict: 'DIVERGE', reason: `TradingView holds ${vendorTotal} drawing object(s) at the last bar and our script has no drawing program` }
  }
  if (!ourObjs || !ourObjs.ok) return { verdict: 'INCONCLUSIVE', reason: `our object lane did not run: ${(ourObjs && ourObjs.reason) || 'no result'}` }
  const families = ['lines', 'labels', 'boxes', 'tables', 'tableCells']
  const rows = []
  let diverge = 0
  for (const f of families) {
    const v = vendorObjs.counts ? vendorObjs.counts[f] : undefined
    const o = ourObjs.counts ? ourObjs.counts[f] : undefined
    if (v === undefined || o === undefined) { rows.push({ family: f, vendor: v ?? null, ours: o ?? null, agree: null }); continue }
    const agree = v === o
    if (!agree) diverge += 1
    rows.push({ family: f, vendor: v, ours: o, agree })
  }
  const textRows = []
  for (const f of ['labels', 'tableCells']) {
    const vt = vendorObjs.texts && vendorObjs.texts[f]
    const ot = ourObjs.texts && ourObjs.texts[f]
    if (!Array.isArray(vt) || !Array.isArray(ot)) continue
    const a = [...vt].map(String).sort()
    const b = [...ot].map(String).sort()
    const agree = a.length === b.length && a.every((x, i) => x === b[i])
    if (!agree) diverge += 1
    textRows.push({ family: `${f} text`, agree, onlyVendor: a.filter((x) => !b.includes(x)).slice(0, 10), onlyOurs: b.filter((x) => !a.includes(x)).slice(0, 10) })
  }
  const measured = rows.filter((r) => r.agree !== null).length + textRows.length
  if (!measured) return { verdict: 'INCONCLUSIVE', reason: 'no object family was recorded on both sides', counts: rows }
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
  const first = colourDiverge.length ? colourDiverge[0].first : null
  const colourSaid = !graded ? 'no colour slot was paired, so no colour was graded'
    : first
      ? `${colourDiverge.length} object ${colourDiverge.length === 1 ? 'family differs' : 'families differ'} in COLOUR (first: ${first.slot} of ${first.where} — vendor ${first.vendor ?? 'none'}, ours ${first.ours ?? 'none'}, ${first.state})`
      : `colours agree on ${graded} paired slots${theme ? ` (${theme} theme-relative)` : ''}`
  return {
    verdict: diverge || colourDiverge.length ? 'DIVERGE' : 'MATCH',
    verdictWithoutColour: diverge ? 'DIVERGE' : 'MATCH',
    reason: `${diverge ? `${diverge} object families differ (count or text)` : 'object counts and texts agree'}; ${colourSaid}; coordinates are NOT compared by v1`,
    counts: rows,
    texts: textRows,
    colours,
    colourUnpaired: colour.unpaired || null,
  }
}

// ── REPORT ───────────────────────────────────────────────────────────────────

export function renderSummary(results) {
  const pad = (s, n) => String(s ?? '').slice(0, n).padEnd(n)
  const lines = [
    `${pad('capture', 44)} ${pad('symbol/tf', 16)} ${pad('plots', 6)} ${pad('verdict', 13)} first divergence / reason`,
    `${'-'.repeat(44)} ${'-'.repeat(16)} ${'-'.repeat(6)} ${'-'.repeat(13)} ${'-'.repeat(40)}`,
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
    }
    lines.push(`${pad(r.id, 44)} ${pad(`${r.symbol || '?'} ${r.timeframe || '?'}`, 16)} ${pad(plots, 6)} ${pad(r.verdict, 13)} ${tail}`)
    for (const p of (r.plots || [])) {
      const s = p.stats
      const detail = s ? `cmp ${s.compared} ok ${s.matching} warm ${s.warmup.divergent}/${s.warmup.compared} steady ${s.steady.divergent}/${s.steady.compared} maxRel ${s.maxRel.toExponential(2)}` : ''
      lines.push(`    ${pad(p.title ?? p.id, 40)} ${pad(p.verdict, 13)} ${detail}${p.verdict !== 'MATCH' ? ` — ${p.reason}` : ''}`)
    }
    if (r.objects) lines.push(`    ${pad('objects', 40)} ${pad(r.objects.verdict, 13)} ${r.objects.reason}`)
  }
  const tally = Object.fromEntries(VERDICTS.map((v) => [v, results.filter((r) => r.verdict === v).length]))
  lines.push('')
  lines.push(`TOTAL ${results.length} captures — MATCH ${tally.MATCH} · DIVERGE ${tally.DIVERGE} · INCONCLUSIVE ${tally.INCONCLUSIVE}`)
  // ⭐ C44 — the same total as it read before object colour joined the verdict,
  // and every capture colour moved, by name.
  const coloured = results.filter((r) => r.verdictWithoutColour)
  if (coloured.length) {
    const before = Object.fromEntries(VERDICTS.map((v) => [v, results.filter((r) => (r.verdictWithoutColour || r.verdict) === v).length]))
    const moved = results.filter((r) => r.verdictWithoutColour && r.verdictWithoutColour !== r.verdict)
    lines.push(`WITHOUT OBJECT COLOUR (the verdict before C44; colour graded on ${coloured.length} captures) — MATCH ${before.MATCH} · DIVERGE ${before.DIVERGE} · INCONCLUSIVE ${before.INCONCLUSIVE}`)
    lines.push(`CHANGED BY OBJECT COLOUR (${moved.length}): ${moved.map((r) => `${r.id} ${r.verdictWithoutColour} → ${r.verdict}`).join('; ') || 'none'}`)
  }
  return lines.join('\n')
}

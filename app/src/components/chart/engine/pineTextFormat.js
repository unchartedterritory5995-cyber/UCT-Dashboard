// app/src/components/chart/engine/pineTextFormat.js
//
// ─── ⭐⭐ `str.format` — WHAT TRADINGVIEW DRAWS, AND ONLY WHAT IT HAS BEEN SEEN TO ─
//
// Pine's `str.format(formatString, arg0, arg1, …)` is a MessageFormat-style
// template: literal text with `{N}` placeholders, each optionally carrying a
// format element (`{N,number,#.##}`). The TRANSLATOR compiles the literal
// pattern once, here, into literal parts and argument slots; the OBJECT RUNTIME
// formats each numeric argument per bar with `formatMessageNumber`, also here.
// One module owns both halves so the grammar the translator admits and the
// renderings the runtime produces cannot drift apart.
//
// ⛔⛔ EVERY RULE BELOW IS READ OFF A VENDOR CAPTURE, AND ANYTHING THE CAPTURES DO
// NOT PIN IS REFUSED BY NAME — never approximated. A table cell or a label is
// member-visible text; a text that would render differently from TradingView
// must not be drawn at all.
//
//   `{N}` with a number   tests/fixtures/vendor/harness/
//                         liquidation-levels-rddt-1d-2026-09-28.json — ten labels
//                         `str.format("+{0}x: {1}", i_x1, x1_long)`:
//                           5.0                 → "5"        (an integer: no point)
//                           120.42566666666667  → "120.426"  (THREE decimals, ROUNDED
//                                                             — truncation reads .425)
//                           177.06150000000002  → "177.062"
//                           140.4147843137255   → "140.415"
//                         Every value there is below 1000 and none is an exact
//                         tie, so those are the limits of what is pinned.
//   `{N,number,#.##}`     tests/fixtures/vendor/w3-format-spy-1d-2026-09-22.json
//                         (`tools/visual_conformance/probes/w3-format.pine`, F12):
//                         the LENGTH of `str.format("{0,number,#.##}", close)`
//                         equals the length of `str.tostring(close, "#.##")` (F03)
//                         on all 300 SPY bars, closes 621.72 … 777.88, integer
//                         closes included (700 → 3 characters). No close there
//                         has more than two decimals and none reaches 1000.
//
// ⛔ WHAT IS REFUSED, AND WHY EACH ONE IS NOT A GUESS WAITING TO HAPPEN:
//   * a magnitude of 1000 or more — Java's default `{N}` number pattern groups
//     thousands ("1,234.5") and no capture shows what TradingView prints there;
//   * an EXACT decimal tie at the last kept digit (0.0625 at three decimals) —
//     the rounding MODE is not pinned: every captured value rounds one way on
//     its own digits, so HALF_EVEN and HALF_UP agree on all of them;
//   * `na` — no capture formats one through `str.format`;
//   * a result that would read "-0" — the sign of a rounded-away negative;
//   * every other format element (`{N,number}`, `integer`, `percent`,
//     `currency`, `date`, `time`, `choice`, any other number pattern), a quote
//     (`'`), an unbalanced brace — none of them is in any capture.
// The captures that would settle each are named in docs/pine/vendor-harness/
// objects-triage-2026-09-28.md, step 13.

/** The number patterns a `{N,number,P}` element may carry, each with the
 *  capture that pins it. ⛔ A PATTERN NOT IN THIS TABLE IS REFUSED BY NAME —
 *  "it is the same grammar as `str.tostring`" is an inference, and F12 pins the
 *  equivalence for `#.##` alone. */
export const MESSAGE_NUMBER_PATTERNS = Object.freeze({
  '#.##': 'w3-format-spy-1d-2026-09-22.json F12 == F03 on 300 bars',
})

/** The largest magnitude any captured `str.format` number reached, as a bound:
 *  below 1000 no grouping separator can appear in either reading. */
export const MESSAGE_NUMBER_LIMIT = 1000

/** Decimals Java's default `{N}` number pattern ("#,##0.###") keeps — pinned by
 *  `120.42566666666667 → "120.426"`. */
export const MESSAGE_DEFAULT_DECIMALS = 3

/**
 * Compile a `str.format` pattern.
 *
 * @param {string} pattern  the literal format string
 * @param {number} argCount how many arguments follow it
 * @returns {{ok: true, parts: Array<{lit: string}|{arg: number, fmt?: string}>}
 *          | {ok: false, why: string}}
 *
 * ⭐ `why` IS A NAME, not a sentence, so a diagnostic can count refusals by kind.
 */
export function compileMessagePattern(pattern, argCount) {
  if (typeof pattern !== 'string') return { ok: false, why: 'format:pattern-not-literal' }
  const parts = []
  let lit = ''
  let i = 0
  while (i < pattern.length) {
    const ch = pattern[i]
    // ⛔ A QUOTE IS MessageFormat's escape character — `'{0}'` is the literal
    // text {0} and `''` is one apostrophe. No capture shows what TradingView does
    // with either, so a pattern holding one is refused rather than read two ways.
    if (ch === "'") return { ok: false, why: 'format:quote' }
    if (ch === '}') return { ok: false, why: 'format:brace' }
    if (ch !== '{') { lit += ch; i += 1; continue }
    const close = pattern.indexOf('}', i + 1)
    if (close < 0) return { ok: false, why: 'format:brace' }
    const body = pattern.slice(i + 1, close)
    if (body.includes('{')) return { ok: false, why: 'format:brace' }
    const m = /^\s*(\d+)\s*(?:,(.*))?$/.exec(body)
    if (!m) return { ok: false, why: 'format:element' }
    const index = Number(m[1])
    // ⛔ An index past the arguments is printed back literally by MessageFormat
    // ("{5}"). That is a script bug nobody captured; refused, not reproduced.
    if (!Number.isInteger(index) || index >= argCount) return { ok: false, why: 'format:index' }
    let fmt
    if (m[2] !== undefined) {
      const spec = /^\s*number\s*,(.*)$/.exec(m[2])
      if (!spec) return { ok: false, why: `format:element:${m[2].split(',')[0].trim() || 'empty'}` }
      const p = spec[1]
      if (!Object.hasOwn(MESSAGE_NUMBER_PATTERNS, p)) return { ok: false, why: `format:number-pattern:${p}` }
      fmt = p
    }
    if (lit) { parts.push({ lit }); lit = '' }
    parts.push(fmt === undefined ? { arg: index } : { arg: index, fmt })
    i = close + 1
  }
  if (lit) parts.push({ lit })
  return { ok: true, parts }
}

/** Is `n` EXACTLY halfway between two neighbours at `d` decimals?
 *
 *  ⭐ Read off the double's exact decimal expansion: `toFixed(100)` is exact for
 *  every double whose magnitude this module admits (a double below 1000 has at
 *  most ~62 fractional decimal digits), so "the digit after the last kept one is
 *  5 and everything after it is 0" is a tie and nothing else is. */
export function exactTieAt(n, d) {
  if (!Number.isFinite(n)) return false
  const s = Math.abs(n).toFixed(100)
  const frac = s.slice(s.indexOf('.') + 1)
  return frac[d] === '5' && /^0*$/.test(frac.slice(d + 1))
}

/** Up to `max` decimals, trailing zeros and a bare point trimmed. `null` for a
 *  rendering no capture pins (see the header). */
function trimmedFixed(n, max) {
  if (exactTieAt(n, max)) return null
  const out = n.toFixed(max).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
  return out === '-0' ? null : out
}

/**
 * ⭐⭐ ONE `str.format` NUMBER, as TradingView draws it — or `null` when no
 * capture pins what it would draw, which the object runtime turns into a
 * WITHHELD text (the object is not drawn), never a best guess.
 *
 * @param {number} n
 * @param {string} [fmt]  a `{N,number,P}` pattern from `MESSAGE_NUMBER_PATTERNS`;
 *                        absent for a bare `{N}`
 */
export function formatMessageNumber(n, fmt) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null
  if (Math.abs(n) >= MESSAGE_NUMBER_LIMIT) return null
  if (fmt === undefined) return trimmedFixed(n, MESSAGE_DEFAULT_DECIMALS)
  if (fmt === '#.##') return trimmedFixed(n, 2)
  return null
}

// ─── ⭐⭐ F3 (2026-10-02) — `str.tostring(n, format)`: ONE GRAMMAR, ONE RENDERING ─
//
// The object lane (host program, and the runtime pane's values drawn through
// it) prints a number into a label, box or cell through `str.tostring`. Its
// format rules live HERE, beside `str.format`'s, for the same reason: the
// translator decides what it admits from the grammar below and the runtime
// renders with the functions below, so the two cannot drift.
//
//   no format          ten decimals, trailing zeros trimmed (C43,
//                      `objectRuntime.js::defaultNumberText`)
//   `#`/`0` pattern    `formatPlainNumber` — the C13 implementation, moved here
//                      unchanged from `objectRuntime.js::formatNumber`
//   `format.mintick`   `tickNumberText` — rounds to the symbol's tick and prints
//                      that tick's decimals, trailing zeros KEPT. MEASURED:
//                      trend-targets-algoalpha RDDT (tick 0.01)
//                      `" ✔ TP3 ▸ 222.80"`, `"✘ SL ▸ 109.61"`;
//                      trend-lines-supports-and-resistances RDDT
//                      `"Resistance : 263.50"`. ⚰️ Read as "no format" it
//                      printed `177.5276604489` beside TradingView's `177.53`.
//   literal text       `formatPatternedNumber` — Java DecimalFormat's prefix /
//   around a pattern   suffix: `"Swing H  (#,###.####)"` draws
//                      `"Swing H  (282.95)"` (swing-highlow-zigzag-chartprime
//                      RDDT 282.95 / 119.27, SPY 697.84 / 629.28).
//
// ⛔ WHAT IS WITHHELD (null), each because no capture shows it:
//   * a grouping separator that would APPEAR — every captured value sits below
//     the group size, so "1,234.5" vs "1234.5" is unpinned;
//   * a `format.mintick` magnitude of 1000 or more (grouping, same reason);
//   * a negative value under a literal prefix (Java puts the minus BEFORE the
//     prefix; no capture shows TradingView doing so);
//   * a value that rounds to a negative zero;
//   * an exact tie at the tick (`format.mintick`'s "ties round up" is the
//     reference's sentence, not a capture);
//   * `%`, `‰`, `¤`, a quote or `;` anywhere — each changes what the number is.

/** Characters Java's DecimalFormat gives a meaning in a prefix or suffix; a
 *  pattern carrying one is refused rather than read as literal text. */
const FORMAT_SPECIAL_AFFIX = /[%‰¤';#0-9.,]/

/** `#`/`0` digits, optional grouping commas, optional `.` and fraction. */
const FORMAT_CORE = /^([#0,]*)(?:\.([#0]*))?$/

/** The largest magnitude a grouped or tick-formatted capture reached. */
export const TOSTRING_GROUPING_LIMIT = 1000

/**
 * Read a `str.tostring` format string into its parts, or `null` when this
 * grammar does not cover it (the caller refuses or withholds by name).
 *
 * @param {string} fmt
 * @returns {{prefix: string, suffix: string, core: string, grouping: number}|null}
 *   `core` is a plain `#`/`0` pattern (commas removed) `formatPlainNumber` reads;
 *   `grouping` is the group size, 0 for none.
 */
export function tostringPatternOf(fmt) {
  if (typeof fmt !== 'string' || !fmt) return null
  const first = fmt.search(/[#0]/)
  if (first < 0) return null
  // the core runs to the last `#`/`0`
  let last = -1
  for (let i = fmt.length - 1; i >= 0; i -= 1) if (fmt[i] === '#' || fmt[i] === '0') { last = i; break }
  // a leading `.` or `,` belongs to the core (`.##`)
  let start = first
  while (start > 0 && (fmt[start - 1] === '.' || fmt[start - 1] === ',')) start -= 1
  const prefix = fmt.slice(0, start)
  const suffix = fmt.slice(last + 1)
  const body = fmt.slice(start, last + 1)
  if (FORMAT_SPECIAL_AFFIX.test(prefix) || FORMAT_SPECIAL_AFFIX.test(suffix)) return null
  const m = FORMAT_CORE.exec(body)
  if (!m) return null
  const intPart = m[1]
  // ⛔ a comma in the fraction, a doubled comma or a trailing one is not a
  // grouping any capture shows
  if (/,,|,$/.test(intPart)) return null
  const lastComma = intPart.lastIndexOf(',')
  const grouping = lastComma < 0 ? 0 : intPart.length - lastComma - 1
  if (lastComma >= 0 && grouping === 0) return null
  const core = intPart.replace(/,/g, '') + (m[2] !== undefined ? `.${m[2]}` : '')
  if (!/^[#0]*(\.[#0]*)?$/.test(core) || !/[#0]/.test(core)) return null
  return { prefix, suffix, core, grouping }
}

/** Is this a pattern `formatPlainNumber` reads WHOLE (no affix, no grouping)? */
export const isPlainNumberPattern = (fmt) => typeof fmt === 'string' && fmt !== ''
  && /^[#0]*(\.[#0]*)?$/.test(fmt)

/** `#`/`0` patterns: required decimals are the `0`s, optional the `#`s, up to
 *  ten; a leading `00` pads the integer part. MOVED here unchanged from
 *  `objectRuntime.js::formatNumber` (C13), so `str.tostring`'s renderings live
 *  in one module. `null` for a pattern it does not read whole. */
export function formatPlainNumber(n, fmt) {
  if (!isPlainNumberPattern(fmt)) return null
  const dot = fmt.indexOf('.')
  const frac = dot < 0 ? '' : fmt.slice(dot + 1)
  const intPart = dot < 0 ? fmt : fmt.slice(0, dot)
  const max = Math.max(0, Math.min(10, frac.length))
  const min = Math.min(max, (frac.match(/0/g) || []).length)
  let out = n.toFixed(max)
  if (max > min) {
    out = out.replace(/0+$/, (z) => z.slice(0, Math.max(0, min - (max - z.length))))
    out = out.replace(/\.$/, '')
  }
  const wantInt = (intPart.match(/0/g) || []).length
  if (wantInt > 1) {
    const neg = out.startsWith('-')
    const body = neg ? out.slice(1) : out
    const head = body.split('.')[0]
    if (head.length < wantInt) {
      out = (neg ? '-' : '') + '0'.repeat(wantInt - head.length) + body
    }
  }
  return out
}

/**
 * ⭐⭐ `str.tostring(n, fmt)` for a pattern with literal text around it and/or
 * grouping commas — or `null` (WITHHELD) where no capture pins the rendering.
 * A plain pattern is `formatPlainNumber`'s; this is the rest of the grammar.
 */
export function formatPatternedNumber(n, fmt) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null
  const p = tostringPatternOf(fmt)
  if (!p) return null
  const body = formatPlainNumber(n, p.core)
  if (body === null) return null
  if (/^-0(\.0*)?$/.test(body)) return null
  if (body.startsWith('-') && p.prefix) return null
  if (p.grouping > 0) {
    const head = body.replace(/^-/, '').split('.')[0]
    if (head.length > p.grouping) return null
  }
  return `${p.prefix}${body}${p.suffix}`
}

/**
 * ⭐⭐ `str.tostring(n, format.mintick)` given the symbol's tick as its decimal
 * text (`"0.01"`, `"0.25"`) — rounded to a multiple of the tick and printed with
 * the tick's decimals, trailing zeros kept. `null` (WITHHELD) with no settled
 * tick, at 1000 or more, at an exact tie, or for a negative zero. `na` prints
 * `NaN`, as every other `str.tostring` does.
 */
export function tickNumberText(n, tickText) {
  if (typeof tickText !== 'string' || !/^\d+(\.\d+)?$/.test(tickText)) return null
  const tick = Number(tickText)
  if (!(tick > 0)) return null
  if (typeof n !== 'number') return null
  if (!Number.isFinite(n)) return 'NaN'
  if (Math.abs(n) >= TOSTRING_GROUPING_LIMIT) return null
  const dot = tickText.indexOf('.')
  const decimals = dot < 0 ? 0 : tickText.length - dot - 1
  const q = n / tick
  const frac = Math.abs(q - Math.trunc(q))
  // a tie at the tick: exact for a power-of-ten tick, to 1e-9 for any other
  const powerOfTen = /^(1|0\.0*1)$/.test(tickText)
  if (powerOfTen ? exactTieAt(n, decimals) : Math.abs(frac - 0.5) < 1e-9) return null
  const k = Math.round(q)
  // a negative value that rounds to zero: "-0.00" or "0.00" — no capture says
  if (k === 0 && n < 0) return null
  return (k * tick).toFixed(Math.min(decimals, 20))
}

/**
 * ⭐⭐ H5 (step 84) + H7 (step 92h) — `str.tostring(n, format.volume)`, ONLY where
 * captures pin it, else `null` (WITHHELD). `na` prints `NaN`, as every other
 * `str.tostring` does.
 *
 * WITNESSED. multicator-table (2026-10-02, each against OUR computation of the same
 * value on the capture's own bars): 3,125,951 → `3.126M`, 46,335,295 → `46.335M`,
 * −29,983,517 → `-29.984M`, SPY OBV `10.801B`. CAP4 Q-H5a
 * (`vw-h5-format-volume-spy-1d-2026-10-04`, one table cell per constant): 0 → `0`,
 * 7 → `7`, 999 → `999`, 1,000 → `1K`, 1,500 → `1.5K`, 12,345 → `12.345K`,
 * 999,999 → `999.999K`, 1,000,000 → `1M`, 3,100,000 → `3.1M`, 3,125,500 → `3.126M`
 * (an exact tie rounds UP), 3,125,501 → `3.126M`, 999,999,600 → `1000M` (the unit is
 * chosen by the RAW magnitude and does NOT roll over after rounding),
 * 1,000,000,000 → `1B`, −1,500 → `-1.5K`, −3,100,000 → `-3.1M`, 2.5e12 → `2.5T`.
 * So: the unit is the largest of K / M / B / T at or below |n|; |n| / unit rounded
 * to three decimals (a tie up), trailing zeros trimmed, a minus sign before it.
 * Below 1,000 there is no suffix (0, 7 and 999 are whole numbers).
 * ⛔ STILL WITHHELD, each because no capture shows it: a non-whole number below
 * 1,000 (`7.25`, or `7`?); a negative number below 1,000; a NEGATIVE exact tie
 * (half up on the magnitude, or toward +inf?); negative zero; 10^15 (1,000 T) or more.
 */
export const VOLUME_UNITS = Object.freeze([[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']])
export function volumeNumberText(n) {
  if (typeof n !== 'number') return null
  if (!Number.isFinite(n)) return 'NaN'
  if (n === 0) return Object.is(n, -0) ? null : '0'
  const a = Math.abs(n)
  if (a >= 1e15) return null
  const unit = VOLUME_UNITS.find(([u]) => a >= u)
  if (!unit) return n > 0 && Number.isInteger(n) ? String(n) : null
  // thousandths of the unit. Dividing by unit / 1000 (an exact power of ten) keeps a
  // whole-number tie exact: 3,125,500 / 1,000 = 3125.5, where (3,125,500 / 10^6) * 1000
  // is 3125.4999… and would round DOWN.
  const q = a / (unit[0] / 1000)
  if (n < 0 && Math.abs(q - Math.floor(q) - 0.5) < 1e-9) return null
  const k = Math.round(q)
  return `${n < 0 ? '-' : ''}${String(k / 1000)}${unit[1]}`
}

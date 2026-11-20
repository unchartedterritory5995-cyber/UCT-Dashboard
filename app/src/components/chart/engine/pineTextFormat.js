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
//   * ⛔⛔ under a `{N,number,P}` PATTERN, a DECIMAL tie too (N01, 2026-11-19):
//     a value whose shortest decimal ends one digit past the pattern's last kept
//     digit, on a 5 (1.005, 163.265, 2.675 under `#.##`). The binary value
//     printed here reads 1.005 as "1"; `str.tostring(x, "#.##")` is WITNESSED
//     printing the decimal reading, "1.01" (CBC-FMT F6, T01-T07), and no capture
//     shows which one `str.format`'s pattern draws (`decimalTieAt`, below;
//     capture row N01 of queue Q-TF-N-a, PR #2072, settles it; lift by its grade).
//     ⭐ NOT under a bare `{N}`: T24 pins its binary reading (1.0005 -> "1");
//   * `na` — no capture formats one through `str.format`;
//   * a result that would read "-0" — the sign of a rounded-away negative;
//   * every other format element (`{N,number}`, `integer`, `currency`, `date`,
//     `time`, `choice`, any other number pattern), a quote (`'`), an unbalanced
//     brace — none of them is in any capture. ⛔ `percent` too, until Q-W3-3 matches
//     (`PERCENT_CAPTURED`, W3-S1 r3): the published rule does not settle a negative's sign.
// The captures that would settle each are named in docs/pine/vendor-harness/
// objects-triage-2026-09-28.md, step 13.

/** The number patterns a `{N,number,P}` element may carry, each with the
 *  capture that pins it. ⛔ A PATTERN NOT IN THIS TABLE IS REFUSED BY NAME —
 *  "it is the same grammar as `str.tostring`" is an inference, and F12 pins the
 *  equivalence for `#.##` alone. */
export const MESSAGE_NUMBER_PATTERNS = Object.freeze({
  '#.##': 'w3-format-spy-1d-2026-09-22.json F12 == F03 on 300 bars',
})

/** ⭐⭐ W3-S1 (2026-11-02) — THE KEYWORD PRESETS A `{N,number,KEYWORD}` ELEMENT MAY NAME,
 *  each with the PUBLISHED RULE that pins it. TradingView's Pine docs, "Formatting strings"
 *  (https://www.tradingview.com/pine-script-docs/concepts/strings/#formatting-strings):
 *  "a placeholder can use one of the following keywords that specify predefined formatting
 *  patterns: integer, currency, or percent" — and `percent` is the pattern `#,###%`: "This
 *  format multiplies the value by 100, rounds the result to the nearest whole number, adds
 *  comma separation for three-digit sets, and includes the % symbol at the end." The
 *  `str.format` reference entry draws it: `str.format("{0,number,percent}", 0.5)` returns
 *  "50%", and `"Expected return is {0, number, percent} - {1, number, percent}"` over 0.1
 *  and 0.2 returns "Expected return is 10% - 20%" (`percentMessageNumber`).
 *  ⛔ `integer` (`#,###`) and `currency` (`'$'#,###.00`) stay refused BY NAME: the reference
 *  draws them (1.34 → "1", 1.52 → "2", 1.34 → "$1.34", 1340000 → "$1,340,000.00") but no
 *  capture pins a tie, a negative, or the grouping this module withholds everywhere else
 *  — queued in `docs/pine/capture-queue-2026-11-02-w3.md`. */
export const MESSAGE_NUMBER_PRESETS = Object.freeze({
  percent: 'Pine reference, str.format: 0.5 → "50%", 0.1 → "10%", 0.2 → "20%"; docs "Formatting strings": `#,###%`',
})

/** ⭐ W3-S1 — is `fmt` a `{N,number,…}` format this module renders? The ONE answer
 *  `compileMessagePattern` hands out and `objectProgram.js::assertTextNode` checks a
 *  document's `{t:'num', form:'message'}` node against, so the two cannot drift. */
export function isMessageNumberFormat(fmt) {
  return typeof fmt === 'string'
    && (Object.hasOwn(MESSAGE_NUMBER_PATTERNS, fmt) || servedPreset(fmt))
}

/** ⛔⛔ W3-S1 r3 (2026-11-04) — THE Q-W3-3 GATE. `false` until the capture row Q-W3-3
 *  (`docs/pine/capture-queue-2026-11-02-w3.md`: -0.126, -0.004, -0.575 and the positives)
 *  MATCHES. While `false`, `percent` is NOT an accepted keyword (`servedPreset`;
 *  `compileMessagePattern` refuses it BY NAME, `format:number-pattern:percent`, as master
 *  does) and `percentMessageNumber` returns `null` / `percentWithheldWhy` says
 *  `percent:uncaptured`: the formatting code below is KEPT, behind this one switch, because
 *  the published rule names neither the sign nor its placement, and the house rule is to
 *  refuse by name anything not proven exact against TradingView. */
export const PERCENT_CAPTURED = false

/** ONE answer to "may a `{N,number,KEYWORD}` keyword be drawn?" — a preset with a published
 *  rule AND (for `percent`) the Q-W3-3 capture. */
export function servedPreset(keyword) {
  return Object.hasOwn(MESSAGE_NUMBER_PRESETS, keyword) && (keyword !== 'percent' || PERCENT_CAPTURED)
}

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
      // ⛔ W3-S1 r2 — Java's MessageFormat trims a type / style keyword with String.trim,
      // which strips only U+0000..U+0020; JS `\s` and `trim()` also strip NBSP and the other
      // Unicode spaces, and would read a " number" / " percent" that Java does not.
      const spec = /^[\x00-\x20]*number[\x00-\x20]*,(.*)$/.exec(m[2])
      if (!spec) return { ok: false, why: `format:element:${javaTrim(m[2].split(',')[0]) || 'empty'}` }
      const p = spec[1]
      // ⭐ W3-S1 — a keyword preset is read by the published rule; the reference spells
      // the element with optional spaces (`{0, number, percent}` → "10%"), so the keyword
      // is trimmed. A `#`/`0` pattern is still matched exactly as a capture spelled it.
      const keyword = javaTrim(p)
      if (servedPreset(keyword)) fmt = keyword
      else if (Object.hasOwn(MESSAGE_NUMBER_PATTERNS, p)) fmt = p
      else return { ok: false, why: `format:number-pattern:${p}` }
    }
    if (lit) { parts.push({ lit }); lit = '' }
    parts.push(fmt === undefined ? { arg: index } : { arg: index, fmt })
    i = close + 1
  }
  if (lit) parts.push({ lit })
  return { ok: true, parts }
}

/** Java's `String.trim`: strips U+0000..U+0020 from both ends, and nothing else. */
function javaTrim(s) {
  return s.replace(/^[\x00-\x20]+|[\x00-\x20]+$/g, '')
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

/** ⛔⛔ N01 (2026-11-19) — Is `n` a DECIMAL tie at `d` decimals: does its SHORTEST
 *  round-trip decimal (the text JavaScript prints for the double, the reading
 *  `str.tostring` rounds, F6) carry exactly `d + 1` decimals, the last a 5?
 *
 *  1.005 at 2 (the double is 1.00499999999999989…): its binary reading rounds DOWN
 *  ("1") and its decimal reading rounds UP ("1.01"). 0.025 at 2 (the double is
 *  0.02500000000000000138…): both round up ("0.03"), but a decimal HALF_EVEN would
 *  print "0.02". So every decimal tie is a value where some reading TradingView may
 *  use parts from the one printed here, and nothing else is: 1.0051 and 1.004 round
 *  the same way under all of them. An exact binary tie (0.125 at 2) is one too
 *  (`exactTieAt` names it first). */
export function decimalTieAt(n, d) {
  if (!Number.isFinite(n) || !Number.isInteger(d) || d < 0) return false
  const { frac } = plainDigits(Math.abs(n))
  return frac.length === d + 1 && frac[d] === '5'
}

/** `{N,number,#.##}` keeps at most two decimals (F12: its length is
 *  `str.tostring(x, "#.##")`'s on 300 SPY closes). */
const HASH_PATTERN_DECIMALS = 2

/** ⛔ N01 — the name a `{N,number,P}` decimal tie is withheld under. */
export const MESSAGE_DECIMAL_TIE = 'format:message-decimal-tie'

/** Up to `max` decimals, trailing zeros and a bare point trimmed. `null` for a
 *  rendering no capture pins (see the header). */
function trimmedFixed(n, max) {
  if (exactTieAt(n, max)) return null
  const out = n.toFixed(max).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
  return out === '-0' ? null : out
}

/**
 * ⭐⭐ W3-S1 — `{N,number,percent}`: the value × 100, rounded to a whole number, a `%`
 * after it — the published `#,###%` (`MESSAGE_NUMBER_PRESETS`). `null` (WITHHELD) where
 * the rule's words do not settle the characters:
 *   * a ROUNDED percentage of 1000 or more (`percent:grouping`) — the comma grouping the
 *     rule names is unmeasured here, exactly as it is for `{N}` (`MESSAGE_NUMBER_LIMIT`, the
 *     same bound).
 *     ⛔ Asked of the ROUNDED whole, not the product: 9.996 is 999.6 %, which rounds to
 *     1000 and would print "1,000%" under `#,###%` — a bound on the product drew "1000%";
 *   * a tie at the whole percent, in EITHER reading — "rounds to the nearest whole" does
 *     not say which way a tie goes, and HALF_EVEN and HALF_UP part there:
 *       - `percent:tie` — the double's own product is exactly x.5 (0.125 → 12.5);
 *       - `percent:decimal-tie` — the product is not x.5 in binary but its DECIMAL reading
 *         is: 0.575 (23/40, a common win rate) multiplies to 57.49999999999999, so a binary
 *         product rounds it to "57%" while an implementation that rounds the decimal value
 *         prints "58%" (HALF_UP and HALF_EVEN alike). No published source says which
 *         reading TradingView uses, so neither is drawn. The decimal reading is the product
 *         at 15 significant digits: every value whose shortest decimal is x.5 / 100 lands
 *         on x.5 there (a whole-percent tie below 1000 % has at most 6 significant digits);
 *   * a value that rounds to a negative zero, `-0` itself included (`percent:negative-zero`;
 *     Java's DecimalFormat prints "-0%", the docs do not say);
 *   * `na` (`percent:na`) — no capture formats one through `str.format`.
 * Off both ties every rounding mode and both readings agree, and only that is drawn.
 * `percentWithheldWhy` is the ONE authority; this function asks it.
 *
 * @param {number} n
 * @returns {string|null}
 */
export function percentMessageNumber(n) {
  if (!PERCENT_CAPTURED) return null // ⛔ r3 — percent:uncaptured, every value, either sign
  return percentFormatUncaptured(n)
}

/** ⛔ W3-S1 r3 — the formatting rule itself, UNGATED and NOT SERVED: nothing in the engine
 *  calls it; it is kept (and unit-railed) so the Q-W3-3 switch is `PERCENT_CAPTURED = true`
 *  plus whatever the capture says of the sign. */
export function percentFormatUncaptured(n) {
  if (percentCornerWhy(n) !== null) return null
  return `${Math.round(n * 100)}%`
}

/**
 * ⭐ W3-S1 r2 — WHY `percentMessageNumber` withholds `n`, BY NAME (`percent:*`), or `null`
 * when the published rule settles every character (the cases are listed there).
 *
 * @param {number} n
 * @returns {'percent:uncaptured'|'percent:na'|'percent:tie'|'percent:decimal-tie'|'percent:grouping'|'percent:negative-zero'|null}
 */
export function percentWithheldWhy(n) {
  return PERCENT_CAPTURED ? percentCornerWhy(n) : 'percent:uncaptured'
}

/** The corners of the (unserved) rule, by name; see `percentFormatUncaptured`. */
export function percentCornerWhy(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 'percent:na'
  const p = n * 100
  if (exactTieAt(p, 0)) return 'percent:tie'
  if (Math.abs(Number(p.toPrecision(15)) % 1) === 0.5) return 'percent:decimal-tie'
  const k = Math.round(p)
  if (Math.abs(k) >= MESSAGE_NUMBER_LIMIT) return 'percent:grouping'
  if (k === 0 && (p < 0 || Object.is(p, -0))) return 'percent:negative-zero'
  return null
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
  // ⛔ W3-S1 — the bound is asked of the ROUNDED text too: 999.9996 rounds to "1000" at
  // three decimals, and Java's default `#,##0.###` prints that "1,000" — the grouping no
  // capture pins. (`#.##` has no grouping in either reading, so it keeps its own answer.)
  if (fmt === undefined) {
    const s = trimmedFixed(n, MESSAGE_DEFAULT_DECIMALS)
    return s !== null && Math.abs(Number(s)) >= MESSAGE_NUMBER_LIMIT ? null : s
  }
  // ⛔⛔ N01 — a DECIMAL tie is withheld under a pattern (header; `decimalTieAt`): the binary
  // reading below prints 1.005 as "1" where `str.tostring` is witnessed printing "1.01".
  if (fmt === '#.##') {
    return decimalTieAt(n, HASH_PATTERN_DECIMALS) ? null : trimmedFixed(n, HASH_PATTERN_DECIMALS)
  }
  // ⭐ W3-S1 — the one keyword preset the published rule pins.
  if (fmt === 'percent') return percentMessageNumber(n)
  return null
}

/**
 * ⭐ N01 — WHY `formatMessageNumber(n, fmt)` withholds `n`, BY NAME, or `null` when it prints.
 * It NAMES, it never decides: it asks the formatter first (as `tickNumberWhy` does), so the
 * formatter stays the one authority on WHETHER a text is drawn. The object runtime records the
 * name in its `textsWithheldWhy` diagnostics.
 *
 * @returns {null|'format:message-na'|'format:message-grouping'|'format:message-exact-tie'
 *   |'format:message-decimal-tie'|'format:message-negative-zero'|'format:message-pattern-unread'
 *   |'percent:uncaptured'|'percent:na'|'percent:tie'|'percent:decimal-tie'|'percent:grouping'
 *   |'percent:negative-zero'}
 */
export function messageNumberWhy(n, fmt) {
  if (formatMessageNumber(n, fmt) !== null) return null
  if (typeof n !== 'number' || !Number.isFinite(n)) return 'format:message-na'
  if (Math.abs(n) >= MESSAGE_NUMBER_LIMIT) return 'format:message-grouping'
  if (fmt === 'percent') return percentWithheldWhy(n)
  if (fmt !== undefined && fmt !== '#.##') return 'format:message-pattern-unread'
  const d = fmt === undefined ? MESSAGE_DEFAULT_DECIMALS : HASH_PATTERN_DECIMALS
  if (exactTieAt(n, d)) return 'format:message-exact-tie'
  if (fmt !== undefined && decimalTieAt(n, d)) return MESSAGE_DECIMAL_TIE
  // what remains: a negative that rounds to "-0" (-0.0001), or `{N}` rounding UP to 1000 (999.9996)
  return Number(n.toFixed(d)) === 0 ? 'format:message-negative-zero' : 'format:message-grouping'
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
//                      `objectRuntime.js::defaultNumberText`), through the one core
//                      (`tostringNumberText`, CBC-FMT, below)
//   `#`/`0` pattern    `formatPlainNumber` — the C13 integer padding over the one core
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
//   * a grouping separator of any size but three that would APPEAR (CBC-FMT: three is
//     witnessed, S10 T20 1234.5 through "#,###.##" -> "1,234.5");
//   * a negative value under a literal prefix (Java puts the minus BEFORE the
//     prefix; no capture shows TradingView doing so);
//   * a `format.mintick` NEGATIVE exact tie, and a tie at a tick that is not a power of ten
//     (`0.25`); `format.mintick` itself rounds `n / tick` in binary (CBC-FMT, S10 T08-T12);
//   * every withhold of the one core (`tostringNumberWhy`, CBC-FMT);
//   * `%`, `‰`, `¤`, a quote or `;` anywhere — each changes what the number is.

/** Characters Java's DecimalFormat gives a meaning in a prefix or suffix; a
 *  pattern carrying one is refused rather than read as literal text. */
const FORMAT_SPECIAL_AFFIX = /[%‰¤';#0-9.,]/

/** `#`/`0` digits, optional grouping commas, optional `.` and fraction. */
const FORMAT_CORE = /^([#0,]*)(?:\.([#0]*))?$/

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

// ─── ⭐⭐ CBC-FMT — THE ONE `str.tostring` NUMBER CORE ─────────────────────────────
//
// `tostringNumberText(n, {min, max})`: `n` with at most `max` and at least `min` decimals,
// the way TradingView prints it, or `null` (WITHHELD, by the name `tostringNumberWhy`
// gives) where no capture settles the characters. Every `str.tostring` number written with
// no format (`defaultNumberText`, {0, 10}), a `#`/`0` pattern (`formatPlainNumber`) or a
// pattern with words around it (`formatPatternedNumber`) goes through it. ⛔ Two other
// formatters are NOT this one, each by its own capture: `format.mintick` rounds `n / tick` in
// BINARY (`tickNumberText`, below), and `str.format`'s `{N}` is Java's `#,##0.###` on the
// exact binary value (952.4295 prints "952.429" there and "952.43" through `#.###` here) and
// keeps its own (`formatMessageNumber`, F7). ⛔ `{N,number,#.##}` is not proven to be either:
// where this core's decimal reading and the binary one part (a decimal tie) it is WITHHELD
// (`decimalTieAt`, N01), never printed through this core on the strength of the shared pattern.
//
// THE RULES, each read off a capture (W = witnessed; inv-fmt-1115 and capture session S10's
// `vw-fmt-tie-readings-rddt-1d-2026-11-15`, rows T01-T30):
//   F1 no format: up to 10 decimals, trailing zeros trimmed, no grouping, not the symbol's
//      precision (W: w3-format, 300 rows; 88 graded tokens; S10 `vw-cs2-label-number-format`
//      "32.8166666667", "0.8175176096", "1").
//   F2 `na` prints "NaN" under any format (W).
//   F3 an int prints its digits; an integral float prints "2", not "2.0" (W; T28 "5/5").
//   F4 a `#`/`0` pattern keeps as many decimals as it has digits after the point, with NO
//      ten-decimal cap (W at 16: the LRC builtin's `str.tostring(pearsonR,
//      "#.################")` prints 0.8175176096085278; T16, T17; and at 20, T15 0.1 -> "0.1");
//      `#` is optional, `0` required. ⚰️ `formatPlainNumber` capped at 10.
//   F5 an EXACT binary tie rounds half AWAY from zero: 1.5 -> 2, 2.5 -> 3, -1.5 -> -2,
//      -0.5 -> -1 (W: vw-int-array-avg R06/R09/R10/R14/R17/R19, -neg A11-A13).
//   F6 a DECIMAL tie rounds UP, read on the SHORTEST decimal of the double ("decup"): 1.005 ->
//      "1.01", 163.265 -> "163.27", 145.795 -> "145.8", 1.255 -> "1.26", -1.005 -> "-1.01"
//      (W: T01-T04, T07, where rounding |x| · 10^k in binary would print 1, 163.26, 145.79,
//      1.25, -1), 127.705 -> "127.71", 2.675 -> "2.68" (T05, T06), at the tenth decimal with no
//      format (T19 1.00000000005 -> "1.0000000001"), and through a carry (T30 99999.995 ->
//      "100000"). ⚰️ `n.toFixed(k)` rounds the double 127.70499999… DOWN (127.7).
//   F7 a value that rounds to zero prints WITHOUT a sign: -0.004 "#.##" -> "0" (T13),
//      -1e-12 -> "0" (T14), -0.4 "#" -> "0" (T26), 1e-11 -> "0" (T29).
//   F8 no format at 1e21 or more prints JavaScript's exponent form: 1e21 -> "1e+21" (T18).
//   F9 "," groups the integer part by three: 1234.5 through "#,###.##" -> "1,234.5" (T20).
// ⛔ STILL WITHHELD BY NAME: a PATTERN at 1e21 or more (`format:magnitude-uncaptured`: only the
//   default's exponent is witnessed), a grouping of any size but three
//   (`format:grouping-uncaptured`), a negative value under a literal prefix
//   (`format:negative-under-prefix`).

/** From here JavaScript prints an exponent (F8: witnessed for the default only). */
export const TOSTRING_MAGNITUDE_LIMIT = 1e21
/** `str.tostring(n)` with no format: up to ten decimals (F1), the exponent form from 1e21 (F8). */
export const TOSTRING_DEFAULT_BOUNDS = Object.freeze({ min: 0, max: 10, exponent: true })
/** The one grouping size a capture shows (F9). */
export const TOSTRING_GROUP_SIZE = 3

/** The shortest round-trip decimal of `a >= 0` as `{int, frac}` digit strings, never in
 *  exponent form (`a` below `TOSTRING_MAGNITUDE_LIMIT`). */
function plainDigits(a) {
  let s = String(a)
  const m = /^(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(s)
  if (m) {
    const digits = m[1] + (m[2] || '')
    const e = Number(m[3])
    if (e < 0) s = `0.${'0'.repeat(-e - 1)}${digits}`
    else s = digits.length > e + 1 ? `${digits.slice(0, e + 1)}.${digits.slice(e + 1)}` : digits + '0'.repeat(e + 1 - digits.length)
  }
  const [int, frac = ''] = s.split('.')
  return { int, frac }
}

/** `{int, frac}` plus one unit in the last place of `frac`, in decimal. */
function plusOneUlp(int, frac) {
  const all = (int + frac).split('').map(Number)
  let i = all.length - 1
  while (i >= 0) {
    if (all[i] === 9) { all[i] = 0; i -= 1 } else { all[i] += 1; break }
  }
  let s = all.join('')
  if (i < 0) s = `1${s}`
  const cut = s.length - frac.length
  return { int: s.slice(0, cut), frac: s.slice(cut) }
}

/** F5 / F6 ("decup"): the shortest decimal of `a`, rounded half-up at `k` decimals. */
function decupDigits(a, k) {
  const { int, frac } = plainDigits(a)
  if (frac.length <= k) return { int, frac }
  const keep = frac.slice(0, k)
  return Number(frac[k]) >= 5 ? plusOneUlp(int, keep) : { int, frac: keep }
}

/** The body text of `{int, frac}` under `min`/`max` decimals: padded with required zeros,
 *  optional trailing zeros trimmed, a bare point dropped. */
function renderDigits(d, min, max) {
  let f = d.frac.padEnd(min, '0')
  if (f.length > max) f = f.slice(0, max)
  while (f.length > min && f.endsWith('0')) f = f.slice(0, -1)
  return f ? `${d.int}.${f}` : d.int
}

const boundsOf = (b) => {
  const max = b && Number.isInteger(b.max) && b.max >= 0 ? b.max : TOSTRING_DEFAULT_BOUNDS.max
  const min = b && Number.isInteger(b.min) && b.min >= 0 ? Math.min(b.min, max) : 0
  return { min, max, exponent: !!(b && b.exponent === true) }
}

/**
 * ⭐⭐ CBC-FMT — WHY `tostringNumberText(n, bounds)` withholds `n`, BY NAME, or `null` when
 * every rule above settles the characters (`na` included: it prints "NaN"). The ONE
 * authority: `tostringNumberText` asks it.
 * @returns {null|'format:not-a-number'|'format:magnitude-uncaptured'}
 */
export function tostringNumberWhy(n, bounds) {
  if (typeof n !== 'number') return 'format:not-a-number'
  if (!Number.isFinite(n)) return null
  if (Math.abs(n) >= TOSTRING_MAGNITUDE_LIMIT && !boundsOf(bounds).exponent) return 'format:magnitude-uncaptured'
  return null
}

/**
 * ⭐⭐ CBC-FMT — ONE `str.tostring` NUMBER, as TradingView prints it with `min`..`max`
 * decimals, or `null` (WITHHELD: `tostringNumberWhy` names why). `na` prints "NaN".
 * @param {number} n
 * @param {{min?: number, max?: number, exponent?: boolean}} [bounds]  default: no format
 * @returns {string|null}
 */
export function tostringNumberText(n, bounds = TOSTRING_DEFAULT_BOUNDS) {
  if (typeof n !== 'number') return null
  if (!Number.isFinite(n)) return 'NaN'
  if (tostringNumberWhy(n, bounds) !== null) return null
  if (Math.abs(n) >= TOSTRING_MAGNITUDE_LIMIT) return String(n) // F8
  const { min, max } = boundsOf(bounds)
  const body = renderDigits(decupDigits(Math.abs(n), max), min, max)
  // F7: a value that rounds to zero carries no sign
  return n < 0 && !/^0+(\.0*)?$/.test(body) ? `-${body}` : body
}

/** A plain `#`/`0` pattern's decimals: `max` = the digits after the point, `min` = its `0`s
 *  (F4: no ten-decimal cap), and how many integer digits its `0`s require. */
export function plainPatternBounds(fmt) {
  const dot = fmt.indexOf('.')
  const frac = dot < 0 ? '' : fmt.slice(dot + 1)
  const intPart = dot < 0 ? fmt : fmt.slice(0, dot)
  const max = frac.length
  return { min: Math.min(max, (frac.match(/0/g) || []).length), max, intDigits: (intPart.match(/0/g) || []).length }
}

/** Why `formatPlainNumber(n, fmt)` withholds `n` (a name), or `null`. */
export function plainNumberWhy(n, fmt) {
  if (!isPlainNumberPattern(fmt)) return 'format:pattern-unread'
  return tostringNumberWhy(n, plainPatternBounds(fmt))
}

/** `#`/`0` patterns: required decimals are the `0`s, optional the `#`s (F4, no cap); a
 *  leading `00` pads the integer part (C13). The number itself is the one core's
 *  (`tostringNumberText`). `null` for a pattern it does not read whole, or for a value the
 *  core withholds (`plainNumberWhy` names it). */
export function formatPlainNumber(n, fmt) {
  if (!isPlainNumberPattern(fmt)) return null
  const b = plainPatternBounds(fmt)
  let out = tostringNumberText(n, b)
  if (out === null || out === 'NaN') return out
  if (b.intDigits > 1) {
    const neg = out.startsWith('-')
    const body = neg ? out.slice(1) : out
    const head = body.split('.')[0]
    if (head.length < b.intDigits) out = (neg ? '-' : '') + '0'.repeat(b.intDigits - head.length) + body
  }
  return out
}

/** Why `formatPatternedNumber(n, fmt)` withholds `n` (a name), or `null`. The ONE answer
 *  `formatPatternedNumber` asks. */
export function patternedNumberWhy(n, fmt) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 'format:not-a-number'
  const p = tostringPatternOf(fmt)
  if (!p) return 'format:pattern-unread'
  const why = plainNumberWhy(n, p.core)
  if (why !== null) return why
  const body = formatPlainNumber(n, p.core)
  if (body.startsWith('-') && p.prefix) return 'format:negative-under-prefix'
  if (p.grouping > 0 && p.grouping !== TOSTRING_GROUP_SIZE
    && body.replace(/^-/, '').split('.')[0].length > p.grouping) return 'format:grouping-uncaptured'
  return null
}

/** F9: the integer part grouped by three with ",". */
function grouped(body) {
  const neg = body.startsWith('-')
  const [int, frac] = (neg ? body.slice(1) : body).split('.')
  const g = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${neg ? '-' : ''}${g}${frac !== undefined ? `.${frac}` : ''}`
}

/**
 * ⭐⭐ `str.tostring(n, fmt)` for a pattern with literal text around it and/or
 * grouping commas — or `null` (WITHHELD) where no capture pins the rendering.
 * A plain pattern is `formatPlainNumber`'s; this is the rest of the grammar.
 */
export function formatPatternedNumber(n, fmt) {
  if (patternedNumberWhy(n, fmt) !== null) return null
  const p = tostringPatternOf(fmt)
  const body = formatPlainNumber(n, p.core)
  return `${p.prefix}${p.grouping === TOSTRING_GROUP_SIZE ? grouped(body) : body}${p.suffix}`
}

/**
 * ⭐⭐ `str.tostring(n, format.mintick)` given the symbol's tick as its decimal
 * text (`"0.01"`, `"0.25"`) — rounded to a multiple of the tick and printed with
 * the tick's decimals, trailing zeros kept. `null` (WITHHELD) with no settled tick.
 * `na` prints `NaN`, as every other `str.tostring` does.
 * ⭐⭐ CBC-FMT (S10, `vw-fmt-tie-readings` T08-T12) — THE TICK IS ROUNDED IN BINARY, `n / tick`,
 * NOT the pattern's decimal reading: 1.005 -> "1.00" and 163.265 -> "163.26" (T08, T09:
 * 1.005 / 0.01 = 100.49999…, where "#.##" prints 1.01), an exact tie rounds up (T10 0.125 ->
 * "0.13"), a value that rounds to zero prints unsigned (T11 -0.004 -> "0.00"), and no
 * grouping at 1000 or more (T12 1234.5 -> "1234.50"). 127.705 / 0.01 is 12770.5 exactly:
 * "127.71" (support-resistance-mtf-flux RDDT). ⛔ Still withheld: a NEGATIVE exact tie (which
 * way it goes is not captured) and any tie at a tick that is not a power of ten (`0.25`).
 */
export function tickNumberText(n, tickText) {
  if (typeof tickText !== 'string' || !/^\d+(\.\d+)?$/.test(tickText)) return null
  const tick = Number(tickText)
  if (!(tick > 0)) return null
  if (typeof n !== 'number') return null
  if (!Number.isFinite(n)) return 'NaN'
  const dot = tickText.indexOf('.')
  const decimals = dot < 0 ? 0 : tickText.length - dot - 1
  const q = n / tick
  const powerOfTen = /^(1|0\.0*1)$/.test(tickText)
  if (powerOfTen) {
    if (q - Math.floor(q) === 0.5 && q < 0) return null
  } else if (Math.abs(Math.abs(q - Math.trunc(q)) - 0.5) < 1e-9) {
    return null
  }
  // (a value that rounds to zero: `Math.round` answers -0, and `(-0).toFixed` prints "0.00",
  // the unsigned zero T11 shows — no guard is needed for it)
  const k = Math.round(q)
  return (k * tick).toFixed(Math.min(decimals, 20))
}

/** ⭐ TC — WHY `tickNumberText` withheld (`null` when it prints): no tick this binding settles
 *  (`format:tick-unsettled`: the symbol's exchange has no witnessed tick), or a tie no capture
 *  shows (`format:tick-tie-uncaptured`: a NEGATIVE exact tie, any tie at a tick that is not a
 *  power of ten). Read by the runtime lane, which stops a run BY THIS NAME rather than print. */
export function tickNumberWhy(n, tickText) {
  if (tickNumberText(n, tickText) !== null) return null
  if (typeof tickText !== 'string' || !/^\d+(\.\d+)?$/.test(tickText) || !(Number(tickText) > 0)) return 'format:tick-unsettled'
  if (typeof n !== 'number') return 'format:not-a-number'
  return 'format:tick-tie-uncaptured'
}

/**
 * ⭐⭐ H5 (step 84) — `str.tostring(n, format.volume)`, ONLY where captures pin it,
 * else `null` (WITHHELD). `na` prints `NaN`, as every other `str.tostring` does.
 *
 * WITNESSED (multicator-table, 2026-10-02, each against OUR computation of the same
 * value on the capture's own bars): RDDT volume 3,125,951 → `"3.126M"`, SPY volume
 * 46,335,295 → `"46.335M"`, RDDT OBV from the listing −29,983,517 → `"-29.984M"`;
 * and SPY's OBV `"10.801B"` (its value is not reproducible off the listing, so it
 * pins only the `B` suffix and the three decimals). So: a magnitude in millions or
 * billions, divided by 10^6 / 10^9, rounded to three decimals, a minus sign before
 * it, the suffix after.
 * ⛔ WITHHELD, each because no capture shows it: below one million (`K`, or no
 * suffix?); a third decimal that rounds to 0 (are trailing zeros kept, `3.100M`, or
 * trimmed, `3.1M`?); an exact tie at the third decimal; 1,000 billion or more; a
 * value that rounds up to the next unit (`999.9996M`).
 */
export const VOLUME_UNITS = Object.freeze([[1e9, 'B'], [1e6, 'M']])
export function volumeNumberText(n) {
  if (typeof n !== 'number') return null
  if (!Number.isFinite(n)) return 'NaN'
  const a = Math.abs(n)
  const unit = VOLUME_UNITS.find(([u]) => a >= u)
  if (!unit || a >= 1e12) return null
  const q = (a / unit[0]) * 1000
  if (Math.abs(q - Math.floor(q) - 0.5) < 1e-9) return null
  const k = Math.round(q)
  if (k % 10 === 0 || k >= 1e6) return null
  return `${n < 0 ? '-' : ''}${(k / 1000).toFixed(3)}${unit[1]}`
}

/**
 * ⭐⭐ CBC-FMT (S17 follow-up) — `str.tostring(<a numeric constant>)` with NO format. `null` when this
 * function has nothing to say (the argument is not a constant, or both readings print the same
 * characters): the caller prints the one core's ten-decimal text (`tostringNumberText`, {0, 10}).
 * Otherwise `{ text }` (print exactly this) or `{ why }` (withhold by that name).
 *
 * The two readings: FULL, the literal's shortest decimal (its source text), and TEN, the ten-decimal
 * default every computed value takes (`close / 3` -> "32.8166666667"). ⭐ THE VERSION DECIDES — all four
 * cells of {v5, v6} x {the call directly a label's text, the call through a concatenating helper} are
 * witnessed (NYSE:RDDT 1D):
 *   - //@version=5: a numeric LITERAL prints IN FULL, direct (S17 `vw-cs2-label-format`:
 *     "0.8175176096085278", "0.000012345678901234") or through a helper (s21
 *     `vw-cs2-label-format-v5-helper`);
 *   - //@version=6: every number prints at ten decimals, direct (s21 `vw-cs2-label-format-v6-direct`) or
 *     through a helper (S10 `vw-cs2-label-number-format` F03 "0.8175176096"; `vw-fmt-tie-readings` T14 a
 *     negated literal, T19 / T29; F05 `1.0 / 3.0`).
 * Computed values print at ten decimals in both. WITHHELD by name where the readings part
 * (`format:literal-uncaptured`): v4 and earlier (and no pragma); at v5 a negated literal or a constant
 * expression (neither is captured there), a literal whose source text is not its shortest decimal
 * (`1.50`, `.5`), and a full text in exponent form.
 * @param {object} node  the parsed argument (`{type: 'number', value, tok}`, `{type: 'unary', op: '-'}`, …)
 * @param {{version: number|null}} at
 * @returns {null|{text: string}|{why: string}}
 */
export const LITERAL_TOSTRING_UNCAPTURED = 'format:literal-uncaptured'
const CONST_BINARY = new Set(['+', '-', '*', '/'])
function constNumberOf(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 16) return null
  if (node.type === 'number') {
    if (node.tok && node.tok.kind === 'ident') return null // `true` / `false` parse to a number node
    const v = Number(node.value)
    return Number.isFinite(v) ? { v, kind: 'literal' } : null
  }
  if (node.type === 'unary' && node.op === '-') {
    const a = constNumberOf(node.arg, depth + 1)
    return a ? { v: -a.v, kind: a.kind === 'literal' ? 'negated' : 'expr' } : null
  }
  if (node.type === 'binary' && CONST_BINARY.has(node.op)) {
    const a = constNumberOf(node.left, depth + 1)
    const b = constNumberOf(node.right, depth + 1)
    if (!a || !b) return null
    const v = node.op === '+' ? a.v + b.v : node.op === '-' ? a.v - b.v : node.op === '*' ? a.v * b.v : a.v / b.v
    return Number.isFinite(v) ? { v, kind: 'expr' } : null
  }
  return null
}
export function literalTostringText(node, at) {
  const c = constNumberOf(node)
  if (!c) return null
  const ten = tostringNumberText(c.v, TOSTRING_DEFAULT_BOUNDS)
  if (ten === null) return null // the one core withholds it already, by its own name
  const full = String(c.v)
  if (full === ten) return null
  const version = at && Number.isFinite(at.version) ? at.version : null
  if (version !== null && version >= 6) return null // TEN, witnessed (S10, s21)
  // the literal's SOURCE text (`tok.raw`) must be the shortest decimal too: `1.50`, `.5`, `5e-1` are not witnessed
  const raw = node.tok && node.tok.raw !== undefined ? String(node.tok.raw) : String(node.value)
  if (version === 5 && c.kind === 'literal' && raw === full && !/e/i.test(full)) {
    return { text: full } // FULL, witnessed (S17, s21)
  }
  return { why: LITERAL_TOSTRING_UNCAPTURED }
}
export const LITERAL_TOSTRING_SENTENCE = '`str.tostring` of a numeric constant with no format: TradingView prints a '
  + 'numeric literal IN FULL at //@version=5 and every number to TEN decimals at //@version=6 (captures '
  + '`vw-cs2-label-format`, `vw-cs2-label-number-format` and their s21 re-takes), and no capture shows what this '
  + 'script\'s version (or this constant\'s spelling) prints, so the text is withheld rather than printed one way '
  + 'when TradingView may print the other'

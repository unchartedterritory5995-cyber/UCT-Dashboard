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

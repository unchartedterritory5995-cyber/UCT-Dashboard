// app/src/components/chart/engine/runtime/text.js
//
// ─── THE `str.*` TABLE THE RUNTIME EXECUTES ─────────────────────────────────
//
// ⛔⛔ WHY THIS IS NOT IN `interpret.js` WITH THE POINTWISE TABLE. `OP.POINTWISE`
// deliberately borrows the columnar lane's own scalar implementations, so a
// builtin over runtime state and the same builtin over a pure series are the
// same arithmetic BY CONSTRUCTION. That argument does not reach here, because
// the columnar lane has no text implementations to borrow and must not grow
// any: `pine.js::PINE_TEXT_PREDICATE` admits exactly four `str.*` names on the
// stated ground that each CONSUMES text and answers with a NUMBER, so nothing
// textual survives the fold — and says in the same breath that a text PRODUCER
// "is the step that would make text a value". These are producers. They belong
// where a slot can hold a value, which is here.
//
// ⭐ THE FOUR CONSUMERS APPEAR IN BOTH LANES, AND THAT IS INTENTIONAL, NOT A
// SECOND AUTHORITY. The columnar lane folds `str.contains(syminfo.ticker, "/")`
// at BIND time, when both operands are fixed for the binding; this lane answers
// the same question about a value that changes bar to bar, which that fold
// cannot see. Different inputs, same answer — and `strBuiltins.test.js` pins
// the agreement on the shapes both can reach.
//
// ⛔ EVERY ENTRY DECLARES ITS OPERAND KINDS, and the VM checks them from THAT
// declaration rather than each function checking its own. One check site cannot
// drift; seven hand-written checks can, and the one that drifts is the one
// nobody reads again.

import { formatNumber } from '../objectRuntime.js'
import { timestampMs, instantField, INSTANT_FIELDS } from './clockFns.js'
// ⭐ ONE AUTHORITY for "a Pine runtime error, the script stops here": `collections.js`'s
// `PineRuntimeError` (name 'runtime.error', guard 'runtime:runtime.error'). The pane
// pipeline (`runtimeColumns.js`) tells a reached runtime error from an engine failure by
// exactly that name; a second class here would be retried WITHOUT drawings and draw the
// plots where TradingView stops the script.
import { PineRuntimeError } from './collections.js'

// ⭐⭐ W4-T11 INDEX RULES, ONE PLACE. Pine's `str.substring` is 0-BASED with an
// EXCLUSIVE end (`begin_pos` is the first character kept, `end_pos - 1` the last).
// ⛔ A position outside `0 <= begin <= end <= length`, or one that is not a whole
// number, is a Pine RUNTIME ERROR rather than a silent clamp: clamping would draw
// a value where TradingView stops the script. ⚠️ NEEDS CAPTURE (queue row W4-T11-a):
// whether the error is raised or `na` returned for each bad position.
function substringOf(s, begin, end) {
  if (!Number.isInteger(begin) || !Number.isInteger(end)) {
    throw new PineRuntimeError(`\`str.substring\` takes whole-number positions, got ${begin} and ${end}`)
  }
  if (begin < 0 || end < begin || end > s.length) {
    throw new PineRuntimeError(
      `\`str.substring\` positions ${begin}..${end} are outside a text of length ${s.length}; Pine stops the script here`)
  }
  return s.slice(begin, end)
}

// ⭐ `str.replace` replaces the Nth occurrence (0-BASED, left to right) of a
// LITERAL target, occurrences NON-OVERLAPPING; a missing Nth occurrence leaves the
// source unchanged. ⛔ An empty target has no defined occurrence: refused at run
// time by name rather than answered with JavaScript's insert-at-0.
function replaceNth(s, target, replacement, n) {
  if (!Number.isInteger(n) || n < 0) {
    throw new PineRuntimeError(`\`str.replace\` takes a whole-number occurrence from 0, got ${n}`)
  }
  if (target === '') throw new PineRuntimeError('`str.replace` cannot find an empty target')
  let at = -1
  let from = 0
  for (let k = 0; k <= n; k += 1) {
    at = s.indexOf(target, from)
    if (at < 0) return s
    from = at + target.length
  }
  return s.slice(0, at) + replacement + s.slice(at + target.length)
}

// ⭐ `str.tonumber`: a plain decimal (optional sign, digits, optional fraction,
// optional exponent) is its value, ANYTHING else is `na` (NaN here). ⛔ Never
// `Number(s)`: it answers `0` for "", accepts "0x10", "Infinity" and padded
// spaces, none of which Pine reads as a number. ⚠️ NEEDS CAPTURE (W4-T11-b):
// padded text and exponents.
const DECIMAL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/
const toNumber = (s) => (DECIMAL.test(s) ? Number(s) : NaN)

// ⭐ `str.pos`: 0-based index of the FIRST occurrence, `na` when absent.
const posOf = (s, sub) => { const i = s.indexOf(sub); return i < 0 ? NaN : i }

/**
 * ⭐ `str.format_time` over the EXCHANGE's zone (America/New_York) with a literal
 * pattern: the SimpleDateFormat letters this lane answers exactly, as tokens.
 * `yyyy yy MM M dd d HH H mm m ss s`, `'quoted text'` (`''` is one quote) and any
 * non-letter separator. Any other letter returns `null` (the front end refuses it
 * by name; the run answers it with a runtime error).
 */
const FMT_RUNS = { y: ['yyyy', 'yy'], M: ['MM', 'M'], d: ['dd', 'd'], H: ['HH', 'H'], m: ['mm', 'm'], s: ['ss', 's'] }
export function compileTimeFormat(fmt) {
  if (typeof fmt !== 'string' || fmt === '') return null
  const out = []
  let i = 0
  while (i < fmt.length) {
    const ch = fmt[i]
    if (ch === "'") {
      let lit = ''
      let closed = false
      i += 1
      while (i < fmt.length) {
        if (fmt[i] === "'") {
          if (fmt[i + 1] === "'") { lit += "'"; i += 2; continue }
          closed = true; i += 1; break
        }
        lit += fmt[i]; i += 1
      }
      if (!closed) return null
      out.push({ lit })
    } else if (/[A-Za-z]/.test(ch)) {
      let j = i
      while (fmt[j] === ch) j += 1
      const run = fmt.slice(i, j)
      if (!FMT_RUNS[ch] || !FMT_RUNS[ch].includes(run)) return null
      out.push({ f: run })
      i = j
    } else {
      out.push({ lit: ch }); i += 1
    }
  }
  return out
}

const FMT_FIELD = { y: 'year', M: 'month', d: 'dayofmonth', H: 'hour', m: 'minute', s: 'second' }
function formatTimeNy(ms, fmt) {
  if (!Number.isFinite(ms)) return ''
  const toks = compileTimeFormat(fmt)
  if (toks === null) throw new PineRuntimeError(`\`str.format_time\` does not read the pattern "${fmt}"`)
  let o = ''
  for (const t of toks) {
    if (t.lit !== undefined) { o += t.lit; continue }
    const v = instantField(FMT_FIELD[t.f[0]], ms, 'exchange')
    if (!Number.isFinite(v)) return ''
    if (t.f === 'yyyy') o += String(v).padStart(4, '0')
    else if (t.f === 'yy') o += String(v % 100).padStart(2, '0')
    else o += t.f.length === 2 ? String(v).padStart(2, '0') : String(v)
  }
  return o
}

/**
 * @typedef {object} TextFn
 * @property {string[]} args     operand kinds, in order ('string' today)
 * @property {'string'|'number'} returns
 * @property {Function} fn       applied only after the kinds are checked
 */

/** @type {Readonly<Record<string, TextFn>>} */
export const TEXT_FNS = Object.freeze({
  // ⛔⛔ `replaceAll`, NEVER `replace`. With a STRING needle, `replace` replaces
  // only the FIRST occurrence — so a member's `str.replace_all(list, "\n", ",")`
  // over a pasted watchlist would join the first two lines and silently drop
  // every symbol after them. Pine replaces every occurrence.
  //
  // ⛔ AND THE NEEDLE IS LITERAL, WHICH IS THE SECOND REASON A REGEX PATH IS
  // WRONG. `str.replace_all("BRK.B", ".", "-")` must give `BRK-B`; a regex `.`
  // matches any character and would give `---B`. Real tickers carry dots.
  // `String.prototype.replaceAll` with a string needle is literal by contract.
  'str.replace_all': {
    args: ['string', 'string', 'string'],
    returns: 'string',
    fn: (s, target, replacement) => s.replaceAll(target, replacement),
  },
  // ⚠️ Pine's `str.trim` removes leading and trailing whitespace. It does NOT
  // collapse the inside, which is why the test pins a fixture with an interior
  // space — a `.replace(/\s+/g, '')` would pass a naive fixture and mangle
  // every multi-word string a member has.
  'str.trim': { args: ['string'], returns: 'string', fn: (s) => s.trim() },
  'str.upper': { args: ['string'], returns: 'string', fn: (s) => s.toUpperCase() },
  'str.lower': { args: ['string'], returns: 'string', fn: (s) => s.toLowerCase() },

  // ── the consumers: text in, NUMBER out ──
  // ⭐ A Pine `bool` is 1/0 in this engine's value model, the same spelling the
  // columnar lane uses, so these compose with every existing numeric operator
  // and with `?:` without a conversion step.
  'str.contains': {
    args: ['string', 'string'], returns: 'number', fn: (s, sub) => (s.includes(sub) ? 1 : 0),
  },
  'str.startswith': {
    args: ['string', 'string'], returns: 'number', fn: (s, pre) => (s.startsWith(pre) ? 1 : 0),
  },
  // ⭐ `endswith` IS HERE THOUGH NEITHER ACCEPTANCE SCRIPT USES IT, and that is
  // a deliberate exception to "implement only what was measured". It is the
  // declared pair of `startswith` in `PINE_TEXT_PREDICATE`, so without it a
  // member gets `str.startswith` working over a mutable value and
  // `str.endswith` refused beside it — a refusal that is false about its own
  // neighbour, which this codebase records as the thing that teaches a reader
  // to distrust every refusal in the file.
  'str.endswith': {
    args: ['string', 'string'], returns: 'number', fn: (s, suf) => (s.endsWith(suf) ? 1 : 0),
  },
  'str.length': { args: ['string'], returns: 'number', fn: (s) => s.length },

  // ── W4-T11: positions, parts and numbers over RUNTIME text ──
  // `afterDoor: true` = added after master 685b5e91d7: the front end asks `objectDoorRefuses`
  // before lowering it, so the C18 object door keeps master's answer (objectDoorGate.test.js).
  // `variants` maps a GIVEN argument count below `args.length` to the entry that
  // answers it (`WS_TEXT_FNS`): Pine's optional trailing arguments, one arity per
  // entry because the VM checks arity against the declaration.
  'str.substring': {
    args: ['string', 'number', 'number'], returns: 'string', fn: substringOf,
    afterDoor: true,
    variants: { 2: 'str.substring/from' },
  },
  'str.replace': {
    args: ['string', 'string', 'string', 'number'], returns: 'string', fn: replaceNth,
    afterDoor: true,
    variants: { 3: 'str.replace/first' },
  },
  'str.tonumber': { args: ['string'], returns: 'number', fn: toNumber, afterDoor: true },
  'str.pos': { args: ['string', 'string'], returns: 'number', fn: posOf, afterDoor: true },
})

/** The shorter spellings of the optional-argument entries above, and the
 *  exchange-zone `str.format_time` (the front end canonicalises its zone and pattern). */
export const WS_TEXT_FNS = Object.freeze({
  'str.substring/from': {
    args: ['string', 'number'], returns: 'string', fn: (s, b) => substringOf(s, b, s.length),
  },
  'str.replace/first': {
    args: ['string', 'string', 'string'], returns: 'string', fn: (s, t, r) => replaceNth(s, t, r, 0),
  },
  'str.format_time/ny': { args: ['number', 'string'], returns: 'string', fn: formatTimeNy },
})

/**
 * ⭐⭐ RT5 — `str.tostring` FOR A RUN THAT DRAWS (`objectsInRun`), and ONLY there.
 *
 * Kept OUT of `TEXT_FNS` on purpose: that table drives the front end's route
 * decision (`producesText`) for every build, and adding a name there changes what
 * every other runtime document compiles. The front end emits these two names only
 * when the run draws its own objects.
 *
 * ⭐ ONE FORMATTER: `objectRuntime.formatNumber`, the host object lane's own
 * (`#`/`0` patterns; no format = ten decimals trimmed, C43). A text argument is
 * itself. ⛔ The format must be a literal `#`/`0` pattern — the front end refuses
 * `format.mintick` / `format.percent` / a pattern with a comma by name.
 */
export const RUN_TEXT_FNS = Object.freeze({
  'str.tostring': {
    args: ['any'],
    returns: 'string',
    fn: (v) => (typeof v === 'string' ? v : typeof v === 'number' ? formatNumber(v) : ''),
  },
  'str.tostring/fmt': {
    args: ['any', 'string'],
    returns: 'string',
    fn: (v, f) => (typeof v === 'string' ? v : typeof v === 'number' ? formatNumber(v, f) : ''),
  },
})

/**
 * ⭐⭐ P3 WS-B — PINE'S CLOCK OVER AN INSTANT THE RUN COMPUTES (`clockFns.js`).
 *
 * `timestamp(zone, y, mo, d, h, mi, s)` and `<field>(t, zone)` for the seven
 * calendar fields. They ride `OP.TEXT` because it is this VM's one TYPED builtin
 * op — operand kinds declared per entry and checked at one site — and a zone is
 * text; each RETURNS A NUMBER (UNIX milliseconds, or the field), so nothing
 * textual survives. ⛔ Kept OUT of `TEXT_FNS` for the reason `RUN_TEXT_FNS` is:
 * that table is the front end's admission list by Pine NAME, and these names
 * (`timestamp/zone`, `year/instant`) are this lane's spellings, emitted only by
 * the front end after it has read the call's arguments and canonicalised the zone
 * (`clockFns.js::canonicalZone`).
 */
const num6 = ['number', 'number', 'number', 'number', 'number', 'number']
export const CLOCK_TEXT_FNS = Object.freeze({
  'timestamp/zone': { args: ['string', ...num6], returns: 'number', fn: (z, y, mo, d, h, mi, s) => timestampMs(z, y, mo, d, h, mi, s) },
  ...Object.fromEntries(INSTANT_FIELDS.map((f) => [`${f}/instant`, {
    args: ['number', 'string'], returns: 'number', fn: (t, z) => instantField(f, t, z),
  }])),
})

/** Every text op the VM can execute: the shared table plus the run-only ones. */
export const TEXT_IMPL = Object.freeze({ ...TEXT_FNS, ...WS_TEXT_FNS, ...RUN_TEXT_FNS, ...CLOCK_TEXT_FNS })

/** The names this lane serves, for the front end's admission check. */
export const TEXT_NAMES = Object.freeze(Object.keys(TEXT_FNS))

/** Does this call PRODUCE text? Used by the front end's route decision — a call
 *  returning a number composes with ordinary arithmetic and needs no text
 *  routing, while one returning a string must stay out of the columnar lane. */
export const producesText = (name) => (
  name === 'str.format_time'
  || (Object.prototype.hasOwnProperty.call(TEXT_FNS, name) && TEXT_FNS[name].returns === 'string'))

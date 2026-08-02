// app/src/components/chart/engine/defSchema.js
//
// ─── The indicator DEFINITION schema, and the validator that guards it ───────
//
// This is the contract every later piece of the indicator platform reads
// through: the registry stores definitions, the binder turns them into series,
// the Style tab renders `inputs[]`, the alert engine pins against
// `defId@version`, and (Phase D) a no-code builder EMITS this shape while an AI
// concierge is asked to author it. Getting the vocabulary right here is cheaper
// than getting it right in five places later.
//
// Spec: docs/superpowers/specs/2026-07-31-indicator-platform-design.md §3, §3.1.
//
// THE ONE RULE THAT SHAPES EVERYTHING — ASYMMETRIC UNKNOWN-FIELD POLICY
// ---------------------------------------------------------------------
// Definitions travel between clients of different ages. Two different unknowns
// need two different answers, and conflating them is how platforms rot:
//
//   * DOCUMENT fields (meta.*, labels, tooltips, descriptions) are
//     IGNORE-AND-PRESERVE. An unknown `meta.futureThing` survives validation
//     byte-untouched so a newer definition round-trips through an older client
//     without being quietly amputated. Forward compatibility is a property of
//     the DOCUMENT half only.
//
//   * BEHAVIOURAL fields FAIL CLOSED. An unknown `inputs[].type` or
//     `plots[].style` makes the definition INVALID AT REGISTRATION — never a
//     coercion to the nearest known value. The spec's reasoning is worth
//     repeating because it is not obvious: an input default that gets coerced
//     (an unrecognised `type` falling back to `float`, say) silently changes the
//     numbers the indicator computes, and those numbers feed alerts, the
//     screener, and the signal ledger. A chart that refuses to draw is a bug
//     report; a chart that draws the wrong thing is a wrong trade.
//
// So: unknown KEYS are preserved everywhere. Unknown VALUES of an ENUMERATED
// vocabulary are rejected. That is the line, and it is drawn at the value, not
// at the key.
//
// WHAT THIS VALIDATOR DELIBERATELY DOES NOT DO
// --------------------------------------------
// It does not resolve `token:` colour references. `designTokens.resolveToken()`
// needs a chart PRESET, which is a render-time fact, not a registration-time
// one — the same definition renders on four presets. So `'token:info'` is
// simply a legal colour string here; the binder resolves it per-theme at render
// time and decides what a miss means. Equally, it never touches the network,
// never reads settings, and never throws: it is a pure function of its argument.
//
// RELATIONSHIP TO `../indicatorRegistry.js`
// -----------------------------------------
// That file is a half-built version of this same idea — field descriptors with
// `type` / `min` / `max` / `options` / `showIf` / `disabled` driving the
// Indicators tab. It is NOT superseded here and must not be edited: it is what
// ships today. But the `inputs[]` vocabulary below is a strict SUPERSET of its
// field vocabulary so B4 can eventually drive ONE renderer from definitions
// rather than maintaining two parallel field systems:
//
//   registry `select`  → `enum`   (+ `options`)
//   registry `number`  → `int` | `float`   (+ `min` / `max` / `step`)
//   registry `color`   → `color`
//   registry `toggle`  → `bool`
//   registry `showIf`  → `activeWhen`  (a JS predicate cannot survive JSON, so
//                                       the definition form is declarative data)
//   registry `disabled: '<reason>'`    → carried through verbatim
//
// NAME COLLISION, ON PURPOSE: this module also exports `PLOT_STYLES`, but as a
// flat array of style NAMES, whereas `indicatorRegistry.PLOT_STYLES` is
// `[[value, label]]` pairs for a `<select>`. Different modules, different
// shapes, no import between them — import the one whose module you mean.

/** Schema major. A definition MUST declare exactly this to register. */
export const SCHEMA_VERSION = 1

// ─── The locked vocabularies ─────────────────────────────────────────────────
// Exported (and frozen) so the registry, binder, Style tab, and builder all read
// ONE list. A second hand-written copy of any of these is the bug.

/** Input types buildable in v1 (spec §3.1). */
export const INPUT_TYPES = Object.freeze([
  'int', 'float', 'bool', 'enum', 'string', 'color', 'source',
])

/** Schema-reserved input types — named by the spec, deliberately NOT buildable
 *  in v1. Rejected with a distinct message so an author (or an AI generating a
 *  definition) can tell "you typo'd" from "that ships later". */
export const RESERVED_INPUT_TYPES = Object.freeze([
  'timeframe', 'price', 'time', 'session', 'symbol', 'confirm',
])

/** Plot styles buildable in v1 (spec §3.1).
 *
 *  `band` gets a rule the others don't need, added in B2 Task 2 when Bollinger
 *  and Donchian became definitions: a band is the only style whose meaning
 *  depends on OTHER columns, so it must say which ones. See `plots[].edges`
 *  and `validateBandEdges` below. */
export const PLOT_STYLES = Object.freeze([
  'line', 'stepline', 'histogram', 'area', 'baseline', 'hlines', 'markers', 'band',
])

/** Schema-reserved plot styles — renderer lands later. Same distinct-message
 *  treatment as RESERVED_INPUT_TYPES. */
export const RESERVED_PLOT_STYLES = Object.freeze(['zones', 'bgband', 'barcolor', 'fill'])

/** Compute lanes (spec §3). `script` is reserved AI plumbing but is a declared
 *  kind, so it parses; the registry's `supportedKinds` filter decides what a
 *  given client will actually run. */
export const COMPUTE_KINDS = Object.freeze(['native', 'server', 'ast', 'script'])

/** Where the indicator draws. `volume` = the shipped left-axis overlay. */
export const PLACEMENT_TARGETS = Object.freeze(['price', 'pane', 'volume'])

/** Repaint honesty label (spec §3). Phase A/B: audited metadata. */
export const REPAINT_MODES = Object.freeze(['non-repainting', 'preview-repaints', 'repaints'])

/** Per-plot role — drives legend order, default widths, visual-budget linter. */
export const PLOT_ROLES = Object.freeze(['primary', 'secondary', 'context', 'signal'])

/**
 * Line styles an AUTHOR may declare on a plot.
 *
 * ⚠️ NOT the same list as `indicatorRegistry.LINE_STYLES`, and it stopped being
 * so deliberately. That one is the USER-FACING picker (solid / dashed / dotted)
 * for the styles a user can choose; this one has to be able to name every style
 * the SHIPPED code actually draws, because a definition that cannot say what the
 * legacy block does is a definition that renders something else.
 *
 * `largeDashed` (LWC `LineStyle.LargeDashed` = 3) is the case that forced the
 * split. Three shipped guides use it — RSI's 50, MACD's 0, CCI's 0 — and the
 * three-name vocabulary could not express it, so those plots declared nothing.
 * "Declare nothing" is safe for a SERIES option (LWC keeps the current value)
 * and is NOT safe for a `createPriceLine` option: an omitted `lineStyle` there
 * takes LWC's own default, which is `Dashed`. The Task 8 rehearsal measured the
 * result — **379 changed pixels** on one guide line, a 6-on/6-off dash rendered
 * as 2-on/2-off. No user picker gains an entry: these three guides are authored,
 * not user-styled.
 */
export const PLOT_LINE_STYLES = Object.freeze(['solid', 'dashed', 'dotted', 'largeDashed'])

/** Non-parametric colour modes. `column:<key>` is the parametric third form. */
export const COLOR_MODES = Object.freeze(['fixed', 'sign'])

/** Entitlement tier. LOCKED in B2 Task 2 (carry-in c): it was validated only as
 *  "a string", so `tier: 'pro'` or a typo'd `'Free'` registered happily and then
 *  read as "not free" — or worse, as free — at whatever gate consumes it. A tier
 *  is a paywall claim, so it fails closed like every other behavioural value. */
export const TIERS = Object.freeze(['free', 'premium'])

/** Bar fields a `source` input may name directly. Anything else must be a
 *  `defId.plotKey` handle into the registry — see `validateSourceReferents`. */
export const SOURCE_BAR_FIELDS = Object.freeze([
  'open', 'high', 'low', 'close', 'hl2', 'hlc3', 'ohlc4', 'volume',
])

/** The ONLY plot fields in which `$<inputKey>` substitution is legal (spec §3.1). */
export const SUBSTITUTABLE_PLOT_FIELDS = Object.freeze(['color', 'width', 'levels'])

// ─── Grammar ─────────────────────────────────────────────────────────────────

/** `$<inputKey>` — the whole value is the reference, or it is not one. */
const REF_RE = /^\$([A-Za-z][A-Za-z0-9_]*)$/

/** Input / plot / event keys. Identifier-shaped because they are addressed:
 *  plots as `defId.plotKey`, inputs as `$inputKey`. A dot or a space in either
 *  would make those two grammars ambiguous. */
const KEY_RE = /^[A-Za-z][A-Za-z0-9_]*$/

/** Definition id. Hyphens allowed (`uct-rsi`); dots are not — `defId.plotKey`
 *  addressing has to stay unambiguous. */
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/

/** Sentinel returned by `substitute()` when a `$ref` did not resolve. Distinct
 *  from every legal value (including `undefined`) so a failed substitution can
 *  never be mistaken for a successful one that produced nothing — which is
 *  exactly the "silent default" the spec forbids. */
const REF_FAILED = Symbol('ref-failed')

// ─── Small pure helpers ──────────────────────────────────────────────────────

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Render a value for an error message. Every error names the offending field
 *  AND the offending value — a validator whose errors don't identify what to fix
 *  is a validator nobody debugs with, and these messages are read by a future AI
 *  generating definitions, so they are an interface, not decoration.
 *
 *  Exported (as `formatValue`) so `instances.js` writes its errors in the same
 *  voice — two error dialects inside one engine is a small thing that reads as
 *  sloppiness at exactly the moment someone is debugging. */
export function formatValue(v) {
  if (typeof v === 'string') return JSON.stringify(v)
  if (v === undefined) return 'undefined'
  if (v === null) return 'null'
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v)
  if (typeof v === 'function') return 'a function'
  if (typeof v === 'symbol') return 'a symbol'
  if (Array.isArray(v)) return `an array [${v.map((x) => fmt(x)).join(', ')}]`
  const keys = Object.keys(v)
  return `an object {${keys.join(', ')}}`
}

/** Internal alias so the ~60 existing call sites read as they always did. */
const fmt = formatValue

function list(values) {
  return values.join(', ')
}

/** Structural clone of definition-shaped data.
 *
 *  Hand-rolled rather than `structuredClone` for one reason: structuredClone
 *  THROWS on a function, and a caller migrating off `indicatorRegistry` may well
 *  hand us a descriptor still carrying a `showIf` predicate. This validator's
 *  contract is "never throws" — so unclonable values pass through by reference
 *  instead, and the offending field is reported as an error like anything else. */
function deepClone(v) {
  if (Array.isArray(v)) return v.map(deepClone)
  if (isPlainObject(v)) {
    const out = {}
    for (const k of Object.keys(v)) out[k] = deepClone(v[k])
    return out
  }
  return v
}

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v)
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim() !== ''
}

/**
 * Check a value against a locked vocabulary. THIS IS THE FAIL-CLOSED GATE.
 *
 * There is no fallback branch here and there must never be one: returning a
 * default for an unrecognised behavioural value is the silent coercion the spec
 * bans. A reserved value gets its own message so "not yet" reads differently
 * from "never".
 *
 * @returns {boolean} true when `value` is in `allowed`.
 */
function checkVocabulary(value, allowed, reserved, path, what, errors) {
  if (allowed.includes(value)) return true
  if (reserved.includes(value)) {
    errors.push(
      `${path}: ${what} ${fmt(value)} is SCHEMA-RESERVED for a later phase and cannot be ` +
      `registered in schemaVersion ${SCHEMA_VERSION} — buildable ${what}s are: ${list(allowed)}`,
    )
    return false
  }
  errors.push(
    `${path}: unknown ${what} ${fmt(value)} — expected one of: ${list(allowed)}. ` +
    `Unknown behavioural values are rejected at registration, never coerced.`,
  )
  return false
}

/**
 * Resolve a `$<inputKey>` reference against the declared inputs.
 *
 * Any string beginning with `$` in a substitutable field is TREATED as a
 * reference. A malformed one (`'$'`, `'$1x'`) is an error rather than a literal
 * passthrough — letting it through would ship `$` as a CSS colour, which is a
 * silent default wearing a disguise.
 *
 * @returns the substituted value, the original value when it isn't a ref, or
 *          REF_FAILED (an error has already been pushed).
 */
function substitute(value, inputsByKey, path, errors) {
  if (typeof value !== 'string' || !value.startsWith('$')) return value

  const m = REF_RE.exec(value)
  if (!m) {
    errors.push(
      `${path}: malformed $ref ${fmt(value)} — the substitution grammar is ` +
      `$<inputKey> where inputKey matches ${KEY_RE}`,
    )
    return REF_FAILED
  }

  const key = m[1]
  const input = inputsByKey.get(key)
  if (!input) {
    const declared = [...inputsByKey.keys()]
    errors.push(
      `${path}: unresolvable $ref ${fmt(value)} — no input declares key ${fmt(key)} ` +
      `(declared input keys: ${declared.length ? list(declared) : 'none'}). ` +
      `An unresolvable $ref invalidates the definition; it is never silently defaulted.`,
    )
    return REF_FAILED
  }
  if (!Object.prototype.hasOwnProperty.call(input, 'default')) {
    errors.push(
      `${path}: $ref ${fmt(value)} points at input ${fmt(key)}, which declares no "default" ` +
      `to substitute — give inputs[].default a value or stop referencing it.`,
    )
    return REF_FAILED
  }
  return deepClone(input.default)
}

/**
 * The input key a `$ref` names, or null when the value isn't one.
 *
 * WHY THE REFERENCE IS KEPT AFTER IT IS RESOLVED. `substitute` replaces
 * `color: '$color'` with the input's DEFAULT, which is right for a definition —
 * a definition has no user behind it. But an INSTANCE does: `{inputs: {color:
 * '#abcdef'}}` is the whole point of the field, and once the reference is gone
 * the binder has no way to know that this plot's colour is the one the user
 * edited rather than a literal the author wrote. It would render every migrated
 * indicator in its default colour and nobody would be able to say why.
 *
 * So the resolved plot carries `$refs`: `{ color: 'color', width: 'lineWidth',
 * levels: ['hi', null, 'lo'] }` — field → the input key it came from — and
 * `pool.resolvePlotForInstance` re-applies it per instance. `$`-prefixed because
 * KEY_RE forbids a leading `$`, so it can never collide with an author's field.
 */
function refKeyOf(value) {
  if (typeof value !== 'string' || !value.startsWith('$')) return null
  const m = REF_RE.exec(value)
  return m ? m[1] : null
}

function noteRef(plot, field, key) {
  if (!key) return
  if (!plot.$refs) plot.$refs = {}
  plot.$refs[field] = key
}

// ─── Section validators ──────────────────────────────────────────────────────

function validateCompute(compute, errors) {
  if (!isPlainObject(compute)) {
    errors.push(`compute: required object, got ${fmt(compute)}`)
    return
  }
  // `kind` selects the EXECUTION LANE. An unrecognised lane silently falling
  // back to `native` would run a different implementation than the author
  // declared, so it is fail-closed alongside inputs[].type and plots[].style.
  checkVocabulary(compute.kind, COMPUTE_KINDS, [], 'compute.kind', 'compute kind', errors)

  if (!isNonEmptyString(compute.fn)) {
    errors.push(`compute.fn: required non-empty string (the compute function handle), got ${fmt(compute.fn)}`)
  }
  // `rev` is the MATH revision; a bump force-migrates every binding (spec §3.1).
  // It must be a real integer or that migration can never be ordered.
  if (!Number.isInteger(compute.rev) || compute.rev < 1) {
    errors.push(`compute.rev: required integer >= 1 (the math revision), got ${fmt(compute.rev)}`)
  }
  // `budget` is reserved (op/lookback caps for ast/script kinds). Only its
  // presence-shape is checked; the caps themselves have no meaning yet.
  if (compute.budget !== undefined && compute.budget !== null && !isPlainObject(compute.budget)) {
    errors.push(`compute.budget: reserved — expected null or an object, got ${fmt(compute.budget)}`)
  }
}

function validateMeta(meta, errors) {
  if (!isPlainObject(meta)) {
    errors.push(`meta: required object, got ${fmt(meta)}`)
    return
  }
  if (!isNonEmptyString(meta.name)) {
    errors.push(`meta.name: required non-empty string, got ${fmt(meta.name)}`)
  }
  for (const k of ['shortName', 'category', 'description', 'author']) {
    if (meta[k] !== undefined && typeof meta[k] !== 'string') {
      errors.push(`meta.${k}: expected a string, got ${fmt(meta[k])}`)
    }
  }
  // `tier` is an entitlement claim, not decoration — see TIERS. Omitting it is
  // legal (a definition need not gate itself); naming an unlocked tier is not.
  if (meta.tier !== undefined) {
    checkVocabulary(meta.tier, TIERS, [], 'meta.tier', 'tier', errors)
  }
  if (meta.tags !== undefined) {
    if (!Array.isArray(meta.tags) || meta.tags.some((t) => typeof t !== 'string')) {
      errors.push(`meta.tags: expected an array of strings, got ${fmt(meta.tags)}`)
    }
  }
  // `repaint` is document-ADJACENT but it is a truth claim about the maths that a
  // user makes decisions on, and its vocabulary is locked by the spec. An
  // unrecognised label rendered as "probably fine" is the coercion class. A
  // future value therefore has to arrive with a schema bump, not by luck.
  if (meta.repaint !== undefined) {
    checkVocabulary(meta.repaint, REPAINT_MODES, [], 'meta.repaint', 'repaint mode', errors)
  }
  // NOTE: unknown meta.* KEYS are intentionally NOT checked. They are preserved
  // verbatim on the returned def — that is the forward-compatibility half of the
  // asymmetric policy, and the round-trip promise depends on this silence.
}

function validatePlacement(placement, errors) {
  if (!isPlainObject(placement)) {
    errors.push(`placement: required object, got ${fmt(placement)}`)
    return
  }
  checkVocabulary(placement.target, PLACEMENT_TARGETS, [], 'placement.target', 'placement target', errors)

  const { scale } = placement
  if (scale === undefined || scale === null) return
  if (!isPlainObject(scale)) {
    errors.push(`placement.scale: expected an object with numeric min/max, got ${fmt(scale)}`)
    return
  }
  for (const k of ['min', 'max']) {
    if (scale[k] !== undefined && !isFiniteNumber(scale[k])) {
      errors.push(`placement.scale.${k}: expected a finite number, got ${fmt(scale[k])}`)
    }
  }
  if (isFiniteNumber(scale.min) && isFiniteNumber(scale.max) && scale.min >= scale.max) {
    errors.push(
      `placement.scale: min must be < max, got min=${fmt(scale.min)} max=${fmt(scale.max)}`,
    )
  }
}

/** Pull the value out of an enum option, accepting the three shapes a caller
 *  might reasonably write — a bare scalar, the `[value, label]` pair shape
 *  `indicatorRegistry` already uses, or `{value, label}`. */
function enumOptionValue(option) {
  if (Array.isArray(option)) return option[0]
  if (isPlainObject(option) && 'value' in option) return option.value
  return option
}

/**
 * Check a VALUE against an input's declared `type`, `options` and bounds.
 *
 * This is where "never coerce" earns its keep: a `type: 'int'` holding `'14'` is
 * a bug, and accepting it would mean the string reaches the compute lane and
 * does string maths there.
 *
 * EXPORTED because two callers must agree exactly, and B2 Task 3 is where that
 * stopped being hypothetical: `validateDefinition` checks an input's DEFAULT
 * with it, and `instances.js::validateInstance` checks a stored instance's
 * OVERRIDE with it. Those are the same question asked about two values, and a
 * second copy of the answer would drift the day someone adds an input type —
 * definitions would accept it and instances would reject it, or worse.
 *
 * Pushes into `errors`; returns nothing. `path` names the value being checked
 * (`inputs[0].default`, `inputs.period`, …) and every message starts with it.
 *
 * @param {object} input  the declared input descriptor (type/options/min/max)
 * @param {unknown} value the value to check
 * @param {string} path   error prefix identifying the value
 * @param {string[]} errors accumulator
 */
export function validateInputValue(input, value, path, errors) {
  const { type } = input
  const d = value

  switch (type) {
    case 'int':
      if (!Number.isInteger(d)) errors.push(`${path}: type "int" requires an integer, got ${fmt(d)}`)
      break
    case 'float':
      if (!isFiniteNumber(d)) errors.push(`${path}: type "float" requires a finite number, got ${fmt(d)}`)
      break
    case 'bool':
      if (typeof d !== 'boolean') errors.push(`${path}: type "bool" requires true or false, got ${fmt(d)}`)
      break
    case 'string':
      if (typeof d !== 'string') errors.push(`${path}: type "string" requires a string, got ${fmt(d)}`)
      break
    case 'color':
      // Not resolved here — `'token:info'`, `'#ff8100'` and `'rgba(…)'` are all
      // legal at registration; designTokens.resolveToken() adjudicates at render.
      if (!isNonEmptyString(d)) {
        errors.push(`${path}: type "color" requires a non-empty string (a "token:<role>" ref or a raw CSS colour), got ${fmt(d)}`)
      }
      break
    case 'source':
      // The referent set (bar fields plus this-or-another indicator's plot keys)
      // is a binder-time fact — the spec does not lock a v1 enum, so inventing
      // one here would reject definitions the platform is supposed to accept.
      if (!isNonEmptyString(d)) {
        errors.push(`${path}: type "source" requires a non-empty string (a bar field or a "defId.plotKey" handle), got ${fmt(d)}`)
      }
      break
    case 'enum': {
      if (!Array.isArray(input.options) || input.options.length === 0) {
        errors.push(`${path}: type "enum" requires a non-empty options array on the input, got ${fmt(input.options)}`)
        break
      }
      const values = input.options.map(enumOptionValue)
      // Option VALUES must be scalars. Membership below is identity-based, and
      // an array or object option could therefore never match its own default —
      // it would fail with a baffling "[80, 20] is not one of: [80, 20]". A
      // dropdown value is a scalar anyway; rejecting the rest says so out loud
      // instead of failing mysteriously later.
      const nonScalar = values.filter((v) => !['string', 'number', 'boolean'].includes(typeof v))
      if (nonScalar.length) {
        errors.push(
          `${path}: enum option values must be scalars (string, number or boolean), got ${list(nonScalar.map(fmt))} — ` +
          `options are compared by identity, so a non-scalar could never match a value`,
        )
        break
      }
      if (!values.includes(d)) {
        errors.push(`${path}: ${fmt(d)} is not one of the declared options: ${list(values.map(fmt))}`)
      }
      break
    }
    default:
      // Unreachable from validateDefinition: an unknown `type` was already
      // reported and this switch is only entered for vocabulary members.
      // Deliberately silent rather than guessing a shape for a type we refuse.
      break
  }

  // Numeric bounds. A value outside its declared range renders out of range and
  // then snaps the moment a user opens the Style tab — a real bug that only ever
  // shows up in production.
  if ((type === 'int' || type === 'float') && isFiniteNumber(d)) {
    if (isFiniteNumber(input.min) && d < input.min) {
      errors.push(`${path}: ${fmt(d)} is below the declared min ${fmt(input.min)}`)
    }
    if (isFiniteNumber(input.max) && d > input.max) {
      errors.push(`${path}: ${fmt(d)} is above the declared max ${fmt(input.max)}`)
    }
  }
}

/** An input's `default` is just a value, checked by the shared rules above —
 *  plus the one rule that is only about the DEFAULT: it has to exist. */
function validateInputDefault(input, path, errors) {
  if (!Object.prototype.hasOwnProperty.call(input, 'default')) {
    errors.push(
      `${path}.default: required — every input needs a default (it is the value the ` +
      `engine computes with before the user touches anything, and the target of $${input.key || '<key>'} substitution)`,
    )
    return
  }
  validateInputValue(input, input.default, `${path}.default`, errors)
}

function validateInput(input, index, seenKeys, errors) {
  const path = `inputs[${index}]`
  if (!isPlainObject(input)) {
    errors.push(`${path}: expected an object, got ${fmt(input)}`)
    return
  }

  // key
  if (!isNonEmptyString(input.key)) {
    errors.push(`${path}.key: required non-empty string, got ${fmt(input.key)}`)
  } else if (!KEY_RE.test(input.key)) {
    errors.push(
      `${path}.key: ${fmt(input.key)} is not a legal input key — must match ${KEY_RE} ` +
      `so that "$${input.key}" stays an unambiguous substitution reference`,
    )
  } else if (seenKeys.has(input.key)) {
    errors.push(
      `${path}.key: duplicate input key ${fmt(input.key)} (first declared at inputs[${seenKeys.get(input.key)}]) — ` +
      `"$${input.key}" would be ambiguous`,
    )
  } else {
    seenKeys.set(input.key, index)
  }

  // type — THE FAIL-CLOSED GATE. No fallback branch. Ever.
  const typeOk = checkVocabulary(
    input.type, INPUT_TYPES, RESERVED_INPUT_TYPES, `${path}.type`, 'input type', errors,
  )

  // default (only meaningful once the type is one we understand)
  if (typeOk) validateInputDefault(input, path, errors)

  // numeric modifiers
  for (const k of ['min', 'max', 'step']) {
    if (input[k] !== undefined && !isFiniteNumber(input[k])) {
      errors.push(`${path}.${k}: expected a finite number, got ${fmt(input[k])}`)
    }
  }
  if (isFiniteNumber(input.min) && isFiniteNumber(input.max) && input.min > input.max) {
    errors.push(`${path}: min must be <= max, got min=${fmt(input.min)} max=${fmt(input.max)}`)
  }
  if (isFiniteNumber(input.step) && input.step <= 0) {
    errors.push(`${path}.step: must be > 0, got ${fmt(input.step)}`)
  }

  // presentation modifiers (spec §3.1: group/inline/tooltip/activeWhen ship v1)
  for (const k of ['label', 'group', 'inline', 'tooltip', 'disabled']) {
    if (input[k] !== undefined && typeof input[k] !== 'string') {
      errors.push(`${path}.${k}: expected a string, got ${fmt(input[k])}`)
    }
  }
}

/** `activeWhen` is the JSON-expressible successor to `indicatorRegistry`'s
 *  `showIf` predicate (a function cannot survive a definition round-trip). The
 *  operator grammar is NOT locked in v1, so this checks only the part that is
 *  checkable and dangerous: a condition keyed on an input that does not exist
 *  would silently evaluate to "never show", hiding a control forever. Same class
 *  as an unresolvable $ref, so it gets the same treatment. */
function validateActiveWhen(input, index, inputsByKey, errors) {
  const aw = input?.activeWhen
  if (aw === undefined || aw === null) return
  const path = `inputs[${index}].activeWhen`
  if (!isPlainObject(aw)) {
    errors.push(`${path}: expected an object describing the condition, got ${fmt(aw)}`)
    return
  }
  if (typeof aw.key !== 'string') return   // a future shape we do not yet parse — left alone
  if (!inputsByKey.has(aw.key)) {
    errors.push(
      `${path}.key: unresolvable reference ${fmt(aw.key)} — no input declares that key ` +
      `(declared input keys: ${list([...inputsByKey.keys()]) || 'none'})`,
    )
  } else if (aw.key === input.key) {
    errors.push(`${path}.key: ${fmt(aw.key)} refers to its own input — the condition can never be evaluated`)
  }
}

function validatePlot(plot, index, seenKeys, inputsByKey, errors) {
  const path = `plots[${index}]`
  if (!isPlainObject(plot)) {
    errors.push(`${path}: expected an object, got ${fmt(plot)}`)
    return
  }

  // key — the PUBLIC HANDLE. Addressed as `defId.plotKey`, referenced by a
  // `source` input, and it names the compute column, so duplicates are fatal:
  // two plots would fight over one Float64Array.
  if (!isNonEmptyString(plot.key)) {
    errors.push(`${path}.key: required non-empty string, got ${fmt(plot.key)}`)
  } else if (!KEY_RE.test(plot.key)) {
    errors.push(
      `${path}.key: ${fmt(plot.key)} is not a legal plot key — must match ${KEY_RE} ` +
      `so "defId.${plot.key}" addressing stays unambiguous`,
    )
  } else if (seenKeys.has(plot.key)) {
    errors.push(
      `${path}.key: duplicate plot key ${fmt(plot.key)} (first declared at plots[${seenKeys.get(plot.key)}]) — ` +
      `plot keys are the public handles and must be unique`,
    )
  } else {
    seenKeys.set(plot.key, index)
  }

  // style — THE OTHER FAIL-CLOSED GATE. No fallback branch. Ever.
  const styleOk = checkVocabulary(
    plot.style, PLOT_STYLES, RESERVED_PLOT_STYLES, `${path}.style`, 'plot style', errors,
  )

  // ─ substitutable fields (spec §3.1: color, width, levels) ─

  if (plot.color !== undefined) {
    const colorRef = refKeyOf(plot.color)
    const color = substitute(plot.color, inputsByKey, `${path}.color`, errors)
    if (color !== REF_FAILED) {
      noteRef(plot, 'color', colorRef)
      if (!isNonEmptyString(color)) {
        errors.push(
          `${path}.color: expected a non-empty colour string (a "token:<role>" ref or a raw CSS ` +
          `colour)${plot.color !== color ? ` after substituting ${fmt(plot.color)}` : ''}, got ${fmt(color)}`,
        )
      }
      plot.color = color
    }
  }

  if (plot.width !== undefined) {
    const widthRef = refKeyOf(plot.width)
    const width = substitute(plot.width, inputsByKey, `${path}.width`, errors)
    if (width !== REF_FAILED) {
      noteRef(plot, 'width', widthRef)
      if (!isFiniteNumber(width) || width <= 0) {
        errors.push(
          `${path}.width: expected a finite number > 0` +
          `${plot.width !== width ? ` after substituting ${fmt(plot.width)}` : ''}, got ${fmt(width)}`,
        )
      }
      plot.width = width
    }
  }

  if (plot.levels !== undefined) {
    // Two substitution shapes are attempted: the WHOLE array from one input
    // (`levels: "$bands"`), or per-element (`levels: ["$hi", 50, "$lo"]`).
    //
    // PER-ELEMENT IS THE ONLY REACHABLE FORM IN v1, and that is worth stating:
    // no v1 input type produces an array default (int/float → number, bool →
    // boolean, enum → a scalar option, string/color/source → string), so
    // `levels: "$bands"` cannot resolve to an array until a list-shaped input
    // type ships. The whole-value branch is kept anyway because it turns that
    // dead end into a precise error ("expected an array after substituting
    // "$bands", got 14") instead of a shrug.
    const levels = substitute(plot.levels, inputsByKey, `${path}.levels`, errors)
    if (levels !== REF_FAILED) {
      if (!Array.isArray(levels)) {
        errors.push(
          `${path}.levels: expected an array of numbers` +
          `${plot.levels !== levels ? ` after substituting ${fmt(plot.levels)}` : ''}, got ${fmt(levels)}`,
        )
      } else {
        const levelRefs = levels.map(refKeyOf)
        if (levelRefs.some(Boolean)) noteRef(plot, 'levels', levelRefs)
        const resolved = levels.map((lvl, i) => {
          const v = substitute(lvl, inputsByKey, `${path}.levels[${i}]`, errors)
          if (v === REF_FAILED) return lvl
          if (!isFiniteNumber(v)) {
            errors.push(
              `${path}.levels[${i}]: expected a finite number` +
              `${lvl !== v ? ` after substituting ${fmt(lvl)}` : ''}, got ${fmt(v)}`,
            )
          }
          return v
        })
        plot.levels = resolved
      }
    }
  }

  // An `hlines` plot with nothing to draw is a plot key that produces no line —
  // it registers, renders nothing, and the author never learns why.
  if (styleOk && plot.style === 'hlines' && !(Array.isArray(plot.levels) && plot.levels.length > 0)) {
    errors.push(`${path}.levels: style "hlines" requires a non-empty levels array, got ${fmt(plot.levels)}`)
  }

  // ─ enumerated presentation fields ─

  if (plot.lineStyle !== undefined) {
    checkVocabulary(plot.lineStyle, PLOT_LINE_STYLES, [], `${path}.lineStyle`, 'line style', errors)
  }
  if (plot.role !== undefined) {
    checkVocabulary(plot.role, PLOT_ROLES, [], `${path}.role`, 'plot role', errors)
  }
  if (plot.label !== undefined && typeof plot.label !== 'string') {
    errors.push(`${path}.label: expected a string, got ${fmt(plot.label)}`)
  }
  if (plot.precision !== undefined && (!Number.isInteger(plot.precision) || plot.precision < 0)) {
    errors.push(`${path}.precision: expected an integer >= 0 (display decimals), got ${fmt(plot.precision)}`)
  }
  // `opacity` names a step in the designTokens ALPHA ramp. It is NOT enumerated
  // here on purpose: duplicating that ramp's key list would create two lists to
  // keep in sync, and this module stays dependency-free. The binder resolves it.
  if (plot.opacity !== undefined
      && !isNonEmptyString(plot.opacity)
      && !(isFiniteNumber(plot.opacity) && plot.opacity >= 0 && plot.opacity <= 1)) {
    errors.push(
      `${path}.opacity: expected an ALPHA ramp step name (e.g. "band", "solid") or a number in [0, 1], got ${fmt(plot.opacity)}`,
    )
  }
}

/** `colorMode` is checked after ALL plots and events are known because its
 *  parametric form `column:<key>` references a compute column, and columns are
 *  exactly the plot keys plus the event keys (spec §4). */
function validateColorModes(plots, columnKeys, errors) {
  plots.forEach((plot, index) => {
    if (!isPlainObject(plot) || plot.colorMode === undefined) return
    const path = `plots[${index}].colorMode`
    const mode = plot.colorMode
    if (typeof mode !== 'string') {
      errors.push(`${path}: expected a string, got ${fmt(mode)}`)
      return
    }
    if (COLOR_MODES.includes(mode)) return
    if (!mode.startsWith('column:')) {
      errors.push(
        `${path}: unknown colour mode ${fmt(mode)} — expected one of: ${list(COLOR_MODES)}, ` +
        `or "column:<key>" naming a returned column.`,
      )
      return
    }
    const col = mode.slice('column:'.length)
    if (!columnKeys.has(col)) {
      errors.push(
        `${path}: ${fmt(mode)} references column ${fmt(col)}, which no plot or event declares ` +
        `(available columns: ${list([...columnKeys]) || 'none'})`,
      )
    }
  })
}

/**
 * `plots[].edges` — the band's bounding columns. Cross-section, like colorMode,
 * because an edge may name a plot declared LATER in the array.
 *
 * WHY THIS EXISTS (B2 Task 2 carry-in a): `band` was in the style vocabulary
 * with nothing saying WHICH columns bound it. A band is the one v1 style whose
 * meaning lives in other columns, so without `edges` a `band` plot registers
 * successfully and is unrenderable — the definition simply doesn't contain the
 * information. Bollinger and Donchian are exactly this shape (a centre column
 * between two edge columns) and are the reason it is needed now.
 *
 * THE SHAPE: a band plot's OWN key is its centre column — the value it plots
 * like any other line — and `edges: {upper, lower}` names two OTHER declared
 * plots. The edges stay first-class plots rather than becoming anonymous
 * sub-columns because today each is its own series with its own line style
 * (BB's edges are dashed and its middle solid; Donchian's are the other way
 * round), and a definition that couldn't say that couldn't reproduce the chart.
 *
 * An edge must not be an `hlines` plot: guides are static levels and produce no
 * column, so a band bounded by one bounds nothing. That is the "validate that
 * those columns exist" half — existence here means "declares a column", not
 * merely "is a key someone wrote down".
 */
function validateBandEdges(plots, errors) {
  const styleByKey = new Map()
  for (const p of plots) {
    if (isPlainObject(p) && isNonEmptyString(p.key) && !styleByKey.has(p.key)) {
      styleByKey.set(p.key, p.style)
    }
  }
  const declared = () => list([...styleByKey.keys()]) || 'none'

  plots.forEach((plot, index) => {
    if (!isPlainObject(plot)) return
    const path = `plots[${index}]`
    const isBand = plot.style === 'band'
    const { edges } = plot

    if (!isBand) {
      if (edges !== undefined) {
        errors.push(
          `${path}.edges: only a "band" plot has edges — plots[${index}] is style ${fmt(plot.style)}, ` +
          `so its edges would be carried around and never drawn`,
        )
      }
      return
    }

    if (!isPlainObject(edges)) {
      errors.push(
        `${path}.edges: style "band" requires edges: {upper: "<plotKey>", lower: "<plotKey>"} naming the ` +
        `two columns that bound it, got ${fmt(edges)} — without them the band has nothing to draw between`,
      )
      return
    }

    for (const side of ['upper', 'lower']) {
      const ref = edges[side]
      if (!isNonEmptyString(ref)) {
        errors.push(`${path}.edges.${side}: required non-empty plot key, got ${fmt(ref)}`)
        continue
      }
      if (ref === plot.key) {
        errors.push(
          `${path}.edges.${side}: ${fmt(ref)} is the band's own key — a band cannot bound itself`,
        )
        continue
      }
      if (!styleByKey.has(ref)) {
        errors.push(
          `${path}.edges.${side}: ${fmt(ref)} names no declared plot (declared plot keys: ${declared()})`,
        )
        continue
      }
      if (styleByKey.get(ref) === 'hlines') {
        errors.push(
          `${path}.edges.${side}: ${fmt(ref)} is an "hlines" plot — guides are static levels and return ` +
          `no column, so they cannot bound a band`,
        )
      }
    }

    if (isNonEmptyString(edges.upper) && edges.upper === edges.lower) {
      errors.push(
        `${path}.edges: upper and lower are both ${fmt(edges.upper)} — a band between one column and ` +
        `itself has zero width`,
      )
    }
  })
}

function validateEvent(event, index, seenKeys, plotKeys, errors) {
  const path = `events[${index}]`
  if (!isPlainObject(event)) {
    errors.push(`${path}: expected an object, got ${fmt(event)}`)
    return
  }
  if (!isNonEmptyString(event.key)) {
    errors.push(`${path}.key: required non-empty string, got ${fmt(event.key)}`)
    return
  }
  if (!KEY_RE.test(event.key)) {
    errors.push(`${path}.key: ${fmt(event.key)} is not a legal event key — must match ${KEY_RE}`)
    return
  }
  if (seenKeys.has(event.key)) {
    errors.push(
      `${path}.key: duplicate event key ${fmt(event.key)} (first declared at events[${seenKeys.get(event.key)}])`,
    )
  } else {
    seenKeys.set(event.key, index)
  }
  // Events and plots share ONE namespace: compute returns one column per
  // plot/event key (spec §4), so a collision means two producers of one array.
  if (plotKeys.has(event.key)) {
    errors.push(
      `${path}.key: ${fmt(event.key)} collides with plots[${plotKeys.get(event.key)}].key — ` +
      `plots and events share one column namespace, so the key can only belong to one of them`,
    )
  }
  if (event.label !== undefined && typeof event.label !== 'string') {
    errors.push(`${path}.label: expected a string, got ${fmt(event.label)}`)
  }
}

// ─── The entry point ─────────────────────────────────────────────────────────

/**
 * Validate an indicator definition and return it with `$<inputKey>` references
 * resolved.
 *
 * PURE. No I/O, no clock, no globals, and it never throws — a malformed
 * definition is DATA about a problem, not an exception, because this runs on the
 * registration path where one bad catalog entry must not take down the chart.
 *
 * On success the returned `def` is a DEEP CLONE of the argument (the caller's
 * object is never mutated) with:
 *   - `plots[].color` / `.width` / `.levels` substituted from input defaults,
 *   - every other field — including unknown ones — preserved verbatim.
 *
 * No key is invented on the way out: a definition that omitted `events` gets no
 * `events: []` bolted on, so a round-trip is a round-trip.
 *
 * @param {unknown} def
 * @returns {{ok: true, def: object} | {ok: false, errors: string[]}}
 */
/**
 * Resolve every `source` input's default against the REGISTRY.
 *
 * Separate from `validateDefinition` because it is the one check that is not a
 * pure function of a single definition: `'rsi.rsi'` is valid or invalid
 * depending on what else is registered. `validateDefinition` stayed
 * registry-free (it runs before anything is registered, including on the
 * definition being registered), so this is the second pass a registry runs once
 * every definition's columns are known. B2 Task 2 carry-in (b).
 *
 * A `source` naming a column that does not exist is the same class of failure as
 * an unresolvable `$ref`: the indicator computes over SOMETHING, and letting it
 * quietly fall back to `close` would change the numbers an alert fires on.
 *
 * @param {object} def — an already-validated definition.
 * @param {(defId: string) => string[]|null} resolveColumns — the column keys a
 *        definition returns, or null when that definition is unknown.
 * @returns {string[]} errors (empty when every referent resolves).
 */
export function validateSourceReferents(def, resolveColumns) {
  const errors = []
  const inputs = Array.isArray(def?.inputs) ? def.inputs : []

  inputs.forEach((input, i) => {
    if (!isPlainObject(input) || input.type !== 'source') return
    const path = `inputs[${i}].default`
    const ref = input.default
    if (!isNonEmptyString(ref)) return   // already reported by validateDefinition

    if (SOURCE_BAR_FIELDS.includes(ref)) return

    const dot = ref.indexOf('.')
    if (dot < 0) {
      errors.push(
        `${path}: source ${fmt(ref)} is neither a bar field (${list(SOURCE_BAR_FIELDS)}) nor a ` +
        `"defId.plotKey" handle — a source that resolves to nothing would silently compute over the wrong series`,
      )
      return
    }

    const defId = ref.slice(0, dot)
    const plotKey = ref.slice(dot + 1)
    const columns = resolveColumns ? resolveColumns(defId) : null
    if (!Array.isArray(columns)) {
      errors.push(
        `${path}: source ${fmt(ref)} names definition ${fmt(defId)}, which is not registered`,
      )
      return
    }
    if (!columns.includes(plotKey)) {
      errors.push(
        `${path}: source ${fmt(ref)} names column ${fmt(plotKey)}, which definition ${fmt(defId)} ` +
        `does not declare (its columns: ${list(columns) || 'none'})`,
      )
    }
  })

  return errors
}

export function validateDefinition(def) {
  try {
    const errors = []

    if (!isPlainObject(def)) {
      return { ok: false, errors: [`definition: expected an object, got ${fmt(def)}`] }
    }

    // Work on a clone from the first line: substitution WRITES, and mutating the
    // caller's object would make this function impure and the failure path
    // destructive (a rejected definition would come back half-substituted).
    const out = deepClone(def)

    // ─ identity ─
    if (out.schemaVersion !== SCHEMA_VERSION) {
      errors.push(
        `schemaVersion: expected ${SCHEMA_VERSION}, got ${fmt(out.schemaVersion)} — ` +
        `this client cannot safely interpret another schema major`,
      )
    }
    if (!isNonEmptyString(out.id)) {
      errors.push(`id: required non-empty string (the stable handle), got ${fmt(out.id)}`)
    } else if (!ID_RE.test(out.id)) {
      errors.push(
        `id: ${fmt(out.id)} is not a legal definition id — must match ${ID_RE} ` +
        `(no dots: plots are addressed as "${out.id}.<plotKey>")`,
      )
    }
    // Presentation version. Alerts/screens/ledger pin against `defId@version`
    // freely (spec §3.1), so it must be orderable.
    if (!Number.isInteger(out.version) || out.version < 1) {
      errors.push(`version: required integer >= 1 (the presentation version), got ${fmt(out.version)}`)
    }

    validateCompute(out.compute, errors)
    validateMeta(out.meta, errors)
    validatePlacement(out.placement, errors)

    // ─ inputs ─
    const inputsByKey = new Map()
    const inputKeyIndex = new Map()
    if (out.inputs !== undefined && !Array.isArray(out.inputs)) {
      errors.push(`inputs: expected an array, got ${fmt(out.inputs)}`)
    }
    const inputs = Array.isArray(out.inputs) ? out.inputs : []
    inputs.forEach((input, i) => validateInput(input, i, inputKeyIndex, errors))
    // Built from every input that declared a usable key, INCLUDING ones that
    // failed another check — so a bad `type` yields one error, not that plus a
    // cascade of bogus "unresolvable $ref" noise pointing at the same input.
    inputs.forEach((input) => {
      if (isPlainObject(input) && isNonEmptyString(input.key) && !inputsByKey.has(input.key)) {
        inputsByKey.set(input.key, input)
      }
    })
    inputs.forEach((input, i) => validateActiveWhen(input, i, inputsByKey, errors))

    // ─ plots (substitution happens here, in-place on the clone) ─
    const plotKeyIndex = new Map()
    if (out.plots !== undefined && !Array.isArray(out.plots)) {
      errors.push(`plots: expected an array, got ${fmt(out.plots)}`)
    }
    const plots = Array.isArray(out.plots) ? out.plots : []
    plots.forEach((plot, i) => validatePlot(plot, i, plotKeyIndex, inputsByKey, errors))

    // ─ events ─
    const eventKeyIndex = new Map()
    if (out.events !== undefined && !Array.isArray(out.events)) {
      errors.push(`events: expected an array, got ${fmt(out.events)}`)
    }
    const events = Array.isArray(out.events) ? out.events : []
    events.forEach((event, i) => validateEvent(event, i, eventKeyIndex, plotKeyIndex, errors))

    // ─ cross-section checks ─
    validateColorModes(plots, new Set([...plotKeyIndex.keys(), ...eventKeyIndex.keys()]), errors)
    validateBandEdges(plots, errors)

    // A definition with no plots and no events returns no columns: it computes
    // something and hands it to nobody. Far more often this is a `plots` array
    // lost in transit than a deliberate choice.
    if (plots.length === 0 && events.length === 0) {
      errors.push(
        `plots: a definition must declare at least one plot or one event — ` +
        `with neither it produces no columns and renders nothing`,
      )
    }

    if (errors.length) return { ok: false, errors }
    return { ok: true, def: out }
  } catch (err) {
    // The contract is "never throws". A defect in this validator must surface as
    // a rejected definition, not as an exception that takes the chart with it.
    return {
      ok: false,
      errors: [`definition: validator raised unexpectedly (${err && err.message ? err.message : String(err)})`],
    }
  }
}

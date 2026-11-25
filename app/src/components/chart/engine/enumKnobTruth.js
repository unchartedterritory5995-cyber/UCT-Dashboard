// app/src/components/chart/engine/enumKnobTruth.js
//
// ─── ⭐⭐ e97 U8 — IS AN ENUM SETTING TRUE? ─────────────────────────────────────────────────────────────────────────
//
// A member's enum setting (an `input.string(…, options = [...])` the door declares) is TRUE when:
//   (1) it MOVES SOMETHING: at some option other than the default, a computed column or the set of plots shown differs
//       from the default's; and
//   (2) what it moves is THE SCRIPT'S OWN ANSWER: at every option, the columns and the shown set equal those of the same
//       script with that option written as the input's default (the literal program).
//
// ⚰️ The built-in MA family's "Type" moved only what was SHOWN: the smoothing switch sat behind a helper parameter, the
// knob never reached it, and picking EMA drew the SMA under the member's choice. This checker is the class rail
// (coordinator ruling, e97): `enumKnobTruth.test.js` asks it of every enum setting a fixture script offers.
//
// Test-side only: it evaluates documents (`astColumnsGiven`) over the bars it is handed.

import { memberPaneDefinition } from '../builder/memberPane/memberPaneDefinition'
import { astColumnsGiven } from './astColumns.js'
import { plotHiddenAt } from './knobBind.js'
import { resolveInputs, treeScalars } from './knobInputs.js'

/** The script with input `name` replaced by the plain text `option` (`name = "<option>"`): the LITERAL program, which
 *  no knob reaches (its `switch` folds the way a fixed string always did), so the comparison is independent of the
 *  knob machinery it checks (a call continued over lines is taken whole). Null when the declaration is not found. */
export function withLiteralOption(source, name, option) {
  const at = new RegExp(`(^|\\n)([ \\t]*(?:var[ \\t]+)?(?:string[ \\t]+)?)${name}([ \\t]*=[ \\t]*)input(?:\\.string)?[ \\t]*\\(`)
  const m = at.exec(source)
  if (!m) return null
  // the call's own closing parenthesis, strings skipped
  let i = m.index + m[0].length
  let depth = 1
  let q = null
  const BACKSLASH = String.fromCharCode(92)
  for (; i < source.length && depth > 0; i += 1) {
    const ch = source[i]
    if (q) { if (ch === BACKSLASH) i += 1; else if (ch === q) q = null; continue }
    if (ch === '"' || ch === "'") q = ch
    else if (ch === '(') depth += 1
    else if (ch === ')') depth -= 1
  }
  if (depth !== 0) return null
  const text = JSON.stringify(option)
  return source.slice(0, m.index) + m[1] + m[2] + name + m[3] + text + source.slice(i)
}

const same = (a, b) => (Number.isNaN(a) && Number.isNaN(b)) || a === b
  || (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)))

/** What one document draws at `inputs`: each plot's column (by label, then key) and whether it is shown. */
function picture(def, bars, inputs) {
  // the binder's own constants: the stored inputs over the declared defaults, a text option read as its index
  const cols = astColumnsGiven(def, bars, treeScalars(def, resolveInputs(def, inputs || {})), { tf: '1D' }, null)
  const out = new Map()
  for (const p of def.plots || []) {
    // the member's own plots, by the name they read; a helper row (no label, or one named by its key) is not one
    if (!p || p.style === 'hlines' || !p.label || /^(value|out\d+)$/.test(p.label)) continue
    const name = p.label
    if (out.has(name)) continue
    const col = cols && cols[p.key]
    out.set(name, { shown: !plotHiddenAt(p, def, inputs), values: col ? Array.from(col) : null })
  }
  return out
}

function differ(a, b) {
  const why = []
  for (const [name, x] of a) {
    const y = b.get(name)
    if (!y) { why.push(`${name}: only one side has it`); continue }
    if (x.shown !== y.shown) why.push(`${name}: shown ${x.shown} against ${y.shown}`)
    if (!x.values !== !y.values) { why.push(`${name}: a column on one side only`); continue }
    if (x.values && (x.values.length !== y.values.length || x.values.some((v, i) => !same(v, y.values[i])))) {
      const i = x.values.findIndex((v, k) => !same(v, y.values[k]))
      why.push(`${name}: values differ (first at bar ${i}: ${x.values[i]} against ${y.values[i]})`)
    }
  }
  for (const name of b.keys()) if (!a.has(name)) why.push(`${name}: only one side has it`)
  return why
}

/**
 * Every enum setting the door declares for `source`, checked: `[{key, options, moves, untrue: [{option, context, why}]}]`.
 * Checked in two CONTEXTS: the defaults, and every yes/no setting (an `int` 0 / 1, as the door declares a bool) turned
 * ON, because a setting can be gated by a toggle that is off at the defaults (`enableMA ? ma(len, type) : na`).
 * `moves` is the options (other than the default) whose picture differs from the default's in some context; `untrue`
 * the options whose picture differs from the literal program's (with the same context) in some context. Where this
 * engine refuses the literal program, the setting must refuse there too (a plot the default draws has no column).
 * `definition` checks that document instead of the door's (a control hands in a doctored one).
 */
export function enumKnobTruth(source, bars, { definition = null } = {}) {
  const r = definition ? { ok: true, definition } : memberPaneDefinition({ source })
  if (!r.ok) return { ok: false, reason: r.reason, knobs: [] }
  const def = r.definition
  const toggles = (def.inputs || []).filter((s) => s && s.type === 'int' && (s.default === 0 || s.default === 1)
    && s.min === undefined && s.max === undefined && !/width$/i.test(s.key))
  const contexts = [{ name: 'defaults', inputs: {} },
    { name: 'toggles on', inputs: Object.fromEntries(toggles.map((s) => [s.key, 1])) }]
  const knobs = []
  for (const spec of def.inputs || []) {
    if (!spec || spec.type !== 'enum' || !Array.isArray(spec.options)) continue
    const moves = new Set()
    const untrue = []
    const literal = new Map()
    const refusedLiterally = new Map()
    const refusedAlike = new Set()
    for (const option of spec.options) {
      const literalSource = withLiteralOption(source, spec.key, option)
      if (literalSource === null) { untrue.push({ option, context: null, why: ['the literal program could not be written'] }); continue }
      const lit = memberPaneDefinition({ source: literalSource })
      // a literal program this engine refuses must be refused AT THAT OPTION too, by name: some plot the default
      // draws has no column there (the knob's refusing leaf, `refusedArm`), never a value the script does not compute
      if (!lit.ok) { refusedLiterally.set(option, lit.reason); continue }
      literal.set(option, lit.definition)
    }
    for (const ctx of contexts) {
      const atDefault = picture(def, bars, ctx.inputs)
      for (const option of spec.options) {
        const mine = picture(def, bars, { ...ctx.inputs, [spec.key]: option })
        if (option !== spec.default && differ(atDefault, mine).length) moves.add(option)
        if (refusedLiterally.has(option)) {
          // (a refusal a gate prunes away in one context, `enableMA ? ma(…) : na` with the gate off, is not reached there:
          // the option must refuse in SOME context)
          const withheld = [...atDefault].filter(([n, x]) => x.values && mine.get(n) && !mine.get(n).values).map(([n]) => n)
          if (withheld.length) refusedAlike.add(option)
          continue
        }
        const litDef = literal.get(option)
        if (!litDef) continue
        // the literal program's own toggles, set as the context sets them (it declares the same keys)
        const why = differ(mine, picture(litDef, bars, ctx.inputs))
        if (why.length) untrue.push({ option, context: ctx.name, why })
      }
    }
    for (const [option, why] of refusedLiterally) {
      if (option !== spec.default && !refusedAlike.has(option)) {
        untrue.push({ option, context: null, why: [`the literal program is refused (${why}) but the setting computes every plot there, in every context`] })
      }
    }
    knobs.push({ key: spec.key, options: spec.options.slice(), default: spec.default, moves: [...moves], refusedAlike: [...refusedAlike], untrue })
  }
  return { ok: true, knobs }
}

/** Deterministic daily bars: a seeded walk with volume, enough history for every window the fixtures read. */
export function walkBars(n = 320, seed = 7) {
  let s = seed
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648 }
  const out = []
  let c = 100
  for (let i = 0; i < n; i += 1) {
    const o = c
    c = Math.max(1, c + (rnd() - 0.48) * 3)
    const h = Math.max(o, c) + rnd() * 1.5
    const l = Math.min(o, c) - rnd() * 1.5
    out.push({ t: Date.UTC(2024, 0, 2) / 1000 + i * 86400, o, h, l, c, v: Math.round(1000 + rnd() * 9000) })
  }
  return out
}

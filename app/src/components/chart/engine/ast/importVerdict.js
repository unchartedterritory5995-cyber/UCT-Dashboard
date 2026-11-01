// app/src/components/chart/engine/ast/importVerdict.js
//
// ─── ⭐⭐ I2 — ONE HONEST IMPORT VERDICT, IN FOUR CLASSES ────────────────────
//
// Milestone I2 "Honest Imports", owner-approved 2026-11-01. This module answers
// one question for a member who pasted a script: "what will differ from the
// platform I copied this from?" — in four classes, from the lane that will
// actually run the import:
//
//   values      can a number the import computes differ from the vendor's?
//   visuals     is anything drawn differently, or not drawn?
//   inputs      can every input still be changed the way the vendor allows?
//   behaviour   alerts, orders, repainting — does it ACT differently?
//
// ⛔ IT WRAPS `importOutcome.js`, IT DOES NOT REPLACE IT. `importOutcome` stays the
// one reader of the translators' results (refusals, notes, vendor notes, object
// loss). This module re-sorts that same evidence into the four classes and adds
// three rules `importOutcome` does not apply:
//
//   1. A CLOSED NOTE REGISTRY. Every ignored-line code a translator emits is
//      listed in `NOTE_REGISTRY` with its class. A code that is NOT listed is
//      treated as "values may differ" and named in `unregistered` — never as
//      presentation-only. (`importOutcome` files an unknown code as PRESENTATION,
//      which is how "the values are the same" got printed over an import whose
//      values differed — audit P0-2/P0-7.)
//   2. "EXACT" NEEDS EVIDENCE. A thinkScript or TC2000 import is translated from
//      the vendor's PUBLISHED definitions; no vendor value has been captured for
//      either, so neither can be called exact. Their best verdict is
//      `no-known-differences`, which says so. The engine's own formula language
//      is not an import, so `exact` stands there.
//   3. THE LANE THAT ACTS. thinkScript, TC2000 and native formulas have ONE lane:
//      the saved tree is what the chart, the screen and the alert all run, so
//      the verdict of that tree is the verdict of every consumer. Pine has two
//      lanes (chart and scan); its verdict belongs to the Pine workstream and is
//      passed through UNCHANGED here (`pine: 'passthrough'`) until that
//      workstream adopts this contract.
//
// ⛔ PURE, NEVER THROWS, AND WRITES NOTHING. It computes on read: a saved
// definition is never stamped, migrated or re-derived by this module.

import { importOutcome, OUTCOME, OUTCOME_LABEL, SEVERITY } from './importOutcome.js'
import { NOTES as THINKSCRIPT_NOTES } from './thinkscript.js'

export const VERDICT_CONTRACT = 'import-verdict/1'

export const CLASS = Object.freeze({
  VALUES: 'values',
  VISUALS: 'visuals',
  INPUTS: 'inputs',
  BEHAVIOUR: 'behaviour',
})
export const CLASSES = Object.freeze([CLASS.VALUES, CLASS.VISUALS, CLASS.INPUTS, CLASS.BEHAVIOUR])

/** One class's state, worst last. */
export const STATE = Object.freeze({
  SAME: 'same',               // nothing known to differ
  MAY_DIFFER: 'may-differ',   // something the registry cannot vouch for
  DIFFERS: 'differs',         // a recorded, disclosed difference
  MISSING: 'missing',         // part of the script was not imported
})
const STATE_RANK = Object.freeze({ same: 0, 'may-differ': 1, differs: 2, missing: 3 })

/** The verdicts. `importOutcome`'s five, plus the honest one between
 *  "disclosed" and "exact" for a translation with no vendor evidence. */
export const VERDICT = Object.freeze({
  ...OUTCOME,
  NO_KNOWN_DIFFERENCES: 'no-known-differences',
})
export const VERDICT_LABEL = Object.freeze({
  ...OUTCOME_LABEL,
  'no-known-differences': 'Imported, no known differences',
})

/** The dialects whose verdict this module decides. Pine is passed through. */
export const DECIDED_DIALECTS = Object.freeze(['thinkscript', 'pcf', 'formula'])

/** The vendor a dialect was copied from — the name a sentence uses. */
const VENDOR = Object.freeze({ thinkscript: 'thinkorswim', pcf: 'TC2000' })

/** ⭐⭐ THE CLOSED REGISTRY of ignored-line codes, with the class each touches.
 *  `null` class = informational: nothing differs. A code absent from this table
 *  is "values may differ" — the conservative direction.
 *
 *  ⛔ `thinkscript:note-chrome` is decided PER LINE (`chromeClass`): a chart
 *  decoration is a visual difference, an `Alert`/`Assert` line is behaviour. */
export const NOTE_REGISTRY = Object.freeze({
  'thinkscript:note-endash': null,
  'thinkscript:note-seed': CLASS.VALUES,
  'thinkscript:note-warmup': CLASS.VALUES,
  'thinkscript:note-declare': CLASS.VISUALS,
  'thinkscript:note-chrome': CLASS.VISUALS,
})

/** thinkScript chrome lines that ACT rather than draw. Keyed by the lower-cased
 *  last segment of the note's `token` (`Alert`, `foo.Assert` → `alert`, `assert`). */
const BEHAVIOUR_CHROME = Object.freeze(new Set(['alert', 'assert']))

function chromeClass(note) {
  const tok = note && typeof note.token === 'string' ? note.token : ''
  const last = tok.slice(tok.lastIndexOf('.') + 1).trim().toLowerCase()
  return BEHAVIOUR_CHROME.has(last) ? CLASS.BEHAVIOUR : CLASS.VISUALS
}

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k)
const isObj = (v) => !!v && typeof v === 'object'

function treeHas(ast, pred) {
  const stack = [ast]
  while (stack.length) {
    const n = stack.pop()
    if (!isObj(n)) continue
    if (pred(n)) return true
    if (Array.isArray(n.args)) for (const a of n.args) stack.push(a)
  }
  return false
}

const PERIOD_READ = (n) => n.type === 'tf' || n.type === 'tf_live'

/** True when a `call` or `offset` node (not itself a period read) has a period
 *  read somewhere beneath it — audit PA1 §2.2 signature P2, subtree form. */
export function windowOverPeriodRead(ast) {
  const stack = [ast]
  while (stack.length) {
    const n = stack.pop()
    if (!isObj(n)) continue
    if (PERIOD_READ(n)) continue // a read's own subtree is already in its period
    if ((n.type === 'call' || n.type === 'offset') && Array.isArray(n.args)
      && n.args.some((a) => treeHas(a, PERIOD_READ))) return true
    if (Array.isArray(n.args)) for (const a of n.args) stack.push(a)
  }
  return false
}

function outputName(out, i) {
  return (out && (out.title || out.handle)) || `the output on line ${out && out.line != null ? out.line : i + 1}`
}

function freshClasses() {
  const c = {}
  for (const k of CLASSES) c[k] = { state: STATE.SAME, notes: [] }
  return c
}

function mark(classes, cls, state, entry) {
  const slot = classes[cls]
  if (STATE_RANK[state] > STATE_RANK[slot.state]) slot.state = state
  if (entry && !slot.notes.some((n) => n.name === entry.name && n.note === entry.note)) {
    slot.notes.push({ name: entry.name, note: entry.note, line: entry.line ?? null })
  }
}

/** The sentence a `no-known-differences` verdict carries — never "exact", and it
 *  names what was NOT done. */
function noKnownReason(dialect) {
  return `translated from ${VENDOR[dialect]}’s published definitions; no difference is known, `
    + `but these values have not been compared against ${VENDOR[dialect]}’s own`
}

/**
 * The four-class verdict for an `inspectSource` report.
 *
 * @param {object|null} report  `PineBox.inspectSource`'s result (or `null`).
 * @returns {{contract, dialect, lane, decidedBy, verdict, label, reason,
 *   classes: Record<'values'|'visuals'|'inputs'|'behaviour', {state, notes}>,
 *   unregistered: string[], outcome: object}}
 */
export function importVerdict(report) {
  const outcome = report && report.outcome ? report.outcome : importOutcome(report)
  const dialect = report && report.dialect ? report.dialect : null
  const base = {
    contract: VERDICT_CONTRACT,
    dialect,
    outcome,
    classes: freshClasses(),
    unregistered: [],
  }
  try {
    // ── Pine: two lanes, owned by the Pine workstream. Unchanged. ─────────────
    if (!DECIDED_DIALECTS.includes(dialect)) {
      return {
        ...base,
        lane: null,
        decidedBy: 'passthrough',
        verdict: outcome.verdict,
        label: outcome.label,
        reason: outcome.reason,
      }
    }

    const classes = base.classes
    const unregistered = base.unregistered
    const outputs = report && Array.isArray(report.outputs) ? report.outputs : []

    // 1. Missing outputs: whatever `importOutcome` already found missing.
    for (const m of outcome.missing || []) {
      mark(classes, CLASS.VALUES, STATE.MISSING, { name: m.name, note: m.message })
    }

    // 2. Per usable output: vendor notes, presentation, inputs, repainting.
    outputs.forEach((out, i) => {
      if (!out || !out.formula || out.hidden) return
      if (out.downstream && out.downstream.ok === false) return
      const name = outputName(out, i)
      for (const v of out.vendorNotes || []) {
        // `importOutcome` reads every vendor note but `alertcondition` as semantic.
        if (v && v.name === 'alertcondition') continue
        mark(classes, CLASS.VALUES, STATE.DIFFERS, { name: v.name, note: v.note, line: out.line })
      }
      const pres = out.presentation || {}
      if (pres.colorDynamic) {
        mark(classes, CLASS.VISUALS, STATE.DIFFERS, { name, note: 'its colour changes bar by bar in the script and is drawn in one colour here', line: out.line })
      }
      if (pres.styleUncarried) {
        mark(classes, CLASS.VISUALS, STATE.DIFFERS, { name, note: `its style \`${pres.styleUncarried}\` is not carried`, line: out.line })
      }
      const fixed = Array.isArray(out.fixedInputs) ? out.fixedInputs : []
      const pasted = Array.isArray(out.pasteInputs) ? out.pasteInputs : []
      const frozen = fixed.length + pasted.length
      if (frozen > 0) {
        mark(classes, CLASS.INPUTS, STATE.DIFFERS, {
          name,
          note: `${frozen} input${frozen === 1 ? ' is' : 's are'} set when the script is pasted and cannot be changed afterwards without importing it again`,
          line: out.line,
        })
      }
      const ast = (out.downstream && out.downstream.ast) || out.ast
      // ⛔ AUDIT P0-2, SHAPE P2: in a thinkScript import, a window or a bar offset
      // applied OUTSIDE a weekly/monthly read runs on DAILY bars, while
      // thinkorswim runs it on weekly/monthly ones. Until the period lift
      // (Workstream 1) moves the window inside the read, that output's values are
      // not thinkorswim's, and the verdict must not say otherwise. After the lift
      // the shape no longer occurs, so this rule then fires on nothing.
      if (dialect === 'thinkscript' && ast && windowOverPeriodRead(ast)) {
        mark(classes, CLASS.VALUES, STATE.MAY_DIFFER, {
          name,
          note: 'an average, high/low, sum or [n] over a weekly or monthly value is computed on daily bars here, so it may not match thinkorswim',
          line: out.line,
        })
      }
      if (ast && treeHas(ast, (n) => n.type === 'tf_live')) {
        mark(classes, CLASS.BEHAVIOUR, STATE.DIFFERS, {
          name,
          note: 'it reads a weekly or monthly value that keeps changing until that period closes, so a past alert or signal can move (may repaint)',
          line: out.line,
        })
      }
    })

    // 3. The TC2000 XUP/XDOWN boundary note `importOutcome` adds by tree shape.
    for (const s of outcome.semantic || []) {
      if (s && s.name === 'XUP / XDOWN') mark(classes, CLASS.VALUES, STATE.DIFFERS, s)
    }

    // 4. Ignored lines, through the CLOSED registry.
    for (const n of (report && report.ignored) || []) {
      if (!n) continue
      const where = n.line != null ? `line ${n.line}` : 'this script'
      if (!n.code || !own(NOTE_REGISTRY, n.code)) {
        unregistered.push(n.code || '(no code)')
        mark(classes, CLASS.VALUES, STATE.MAY_DIFFER, { name: where, note: n.message || 'a line this engine did not classify', line: n.line })
        continue
      }
      let cls = NOTE_REGISTRY[n.code]
      if (n.code === 'thinkscript:note-chrome') cls = chromeClass(n)
      if (cls === null) continue
      mark(classes, cls, STATE.DIFFERS, { name: where, note: n.message, line: n.line })
    }

    // ⚠️ Object-program loss and withheld paints (`importOutcome` steps 3) are Pine
    // concepts — no decided dialect produces `objects` or `paints` — so they are not
    // re-sorted here. If a decided dialect ever grows them, `importOutcome` still
    // files them as missing/presentation and the rail below that pins "no decided
    // dialect emits objects" goes red first.

    // ── The verdict, from the classes. ─────────────────────────────────────────
    const lane = 'ast'
    if (outcome.verdict === OUTCOME.ERROR || outcome.verdict === OUTCOME.UNSUPPORTED) {
      return { ...base, lane, decidedBy: 'i2', verdict: outcome.verdict, label: outcome.label, reason: outcome.reason }
    }
    const states = CLASSES.map((k) => classes[k].state)
    let verdict
    if (classes.values.state === STATE.MISSING || outcome.verdict === OUTCOME.PARTIAL) verdict = VERDICT.PARTIAL
    else if (states.some((s) => s !== STATE.SAME)) verdict = VERDICT.DISCLOSED
    else if (dialect === 'formula') verdict = VERDICT.EXACT
    else verdict = VERDICT.NO_KNOWN_DIFFERENCES

    let reason
    if (verdict === VERDICT.PARTIAL) reason = outcome.reason
    else if (verdict === VERDICT.DISCLOSED) reason = disclosedReason(classes)
    else if (verdict === VERDICT.NO_KNOWN_DIFFERENCES) reason = noKnownReason(dialect)
    else reason = null
    return { ...base, lane, decidedBy: 'i2', verdict, label: VERDICT_LABEL[verdict], reason }
  } catch (e) {
    // ⛔ Never the thing that breaks the box.
    return {
      ...base,
      lane: null,
      decidedBy: 'i2',
      verdict: VERDICT.ERROR,
      label: VERDICT_LABEL.error,
      reason: `the import verdict could not be computed: ${String((e && e.message) || e)}`,
    }
  }
}

const CLASS_PHRASE = Object.freeze({
  values: { differs: 'values can differ', 'may-differ': 'values may differ' },
  visuals: { differs: 'some of it is drawn differently' },
  inputs: { differs: 'some inputs are fixed at paste time' },
  behaviour: { differs: 'alerts or signals behave differently' },
})

/** ⛔ NEVER "the values are the same" unless the VALUES class is `same`. */
function disclosedReason(classes) {
  const parts = []
  for (const k of CLASSES) {
    const s = classes[k].state
    if (s === STATE.SAME) continue
    const phrase = CLASS_PHRASE[k][s] || CLASS_PHRASE[k].differs
    if (phrase && !parts.includes(phrase)) parts.push(phrase)
  }
  if (classes.values.state === STATE.SAME) parts.push('the values are the same')
  return parts.join('; ')
}

/** The severity `importOutcome` would give a class's notes — so a renderer that
 *  still sorts by severity reads the same thing. */
export function severityOfClass(cls) {
  return cls === CLASS.VALUES || cls === CLASS.BEHAVIOUR ? SEVERITY.SEMANTIC : SEVERITY.PRESENTATION
}

/** Every thinkScript note code the translator declares — the set the registry
 *  must close over. Exported for the rail. */
export const THINKSCRIPT_NOTE_CODES = Object.freeze(Object.keys(THINKSCRIPT_NOTES))

/**
 * ⭐ READ-TIME VERDICT FOR A SAVED DEFINITION. Recomputed on read from what the
 * definition already stores; it never writes, stamps or migrates.
 *
 *  - Pine provenance (`meta.importedFrom.dialect === 'pine'`) → `null`: Pine's.
 *  - A TC2000 source (the stored `compute.source` reads as PCF) → recomputed.
 *  - Anything else → `null`. A native formula is not an import, and a thinkScript
 *    paste is SAVED as native text with no marker (audit PA1 §2.2), so no import
 *    claim — exact or otherwise — can honestly be made for it on read.
 *
 * @param {object} definition  a stored definition document
 * @param {{inspect: (source: string, dialect: string) => object, detect: (source: string) => string}} deps
 */
export function savedImportVerdict(definition, deps) {
  try {
    if (!isObj(definition) || !deps) return null
    const imp = definition.meta && definition.meta.importedFrom
    if (imp && imp.dialect === 'pine') return null
    const source = definition.compute && definition.compute.source
    if (typeof source !== 'string' || !source.trim()) return null
    if (deps.detect(source) !== 'pcf') return null
    return importVerdict(deps.inspect(source, 'pcf'))
  } catch {
    return null
  }
}

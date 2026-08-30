// app/src/components/chart/builder/libraryIntake.js
//
// ─── ⭐⭐ BRING YOUR LIBRARY: WHAT HAPPENS TO ALL FORTY OF YOUR SCRIPTS ───────
//
// A member arrives with years of accumulated work — that accumulation IS the
// switching cost, and it is the whole reason this platform exists. Today they
// discover the answer ONE PASTE AT A TIME, which means they meet their third
// refusal before they have seen a single chart draw, and they never learn the true
// answer because nothing can compute it for them.
//
// ⛔⛔ FOUR REACHES, NEVER ONE NUMBER. Translating is not computing, computing is
// not saveable, and saveable is not screenable — this repo measured all four and
// they differ: 41 scripts translate, 41 compute, 41 save, and only 19 screen as
// written. A single blended headline would be US COMPUTING A MARKETING CLAIM ABOUT
// THEIR WORK, at the moment of maximum doubt, and it would be the one thing this
// engine exists not to do: a plausible number that is answering a different
// question. Every reach is reported separately or not at all.
//
// ⭐ AND A REFUSED SCRIPT STILL HANDS BACK WHAT CAME ACROSS. A script with six plots
// where one refuses is not a failure, and reporting it as one is both wrong and
// discouraging. `partial` carries the outputs that DID translate.
//
// ⚠️ THE SPLIT IS A HEURISTIC AND SAYS SO. Pine files open with `//@version=N`, but
// MEASURED ON THE COMMITTED CORPORA only 20 of 21 and 21 of 30 carry one — so
// splitting a paste on that marker silently GLUES a script with no header onto the
// one above it. The splitter reports how it split and how many it found, so a
// member who pasted twelve and is shown nine can see that immediately. Separate
// FILES are unambiguous and are the better door; the paste is the convenient one.

import { translatePine } from '../engine/ast/pine'
import { translateThinkScript } from '../engine/ast/thinkscript'
import { detectDialect } from '../engine/ast/dialect'
import { evaluateFormula, canSaveFormula } from './FormulaField'
import { BUILDER_INPUT_SCOPE } from './builderInputs'
import { parseFormula } from '../engine/ast/parse'
import { treeYieldsBool } from '../engine/ast/pine'
import { conditionFrom } from './toCondition'
import { foreignLanguage, foreignRefusal } from '../engine/ast/foreignLanguage'

/** Pine's own file header. The only marker any of these languages guarantees. */
const VERSION_MARKER = /^\s*\/\/\s*@version\s*=/m

/**
 * Split a paste into candidate scripts.
 *
 * @returns {{scripts: string[], how: 'version-marker'|'whole', found: number}}
 */
export function splitPaste(text) {
  const source = typeof text === 'string' ? text : ''
  if (source.trim() === '') return { scripts: [], how: 'whole', found: 0 }

  const lines = source.split('\n')
  const starts = []
  for (let i = 0; i < lines.length; i += 1) {
    if (VERSION_MARKER.test(lines[i])) starts.push(i)
  }
  // ⛔ TWO OR MORE, NOT ONE. A single marker means one script with a header, not a
  // boundary — splitting there would hand back an empty first chunk.
  if (starts.length < 2) return { scripts: [source], how: 'whole', found: 1 }

  const scripts = []
  for (let s = 0; s < starts.length; s += 1) {
    const from = s === 0 ? 0 : starts[s]
    const to = s + 1 < starts.length ? starts[s + 1] : lines.length
    const chunk = lines.slice(from, to).join('\n')
    if (chunk.trim() !== '') scripts.push(chunk)
  }
  return { scripts, how: 'version-marker', found: scripts.length }
}

const TRANSLATORS = { pine: translatePine, thinkscript: translateThinkScript }

/**
 * One script, measured through the SHIPPED doors — never a re-derivation.
 *
 * ⛔ EACH REACH ASKS THE DOOR THAT ACTUALLY DECIDES IT. `translatePine` is the
 * importer, `evaluateFormula` and `canSaveFormula` are what `BuilderSheet` itself
 * calls, and `treeYieldsBool` is the question the scan gate asks. Anything else
 * here would report a verdict the product does not honour.
 */
export function inspectScript(source, name = null) {
  const dialect = detectDialect(source)
  const translate = TRANSLATORS[dialect]
  const row = {
    name,
    dialect,
    translates: false,
    computes: false,
    saves: false,
    // ⭐ THREE STATES, NOT A BOOLEAN. "no" and "yes once you say what you are
    // looking for" are different answers to a member, and collapsing them would
    // under-report this product by more than half.
    screens: 'no',
    needsAcknowledgement: false,
    refusal: null,
    formula: null,
    partial: [],
    foreign: null,
  }
  // ⛔⛔ NAME WHAT THIS ACTUALLY IS BEFORE BLAMING A LANGUAGE THE MEMBER DID NOT
  // USE. Measured: MQL5, EasyLanguage and NinjaScript all detect as `pcf` (TC2000's
  // markers are loose by nature and every C-like program trips them), and Python
  // detects as `thinkscript` and is refused with "thinkorswim has no character like
  // this one" — a sentence that is FALSE about what was pasted. A member arriving
  // with MetaTrader being told TC2000 cannot parse it is a confident answer to a
  // question nobody asked, at the first moment of contact.
  const foreign = foreignLanguage(source)
  if (foreign) {
    row.dialect = 'foreign'
    row.foreign = foreign.name
    row.refusal = { guard: 'language', message: foreignRefusal(foreign) }
    return row
  }
  if (!translate) {
    row.refusal = { guard: 'dialect', message: 'this does not read as Pine, thinkScript or a TC2000 formula' }
    return row
  }

  let out
  try { out = translate(source) } catch (e) {
    // ⚠️ A DOOR THAT THROWS IS BROKEN, NOT REFUSING, and a library report is exactly
    // where that must not be laundered into "your script is unsupported".
    row.refusal = { guard: 'threw', message: String((e && e.message) || e) }
    return row
  }

  // ⭐ WHAT CAME ACROSS, EVEN FROM A SCRIPT THAT REFUSED.
  row.partial = (out.outputs || [])
    .filter((o) => o.formula && !o.hidden)
    .map((o) => o.formula)

  if (!out.ok) {
    row.refusal = out.refusal
      ? { guard: out.refusal.guard, message: out.refusal.message, line: out.refusal.line,
        column: out.refusal.column, excerpt: out.refusal.excerpt || null }
      : { guard: 'unknown', message: 'this script offered nothing to run' }
    return row
  }
  row.translates = true

  const selected = out.selected >= 0 ? (out.outputs || [])[out.selected] : null
  if (!selected || !selected.formula) return row
  row.formula = selected.formula

  const ev = evaluateFormula(selected.formula, BUILDER_INPUT_SCOPE)
  if (!ev.ok) {
    row.refusal = { guard: ev.guard || 'compute', message: ev.error || 'this column did not evaluate' }
    return row
  }
  row.computes = true

  if (canSaveFormula(ev, false)) row.saves = true
  else if (canSaveFormula(ev, true)) {
    row.saves = true
    row.needsAcknowledgement = true
  }

  // ⛔⛔ EVERY COLUMN, NOT THE SELECTED ONE. A member asking "can I scan with
  // this?" means the SCRIPT, and a script whose second plot is a condition scans
  // perfectly well. ⚰️ Measured against `doorScorecard.test.js` over the same
  // corpora this reported 17 where the scorecard reported 19 — two scripts whose
  // boolean column simply is not the one offered first. Two of our own measurements
  // disagreeing is how a number nobody can reconcile ends up on a marketing page.
  const anyBool = (out.outputs || []).some((o) => {
    if (!o.formula || o.hidden) return false
    const p = parseFormula(o.formula)
    try { return !!(p.ok && treeYieldsBool(p.ast)) } catch (e) { return false }
  })
  if (anyBool) row.screens = 'as-written'
  else if (conditionFrom(selected.formula, '>', 0).ok) row.screens = 'with-a-comparison'

  return row
}

/**
 * The whole library.
 *
 * ⛔ THE TOTALS ARE FOUR INDEPENDENT COUNTS AND A ROSTER, never a score. Each one
 * names a different question, and a member deciding whether to move needs all four.
 */
export function inspectLibrary(scripts) {
  const rows = (scripts || []).map((s, i) => (
    typeof s === 'string'
      ? inspectScript(s, `script ${i + 1}`)
      : inspectScript(s.source, s.name || `script ${i + 1}`)))
  return {
    rows,
    total: rows.length,
    translates: rows.filter((r) => r.translates).length,
    computes: rows.filter((r) => r.computes).length,
    saves: rows.filter((r) => r.saves).length,
    screensAsWritten: rows.filter((r) => r.screens === 'as-written').length,
    screensWithComparison: rows.filter((r) => r.screens === 'with-a-comparison').length,
    refused: rows.filter((r) => !r.translates).length,
    // ⭐ A ROSTER OF WHAT STOPPED THEM, so the answer is actionable rather than a
    // score. Counted by guard, because that is what a member can go and read about.
    byGuard: rows.filter((r) => !r.translates).reduce((acc, r) => {
      const g = (r.refusal && r.refusal.guard) || 'unknown'
      acc[g] = (acc[g] || 0) + 1
      return acc
    }, {}),
  }
}

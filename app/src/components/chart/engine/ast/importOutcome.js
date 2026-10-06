// app/src/components/chart/engine/ast/importOutcome.js
//
// ─── ⭐⭐ P0 0G/0I — WHAT AN IMPORT ACTUALLY DID, IN ONE WORD ─────────────────
//
// Every import — Pine, thinkScript, TC2000 PCF, or this engine's own formula —
// ends as EXACTLY ONE of:
//
//   EXACT        everything the script computes was imported and nothing differs.
//   DISCLOSED    "safe with disclosed differences": every output was imported, and
//                each way the result differs from the vendor's is listed.
//   PARTIAL      some of what the script computes was NOT imported; what is missing
//                is named.
//   UNSUPPORTED  nothing usable was imported; the reason is named.
//   ERROR        a controlled internal failure (the translator threw); nothing
//                was imported, and the member is told so rather than left with a
//                box that silently stopped answering.
//
// ⛔ THIS MODULE DECIDES NOTHING ABOUT TRANSLATION. It reads the results the
// translators already produce — `ok`, each output's `refusal` / `hidden` /
// `downstream`, the ignored-line notes (Pine `notes`, thinkScript `ignored`), the
// vendor and fold notes (`vendorNotes`), the object program's own loss counters
// (`objectLoss.js`) and the presentation the translator could not carry — and
// derives ONE verdict from them. It is pure, and it never throws.
//
// ⛔⛔ NEVER EXACT WHEN ANYTHING WAS DROPPED OR DIFFERS. Anything this module does
// not recognise is classified as a difference (PRESENTATION at least), never as
// informational: the fail-closed direction is the honest one.
//
// ⭐ NOTE SEVERITY (0I):
//   SEMANTIC      can change a VALUE or its TIME ALIGNMENT (an EMA seed, a warm-up
//                 length, a timeframe behaviour, a crossing boundary…). Shown
//                 without expanding anything.
//   PRESENTATION  changes what is DRAWN or what can be adjusted, never a value of an
//                 imported output (a label, a colour, `show_last`, a drawing, a line
//                 no imported output reads). May stay collapsed.
//   INFO          nothing differs (the declaration line, an alert routed to Alerts,
//                 a dash read as a minus sign).

import { assessObjectLoss, objectLossNote } from './objectLoss.js'

export const OUTCOME = Object.freeze({
  EXACT: 'exact',
  DISCLOSED: 'disclosed',
  PARTIAL: 'partial',
  UNSUPPORTED: 'unsupported',
  ERROR: 'error',
})

export const SEVERITY = Object.freeze({
  SEMANTIC: 'semantic',
  PRESENTATION: 'presentation',
  INFO: 'info',
})

/** What the member reads as the verdict's name. */
export const OUTCOME_LABEL = Object.freeze({
  exact: 'Exact import',
  disclosed: 'Imported, with disclosed differences',
  partial: 'Partial import',
  unsupported: 'Not supported',
  error: 'Import failed',
})

/** Ignored-line / note codes, by severity. ⛔ An unlisted code is PRESENTATION:
 *  a line the translator did not read is a difference in what the script shows
 *  even when no imported VALUE reads it (if one did, that output refused and the
 *  import is PARTIAL), so it is never INFO by default. */
const NOTE_SEVERITY = Object.freeze({
  // nothing differs
  'pine:declaration': SEVERITY.INFO,
  'thinkscript:note-endash': SEVERITY.INFO,
  // values / time alignment differ
  'thinkscript:note-seed': SEVERITY.SEMANTIC,
  'thinkscript:note-warmup': SEVERITY.SEMANTIC,
})

/** Codes whose loss is a MISSING PART of the script, not a difference in how it is
 *  drawn: a strategy's orders and backtest are not run. */
const MISSING_PART_CODES = Object.freeze({
  'pine:strategy-chart': 'the strategy’s orders and backtest (only its plots are imported)',
  'pine:strategy-call': 'the strategy’s orders and backtest (only its plots are imported)',
})

/** Vendor / fold note names (rendered verbatim from `closedTable.json`) that are
 *  INFO. Every other vendor or fold note describes maths that RAN DIFFERENTLY and
 *  is SEMANTIC — that is what those channels exist for. */
const INFO_VENDOR_NOTES = Object.freeze(new Set(['alertcondition']))

/** ⭐⭐ THE SEAM FOR A TREE-SHAPED SEMANTIC DIFFERENCE (P0, for slice `inv`).
 *  A rule `{ node, name, note }` attaches `note` (SEMANTIC) to every output whose
 *  saved tree contains a node of type `node`. ⛔ A rule whose `note` is null
 *  attaches nothing. The Pine look-ahead-off HTF step-back is NOT wired here: it
 *  rides the translator's own `_folds` channel (`htfLookaheadOffStepBacks`,
 *  declared in `closedTable.json`) and reaches `vendorNotes` like every fold note,
 *  which also persists it to `meta.disclosures` on the member pane. This table
 *  exists for a difference a translator cannot record on its row. */
export const TREE_SEMANTIC_RULES = Object.freeze([])

/** ⭐ PCF — TC2000 `XUP`/`XDOWN` at the default one-bar distance read as this
 *  engine's `crossOver`/`crossUnder`, whose boundary differs (`pcf.js` and
 *  `pcfCoverage()` record it; nothing told the member). In the PCF dialect every
 *  `crossOver`/`crossUnder` in the tree came from that mapping — a distance other
 *  than 1 is spelled out as TC2000's own definition. */
export const PCF_XUP_NOTE = 'XUP / XDOWN: TC2000 counts a cross when the value was BELOW the level '
  + 'on the prior bar and is AT OR ABOVE it now (XDOWN mirrored); this engine counts it when the '
  + 'value was AT OR BELOW the level and is now ABOVE it. The two disagree only on a bar where the '
  + 'value lands exactly on the level — reachable on a round-number threshold.'

const isObj = (v) => !!v && typeof v === 'object'

function walk(node, visit) {
  if (!isObj(node)) return
  visit(node)
  if (Array.isArray(node.args)) for (const a of node.args) walk(a, visit)
}

function treeHas(ast, pred) {
  let hit = false
  walk(ast, (n) => { if (!hit && pred(n)) hit = true })
  return hit
}

/** The severity of one ignored-line note. */
export function classifyNote(note) {
  const code = note && note.code
  if (code && Object.prototype.hasOwnProperty.call(NOTE_SEVERITY, code)) return NOTE_SEVERITY[code]
  return SEVERITY.PRESENTATION
}

function outputName(out, i) {
  return (out && (out.title || out.handle)) || `the output on line ${out && out.line != null ? out.line : i + 1}`
}

/**
 * The one verdict for an `inspectSource` report.
 *
 * @param {object|null} report  `PineBox.inspectSource`'s result (or `null`).
 * @param {{rules?: Array}} [opts]
 * @returns {{verdict, label, reason, missing: Array<{name, guard, message}>,
 *   semantic: Array<{name, note, line}>, presentation: Array<{name, note, line}>,
 *   info: Array<{name, note, line}>}}
 */
export function importOutcome(report, opts = {}) {
  const empty = { missing: [], semantic: [], presentation: [], info: [] }
  const done = (verdict, reason, parts = empty) => ({
    verdict, label: OUTCOME_LABEL[verdict], reason: reason || null, ...parts,
  })
  try {
    if (!report) return done(OUTCOME.UNSUPPORTED, 'nothing was read')
    if (report.error) {
      return done(OUTCOME.ERROR, 'the translator failed on this text, so nothing was imported. '
        + 'This is a fault in this engine, not in your script; it has been logged.')
    }
    if (report.foreign) {
      return done(OUTCOME.UNSUPPORTED, report.refusal ? report.refusal.message : `this looks like ${report.foreign}`)
    }
    const outputs = Array.isArray(report.outputs) ? report.outputs : []
    if (!report.ok) {
      return done(OUTCOME.UNSUPPORTED, report.refusal ? report.refusal.message : 'this offered nothing to run')
    }

    const parts = { missing: [], semantic: [], presentation: [], info: [] }
    const seen = new Set()
    const add = (bucket, name, note, line = null) => {
      const key = `${bucket}::${name}::${note}`
      if (seen.has(key)) return
      seen.add(key)
      parts[bucket].push({ name, note, line })
    }

    // 1. OUTPUTS: refused, or translated but failing the downstream door.
    let usable = 0
    outputs.forEach((out, i) => {
      if (!out) return
      if (out.formula && out.hidden) {
        add('info', outputName(out, i), 'hidden by the script itself, so not offered', out.line)
        return
      }
      if (!out.formula) {
        const r = out.refusal || {}
        parts.missing.push({ name: outputName(out, i), guard: r.guard || null, message: r.message || 'not translated' })
        return
      }
      if (out.downstream && out.downstream.ok === false) {
        parts.missing.push({ name: outputName(out, i), guard: out.downstream.guard || null, message: out.downstream.error || 'does not evaluate' })
        return
      }
      usable += 1
      for (const v of (out.vendorNotes || [])) {
        add(INFO_VENDOR_NOTES.has(v.name) ? 'info' : 'semantic', v.name, v.note, out.line)
      }
      const pres = out.presentation || {}
      if (pres.colorDynamic) add('presentation', outputName(out, i), 'its colour changes bar by bar in the script and is drawn in one colour here', out.line)
      if (pres.styleUncarried) add('presentation', outputName(out, i), `its style \`${pres.styleUncarried}\` is not carried`, out.line)
      for (const rule of (opts.rules || TREE_SEMANTIC_RULES)) {
        if (rule && rule.note && out.ast && treeHas(out.ast, (n) => n.type === rule.node)) {
          add('semantic', rule.name || rule.node, rule.note, out.line)
        }
      }
      if (report.dialect === 'pcf' && out.downstream && out.downstream.ast
        && treeHas(out.downstream.ast, (n) => n.type === 'call' && (n.name === 'crossOver' || n.name === 'crossUnder'))) {
        add('semantic', 'XUP / XDOWN', PCF_XUP_NOTE, null)
      }
    })

    // 2. IGNORED LINES / NOTES.
    for (const n of (report.ignored || [])) {
      if (!n) continue
      const where = n.line != null ? `line ${n.line}` : 'this script'
      if (n.code && Object.prototype.hasOwnProperty.call(MISSING_PART_CODES, n.code)) {
        const name = MISSING_PART_CODES[n.code]
        if (!parts.missing.some((m) => m.name === name)) {
          parts.missing.push({ name, guard: n.code, message: n.message })
        }
        continue
      }
      add(classifyNote(n), where, n.message, n.line ?? null)
    }

    // 3. THE DRAWING PROGRAM'S OWN LOSS (objectLoss.js), and withheld paints.
    if (report.objects || report.objectDiagnostics) {
      const loss = assessObjectLoss({ objects: report.objects, objectDiagnostics: report.objectDiagnostics })
      if (loss.verdict === 'removes') {
        const n = objectLossNote(loss, { withheld: true })
        parts.missing.push({ name: 'the script’s drawings', guard: 'pine:object-removal-lost', message: n ? n.note : '' })
      } else if (loss.verdict === 'partial') {
        const n = objectLossNote(loss)
        if (n) add('presentation', n.name, n.note)
      }
    }
    const paints = (report.presentation && Array.isArray(report.presentation.paints)) ? report.presentation.paints : []
    for (const p of paints) {
      if (p && p.withheld) add('presentation', `\`${p.kind}\``, `not drawn: ${p.withheld.reason}`, p.line ?? null)
    }

    if (usable === 0) {
      const first = parts.missing[0]
      return done(OUTCOME.UNSUPPORTED, first ? `${first.name}: ${first.message}` : 'this offered nothing to run', parts)
    }
    if (parts.missing.length) {
      return done(OUTCOME.PARTIAL,
        `not imported: ${parts.missing.map((m) => m.name).join(', ')}`, parts)
    }
    if (parts.semantic.length || parts.presentation.length) {
      return done(OUTCOME.DISCLOSED,
        parts.semantic.length
          ? `${parts.semantic.length} difference${parts.semantic.length === 1 ? '' : 's'} can change a value or when it appears`
          : 'differences in how it is drawn only; the values are the same',
        parts)
    }
    return done(OUTCOME.EXACT, null, parts)
  } catch (e) {
    // ⛔ This function must never be the thing that breaks the box.
    return done(OUTCOME.ERROR, `the import verdict could not be computed: ${String((e && e.message) || e)}`)
  }
}

/** ⭐⭐ P0 0L — THE CONTROLLED ERROR: a translator throw becomes ONE logged report
 *  (outcome ERROR) that offers nothing to save. Used by `PineBox`'s import doors. */
export const IMPORT_ERROR_GUARD = 'import:internal-error'
export function controlledErrorReport(source, err, dialect = 'formula') {
  console.error('[import] translator threw — shown to the member as a controlled error', err)
  const refusal = {
    guard: IMPORT_ERROR_GUARD,
    message: 'this engine failed while reading this text, so nothing was imported. This is a '
      + 'fault in the engine, not in your script, and it has been logged.',
    line: null, column: null, token: null, source,
  }
  const report = {
    ok: false, dialect, version: null, declaration: null, title: null, outputs: [],
    selected: -1, refusal, ignored: [], folded: [], inputParams: [], objects: null,
    presentation: null, libraries: [], error: String((err && err.message) || err),
  }
  return { ...report, outcome: importOutcome(report) }
}


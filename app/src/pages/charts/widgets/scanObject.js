// TERM-087 (item 14 WF-C12) — an AI Search answer's `scan_object`, read through
// the BUILDER'S OWN validator before anything offers to open it.
//
// ⭐ ONE VALIDATOR, NOT A PARALLEL SCHEMA. The server built the object with the
// builder's concierge pipeline; this module re-checks it with the exact gate the
// builder's formula box runs on every keystroke — `evaluateFormula` (parse,
// budget, repaint linter, read-back, interpreter) over `BUILDER_INPUT_SCOPE` —
// plus the JS lane's one condition classifier, `sentence.js::yieldsOf`. Nothing
// here restates a rule those modules own.
//
// ⛔ A WHOLE OBJECT OR AN HONEST REFUSAL, NEVER A HALF-OBJECT. Three ways an
// object can be "mostly right" and each is refused:
//   · a field missing                 → `object:incomplete`
//   · text the builder cannot read    → the builder's own guard
//   · text that reads, but parses to a DIFFERENT tree than it came with
//                                      → `object:round-trip`
// The last is the one worth a sentence: the member is shown the text, the text
// is what opens in the builder, and a text/tree disagreement would put a scan in
// the box that is not the scan the answer described. Identity is `astHash` —
// the store's own — never string equality.
//
// ⚠️ THE READ-BACK IS THE TREE'S. `readback` comes from `evaluateFormula` (i.e.
// `sentenceFor` of the parsed tree), never from anything the server sent — the
// ConciergeBox rule, for the same reason: a model-written summary of a
// model-written formula is two guesses agreeing.

import { evaluateFormula } from '../../../components/chart/builder/FormulaField'
import { BUILDER_INPUT_SCOPE } from '../../../components/chart/builder/builderInputs'
import { astHash } from '../../../components/chart/engine/ast/parse'
import { yieldsOf } from '../../../components/chart/engine/ast/sentence'

/** The refusal sentences this reader OWNS. Every other reason is the server's
 *  or the builder's own, passed through unchanged. */
export const SCAN_OBJECT_REFUSALS = Object.freeze({
  'object:refused': 'this answer could not be turned into a scan',
  'object:incomplete': 'the scan came back incomplete, so it is not offered',
  'object:round-trip': 'the formula text does not match the scan it came with, so it is not offered',
  'object:repaints': 'the builder measures this formula as repainting, so it is not offered',
  'scan:not-a-condition': 'that formula produces a number, not a yes/no condition, so it is not a scan',
})

function refusal(gate, reason) {
  return {
    ok: false,
    gate: String(gate || 'object:refused'),
    reason: String(reason || SCAN_OBJECT_REFUSALS[gate] || SCAN_OBJECT_REFUSALS['object:refused']),
  }
}

/**
 * `null` when there is nothing to show (no object: the flag is off or the ask
 * was not a screen), else `{ok: true, source, readback, importId,
 * notUnderstood, unavailable, freshness, cadence}` or `{ok: false, gate,
 * reason}` — and a refusal carries NOTHING else. Never throws.
 */
export function readScanObject(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null
  if (obj.ok !== true) return refusal(obj.gate, obj.reason)

  const source = typeof obj.source === 'string' ? obj.source : ''
  if (!source.trim() || !obj.ast || typeof obj.ast !== 'object') {
    return refusal('object:incomplete')
  }

  const result = evaluateFormula(source, BUILDER_INPUT_SCOPE)
  if (!result || !result.ok) {
    return refusal((result && result.guard) || 'object:refused', result && result.error)
  }
  if (result.verdict && result.verdict.mode === 'repaints') return refusal('object:repaints')

  let same = false
  try {
    same = astHash(result.ast) === astHash(obj.ast)
  } catch {
    same = false
  }
  if (!same) return refusal('object:round-trip')

  if (yieldsOf(result.ast) !== 'bool') return refusal('scan:not-a-condition')

  return {
    ok: true,
    source,
    readback: result.readback,
    importId: typeof obj.import_id === 'string' && obj.import_id ? obj.import_id : null,
    notUnderstood: Array.isArray(obj.not_understood) ? obj.not_understood : [],
    unavailable: Array.isArray(obj.unavailable) ? obj.unavailable : [],
    freshness: obj.freshness || null,
    cadence: obj.cadence || null,
  }
}

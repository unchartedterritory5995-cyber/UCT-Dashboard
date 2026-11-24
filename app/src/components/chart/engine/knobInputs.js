// app/src/components/chart/engine/knobInputs.js
//
// ⭐⭐ e95 unit 2b — THE INPUTS A TREE READS, in a LEAF module. Moved verbatim from `astColumns.js` (which re-exports
// every name, so no importer moved) so that the fetch plan (`symbolInputs.js::instanceDocumentForFetch`) and the bind
// (`knobBind.js::boundAtInputs`) can bind a document at an instance's knobs without an import cycle through
// `astColumns.js`. ⛔ ONE copy: `resolveInputs`, `enumIndexOf` and `treeScalars` live here and nowhere else.

import { inputsAsRead } from './legacyInputs.js'

/** Merge a caller's inputs over the definition's declared defaults. */
// ⭐⭐ EXPORTED FOR THE OBJECT LANE (C3B-CLOSE item 6), NOT COPIED INTO IT.
// `objectColumns.objectReaderFor` needs exactly this merge — declared defaults
// under the instance's overrides — to evaluate an object's coordinate the way
// the plot beside it is evaluated. A second copy there would be a second
// authority over one value, and the two would disagree the first time a default
// rule moved (`lesson_a_second_authority_over_one_value`).
export function resolveInputs(def, inputs) {
  const out = {}
  for (const input of def?.inputs || []) {
    if (input && typeof input.key === 'string') out[input.key] = input.default
  }
  // ⭐ 3-08b: a stored legacy input reads as its successor where the successor
  // was never stored (`legacyInputs.inputsAsRead`; read-time, never written back).
  const stored = inputsAsRead(def, inputs)
  if (stored) {
    for (const [k, v] of Object.entries(stored)) {
      if (v !== undefined) out[k] = v
    }
  }
  return out
}

/**
 * ⭐⭐ THE SCALARS A TREE READS: `resolveInputs`, with every TEXT enum handed over
 * as its option's INDEX.
 *
 * A tree has no strings (`pine.js::enumCompare` writes `kind == 1` for Pine's
 * `kind == "SMA"`), so an `enum` input whose options are text reaches it as the
 * position of the member's pick. The INSTANCE keeps the text — what the dropdown
 * shows and what `defSchema` validates — and only the evaluation scope sees the
 * number.
 *
 * ⭐⭐ ONE RULE, SHARED WITH THE SERVER (`api/services/alert_user_series._inputs_for`),
 * pinned by ONE fixture both suites read (`tests/fixtures/enum_input_parity.json`):
 *   • a value that IS one of the options → that option's index;
 *   • anything else — unknown text, a number, null, a boolean — → the DEFAULT's index;
 *   • a default that is not among the options → index 0. (Pine refuses to compile
 *     such a script, so the door never mints one; this guards a hand-made document.)
 * ⚰️ An unknown value used to pass through as text, the tree compared text with a
 * number, and EVERY `kind == i` was false — the script's else arm, which the server
 * did not agree with (it took the default).
 * ⛔ Only for the TREE lanes: a native's enum (`lineStyle: 'dashed'`) is text its
 * compute reads as text, and `resolveInputs` stays exactly what it was.
 */
export function enumIndexOf(input, value) {
  const opts = Array.isArray(input && input.options) ? input.options.map((o) => (Array.isArray(o) ? o[0] : o)) : []
  if (!opts.length || !opts.every((o) => typeof o === 'string')) return null
  const at = typeof value === 'string' ? opts.indexOf(value) : -1
  if (at >= 0) return at
  const def = opts.indexOf(input.default)
  return def >= 0 ? def : 0
}

export function treeScalars(def, scalars) {
  let out = scalars
  for (const input of def?.inputs || []) {
    if (!input || input.type !== 'enum' || typeof input.key !== 'string') continue
    const i = enumIndexOf(input, scalars[input.key])
    if (i === null) continue
    if (out === scalars) out = { ...scalars }
    out[input.key] = i
  }
  return out
}

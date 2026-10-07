// app/src/components/chart/builder/builtinCopy.js
//
// ⭐ PHASE 4 — THE CUSTOM COPY OF A BUILT-IN, ASSEMBLED. The heavy half of
// `builtinForks.js` (it reaches the Builder's row model), kept apart so the light
// rules can be read while rendering without importing the Builder.

import { buildFromModel, evaluateRowSource } from './authoring/model'
import { BUILDER_INPUTS, chromeInputsFor } from './builderInputs'
import { declaredInputs } from '../engine/ast/lint'
import { draftDefId } from './BuilderSheet'
import { SPECS, customizability } from './builtinForks'
import { derivedDefName } from './authoring/derivedName'

/**
 * The CUSTOM COPY of a built-in at the member's current settings: a fresh `ast`
 * document built through the Builder's own model, `meta.forkedFrom` naming the
 * built-in. Throws when the built-in is not customizable (callers ask first).
 */
export function customCopyOf(def, inputs = {}) {
  const verdict = customizability(def, inputs)
  if (!verdict.ok) throw new Error(verdict.reason)
  const spec = SPECS[def.id](inputs || {})
  const rows = spec.outputs.map((o) => ({
    key: o.key, label: o.label || '', style: o.style || 'line',
    color: o.color || BUILDER_INPUTS[0].default, width: BUILDER_INPUTS[1].default, hidden: false,
    ...(o.presentation || {}),
  }))
  const scope = declaredInputs({ inputs: chromeInputsFor(rows) })
  for (let i = 0; i < rows.length; i += 1) {
    const ev = evaluateRowSource(spec.outputs[i].text, scope, rows[i].key)
    Object.assign(rows[i], { source: ev.source, ast: ev.ast, mode: ev.verdict.mode, readback: ev.readback, dialect: 'native' })
  }
  const nativeName = (def.meta && def.meta.name) || def.id
  // ⭐ A ONE-OUTPUT COPY IS NAMED BY ITS MATHS ("RSI 14"), the auto name the
  // conversation re-derives — so "make it 21" renames it "RSI 21" instead of leaving a
  // stale "RSI 14" (P3R). A several-output copy keeps an explicit name: its derived one
  // would read as formula text. Either way `meta.forkedFrom` records the built-in.
  const named = rows.length === 1 ? derivedDefName({ rows, scanKey: rows[0].key }) : ''
  return buildFromModel({
    defId: draftDefId(), version: 1, rev: 1, name: named || `${spec.name} (custom)`,
    rows, scanKey: rows[0].key,
    placement: spec.target === 'price' ? { target: 'price' } : null,
    levels: spec.levels && spec.levels.length ? [...spec.levels] : null,
    paints: null, objects: null, paramManifest: null, memberInputs: [],
    carried: { compute: {}, meta: { forkedFrom: { builtin: def.id, name: nativeName, version: def.version || 1 } } },
  })
}

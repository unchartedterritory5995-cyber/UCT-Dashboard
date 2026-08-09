// app/src/components/chart/builder/builderInputs.js
//
// ─── THE INPUTS EVERY DOCUMENT THE BUILDER WRITES DECLARES ──────────────────
//
// ⭐ ONE ARRAY, AND IT IS SHARED BY THREE READERS THAT MUST NOT DISAGREE:
// `buildDefinition` writes it into the saved document, the READ-BACK is told
// which names it may say, and the REPAINT LINTER is told which names are
// declared scalars rather than unknown series. `parse.js` turns every identifier
// into a `series` node, so `close * lineWidth` is only sayable — and only
// badgeable non-repainting — if all three are looking at the same list.
//
// ⛔ ITS OWN MODULE, NOT AN EXPORT FROM `BuilderSheet.jsx`, and the reason is a
// lint rule with a real failure behind it: `react-refresh/only-export-components`
// fires on a component file that also exports constants, and Fast Refresh then
// re-mounts the sheet on every edit to it. The sheet already carries three such
// exports; two more is the wrong direction.
//
// ⛔ ONE VOCABULARY, AND IT IS `key`. `defSchema.validateInput` REQUIRES
// `input.key`, `nativeRegistry.resolveInputs` reads it, `lint.declaredInputs`
// reads it and the server's `registry_defs.resolve_inputs` reads `spec["key"]`.
// `name` is NOT a fallback: a reader that took either is the second vocabulary
// for one field that left `alert_user_series._inputs_for` returning `{}` for the
// whole of its life.

import { declaredInputs } from '../engine/ast/lint'

/** The `inputs[]` array of every document `buildDefinition` produces. */
export const BUILDER_INPUTS = Object.freeze([
  { key: 'color', type: 'color', label: 'Color', default: '#c9a84c' },
  { key: 'lineWidth', type: 'int', label: 'Line width', default: 1, min: 1, max: 4, step: 1 },
])

/** The same names, in the shape `sentenceFor` and `lintRepaint` take.
 *
 *  ⚠️ MODULE-LEVEL AND FROZEN because `FormulaField` depends on its IDENTITY: it
 *  sits in the debounce effect's dependency list, and a fresh object per render
 *  would restart the 250 ms timer every render so the box never settles. */
export const BUILDER_INPUT_SCOPE = Object.freeze(
  declaredInputs({ inputs: BUILDER_INPUTS }),
)

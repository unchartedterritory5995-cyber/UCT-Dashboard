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

// ─── THE CHROME A MULTI-PLOT DOCUMENT DECLARES ──────────────────────────────
//
// ⛔ ONE DERIVATION, TWO READERS, AND THEY MUST NOT DISAGREE. `buildDefinition`
// writes `plots[].color = '$<key>'` and the SAME function decides what that key
// is named; the sheet builds its member-input RESERVED set from it, so a member
// cannot declare an input called `signalColor` beside a plot called `signal`.
// A hand-typed `${row.key}Color` at either site is the second-authority defect
// this repo names most often — the day the naming rule moves, one of the two
// silently keeps the old spelling and the `$ref` resolves to nothing.

/** Which two chrome inputs a plot row's colour and width resolve through.
 *
 *  ⭐ ROW 0 KEEPS `color`/`lineWidth`, and that is what makes a single-plot
 *  document byte-identical to a schema-1 one. Later rows are named after their
 *  plot — the `macd` native's own idiom (`macdColor`, `signalColor`).
 *
 *  ⚠️ It takes the ROW, not just its key, so the naming rule stays in one place
 *  even if a later row ever needs more than the key to name its settings. */
export function chromeInputKeys(row, index) {
  const key = (row && typeof row.key === 'string') ? row.key : ''
  if (index === 0) return { color: BUILDER_INPUTS[0].key, width: BUILDER_INPUTS[1].key }
  return { color: `${key}Color`, width: `${key}Width` }
}

/** The chrome `inputs[]` for every plot row, in row order.
 *
 *  ⛔ THE ROW'S CHOSEN COLOUR AND WIDTH BECOME THE INPUT'S **DEFAULT**, INCLUDING
 *  ROW 0's. `plots[].color` is `'$color'` — a REFERENCE — so the swatch on the
 *  form has nowhere else to land: writing the literal into the plot would take
 *  the value out of the settings dialog the member later tunes it in, and
 *  writing it nowhere makes the swatch a control that does nothing. Row 0 was
 *  the one that would have been dropped, because it is the only row whose two
 *  inputs already existed.
 *
 *  ⛔ AND ROW 0's LABELS ARE THE SHIPPED ONES, UNTOUCHED (`Color` / `Line
 *  width`). They are what the generated settings row says; renaming them to
 *  match the later rows' `"<plot> colour"` pattern would move a string every
 *  saved definition already carries. */
export function chromeInputsFor(rows) {
  const list = (Array.isArray(rows) && rows.length) ? rows : [{ key: BUILDER_INPUTS[0].key }]
  const out = []
  list.forEach((row, i) => {
    const keys = chromeInputKeys(row, i)
    const color = (row && typeof row.color === 'string' && row.color) ? row.color : BUILDER_INPUTS[0].default
    const width = (row && Number.isFinite(row.width)) ? row.width : BUILDER_INPUTS[1].default
    if (i === 0) {
      out.push({ ...BUILDER_INPUTS[0], default: color })
      out.push({ ...BUILDER_INPUTS[1], default: width })
      return
    }
    const label = (row && (row.label || row.key)) || keys.color
    out.push({ key: keys.color, type: 'color', label: `${label} colour`, default: color })
    out.push({ key: keys.width, type: 'int', label: `${label} width`, default: width, min: 1, max: 4, step: 1 })
  })
  return out
}

// app/src/components/chart/engine/semanticName.js
//
// ─── THE NAME A MEMBER READS, DERIVED FROM THE DEFINITION ───────────────────
//
// ⭐⭐ ONE DEFINITION, ONE NAME, EVERY SURFACE. A Moving Average is `EMA 9` and
// `SMA 50` — never `MA (9)`, and never `Moving Average #1`. That is not a string
// this file owns: it is what the DEFINITION declares through `meta.nameFrom`, and
// this is the one reader of that declaration.
//
// ⛔⛔ WHY IT IS ITS OWN MODULE. There are TWO naming surfaces and they are
// deliberately not the same function — `readout.chipLabel` names a PLOT in the
// legend strip, `sourceRef.instanceLabel` names an INSTANCE in the source picker,
// the settings rows and the destination menu. They have drifted before (measured
// 2026-09-14: `instanceLabel` was taught about `labelFrom: 'source'` and the pane
// legend still read "Series 714.88" over a QQQ line). `labelFrom` is spelled
// twice on purpose, because `readout.js` is PURE and imports no source grammar.
// `nameFrom` needs no source grammar at all — it is definition metadata and
// resolved inputs — so it can be spelled ONCE, and is.
//
// ─── THE DECLARATION ────────────────────────────────────────────────────────
//
//     meta: {
//       name: 'Moving Average', shortName: 'MA',
//       nameFrom: { stem: 'maType', params: ['period'] },
//     }
//
//   `stem`   — an ENUM input whose chosen option's LABEL becomes the stem. The
//              member picked "EMA"; that word is already in the definition, in
//              the very control they picked it with, so the name cannot drift
//              from the control.
//   `params` — inputs appended after it, space-separated and BARE. `EMA 9`, not
//              `EMA (9)`: the parenthesised form is `legendParams`' grammar for a
//              name whose stem is a fixed noun (`RSI (14)`), and an MA's stem is
//              already the member's own choice.
//
// ⛔ ABSENT MEANS ABSENT. A definition that declares no `nameFrom` is named
// exactly as it was before this module existed — every existing indicator, every
// user formula, every test written against them. This adds a capability; it
// changes no default.
//
// ⛔ AND IT NEVER RETURNS A HALF-ANSWER. If the stem input is missing, is not an
// enum, or holds a value the definition does not offer, this answers `null` and
// the caller falls back to its ordinary stem. A name assembled from a value the
// definition does not recognise would be a label nobody can trace back to a
// control.

/** The option LABEL for `value` in an enum input's `options`, or null.
 *
 *  ⚠️ `options` IS `[value, label]` PAIRS in this schema (`defSchema`), which is
 *  also what `IndicatorSettingsDialog` renders — so the word in the name is
 *  byte-identical to the word in the dropdown that set it. */
function enumOptionLabel(input, value) {
  if (!input || input.type !== 'enum' || !Array.isArray(input.options)) return null
  for (const opt of input.options) {
    if (!Array.isArray(opt) || opt.length < 2) continue
    if (opt[0] === value) return typeof opt[1] === 'string' && opt[1] ? opt[1] : null
  }
  return null
}

/** An input's effective value — the instance's, else the definition's default. */
function valueOf(def, inputs, key) {
  if (inputs && inputs[key] !== undefined) return inputs[key]
  const declared = (def && Array.isArray(def.inputs) ? def.inputs : []).find((i) => i && i.key === key)
  return declared ? declared.default : undefined
}

/**
 * `EMA 9` — the member-facing name a definition declares for itself, or null.
 *
 * @param {object} def     the definition
 * @param {object} inputs  RESOLVED inputs (instance's over declared defaults)
 * @returns {string|null}
 */
export function semanticName(def, inputs) {
  const spec = def && def.meta && def.meta.nameFrom
  if (!spec || typeof spec !== 'object') return null
  const stemKey = spec.stem
  if (typeof stemKey !== 'string' || !stemKey) return null
  const declared = (Array.isArray(def.inputs) ? def.inputs : []).find((i) => i && i.key === stemKey)
  const stem = enumOptionLabel(declared, valueOf(def, inputs, stemKey))
  if (!stem) return null
  const params = Array.isArray(spec.params) ? spec.params : []
  const vals = []
  for (const key of params) {
    const v = valueOf(def, inputs, key)
    if (v === undefined || v === null || v === '') continue
    vals.push(v)
  }
  return vals.length ? `${stem} ${vals.join(' ')}` : stem
}

/**
 * Does this definition name itself semantically?
 *
 * ⭐ ASKED BY THE PANE READOUT, which otherwise prints `meta.name` in full. "Moving
 * Average" over a pane holding `EMA 9` is the catalogue noun where the member
 * needs the series — the same reasoning that gives `labelFrom: 'source'` its own
 * branch there.
 */
export function namesItselfSemantically(def) {
  return !!(def && def.meta && def.meta.nameFrom && typeof def.meta.nameFrom === 'object'
    && typeof def.meta.nameFrom.stem === 'string' && def.meta.nameFrom.stem)
}

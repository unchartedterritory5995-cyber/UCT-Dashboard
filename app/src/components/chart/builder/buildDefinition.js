// app/src/components/chart/builder/buildDefinition.js
//
// ─── THE STORED DOCUMENT'S BUILDER, OUT OF THE SHEET ────────────────────────
//
// `buildDefinition` and the schema-1 body it keeps byte-identical, MOVED here verbatim from
// `BuilderSheet.jsx` (which re-exports every name, so no caller changes). ⭐ WHY (paste worker,
// 2026-11-20): the member door (`memberPane/memberPaneDefinition.js`) builds a pasted script in a
// Web Worker now, and a worker's module graph may hold no React component: importing the sheet put
// React, the chart and every builder panel into it. ⛔ Pure: no React, no DOM, no network.
import { SCHEMA_VERSION, PLOT_LINE_STYLES } from '../engine/defSchema'
import { astHash } from '../engine/ast/parse'
// ⛔ THE SECOND MACHINE-ASSIGNED BADGE, AND IT IS MEASURED HERE (`buildDefinition`) FOR THE SAME
// REASON `repaint` IS: `validateUserDefinitions` REQUIRES `meta.freshness` on
// the `ast` lane and refuses a disagreement in both directions, so a document
// this form built without it would be refused at its own save door.
import { freshnessFor } from '../engine/ast/freshness'
import { BUILDER_INPUTS, chromeInputKeys, chromeInputsFor } from './builderInputs'
import { treesHash, worstRepaint, stalestFreshness } from '../engine/ast/trees'
import { chipName } from '../engine/labelText'
import { NEW_LINE_FLAG, rowIsNewLine } from '../engine/lineIdentity'

/** The plot key `levels` is minted by this form, so nobody else may claim it. */
export const LEVELS_PLOT_KEY = 'levels'

/** The `macd` native's own zero-line spelling — a guide, not a series.
 *  ⛔ NOT SUBSTITUTABLE AND DELIBERATELY UNTUNABLE: a guide with a colour input
 *  is a settings row for a dashed line, which is three controls of noise for a
 *  reference the member already chose by typing the number. */
const LEVELS_GUIDE = Object.freeze({
  color: 'rgba(255,255,255,0.12)', width: 1, lineStyle: 'largeDashed', role: 'context',
})

/** The default placement — its own pane, at the height every authored formula
 *  has shipped with. Named so the v2 branch and the schema-1 one cannot drift. */
export const PANE_PLACEMENT = () => ({ target: 'pane', pane: { height: 0.15 } })

/** Plot 1's label when nothing else names it — `'Value'`, the schema-1
 *  spelling `legacyDefinition` has always written. ⛔ FIX ROUND 1, MINOR 7:
 *  `buildDefinition`'s v2 body and `openForEdit`'s restore had each grown
 *  their OWN fallback for this (`r.key`/`p.key`, i.e. `'value'` — the KEY, not
 *  a label), so an empty `meta.name` would restore or save a DIFFERENT default
 *  label depending only on which of the three functions wrote it. Neither is
 *  reachable through the form today (the Name field is required to save), but
 *  an unreachable divergence is still two authorities over one fact — named
 *  once, here, so it cannot reopen the day something else calls
 *  `buildDefinition` directly with no name, or a hand-rolled POST does. */
export const DEFAULT_PLOT1_LABEL = (short) => short || 'Value'

/**
 * ⛔⛔ THE SCHEMA-1 DOCUMENT, MOVED HERE VERBATIM AND NOT RETYPED.
 *
 * `buildDefinition` grew a second shape in W1b.5 (many plots, many trees), and
 * the ONE property that could not be allowed to move is that a document with a
 * single default plot is byte-identical to the one this form has written since
 * Phase D — 21 stored v1 documents were proved against it. Keeping the old body
 * as its own function makes that true BY CONSTRUCTION rather than by an argument
 * somebody has to re-check; `BuilderSheet.plots.test.jsx` then proves the v2
 * body reaches the SAME object for the simplest input, so the two are one
 * meaning with two spellings rather than two meanings.
 */
function legacyDefinition({ defId, version, rev, source, ast, mode, readback, declared, trimmed, short,
  paramManifest = null }) {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: defId,
    version,
    compute: {
      kind: 'ast', fn: astHash(ast), rev, ast, source,
      // ⭐ TRACK F (DEC-006) — additive, OMITTED (never a null key) for every
      // non-Pine save, keeping every one of the "21 stored v1 documents"
      // this function's own header guards byte-identical.
      ...(paramManifest && Object.keys(paramManifest).length ? { paramManifest } : {}),
    },
    meta: {
      name: trimmed,
      shortName: short,
      category: 'Custom',
      description: readback,
      tags: ['custom'],
      // Every `/api/user-definitions` route declares `Depends(require_paid)` on
      // its own handler, so a `free` claim here would be a definition promising
      // data its lane refuses to hand over.
      tier: 'premium',
      // ⛔ MACHINE-ASSIGNED. See the header.
      repaint: mode,
      // ⛔ MACHINE-ASSIGNED TOO, AND IT IS NOT THE SAME QUESTION. The repaint
      // linter answers 0 for a table-declared scalar — correctly, because a
      // per-symbol value reads no future bar — so `market_cap > 1e9` is branded
      // `non-repainting` and its staleness goes unsaid. Derived from the SAME
      // tree by the SAME kind of reader, never typed and never offered as a
      // form field. `BUILDER_INPUTS` is the scope the read-back already uses.
      freshness: freshnessFor(ast, {
        inputs: Object.fromEntries(declared.map((spec) => [spec.key, true])),
      }).mode,
    },
    placement: PANE_PLACEMENT(),
    // ⛔ SPREAD FROM `BUILDER_INPUTS`, WHICH IS ALSO WHAT THE READ-BACK'S SCOPE IS
    // DERIVED FROM. Copied so a caller cannot mutate the frozen source array's
    // members through the document it just received.
    inputs: declared.map((spec) => ({ ...spec })),
    // ⛔ EXACTLY ONE DATA-BEARING PLOT. One formula is one series
    // (`nativeRegistry.validateAstLane`); a second plot is a key nothing fills.
    plots: [{
      key: 'value',
      // ⛔ FIX ROUND 1, MINOR 7 — a SECOND anti-drift substitution, the same
      // shape as `PANE_PLACEMENT()` above: `DEFAULT_PLOT1_LABEL(short)` is
      // `short || 'Value'` by definition, so this line's OUTPUT is unchanged
      // and the byte-identical guarantee this function exists for still holds.
      label: DEFAULT_PLOT1_LABEL(short),
      style: 'line',
      color: '$color',
      width: '$lineWidth',
      role: 'primary',
      // ⛔⛔ WITHOUT THIS BLOCK THE PLOT GETS NO CHIP, AND NO CHIP MEANS NO NAME,
      // NO HIDE, NO SETTINGS AND NO REMOVE.
      //
      // `readout.js::legendChips` skips any plot with no `legend` — `if (!plot ||
      // !plot.legend || plot.legend.hide === true) continue`. That is the SAME
      // defect `nativeRegistry`'s header records against ten shipped indicators
      // ("a user who enabled MFI or OBV got a line with NO LABEL AT ANY TIME"),
      // and every user-authored formula has been landing in it since: measured in
      // production 2026-08-10, a saved TC2000 column drew an unnamed pane whose
      // name appeared NOWHERE in the page, while RSI beside it had all three
      // controls.
      //
      // ⚠️ A boolean scan plots 0/1, so the pane is a flat line at zero on a
      // symbol that does not match — and with no label a member cannot tell
      // "correctly 0" from "did not compute". The chip IS that distinction.
      legend: { decimals: 2 },
    }],
  }
}

/**
 * The document that gets stored — ONE function, two shapes, and the second one
 * is a superset the first can never be reached through by accident.
 *
 * ⭐ `plots`, `placement` and `levels` ALL `null` ⇒ the schema-1 document, byte
 * for byte (`legacyDefinition`). Any one of them present ⇒ the v2 body below.
 * The three-way test is deliberate rather than `plots === null` alone: a member
 * who only moved the placement, or only added levels, has still changed the
 * document, and a single-key test would have silently discarded that.
 *
 * ⭐ ONE ROW ⇒ NO `trees`. `def_hash == astHash(compute.ast)` never moves, and a
 * single-plot v2 document is the schema-1 one — `compute` carries the same five
 * keys. Two or more rows ADD `trees`/`treesHash`/`scanPlot`/`sources` beside
 * them; nothing existing is renamed or moved.
 *
 * ⭐ `scanPlot` NAMES THE PLOT WHOSE TREE **IS** `compute.ast`. It is not a
 * second copy of the scan tree — `defSchema.validateTrees` refuses the pair if
 * they ever disagree — so the scan, the alert seam and `def_hash` all keep
 * reading the field they always read.
 *
 * @param {object[]|null} plots every row, FIRST INCLUDED, as
 *        `{key, label, source, ast, mode, readback, style, color, width, hidden}`
 * @param {string|null} scanPlot the key of the row whose tree is the scan's; an
 *        unmatched key falls back to the first row rather than throwing, because
 *        this is a pure builder and the SHEET is what keeps the choice honest.
 * @param {object|null} placement `{target:'price'}` or `{target:'pane', pane:{…}}`
 * @param {number[]|null} levels one trailing `hlines` guide plot
 */

export function buildDefinition({ defId, name, source, ast, mode, rev = 1, version = 1,
  readback = '', inputs = BUILDER_INPUTS,
  plots = null, scanPlot = null, placement = null, levels = null, paramManifest = null,
  objects = null, paints = null }) {
  // ⛔ ONE LIST, READ TWICE — never two lists that agree today. The freshness
  // scope below and the document's own `inputs` are the SAME array, because a
  // member-declared name that reached one and not the other would badge a
  // formula off a scope the saved document does not carry.
  const declaredMember = Array.isArray(inputs) && inputs.length ? inputs : BUILDER_INPUTS
  const trimmed = String(name || '').trim()
  const short = chipName(trimmed)
  // ⭐⭐ P1 — `paints[]` (bgcolor / barcolor), the schema's existing field
  // (`defSchema.validatePaints`, drawn by `binder.syncPaints`). ⛔ OMITTED when
  // there are none, so every document that paints nothing stays byte-identical;
  // and a paint is a v2-body field, so its presence leaves the schema-1 path.
  const paintList = Array.isArray(paints) && paints.length ? paints.map((p) => ({ ...p })) : null

  // ⭐ P2 — an OBJECT PROGRAM is a v2-body field too: `legacyDefinition` has no
  // slot for it, so a single plain row carrying one used to be saved WITHOUT it.
  const hasObjects = !!(objects && Array.isArray(objects.ops) && objects.ops.length)
  if (plots === null && placement === null && levels === null && paintList === null && !hasObjects) {
    return legacyDefinition({
      defId, version, rev, source, ast, mode, readback,
      declared: declaredMember, trimmed, short, paramManifest,
    })
  }

  const rows = Array.isArray(plots) && plots.length ? plots : [{
    key: 'value', label: '', source, ast, mode, readback, style: 'line',
    color: BUILDER_INPUTS[0].default, width: BUILDER_INPUTS[1].default,
  }]
  const scan = rows.find((r) => r.key === scanPlot) || rows[0]

  // ⛔ THE CHROME IS DERIVED FROM THE ROWS AND THE MEMBER'S OWN INPUTS ARE KEPT
  // BESIDE IT — with the chrome names filtered OUT of the member half, so a
  // caller that hands `[...BUILDER_INPUTS, ...memberInputs]` (which every caller
  // does) cannot declare `color` twice. `defSchema.validateInput` refuses a
  // duplicate key, so this is the difference between a save and a refusal.
  const member = declaredMember.filter((spec) => !BUILDER_INPUTS.some((b) => b.key === spec.key))
  const declared = [...chromeInputsFor(rows), ...member]
  const scope = { inputs: Object.fromEntries(declared.map((spec) => [spec.key, true])) }

  const trees = Object.fromEntries(rows.map((r) => [r.key, r.ast]))
  const multi = rows.length > 1
  const dataPlots = rows.map((r, i) => {
    const keys = chromeInputKeys(r, i)
    return {
      key: r.key,
      // ⭐ AN UNLABELLED PLOT 1 IS THE INDICATOR ITSELF, so it wears the
      // indicator's chip name — the schema-1 spelling, preserved. A later row
      // has no such name to borrow and wears its own key.
      // ⛔ FIX ROUND 1, MINOR 7 — `DEFAULT_PLOT1_LABEL(short)`, NOT a second
      // hand-typed `short || r.key`. The two used to disagree the moment
      // `short` was falsy: this line fell back to `r.key` (`'value'`, the KEY)
      // while `legacyDefinition` falls back to `'Value'` (the LABEL). Neither
      // is reachable through the form (Name is required to save), but a stored
      // document opened with an empty name would have restored or saved a
      // DIFFERENT default depending only on which function wrote it — an
      // unreachable divergence is still two authorities over one fact.
      label: r.label || (i === 0 ? DEFAULT_PLOT1_LABEL(short) : r.key),
      style: r.style || 'line',
      color: `$${keys.color}`,
      width: `$${keys.width}`,
      role: i === 0 ? 'primary' : 'secondary',
      // ⛔⛔ EVERY DATA PLOT GETS A LEGEND BLOCK — see `legacyDefinition`. A plot
      // with none gets no chip, and no chip means no name, no hide, no settings
      // and no remove. That includes a HIDDEN one: hidden is about the CANVAS,
      // and its column still reaches the alert seam and the scan.
      legend: { decimals: 2 },
      ...(r.hidden ? { hidden: true } : {}),
      // ⭐ e97 U6 — hidden as the instance's settings decide (a knob tree, true = hidden; `knobBind.js::plotHiddenAt`)
      ...(!r.hidden && r.hiddenWhen ? { hiddenWhen: r.hiddenWhen } : {}),
      // ⭐⭐ C1-A: THE AUTHOR'S CONDITIONAL COLOUR, carried as the schema's own
      // per-point mode. `colorMode: 'column:<key>'` names ANOTHER row of this
      // same document — the hidden one holding the condition — and
      // `binder.toPoints` colours each point by whether that column is non-zero.
      //
      // ⛔ ALL THREE OR NONE. `defSchema` refuses a `column:` mode without both
      // colours (a mode with nothing to alternate between draws one flat colour
      // while registering happily), so a half-set row must not reach it.
      ...(r.colorMode && r.colorUp && r.colorDown
        ? { colorMode: r.colorMode, colorUp: r.colorUp, colorDown: r.colorDown }
        : {}),
      // ⭐⭐ …or a PALETTE: the named column holds which entry each bar uses (an
      // N-way Pine colour chain). Same all-or-none rule: mode and palette travel
      // together or neither does.
      ...(r.colorMode && !r.colorUp && Array.isArray(r.colorPalette) && r.colorPalette.length >= 2
        ? { colorMode: r.colorMode, colorPalette: r.colorPalette.slice() }
        : {}),
      // ⭐⭐ C37 — …or a GRADIENT: the named column holds the bar's position
      // between two static colours. Mode and endpoints travel together or
      // neither does, as above.
      ...(r.colorMode && !r.colorUp && !r.colorPalette && r.colorGradient
        && typeof r.colorGradient.from === 'string' && typeof r.colorGradient.to === 'string'
        ? { colorMode: r.colorMode, colorGradient: { ...r.colorGradient } }
        : {}),
      // ⭐⭐ THE AUTHOR'S OPACITY. `defSchema` validates `plots[].opacity` and
      // `pool` reads it, and the member pane has put it on its rows since
      // 2026-09-12 — but this projection never named it, so it stopped here and
      // every transparent Pine plot drew OPAQUE. Measured against TradingView
      // 2026-09-27 (vendor harness, live capture): RVOL's
      // `color.rgb(255, 255, 255, 70)` line is `#ffffff4d` there and was
      // `#ffffffff` here on 631/631 bars — `lesson_a_projection_drops_what_it_does_not_name`.
      ...(Number.isFinite(r.opacity) ? { opacity: r.opacity } : {}),
      // ⭐⭐ C3A — THE GLYPH THE AUTHOR ASKED FOR. `plotshape`/`plotchar` already
      // reached this door as a 0/1 column with `style: 'markers'`; what was
      // missing was WHICH glyph, WHERE, and WHAT IT SAYS.
      //
      // ⛔ ONLY ON A `markers` ROW, because that is the only combination
      // `defSchema.validateMarker` accepts — a marker on a line plot would be
      // two renderers over one column. A row whose style the member has since
      // changed drops its marker rather than making the document unsaveable.
      ...(r.marker && r.marker.shape && r.style === 'markers' ? { marker: r.marker } : {}),
      // ⭐ 2026-09-26 — A LEFTWARD PLOT DISPLACEMENT (Pine `offset = -N`), a DRAWING
      // fact the binder applies; the tree and its column stay undisplaced. Only a
      // negative whole number is carried — a rightward one is already `x[N]` in the
      // tree, and carrying it here too would shift it twice.
      ...(Number.isInteger(r.displace) && r.displace < 0 ? { displace: r.displace } : {}),
      // …and its relation to a parameter, kept even at 0 bars so a later edit can
      // move it off 0 again.
      ...(r.displaceFrom ? { displaceFrom: { ...r.displaceFrom } } : {}),
      // ⭐⭐ C1-B — the band, as `defSchema.plots[].fill` already validates it.
      // ⛔ ONLY WHEN THE NAMED EDGE IS REALLY IN THIS DOCUMENT. `defSchema`
      // refuses a fill naming a plot nobody declares, so a stale `with` would
      // make the whole document unsaveable rather than merely undrawn.
      ...(r.fill && r.fill.with && rows.some((o) => o.key === r.fill.with)
        ? {
          fill: {
            with: r.fill.with,
            // ⭐ e97 U7 — the band drawn as the instance's settings decide (`binder.fillActiveFor` → `plotHiddenAt`)
            ...(r.fill.hiddenWhen ? { hiddenWhen: r.fill.hiddenWhen } : {}),
            // ⭐⭐ (j) j.3b(b) / R34 — THE BAND'S OWN CONDITIONAL COLOUR, in the
            // SAME three field names a plot uses twenty lines above. That is not a
            // convenience: `pool.columnColorsForPlot` is handed the fill verbatim,
            // so a third spelling would be a second reader for one idea (R10).
            //
            // ⛔ ALL THREE OR NONE, for the same reason the plot rule says so — a
            // `column:` mode with nothing to alternate between registers happily
            // and then draws one flat colour.
            // ⛔ AND ONLY WHEN THE NAMED COLUMN IS REALLY IN THIS DOCUMENT, the
            // same guard `fill.with` already gets: a mode naming a column nobody
            // declares makes the whole document unsaveable rather than merely
            // uncoloured.
            ...(r.fill.colorMode && r.fill.colorUp && r.fill.colorDown
              && rows.some((o) => o.key === String(r.fill.colorMode).slice('column:'.length))
              ? {
                colorMode: r.fill.colorMode,
                colorUp: r.fill.colorUp,
                colorDown: r.fill.colorDown,
                // ⭐⭐ …and which `input.color` each colour IS, when the script's is
                // one (`memberPaneDefinition`): the member's pick then colours the
                // band (`binder.bandColoursFor`). Only an input this document declares.
                ...(typeof r.fill.colorUpInput === 'string'
                  && declared.some((s) => s.key === r.fill.colorUpInput && s.type === 'color')
                  ? { colorUpInput: r.fill.colorUpInput, ...(r.fill.colorUpInputOwnAlpha === true ? { colorUpInputOwnAlpha: true } : {}) } : {}),
                ...(typeof r.fill.colorDownInput === 'string'
                  && declared.some((s) => s.key === r.fill.colorDownInput && s.type === 'color')
                  ? { colorDownInput: r.fill.colorDownInput, ...(r.fill.colorDownInputOwnAlpha === true ? { colorDownInputOwnAlpha: true } : {}) } : {}),
              }
              : {}),
            ...(r.fill.colorMode && !r.fill.colorUp && Array.isArray(r.fill.colorPalette)
              && r.fill.colorPalette.length >= 2
              && rows.some((o) => o.key === String(r.fill.colorMode).slice('column:'.length))
              ? { colorMode: r.fill.colorMode, colorPalette: r.fill.colorPalette.slice() }
              : {}),
          },
          ...(typeof r.fillColor === 'string' ? { fillColor: r.fillColor } : {}),
          ...(typeof r.fillColorInput === 'string'
            && declared.some((s) => s.key === r.fillColorInput && s.type === 'color')
            ? { fillColorInput: r.fillColorInput } : {}),
          ...(Number.isFinite(r.fillOpacity) ? { fillOpacity: r.fillOpacity } : {}),
          // ⭐ the band's raw transparency stamp, when the Pine door read one
          // (`memberDocumentMigration.upgradeFromDoorStamps`). A row that does not
          // carry it (every manual and conversational edit) writes none.
          ...(r.fillTransparency && typeof r.fillTransparency.via === 'string'
            ? { fillTransparency: { ...r.fillTransparency } } : {}),
        }
        : {}),
      // ⭐ P3 — A ROW'S LINE STYLE (`defSchema.PLOT_LINE_STYLES`, drawn by
      // `pool.lineStyleValue`). Only a row that CARRIES one writes it, so every
      // document whose rows name none stays byte-identical. The manual sheet's
      // rows never hold it (its reopen leaves it to `preservePresentation`); the
      // conversational row model does, so a dashed plot is representable there.
      // Last, where `preservePresentation` has always appended it.
      ...(PLOT_LINE_STYLES.includes(r.lineStyle) ? { lineStyle: r.lineStyle } : {}),
      // ⭐ ROW 42 (2026-11-17) — "BREAKS WHERE IT HAS NO VALUE" (`plots[].sparse`), an
      // AUTHORED choice: a Pine "with breaks" style, or the conversation's
      // `set_style.breaks`. Only a row that carries `true` writes it, so every
      // document whose rows do not stays byte-identical and keeps drawing joined.
      ...(r.sparse === true ? { sparse: true } : {}),
      // ⭐⭐ LINE IDENTITY (owner decision 2026-11-02) — a row ADDED in this edit (or
      // re-keyed) tells the store it is a NEW line, so a key removed and typed again
      // before one save does not inherit the removed line's references or alerts
      // (`api/services/user_definitions.py::decide_line_ids`). The store never keeps
      // the marker. A row restored from the saved document never carries it, so
      // every existing document's bytes are unchanged.
      ...(rowIsNewLine(r) ? { [NEW_LINE_FLAG]: true } : {}),
    }
  })
  const guides = Array.isArray(levels) && levels.length
    ? [{ key: LEVELS_PLOT_KEY, label: 'Levels', style: 'hlines', levels: [...levels], ...LEVELS_GUIDE }]
    : []

  return {
    schemaVersion: SCHEMA_VERSION,
    id: defId,
    version,
    // ⭐⭐ C3B — THE OBJECT PROGRAM RIDES ON THE DOCUMENT, BESIDE THE COLUMNS.
    // ⛔ AND IT IS OMITTED WHEN THERE IS NONE. 14 of the frozen 60 draw no
    // objects at all and their saved documents must stay byte-identical — an
    // empty `objects: {}` on every save would change every hash in the repo and
    // buy nothing. Same additive discipline as `paramManifest` above.
    ...(objects && Array.isArray(objects.ops) && objects.ops.length ? { objects } : {}),
    // ⭐⭐ P1 — a paint reads a column of THIS document; one naming a key no row
    // declares is dropped here rather than making the document unsaveable.
    ...(paintList && paintList.some((p) => rows.some((r) => `column:${r.key}` === p.colorMode || !p.colorMode))
      ? { paints: paintList.filter((p) => !p.colorMode || rows.some((r) => `column:${r.key}` === p.colorMode)) }
      : {}),
    compute: {
      kind: 'ast', fn: astHash(scan.ast), rev, ast: scan.ast, source: scan.source,
      // ⭐ TRACK F (DEC-006) — additive, OMITTED for every non-Pine save. A
      // `treeIndex: null` locator (the only kind `legacyDefinition`'s single-
      // tree path ever produces) resolves against `compute.ast` regardless of
      // whether this document is single- or multi-plot, since `compute.ast`
      // stays aliased to the CURRENT scan row's tree either way (`ast:
      // scan.ast` above) — so a Pine import that later gains unrelated extra
      // plot rows keeps its parameter correctly attached without this branch
      // needing to know anything about `treeIndex` remapping.
      // ⚠️ KNOWN, DISCLOSED V1 EDGE CASE: if the member REASSIGNS which row
      // is the scan plot AFTER importing a parameterized Pine script into a
      // different row, this `null` locator now points at the NEW scan row's
      // tree, not the one the parameter was minted from — server-side
      // reconciliation still fails safely (a mismatched position either
      // doesn't resolve, going `detached`, or coincidentally resolves to an
      // unrelated literal) but never something this v1 pass builds active
      // tracking for. Not reachable from the golden-journey fixture (a
      // single-plot import never reassigns `scanPlot`).
      ...(paramManifest && Object.keys(paramManifest).length ? { paramManifest } : {}),
      ...(multi ? {
        trees,
        treesHash: treesHash(trees),
        scanPlot: scan.key,
        // ⛔ EVERY TREE CARRIES THE TEXT THE MEMBER EDITS. `compute.source` is
        // ONE string — the scan tree's — so without this a multi-plot document
        // could be computed and never reopened: the edit path would have three
        // trees and one source text and no honest way to fill the other boxes.
        sources: Object.fromEntries(rows.map((r) => [r.key, r.source])),
      } : {}),
    },
    meta: {
      name: trimmed,
      shortName: short,
      category: 'Custom',
      description: scan.readback || readback,
      tags: ['custom'],
      tier: 'premium',
      // ⛔ THE WORST AND THE STALEST, because a document draws every plot at
      // once. `validateAstLane` re-measures both the same way and refuses a
      // disagreement in either direction.
      repaint: worstRepaint(rows.map((r) => r.mode)),
      freshness: stalestFreshness(rows.map((r) => freshnessFor(r.ast, scope).mode)),
    },
    placement: placement || PANE_PLACEMENT(),
    inputs: declared.map((spec) => ({ ...spec })),
    plots: [...dataPlots, ...guides],
  }
}

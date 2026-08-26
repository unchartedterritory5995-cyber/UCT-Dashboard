// app/src/components/chart/builder/BuilderSheet.jsx
//
// ─── THE BUILDER (spec §6) ──────────────────────────────────────────────────
//
// A trader types a formula; the parser turns it into the tree that IS the
// persisted artifact; the read-back tells them, in English derived from that
// tree, what they are about to save; the linter decides the badge; the store
// appends a version.
//
// ⛔ THE READ-BACK IS SHOWN, NOT PARAPHRASED. `sentence.js` deliberately refuses
// to smooth: `&&`, `||` and `?:` state all three cases with NaN as "nothing",
// because the tempting reading of `?:` — *"{1} when {0}, otherwise {2}"* — is a
// LIE for the NaN case, and NaN is what the binder actually draws there. So this
// file renders what `sentenceFor` returns and adds not one word of its own. A UI
// that re-words the read-back is a second description of the maths, and the
// user would be confirming the one that is not running.
//
// ⛔ THE BADGE IS MACHINE-ASSIGNED AND IT IS A GATE (spec §1.3). `meta.repaint`
// on the saved document is `lintRepaint(ast).mode` — not a field this form
// offers. `nativeRegistry.validateAstLane` then refuses the document in BOTH
// directions if the declaration disagrees with its own re-measurement, because
// under-claiming is as false as over-claiming.
//
// ⛔ IT NEVER WRITES `chart_settings`. `mergeChartSettings` is a hard allow-list
// whose return literal DESTROYS an unknown top-level key on every read — the
// mechanism that deleted `engineEnabled` at seven sites and that Task 10
// re-measured against a key called `userDefinitions`. A feature that silently
// forgets is worse than one that refuses.
//
// ✅ IT ADDS AN INSTANCE TO THE CHART ON SAVE — PHASE D TASK 16 — AND UNTIL
// TASK 16 IT DELIBERATELY DID NOT.
//
// What stood here, in Task 11's own words: *"AND IT DOES NOT ADD AN INSTANCE TO
// THE CHART, WHICH IS A DELIBERATE REFUSAL, MEASURED. `StockChart` hands the
// binder `registry: engineRegistry` and calls `normalizeInstances(source,
// engineRegistry).kept` — a module-level index built at import from
// `[...NATIVE_DEFS, ...SERVER_DEFS, ...AST_DEFS]`, where `AST_DEFS` is
// deliberately `[]`. Nothing in the product installs a USER definition into it,
// so an instance written here would validate against a definition the renderer
// cannot resolve and be DROPPED on the next paint. Writing it anyway is exactly
// the 'live control that writes nowhere' defect this phase retires."*
//
// Every sentence of that was TRUE and is now FALSE, and it is kept rather than
// deleted because it is the reason the wiring below is in this order.
// `nativeRegistry.installUserDefinitions` is the door that did not exist; the
// instance is written only AFTER the saved document installs through it, and
// only after the STORE has minted the real id — so the instance names a
// definition the renderer can already resolve, on this chart, on this paint. If
// the install refuses (a stored verdict gone stale, a shipped id), the save
// still stands, the instance is NOT written, and the refusal is shown: a formula
// that cannot draw is reported as one, never quietly added to the chart.
//
// ✅ AND A SAVED FORMULA CAN NOW BE OPENED AND CHANGED — THE EDIT PATH.
//
// `PUT /api/user-definitions/{def_id}` shipped with Task 10 and had NO PRODUCT
// CALLER, which is why `compute.rev` in every stored blob had stayed `1` since
// Phase D shipped: the store models an edit exactly right — append a version,
// bump `rev` iff the maths moved, force-migrate every bound alert — and nothing
// on any screen could reach it. A member could author a formula, chart it, find
// it and alert on it, and never change it.
//
// ⛔ ONE WRITE DOOR, NOT TWO. Editing reuses `buildDefinition` →
// `validateUserDefinitions` → `saveUserDefinition` → `installUserDefinitions`
// verbatim; the ONLY differences are the id (the store's, not a fresh draft),
// the HTTP verb (`saveUserDefinition`'s second argument), and that an edit does
// NOT call `addInstance` — the instance already exists and naming it twice would
// draw the same formula twice on the same chart. A second save routine would be
// a second set of gates to keep in step, which is the shape this phase retires.
//
// ⛔ AND A REFUSED EDIT LEAVES THE OLD VERSION WORKING. The validation door runs
// BEFORE the network write, so a formula the registry refuses never reaches the
// store: no version is appended, no `rev` moves, no migration fires, and the
// definition the chart is already drawing is never re-installed. A broken edit
// must not brick a working indicator.

import { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Sheet from '../../mobile/Sheet'
import UIcon from '../../ui/UIcon'
import { PORTAL_POPUP_ATTR } from '../ColorPicker'
import { SCHEMA_VERSION } from '../engine/defSchema'
import { astHash } from '../engine/ast/parse'
// ⛔ THE SECOND MACHINE-ASSIGNED BADGE, AND IT IS MEASURED HERE FOR THE SAME
// REASON `repaint` IS: `validateUserDefinitions` REQUIRES `meta.freshness` on
// the `ast` lane and refuses a disagreement in both directions, so a document
// this form built without it would be refused at its own save door.
import { freshnessFor } from '../engine/ast/freshness'
// ⛔ THE INPUTS THE SAVED DOCUMENT DECLARES AND THE SCOPE THE READ-BACK IS GIVEN
// COME FROM ONE MODULE, so "the sentence may name it" and "the document declares
// it" are the same fact rather than two lists somebody keeps in step.
import { BUILDER_INPUTS, BUILDER_INPUT_SCOPE, chromeInputKeys, chromeInputsFor } from './builderInputs'
import { declaredInputs } from '../engine/ast/lint'
// ⛔ THE TWO BADGE AGGREGATORS, IMPORTED FROM THE ONE MODULE THAT OWNS THEM.
// `nativeRegistry.validateAstLane` RE-MEASURES `meta.repaint` and
// `meta.freshness` against the same helpers and refuses a disagreement in both
// directions — so a document this form aggregated its own way could never be
// saved, or could be saved under a badge the gate would not have chosen.
import { treesHash, worstRepaint, stalestFreshness } from '../engine/ast/trees'
import TABLE from '../engine/ast/closedTable.json'
import * as engineRegistry from '../engine/nativeRegistry'
import { validateUserDefinitions, installUserDefinitions } from '../engine/nativeRegistry'
import { addInstance } from '../engine/instanceControls'
import {
  useUserDefinitions, saveUserDefinition, deleteUserDefinition,
} from '../../../hooks/useUserDefinitions'
import FormulaField, { evaluateFormula, canSaveFormula } from './FormulaField'
import ConciergeBox from './ConciergeBox'
import CriteriaPicker from './CriteriaPicker'
import StarterLibrary from './StarterLibrary'
import PineBox from './PineBox'
import styles from './BuilderSheet.module.css'

const FOCUSABLE = 'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),'
  + 'textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

/** The badge vocabulary, cased for display. ⛔ The definition's vocabulary is
 *  the authority (`lint.REPAINT_MODES`); this only cases it. Informational
 *  styling for the clean value, warning styling for the other two — a factual
 *  property is not an error, but a forward reference is a warning. */
const REPAINT_LABEL = {
  'non-repainting': 'Non-repainting',
  'preview-repaints': 'Preview-repaints',
  repaints: 'Repaints',
}

/** A client-side id, replaced by the server on a create.
 *
 *  ⛔ THE SERVER MINTS THE REAL ONE. This exists only so the document can be run
 *  through `validateUserDefinitions` — the shipped validation door — BEFORE it
 *  is sent, and `defSchema`'s `ID_RE` needs something to look at. Sending a
 *  guessed id as authoritative would let one member write into another's
 *  namespace, which is why `POST` overwrites whatever arrives. */
export function draftDefId() {
  const bytes = new Uint8Array(6)
  const c = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes)
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256)
  return 'u_' + [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * The document that gets stored — and it is the ONLY place this surface decides
 * what a user definition looks like.
 *
 * ⭐ `compute.fn` IS `astHash(ast)`, and that is Task 8's ruling rather than a
 * convention: the tree is the implementation, so there is no third thing to
 * name and "the handle changed" and "the maths changed" become one event.
 *
 * ⭐ `meta.description` IS THE READ-BACK. Derived from the tree, never written
 * by a model and never typed by the author — so the sentence in the indicator
 * library is the same sentence the author confirmed before saving.
 */
/** A chip-sized name: at most `CHIP_NAME_MAX`, cut at a word boundary when there
 *  is a usable one, and never left with a trailing space.
 *
 *  ⚰️ `trimmed.slice(0, 12)` ALONE PRODUCED "Above 50 on  settings". Measured in
 *  production 2026-08-11: saving "Above 50 on volume" gave a chip reading
 *  "Above 50 on " — cut mid-word, trailing space intact — and the controls built
 *  from it read `Hide Above 50 on ` and `Above 50 on  settings`, double space and
 *  all. The cap itself is real (the chip strip is narrow); the ragged edge was not.
 */
const CHIP_NAME_MAX = 12
export function chipName(name) {
  const trimmed = String(name || '').trim()
  if (trimmed.length <= CHIP_NAME_MAX) return trimmed
  const cut = trimmed.slice(0, CHIP_NAME_MAX)
  const lastSpace = cut.lastIndexOf(' ')
  // Only prefer the word boundary when it leaves something worth reading —
  // "Above" beats "Above 50 on", but a single stub is worse than a clean cut.
  const out = lastSpace >= Math.ceil(CHIP_NAME_MAX / 2) ? cut.slice(0, lastSpace) : cut
  return out.trim()
}

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
const PANE_PLACEMENT = () => ({ target: 'pane', pane: { height: 0.15 } })

/**
 * The styles this form offers, and the words it offers them in.
 *
 * ⛔ NO NEW ENUM VALUES. `columns` and `circles` are renderings the vocabulary
 * ALREADY HAS — LWC's `HistogramSeries` IS the full-width column look, and
 * `circles` is `markers` (`lineWidth: 0` + `pointMarkersVisible`, `pool.js`
 * L542–547). Adding either name would need a `case` in `pool.poolKey` AND in
 * `seriesOptionsForPlot` for a picture the engine can already draw, so the
 * second name would exist only to be kept in step with the first.
 *
 * ⛔ AND `cross` IS NOT HERE BECAUSE IT HAS NO RENDERER. LWC 5.2's marker shapes
 * are circle/square/arrowUp/arrowDown and its point markers are circles; a cross
 * needs W6's series primitives. It sits in `RESERVED_PLOT_STYLES` and is refused
 * with the "schema-reserved for a later phase" sentence rather than quietly
 * coerced to `markers`, which is what "circles" already is.
 *
 * ⛔ `hlines` IS ABSENT ON PURPOSE: it is a GUIDE, not a series — `astPlotKey`
 * filters it out of the data plots, so a member who chose it for a formula row
 * would build a plot whose tree nothing ever reads. The Levels box below is how
 * this form writes one, and it writes exactly one.
 * ⛔ `band` IS ABSENT TOO: `validateBandEdges` requires `edges` naming two OTHER
 * plot keys, which is a cross-plot relationship this form has no control for
 * yet. Offering the style without the edges would be a guaranteed refusal.
 */
const PLOT_STYLE_CHOICES = Object.freeze([
  ['line', 'Line'],
  ['stepline', 'Step line'],
  ['histogram', 'Histogram / columns'],
  ['area', 'Area'],
  ['baseline', 'Baseline'],
  ['markers', 'Circles'],
])

/** A blank plot row. ⛔ ITS COLOUR AND WIDTH ARE `BUILDER_INPUTS`' OWN DEFAULTS,
 *  read from the array rather than retyped, so "untouched" means one thing to
 *  the form and to the document. */
function newPlotRow(key) {
  return {
    key,
    label: '',
    style: 'line',
    color: BUILDER_INPUTS[0].default,
    width: BUILDER_INPUTS[1].default,
    hidden: false,
    source: '',
    result: evaluateFormula('', BUILDER_INPUT_SCOPE),
  }
}

/** Is this row exactly what `newPlotRow` produces, but for its source?
 *  ⛔ ONE PREDICATE, because it is what decides whether a document takes the
 *  BYTE-IDENTICAL schema-1 path. Checking a subset of the fields (the brief
 *  checked key and style) silently discards whichever ones it forgot — a
 *  recoloured or hidden plot 1 would have written a document that ignored both. */
function isUntouchedRow(row) {
  return !!row
    && row.key === 'value'
    && row.style === 'line'
    && row.hidden !== true
    && String(row.label || '').trim() === ''
    && row.color === BUILDER_INPUTS[0].default
    && row.width === BUILDER_INPUTS[1].default
}

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
function legacyDefinition({ defId, version, rev, source, ast, mode, readback, declared, trimmed, short }) {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: defId,
    version,
    compute: { kind: 'ast', fn: astHash(ast), rev, ast, source },
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
      label: short || 'Value',
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
  plots = null, scanPlot = null, placement = null, levels = null }) {
  // ⛔ ONE LIST, READ TWICE — never two lists that agree today. The freshness
  // scope below and the document's own `inputs` are the SAME array, because a
  // member-declared name that reached one and not the other would badge a
  // formula off a scope the saved document does not carry.
  const declaredMember = Array.isArray(inputs) && inputs.length ? inputs : BUILDER_INPUTS
  const trimmed = String(name || '').trim()
  const short = chipName(trimmed)

  if (plots === null && placement === null && levels === null) {
    return legacyDefinition({
      defId, version, rev, source, ast, mode, readback,
      declared: declaredMember, trimmed, short,
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
      label: r.label || (i === 0 ? (short || r.key) : r.key),
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
    }
  })
  const guides = Array.isArray(levels) && levels.length
    ? [{ key: LEVELS_PLOT_KEY, label: 'Levels', style: 'hlines', levels: [...levels], ...LEVELS_GUIDE }]
    : []

  return {
    schemaVersion: SCHEMA_VERSION,
    id: defId,
    version,
    compute: {
      kind: 'ast', fn: astHash(scan.ast), rev, ast: scan.ast, source: scan.source,
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

/**
 * ⛔ SPEC §6's INSTANCE STATES HAVE TEN MEMBERS AND NONE OF THEM IS "THE PAGE
 * DIED". A parse failure is the normal case on this surface, so `parseFormula`
 * never throws and `evaluateFormula` never throws — but a boundary is what makes
 * "and it did not crash" an assertion something can FAIL rather than a hope.
 * `queryByTestId('builder-crash')` is null only because nothing threw.
 */
export class BuilderBoundary extends Component {
  constructor(props) { super(props); this.state = { err: null } }

  static getDerivedStateFromError(err) { return { err } }

  render() {
    if (this.state.err) {
      return (
        <div className={styles.crash} data-testid="builder-crash" role="alert">
          The formula builder stopped responding. Close this panel and try again.
        </div>
      )
    }
    return this.props.children
  }
}

export default function BuilderSheet({
  open, onClose, onSaved = null, settings = null, onChange = null, bars = null,
}) {
  /** ⭐ THE MEMBER'S OWN INPUTS. `color` and `lineWidth` are chrome every
   *  definition carries; these are the ones that make an indicator TUNABLE —
   *  `period` in `exp(-1.414 * 3.14159 / period)` instead of a baked-in 20. */
  const [memberInputs, setMemberInputs] = useState([])

  // ── THE PLOTS (W1b.5) ──────────────────────────────────────────────────────
  //
  // ⭐ PLOT 1 IS THE FORMULA BOX AT THE TOP OF THE SHEET, not a fourth row of
  // chrome: its source lives in `source`/`result` exactly as it always has, and
  // this state holds only the things a plot has BESIDES its maths. That is what
  // keeps a single-plot document byte-identical — the default row IS the shape
  // this form has written since Phase D.
  const [plot0, setPlot0] = useState(() => newPlotRow('value'))
  /** Rows 2..n — each with its OWN source and its own evaluation. */
  const [plotRows, setPlotRows] = useState([])
  /**
   * ⛔ THE SCAN CHOICE IS AN INDEX, NOT A KEY, AND THAT IS NOT A DETAIL. The
   * DOCUMENT names a key (`compute.scanPlot`), because a stored key is the only
   * thing a scan can bind to. But while the member is typing, the key is a
   * FIELD THEY ARE EDITING — hold the choice by key and renaming the chosen row
   * detaches the scan from the radio that still shows it selected, and
   * `buildDefinition` silently falls back to plot 1. The index is stable across
   * a rename by construction; `save()` turns it into the key at the one moment a
   * key is real.
   */
  const [scanIndex, setScanIndex] = useState(0)
  /** `'pane'` | `'price'`. ⛔ THE DOCUMENT VALUE IS `'price'`; "Overlay on
   *  price" is the SELECT'S LABEL. Three consumers read `PLACEMENT_TARGETS`
   *  (`placement.js`, `instances.js`, `instanceControls.placementFor`) and a
   *  fourth spelling of "the candles' scale" would need all three to learn it. */
  const [target, setTarget] = useState('pane')
  const [levelsText, setLevelsText] = useState('')

  /** Every plot row in document order — plot 1 first. */
  const allRows = useMemo(() => [plot0, ...plotRows], [plot0, plotRows])

  /**
   * ⛔ THE SCOPE'S IDENTITY IS ITS NAME SET, NOT THE ROWS IT WAS DERIVED FROM.
   * `FormulaField` keeps `inputs` in its debounce dependency list, so an object
   * that changed whenever a COLOUR moved — or whenever ANOTHER ROW'S SOURCE did
   * — would restart every row's 250 ms timer on every keystroke in any of them,
   * and a box would never settle while a sibling was being typed in. The
   * signature is the only thing the memo depends on, so the scope is a new
   * object exactly when a declared NAME appears or disappears.
   */
  const inputKeySig = useMemo(
    () => [
      ...chromeInputsFor(allRows).map((spec) => spec.key),
      ...memberInputs.map((spec) => spec.key),
    ].join(' '),
    [allRows, memberInputs],
  )
  const inputScope = useMemo(
    () => declaredInputs({
      inputs: inputKeySig.split(' ').filter(Boolean).map((key) => ({ key })),
    }),
    [inputKeySig],
  )

  /** Every name the closed table already owns — DERIVED from the manifest, never
   *  a list typed here. ⛔ An input called `close` would be shadowed by the real
   *  series and silently do nothing: the formula would parse, lint, save and draw
   *  the wrong thing, which is the exact failure this builder keeps finding. */
  const TABLE_NAMES = useMemo(() => new Set([
    ...Object.keys(TABLE.series || {}),
    ...Object.keys(TABLE.functions || {}),
    ...Object.keys(TABLE.scalars || {}),
  ]), [])
  /** The settings the PLOTS own — `color`/`lineWidth` plus a pair per later row.
   *  ⛔ READ OFF `chromeInputsFor`, THE SAME FUNCTION `buildDefinition` BUILDS
   *  `inputs[]` WITH. A `${key}Color` typed here would be a second authority
   *  over one naming rule, and the day it moved a member could declare an input
   *  that collides with a plot's own setting — refused by `defSchema` as a
   *  duplicate key, which is a true sentence about the wrong thing. */
  const chromeKeys = useMemo(
    () => new Set(chromeInputsFor(allRows).map((spec) => spec.key)),
    [allRows],
  )

  /** Why this key cannot be used, or `null`. Returned as a SENTENCE, because the
   *  refusal messages elsewhere in this engine are the part members can act on. */
  const inputKeyProblem = useCallback((key, atIndex) => {
    if (!key) return 'give the input a name'
    if (!/^[a-z][a-zA-Z0-9_]*$/.test(key)) {
      return 'a name starts with a lowercase letter and holds letters, digits and underscores'
    }
    if (TABLE_NAMES.has(key)) return `\`${key}\` is already a name this engine computes`
    // ⛔ A DIFFERENT SENTENCE, BECAUSE IT IS A DIFFERENT FACT. `signalColor` is
    // not something the engine computes — it is a setting the member's own plot
    // brought with it, and saying otherwise sends them looking in the manual.
    if (chromeKeys.has(key)) return `\`${key}\` is a setting one of your plots already uses`
    if (allRows.some((r) => r.key === key)) return `\`${key}\` is the key of one of your plots`
    if (memberInputs.some((spec, i) => i !== atIndex && spec.key === key)) {
      return `this formula already declares \`${key}\``
    }
    return null
  }, [TABLE_NAMES, chromeKeys, allRows, memberInputs])

  /**
   * Why this PLOT key cannot be used, or `null`. Same shape as `inputKeyProblem`
   * — and DELIBERATELY A SHORTER LIST, which is the difference between the two
   * namespaces rather than an omission.
   *
   * ⚰️ THE BRIEF SAID A CLOSED-TABLE NAME MUST BE REFUSED HERE TOO, AND ITS OWN
   * FLAGSHIP EXAMPLE DISPROVES IT: `macd` IS a declared function in
   * `closedTable.json` (measured), so that rule refuses the MACD document this
   * whole task exists to make authorable — and the SHIPPED `macd` native already
   * uses `macd` as a plot key.
   *
   * ⛔ THE REASON THE INPUT RULE DOES NOT TRANSFER: `parse.js` turns every
   * identifier into a `series` node, so an INPUT called `close` is shadowed by
   * the real series and silently computes something else. A PLOT key is not an
   * identifier in any formula — it is an addressing handle (`defId.macd`), a
   * column name and a `compute.trees` key, all of them namespaced by the
   * definition's id. `defSchema.validatePlot` agrees: it checks `KEY_RE` and
   * uniqueness and says nothing about the table.
   */
  const plotKeyProblem = useCallback((key, atIndex) => {
    if (!key) return 'give the plot a key'
    if (!/^[a-z][a-zA-Z0-9_]*$/.test(key)) {
      return 'a key starts with a lowercase letter and holds letters, digits and underscores'
    }
    if (key === LEVELS_PLOT_KEY) return `\`${key}\` is reserved for the levels guide`
    if (allRows.some((r, i) => i !== atIndex && r.key === key)) {
      return `this formula already has a plot called \`${key}\``
    }
    // The other direction of the collision `inputKeyProblem` guards: a plot
    // named `x` needs the settings `xColor`/`xWidth`, and a member input may
    // already have taken one of them. This one IS a real collision — the two
    // land in the same `inputs[]` array.
    const keys = chromeInputKeys({ key }, atIndex)
    if (memberInputs.some((spec) => spec.key === keys.color || spec.key === keys.width)) {
      return `a plot called \`${key}\` needs the settings \`${keys.color}\` and \`${keys.width}\`, `
        + 'and this formula already declares one of them'
    }
    return null
  }, [allRows, memberInputs])

  /** The comma list, as numbers. ⛔ PARSED ONCE — the guide plot, the save gate
   *  and the refusal sentence all read this, never `levelsText` a second time. */
  const levels = useMemo(
    () => levelsText.split(',').map((s) => s.trim()).filter(Boolean).map(Number),
    [levelsText],
  )
  const levelsProblem = levels.some((n) => !Number.isFinite(n))
    ? 'levels are numbers separated by commas'
    : null

  const patchPlot = useCallback((i, patch) => {
    if (i === 0) { setPlot0((prev) => ({ ...prev, ...patch })); return }
    setPlotRows((prev) => prev.map((r, j) => (j === i - 1 ? { ...r, ...patch } : r)))
  }, [])
  const addPlot = useCallback(() => {
    setPlotRows((prev) => [...prev, newPlotRow('')])
  }, [])
  const removePlot = useCallback((i) => {
    setPlotRows((prev) => prev.filter((_, j) => j !== i - 1))
    // ⛔ THE SCAN MOVES WITH THE LIST. Removing the chosen row must not leave the
    // choice pointing at whatever slid into its place, and removing a row ABOVE
    // it must not slide the choice off the row the member picked.
    setScanIndex((k) => (k === i ? 0 : (k > i ? k - 1 : k)))
  }, [])
  /** A row's own settle. ⛔ Compared by SOURCE, like `handleEvaluated`, so a
   *  late timer from an older keystroke cannot overwrite a newer verdict. */
  const handlePlotEvaluated = useCallback((i, next) => {
    setPlotRows((prev) => {
      const cur = prev[i - 1]
      if (!cur || (cur.result && cur.result.source === next.source)) return prev
      return prev.map((r, j) => (j === i - 1 ? { ...r, result: next } : r))
    })
  }, [])
  /** ⛔ ONE RESET, THREE CALLERS (open, cancel-edit, and the edit restore's own
   *  refusal path). Five `setX` lines copied three times is how one of them ends
   *  up with four. */
  const resetPlots = useCallback(() => {
    setPlot0(newPlotRow('value')); setPlotRows([]); setScanIndex(0)
    setTarget('pane'); setLevelsText('')
  }, [])

  const inputsValid = memberInputs.every((spec, i) => inputKeyProblem(spec.key, i) === null)

  const addInput = useCallback(() => {
    setMemberInputs((prev) => [...prev, { key: '', type: 'int', label: '', default: 14, min: 1, max: 500 }])
  }, [])
  const patchInput = useCallback((i, patch) => {
    setMemberInputs((prev) => prev.map((spec, j) => (j === i ? { ...spec, ...patch } : spec)))
  }, [])
  const removeInput = useCallback((i) => {
    setMemberInputs((prev) => prev.filter((_, j) => j !== i))
  }, [])

  const [source, setSource] = useState('')
  const [name, setName] = useState('')
  const [result, setResult] = useState(() => evaluateFormula('', BUILDER_INPUT_SCOPE))
  const [acknowledged, setAcknowledged] = useState(false)
  const [storeError, setStoreError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [savedRow, setSavedRow] = useState(null)
  /** Escape / Cancel asked to close while there was unsaved work. See `dirty`. */
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  /** Bumped whenever a lane OTHER than the concierge writes the formula box —
   *  a starter, a Pine paste. `ConciergeBox` compares it against the value its
   *  description was last typed against, and says so rather than deleting it. */
  const [replacedAt, setReplacedAt] = useState(0)
  const [copied, setCopied] = useState(false)
  // ⭐ THE EDIT TARGET: `{defId, version}` off the STORE's row, or null for a
  // create. It is the id the store minted — never `draftDefId()`'s — because the
  // instance already on the chart names that one and a PUT at any other id is a
  // second definition wearing an edit's clothes.
  const [editing, setEditing] = useState(null)
  // ⭐ WHICH DOOR IS OPEN, AND NOTHING MORE. `buildMode` decides whether the
  // picker is on screen; it is NOT persisted, NOT written into the document and
  // NOT read back — the saved artifact is the same one either door produces.
  //
  // ⭐⭐ A NEW FORMULA OPENS ON THE LIBRARY, AND AN EDIT OPENS ON THE FORMULA.
  // (E-8 raised this and left it as an owner call; the owner delegated it.)
  //
  // The argument that settles it is that `FormulaField` is rendered in EVERY
  // mode and autofocused in every mode — the tab only decides what sits ABOVE
  // the box. So "Formula" as the default renders nothing above a focused box,
  // and "Library" renders the firm's own worked scans above the same focused
  // box: their names, what each one computes in the tree's own words, and their
  // source. Nobody loses the ability to type; a member who does not know the
  // syntax gains three examples of it and a one-click way to put one in the box
  // and change it, which is how TC2000 and TradingView onboard.
  //
  // ⛔ AN EDIT IS THE OTHER CASE AND IT IS NOT THE SAME ONE. A member editing a
  // formula they already own has no use for starters above their own work, so
  // `openForEdit` moves the sheet to Formula. `BuilderSheet.starters.test.jsx`
  // holds both halves.
  const [buildMode, setBuildMode] = useState('library')
  const [pickerNote, setPickerNote] = useState(null)
  const rootRef = useRef(null)

  const { rows, error: listError } = useUserDefinitions()

  // A new sheet is a new formula. Leaving the previous one behind would offer a
  // Save button whose read-back describes a tree the box no longer shows.
  useEffect(() => {
    if (!open) return
    setSource(''); setName(''); setMemberInputs([]); setResult(evaluateFormula('', inputScope))
    setAcknowledged(false); setStoreError(null); setSavedRow(null); setCopied(false)
    setEditing(null); setBuildMode('library'); setPickerNote(null)
    // ⛔ THE PLOTS RESET TOO. A sheet reopened with the previous formula's second
    // plot still in it would offer a Save whose document names a tree the box no
    // longer shows — the same reason `source` and `name` are cleared here.
    resetPlots()
  }, [open, resetPlots])

  /** Open a stored formula for editing — its SOURCE, its name, and its id.
   *
   *  ⛔ `compute.source` IS WHAT GOES BACK IN THE BOX, NOT THE TREE. The source is
   *  what the author typed and what `parseFormula` round-trips; re-deriving text
   *  from the AST would put a sentence the user never wrote into the field they
   *  are about to edit, and the two would diverge the first time the printer and
   *  the parser disagreed about precedence. A row with no stored source cannot be
   *  edited here and says so rather than opening an empty box over a live
   *  definition. */
  const openForEdit = useCallback((row) => {
    const def = row?.definition || null
    const compute = def?.compute || {}
    const src = compute.source
    setStoreError(null); setSavedRow(null); setCopied(false); setAcknowledged(false)
    if (typeof src !== 'string' || src.trim() === '') {
      setEditing(null)
      setStoreError('This formula was stored without its source text, so it cannot be edited here.')
      return
    }

    // ── the v2 restore ───────────────────────────────────────────────────────
    //
    // ⛔⛔ THE ROWS COME FROM `compute.sources`, NOT FROM `compute.source`. On a
    // multi-tree document `compute.source` is the SCAN tree's text and nothing
    // else — it is an ALIAS, not the first plot's source — so a restore that
    // read it would put the scan's formula in plot 1's box and lose the rest.
    // That is exactly why `sources` is REQUIRED on a v2 document: an unstated
    // per-plot source is a document that can be computed and never reopened.
    //
    // ⛔ AND THE SCOPE IS THE DOCUMENT'S OWN, not this render's `inputScope`.
    // The stored `inputs[]` is what the definition declares; reading the sheet's
    // current scope here would evaluate a formula against knobs from whatever
    // was in the box a moment ago — and it is why a saved formula naming
    // `period` used to reopen with `period` undeclared and refused on sight.
    const scope = declaredInputs(def)
    const defPlots = Array.isArray(def?.plots) ? def.plots : []
    const dataDefs = defPlots.filter((p) => p && typeof p.key === 'string' && p.style !== 'hlines')
    const guide = defPlots.find((p) => p && p.style === 'hlines' && Array.isArray(p.levels))
    const inputsByKey = new Map(
      (Array.isArray(def?.inputs) ? def.inputs : []).map((spec) => [spec?.key, spec]),
    )
    const metaShort = chipName(String(def?.meta?.name || ''))
    const sourceFor = (key, i) => {
      const stored = compute.sources && compute.sources[key]
      if (typeof stored === 'string' && stored.trim() !== '') return stored
      // A single-tree document carries no `sources` map, and `compute.source` IS
      // its one plot's text. Anything else has a row with nothing to edit.
      return (i === 0 && !compute.sources) ? src : null
    }
    const restored = dataDefs.map((p, i) => {
      const rowSrc = sourceFor(p.key, i)
      if (rowSrc === null) return null
      const keys = chromeInputKeys(p, i)
      const colorSpec = inputsByKey.get(keys.color)
      const widthSpec = inputsByKey.get(keys.width)
      // ⭐ AN EMPTY LABEL BOX MEANS "USE THE DERIVED ONE", so a label that IS the
      // derived one comes back empty. Restoring the derived string into the box
      // would turn a default into a typed value the member never typed, and the
      // next rename would silently stop moving the plot's chip with it.
      const derived = i === 0 ? (metaShort || p.key) : p.key
      return {
        key: p.key,
        label: (typeof p.label === 'string' && p.label !== derived) ? p.label : '',
        style: typeof p.style === 'string' ? p.style : 'line',
        color: (colorSpec && typeof colorSpec.default === 'string' && colorSpec.default)
          ? colorSpec.default : BUILDER_INPUTS[0].default,
        width: (widthSpec && Number.isFinite(widthSpec.default))
          ? widthSpec.default : BUILDER_INPUTS[1].default,
        hidden: p.hidden === true,
        source: rowSrc,
        result: evaluateFormula(rowSrc, scope),
      }
    })
    if (!restored.length || restored.some((r) => r === null)) {
      // ⛔ THE SAME SENTENCE, FOR THE SAME FACT, one plot down. A row whose text
      // was never stored cannot be edited here either, and opening the other
      // rows over it would offer a Save that silently dropped a plot.
      setEditing(null)
      resetPlots()
      setStoreError('This formula was stored without its source text, so it cannot be edited here.')
      return
    }

    const chromeKeySet = new Set(chromeInputsFor(restored).map((spec) => spec.key))
    setPlot0(restored[0])
    setPlotRows(restored.slice(1))
    // The DOCUMENT names a key; the sheet holds the index it points at. An
    // unrecognised key is plot 1, which is what `buildDefinition` would have
    // resolved it to anyway — one fallback, not two.
    const scanAt = dataDefs.findIndex((p) => p.key === compute.scanPlot)
    setScanIndex(scanAt >= 0 ? scanAt : 0)
    setTarget(def?.placement?.target === 'price' ? 'price' : 'pane')
    setLevelsText(guide ? guide.levels.join(', ') : '')
    // ⚰️ AND THE MEMBER'S OWN INPUTS COME BACK, WHICH THEY DID NOT BEFORE. A
    // saved formula naming `period` reopened with `period` undeclared — so the
    // box the member had just opened refused their own stored formula at
    // `sentence:name` and the Save button was dead on arrival.
    setMemberInputs(
      (Array.isArray(def?.inputs) ? def.inputs : [])
        .filter((spec) => spec && typeof spec.key === 'string' && !chromeKeySet.has(spec.key))
        .map((spec) => ({ ...spec })),
    )

    setEditing({ defId: row.def_id, version: Number(row.version) || 1 })
    setName(String(def?.meta?.name || ''))
    setSource(restored[0].source)
    // ⭐ OPENING A SAVED FORMULA IS A LANE LIKE ANY OTHER. Found by enumerating
    // every `setSource` site rather than patching the two I happened to have
    // tested: a member with a description in the box who opens one of their own
    // formulas to edit was left with a sentence describing something else, above
    // a Draft button that would overwrite the formula they had just opened.
    //
    // ⛔ THE OTHER THREE WRITERS DELIBERATELY DO NOT BUMP, and that is the whole
    // classification: the concierge's own `onAccept` matches its description BY
    // DEFINITION; `cancelEdit` clears to a blank box, where the description is
    // still the natural next thing to draft from; and the open-reset unmounts the
    // box entirely (`if (!open) return null`), so its prompt is already gone.
    setReplacedAt((n) => n + 1)
    // ⛔ THE DOCUMENT'S OWN SCOPE AGAIN, NOT THIS RENDER'S. `inputScope` is a
    // render value and this callback has an empty dependency list on purpose, so
    // it would be the scope from the FIRST render — empty of the very inputs the
    // stored definition declares.
    setResult(evaluateFormula(restored[0].source, scope))
    // ⛔ AND THE SHEET MOVES TO THE FORMULA. A new sheet opens on the Library
    // because a member with nothing in the box is helped by worked examples; a
    // member editing their OWN definition is not, and leaving a gallery of
    // starters above their work invites a click that replaces it.
    setBuildMode('formula')
    setPickerNote(null)
  }, [resetPlots])

  const cancelEdit = useCallback(() => {
    setEditing(null); setSource(''); setName(''); setMemberInputs([])
    setResult(evaluateFormula('', BUILDER_INPUT_SCOPE))
    setAcknowledged(false); setStoreError(null); setSavedRow(null)
    // ⛔ AND THE PLOTS GO WITH IT. "New formula" empties the form; a second
    // plot left behind would be a tree in a document whose box shows nothing.
    resetPlots()
  }, [resetPlots])

  // A new evaluation invalidates an acknowledgement of the OLD one. Carrying it
  // forward would let a user acknowledge a bounded forward reference and then
  // save a different formula under that acknowledgement.
  const handleEvaluated = useCallback((next) => {
    setResult((prev) => {
      if (prev && prev.source === next.source) return prev
      setAcknowledged(false)
      setStoreError(null)
      setSavedRow(null)
      // A note about a formula the picker could not show describes the OLD
      // source; carrying it past an edit would leave a warning on screen about
      // a formula that is no longer in the box.
      setPickerNote(null)
      return next
    })
  }, [])

  /**
   * ⛔⛔ THE BADGE ON SCREEN IS THE BADGE THE DOCUMENT WILL CARRY — the WORST of
   * every row, because a document draws all its plots at once and
   * `buildDefinition` stores `worstRepaint(...)`. Showing plot 1's verdict beside
   * a second plot that repaints would ask the member to acknowledge a claim the
   * saved definition does not make, and `validateAstLane` re-measures and refuses
   * that disagreement in both directions — so the sheet would offer a Save the
   * registry then rejects, with a badge as the explanation.
   *
   * ⭐ AND THE REASONS ARE THE REASONS OF THE ROW THAT PRODUCED IT, found rather
   * than merged: a list of every row's reasons under one badge reads as one
   * formula with many problems. `worstRepaint([])` fails CLOSED, so an empty list
   * is turned into `null` here — "nothing has been typed yet" is not a verdict.
   */
  const worstVerdict = useMemo(() => {
    const verdicts = allRows
      .map((r, i) => (i === 0 ? result : r.result))
      .map((ev) => (ev && ev.ok && ev.verdict) || null)
      .filter(Boolean)
    if (!verdicts.length) return null
    const worst = worstRepaint(verdicts.map((v) => v.mode))
    return verdicts.find((v) => v.mode === worst) || verdicts[0]
  }, [allRows, result])
  const mode = worstVerdict?.mode || null

  // ⭐⭐ ONE AUTHORITY FOR "CAN THIS SAVE", AND THE HINT IS DERIVED FROM IT.
  //
  // ⚰️ A valid formula with an empty Name left Save greyed and said NOTHING —
  // nothing marked Name required, nothing pointed at it. Measured in production
  // 2026-08-10 while saving a real TC2000 column.
  //
  // ⛔ The hint must not RESTATE the rule. Writing `if (!name.trim()) …` beside
  // `canSave` would put a second authority on one decision, and the day a gate
  // moves, the button and its explanation start disagreeing — which is worse than
  // no explanation, because the member now has a reason that is false. Both read
  // the same `saveGates` object.
  const saveGates = useMemo(() => ({
    formula: canSaveFormula(result, acknowledged),
    named: name.trim() !== '',
    idle: !saving,
    // ⛔ THE INPUT GATE BELONGS HERE, NOT BESIDE `save()`. Checking it only in the
    // handler would leave the button ENABLED while the save silently returned —
    // a dead control, and a second authority over one decision, which is the
    // defect the comment above this object exists to prevent.
    inputs: inputsValid,
    // ⛔ EVERY ROW, THROUGH THE SAME TWO DOORS PLOT 1 GOES THROUGH. `canSaveFormula`
    // is the shipped gate — it is what runs the tree over four probe bars, so a
    // plot that only refuses at interpret time cannot reach Save on ANY row. And
    // the key gate is here rather than beside `save()`, for the reason the
    // comment above this object gives: a shut gate that only fires in the
    // handler is a live button that silently does nothing.
    plots: plotKeyProblem(plot0.key, 0) === null
      && plotRows.every((r, i) => plotKeyProblem(r.key, i + 1) === null
        && canSaveFormula(r.result, acknowledged))
      && !levelsProblem,
  }), [result, acknowledged, name, saving, inputsValid,
    plotKeyProblem, plot0.key, plotRows, levelsProblem])

  const canSave = saveGates.formula && saveGates.named && saveGates.idle
    && saveGates.inputs && saveGates.plots

  // Only the NAME gate gets a sentence here. A formula problem already has the
  // refusal chip and the repaint notice above — repeating it under the button
  // would be a second voice for a fact the member can already see.
  const saveHint = (saveGates.idle && saveGates.formula && !saveGates.named)
    ? 'Give it a name to save.'
    // An input problem already names itself on its own row, so this points at
    // WHICH gate is shut without restating the reason a second time.
    : (saveGates.idle && saveGates.formula && saveGates.named && !saveGates.inputs)
      ? 'Fix the input names above to save.'
      // Same rule as the line above it: every plot problem already names itself
      // on its own row (a key sentence, or its own refusal chip), so this points
      // at WHICH gate is shut without restating the reason a second time.
      : (saveGates.idle && saveGates.formula && saveGates.named && saveGates.inputs
        && !saveGates.plots)
        ? 'Fix the plots above to save.'
        : null

  // ── focus trap ─────────────────────────────────────────────────────────────
  //
  // ⚠️ `Sheet` SHIPS NO TRAP. It focuses the panel on open, handles Escape,
  // locks body scroll and restores focus on close — and nothing stops Tab
  // walking out of the modal into the page behind it. (The plan and this task's
  // brief both say otherwise; Task 5 measured it and so did this one.)
  // `ContextPopover` ships neither a trap nor focus movement into its
  // `role="menu"`, which is a separate finding and not this surface's.
  //
  // ⛔ BOUND TO THE PANEL, NOT TO THIS SUBTREE. `Sheet`'s header — and its ×
  // button, the FIRST focusable in the ring — is a SIBLING of the body this
  // component renders into, so a React `onKeyDown` here would never see the
  // Shift+Tab that leaks out of the modal from the very element the ring starts
  // at. Measured on `IndicatorSettingsDialog`: the forward wrap passed and the
  // backward one walked to `body`.
  const trapTab = useCallback((e) => {
    if (e.key !== 'Tab') return
    const panel = rootRef.current?.closest('[role="dialog"]') || rootRef.current
    if (!panel) return
    const items = [...panel.querySelectorAll(FOCUSABLE)]
    if (items.length < 2) return
    const first = items[0]
    const last = items[items.length - 1]
    const active = document.activeElement
    // Focus on the PANEL itself is the normal state right after open (`Sheet`
    // focuses it on an rAF) and it is not in `items` (tabindex="-1"). Tab from
    // there must ENTER the ring, not walk out of the modal.
    if (items.indexOf(active) === -1) { e.preventDefault(); (e.shiftKey ? last : first).focus(); return }
    if (e.shiftKey && active === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus() }
  }, [])

  const trapRef = useRef(trapTab)
  trapRef.current = trapTab
  useEffect(() => {
    if (!open) return undefined
    const panel = rootRef.current?.closest('[role="dialog"]')
    if (!panel) return undefined
    const h = (e) => trapRef.current(e)
    panel.addEventListener('keydown', h)
    return () => panel.removeEventListener('keydown', h)
  }, [open])

  /** Spec §6 state 4's "copy diagnostic" — the GUARD's name and the door's own
   *  sentence, so a support message names the gate rather than describing the
   *  symptom. */
  const copyDiagnostic = useCallback(() => {
    const text = JSON.stringify({
      source: result?.source ?? '',
      guard: result?.guard ?? null,
      error: result?.error ?? null,
      repaint: mode,
      measured: result?.measured ?? null,
    }, null, 2)
    try { navigator?.clipboard?.writeText?.(text) } catch { /* a clipboard-less browser still gets the chip */ }
    setCopied(true)
  }, [result, mode])

  const save = useCallback(async () => {
    // ⛔ AN INVALID INPUT KEY BLOCKS THE SAVE. The document would otherwise
    // carry a declaration the formula cannot reference — or worse, one that
    // SHADOWS a table name and quietly computes something else.
    if (!canSave) return
    setSaving(true)
    setStoreError(null)
    // ⚠️ THE DOCUMENT'S OWN `version` MOVES ON AN EDIT, AND IT HAS TO.
    // `nativeRegistry.installKey` is `id@version#compute.fn`, so a rename — same
    // id, same tree, same hash — is byte-identical to the installed document and
    // is SKIPPED, leaving the registry (and therefore the legend, the settings row
    // and the pane label) showing the old name. The store's `version` column moves
    // on every append; the blob's copy of it now moves with it.
    // ⭐ THE ROWS, EACH CARRYING ITS OWN SETTLED EVALUATION. Plot 1's lives in
    // `result`; every later row's lives on the row. `buildDefinition` is handed
    // the SOURCE, the TREE, the MODE and the READ-BACK that were measured
    // together, never a source paired with someone else's tree.
    const rows = allRows.map((r, i) => {
      const ev = i === 0 ? result : r.result
      return {
        ...r, source: ev.source, ast: ev.ast, mode: ev.verdict.mode, readback: ev.readback,
      }
    })
    // ⛔⛔ THE BYTE-IDENTICAL PATH, AND THE CONDITION IS "NOTHING WAS TOUCHED"
    // STATED ONCE. A single default plot in its own pane with no levels is the
    // document this form has written since Phase D, and 21 stored definitions
    // depend on it not moving. `isUntouchedRow` is the whole test — a hand-written
    // subset of the fields silently discards whichever ones it forgets, and the
    // first draft of this forgot colour, width, label and hidden.
    const plain = plotRows.length === 0 && target === 'pane' && levels.length === 0
      && isUntouchedRow(plot0)
    const doc = buildDefinition({
      defId: editing ? editing.defId : draftDefId(),
      version: editing ? editing.version + 1 : 1,
      name,
      source: result.source,
      ast: result.ast,
      mode: result.verdict.mode,
      readback: result.readback,
      inputs: [...BUILDER_INPUTS, ...memberInputs],
      ...(plain ? {} : {
        plots: rows,
        // The DOCUMENT names a key. This is the one moment the index the sheet
        // held becomes one, so a rename can never have detached the two.
        scanPlot: rows[scanIndex] ? rows[scanIndex].key : null,
        placement: target === 'price' ? { target: 'price' } : null,
        levels: levels.length ? levels : null,
      }),
    })
    // ⭐ THE SHIPPED VALIDATION DOOR, NOT A SECOND ONE. `validateUserDefinitions`
    // is `defSchema` + the `supportedKinds` filter + the ast lane's own gates
    // (one formula is one series · the budget, naming the guard that fired · the
    // repaint badge and the freshness badge, each refused in both directions ·
    // the tier · a plot's own forward window). ⚠️ NAMED, NOT COUNTED — this said
    // "three gates" while the function carried five. A form that validated its
    // own document would be a second authority on what a definition is, and the
    // two rot apart the first time a gate moves.
    //
    // ⚠️ VALIDATE FIRST, INSTALL LATER. Installing the DRAFT would put a
    // definition under `draftDefId()` into the registry — an id the store is
    // about to replace — so the tab would carry a resolvable definition that
    // nothing stored and nothing else can ever name. The refusal has to happen
    // before the network write either way, which is what this call is for.
    const { defs, errors } = validateUserDefinitions([doc])
    if (errors.length || defs.length !== 1) {
      setStoreError(errors.join('\n') || 'The registry refused this definition.')
      setSaving(false)
      return
    }
    // ⭐ THE SECOND ARGUMENT IS THE WHOLE DIFFERENCE BETWEEN A CREATE AND AN EDIT.
    // `saveUserDefinition` POSTs without it and PUTs with it — one function, one
    // set of error words, one SWR invalidation. The route it reaches then bumps
    // `compute.rev` if the maths moved and force-migrates every bound alert.
    const res = await saveUserDefinition(doc, editing ? editing.defId : null)
    setSaving(false)
    if (!res.ok) { setStoreError(res.error); return }
    const row = res.row || { def_id: doc.id, version: doc.version, rev: 1 }
    setSavedRow(row)
    if (editing && row.def_id) setEditing({ defId: row.def_id, version: Number(row.version) || editing.version + 1 })

    // ── the definition the STORE holds, not the draft ────────────────────────
    //
    // ⛔ THE SERVER MINTS THE ID (`user_definitions.create_definition` overwrites
    // `definition["id"]`), so the document that must be installed and the id the
    // instance must name are the STORE's, never `draftDefId()`'s. An instance
    // pointing at the draft id would be dropped by `normalizeInstances` on the
    // very next paint — the defect this task exists to close, re-created one
    // field over. ⚠️ `compute.rev` is reconciled from the row for the same
    // reason: the store computes the authoritative rev and Task 11 recorded that
    // the blob's copy was left to lag it.
    const storedDoc = {
      ...doc,
      id: row.def_id || doc.id,
      ...(Number.isInteger(row.version) ? { version: row.version } : {}),
      compute: {
        ...doc.compute,
        ...(Number.isInteger(row.rev) ? { rev: row.rev } : {}),
      },
    }
    const { installed, errors: installErrors } = installUserDefinitions([storedDoc])
    if (installErrors.length || installed.length !== 1) {
      // Saved, but not drawable. Saying so is the whole point: the alternative
      // is a checkbox-shaped silence where a formula exists in the list and
      // never appears on a chart, which is the state this phase retires.
      setStoreError(
        installErrors.join('\n')
        || 'Saved, but this formula could not be added to the chart.',
      )
    } else if (!editing && settings && onChange) {
      // ⛔ THROUGH `addInstance`, THE ONE CONTROL DOOR — not a hand-built
      // instance object. It reads the DEFINITION for the input defaults and the
      // placement, mints the id `newInstanceId` would, sorts the list into the
      // shipped stack order and sets the legacy mirror, exactly as the indicator
      // library's checkbox does. A second way to add an instance is a second
      // shape of instance, and `normalizeInstances` is the thing that would tell
      // us — on the user's chart, by making it disappear.
      //
      // ⛔ ON A CREATE ONLY. An EDIT's instance is already on the chart naming
      // this very id, and `installUserDefinitions` above has just replaced the
      // definition it resolves through — so the existing binding redraws with the
      // new maths and adding a second instance would draw the same formula twice.
      onChange(addInstance(settings, installed[0].id, engineRegistry))
    }
    onSaved?.(res.row)
  }, [canSave, result, allRows, plot0, plotRows, scanIndex, target, levels,
    memberInputs, name, onSaved, settings, onChange, editing])

  // ⭐⭐ DELETE ASKS FIRST.
  //
  // ⚰️ THIS WAS `await deleteUserDefinition(defId)` ON THE CLICK. One tap on a
  // trash icon permanently destroyed a saved formula — no prompt, no undo, and
  // the icon sits inches from the pencil that EDITS it. Found 2026-08-11 by
  // reading this line rather than clicking it, which is the only reason the
  // owner's own saved column still exists.
  //
  // ⛔ THE PROMPT IS PER ROW, not a modal over the sheet: a second dialog on top
  // of this one is where focus traps and Escape handlers start fighting, and the
  // member needs to see WHICH formula they are about to lose. `pendingDelete`
  // holds that row's id, so exactly one row can be armed at a time.
  const [pendingDelete, setPendingDelete] = useState(null)
  const remove = useCallback(async (defId) => {
    await deleteUserDefinition(defId)
    setPendingDelete(null)
  }, [])

  const badge = useMemo(() => (mode ? (REPAINT_LABEL[mode] || mode) : null), [mode])

  // ⭐⭐ ESCAPE MUST NOT SILENTLY BIN A MEMBER'S WORK.
  //
  // ⚰️ MEASURED IN PRODUCTION 2026-08-10: Escape closed the builder and discarded
  // everything typed, with no prompt. Escape is the reflex for dismissing a stray
  // dropdown — and until this session the chart's own ticker search was popping
  // one open THROUGH this dialog, so the key a member reached for to clear that
  // was the key that threw away their formula.
  //
  // ⛔ "DIRTY" IS UNSAVED WORK, NOT ANY WORK. Once `savedRow` exists for the text
  // currently in the box there is nothing to lose, so the prompt does not fire and
  // Escape stays instant — a confirm on every close trains people to dismiss it.
  // ⛔ A SECOND PLOT IS UNSAVED WORK TOO. Escape with three typed formulas in
  // the sheet and only the first one counted would discard the other two
  // without a prompt — the exact loss this gate was added for.
  const dirty = (source.trim() !== '' || name.trim() !== ''
      || plotRows.some((r) => String(r.source || '').trim() !== ''))
    && !(savedRow && savedRow.source === source)

  const requestClose = useCallback(() => {
    if (dirty) { setConfirmDiscard(true); return }
    onClose?.()
  }, [dirty, onClose])

  if (!open) return null

  return (
    <Sheet
      open={open}
      onClose={requestClose}
      variant="auto"
      title={editing ? 'Edit formula' : 'New formula'}
      maxWidth={640}
    >
      {/* The portal exemption — `ChartToolbar` closes its settings panel on any
          outside mousedown, and `Sheet` renders into `document.body`, so without
          this the mousedown of the very click that opens this sheet would unmount
          the panel underneath it. Same trap `IndicatorLibraryDialog` documents. */}
      <div className={styles.body} ref={rootRef} {...{ [PORTAL_POPUP_ATTR]: 'formula-builder' }}>
        <BuilderBoundary>
          {/* ── THE AI DOOR (Phase D Task 13) ────────────────────────────────
              ⭐ IT IS MOUNTED HERE, ABOVE THE TYPED FIELD, AND UNTIL NOW IT WAS
              MOUNTED NOWHERE. `ConciergeBox` shipped complete — a prop
              contract, a derived read-back, a full test file — with ZERO
              non-test importers, so `POST /api/user-definitions/propose` (cost
              -guarded, `MAX_MODEL_CALLS = 2`) had no product caller and
              "describe an indicator in English" existed on no screen.

              ⛔ `onAccept` WRITES THE SOURCE AND NOTHING ELSE. The box
              deliberately never saves; handing its `source` to the field the
              user already types in means the proposal goes through the SAME
              parse, the SAME budget walk, the SAME linter and the SAME
              read-back as a typed formula, and the Save button below stays the
              one and only write path. Taking `body.ast` straight to
              `buildDefinition` would be a second door with a second set of
              gates to keep in step — the exact shape this phase retires.

              ⚠️ NO `fetchImpl`. The box's injection point is for tests only;
              production uses the global `fetch`, so what this surface issues is
              a real request (`lesson_injected_dependency_hides_the_fetch`).

              ⭐ AND THE KIND IS THE MODE THE MEMBER IS IN (Phase E, E-5). On the
              Conditions tab they are building a SCREEN, so the request says so
              and the server's condition stage can refuse a tree that produces a
              number — `sma(close,20)` handed back as a screen would silently
              match every symbol on the board. A box that always asked for an
              indicator would be a box whose scan stage can never fire, and no
              component test on either side could see it. */}
          <ConciergeBox
            bars={bars}
            kind={buildMode === 'picker' ? 'scan' : 'indicator'}
            disabled={saving}
            replacedAt={replacedAt}
            onAccept={(proposal) => setSource(proposal?.source || '')}
          />

          {/* ── THE SECOND DOOR ONTO ONE OBJECT (Phase E, E-4) ───────────────────
              ⛔ A MODE, NOT A SECOND BUILDER. The picker's only output is the SAME
              `source` string the text box holds, so a picked condition goes through
              the same parse, the same budget walk, the same linter, the same
              read-back and the same Save button as a typed one. A second builder
              would be a second grammar — the seam this task exists to close.

              ⛔ AND THE PICKER IS DERIVED FROM THE TREE, NOT STORED. Switching to it
              reads `result.ast`; a formula it cannot show is REPORTED, and the
              picker stays empty rather than half-right. */}
          {/* ── THE THIRD DOOR ONTO THE SAME OBJECT (Phase E, E-8) ──────────────
              ⭐ A BLANK FORMULA BOX LOSES THE WIDE AUDIENCE. The library is the
              onboarding path: a member picks one of the FIRM'S OWN setups, gets
              a working scan in the box below, and edits it — which is how people
              learn a syntax.

              ⛔ AND IT IS A MODE, NOT A THIRD BUILDER. Its only output is the
              same `source` string the other two doors write, so a starter meets
              the same parse, the same budget, the same linter, the same
              read-back and the same Save button. There is no starter save path,
              no starter flag on the document and no starter column on the store
              — a starter that was special-cased would be a second class of
              object, and `BuilderSheet.starters.test.jsx` asserts the saved
              blob carries no trace of where it came from. */}
          <div className={styles.modeRow} role="tablist" aria-label="How to build this">
            <button
              type="button" role="tab"
              className={`${styles.modeTab} ${buildMode === 'library' ? styles.modeTabActive : ''}`}
              aria-selected={buildMode === 'library'}
              onClick={() => setBuildMode('library')}
            >Library</button>
            <button
              type="button" role="tab"
              className={`${styles.modeTab} ${buildMode === 'picker' ? styles.modeTabActive : ''}`}
              aria-selected={buildMode === 'picker'}
              onClick={() => setBuildMode('picker')}
            >Conditions</button>
            {/* ── THE FOURTH DOOR ONTO THE SAME OBJECT (Phase F, F-3) ──────────
                ⭐ A MEMBER ARRIVES CARRYING A PINE SCRIPT, and until now the
                answer was "retype it". `PineBox` translates one and hands back
                the SAME `source` string every other door writes — so a pasted
                script meets the same parse, the same budget walk, the same
                repaint linter, the same read-back and the same Save button.

                ⛔ NOTHING ABOUT THE SAVED DOCUMENT REMEMBERS IT WAS PINE. There
                is no Pine flag, no Pine column and no Pine save path; a script
                that translates becomes an ordinary definition whose `compute.fn`
                is the same `astHash` a typed formula of the same shape produces,
                which is what lets the chart, the alert and the scan keep sharing
                one object. */}
            <button
              type="button" role="tab"
              className={`${styles.modeTab} ${buildMode === 'pine' ? styles.modeTabActive : ''}`}
              aria-selected={buildMode === 'pine'}
              onClick={() => setBuildMode('pine')}
            >Pine</button>
            <button
              type="button" role="tab"
              className={`${styles.modeTab} ${buildMode === 'formula' ? styles.modeTabActive : ''}`}
              aria-selected={buildMode === 'formula'}
              onClick={() => setBuildMode('formula')}
            >Formula</button>
          </div>

          {buildMode === 'library' && (
            <StarterLibrary
              activeSource={source}
              onPick={(entry) => {
                // ⛔ THE SOURCE AND NOTHING ELSE. Not the tree, not a prebuilt
                // document, not a hash — the starter arrives at the typed box the
                // way a member's own keystrokes do, so the ONE write path stays
                // the one write path. Landing on the Formula tab is the point of
                // the gesture: *"here is a working scan, now change it"*.
                setSource(entry.source)
                setBuildMode('formula')
                // ⭐ …EXCEPT THE NAME, WHICH IS A FORM FIELD AND NOT PART OF THE
                // WRITE PATH. ⚰️ Measured 2026-08-11: clicking "Open it and edit"
                // on **Classic Flag/Pullback** loaded its formula and left Name
                // empty, so the sheet answered a member who had just picked a
                // named firm setup with "Give it a name to save." — asking them to
                // retype a name the dialog was already showing them.
                //
                // ⛔ ONLY WHEN IT IS EMPTY. Overwriting a name the member typed
                // would be the same class of loss as the Escape bug: browsing the
                // library after naming your own work must not rename it.
                setName((prev) => (prev.trim() ? prev : entry.setup))
                setReplacedAt((n) => n + 1)
              }}
            />
          )}

          {buildMode === 'pine' && (
            <PineBox
              disabled={saving}
              onPick={(formula) => {
                // ⛔ THE SOURCE AND NOTHING ELSE — verbatim the StarterLibrary
                // contract three lines down. Not the tree the translator built
                // (that one exists only to prove the printed text reads back the
                // same), not a prebuilt document, not a hash.
                setSource(formula)
                setBuildMode('formula')
                setReplacedAt((n) => n + 1)
              }}
            />
          )}

          {buildMode === 'picker' && (
            <CriteriaPicker
              ast={result?.ast || null}
              onSourceChange={setSource}
              onUnrepresentable={(refusal) => setPickerNote(refusal.reason)}
            />
          )}

          {buildMode === 'picker' && pickerNote && (
            <p className={styles.pickerNote} role="status" data-testid="picker-note">{pickerNote}</p>
          )}

          <FormulaField
            value={source}
            onChange={setSource}
            onEvaluated={handleEvaluated}
            result={result}
            autoFocus
            inputs={inputScope}
          />

          {/* ── THE MEMBER'S OWN INPUTS ──────────────────────────────────────
              ⭐ WHAT MAKES AN AUTHORED INDICATOR TUNABLE RATHER THAN FROZEN.
              Without these the period lives in the formula as a literal, so a
              saved indicator is ONE INSTANCE of itself — nobody can change it,
              and sharing it hands over somebody else's constant. */}
          <section className={styles.readbackWrap} aria-labelledby="uct-inputs-head">
            <h3 className={styles.sectionHead} id="uct-inputs-head">Inputs you can change later</h3>
            {memberInputs.length === 0 && (
              <p className={styles.measured} data-testid="no-inputs">
                None yet. Add one to turn a number in your formula into a setting —
                write <code>period</code> instead of <code>20</code>.
              </p>
            )}
            {memberInputs.map((spec, i) => {
              const problem = inputKeyProblem(spec.key, i)
              return (
                <div className={styles.inputRow} key={`member-input-${i}`} data-testid={`member-input-${i}`}>
                  <input
                    className={styles.inputKey}
                    value={spec.key}
                    placeholder="period"
                    aria-label={`Input ${i + 1} name`}
                    aria-invalid={problem ? 'true' : undefined}
                    onChange={(e) => patchInput(i, { key: e.target.value.trim() })}
                  />
                  <input
                    className={styles.inputDefault}
                    type="number"
                    value={spec.default}
                    aria-label={`Input ${i + 1} default`}
                    onChange={(e) => patchInput(i, { default: Number(e.target.value) })}
                  />
                  <button
                    type="button"
                    className={styles.inputRemove}
                    onClick={() => removeInput(i)}
                    aria-label={`Remove input ${i + 1}`}
                  >
                    <UIcon name="trash" size={14} />
                  </button>
                  {/* ⛔ THE REASON, NOT A RED BORDER. Every other refusal on this
                      surface names what is wrong; a silent invalid state here
                      would be the one place a member has to guess. */}
                  {problem && (
                    <p className={styles.inputProblem} role="alert" data-testid={`member-input-problem-${i}`}>
                      {problem}
                    </p>
                  )}
                </div>
              )
            })}
            <button type="button" className={styles.addInput} onClick={addInput} data-testid="add-input">
              + Add an input
            </button>
          </section>

          {/* ── THE PLOTS (W1b.5) ────────────────────────────────────────────
              ⭐ WHERE A MULTI-PLOT INDICATOR IS ACTUALLY AUTHORED, and until now
              a member could only ever write ONE line: `buildDefinition` hard-coded
              a single `value` plot, so MACD — three lines and a histogram — was
              three separate indicators that could not share a pane, a legend or
              a hash.

              ⛔ PLOT 1 IS THE FORMULA BOX ABOVE, NOT A ROW OF ITS OWN. Its maths
              lives in `source`/`result` exactly where it always has; this row
              only carries what a plot has BESIDES its maths. That is what keeps
              a one-plot document byte-identical to every one already stored.

              ⛔ AND THE SCAN RADIO APPEARS ONLY WITH A SECOND PLOT, because with
              one there is nothing to choose: `compute.ast` IS that plot's tree
              and no `scanPlot` is written at all. */}
          <section className={styles.readbackWrap} aria-labelledby="uct-plots-head">
            <h3 className={styles.sectionHead} id="uct-plots-head">Plots</h3>
            {plotRows.length === 0 && (
              <p className={styles.measured} data-testid="one-plot">
                One line, drawn from the formula above. Add a plot to draw a second
                series from the same indicator — a signal line, a histogram, a
                0/1 flag to scan on.
              </p>
            )}
            {allRows.map((row, i) => {
              const n = i + 1
              const problem = plotKeyProblem(row.key, i)
              const rowResult = i === 0 ? result : row.result
              return (
                <div className={styles.plotRow} key={`plot-${i}`} data-testid={`plot-row-${n}`}>
                  {/* ⛔ ONE FIELD COMPONENT, ONE GRAMMAR. A second plot's formula
                      goes through the same parse, the same budget walk, the same
                      linter, the same read-back and the same four-bar interpret
                      gate as the first — a second box with its own rules would be
                      a second grammar, which is the seam this whole lane closes.
                      `label` is HB-6: without it every field is called "Formula"
                      and nothing on screen says which plot it belongs to. */}
                  {i > 0 && (
                    <FormulaField
                      label={`Formula for plot ${n}`}
                      inputId={`uct-formula-plot-${n}`}
                      value={row.source}
                      onChange={(next) => patchPlot(i, { source: next })}
                      onEvaluated={(ev) => handlePlotEvaluated(i, ev)}
                      result={row.result}
                      inputs={inputScope}
                    />
                  )}
                  <div className={styles.plotControls}>
                    <input
                      className={styles.plotKey}
                      value={row.key}
                      placeholder="value"
                      aria-label={`Plot ${n} key`}
                      aria-invalid={problem ? 'true' : undefined}
                      onChange={(e) => patchPlot(i, { key: e.target.value.trim() })}
                    />
                    <input
                      className={styles.plotLabel}
                      value={row.label}
                      placeholder="Signal"
                      aria-label={`Plot ${n} label`}
                      onChange={(e) => patchPlot(i, { label: e.target.value })}
                    />
                    <select
                      className={styles.plotStyle}
                      value={row.style}
                      aria-label={`Plot ${n} style`}
                      onChange={(e) => patchPlot(i, { style: e.target.value })}
                    >
                      {PLOT_STYLE_CHOICES.map(([value, text]) => (
                        <option key={value} value={value}>{text}</option>
                      ))}
                    </select>
                    {/* ⛔ A PLAIN SWATCH, NOT `ColorPicker`. That component opens a
                        portal popup and belongs to the settings dialog; a second
                        portal inside this sheet is where focus traps and outside-
                        mousedown handlers start fighting. */}
                    <input
                      className={styles.plotColor}
                      type="color"
                      value={row.color}
                      aria-label={`Plot ${n} colour`}
                      onChange={(e) => patchPlot(i, { color: e.target.value })}
                    />
                    <input
                      className={styles.plotWidth}
                      type="number"
                      min={1}
                      max={4}
                      step={1}
                      value={row.width}
                      aria-label={`Plot ${n} width`}
                      onChange={(e) => patchPlot(i, { width: Number(e.target.value) })}
                    />
                    {/* ⭐ HIDDEN IS ABOUT THE CANVAS ONLY. The column is still
                        computed, still reaches the alert seam and still is what a
                        scan reads — which is the whole point of the 0/1 plot a
                        scannable document carries. */}
                    <label className={styles.plotToggle}>
                      <input
                        type="checkbox"
                        checked={row.hidden === true}
                        aria-label={`Hide plot ${n}`}
                        onChange={(e) => patchPlot(i, { hidden: e.target.checked })}
                      />
                      <span>Hide</span>
                    </label>
                    {plotRows.length > 0 && (
                      <label className={styles.plotToggle}>
                        <input
                          type="radio"
                          name="uct-scan-plot"
                          checked={scanIndex === i}
                          aria-label={`Scan on plot ${n}`}
                          onChange={() => setScanIndex(i)}
                        />
                        <span>Scan</span>
                      </label>
                    )}
                    {i > 0 && (
                      <button
                        type="button"
                        className={styles.inputRemove}
                        data-testid={`remove-plot-${n}`}
                        aria-label={`Remove plot ${n}`}
                        onClick={() => removePlot(i)}
                      >
                        <UIcon name="trash" size={14} />
                      </button>
                    )}
                  </div>
                  {/* ⛔ THE REASON, NOT A RED BORDER — the same rule the member
                      inputs above follow. */}
                  {problem && (
                    <p className={styles.inputProblem} role="alert" data-testid={`plot-problem-${n}`}>
                      {problem}
                    </p>
                  )}
                  {/* Each extra row gets its OWN read-back. `data-testid="readback"`
                      stays plot 1's, because that is the sentence every existing
                      caller and test means by "the read-back". */}
                  {i > 0 && rowResult?.ok && (
                    <p className={styles.measured} data-testid={`plot-readback-${n}`}>
                      {rowResult.readback}
                    </p>
                  )}
                </div>
              )
            })}
            <button type="button" className={styles.addPlot} onClick={addPlot} data-testid="add-plot">
              + Add a plot
            </button>

            <div className={styles.placementRow}>
              {/* ⛔ THE VALUE IS `price`; "Overlay on price" IS THE LABEL. Three
                  consumers read `PLACEMENT_TARGETS` and a fourth spelling of
                  "the candles' scale" would need every one of them to learn it. */}
              <label className={styles.label} htmlFor="uct-placement">Placement</label>
              <select
                id="uct-placement"
                className={styles.plotStyle}
                value={target}
                aria-label="Placement"
                onChange={(e) => setTarget(e.target.value)}
              >
                <option value="pane">Own pane</option>
                <option value="price">Overlay on price</option>
              </select>
              {/* ⛔ ONE `hlines` PLOT, NOT ONE PER NUMBER. `pool.guidePlots` attaches
                  a definition's hlines levels to the FIRST data plot's series as
                  price lines, so a second guide plot would be a second attachment
                  of the same kind — and `levels` is an array precisely so it does
                  not have to be. */}
              <label className={styles.label} htmlFor="uct-levels">Levels</label>
              <input
                id="uct-levels"
                className={styles.plotKey}
                value={levelsText}
                placeholder="70, 30"
                aria-label="Levels"
                aria-invalid={levelsProblem ? 'true' : undefined}
                onChange={(e) => setLevelsText(e.target.value)}
              />
              {levelsProblem && (
                <p className={styles.inputProblem} role="alert" data-testid="levels-problem">
                  {levelsProblem}
                </p>
              )}
            </div>
          </section>

          {/* ── THE READ-BACK ────────────────────────────────────────────────
              ⛔ `{result.readback}` AND NOTHING ELSE. See the header. */}
          {result?.ok && (
            <section className={styles.readbackWrap} aria-labelledby="uct-readback-head">
              <h3 className={styles.sectionHead} id="uct-readback-head">This is what will be computed</h3>
              <p className={styles.readback} data-testid="readback">{result.readback}</p>
              <p className={styles.measured}>
                {result.measured
                  ? `${result.measured.maxNodes} nodes · ${result.measured.maxLookback}-bar lookback · `
                    + `${result.measured.maxSeriesRefs} series`
                  : null}
              </p>
            </section>
          )}

          {/* ── THE BADGE ────────────────────────────────────────────────────
              Shown only for an ADMISSIBLE formula: a repaint verdict printed
              beside "unknown function `foo`" describes a formula that does not
              exist, and would read as the reason it was refused. */}
          {result?.ok && badge && (
            <p
              className={`${styles.badge} ${mode === 'non-repainting' ? styles.badgeClean : styles.badgeWarn}`}
              data-testid="repaint-badge"
              data-mode={mode}
            >
              <UIcon name={mode === 'non-repainting' ? 'check' : 'warning'} size={14} />
              {badge}
              <span className={styles.badgeWhy}>{(result.verdict.reasons || []).join('; ')}</span>
            </p>
          )}

          {mode === 'preview-repaints' && result?.ok && (
            <label className={styles.ack}>
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                data-testid="repaint-ack"
              />
              <span>
                I understand this value is not final until {result.verdict.forward} more bar(s) close.
              </span>
            </label>
          )}

          {result?.error && (
            <div className={styles.diagRow}>
              <button type="button" className="btn btn-ghost" onClick={copyDiagnostic}>
                <UIcon name="copy" size={14} />{copied ? 'Copied' : 'Copy diagnostic'}
              </button>
            </div>
          )}

          <div className={styles.fieldWrap}>
            <label className={styles.label} htmlFor="uct-formula-name">Name</label>
            <input
              id="uct-formula-name"
              className={styles.nameField}
              type="text"
              maxLength={48}
              placeholder="20-bar average"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {storeError && (
            <p className={styles.storeError} role="alert" data-testid="store-error">{storeError}</p>
          )}
          {listError && (
            <p className={styles.storeError} role="alert" data-testid="list-error">
              {listError.status === 402
                ? 'Custom indicators require a paid plan.'
                : 'Your saved formulas could not be loaded.'}
            </p>
          )}
          {savedRow && (
            <p className={styles.saved} data-testid="saved-note">
              <UIcon name="check" size={14} />
              Saved — version {savedRow.version}, rev {savedRow.rev}.
              {/* ⭐ THE MIGRATION, SAID OUT LOUD. Spec §3.1's contract is *"you
                  will never be silently switched"*, and the store returns the
                  count it actually migrated — so this is the number of alerts
                  that were reset and suppressed for one cycle, not a guess about
                  them. Rendered only when it is non-zero: "0 alerts" beside a
                  rename is noise, and `rev_bumped` alone would claim a migration
                  on a definition nothing is bound to. */}
              {savedRow.rev_bumped && savedRow.migrated > 0 && (
                <span data-testid="migrated-note">
                  {' '}The maths changed, so {savedRow.migrated} alert
                  {savedRow.migrated === 1 ? '' : 's'} bound to it moved onto the new
                  calculation and will skip one evaluation.
                </span>
              )}
            </p>
          )}

        {/* ⭐⭐ ONE STICKY FOOTER, NOT THREE STACKED THINGS.
            ⚰️ Making `.actions` sticky on its own (2026-08-11) pinned the buttons
            and left the two lines that EXPLAIN them scrolling underneath: driving
            the real dialog showed Cancel/Save sitting on top of "Discard this
            formula?", with its Keep-editing/Discard buttons peeking out below and
            unreachable. A sticky element must carry whatever it is answering. */}
        <div className={styles.footer}>
          {saveHint && (
            <p className={styles.saveHint} data-testid="save-hint">{saveHint}</p>
          )}

          {/* ⛔ AN INLINE CONFIRM, NOT `window.confirm`. A native dialog blocks the
              page, cannot be styled, and — measured this session — makes the
              surface untestable through the browser, because the automation that
              would verify this fix is exactly what a blocking modal freezes. */}
          {confirmDiscard && (
            <div className={styles.discardBar} role="alertdialog" data-testid="discard-confirm">
              <span>Discard this formula?</span>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setConfirmDiscard(false)}
              >Keep editing</button>
              <button
                type="button"
                className="btn btn-ghost"
                data-testid="discard-yes"
                onClick={() => { setConfirmDiscard(false); onClose?.() }}
              >Discard</button>
            </div>
          )}

          <div className={styles.actions}>
            {editing && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={cancelEdit}
              >New formula</button>
            )}
            {/* Cancel goes through the SAME door as Escape and the × — one place
                decides whether unsaved work needs a prompt. */}
            <button type="button" className="btn btn-ghost" onClick={requestClose}>Cancel</button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={save}
              disabled={!canSave}
            >{saving ? 'Saving…' : (editing ? 'Save changes' : 'Save')}</button>
          </div>
        </div>

          {rows.length > 0 && (
            <section className={styles.listWrap} aria-labelledby="uct-saved-head">
              <h3 className={styles.sectionHead} id="uct-saved-head">Your formulas</h3>
              <ul className={styles.list}>
                {rows.map((row) => (
                  <li key={row.def_id} className={styles.listRow}>
                    <span className={styles.listName}>{row.definition?.meta?.name || row.def_id}</span>
                    <span className={styles.listSource}>{row.definition?.compute?.source}</span>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      aria-label={`Edit ${row.definition?.meta?.name || row.def_id}`}
                      onClick={() => openForEdit(row)}
                    ><UIcon name="edit" size={14} /></button>
                    {pendingDelete === row.def_id ? (
                      <>
                        <span className={styles.deleteAsk}>Delete?</span>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => setPendingDelete(null)}
                        >Keep</button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          aria-label={`Confirm delete ${row.definition?.meta?.name || row.def_id}`}
                          onClick={() => remove(row.def_id)}
                        >Delete</button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        aria-label={`Delete ${row.definition?.meta?.name || row.def_id}`}
                        onClick={() => setPendingDelete(row.def_id)}
                      ><UIcon name="trash" size={14} /></button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </BuilderBoundary>
      </div>
    </Sheet>
  )
}

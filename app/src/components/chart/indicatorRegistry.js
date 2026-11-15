// Indicator descriptors — the settings-tab rows for the things the ENGINE DOES
// NOT OWN, plus the GENERATED rows for the ones it does.
//
// ─── SUPERSEDED, NOT ABSORBED (B3 adjudication A6) ──────────────────────────
//
// This file opened, in July 2026, with "the indicator list is currently
// enumerated in seven places". The B3 plan counted SIXTEEN. Walked again it was
// twenty, then twenty-one, then twenty-two, and Task 12's own walk found
// thirty-one — every correction from someone reading the code instead of the
// previous count. Ending that is what the whole indicator platform is for.
//
// The answer is NOT to finish this file's half-built `inputs[]` layer:
// `engine/defSchema.js` IS that layer, with typed inputs, `$ref` substitution,
// plot declarations, validation and two consumers. A second one would be a
// second source of truth per indicator — the very defect being retired.
//
// So this file is SUPERSEDED, and "superseded" has a precise meaning here,
// because the obvious reading of it is a user-facing regression:
//
//   ⛔ DELETING VWAP'S ROW WOULD HAVE TAKEN AWAY OPACITY, LINE STYLE AND LINE
//   WIDTH WITH NOTHING REPLACING THEM UNTIL B4. `ChartToolbar` offers VWAP a
//   checkbox and a colour swatch and nothing else, so those three controls
//   exist on this surface ALONE. Task 11 measured that and refused the deletion.
//
// What is deleted is the HAND-WRITTEN ENUMERATION, not the row. `VWAP_FIELDS`
// — four field descriptors that were a verbatim second copy of the definition's
// four declared inputs — is gone. The row is now DERIVED from
// `engine/nativeRegistry`'s definition by `fieldsFromDefinition`, so the
// definition is the single source of truth for what VWAP's controls ARE, what
// they are LABELLED, and what values they ACCEPT. Add an input to the
// definition and the row grows a control; there is no second place to edit.
//
// ─── WHAT STAYS HAND-WRITTEN, AND WHY IT CANNOT BE DERIVED ──────────────────
//
//   · the MOVING-AVERAGE OVERLAYS, whose identity is POSITIONAL. Slot 0 IS "the
//     9 EMA" to every blob ever written, `mergeChartSettings` merges the array
//     by index and pads it, and giving an overlay an `instanceId` makes one of
//     the two identities a lie the moment both exist (`engine/instances.js`).
//     Migrating them means deleting the legacy overlay render block in the same
//     change, which is its own plan.
//   · the VOLUME PANE, which is not an indicator at all — it has no definition,
//     no compute, and a `visible` flag rather than an `enabled` one.
//
// ─── B4 TASK 6: EVERY DEFINITION GETS A ROW, AND THE LIST OF WHICH ONES DO IS
// ─── DELETED ────────────────────────────────────────────────────────────────
//
// `ENGINE_ROW_DEF_IDS` — "the migrated definitions that KEEP a settings-tab row
// until B4" — is GONE. It existed only while SOME definitions had a generated
// row and others did not, and the rail that guarded it (*every id that keeps a
// generated row still has a control that exists NOWHERE ELSE*) was written to go
// RED on exactly this change. `listEngineIndicators` walks
// `registry.listDefinitions()` now, so a definition added to `nativeRegistry`
// brings its own row, its own controls and its own section with it.
//
// ⭐ THIS CLOSES THE MACD GAP THE LEDGER MEASURED. `macdColor` and `signalColor`
// had a control on NO surface — not the toolbar, not the settings tab. A
// generated MACD row carries both, because the definition declares both.
//
// ⛔ AND IT IS NOT `listDefinitions()` WITH A WRAPPER. `volumeProfile` is a
// settings section with no definition (it draws to a sibling 2D canvas), so a
// list built from definitions alone silently DROPS its row — the user-facing
// regression B3 Task 11 refused. `listAllIndicators` appends
// `indicatorCatalog.CARVED_OUT_ROWS`, whose `fields` are the one hand-written
// field table left in the platform and sit next to the exemption they belong to.
//
// ─── ⛔ THE RAIL ────────────────────────────────────────────────────────────
//
// A definition id in `ENGINE_OWNED` may NOT appear in
// `listIndicators()`. `engine/__tests__/enumerationSites.test.js` fails if one
// does. VWAP was the last overlap; its row moved to `listEngineIndicators()`,
// which hand-writes no field at all. Its successor rail is *every declared input
// of every definition is reachable from the generated dialog* — a rail that
// retires without a successor is how this file grew the problem it is retiring.
//
// ─── AND ONE READER, ONE WRITER ─────────────────────────────────────────────
//
// An engine-owned row is a CONTROL DOOR onto a flipped indicator, and Task 11
// established the contract every other door already follows: read through
// `isIndicatorEnabled`, write through `instanceControls`. Before this the row
// wrote `settings.indicators.vwap.*` RAW — which works for a blob with no
// stored instance (the migrator projects it) and silently does nothing once one
// exists, because `migrateLegacyToInstances` never re-reads the legacy section
// for an instance id it already has. That is the same defect Alt+U carried into
// Flip B, on a surface nobody had walked.
//
// FIELD TYPES the tab knows how to render:
//   select  — options: [[value, label], …]
//   number  — min / max / step
//   color   — opens the shared ColorPanel (supports opacity)
//   toggle  — boolean
// A field marked `disabled: '<reason>'` renders greyed with the reason as a
// title. That is deliberate: `offset` and `plotStyle` are in the MA schema but
// not yet honored by the renderer (both need series-level work in StockChart —
// offset re-keys every data point; plotStyle swaps the LWC series type).
// Showing them inert is honest; showing them live would silently do nothing.

import { isInstanceTombstone } from './chartDefaults'
import { ENGINE_OWNED } from './engine/flipState'
import {
  isIndicatorEnabled, setIndicatorEnabled, setIndicatorInput, setInstanceInput, definitionVisibility,
} from './engine/instanceControls'
// ⚠️ THE ONE MINTER, IMPORTED — never the literal `legacy:`. `USER_ID_PREFIX` and
// `LEGACY_ID_PREFIX` live in `engine/instances.js` and a typed copy here would be
// the twin this phase retires, in the file whose header is about retiring them.
import { legacyInstanceId } from './engine/instances'
// ⭐ UCT RS PHASE 3 (unit 3-01) — the ONE reader of an enum option's gate marker.
import { enumOptionRequiresServer, validateInputValue } from './engine/defSchema'
// ⭐ RS split U1 — the definition-level gate (`meta.requiresServer`).
import { isDefinitionOffered } from './engine/serverCompute'
import { inputsAsRead } from './engine/legacyInputs'
// ⚠️ IMPORTED, NEVER REDEFINED. The B4 plan sketched `unwiredKeys` and a second
// carved-out field table inside THIS file; both live in `indicatorCatalog.js`,
// because a predicate — or a field table — copied into two files is precisely
// the twin this whole phase is retiring.
import { CARVED_OUT_ROWS, unwiredKeys, NOT_IN_BLOB } from './indicatorCatalog'

// The fixture tombstone. A removed MA overlay / volume pane keeps its slot (the
// merge is POSITIONAL — see `chartDefaults`'s header) and simply stops being
// listed and drawn.
import { isOverlayRemoved, isVolumeRemoved } from './chartDefaults'
// ⭐ ONE NAMING AUTHORITY FOR THE SURFACES THAT NAME AN INSTANCE — the legend
// chip, the "Display in" menu and this tab's rows.
import { instanceLabel } from './engine/sourceRef'
import { disambiguateLabels } from './engine/readout'
import { namesItselfSemantically } from './engine/semanticName'

/** The two moving averages a member can pick, in the words a trader uses.
 *
 *  ⚰️ THE LABELS WERE `Simple` AND `Exponential`, and the engine's own MA has
 *  always said `SMA` / `EMA`. One chart could therefore show `Average type:
 *  Exponential` on EMA 9 and `Type: EMA` on the average beside it — two
 *  vocabularies for one concept, which is the split this whole surface exists to
 *  hide. The trading words win because they are what the ROW is already called
 *  (`EMA 9`, `SMA 50`) on the chart, in the legend and in this list.
 *
 *  ⛔ THE VALUES ARE UNTOUCHED. `SMA` / `EMA` are what `cs.overlays[n].type`
 *  stores and what the renderer switches on; only the words beside them changed,
 *  so no saved chart means anything different than it did. */
export const MA_TYPES = [['SMA', 'SMA'], ['EMA', 'EMA']]
export const LINE_STYLES = [['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted']]
export const LINE_WIDTHS = [[1, '1px'], [2, '2px'], [3, '3px'], [4, '4px']]
export const PLOT_STYLES = [['line', 'Line'], ['histogram', 'Histogram'], ['area', 'Area']]

const NOT_WIRED = 'Coming soon — needs renderer support'

/** The engine definition that IS the member's "Moving Average".
 *  ⚠️ NAMED ONCE so the row builder and any reader agree; see `memberConcept`. */
export const MOVING_AVERAGE_DEF = 'movingAverage'

/** Reason shown on the volume-pane controls when the SURFACE owns that layout.
 *  The charts workspace + the multi-chart grid hand StockChart `volumeSeparatePane`
 *  and `volumePaneHeightPct`, and those props WIN: StockChart ORs the flag
 *  (`volumeSeparatePane || cs.volume.separatePane`) and prefers the prop for the
 *  height (`volumePaneHeightPct ?? cs.volume.paneHeightPct`). The forcing is
 *  deliberate — the workspace's price-scale margins are tuned for a chart whose
 *  volume sits in its own pane, and its height is set by DRAGGING the separator
 *  (persisted to the `charts_vol_pane_pct` pref), not by this slider. So the saved
 *  prefs are inert there, and the UI says so. Same honesty rule as NOT_WIRED
 *  above: showing a control inert beats showing it live doing nothing. */
export const VOLUME_PANE_SURFACE_FIXED = "Fixed by this chart's layout"

/** Fields for one moving-average overlay.
 *
 *  ⭐⭐ `appearance: true` IS A DECLARATION, NOT A HINT. An engine definition
 *  already says which of its inputs are presentation — `styleInputKeys` derives
 *  that from `plots[].$refs`, so it can never fall out of step with the renderer.
 *  These two field arrays have no definition and therefore no `$refs`, so the
 *  claim has to be written somewhere; it is written HERE, at the one place the
 *  fields are declared, rather than as a list of key names inside whichever view
 *  happens to want the split. A view that grouped by key name would be a second
 *  authority, and the next field added here would silently land in the wrong
 *  group on a surface nobody thought to update. */
export const MA_FIELDS = [
  { key: 'type',      label: 'Type',         type: 'select', options: MA_TYPES },
  { key: 'color',     label: 'Color',        type: 'color', appearance: true },
  // ON = the line draws in FRONT of the candles (overlaps); OFF = behind them.
  { key: 'onTop',     label: 'Overlap candles', type: 'toggle', appearance: true },
  { key: 'period',    label: 'Period',       type: 'number', min: 1, max: 400, step: 1 },
  { key: 'offset',    label: 'Offset',       type: 'number', min: -100, max: 100, step: 1, disabled: NOT_WIRED },
  { key: 'plotStyle', label: 'Plot style',   type: 'select', options: PLOT_STYLES, disabled: NOT_WIRED, appearance: true },
  { key: 'lineStyle', label: 'Line style',   type: 'select', options: LINE_STYLES, appearance: true },
  { key: 'lineWidth', label: 'Line width',   type: 'select', options: LINE_WIDTHS, appearance: true },
]

/** Bar styles for the volume pane. 'columns' = the built-in full-slot histogram
 *  (bars touch, the long-standing look); 'histogram' = thin bars with a visible
 *  gap between each (TC2000-style, drawn by the ThinVolumeSeries custom series). */
export const VOLUME_BAR_STYLES = [['columns', 'Columns'], ['histogram', 'Histogram']]

/** Fields for the volume pane. */
export const VOLUME_FIELDS = [
  { key: 'barStyle',     label: 'Bar style',    type: 'select', options: VOLUME_BAR_STYLES, appearance: true },
  { key: 'upColor',      label: 'Up bars',      type: 'color', appearance: true },
  { key: 'downColor',    label: 'Down bars',    type: 'color', appearance: true },
  { key: 'separatePane', label: 'Separate pane', type: 'toggle' },
  { key: 'hvcEnabled',   label: 'Highlight 52W volume highs', type: 'toggle' },
  // Visibility only — the label's COLOR is not user-editable; it tracks the range
  // buttons above it (--chart-panel-text-low) so the two always match.
  // ⚰️ IT READ *"Show $ Vol / Avg label"* AND NAMED TWO READINGS THAT NO LONGER
  // EXIST BY DEFAULT (owner §16, 2026-09-16). `$ Vol` is a DEFINITION now and
  // the volume MA is off unless a member sets a period; what this toggle governs
  // is the volume pane's own readout — Volume, its average when there is one, and
  // every series displayed in that pane.
  { key: 'labelVisible', label: 'Show volume pane label', type: 'toggle' },
  { key: 'maPeriod',     label: 'Volume MA period', type: 'number', min: 0, max: 200, step: 1 },
  { key: 'maColor',      label: 'Volume MA color',  type: 'color',  showIf: (v) => Number(v.maPeriod) > 0, appearance: true },
  { key: 'maLineWidth',  label: 'Volume MA width',  type: 'select', options: LINE_WIDTHS, showIf: (v) => Number(v.maPeriod) > 0, appearance: true },
]

// ─── THE ENGINE-OWNED ROWS ──────────────────────────────────────────────────

/** Normalise an enum option to the `[value, label]` pair the tab renders.
 *  `defSchema.enumOptionValue` accepts three shapes; the renderer accepts one. */
function optionPair(option) {
  if (Array.isArray(option)) return [option[0], option[1] ?? String(option[0])]
  if (option && typeof option === 'object' && 'value' in option) {
    return [option.value, option.label ?? String(option.value)]
  }
  return [option, String(option)]
}

/**
 * ONE declared engine input → the field descriptor the Indicators tab renders.
 *
 * This function is the whole of what a per-indicator `*_FIELDS` array used to
 * be, written once instead of once per indicator. Returns `null` for an input
 * type the tab has no control for — those render nothing rather than rendering
 * wrong. ⭐ UCT RS Phase 3, unit 3-02: `string` came off that list when the
 * settings dialog and the phone sheet gained a text box (`type: 'text'`).
 *
 * ⭐⭐ `source` USED TO BE ON THAT LIST, AND IT CAME OFF WHEN IT ACQUIRED A REAL
 * CONTROL. While no shipped definition declared one the honest answer was `null`;
 * `dataSeries` declares one and is member-facing, so "renders nothing" would mean
 * an instance whose INSTRUMENT cannot be changed. The generated-control census
 * (`enumerationSites`) asserts every declared input is reachable, and it is the
 * rail that would have caught a field descriptor returned for a control the tab
 * cannot draw — which is why the descriptor and the renderer landed together.
 */
export function fieldFromInput(input) {
  if (!input || typeof input.key !== 'string' || !input.key) return null
  const base = { key: input.key, label: input.label || input.key }
  switch (input.type) {
    case 'color':
      return { ...base, type: 'color' }
    case 'bool':
      return { ...base, type: 'toggle' }
    case 'enum':
      return { ...base, type: 'select', options: (input.options || []).map(optionPair) }
    // ⛔ A SOURCE CARRIES NO OPTIONS, AND THAT IS THE DIFFERENCE FROM AN ENUM.
    // An enum's choices are declared by the definition and are the same on every
    // chart; a source's depend on what else is ON this chart (another instance's
    // output) and on what the member searches for (a symbol). So the descriptor
    // names the TYPE only, and the control builds its own list from the live
    // settings through `sourceRef.sourceOptions`.
    case 'source':
      return { ...base, type: 'source' }
    case 'int':
    case 'float':
      return {
        ...base,
        type: 'number',
        min: input.min,
        max: input.max,
        step: input.step ?? (input.type === 'int' ? 1 : 0.1),
      }
    // ⭐ PHASE 3 WS-D — a pasted Pine script's `input.time` (UNIX ms) and `input.session`
    // (`HHMM-HHMM[:days]`), declared only on a runtime document (`defSchema.RUNTIME_INPUT_TYPES`).
    case 'time':
      return { ...base, type: 'datetime' }
    case 'session':
      return { ...base, type: 'session' }
    // ⭐ UCT RS Phase 3, unit 3-02 — a text box. It carries the input's declared
    // `pattern`, `maxLength`, `case`, `placeholder` and `hint` (only those it
    // declares), which is everything the control needs to refuse a value before
    // `setInstanceInput` would (`textInputCommit`).
    case 'string': {
      // ⭐ 2026-11-12 — a string that names a server-owned list of choices
      // (`optionsSource`, e.g. the RS "Pick a theme" benchmark) is a searchable
      // chooser on every surface (`OptionsSourcePicker`), never a free text box:
      // what it stores is the chosen entry's ID.
      const out = { ...base, type: input.optionsSource ? 'pick' : 'text' }
      if (input.optionsSource) out.optionsSource = input.optionsSource
      for (const k of TEXT_FIELD_KEYS) if (input[k] !== undefined) out[k] = input[k]
      return out
    }
    default:
      return null
  }
}

const TEXT_FIELD_KEYS = ['pattern', 'maxLength', 'case', 'placeholder', 'hint']

/** ⭐ 3-02 — the line a text box shows under itself when a typed value is refused:
 *  the input's own declared `hint`, else a generic sentence. */
export const TEXT_INPUT_FALLBACK_HINT = 'Not a valid value'

/**
 * ⭐ UCT RS Phase 3, unit 3-02 — what a text box would commit for `raw`.
 *
 * Trims, upper-cases when the field says `case: 'upper'`, then asks the ONE
 * answer to "may this input take this value" for a string
 * (`defSchema.validateInputValue`, the check `setInstanceInput` runs), so the
 * box never offers a write the engine would refuse. Empty is always legal and
 * means "not set".
 *
 * @returns {{ok: boolean, value: string, hint: string|null}} `hint` is the
 *   sentence to show on a miss, null on a hit.
 */
export function textInputCommit(field, raw) {
  let value = typeof raw === 'string' ? raw.trim() : (raw == null ? '' : String(raw).trim())
  if (field && field.case === 'upper') value = value.toUpperCase()
  const errors = []
  const spec = { type: 'string' }
  for (const k of ['pattern', 'maxLength']) if (field && field[k] !== undefined) spec[k] = field[k]
  validateInputValue(spec, value, 'text', errors)
  if (!errors.length) return { ok: true, value, hint: null }
  const hint = field && typeof field.hint === 'string' && field.hint ? field.hint : TEXT_INPUT_FALLBACK_HINT
  return { ok: false, value, hint }
}

/** ⭐ 3-02 — the text a box shows as the member types: upper-cased when told to,
 *  never trimmed (trimming under the cursor eats a space before it is followed). */
export function textInputDraft(field, raw) {
  const text = typeof raw === 'string' ? raw : (raw == null ? '' : String(raw))
  return field && field.case === 'upper' ? text.toUpperCase() : text
}

/** The label suffix a stored, server-gated option carries while the live row does
 *  not declare it (`fieldsForInstance`). */
export const UNAVAILABLE_OPTION_SUFFIX = ' (not available)'

/** ⭐ PHASE 3 WS-D — a time input's value (UNIX ms) as the `datetime-local` text the dialog
 *  shows, IN UTC (`YYYY-MM-DDTHH:MM`), or '' for a value that is not one. The dialog labels the
 *  control "UTC", so the member reads the instant the script compares against.
 *  ⚠️ Known limits, by decision: MINUTE resolution (seconds in an author default are not shown, and
 *  a re-picked time stores a whole minute), and a year outside 0000..9999 has no four-digit text
 *  (`toISOString` writes `+010000-…`), so the control shows empty and `timeInputMs` cannot invert it. */
export function timeInputText(ms) {
  if (!Number.isInteger(ms)) return ''
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return ''
  return d.toISOString().slice(0, 16)
}

/** ⭐ PHASE 3 WS-D — the inverse: `YYYY-MM-DDTHH:MM` read as UTC → UNIX ms, or null. */
export function timeInputMs(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(text || ''))
  if (!m) return null
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])
  return timeInputText(ms) === text ? ms : null
}

// ─── THE SERVER GATE AND LEGACY INPUTS (UCT RS Phase 3, unit 3-01) ─────────
//
// ⭐⭐ WHAT A SETTINGS SURFACE MAY SHOW, GIVEN WHAT THE LIVE SERVER DECLARES.
// `declared` is `serverCompute.serverDeclares(def.id)`: `{inputs, options}` from
// the live row, or `null` while unknown or after a failure. The rules
// (`defSchema.validateServerGates` refuses the shapes that would break them):
//
//   - a `legacy: true` input is NEVER rendered. It stays declared so a stored
//     instance carrying it still validates, and `values` still holds it;
//     ⭐ 3-14: EXCEPT while its `mapsTo` successor is itself gated off (the
//     server has not declared it): then the legacy input is the only control
//     this server reads, so it renders and writes itself until the successor
//     shows (`legacySuccessorPending`);
//   - a `requiresServer: true` input is shown only when `declared.inputs` names it;
//   - a `requiresServer` enum OPTION is listed only when `declared.options[key]`
//     names its value;
//   - ⛔ `null` IS "NOT DECLARED". Fail closed: a gated control one page load late
//     is a non-event; one shown against a server that cannot answer it draws nothing;
//   - an UNGATED input or option is never hidden, whatever the server says. The
//     gate only ever hides what a definition marked, so a definition that marks
//     nothing renders exactly what it rendered before the gate existed — by
//     IDENTITY: the same input objects reach `fieldFromInput`.

function declaresInput(declared, key) {
  return !!declared && Array.isArray(declared.inputs) && declared.inputs.includes(key)
}

function declaresOption(declared, key, value) {
  const opts = declared && declared.options && typeof declared.options === 'object' ? declared.options[key] : null
  return Array.isArray(opts) && opts.includes(value)
}

const optionValueOf = (option) => optionPair(option)[0]

/**
 * ⭐ UCT RS 3-14 — IS A LEGACY INPUT'S SUCCESSOR LIVE, given `declared`? A
 * `legacy` input whose `mapsTo` names a successor is REPLACED only once the
 * successor can be shown: its input is not hidden by the server gate and the
 * value it maps to is not an undeclared gated option. Until then the legacy
 * input is still the only control that does the job on this server (v3 reads
 * `showMansfield`, never `view`), so it renders and writes itself.
 * A legacy input with no `mapsTo` (or one naming no declared input) has no
 * successor to wait for: it is retired, as before.
 */
function legacySuccessorPending(input, declared, def) {
  const m = input && input.legacy === true ? input.mapsTo : null
  if (!m || typeof m !== 'object' || typeof m.key !== 'string' || !def) return false
  const target = (Array.isArray(def.inputs) ? def.inputs : []).find((i) => i && i.key === m.key)
  if (!target || target.legacy === true) return false
  if (isInputHidden(target, declared)) return true
  if (target.type === 'enum' && Array.isArray(target.options)) {
    const option = target.options.find((o) => optionValueOf(o) === m.value)
    if (option !== undefined && enumOptionRequiresServer(option) && !declaresOption(declared, m.key, m.value)) return true
  }
  return false
}

/**
 * Is this declared input hidden from every settings surface, given `declared`?
 * ⭐ 3-14 — pass the definition (`def`) and a legacy input whose `mapsTo`
 * successor is still gated off is SHOWN (`legacySuccessorPending`). Without
 * `def` a legacy input is always hidden, the 3-01 answer.
 */
export function isInputHidden(input, declared = null, def = null) {
  if (!input || typeof input !== 'object') return true
  if (input.legacy === true) return !legacySuccessorPending(input, declared, def)
  return input.requiresServer === true && !declaresInput(declared, input.key)
}

/**
 * The inputs a settings surface renders, in DECLARATION ORDER: legacy and
 * undeclared gated inputs dropped, undeclared gated options filtered out. An
 * input with no gated option is returned AS IS (the same object).
 */
export function visibleInputs(def, declared = null) {
  const inputs = Array.isArray(def?.inputs) ? def.inputs : []
  const out = []
  for (const input of inputs) {
    if (isInputHidden(input, declared, def)) continue
    if (input.type === 'enum' && Array.isArray(input.options) && input.options.some(enumOptionRequiresServer)) {
      out.push({
        ...input,
        options: input.options.filter((o) => !enumOptionRequiresServer(o)
          || declaresOption(declared, input.key, optionValueOf(o))),
      })
    } else {
      out.push(input)
    }
  }
  return out
}

/**
 * ⭐ UCT RS 3-14 — is this PLOT gated off every settings surface, given `declared`?
 * A plot marked `requiresServer: true` is a column only the gated server row sends
 * (the Phase 3 readings' lines: RS-Ratio, Momentum, Quality, VARS). Its Plot style
 * row is offered only once the live row declares EVERY `requiresServer` input of
 * the definition (decision D20: one flag arms the whole contract), so a v3 server
 * shows the inspector it always did. `null` hides it (fail closed). An unmarked
 * plot is never hidden here.
 */
export function isPlotHidden(def, plot, declared = null) {
  if (!plot || typeof plot !== 'object' || plot.requiresServer !== true) return false
  if (!declared) return true
  const gated = (Array.isArray(def?.inputs) ? def.inputs : []).filter((i) => i && i.requiresServer === true)
  if (!gated.length) return true
  return !gated.every((i) => declaresInput(declared, i.key))
}

/**
 * ⭐ The presets a picker lists, given `declared`. Hidden:
 *   - a preset whose `inputs` set a hidden gated input, or set an enum to a
 *     gated option the live row does not declare (applying it would write a
 *     value no control on the form can show);
 *   - a `requiresServer` preset, unless the live row declares every input it
 *     sets that the definition sends to the server (`meta.serverInputs`; every
 *     key it sets when the definition names no such list), each enum value among
 *     the row's options for that key. `null` hides it (fail closed).
 * ⚠️ A preset that sets a `legacy` input is NOT hidden for it: the key is still
 * a valid value to write (that is what `legacy` means), and a preset that keeps
 * an old layout's meaning through it is the reason the key was kept.
 * ⭐ UCT RS 3-08 — and an UNGATED preset (no `requiresServer`) is not hidden for a
 * gated input it sets when either
 *   - the value is that input's declared DEFAULT: an unset input already reads
 *     it, so the write changes nothing a form or an undeclaring server can see
 *     (Classic's `view: 'ratio'`, stated so `detectPreset` stays exact); or
 *   - the preset ALSO sets a `legacy` input: the old key carries the preset's
 *     meaning to a server that has not declared the new one, and a server that
 *     has reads the new key (Trend's `showMansfield: true` beside
 *     `view: 'mansfield'`, decision D2).
 * Without these the shipped presets of a definition that grows a gated input
 * would vanish from the picker until the server row is armed.
 * A key that names no declared input is skipped, as the picker already skips it.
 *
 * @returns {object[]} the definition's own preset objects, in declared order.
 */
export function visiblePresets(def, declared = null) {
  const presets = def && def.meta && Array.isArray(def.meta.presets) ? def.meta.presets : []
  const byKey = new Map((Array.isArray(def?.inputs) ? def.inputs : [])
    .filter((i) => i && typeof i.key === 'string').map((i) => [i.key, i]))
  const sent = def && def.meta && Array.isArray(def.meta.serverInputs) ? new Set(def.meta.serverInputs) : null
  const optionFor = (input, value) => (Array.isArray(input.options) ? input.options : [])
    .find((o) => optionValueOf(o) === value)
  return presets.filter((p) => {
    if (!p || typeof p !== 'object') return false
    const vals = p.inputs && typeof p.inputs === 'object' ? p.inputs : {}
    const ungated = p.requiresServer !== true
    const carriesLegacy = Object.keys(vals).some((k) => byKey.get(k)?.legacy === true)
    for (const [key, value] of Object.entries(vals)) {
      const input = byKey.get(key)
      if (!input || input.legacy === true) continue
      if (isInputHidden(input, declared)) {
        if (ungated && (value === input.default || carriesLegacy)) continue
        return false
      }
      if (input.type === 'enum') {
        const option = optionFor(input, value)
        if (option !== undefined && enumOptionRequiresServer(option) && !declaresOption(declared, key, value)) return false
      }
    }
    if (p.requiresServer === true) {
      if (!declared) return false
      for (const [key, value] of Object.entries(vals)) {
        const input = byKey.get(key)
        if (!input || (sent && !sent.has(key))) continue
        if (!declaresInput(declared, key)) return false
        const opts = declared.options && declared.options[key]
        if (input.type === 'enum' && Array.isArray(opts) && !opts.includes(value)) return false
      }
    }
    return true
  })
}

/** Every field a definition declares, in DECLARATION ORDER — which is the order
 *  the definition's author chose and the order `defSchema` validates in.
 *  ⭐ 3-01: through `visibleInputs`, so a legacy input never gets a field and a
 *  gated one gets one only when `opts.declared` declares it. */
export function fieldsFromDefinition(def, opts = {}) {
  return visibleInputs(def, opts && opts.declared).map(fieldFromInput).filter(Boolean)
}

// ─── THE PER-INSTANCE FORM MODEL (spec §6's settings dialog) ────────────────
//
// `listEngineIndicators` builds ONE ROW PER DEFINITION for the global modal's
// Indicators tab. The settings DIALOG is per INSTANCE — "RSI(7) settings" and
// "RSI(14) settings" are two different forms over one definition — so it needs
// the same generated fields resolved against ONE instance's inputs.
//
// ⛔ IT IS NOT A SECOND GENERATOR. Every field below comes out of
// `fieldFromInput`, the same call `listEngineIndicators` makes; this adds only
// the three things a per-instance FORM needs and a per-definition ROW does not:
// the instance's own values, the §3.1 presentation modifiers the row ignores
// (`group` / `inline` / `tooltip` / `activeWhen`), and the Inputs/Style split.

/**
 * The input keys a definition's PLOTS substitute — i.e. the ones that change how
 * the indicator LOOKS rather than what it computes.
 *
 * ⭐ DERIVED FROM `$refs`, NEVER FROM A LIST OF KEY NAMES. `defSchema.noteRef`
 * records `plots[].$refs = {color: 'color', width: 'lineWidth', …}` for exactly
 * the fields `SUBSTITUTABLE_PLOT_FIELDS` allows, and `pool.resolvePlotForInstance`
 * re-applies them per instance — so this set is, by construction, the inputs that
 * reach the renderer as STYLE. A hand-typed `['color','width','lineStyle']` would
 * have missed `bb`'s `bandColor` and mis-sorted anything an author names
 * differently, and it would rot the day a definition renames an input.
 */
export function styleInputKeys(def) {
  const keys = new Set()
  for (const plot of (Array.isArray(def?.plots) ? def.plots : [])) {
    const refs = plot && plot.$refs
    if (!refs) continue
    for (const [field, ref] of Object.entries(refs)) {
      if (field === 'levels') {
        for (const k of (Array.isArray(ref) ? ref : [])) if (typeof k === 'string' && k) keys.add(k)
      } else if (typeof ref === 'string' && ref) {
        keys.add(ref)
      }
    }
  }
  return keys
}

/**
 * ⭐ BATCH 2 — the style inputs ONLY a `hidden: true` plot reads (a colour rule's
 * hidden index column, a table-only value). The binder never draws such a plot
 * (`binder.js` orphans it), so its colour / width box would be a control with no
 * effect; the Inspector leaves these out. An input a visible plot also reads stays.
 */
export function hiddenPlotOnlyInputKeys(def) {
  const plots = Array.isArray(def?.plots) ? def.plots : []
  const hidden = styleInputKeys({ plots: plots.filter((p) => p && p.hidden === true) })
  if (!hidden.size) return hidden
  const shown = styleInputKeys({ plots: plots.filter((p) => p && p.hidden !== true) })
  for (const k of shown) hidden.delete(k)
  return hidden
}

/**
 * Is this input ACTIVE, given the values the form currently holds?
 *
 * `activeWhen` is the JSON-expressible successor to this file's own `showIf`
 * predicate (`defSchema:802` — a function cannot survive a definition
 * round-trip). `defSchema` deliberately does NOT lock the operator grammar in
 * v1; it validates only that the condition names a declared input, because a
 * condition on a key that does not exist would hide a control forever.
 *
 * ⛔ SO AN OPERATOR THIS BUILD CANNOT READ MEANS ACTIVE, NOT HIDDEN. The failure
 * direction matters: an unknown comparator returning `false` would make a future
 * definition's control permanently inert on an older client, silently — the same
 * class of defect the schema's own unresolvable-key check exists to prevent, one
 * version skew away. Returning `true` leaves the control usable and the value
 * validated, which is the recoverable half.
 *
 * With no comparator at all the condition is the referenced value's TRUTHINESS,
 * which is what the shipped `showIf` predicates already mean
 * (`(v) => Number(v.maPeriod) > 0`).
 */
export function evalActiveWhen(activeWhen, values) {
  if (!activeWhen || typeof activeWhen !== 'object' || typeof activeWhen.key !== 'string') return true
  const v = values ? values[activeWhen.key] : undefined
  if ('equals' in activeWhen) return v === activeWhen.equals
  if ('notEquals' in activeWhen) return v !== activeWhen.notEquals
  if ('in' in activeWhen) return Array.isArray(activeWhen.in) && activeWhen.in.includes(v)
  if ('gt' in activeWhen) return Number(v) > Number(activeWhen.gt)
  if ('gte' in activeWhen) return Number(v) >= Number(activeWhen.gte)
  if ('lt' in activeWhen) return Number(v) < Number(activeWhen.lt)
  if ('lte' in activeWhen) return Number(v) <= Number(activeWhen.lte)
  // An unrecognised comparator: see the header. Active, and the control still
  // validates whatever the user types against the declared input.
  if (Object.keys(activeWhen).some((k) => k !== 'key')) return true
  return !!v
}

/**
 * ONE INSTANCE's form model — the per-instance sibling of `listEngineIndicators`.
 *
 * @param {object} def      a REGISTERED definition (it carries resolved `$refs`)
 * @param {object} instance one element of `settings.indicatorInstances`
 * @returns {{defId, instanceId, values, all, inputs, style}}
 *   `values` — declared defaults with the instance's own inputs over them, which
 *              is the "unset means the current default" rule the migrator, the
 *              binder and `drawnValues` all use;
 *   `all`    — every generated field, in DECLARATION ORDER, each carrying its
 *              §3.1 presentation modifiers and its declared `type`;
 *   `inputs`/`style` — the same fields PARTITIONED by `styleInputKeys`, order
 *              preserved within each half. A partition, never a filter: an input
 *              that reached `all` reaches exactly one tab.
 * @param {{declared?: object|null}} [opts] ⭐ 3-01 — `declared` is
 *   `serverCompute.serverDeclares(def.id)`. `all` leaves out `legacy` inputs, and
 *   `requiresServer` inputs and options the live row does not declare (absent or
 *   `null` = not declared). `values` still carries every declared input: a hidden
 *   input is still computed with.
 */
export function fieldsForInstance(def, instance, opts = {}) {
  const declared = Array.isArray(def?.inputs) ? def.inputs : []
  const byKey = new Map(declared.map((i) => [i && i.key, i]))
  // ⭐ 3-08b: a stored legacy input reads as its successor (`legacyInputs`), so
  // the form, its activeWhen and its preset picker show what the chart draws.
  // Read-time only: nothing here is written back to the instance.
  const stored = inputsAsRead(def, (instance && instance.inputs && typeof instance.inputs === 'object') ? instance.inputs : {})

  const values = {}
  for (const d of declared) {
    if (!d || typeof d.key !== 'string') continue
    if (d.default !== undefined) values[d.key] = d.default
    if (Object.prototype.hasOwnProperty.call(stored, d.key)) values[d.key] = stored[d.key]
  }

  const all = fieldsFromDefinition(def, { declared: opts && opts.declared }).map((f) => {
    const d = byKey.get(f.key) || {}
    return {
      ...f,
      inputType: d.type,
      // ⚠️ `int` vs `float` decides whether a committed value is ROUNDED. `coerce`
      // (defSchema) refuses a non-integer for an `int`, so an unrounded 7.5 is a
      // write `setInstanceInput` silently declines — the generated field's `step`
      // alone cannot tell the two apart once an author declares `step: 1` on a float.
      isInt: d.type === 'int',
      group: typeof d.group === 'string' ? d.group : null,
      inline: typeof d.inline === 'string' ? d.inline : null,
      tooltip: typeof d.tooltip === 'string' ? d.tooltip : null,
      activeWhen: d.activeWhen || null,
    }
  })

  // ⭐ UCT RS Phase 3, unit 3-02 — A STORED GATED VALUE IS SHOWN, HONESTLY. An
  // instance saved while the server declared a gated option (`CUSTOM`) keeps it
  // after the server stops declaring it; a select whose value is missing from its
  // list renders as whatever option comes first, which is a lie about what the
  // chart is computing. So that ONE option comes back, DISABLED, labelled
  // "<label> (not available)": the member sees the truth and can choose a live
  // option, and cannot choose the dark one again. Only a value the definition
  // itself declares is restored — anything else would fail validation upstream.
  for (let i = 0; i < all.length; i++) {
    const f = all[i]
    if (f.type !== 'select' || !Object.prototype.hasOwnProperty.call(values, f.key)) continue
    const v = values[f.key]
    if ((f.options || []).some(([ov]) => ov === v)) continue
    const d = byKey.get(f.key)
    const hit = d && Array.isArray(d.options) ? d.options.find((o) => optionValueOf(o) === v) : undefined
    if (hit === undefined) continue
    const [, label] = optionPair(hit)
    all[i] = { ...f, options: [...(f.options || []), [v, `${label}${UNAVAILABLE_OPTION_SUFFIX}`, { disabled: true }]] }
  }

  const styleKeys = styleInputKeys(def)
  return {
    defId: def?.id,
    instanceId: instance?.instanceId,
    values,
    all,
    inputs: all.filter((f) => !styleKeys.has(f.key)),
    style: all.filter((f) => styleKeys.has(f.key)),
  }
}

// ─── THE GROUPING HELPERS (spec §3.1 `group` / `inline`, plan §6.3 `groupsCollapsed`) ──
//
// ⭐ UCT RS PHASE 2a, UNIT 2a-11 — these three are the settings dialog's own
// `sectionize` / `packRows` / `startsCollapsed`, lifted here so the phone sheet
// and the dialog read ONE answer to "which rows share a section, which rows
// share a line, which groups start folded". The dialog keeps its private copy
// until unit 2a-15 swaps it to these exports (that unit owns the dialog file);
// the rules below are the dialog's rules, byte for byte in effect, so that swap
// changes no pixel. Pure: no React, no DOM, no registry read.

/** §6: `inline` packs up to THREE same-type controls onto one row; a fourth wraps. */
export const INLINE_MAX = 3

/**
 * The groups a definition asks to START collapsed — `meta.groupsCollapsed`,
 * strings only, as a Set. A default, not a lock: the consumer keeps the member's
 * own toggles and reads this only for a group they have not touched. A
 * definition with no hint, or junk in it, yields an empty Set (everything opens).
 */
export function initialCollapsed(def) {
  const raw = def && def.meta && Array.isArray(def.meta.groupsCollapsed) ? def.meta.groupsCollapsed : []
  return new Set(raw.filter((g) => typeof g === 'string' && g))
}

const fieldOf = (item, byKey) => {
  if (typeof item !== 'string') return item
  if (!byKey) return null
  if (byKey instanceof Map) return byKey.get(item) || null
  return Object.prototype.hasOwnProperty.call(byKey, item) ? byKey[item] : null
}

/**
 * Rows for a compact layout: a run of consecutive fields sharing an `inline`
 * name AND a generated `type` is chunked at `INLINE_MAX` into packs; everything
 * else is its own row. Mixed types never pack (three widths on one row is a
 * layout, not a lie — the dialog's rule, pinned by its tests). Layout only:
 * every field that arrives here leaves here, in order.
 *
 * @param {Array<object|string>} fields  generated fields (`fieldsForInstance(...).all`
 *   or a slice of it), or their KEYS resolved through `byKey`
 * @param {Map|object} [byKey]  key → field, needed only when `fields` holds keys
 * @returns {Array<{kind:'row', field, keys:[string]} | {kind:'pack', inline, fields, keys}>}
 */
export function packRows(fields, byKey) {
  const list = (Array.isArray(fields) ? fields : []).map((f) => fieldOf(f, byKey)).filter((f) => f && typeof f.key === 'string')
  const out = []
  let i = 0
  while (i < list.length) {
    const f = list[i]
    if (!f.inline) { out.push({ kind: 'row', field: f, keys: [f.key] }); i += 1; continue }
    let j = i + 1
    while (j < list.length && list[j].inline === f.inline && list[j].type === f.type) j += 1
    for (let k = i; k < j; k += INLINE_MAX) {
      const slice = list.slice(k, Math.min(k + INLINE_MAX, j))
      out.push({ kind: 'pack', inline: f.inline, fields: slice, keys: slice.map((x) => x.key) })
    }
    i = j
  }
  return out
}

/**
 * Sections by declared `group`, in FIRST-APPEARANCE order, each carrying its
 * fields in declaration order, its packed rows and whether the definition asks
 * it to start collapsed. Ungrouped fields keep a headerless section
 * (`group: null`), so a definition that declares no group renders exactly what
 * it did before groups existed: one section, no head, never collapsed.
 *
 * @param {object} def     a registered definition (read for `meta.groupsCollapsed`)
 * @param {Array<object>} [fields]  the generated fields to section — all of
 *   them, or one tab's half (`.inputs` / `.style`); defaults to every field of
 *   the definition at its declared defaults
 * @returns {Array<{group: string|null, label: string|null, keys: string[], fields: object[], rows: object[], collapsed: boolean}>}
 */
export function sectionize(def, fields) {
  const list = Array.isArray(fields) ? fields : fieldsForInstance(def, null).all
  const hint = initialCollapsed(def)
  const order = []
  const byGroup = new Map()
  for (const f of list) {
    if (!f || typeof f.key !== 'string') continue
    const g = typeof f.group === 'string' && f.group ? f.group : null
    if (!byGroup.has(g)) { byGroup.set(g, []); order.push(g) }
    byGroup.get(g).push(f)
  }
  return order.map((g) => {
    const fs = byGroup.get(g)
    return {
      group: g,
      label: g,
      keys: fs.map((f) => f.key),
      fields: fs,
      rows: packRows(fs),
      collapsed: g !== null && hint.has(g),
    }
  })
}

/** EVERY live (non-tombstoned) instance of a definition, in STORED ORDER.
 *
 * ⭐ chart-UX-walls TASK 6 — THIS WAS `liveInstanceFor`, WHICH TOOK THE FIRST
 * MATCH. That was honest while at most one instance per definition could exist:
 * the write door was keyed to `legacyInstanceId(defId)` and there was never a
 * second one to lose. Task 1 opened the per-instance write door and this task
 * gives it two callers, so "the first match" silently became "whichever RSI the
 * v1→v2 fold happened to seed" — a settings row editing a line the user did not
 * point at. Stored order is the order `withInstances` sorted the list into, which
 * is the order the panes and the legend already read.
 */
function liveInstancesFor(defId, settings) {
  const list = Array.isArray(settings?.indicatorInstances) ? settings.indicatorInstances : []
  return list.filter((i) => {
    if (!i || typeof i !== 'object' || i.defId !== defId) return false
    try { return !isInstanceTombstone(i) } catch { return false }
  })
}

/**
 * The values the row DISPLAYS: what the chart is actually drawing with.
 *
 * With a stored instance the instance's inputs win, falling back to the
 * definition's declared defaults for a key the instance omits ("unset means
 * current default", the same rule the migrator and the binder use). Showing the
 * mirror while the instance draws something else is the "two numbers for one
 * line" defect `flipState.engineDrawnInputs` exists to prevent on the toolbar.
 *
 * ⭐⭐ B5 TASK 9 — WITH NO INSTANCE THE ROW SHOWS THE DEFINITION'S DEFAULTS, AND
 * IT USED TO SHOW THE LEGACY SECTION. That section is DELETED (the settings blob
 * stops enumerating indicators), so `settings.indicators[def.id]` is `undefined`
 * for every definition and this returned `{}` — an unchecked RSI whose Period box
 * had gone BLANK, on every surface that renders a generated row. No test named
 * it, because every test that touched these rows turned the indicator on first.
 *
 * The declared default IS what the chart would draw the moment the box is
 * ticked, which is the property this function is named for.
 *
 * ⭐ chart-UX-walls TASK 6 — `live` IS NOW A PARAMETER, not a lookup. A definition
 * with two instances produces two rows, and each one has to show ITS OWN numbers;
 * a function that re-found "the first live instance" internally would print RSI(14)'s
 * period on RSI(7)'s row while the chart drew 7. `null` is the no-instance branch.
 *
 * ⚠️ THE SECTION IS STILL READ, and it is not vestigial: `mergeSettingsOverride`
 * is NOT an allow-list, so a grid cell's per-cell override and the `?indicators=`
 * render route can still put one on the blob — and `setIndicatorInput` writes it
 * for an indicator that is switched OFF (typing a period beside an unchecked box
 * must not add the indicator to the chart). It sits BELOW the instance and ABOVE
 * the declared default, which is the precedence every other reader uses.
 */
function drawnValues(def, settings, live) {
  const section = (settings && settings.indicators && settings.indicators[def.id]) || {}
  // ⭐ 3-08b: the legacy → successor read, as `fieldsForInstance` (`legacyInputs`).
  const inputs = (live && live.inputs && typeof live.inputs === 'object') ? inputsAsRead(def, live.inputs) : null
  const out = {}
  for (const declared of (Array.isArray(def.inputs) ? def.inputs : [])) {
    if (!declared || typeof declared.key !== 'string') continue
    if (declared.default !== undefined) out[declared.key] = declared.default
  }
  // The section overrides the declared defaults …
  Object.assign(out, section)
  if (!inputs) return out
  // … and a LIVE instance overrides both, falling back to the DECLARED default
  // rather than to the section: absent-from-inputs means "the definition
  // default", and that is what the chart draws.
  for (const declared of (Array.isArray(def.inputs) ? def.inputs : [])) {
    if (!declared || typeof declared.key !== 'string') continue
    const k = declared.key
    if (Object.prototype.hasOwnProperty.call(inputs, k)) out[k] = inputs[k]
    else if (declared.default !== undefined) out[k] = declared.default
  }
  return out
}

/**
 * The engine-owned rows — GENERATED, never hand-written, ONE PER LIVE INSTANCE.
 *
 * ⭐⭐ chart-UX-walls TASK 6 — IT WAS "ONE PER DEFINITION", AND THAT WAS THE LAST
 * PLACE IN THE PLATFORM THAT COULD NOT SAY WHICH RSI YOU MEANT.
 * `setIndicatorEnabled`'s own docstring blamed the per-definition tombstone on
 * *"a settings row is per-DEFINITION at v1"* — this is that v1 ending. A
 * definition with N live instances emits N rows; a definition with none emits ONE
 * row keyed by the defId, which is the "turn it on" control every fresh chart
 * shows and the only row a user can reach before an instance exists.
 *
 * ⛔ THE ROW `id` IS THE `instanceId` WHENEVER THERE IS ONE, AND THAT IS A
 * CONTRACT, not a cosmetic. `ChartSettingsModal` looks a row up with
 * `indRowById(rowId)` and builds every colour-swatch target as
 * `ind:${row.id}:${field}` — so two rows sharing `id: 'rsi'` would send the
 * SECOND row's colour edit to the FIRST instance, silently. (An instanceId
 * contains a `:`, which is why that modal splits on the FIRST and LAST colon
 * rather than on every one.)
 *
 * ⛔ `enabled` STAYS PER-DEFINITION ON EVERY ROW. "RSI: off" means no RSI —
 * `setIndicatorEnabled` tombstones every live instance, deliberately — and the
 * per-instance verb is `removeInstance`, which belongs to the chip's Remove and
 * not to a definition toggle. Two rows of one definition therefore read the same
 * `enabled`, by construction.
 *
 * `registry` is the module namespace of `engine/nativeRegistry` (or anything
 * with `listDefinitions`), passed in rather than imported so this file does not
 * pull the whole registry into every consumer of `MA_FIELDS`.
 *
 * A registry that lists nothing produces no rows rather than rendering blank
 * ones: `defSchema`'s line applies — a control that refuses to appear is a bug
 * report; a control that appears and writes nowhere is a support ticket with no
 * answer in it. Same for a declared input whose TYPE has no control
 * (`fieldFromInput` returns null): it renders nothing.
 */
export function listEngineIndicators(settings, registry) {
  const defs = (registry && typeof registry.listDefinitions === 'function')
    ? registry.listDefinitions()
    : []
  const rows = []
  for (const def of (Array.isArray(defs) ? defs : [])) {
    if (!def || typeof def.id !== 'string') continue
    const declared = fieldsFromDefinition(def)
    if (!declared.length) continue
    // ⛔ A CONTROL THE BLOB CANNOT CARRY IS GREYED, WITH THE REASON. `ichimoku`
    // declares three periods `CHART_DEFAULTS.indicators.ichimoku` has never had,
    // and it is UN-FLIPPED — its hand-written block calls `computeIchimoku(bars)`
    // with no arguments. Three live number boxes reading `undefined` and writing
    // keys nobody reads is the defect. The predicate short-circuits on FLIPPED,
    // so VWAP's four stay live; `indicatorCatalog.test.js` proves that
    // short-circuit is load-bearing by running one probe through it both ways.
    const unwired = unwiredKeys(def, ENGINE_OWNED)
    const fields = unwired.size
      ? declared.map((f) => (unwired.has(f.key) ? { ...f, disabled: NOT_IN_BLOB } : f))
      : declared
    const meta = def.meta || {}
    // "(intraday only)" is DERIVED: a definition that declares a timeframe list
    // excluding the daily bar is a session indicator, and saying so on the row
    // is what stops a daily chart looking broken when it is on. The next session
    // indicator gets the note without anyone editing this file.
    const sessionOnly = Array.isArray(meta.timeframes) && !meta.timeframes.includes('D')
    // ⛔ `[null]` IS THE NO-INSTANCE BRANCH, WRITTEN AS ONE LOOP RATHER THAN TWO
    // BRANCHES. Two branches is two row shapes to keep in step, and the row a
    // fresh chart shows — the "turn it on" control — is the one every earlier
    // regression in this function landed on (B5 Task 9's blank Period box).
    const live = liveInstancesFor(def.id, settings)
    // ⭐ RS split U1 — a `meta.requiresServer` definition the live server has
    // not listed gets no "turn it on" row: that row is an OFFER, and the server
    // cannot compute it yet. An instance already on the chart keeps its rows —
    // the gate hides offers, never what a member already placed.
    if (!live.length && !isDefinitionOffered(def)) continue
    // Read through the ONE reader every other control door uses, so a
    // tombstone cannot leave this toggle ticked over a chart with no line. It is
    // per DEFINITION and therefore shared by every row of one definition.
    // ⭐ A1 (D3): the row's switch reads VISIBILITY — a definition-hidden indicator reads
    // OFF, so unticking is never an identity no-op (stuck) and ticking shows it again.
    // `exists` keeps the old "a live instance exists" answer for LISTING: a hidden
    // indicator stays in the active list, with its own switch, so it can be found again.
    const exists = isIndicatorEnabled(settings, def.id, ENGINE_OWNED)
    const enabled = definitionVisibility(settings, def.id, ENGINE_OWNED).state === 'shown'
    for (const instance of (live.length ? live : [null])) {
      rows.push({
        id: instance ? instance.instanceId : def.id,
        defId: def.id,
        // Present ONLY on an instance row. `applyRowPatch` routes on exactly this
        // field, so an undefined here is the difference between "write THIS RSI"
        // and "write the definition's mirror + its seeded instance".
        ...(instance ? { instanceId: instance.instanceId } : {}),
        engineOwned: true,
        // ⭐⭐ A DEFINITION THAT NAMES ITSELF FROM ITS SOURCE NAMES ITS ROWS THAT
        // WAY TOO. `meta.name` is the CATALOGUE noun — right for "Relative
        // Strength Index", and wrong for the one definition whose whole identity
        // is what it was pointed at.
        //
        // ⚰️ MEASURED IN A BROWSER 2026-09-14, on the pane harness: a chart
        // holding two QQQ series and one SPY showed FOUR rows all reading "Data
        // Series", while the legend beside them correctly read `QQQ`. Fixing
        // `chipLabel` alone is exactly half the defect the readout header warns
        // about — there are two naming surfaces and they are not the same
        // function. `instanceLabel` is the authority the chip already uses, so
        // both say the same thing by reading the same declaration.
        //
        // ⛔ GATED ON `meta.labelFrom`, NEVER ON A DEFINITION ID. Every other row
        // keeps its catalogue noun, and a future definition that names itself
        // from an input inherits this with no edit here.
        //
        // ⭐⭐ AND ON `meta.nameFrom` TOO (2026-09-16), WHICH IS THE SAME CLAIM
        // WITH A DIFFERENT SOURCE. `labelFrom` says *"my name comes from what I
        // was POINTED AT"* (`QQQ`); `nameFrom` says *"my name comes from what the
        // member CHOSE"* (`EMA 9`). Either way the catalogue noun is the wrong
        // string for the row, and for the same reason: it names the definition
        // when the member is looking at an instance of it.
        //
        // ⚰️ MEASURED: the engine MA named itself `EMA 9` in the legend, in the
        // destination menu and in the pane map, and this list — the ONE surface a
        // member opens to find out which moving average is which — still read
        // `Moving Average`, twice, with `#1` and `#2` after it. That is exactly
        // the halfway state `listEngineIndicators`' own `labelFrom` gravestone
        // above records for `dataSeries`: two naming surfaces, one of them fixed.
        label: `${(instance && (meta.labelFrom || namesItselfSemantically(def)))
          ? instanceLabel(def, instance)
          : (meta.name || meta.shortName || def.id)}${sessionOnly ? ' (intraday only)' : ''}`,
        // The GROUP is the definition's short name, which is what the shipped tab
        // showed ("VWAP") — and it keeps the modal's section list derived from the
        // rows rather than hardcoded. Two instances share ONE section, which is
        // the same answer `orderedPaneKeys` gives them on the chart.
        group: meta.shortName || def.id,
        fields,
        // ⭐ THE ENGINE HALF OF THE SAME DECLARATION — see the overlay row's own
        // comment. Derived from the definition rather than typed per row, so an
        // MA instance and an MA overlay arrive at the Inspector wearing one mark.
        ...(def.id === MOVING_AVERAGE_DEF ? { memberConcept: 'movingAverage' } : {}),
        path: { kind: 'indicator', key: def.id },
        values: drawnValues(def, settings, instance),
        canToggle: true,
        enabled,
        exists,
      })
    }
  }

  // ── TWO COPIES OF ONE DEFINITION MUST NOT PRINT ONE NAME ────────────────
  //
  // ⭐⭐ THROUGH THE SAME AUTHORITY EVERY OTHER SURFACE USES. The legend chips and
  // the "Display in" menu already read `disambiguateLabels`, so two QQQ series
  // read `QQQ #1` and `QQQ #2` there. This list was the one place they both read
  // `QQQ` — which is exactly the row a member opens to find out which is which.
  //
  // ⛔ AND IT IS THE HELPER, NOT A COPY OF ITS RULE. A second suffix grammar here
  // would word the same duplicate differently from the legend beside it, which is
  // the drift this phase exists to avoid.
  const engineRows = rows.filter((r) => r && r.engineOwned && r.instanceId)
  if (engineRows.length > 1) {
    const byId = new Map()
    for (const inst of (Array.isArray(settings?.indicatorInstances) ? settings.indicatorInstances : [])) {
      if (inst && inst.instanceId) byId.set(inst.instanceId, inst)
    }
    const suffixed = disambiguateLabels(
      engineRows.map((r) => ({
        defId: r.defId,
        plotKey: '',
        instanceId: r.instanceId,
        label: r.label,
        inputs: (byId.get(r.instanceId) || {}).inputs || {},
      })),
      (id) => ((registry && typeof registry.getDefinition === 'function')
        ? registry.getDefinition(id) : null),
      // ⭐ THE INSTANCE LIST, so a row told apart from its sibling by its SOURCE
      // reads `EMA 20 · RSI (14)` rather than `EMA 20 (source @inst:rsi:1::rsi)`.
      // §4: an engine address must never reach a member's eyes.
      { instances: Array.isArray(settings?.indicatorInstances) ? settings.indicatorInstances : [] },
    )
    engineRows.forEach((r, n) => { r.label = suffixed[n] })
  }
  return rows
}

/** The indicators the tab lists, in display order.
 *  `path` tells the tab where the values live in the settings blob:
 *    { kind: 'overlay', index }    → settings.overlays[index]
 *    { kind: 'section', key }      → settings[key]
 *    { kind: 'indicator', key }    → settings.indicators[key]
 *
 *  ⛔ NOTHING THE ENGINE OWNS. See the rail in this file's header.
 *
 *  `opts.volumePaneFixed` — a reason string when the calling SURFACE fixes the
 *  volume layout itself (see VOLUME_PANE_SURFACE_FIXED). It marks the separate-pane
 *  toggle inert instead of letting it look live. VOLUME_FIELDS is a shared module
 *  constant, so the flag is applied to a COPY, never mutated in place.
 */
/**
 * The settings-row id for the moving average stored at `index`.
 *
 * ⭐⭐ IT IS A FUNCTION BECAUSE TWO SURFACES HAVE TO AGREE ON IT, and for a while
 * they did not. The LEGEND names the same row `ma:<index>` (`LegendRow`'s
 * `rowId`, its own vocabulary, and the address its hide/remove verbs parse); this
 * tab names it `overlay-<index>`. Those are allowed to differ — but the gear's
 * deep link has to CONVERT between them, and it was passing the legend's spelling
 * straight through.
 *
 * ⚰️ MEASURED 2026-09-10: clicking the gear on EMA 9 opened Chart Settings on the
 * Indicators tab with NOTHING expanded, because `openRowId` was `"ma:0"` and the
 * only rows on screen were `overlay-0`, `overlay-1`, `overlay-3`, `volume`,
 * `legacy:rsi`, `legacy:macd`. Volume and RSI worked by coincidence — both
 * surfaces happen to spell those two identically — which is exactly why the bug
 * survived a round of verification aimed at RSI.
 *
 * ⛔ SO THE STRING IS BUILT HERE, WHERE THE ROWS ARE BUILT, and the translation in
 * `ChartSettingsModal.indTargetRow` calls this rather than re-typing the prefix.
 * A rename now cannot land on one side only.
 */
export function overlayRowId(index) {
  return `overlay-${index}`
}

export function listIndicators(settings, opts = {}) {
  const overlays = Array.isArray(settings?.overlays) ? settings.overlays : []
  // ⛔ INDEX FIRST, FILTER SECOND — and that order is the contract, not a style.
  // `path.index` addresses the slot in the STORED array, so it has to be the real
  // index; filtering before mapping would renumber every row after a tombstone
  // and send the next colour edit to the wrong moving average. (This is the same
  // trap `indTarget`'s colon-parsing bug was, one file over.)
  const rows = overlays.map((ov, index) => ({
    id: overlayRowId(index),
    // Label reads as the chart legend does — "EMA 9", "SMA 200".
    label: `${ov?.type || 'SMA'} ${ov?.period ?? ''}`.trim(),
    group: 'Moving averages',
    fields: MA_FIELDS,
    // ⭐⭐ THE ONE MEMBER-FACING CONCEPT, DECLARED BY BOTH IMPLEMENTATIONS.
    //
    // A moving average reaches this list two ways: as a slot in the legacy
    // `cs.overlays` array (here) and as an engine INSTANCE of the `movingAverage`
    // definition. They are different storage, different writers and different
    // input schemas — and to a member they are the same object, which is the
    // locked product rule (MOVING AVERAGE = ONE USER-FACING CONCEPT).
    //
    // ⛔ SO THE INSPECTOR ASKS A DECLARATION, NOT AN ID. `row.memberConcept` is
    // set by BOTH producers and read by ONE consumer; without it the normalised
    // editor would have to test `path.kind === 'overlay' || defId ===
    // 'movingAverage'` inline, which is the definition-id hardcoding the panel's
    // own header forbids and which the next MA-shaped thing would silently miss.
    memberConcept: 'movingAverage',
    path: { kind: 'overlay', index },
    // Force `onTop` to a strict boolean so the "Overlap candles" toggle reads
    // right: its renderer treats `val !== false` as ON, so a stored overlay that
    // predates this key (onTop === undefined) would show ON yet a click would
    // write `false` — the toggle could never reach `true`. Default it to false.
    values: { ...(ov || {}), onTop: !!(ov && ov.onTop) },
    canToggle: true,
  })).filter((row) => !isOverlayRemoved(overlays[row.path.index]))
  // ⛔ A REMOVED VOLUME PANE GETS NO ROW EITHER, and `removed` is not `visible`:
  // a hidden pane is still the member's and still listed, a removed one has left
  // the chart and comes back from the catalogue. See `chartDefaults`.
  if (!isVolumeRemoved(settings)) rows.push({
    id: 'volume',
    label: 'Volume',
    group: 'Volume',
    fields: opts.volumePaneFixed
      ? VOLUME_FIELDS.map(f => (f.key === 'separatePane' ? { ...f, disabled: opts.volumePaneFixed } : f))
      : VOLUME_FIELDS,
    path: { kind: 'section', key: 'volume' },
    values: settings?.volume || {},
    canToggle: true,
    enabledKey: 'visible',   // volume uses `visible`, overlays use `enabled`
  })
  return rows
}

/**
 * The rows for the settings sections that have NO engine definition and are not
 * MA overlays or the volume pane. `volumeProfile` is the whole list: it draws to
 * a sibling 2D canvas, so there is nothing to instantiate and nothing to derive.
 *
 * ⛔ `engineOwned: false` IS LOAD-BEARING. `applyRowPatch` routes a row at
 * `instanceControls` when and only when it is engine-owned, and
 * `setIndicatorEnabled` returns the settings BY IDENTITY for a def the registry
 * does not know — so a `true` here would make the toggle silently do nothing.
 * The row writes its settings slice through `patchFor`, like the MA overlays.
 */
function listCarvedOutIndicators(settings) {
  return CARVED_OUT_ROWS.map((row) => ({
    id: row.id,
    engineOwned: false,
    label: row.name,
    group: row.shortName,
    fields: row.fields,
    path: { kind: 'indicator', key: row.id },
    values: (settings && settings.indicators && settings.indicators[row.id]) || {},
    canToggle: true,
    enabled: settings?.indicators?.[row.id]?.enabled === true,
  }))
}

/** Every row the Indicators tab renders: the hand-written ones whose identity
 *  cannot be derived (MA overlays, the volume pane), then ONE PER DEFINITION,
 *  then the carved-out sections. The modal derives its SECTION LIST from this,
 *  so adding a definition to `nativeRegistry` brings its own section with it and
 *  there is no group array to forget to edit.
 *
 *  ⚠️ `opts` IS FORWARDED TO `listIndicators` AND THAT IS LOAD-BEARING, not
 *  tidiness. B4 replaced the modal's `listIndicators(settings, opts)` call with
 *  this one; master's `volumePaneFixed` (`f3d9daba`) reaches the volume row
 *  through that argument, so dropping it here would leave the separate-pane
 *  toggle looking live on the two surfaces that fix the volume layout
 *  themselves — a control that does nothing and says nothing, which is the
 *  exact class `VOLUME_PANE_SURFACE_FIXED` exists to end. */
export function listAllIndicators(settings, registry, opts = {}) {
  // ⭐ 2026-09-28 — THE ADOPTED AVERAGES LIST WHERE THEIR OVERLAY ROWS DID. A default
  // average is the instance `ovl:<i>` now (`maAdoption.js`); its row is the direct
  // successor of the `overlay-<i>` row, so it keeps that row's place — first,
  // above Volume — rather than dropping below it with the other engine rows.
  const engine = listEngineIndicators(settings, registry)
  const adopted = engine.filter((r) => typeof r.instanceId === 'string' && /^ovl:\d+$/.test(r.instanceId))
  const rest = engine.filter((r) => !adopted.includes(r))
  return [
    ...adopted,
    ...listIndicators(settings, opts),
    ...rest,
    ...listCarvedOutIndicators(settings),
  ]
}

// ─── THE COLOUR-SWATCH TARGET: ONE ENCODER, ONE DECODER, ONE FILE ───────────
//
// 🔴 chart-UX-walls TASK 6 — THIS PAIR EXISTS BECAUSE ITS TWO HALVES USED TO LIVE
// IN DIFFERENT FILES AND DISAGREED. `ChartSettingsModal` built every indicator
// colour target as `` `ind:${row.id}:${f.key}` `` and read it back with
// `t.split(':')` destructured as `[, rowId, field]`. That worked for exactly as
// long as a row id could not contain a colon. Task 6 keys a generated row by its
// INSTANCE id — `legacy:<defId>` or `inst:<defId>:<n>` — so `ind:legacy:rsi:color`
// parsed as `rowId: 'legacy'`, `field: 'rsi'`, matched no row, and the swatch
// silently wrote NOTHING while looking perfectly live.
//
// ⛔ SO THE FORMAT AND ITS PARSER NOW SIT BESIDE THE THING THAT MINTS THE ID, and
// the modal imports both rather than owning half. A format written in one file
// and read in another is the contract-between-components defect this phase keeps
// finding; the cheapest permanent fix is to stop having two files.
//
// ⛔ AND THE FIX IS THE PARSE, NOT THE ID. Renaming instance ids to avoid a colon
// would move `legacyInstanceId`, `newInstanceId`, `USER_ID_PREFIX`, every stored
// blob and every tombstone — for the convenience of one string split. FIRST colon
// ends the `ind` marker; LAST colon begins the field, because a field key is a
// declared input key and `defSchema` validates those as identifiers; everything
// between the two is the row id, colons and all.

/** `('legacy:rsi', 'color')` → `'ind:legacy:rsi:color'`. */
export function indTarget(rowId, field) {
  return `ind:${rowId}:${field}`
}

/**
 * The colour-picker target for ONE HALF of a signed histogram's pair.
 *
 * ⭐⭐ A SEPARATE PREFIX BECAUSE IT IS A SEPARATE LANE. `ind:` targets are
 * definition INPUTS — `setColorTarget` writes them through `applyRowPatch` into
 * the row's values. A sign colour is PRESENTATION: it lives on
 * `instance.presentation` and is written by `setInstanceCandleColor`, which
 * DELETES the key when the member picks the chart's own colour. Routing both
 * through one prefix would put a presentation value in the inputs lane and lose
 * that provenance rule — which is the whole of how "follows the theme" works.
 *
 * ⛔ AND IT IS THE SAME PICKER. One colour panel, one set of swatches; only the
 * commit differs, which is the part that genuinely differs.
 *
 * @param {string} rowId    the instance id
 * @param {'upColor'|'downColor'} which
 */
export function signTarget(rowId, which) {
  return `indsg:${rowId}:${which}`
}

/** Is this a swatch target for a signed histogram's up/down pair? */
export function isSignTarget(target) {
  return typeof target === 'string' && target.startsWith('indsg:')
}

/** `'indsg:inst:dataSeries:1:upColor'` → `{rowId: 'inst:dataSeries:1', which: 'upColor'}`. */
export function splitSignTarget(target) {
  const rest = String(target).slice('indsg:'.length)
  const last = rest.lastIndexOf(':')
  return last < 0 ? { rowId: rest, which: '' }
    : { rowId: rest.slice(0, last), which: rest.slice(last + 1) }
}

/** `'ind:legacy:rsi:color'` → `{rowId: 'legacy:rsi', field: 'color'}`. */
export function splitIndTarget(target) {
  const rest = String(target).slice(String(target).indexOf(':') + 1)
  const last = rest.lastIndexOf(':')
  return last < 0
    ? { rowId: rest, field: '' }
    : { rowId: rest.slice(0, last), field: rest.slice(last + 1) }
}

/** Is this a swatch target for a generated indicator row? */
export function isIndTarget(target) {
  return typeof target === 'string' && target.startsWith('ind:')
}

/** Read/write helper so the tab never hardcodes a settings path. */
export function readEnabled(row) {
  if (typeof row?.enabled === 'boolean') return row.enabled
  const key = row.enabledKey || 'enabled'
  return row.values?.[key] !== false
}

export function patchFor(row, patch, settings) {
  if (row.path.kind === 'overlay') {
    const next = (settings.overlays || []).map((o, i) => (i === row.path.index ? { ...o, ...patch } : o))
    return { overlays: next }
  }
  // Two levels deep — the flat `indicators` map. Merged rather than replaced so a
  // patch of one field can't drop the other indicators or the rest of this one's keys.
  if (row.path.kind === 'indicator') {
    return {
      indicators: {
        ...(settings.indicators || {}),
        [row.path.key]: { ...(settings.indicators?.[row.path.key] || {}), ...patch },
      },
    }
  }
  return { [row.path.key]: { ...(settings[row.path.key] || {}), ...patch } }
}

/**
 * Apply a row's patch and return the NEXT WHOLE SETTINGS OBJECT.
 *
 * ⭐ THIS IS THE SUPERSEDING FILE'S HALF OF "ONE READER, ONE WRITER". A
 * hand-written row still writes its own slice of the blob through `patchFor`,
 * because nothing else owns MA overlays or the volume pane. An ENGINE-OWNED row
 * writes through `instanceControls`, the same writer the toolbar checkbox, the
 * two right-click doors and the four keyboard shortcuts already share:
 *
 *   · `enabled` → `setIndicatorEnabled`, which creates or TOMBSTONES the
 *     instance and mirrors the legacy flag. Writing the flag alone ticks a box
 *     over a chart that disagrees, and a tombstone puts the line straight back
 *     on the next paint;
 *   · anything else → `setInstanceInput` when the row names a USER-ADDED instance
 *     (chart-UX-walls Task 6), else `setIndicatorInput`. Both validate against
 *     the declared input and REFUSE a value the definition would reject rather
 *     than storing an instance `normalizeInstances` then drops. The defId form is
 *     still the right one for a row with NO instance (it writes the mirror WITHOUT
 *     switching the indicator on — "type a period beside an unchecked box") and
 *     for the FOLD's instance (the mirror is that instance's mirror; see the
 *     comment at the branch).
 *
 * A refused write returns `settings` unchanged, by identity — the caller can
 * skip persisting.
 */
export function applyRowPatch(row, patch, settings, registry) {
  if (!row || !patch || typeof patch !== 'object') return settings
  if (!row.engineOwned) return { ...settings, ...patchFor(row, patch, settings) }

  let next = settings
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'enabled') {
      // ⛔ THE ENABLED TOGGLE STAYS PER-DEFINITION EVEN ON AN INSTANCE ROW, and
      // that is the shipped MEANING of the control: "RSI: off" means no RSI, so
      // `setIndicatorEnabled` tombstones every live instance. `removeInstance` is
      // the per-instance verb and it belongs to the chip's Remove and to the
      // dialog's own delete affordance, not to a definition toggle — a switch
      // labelled with the definition's name that took away only one of two lines
      // would leave the box unticked over a chart that still draws.
      next = setIndicatorEnabled(next, row.defId, value === true, registry)
    } else if (row.instanceId && row.instanceId !== legacyInstanceId(row.defId)) {
      // A USER-ADDED instance (`inst:<defId>:<n>`): the per-instance door, which
      // deliberately does NOT touch the mirror. See below for why that is right
      // here and wrong for the fold's instance.
      next = setInstanceInput(next, row.instanceId, key, value, registry)
    } else {
      // ⭐ THE FOLD'S INSTANCE — `legacy:<defId>` — AND A ROW WITH NO INSTANCE AT
      // ALL BOTH TAKE THE defId DOOR, AND THAT IS A DEVIATION FROM THE BRIEF WITH
      // A MEASUREMENT BEHIND IT.
      //
      // The brief routed EVERY instance row at `setInstanceInput`. That door does
      // not write `cs.indicators.<defId>` — correctly, because the mirror is per
      // DEFINITION and cannot carry two instances' periods. But the mirror is not
      // arbitrary: `migrateLegacyToInstances` projects `cs.indicators[defId]` into
      // exactly ONE id, `legacyInstanceId(defId)`, and `setIndicatorInput` writes
      // exactly that id. So the mirror IS the fold instance's mirror — and routing
      // it away from `setIndicatorInput` would leave `cs.indicators.rsi.period`
      // stale beside a `legacy:rsi` that has moved, for every user on the planet,
      // since almost nobody has a second instance. That is the "mirror always
      // agrees with the instance" invariant `instanceControls.js`'s header names
      // as the ONE thing the mirror actually buys, and it was measured, not
      // predicted: the brief's form reddens seven assertions across
      // `ChartToolbar.flipB.test.jsx` and `ChartSettingsModal.indicators.test.jsx`
      // — all of them on `legacy:*` fixtures, none of them about two instances.
      //
      // ⛔ AND IT IS A ROUTING CHOICE BETWEEN TWO SHIPPED DOORS, NOT A SECOND COPY
      // OF THE MIRROR RULE. Nothing here writes `cs.indicators` by hand; the
      // control-door census's raw-write scan is what would catch it if it did.
      next = setIndicatorInput(next, row.defId, key, value, registry)
    }
  }
  return next
}

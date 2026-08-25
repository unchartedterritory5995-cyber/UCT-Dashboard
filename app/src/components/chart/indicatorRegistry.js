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
  isIndicatorEnabled, setIndicatorEnabled, setIndicatorInput, setInstanceInput,
} from './engine/instanceControls'
// ⚠️ THE ONE MINTER, IMPORTED — never the literal `legacy:`. `USER_ID_PREFIX` and
// `LEGACY_ID_PREFIX` live in `engine/instances.js` and a typed copy here would be
// the twin this phase retires, in the file whose header is about retiring them.
import { legacyInstanceId } from './engine/instances'
// ⚠️ IMPORTED, NEVER REDEFINED. The B4 plan sketched `unwiredKeys` and a second
// carved-out field table inside THIS file; both live in `indicatorCatalog.js`,
// because a predicate — or a field table — copied into two files is precisely
// the twin this whole phase is retiring.
import { CARVED_OUT_ROWS, unwiredKeys, NOT_IN_BLOB } from './indicatorCatalog'

export const MA_TYPES = [['SMA', 'Simple'], ['EMA', 'Exponential']]
export const LINE_STYLES = [['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted']]
export const LINE_WIDTHS = [[1, '1px'], [2, '2px'], [3, '3px'], [4, '4px']]
export const PLOT_STYLES = [['line', 'Line'], ['histogram', 'Histogram'], ['area', 'Area']]

const NOT_WIRED = 'Coming soon — needs renderer support'

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

/** Fields for one moving-average overlay. */
export const MA_FIELDS = [
  { key: 'type',      label: 'Average type', type: 'select', options: MA_TYPES },
  { key: 'color',     label: 'Color',        type: 'color' },
  // ON = the line draws in FRONT of the candles (overlaps); OFF = behind them.
  { key: 'onTop',     label: 'Overlap candles', type: 'toggle' },
  { key: 'period',    label: 'Period',       type: 'number', min: 1, max: 400, step: 1 },
  { key: 'offset',    label: 'Offset',       type: 'number', min: -100, max: 100, step: 1, disabled: NOT_WIRED },
  { key: 'plotStyle', label: 'Plot style',   type: 'select', options: PLOT_STYLES, disabled: NOT_WIRED },
  { key: 'lineStyle', label: 'Line style',   type: 'select', options: LINE_STYLES },
  { key: 'lineWidth', label: 'Line width',   type: 'select', options: LINE_WIDTHS },
]

/** Bar styles for the volume pane. 'columns' = the built-in full-slot histogram
 *  (bars touch, the long-standing look); 'histogram' = thin bars with a visible
 *  gap between each (TC2000-style, drawn by the ThinVolumeSeries custom series). */
export const VOLUME_BAR_STYLES = [['columns', 'Columns'], ['histogram', 'Histogram']]

/** Fields for the volume pane. */
export const VOLUME_FIELDS = [
  { key: 'barStyle',     label: 'Bar style',    type: 'select', options: VOLUME_BAR_STYLES },
  { key: 'upColor',      label: 'Up bars',      type: 'color' },
  { key: 'downColor',    label: 'Down bars',    type: 'color' },
  { key: 'separatePane', label: 'Separate pane', type: 'toggle' },
  { key: 'hvcEnabled',   label: 'Highlight 52W volume highs', type: 'toggle' },
  // Visibility only — the label's COLOR is not user-editable; it tracks the range
  // buttons above it (--chart-panel-text-low) so the two always match.
  { key: 'labelVisible', label: 'Show $ Vol / Avg label', type: 'toggle' },
  { key: 'maPeriod',     label: 'Volume MA period', type: 'number', min: 0, max: 200, step: 1 },
  { key: 'maColor',      label: 'Volume MA color',  type: 'color',  showIf: (v) => Number(v.maPeriod) > 0 },
  { key: 'maLineWidth',  label: 'Volume MA width',  type: 'select', options: LINE_WIDTHS, showIf: (v) => Number(v.maPeriod) > 0 },
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
 * type the tab has no control for (`string`, `source`) — those render nothing
 * rather than rendering wrong, and B4's generated dialog is where they land.
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
    case 'int':
    case 'float':
      return {
        ...base,
        type: 'number',
        min: input.min,
        max: input.max,
        step: input.step ?? (input.type === 'int' ? 1 : 0.1),
      }
    default:
      return null
  }
}

/** Every field a definition declares, in DECLARATION ORDER — which is the order
 *  the definition's author chose and the order `defSchema` validates in. */
export function fieldsFromDefinition(def) {
  const inputs = Array.isArray(def?.inputs) ? def.inputs : []
  return inputs.map(fieldFromInput).filter(Boolean)
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
 */
export function fieldsForInstance(def, instance) {
  const declared = Array.isArray(def?.inputs) ? def.inputs : []
  const byKey = new Map(declared.map((i) => [i && i.key, i]))
  const stored = (instance && instance.inputs && typeof instance.inputs === 'object') ? instance.inputs : {}

  const values = {}
  for (const d of declared) {
    if (!d || typeof d.key !== 'string') continue
    if (d.default !== undefined) values[d.key] = d.default
    if (Object.prototype.hasOwnProperty.call(stored, d.key)) values[d.key] = stored[d.key]
  }

  const all = fieldsFromDefinition(def).map((f) => {
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
  const inputs = (live && live.inputs && typeof live.inputs === 'object') ? live.inputs : null
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
    // Read through the ONE reader every other control door uses, so a
    // tombstone cannot leave this toggle ticked over a chart with no line. It is
    // per DEFINITION and therefore shared by every row of one definition.
    const enabled = isIndicatorEnabled(settings, def.id, ENGINE_OWNED)
    for (const instance of (live.length ? live : [null])) {
      rows.push({
        id: instance ? instance.instanceId : def.id,
        defId: def.id,
        // Present ONLY on an instance row. `applyRowPatch` routes on exactly this
        // field, so an undefined here is the difference between "write THIS RSI"
        // and "write the definition's mirror + its seeded instance".
        ...(instance ? { instanceId: instance.instanceId } : {}),
        engineOwned: true,
        label: `${meta.name || meta.shortName || def.id}${sessionOnly ? ' (intraday only)' : ''}`,
        // The GROUP is the definition's short name, which is what the shipped tab
        // showed ("VWAP") — and it keeps the modal's section list derived from the
        // rows rather than hardcoded. Two instances share ONE section, which is
        // the same answer `orderedPaneKeys` gives them on the chart.
        group: meta.shortName || def.id,
        fields,
        path: { kind: 'indicator', key: def.id },
        values: drawnValues(def, settings, instance),
        canToggle: true,
        enabled,
      })
    }
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
export function listIndicators(settings, opts = {}) {
  const overlays = Array.isArray(settings?.overlays) ? settings.overlays : []
  const rows = overlays.map((ov, index) => ({
    id: `overlay-${index}`,
    // Label reads as the chart legend does — "EMA 9", "SMA 200".
    label: `${ov?.type || 'SMA'} ${ov?.period ?? ''}`.trim(),
    group: 'Moving averages',
    fields: MA_FIELDS,
    path: { kind: 'overlay', index },
    // Force `onTop` to a strict boolean so the "Overlap candles" toggle reads
    // right: its renderer treats `val !== false` as ON, so a stored overlay that
    // predates this key (onTop === undefined) would show ON yet a click would
    // write `false` — the toggle could never reach `true`. Default it to false.
    values: { ...(ov || {}), onTop: !!(ov && ov.onTop) },
    canToggle: true,
  }))
  rows.push({
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
  return [
    ...listIndicators(settings, opts),
    ...listEngineIndicators(settings, registry),
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

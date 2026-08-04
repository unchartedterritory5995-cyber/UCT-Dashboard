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
// A definition id in `ENGINE_MIGRATED_DEF_IDS` may NOT appear in
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
import { ENGINE_FLIPPED_DEF_IDS } from './engine/flipState'
import { isIndicatorEnabled, setIndicatorEnabled, setIndicatorInput } from './engine/instanceControls'
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

/** Fields for one moving-average overlay. */
export const MA_FIELDS = [
  { key: 'type',      label: 'Average type', type: 'select', options: MA_TYPES },
  { key: 'color',     label: 'Color',        type: 'color' },
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

/** The live (non-tombstoned) instance of a definition, if the blob stores one. */
function liveInstanceFor(defId, settings) {
  const list = Array.isArray(settings?.indicatorInstances) ? settings.indicatorInstances : []
  return list.find((i) => {
    if (!i || typeof i !== 'object' || i.defId !== defId) return false
    try { return !isInstanceTombstone(i) } catch { return false }
  }) || null
}

/**
 * The values the row DISPLAYS: what the chart is actually drawing with.
 *
 * With no stored instance that is the legacy section, exactly as before — the
 * migrator projects it. With one, the instance's inputs win, falling back to the
 * definition's declared defaults for a key the instance omits ("unset means
 * current default", the same rule the migrator and the binder use). Showing the
 * mirror while the instance draws something else is the "two numbers for one
 * line" defect `flipState.engineDrawnInputs` exists to prevent on the toolbar.
 */
function drawnValues(def, settings) {
  const section = (settings && settings.indicators && settings.indicators[def.id]) || {}
  const live = liveInstanceFor(def.id, settings)
  if (!live) return section
  const inputs = (live.inputs && typeof live.inputs === 'object') ? live.inputs : {}
  const out = { ...section }
  for (const declared of (Array.isArray(def.inputs) ? def.inputs : [])) {
    if (!declared || typeof declared.key !== 'string') continue
    const k = declared.key
    if (Object.prototype.hasOwnProperty.call(inputs, k)) out[k] = inputs[k]
    else if (declared.default !== undefined) out[k] = declared.default
  }
  return out
}

/**
 * The engine-owned rows — GENERATED, never hand-written, ONE PER DEFINITION.
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
    const unwired = unwiredKeys(def, ENGINE_FLIPPED_DEF_IDS)
    const fields = unwired.size
      ? declared.map((f) => (unwired.has(f.key) ? { ...f, disabled: NOT_IN_BLOB } : f))
      : declared
    const meta = def.meta || {}
    // "(intraday only)" is DERIVED: a definition that declares a timeframe list
    // excluding the daily bar is a session indicator, and saying so on the row
    // is what stops a daily chart looking broken when it is on. The next session
    // indicator gets the note without anyone editing this file.
    const sessionOnly = Array.isArray(meta.timeframes) && !meta.timeframes.includes('D')
    rows.push({
      id: def.id,
      defId: def.id,
      engineOwned: true,
      label: `${meta.name || meta.shortName || def.id}${sessionOnly ? ' (intraday only)' : ''}`,
      // The GROUP is the definition's short name, which is what the shipped tab
      // showed ("VWAP") — and it keeps the modal's section list derived from the
      // rows rather than hardcoded.
      group: meta.shortName || def.id,
      fields,
      path: { kind: 'indicator', key: def.id },
      values: drawnValues(def, settings),
      canToggle: true,
      // Read through the ONE reader every other control door uses, so a
      // tombstone cannot leave this toggle ticked over a chart with no line.
      enabled: isIndicatorEnabled(settings, def.id, ENGINE_FLIPPED_DEF_IDS),
    })
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
 */
export function listIndicators(settings) {
  const overlays = Array.isArray(settings?.overlays) ? settings.overlays : []
  const rows = overlays.map((ov, index) => ({
    id: `overlay-${index}`,
    // Label reads as the chart legend does — "EMA 9", "SMA 200".
    label: `${ov?.type || 'SMA'} ${ov?.period ?? ''}`.trim(),
    group: 'Moving averages',
    fields: MA_FIELDS,
    path: { kind: 'overlay', index },
    values: ov || {},
    canToggle: true,
  }))
  rows.push({
    id: 'volume',
    label: 'Volume',
    group: 'Volume',
    fields: VOLUME_FIELDS,
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
 *  there is no group array to forget to edit. */
export function listAllIndicators(settings, registry) {
  return [
    ...listIndicators(settings),
    ...listEngineIndicators(settings, registry),
    ...listCarvedOutIndicators(settings),
  ]
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
 *   · anything else → `setIndicatorInput`, which validates against the declared
 *     input and REFUSES a value the definition would reject rather than storing
 *     an instance `normalizeInstances` then drops.
 *
 * A refused write returns `settings` unchanged, by identity — the caller can
 * skip persisting.
 */
export function applyRowPatch(row, patch, settings, registry) {
  if (!row || !patch || typeof patch !== 'object') return settings
  if (!row.engineOwned) return { ...settings, ...patchFor(row, patch, settings) }

  let next = settings
  for (const [key, value] of Object.entries(patch)) {
    next = key === 'enabled'
      ? setIndicatorEnabled(next, row.defId, value === true, registry)
      : setIndicatorInput(next, row.defId, key, value, registry)
  }
  return next
}

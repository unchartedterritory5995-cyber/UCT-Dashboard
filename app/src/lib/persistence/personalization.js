// TERM-052 (FB-S6-01) — the personalization publications, DERIVED from the code that governs
// them. FB-S6-01 names three: publish the density ceilings, name the objects that do not
// autosave, publish the cross-device rule. The third already ships (TERM-076: `deviceSync.js`
// renders it from the census manifest). This module owns the other two.
//
// ⛔ NO NUMBER AND NO AUTOSAVE ANSWER IN THIS FILE IS TYPED.
//   * Every ceiling's `value` is the IMPORTED constant the enforcing code applies. A rail
//     (`personalization.test.js`) parses this file and fails if a `value` is anything but an
//     identifier imported from the ceiling's own `source.file`, re-reads that constant from its
//     source by AST, and fails if the named consumer stops using it.
//   * Which layouts save themselves is the answer `layoutAutoSaves` — the predicate
//     `ChartsWorkspace.jsx` gates its auto-save on — gives for each kind of layout. Change the
//     rule there and the published list moves with no edit here.
// What IS typed, and is the human half (like the census manifest's `label`): the member-facing
// wording of each row, and which kinds of layout exist.
import { GRID_MAX_CELLS } from '../../pages/charts/grid/gridLayouts'
import { MAX_COMPARISONS, MAX_CHART_TEMPLATES } from '../../components/chart/chartCeilings'
import { layoutAutoSaves, UCT_DEFAULT_ID } from '../../pages/charts/layoutDockPins'

/** The limits a member can run into, each pointing at the code that enforces it. `source.file`
 *  declares the constant; `consumer` is the file that applies it to the member. */
export const CEILINGS = [
  {
    id: 'multichart-grid',
    surface: 'Charts',
    label: 'Charts in one multi-chart grid',
    value: GRID_MAX_CELLS,
    source: { file: 'app/src/pages/charts/grid/gridLayouts.js', name: 'GRID_MAX_CELLS' },
    consumer: 'app/src/pages/charts/grid/MultiChartMenu.jsx',
  },
  {
    id: 'chart-comparisons',
    surface: 'Charts',
    label: 'Comparison symbols on one chart',
    value: MAX_COMPARISONS,
    source: { file: 'app/src/components/chart/chartCeilings.js', name: 'MAX_COMPARISONS' },
    consumer: 'app/src/components/chart/ComparisonPicker.jsx',
  },
  {
    id: 'chart-templates',
    surface: 'Charts',
    label: 'Saved chart-settings templates (saving past this drops the one saved longest ago)',
    value: MAX_CHART_TEMPLATES,
    source: { file: 'app/src/components/chart/chartCeilings.js', name: 'MAX_CHART_TEMPLATES' },
    consumer: 'app/src/components/chart/ChartSettingsModal.jsx',
  },
]

/** A ceiling is published only as a positive whole number. Anything else — an import that
 *  resolved to nothing, a constant renamed out from under this file — reads `unreadable`, never
 *  a default: a made-up number here would be a cap a member plans around. */
export function ceilingDisplay(value) {
  return Number.isInteger(value) && value > 0 ? String(value) : 'unreadable'
}

export function densityCeilings(list = CEILINGS) {
  return list.map((c) => ({ id: c.id, surface: c.surface, label: c.label, display: ceilingDisplay(c.value) }))
}

/** Every kind of layout the Layout Dock can have open, as the `charts_active_template` value
 *  `ChartsWorkspace.jsx` writes when one is opened (`{ id, name, scope }`). The `probe` is what
 *  `layoutAutoSaves` is asked about; the answer is not recorded here. */
export const LAYOUT_KINDS = [
  { id: 'own', label: 'Layouts you created or duplicated', probe: { id: 'your-layout', scope: 'user' } },
  { id: 'prebuilt', label: 'Prebuilt layouts shared with every member', probe: { id: 'prebuilt-layout', scope: 'global' } },
  { id: 'uct-default', label: 'The UCT Default layout', probe: { id: UCT_DEFAULT_ID, scope: 'global' } },
]

/** Splits the layout kinds by what `autoSaves` (the workspace's own rule, by default) answers
 *  for each. A kind whose answer is not a boolean lands in `unreadable` — it is never guessed
 *  into either list. */
export function layoutAutosaveMatrix(autoSaves = layoutAutoSaves, kinds = LAYOUT_KINDS) {
  const out = { autosaves: [], manual: [], unreadable: [] }
  for (const k of kinds) {
    let answer
    try { answer = autoSaves(k.probe) } catch { answer = undefined }
    const row = { id: k.id, label: k.label }
    if (answer === true) out.autosaves.push(row)
    else if (answer === false) out.manual.push(row)
    else out.unreadable.push(row)
  }
  return out
}

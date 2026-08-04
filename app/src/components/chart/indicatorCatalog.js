// app/src/components/chart/indicatorCatalog.js
//
// ─── THE ONE LIST ───────────────────────────────────────────────────────────
//
// Every surface that used to hand-write indicator NAMES reads this instead:
// the right-click menus, the region titles, the volume-overlay strips, the
// keyboard chords, the share link, the settings rows, the library dialog, the
// alert dropdown and the voice bus. `indicatorRegistry.js` is the CONTROLS half
// of the same idea (`fieldsFromDefinition`); this is the IDENTITY half.
//
// ⚠️ IT IS NOT `listDefinitions()` WITH A WRAPPER. It is definitions ∪
// CARVED_OUT_INDICATOR_KEYS. `volumeProfile` is a settings section with no
// definition (spec §11, B3 A4: it draws to a sibling 2D canvas, not through
// `addSeries`) and it has a shipped toolbar row. A generated list built from
// definitions alone silently DROPS that row — the user-facing regression B3
// Task 11 refused when it was asked to delete VWAP's row.
//
// ⚠️ LABELS. SIX shipped lists labelled the same indicator six ways. B4's
// convention: menus, region titles, compact strips and the keyboard help sheet
// take `shortName`; the library dialog and the generated settings rows take
// `name`. Every cell that visibly changes is pinned — against the PARSED shipped
// source, not a hand-copy — in `indicatorCatalog.test.js`.
//
// ⛔ NO INDICATOR ID IS WRITTEN DOWN HERE except `volumeProfile`, which has no
// definition to derive one from. `enumerationSites.test.js`'s discovery scan
// flags any shipped module naming four or more; this file must never reach that
// threshold, because the moment it does it has become a sixteenth hand-written
// list wearing the name of the thing that was meant to end them.

import * as defaultRegistry from './engine/nativeRegistry'
import { CHART_DEFAULTS } from './chartDefaults'

/** A settings section with no engine definition. Hand-written BY NAME, so a
 *  sixteenth one has to be argued for here rather than joining a silent
 *  exemption — the same rule `CARVED_OUT_INDICATOR_KEYS` is written under.
 *
 *  ⛔ `engineOwned: false` IS THE LOAD-BEARING FIELD, not decoration.
 *  `indicatorRegistry.applyRowPatch` routes a row at `engine/instanceControls`
 *  when and only when it is engine-owned; there is nothing to instantiate for a
 *  canvas overlay, so a `true` here would write an instance the binder drops and
 *  the profile would simply stop drawing. `carvedOut` and `engineOwned` are
 *  exact opposites today and a test asserts it.
 *
 *  `fields` is hand-written for the same reason the row is: there is no
 *  definition to run `fieldsFromDefinition` over. It is the ONE field table left
 *  in the platform, it sits next to the exemption it belongs to, and its keys are
 *  asserted to exist in `CHART_DEFAULTS.indicators.volumeProfile`. */
export const CARVED_OUT_ROWS = Object.freeze([
  Object.freeze({
    id: 'volumeProfile',
    name: 'Volume Profile',
    shortName: 'Vol Profile',
    category: 'Volume',
    target: 'canvas',
    carvedOut: true,
    engineOwned: false,
    description: 'Traded volume binned by price over the visible range, with the point of control marked.',
    tags: Object.freeze(['volume', 'profile']),
    fields: Object.freeze([
      Object.freeze({ key: 'bins', label: 'Bins', type: 'number', min: 8, max: 50, step: 1 }),
      Object.freeze({ key: 'color', label: 'Color', type: 'color' }),
      Object.freeze({ key: 'pocColor', label: 'Point of control', type: 'color' }),
    ]),
  }),
])

function defs(registry) {
  const r = registry || defaultRegistry
  return typeof r.listDefinitions === 'function' ? r.listDefinitions() : []
}

function rowFor(def) {
  const meta = def.meta || {}
  return {
    id: def.id,
    name: meta.name || def.id,
    shortName: meta.shortName || def.id,
    category: meta.category || 'Other',
    target: (def.placement && def.placement.target) || 'pane',
    carvedOut: false,
    engineOwned: true,
    description: meta.description || '',
    tags: Array.isArray(meta.tags) ? meta.tags : [],
  }
}

/** Every indicator the settings blob has a section for, in registry order, with
 *  the carved-out ones appended. */
export function catalogRows(registry) {
  return [...defs(registry).map(rowFor), ...CARVED_OUT_ROWS]
}

function find(id, registry) {
  return catalogRows(registry).find(r => r.id === id) || null
}

/** Menus, region titles, compact strips, the keyboard help sheet. */
export function labelFor(id, registry) {
  const row = find(id, registry)
  return row ? row.shortName : id
}

/** The library dialog and the generated settings rows. */
export function longLabelFor(id, registry) {
  const row = find(id, registry)
  return row ? row.name : id
}

/** The sub-pane oscillators — the ones that can be overlaid on the volume pane.
 *  DERIVED from `placement.target`, which is what `resolvePlacement` reads, so
 *  the menu and the renderer can never disagree about what "an oscillator" is. */
export function oscillatorIds(registry) {
  return defs(registry).filter(d => d.placement && d.placement.target === 'pane').map(d => d.id)
}

/** The overlays that share the candles' pane and scale. Registry order IS legacy
 *  render order and LWC z-stacks by insertion — see `flipState.js`. */
export function priceOverlayIds(registry) {
  return defs(registry).filter(d => d.placement && d.placement.target === 'price').map(d => d.id)
}

// ─── WHICH DECLARED CONTROLS THE LEGACY BLOB CAN ACTUALLY CARRY ─────────────

/** The reason string a greyed control shows. Exported so the surfaces that
 *  render it and the tests that assert it read one string. */
export const NOT_IN_BLOB =
  'Not wired yet — this indicator still draws from the legacy settings, which has no key for it'

/**
 * The declared inputs of `def` that `CHART_DEFAULTS.indicators[def.id]` has no
 * key for — i.e. the controls a generated row would render LIVE while writing
 * somewhere nothing reads.
 *
 * ⭐ MEASURED, AND IT IS NOT HYPOTHETICAL. `ichimoku` declares `tenkanPeriod`,
 * `kijunPeriod` and `senkouBPeriod`; its settings section has `enabled` and five
 * colours and has never carried a period. It is UN-FLIPPED, so its hand-written
 * block is what draws it, and that block calls `computeIchimoku(bars)` with no
 * arguments. Three number boxes reading `undefined` and writing keys nobody
 * reads is the defect; greyed with a reason is honest.
 *
 * ⛔ THE FLIPPED SHORT-CIRCUIT IS THE OTHER HALF. Once a definition is flipped
 * there is no hand-written block left — the INSTANCE is the authority and it
 * carries whatever the definition declares, blob key or not. Greying a flipped
 * definition's control would be the over-wide direction of the same mistake, and
 * `indicatorCatalog.test.js` proves the short-circuit is load-bearing by running
 * one probe through it both ways.
 *
 * ⚠️ ONE IMPLEMENTATION, ON PURPOSE. The B4 plan sketches this predicate inside
 * `indicatorRegistry.js` (Task 6). It lives HERE instead, and Task 6 imports it,
 * because a predicate copied into two files is precisely the twin this whole
 * phase is retiring.
 *
 * @param {object} def        a registry definition (or anything with `id` + `inputs`)
 * @param {{has: (id: string) => boolean}} flippedIds
 * @returns {Set<string>} declaration-ordered; empty for a flipped definition
 */
export function unwiredKeys(def, flippedIds) {
  if (!def || typeof def.id !== 'string') return new Set()
  if (flippedIds && typeof flippedIds.has === 'function' && flippedIds.has(def.id)) return new Set()
  const section = CHART_DEFAULTS.indicators[def.id] || {}
  return new Set(
    (Array.isArray(def.inputs) ? def.inputs : [])
      .filter(i => i && typeof i.key === 'string')
      .map(i => i.key)
      .filter(k => !(k in section)),
  )
}

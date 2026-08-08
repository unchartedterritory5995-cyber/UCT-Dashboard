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
//
// ⛔⛔ AND `catalogRows()` IS STILL THE SHIPPED CATALOGUE — `userCatalogRows()`
// IS A SECOND FUNCTION ON PURPOSE. A user's formula is addressable, drawable and
// (as of this change) BROWSABLE, and it is still not something this build ships.
// Three rails read `listDefinitions()` to prove what ships — `idsByLane(...)`
// equals `SHIPPED_DEF_IDS`, `.length` equals `REGISTRY_SIZES.total`, and
// `REGISTRY_SIZES.ast` is 0 — and `indicatorCatalog.test.js` compares
// `catalogRows()` against `listDefinitions()` id-for-id. Folding session state
// into that function would turn every one of those into a statement about WHO IS
// SIGNED IN, and they would all still read green in a suite that installs
// nothing: the vacuous-gate shape `registrySizes.js` imports nothing to avoid.
// So the union is made at the ONE surface that means to offer a member their own
// formulas (`IndicatorLibraryDialog`), and the share link, the voice bus, the
// right-click submenu and the on-count keep reading the shipped list they have
// always read — none of them can resolve another member's `u_…` id anyway.

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
    // Shipped chrome, not a member's formula. Declared rather than left absent
    // so `userDefined` is a field every row answers, on both branches.
    userDefined: false,
    description: 'Traded volume binned by price over the visible range, with the point of control marked.',
    tags: Object.freeze(['volume', 'profile']),
    // ⛔ DECLARED, NOT INVENTED. The library dialog renders a repaint badge from
    // this field and NOTHING else — a badge is a factual claim about the
    // indicator, and self-disclosed prose is how a product ends up telling users
    // a repainting indicator does not repaint. This section has no definition to
    // declare it, so it declares `null` and the row shows no badge, which is the
    // honest answer for a canvas overlay that rebins on every range change.
    repaint: null,
    tier: 'free',
    sessionOnly: false,
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

/** The heading a member's own formulas are grouped under in the library.
 *
 *  ⚠️ It is a CATEGORY, so it rides the dialog's existing derived-groups
 *  machinery (`[...new Set(rows.map(r => r.category))]`) and needs no second
 *  grouping path — but it is assigned by `rowFor` rather than read from the
 *  stored document, for the reason stated there. */
export const USER_CATEGORY = 'My formulas'

function rowFor(def, userDefined = false) {
  const meta = def.meta || {}
  return {
    id: def.id,
    name: meta.name || def.id,
    shortName: meta.shortName || def.id,
    // ⛔ A MEMBER'S FORMULA IS FILED BY PROVENANCE, NOT BY ITS OWN `meta.category`.
    // `BuilderSheet.buildDefinition` writes `'Custom'` today, but the category
    // comes off a STORED document, so a row installed from an older or
    // hand-edited one could land in `Volume` or `Momentum` and sit unmarked
    // between two shipped indicators. The section heading IS the distinction
    // this surface owes the user, so it is not left to a field the author's
    // document controls.
    category: userDefined ? USER_CATEGORY : (meta.category || 'Other'),
    target: (def.placement && def.placement.target) || 'pane',
    carvedOut: false,
    engineOwned: true,
    userDefined,
    description: meta.description || '',
    tags: Array.isArray(meta.tags) ? meta.tags : [],
    // ── the three facts the library dialog badges, all DECLARED ──────────────
    // `repaint` and `tier` come straight off the definition; a definition that
    // declares neither gets no badge rather than a default one, because "free"
    // and "non-repainting" are claims and a missing declaration is not a claim.
    repaint: meta.repaint || null,
    tier: meta.tier || null,
    // …and "intraday only" is DERIVED from the timeframe list the definition
    // publishes, the same derivation the generated settings row's label uses. A
    // definition with no timeframe list runs on every timeframe.
    sessionOnly: Array.isArray(meta.timeframes) && !meta.timeframes.includes('D'),
  }
}

/** Every indicator the settings blob has a section for, in registry order, with
 *  the carved-out ones appended.
 *
 *  ⛔ SHIPPED ONLY. See the header — this is the function three registry rails
 *  and fifteen call sites read, and a member's formula must never be able to
 *  make the shipped manifest true by joining it. `userCatalogRows` is the other
 *  half. */
export function catalogRows(registry) {
  return [...defs(registry).map(d => rowFor(d, false)), ...CARVED_OUT_ROWS]
}

/**
 * 🔴 THE MEMBER'S OWN FORMULAS, AS LIBRARY ROWS — the read that did not exist.
 *
 * Phase D shipped every part of this but the last one: a member could author a
 * formula (Task 11), it saved (Task 10), it INSTALLED into the registry and
 * DREW (Task 16), and `getDefinition` resolved it everywhere — and the indicator
 * library read `listDefinitions()`, which is deliberately shipped-only, so the
 * formula appeared on no screen a member would look at. They had to already know
 * it existed.
 *
 * ⛔ IT READS `listUserDefinitions()`, NOT `listAllDefinitions()`. The union is
 * made by the caller, because the caller is what decides ORDER and what needs
 * the two halves separable; taking the pre-unioned list would leave this function
 * re-deriving which rows are the member's by set difference, which is a second
 * way to answer a question the registry already answers by index.
 *
 * ⚠️ SESSION STATE. `_userById` is populated by `installUserDefinitions`, which
 * `useInstalledUserDefinitions` calls during `StockChart`'s render once SWR
 * answers — i.e. AFTER first paint. Any memo over this must therefore depend on
 * `catalogGeneration()`; a memo keyed on the registry module alone never
 * recomputes, because the module namespace is the same object forever. That is
 * the exact shape of the bug this whole task is about, one memo over.
 *
 * @param {object} [registry]
 * @returns {object[]} `[]` when nothing is installed — so the section simply
 *   does not exist for a member who has authored nothing.
 */
export function userCatalogRows(registry) {
  const r = registry || defaultRegistry
  const list = typeof r.listUserDefinitions === 'function' ? r.listUserDefinitions() : []
  return list.map(d => rowFor(d, true))
}

/** The heading a member's REFUSED formulas are grouped under.
 *
 *  ⛔ A SEPARATE HEADING FROM `USER_CATEGORY`, NOT A BADGE INSIDE IT. A refused
 *  formula is not a row that can be ticked — there is no installed definition to
 *  instantiate, so `setIndicatorEnabled` would return the settings BY IDENTITY
 *  and the control would be a live-looking toggle that writes nowhere: the exact
 *  defect `volumeProfile`'s "+ Add another" exemption exists to avoid, one
 *  surface over. Its own section keeps it out of `role="option"` entirely. */
export const REFUSED_CATEGORY = 'My formulas — not available'

/** The id `nativeRegistry.registerDefinitions` writes when a document carries
 *  none of its own (`raw && raw.id ? raw.id : '<unknown>'`). Named here so the
 *  unattributable bucket below is the door's own literal rather than a second
 *  one that happens to look like it. */
export const UNATTRIBUTED_DEF_ID = '<unknown>'

/**
 * 🔴 THE FORMULAS THE GATES REFUSED, PAIRED WITH THE DOOR'S OWN SENTENCE.
 *
 * `userCatalogRows` above answers "what can this member draw"; a definition the
 * gates refuse is absent from `listUserDefinitions()` and therefore absent from
 * that list — CORRECT, and completely silent. The author saved a formula, the
 * store ACCEPTED it, and it then appeared on no screen with nothing anywhere
 * saying why. `installUserDefinitions` has returned the reason in `errors` since
 * Phase D Task 16 and had **zero production consumers**: `StockChart` declines
 * to render it (a toast on a render path would fire on every chart) and nothing
 * else read it. This function is what makes that array reach a person.
 *
 * ⛔ THE MESSAGE IS THE DOOR'S, VERBATIM, WHOLE. Every gate on this path already
 * writes a precise, disjoint sentence — the repaint gate names the mode it
 * MEASURED, the budget gate names the guard that fired and the caps it measured
 * against, the closed-table resolver names the symbol, the shipped-id clash
 * names what would have been shadowed. Not one of them is re-worded here and no
 * second vocabulary is invented: this repo has already measured what two
 * vocabularies cost (`williams_r` vs `williamsR`), and `afbf0470` established
 * the pattern of rendering a gate's own sentence verbatim, gated on the right
 * states. The strings pass through untouched.
 *
 * ⚠️ THE `<id>: ` PREFIX IS PARSED FOR ATTRIBUTION ONLY, NEVER FOR DISPLAY. Both
 * doors write it — `registerDefinitions` maps `e => \`${id}: ${e}\`` and
 * `validateUserDefinitions` maps `e => \`${def.id}: ${e}\`` — so grouping on the
 * FIRST `': '` is reading the format they publish, not paraphrasing it. A
 * message that carries no prefix is NOT dropped: it lands under
 * `UNATTRIBUTED_DEF_ID` and still renders, because a refusal nobody could
 * attribute is still a refusal the member has to be told about. Silently
 * discarding it would rebuild the bug at one remove.
 *
 * @param {object[]} docs   the STORED documents (`rows.map(r => r.definition)`)
 *   — used ONLY to put the name the member typed on the row. A refusal whose
 *   document is missing is still reported, under its id.
 * @param {string[]} errors verbatim from `installUserDefinitions`.
 * @returns {object[]} `[{id, name, shortName, category, tags, userDefined,
 *   refused, messages}]` — in first-appearance order, `[]` when nothing was
 *   refused, so a member whose formulas all install sees no new section at all.
 *   The shape carries `matches()`'s five fields so the search box filters these
 *   rows through the SAME predicate as every other row rather than a second one.
 */
export function userRefusalRows(docs, errors) {
  const list = (Array.isArray(errors) ? errors : []).filter(
    (e) => typeof e === 'string' && e.trim() !== '',
  )
  if (!list.length) return []

  const labelById = new Map()
  for (const doc of (Array.isArray(docs) ? docs : [])) {
    if (!doc || typeof doc !== 'object' || typeof doc.id !== 'string' || !doc.id) continue
    const meta = doc.meta || {}
    labelById.set(doc.id, {
      name: meta.name || doc.id,
      shortName: meta.shortName || doc.id,
    })
  }

  const order = []
  const byId = new Map()
  for (const message of list) {
    const at = message.indexOf(': ')
    const id = at > 0 ? message.slice(0, at) : UNATTRIBUTED_DEF_ID
    if (!byId.has(id)) { byId.set(id, []); order.push(id) }
    byId.get(id).push(message)
  }

  return order.map((id) => {
    const label = labelById.get(id) || {}
    return {
      id,
      name: label.name || id,
      shortName: label.shortName || id,
      category: REFUSED_CATEGORY,
      tags: [],
      userDefined: true,
      refused: true,
      messages: byId.get(id),
    }
  })
}

/** The registry's install generation — the ONE value a memo over
 *  `userCatalogRows` has to depend on. Exported from here rather than imported
 *  from `nativeRegistry` by each surface so a caller that was handed a custom
 *  `registry` asks THAT registry, the same way every other function in this
 *  file does. `0` for a registry that does not publish one: a stable number is
 *  the correct answer for a registry whose contents cannot change. */
export function catalogGeneration(registry) {
  const r = registry || defaultRegistry
  return typeof r.registryGeneration === 'function' ? r.registryGeneration() : 0
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

// app/src/components/chart/chartDataMap.js
//
// ─── THE PANE MAP, DERIVED — NEVER RE-DECIDED ───────────────────────────────
//
// Chart Data's left column draws the chart's pane STRUCTURE. This is the one
// function that produces it, and it is deliberately a thin READ over the
// helpers the renderer itself consumes:
//
//     resolveDisplayTarget  →  where an instance draws ('price' | 'volume' | '@host')
//     paneOwnerOf           →  the HOST INSTANCE whose pane it draws in
//     paneOwnKeys           →  the instances whose ACTIVE placement earns a pane
//     paneOwnersNeeded      →  hosts kept alive because a visible guest draws there
//     paneHostLabels        →  what that pane is CALLED, everywhere else too
//
// The first four are the same four answers `StockChart` passes straight into
// `computePaneLayout` as `includeKeys` / `keepKeys`. Asking them here is what
// makes the map TRUE; deriving a grouping from a row's label, its def id or its
// rendered summary string would be a plausible-looking guess that drifts the
// first time any of them changes — and drifts SILENTLY, because a map that
// merely looks sensible is one nobody re-checks.
//
// ⛔⛔ WHICH IS ALSO WHY A HIDDEN HOST WITH NO VISIBLE GUEST GETS NO GROUP.
// `paneOwnKeys` skips a hidden instance; `paneOwnersNeeded` resurrects one only
// when something visible is drawing inside it. Their union therefore IS the set
// of panes the layout will actually allocate. Drawing a group for a host outside
// that union would claim a rectangle the renderer never creates — the settings
// panel lying about the chart, which is the single failure this redesign exists
// to remove.
//
// ⚠️ THE ORDER IS THE ROW LIST'S, which is `listAllIndicators` order, which is
// stored-instance order — the same order `orderedPaneKeys` walks. The map and
// the stack therefore agree WITHOUT this file knowing anything about geometry,
// heights or pane indices, and nothing here has to be updated when they change.

import {
  resolveDisplayTarget, paneOwnerOf, paneOwnKeys, paneOwnersNeeded, paneHostLabels,
} from './engine/displayTarget'
import { describeSourceValue } from './engine/readout'
import { isInstanceTombstone } from './instanceShape'

import { resolvePaneOrder, PRICE_PANE, VOLUME_PANE } from './engine/paneOrder'
import { volumeOwnsPane } from './engine/volumePresentation'

/** The group ids that no instance hosts. */
export const PRICE_GROUP = 'price'
export const VOLUME_GROUP = 'volume'
export const ORPHAN_GROUP = 'orphans'
export const HIDDEN_GROUP = 'hidden'

/**
 * @typedef {object} MapGroup
 * @property {string}   id     'price' | 'volume' | 'orphans' | <host instanceId>
 * @property {string}   kind   'price' | 'volume' | 'pane' | 'orphans'
 * @property {string}   name   what the member reads — "Price", "RSI (14)"
 * @property {object[]} rows   the rows drawing in this group, in list order
 * @property {object}   [host] the hosting ROW, for a 'pane' group
 */

/**
 * Group the tab's rows by the pane each one actually draws in.
 *
 * ⚠️ IT READS `settings.indicatorInstances`, WHICH IS THE SAME LIST THE ROWS
 * CAME FROM. `listEngineIndicators` builds its rows from `liveInstancesFor`,
 * which reads exactly this array — so the map can never group a row the list
 * does not show, or miss one it does. (`StockChart` hands the BINDER a projected
 * list that also carries legacy toggles; reading that one here would put panes on
 * this map for rows that have no row, which is the mirror-image lie.)
 *
 * @param {object[]} rows      rows from `listAllIndicators`
 * @param {object}   settings  the chart settings blob
 * @param {Function} [defOf]   definition lookup, for the pane names
 * @returns {MapGroup[]}
 */
export function paneMap(rows, settings, defOf, volumeOpts) {
  const list = Array.isArray(rows) ? rows : []
  const instances = Array.isArray(settings?.indicatorInstances) ? settings.indicatorInstances : []

  // ⭐ THE LIVE HOST SET — the two sets the chart itself allocates panes from.
  // Volume is a PANE when the settings say so — OR when something is overlaid on
  // it, because `StockChart` promotes it then whatever the setting says
  // (`volSeparatePane = volInSeparatePane || volOverlaySet.size > 0`). Reading
  // only the flag would draw a band in the map for a chart that has a real pane.
  // ⭐ ONE PREDICATE, ASKED. This re-derived the renderer's rule and got a
  // DIFFERENT answer — it could not see `showVolume`/`blankVolume`/the
  // `volumeSeparatePane` prop, and it read instance display targets while the
  // renderer read the legacy `cs.volumeOverlayIndicators` list. See
  // `engine/volumePresentation.js` for the three ways they diverged.
  //
  // ⚠️ THE PROPS ARE NOT AVAILABLE HERE, so this is the settings-only answer —
  // the same one, with the unknowable inputs omitted rather than guessed.
  // ⚰️⚰️ THE PROPS ARE PASSED IN NOW, AND THAT WAS THE WHOLE GAP. This asked
  // `volumeOwnsPane({ cs, instances })` — the SETTINGS-ONLY answer — while the
  // renderer asked the same helper with three more inputs it holds as PROPS:
  // `volumeSeparatePane`, `blankVolume` and `showVolume`. `ChartPane` passes
  // `volumeSeparatePane` unconditionally, so on the main chart the renderer says
  // PANE and this said BAND on every chart whose `cs.volume.separatePane` was
  // unset — which is why Volume rendered in its own pane while Chart Data listed
  // it inside PRICE, and why `movePane` resolved an order with no `volume` key in
  // it for the arrows to cross.
  //
  // ⭐ ONE PREDICATE, ONE SET OF INPUTS. The host owns the props and now hands
  // them to both readers, so there is no second answer left to drift.
  const separateVolume = volumeOwnsPane({ cs: settings, instances, ...(volumeOpts || {}) })

  const live = new Set([
    ...paneOwnKeys(instances, settings),
    ...paneOwnersNeeded(instances, settings),
  ])

  const byId = new Map()
  for (const inst of instances) {
    if (!inst || typeof inst !== 'object' || !inst.instanceId) continue
    let gone = false
    try { gone = isInstanceTombstone(inst) } catch { /* booby-trapped getter */ }
    if (!gone) byId.set(inst.instanceId, inst)
  }

  // ⭐⭐ THE PANE'S NAME IS THE MENU'S NAME. Same pool rule as
  // `displayTargetOptions`: disambiguated against the WHOLE chart, so the member
  // reads `QQQ #2` in the map, in the destination menu and on the legend chip.
  const lookup = typeof defOf === 'function' ? defOf : (() => null)
  const names = paneHostLabels(
    [...byId.values()].filter((i) => typeof i.defId === 'string' && i.defId),
    lookup,
    // ⭐ AND THE WHOLE INSTANCE LIST, so a host named apart from a sibling by its
    // SOURCE reads `EMA 20 · RSI (14)` here exactly as it does in the destination
    // menu — never `EMA 20 (source @inst:rsi:1::rsi)`.
    instances,
  )

  /** Where does this row draw? Canonical — never inferred from a string. */
  const placeOf = (row) => {
    // A FIXTURE has no instance and no display target: an MA overlay is on the
    // price pane and the volume section is the volume band, because that is
    // where the legacy blob draws them. `path.kind` is the row's own declaration
    // of which, so this reads the row rather than matching ids.
    if (!row.engineOwned || !row.instanceId) {
      const volume = row.path && row.path.kind === 'section' && row.path.key === 'volume'
      // ⛔⛔ A BANDED VOLUME IS NOT A PANE, AND THE MAP MUST NOT SAY IT IS.
      // `cs.volume.separatePane` is the difference between a real
      // lightweight-charts pane and a band drawn inside the candles' own. Showing
      // a "Volume" heading for the band would offer a pane to reorder that the
      // renderer never allocates — the same lie the hidden-host group exists to
      // avoid, and the reason this reads the flag rather than the row.
      return { kind: volume && separateVolume ? 'volume' : 'price', host: null }
    }
    const inst = byId.get(row.instanceId)
    if (!inst) return { kind: 'price', host: null }
    const target = resolveDisplayTarget(inst, settings)
    if (target === 'price') return { kind: 'price', host: null }
    if (target === 'volume') return { kind: 'volume', host: null }
    const owner = paneOwnerOf(inst, settings)
    if (owner && live.has(owner)) return { kind: 'pane', host: owner }

    // ─── NO PANE. TWO VERY DIFFERENT REASONS, AND THEY MUST NOT SHARE A WORD ──
    //
    // ⚰️ MEASURED IN THE HARNESS: hiding an own-pane RSI filed it under "Needs
    // attention" — telling a member that the pane was "no longer on the chart"
    // one second after they deliberately switched the series off. Nothing was
    // broken and nothing needed repairing; the panel was simply reading a
    // MISSING PANE and assuming the worst reason for it.
    //
    // ⭐ SO THE QUESTION IS WHETHER THE HOST STILL EXISTS, not whether its pane is
    // allocated. A host that exists has a pane again the moment something in it
    // becomes visible — that is HIDDEN, and it is reversible from the row's own
    // toggle. A host that is GONE cannot come back, and that is the fail-closed
    // orphan `placement.js` refuses to re-home: the member has to choose
    // somewhere new. One is a state, the other is a repair.
    //
    // ⛔ NEITHER BRANCH WRITES ANYTHING. The stored target is untouched in both
    // cases; this only decides which true sentence to print.
    if (owner && byId.has(owner)) return { kind: 'hidden', host: owner }
    return { kind: 'orphans', host: owner || null }
  }

  const price = { id: PRICE_PANE, kind: 'price', name: 'Price', rows: [] }
  const volume = { id: VOLUME_PANE, kind: 'volume', name: 'Volume', rows: [] }
  const orphans = { id: ORPHAN_GROUP, kind: 'orphans', name: 'Needs attention', rows: [] }
  const hidden = { id: HIDDEN_GROUP, kind: 'hidden', name: 'Not shown', rows: [] }
  const byHost = new Map()

  // Hosts first, in row order, so a pane exists before its guests arrive — and
  // so the groups come out in the order the panes are stacked.
  for (const row of list) {
    if (row.instanceId && live.has(row.instanceId) && !byHost.has(row.instanceId)) {
      byHost.set(row.instanceId, {
        id: row.instanceId,
        kind: 'pane',
        name: names.get(row.instanceId) || row.label,
        rows: [],
        host: row,
      })
    }
  }

  for (const row of list) {
    const at = placeOf(row)
    if (at.kind === 'price') { price.rows.push(row); continue }
    if (at.kind === 'volume') { volume.rows.push(row); continue }
    if (at.kind === 'orphans') { orphans.rows.push(row); continue }
    if (at.kind === 'hidden') { hidden.rows.push(row); continue }
    const group = byHost.get(at.host)
    // `live` already gated this; the fallback keeps a row VISIBLE rather than
    // dropping it if it ever does not, because a row the member cannot see is
    // a row they cannot fix.
    if (group) group.rows.push(row)
    else orphans.rows.push(row)
  }

  // ⛔ AN EMPTY GROUP IS NOT RENDERED. Price with nothing on it is still the
  // chart's own candles, so it stays; the others are only real when occupied.
  // ─── AND THEY COME OUT IN THE ORDER THE CHART DRAWS THEM ──────────────
  //
  // ⭐ THE SAME `resolvePaneOrder` THE RENDERER READS, over the same key space.
  // A map that listed panes in one order while the chart stacked them in another
  // would be exactly the "plausible-looking guess" this file's header refuses.
  //
  // ⚠️ `hidden` AND `orphans` ARE NOT PANES and are never arranged: they are
  // the two groups whose members are not drawing at all, so they sit at the end
  // where a repair list belongs. `paneOrder` never contains their ids.
  const panes = [price, ...(separateVolume ? [volume] : []), ...byHost.values()]
  const order = resolvePaneOrder(settings, [...byHost.keys()], { volumePane: separateVolume })
  const rank = new Map(order.map((k, i) => [k, i]))
  panes.sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9))

  return [...panes, hidden, orphans]
    .filter((g) => g.rows.length > 0 || g.kind === 'price')
}

// ─── WHAT ONE ROW IS CALLED, AND WHAT IT READS ──────────────────────────────
//
// ⭐⭐ ONE HOME FOR BOTH, AND IT IS HERE rather than in the component because
// both are answers about PLACEMENT — a row's name depends on the pane it is
// filed under — and this file is already the placement read model. A component
// that computed its own would be a second answer to "where does this draw", the
// exact drift `paneMap`'s header refuses.
//
// ⛔ PRESENTATION ONLY. Nothing below is persisted, addressed or compared.
// `row.id` / `row.instanceId` remain the identity for every write, so two rows
// that come out of here wearing the SAME name are still two instances and the
// Remove on one cannot reach the other.

const SRC_SEP = ' · '

/**
 * The raw stored value of a definition's FIRST declared `source` input, or null.
 *
 * ⛔ THE DECLARATION IS THE GATE (`type: 'source'`), never a key name. A user
 * formula whose `period` input happens to hold a string that looks like a ref is
 * still a period.
 *
 * ⚠️ IT FALLS BACK TO THE INPUT'S OWN `default`, because "unset means the current
 * default" is the rule the migrator, the binder and `drawnValues` all follow — an
 * instance that has never been edited stores nothing and still reads `close`.
 */
function declaredSourceValue(row, defOf, byId) {
  if (!row || !row.engineOwned || !row.instanceId) return null
  const def = typeof defOf === 'function' ? defOf(row.defId) : null
  const inputs = (def && Array.isArray(def.inputs)) ? def.inputs : []
  const declared = inputs.find((i) => i && i.type === 'source')
  if (!declared || typeof declared.key !== 'string' || !declared.key) return null
  const inst = byId.get(row.instanceId)
  const stored = (inst && inst.inputs && typeof inst.inputs === 'object')
    ? inst.inputs[declared.key] : undefined
  if (typeof stored === 'string' && stored) return stored
  return typeof declared.default === 'string' && declared.default ? declared.default : null
}

/**
 * The NAME the left structure prints for one row, and the human SOURCE the
 * Inspector prints beneath it.
 *
 * ⭐⭐ THE NAMING RULE, WHICH IS THE ONE NEW IDEA HERE: a row does not repeat what
 * the pane heading above it already says. Inside the `QQQ` pane an average of QQQ
 * is `EMA 20`; filed under `Price` the same instance is `EMA 20 · QQQ`, because
 * there the heading says `Price` and the source would otherwise be invisible.
 * `disambiguateLabels` may already have appended that suffix for its own reason
 * (two rows colliding), so the suffix is STRIPPED first and re-applied by this
 * rule — never appended twice, never left on inside its own pane.
 *
 * ⛔ A BAR FIELD IS NOT A FOREIGN SOURCE. `EMA 9 · Close` is noise on the price
 * pane: close is what a moving average has always averaged. Only a SYMBOL or
 * another INSTANCE earns the suffix.
 *
 * ⛔ AND A DEFINITION THAT NAMES ITSELF FROM ITS SOURCE NEVER GETS ONE — `QQQ ·
 * QQQ`. `meta.labelFrom === 'source'` is that declaration, READ, not guessed.
 *
 * ⚠️ THE FALLBACK SOURCES ARE FACTS, NOT GUESSES. A legacy `cs.overlays` average
 * reads the close and nothing else, and the volume section reads volume. Both are
 * properties of those two mechanisms, and `row.path.kind` is the row's own
 * declaration of which it is.
 *
 * @returns {{name: string, source: string|null}}
 */
export function paneRowMeta(row, group, settings, defOf) {
  const label = (row && typeof row.label === 'string') ? row.label : ''
  const instances = Array.isArray(settings?.indicatorInstances) ? settings.indicatorInstances : []
  const byId = new Map(instances.filter((i) => i && i.instanceId).map((i) => [i.instanceId, i]))
  const lookup = typeof defOf === 'function' ? defOf : (() => null)
  const def = (row && row.defId) ? lookup(row.defId) : null

  const raw = declaredSourceValue(row, lookup, byId)
  const described = raw ? describeSourceValue(raw, lookup, byId) : null
  const foreign = !!raw && (raw.startsWith('sym:') || raw.startsWith('@'))
  const namesItselfFromSource = !!(def && def.meta && def.meta.labelFrom === 'source')

  let source = described
  if (!source && row && !row.engineOwned && row.path) {
    if (row.path.kind === 'section' && row.path.key === 'volume') source = 'Volume'
    else if (row.path.kind === 'overlay') source = 'Close'
  }

  let name = label
  if (described && name.endsWith(SRC_SEP + described)) {
    name = name.slice(0, -(SRC_SEP + described).length)
  }
  const paneSaysIt = !!(group && typeof group.name === 'string' && described
    && group.name.trim().toLowerCase() === described.trim().toLowerCase())
  if (foreign && described && !paneSaysIt && !namesItselfFromSource) {
    name = `${name}${SRC_SEP}${described}`
  }

  return { name, source: source || null }
}

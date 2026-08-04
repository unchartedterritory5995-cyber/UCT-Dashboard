// app/src/components/chart/engine/flipState.js
//
// ─── WHICH DEFINITIONS THE ENGINE IS CURRENTLY DRAWING ──────────────────────
//
// READ-ONLY, and deliberately so. Nothing here writes a settings blob or an
// instance: that is Task 9's `instanceControls.js`, and this module must not
// grow into it. What lives here is the one QUESTION two different readers ask —
// StockChart's render pass, and any control that needs to know whether it still
// controls anything.
//
// It exists at all because `ChartToolbar` is the second reader. The toolbar is
// rendered BY `StockChart`, so `StockChart` cannot export the answer to it
// without an import cycle, and a hand-copied second list of migrated ids is
// exactly the defect this branch has already fixed twice (`7b28e5d8`, and the
// legend slot rail in this same fix round). One list, two importers.

import { normalizeInstances } from './instances'

/**
 * A collection that REFUSES a write, which `Object.freeze` does not give you.
 *
 * ⛔ `Object.freeze(new Set([…]))` DOES NOT FREEZE THE SET. `Object.isFrozen`
 * answers `true` and `.add()` / `.delete()` still succeed — a Set's contents
 * live in an internal slot, not in own properties, so `freeze` seals the wrapper
 * and nothing else. Measured directly, not assumed:
 *
 *     isFrozen: true · add() SUCCEEDED · delete() SUCCEEDED
 *
 * That matters here and almost nowhere else, because the two sets below are not
 * caches — each membership is a SHIPPED decision with a pixel number and a
 * 24-case parity run behind it. A `ENGINE_MIGRATED_DEF_IDS.add('stoch')` at
 * module scope creates the stranded category (`docs/decisions/2026-08-03-…`
 * §4.1) for real, at runtime, and every STATIC rail on this branch reads the
 * source and sees nothing — worse, an `.add()` inside a function body (a flag
 * path, a dev branch) is invisible to all of them. Shadowing the three mutators
 * with own properties and THEN freezing makes the write throw where it happens
 * instead of one screen away in a chart nobody screenshotted; freezing after the
 * assignment is what stops the guard itself from being reassigned.
 *
 * `enumerationSites.test.js`'s no-stranding rail probes this seal, so deleting
 * it is a red test rather than a silent return to the old premise.
 */
function sealed(collection, mutators) {
  for (const op of mutators) {
    collection[op] = () => {
      throw new TypeError(
        `flipState: ${op}() on a flip set. Membership is a shipped decision with a parity ` +
        'number behind it, not runtime state — edit the literal and re-run the gate.',
      )
    }
  }
  return Object.freeze(collection)
}

const sealedSet = (ids) => sealed(new Set(ids), ['add', 'delete', 'clear'])
const sealedMap = (entries) => sealed(new Map(entries), ['set', 'delete', 'clear'])

const EMPTY = sealedSet([])
const EMPTY_INPUTS = sealedMap([])

/**
 * THE DOUBLE-DRAW RAIL. The definition ids the engine is allowed to draw.
 *
 * 🔴 THIS SENTENCE USED TO END *"— exactly those whose legacy block in
 * `StockChart.jsx` carries `&& !engineOwned.has('<id>')`"*, and it has been false
 * since Flip B: Flip B DELETED the blocks instead of guarding them, so no such
 * guard exists for any id in this set — `enumerationSites.test.js` → *"keeps no
 * Flip-A guard for a flipped id — the block should be GONE, not guarded"* asserts
 * that it cannot. B5 Task 4 deleted `StockChart`'s last `engineOwnedDefIds` call
 * with it (the value had zero readers). The paragraph below is kept because it is
 * the reason this set exists at all; read it in the past tense for Flip A.
 *
 * `engineOwnedDefIds` answered "which legacy blocks stand down", and the binder
 * separately draws whatever instances it is handed. Those are two decisions, and
 * before this they could disagree: an instance of a definition whose legacy block
 * has no guard meant the ENGINE drew it *and* the legacy block drew it, on the
 * same scale, in the same band — a silently double-drawn indicator, which reads
 * as a slightly bolder line and nothing else. The documented B3 obligation was
 * "add one line per migrated indicator", and nothing FAILED if B3 forgot one.
 *
 * Filtering the instance list through this set makes the pairing structural: a
 * definition that is not here is drawn by its legacy block only, exactly as it
 * always has been, and a definition that IS here has a test asserting that its
 * legacy block stands down (`stockChartWiring.test.jsx`). B3's step is now: add
 * the guard AND add the id — and the test fails if only the id lands.
 *
 * ⚠️ EXPORTED FOR THAT TEST, which iterates it, and re-exported by `StockChart`
 * so its importers do not have to move. Keep it a Set of definition ids.
 *
 * ⚠️ ORDER IS NOT FREE FOR A PRICE OVERLAY. The engine draws every series it owns
 * contiguously at ONE call site; legacy interleaves its blocks down
 * `updateChart`. For the five overlays that share the CANDLES' pane and scale —
 * `bb`, `vwap`, `sar`, `ichimoku`, `donchian`, in that order both in the registry
 * and in `StockChart.jsx` — LWC's insertion-order z-stacking makes that
 * difference visible: migrate a LATER one while an EARLIER one is still legacy
 * and the engine's copy is inserted ABOVE an overlay it currently sits below.
 * They must therefore migrate in registry order, which
 * `stockChartWiring.test.jsx` pins ("no price overlay is migrated ahead of an
 * earlier one").
 *
 * ⚠️ MEMBERSHIP IS NOT "IS IT DRAWN RIGHT NOW". `vwap` is in this set and draws
 * on NO daily chart — `engine/eligibility.js` removes it above 60-minute bars,
 * exactly as `VWAP_TFS` used to remove the legacy one (that constant, and the
 * block that read it, are deleted). Membership means "the engine is
 * the authority for this definition"; whether authority produces a line is the
 * eligibility hook's answer and the timeframe's. A reader that treats this set as
 * a paint list will be wrong on every daily chart from B3 Task 8 onward.
 */
export const ENGINE_MIGRATED_DEF_IDS = sealedSet([
  'rsi', 'bb', 'macd', 'vwap', 'stoch', 'atr', 'sar', 'ichimoku',
  'mfi', 'cci', 'williamsR',
])

/**
 * THE FLIP-B SET. Definition ids for which the INSTANCE list is the read
 * authority and the legacy render block has been DELETED.
 *
 * `ENGINE_FLIPPED_DEF_IDS ⊆ ENGINE_MIGRATED_DEF_IDS`, always: an id can only be
 * flipped after its engine copy has been proven pixel-identical. A test asserts
 * the subset relation, because the reverse — flipped but not migrated — means the
 * legacy block is gone and nothing replaced it.
 *
 * ⭐ TASK 10 OPENED IT: `rsi` and `bb`. Their legacy render blocks, their
 * `useRef`s, their `indicatorData` branches, their hide-all entries and RSI's
 * crosshair fallback are DELETED, and what reads this set now decides real
 * behaviour rather than nothing:
 *
 *   · `csForPaneMargins` rewrites `indicators.<id>.enabled` from the INSTANCE
 *     list for these ids, so the bands follow the instances and `paneMargins.js`
 *     stays consumed rather than extended;
 *   · StockChart's instance read runs `migrateLegacyToInstances` and accepts a
 *     PROJECTED instance for a flipped id only — a whole-set gate would move all
 *     four pilots on the first flip, which is exactly what flipping one at a time
 *     with a pixel number each exists to prevent;
 *   · StockChart's Flip-A `hidden` projection is SKIPPED for a flipped id (the
 *     instance is the switch now, not the legacy toggle) and still applies to the
 *     un-flipped migrated ones;
 *   · `ChartToolbar`'s period/colour rows for these ids are LIVE again and write
 *     through `instanceControls`, because a flipped id is the only one whose
 *     control has a writer to route to.
 *
 * ⭐ TASK 11 CLOSED IT: `macd` and `vwap`. **The set now EQUALS
 * `ENGINE_MIGRATED_DEF_IDS`**, and that equality is not a coincidence to be
 * enjoyed — it is a state with consequences that were resolved deliberately
 * rather than left inert:
 *
 *   · Flip A is OVER. There is no migrated-but-un-flipped definition left, so
 *     StockChart's `hidden` projection (Task 2's "the legacy toggle is still the
 *     switch") had no reachable subject and was DELETED with its `legacyEnabled`
 *     helper. `flipB.test.jsx` asserts the equality, so the day B4 migrates a
 *     fifth definition WITHOUT flipping it, that assertion fails and whoever is
 *     holding it is told the projection has to come back;
 *   · `vwapOverride` no longer needs a flag to manufacture its forced instance —
 *     the flag-gated version would have lost the Model Book popup's VWAP on every
 *     existing user's chart, because there is no legacy block left to catch it;
 *   · 🔴 THIS BULLET USED TO SAY *"`ChartToolbar`'s `engineInert` is now
 *     identically false. The predicate and its 34 row bindings STAY (they are what
 *     a B4 migration reactivates)"* — **and B4 Task 8 deleted all of it** when
 *     spec §6 replaced the fifteen per-indicator rows with one launcher. The
 *     predicate, `inertTitle`, `shownInput` and the 34 bindings are gone;
 *     `ChartToolbar.engineInert.test.jsx` was RETARGETED to assert they stay gone.
 *     A present-tense paragraph about a mechanism that has not existed for a whole
 *     phase is the control-rot shape this branch keeps finding, so it is corrected
 *     in place rather than deleted.
 *
 * ⛔⭐ AND THE ENGINE RUNS FOR THEM UNCONDITIONALLY — B5 TASK 4 DELETED THE FLAG.
 * `engineEnabled` was the opt-in for the engine as a SECOND renderer — a chart
 * that could already draw the indicator by hand. A FLIPPED definition has no
 * hand-written block left, so gating it on an opt-in flag did not make the engine
 * dark, it would have DELETED the indicator; and every stored blob in production
 * had the flag absent, i.e. false, with no user action able to change that. So the
 * narrowing this paragraph used to describe ("activate when the set is non-empty,
 * and while the flag is off show flipped ids only") was inert the moment the two
 * sets became equal, and the flag it was written against is gone at all seven
 * sites. `StockChart` now activates the engine on `ENGINE_FLIPPED_DEF_IDS.size > 0`
 * alone. Record: `docs/decisions/2026-08-04-engine-enabled-deleted.md`.
 *
 * ⭐ B5 TASK 5 ADDED `stoch` AND `atr`, TO BOTH SETS IN ONE COMMIT. That is the
 * cutover's standing rule rather than a choice made here: with `engineEnabled`
 * deleted (Task 4) a migrated-but-un-flipped definition is drawn by NOTHING —
 * not "engine-drawn for flag-holders", which is what it used to mean — so the
 * two sets move together or the indicator disappears. `enumerationSites.test.js`
 * refuses the intermediate state in both directions, and `flipB.test.jsx`
 * asserts the equality, so a fifth definition migrated without being flipped is
 * a red test rather than an invisible deletion.
 *
 * ⚠️ AND THEY WENT IN REGISTRY ORDER, WHICH IS LOAD-BEARING FOR A DIFFERENT
 * REASON THAN THE OVERLAYS'. `stoch` and `atr` are PANE oscillators, each on its
 * own named scale in its own band, so the z-stacking hazard the paragraph above
 * describes for the five price overlays does not apply to them. What does apply
 * is that `binder.sync()` runs BEFORE every remaining legacy block, so a pane
 * oscillator migrated out of registry order would be inserted ahead of an
 * un-migrated one it currently sits behind — invisible while nothing overlaps,
 * and a real z-order change the moment the volume-pane OVERLAY path puts two of
 * them on one shared left axis. Registry order costs nothing and closes it.
 *
 * ⭐ B5 TASK 6 ADDED `sar` AND `ichimoku`, AND THEY ARE THE PRICE-OVERLAY HALF OF
 * THE PARAGRAPH ABOVE RATHER THAN A REPEAT OF IT. `stoch`/`atr` are pane
 * oscillators whose ordering hazard is latent (it needs the volume-overlay path
 * to put two of them on one axis); these two share the CANDLES' pane and the
 * CANDLES' scale with `bb`, `vwap` and `donchian`, so LWC's insertion-order
 * z-stacking makes registry order visible TODAY, on every chart that turns two of
 * them on. `bb` and `vwap` were already engine-drawn, `donchian` is still legacy
 * and is drawn AFTER the sync call, so `bb, vwap, sar, ichimoku` land contiguously
 * at the sync site and `donchian` stays on top — which is exactly the shipped
 * order. Migrating `donchian` (Task 8) ahead of these two would have inverted it.
 *
 * ⚠️ AND WITH THEM THE LEGACY CHIP REGISTRY IS GONE. `sar::sar`,
 * `ichimoku::tenkan` and `ichimoku::kijun` were the last three of the six
 * `registerLegacyChip` registrations, so `registerLegacyChip`,
 * `legacyChipEntriesRef`, `csIndicatorsRef` and `LEGACY_CHIP_ORDER` have no
 * callers and are DELETED. `readout.chipsFrom` keeps its second-source shape —
 * `engineChips` is one caller of it, and Phase C's server lane is the next.
 *
 * ⭐ B5 TASK 7 ADDED `mfi`, `cci` AND `williamsR` — three single-line pane
 * oscillators, and the first migration of this phase whose whole risk is in the
 * GUIDES rather than in the series. Each is one line plot plus `hlines` levels,
 * so the series half is a repeat of `atr`'s; what is not a repeat is that the
 * three carry THREE DIFFERENT GUIDE SHAPES and THREE DIFFERENT SCALES, and an
 * omitted `createPriceLine` option means LWC's OWN DEFAULT rather than "keep
 * what's there" (the asymmetry that cost 379 px on RSI's 50-midline at B3):
 *
 *   · `mfi`       80 / 20, dashed, on a `fixedPane(0, 100)` scale;
 *   · `cci`       ±100 dashed PLUS a LARGE-dashed zero line — the only
 *     definition in the registry with two guide styles — on an `autoPane`,
 *     i.e. the only unbounded one of the three;
 *   · `williamsR` −20 / −80 on a `fixedPane(-100, 0)` scale, drawn from a
 *     `williams_r` plot key while its settings key stays `williamsR`.
 *
 * ⚠️ AND THEY WENT IN REGISTRY ORDER FOR THE PANE-OSCILLATOR REASON, NOT THE
 * OVERLAY ONE. Like `stoch`/`atr` these three own their own named scales in
 * their own bands, so the z-stacking hazard the price-overlay paragraph above
 * describes does not apply; what applies is that `binder.sync()` runs BEFORE
 * every remaining legacy block, so an oscillator migrated out of registry order
 * would be inserted ahead of an un-migrated one it currently sits behind. That
 * is invisible while nothing overlaps and real the moment the volume-overlay
 * path puts two of them on one shared left axis — which `mfi`, `cci` and
 * `williamsR` are all eligible for, exactly as `stoch` and `atr` are.
 *
 * ⚠️ IT LIVES HERE, NOT IN `StockChart.jsx`, for the same reason
 * `ENGINE_MIGRATED_DEF_IDS` does: `ChartToolbar` is rendered BY StockChart and
 * cannot import from it. `StockChart` re-exports it so the plan's stated
 * interface (`ENGINE_FLIPPED_DEF_IDS` from `StockChart.jsx`) still holds.
 */
export const ENGINE_FLIPPED_DEF_IDS = sealedSet([
  'rsi', 'bb', 'macd', 'vwap', 'stoch', 'atr', 'sar', 'ichimoku',
  'mfi', 'cci', 'williamsR',
])

/**
 * The migrated definitions this settings blob hands to the engine.
 *
 * "Hands to the engine", not "paints this frame": a HIDDEN instance is still the
 * engine's, because the legacy block stays stood down for it and re-showing it
 * draws from the instance. A control asking "am I still connected to anything?"
 * wants that answer, not the paint one.
 *
 * Normalised, not read raw — an instance the validator drops (a tombstone, an
 * undeclared input, an unknown definition) owns nothing and is drawn by nobody,
 * so a control that greyed itself out for one would be lying in the other
 * direction. Same rule, same function, as the render pass.
 *
 * @param {object} cs        merged chart settings
 * @param {object} registry  the engine registry (`getDefinition`/`listDefinitions`)
 * @returns {Set<string>} frozen-empty when the engine is off or holds nothing
 */
export function engineDrawnDefIds(cs, registry) {
  const byId = engineDrawnInputs(cs, registry)
  return byId.size ? new Set(byId.keys()) : EMPTY
}

/**
 * …and WHAT each of them is drawing with.
 *
 * The second question the toolbar has to ask. Greying a control out was only
 * half the honesty fix: the greyed box still showed `cs.indicators.rsi.period`,
 * so a user on an `?instances=` chart could read a disabled **14** in the
 * settings panel while the legend printed **RSI(7)** in a colour the panel's
 * swatch did not show. Two numbers for one line, and the tooltip explaining that
 * the field is not the authority sat right next to the value that is not the
 * authority either.
 *
 * Same walk, same normalisation, same migrated-id filter as `engineDrawnDefIds`
 * — derived from this one so the two can never disagree about which definitions
 * the engine holds.
 *
 * **FIRST instance of a definition wins.** More than one instance of the same
 * definition is legal (that is the point of the engine), but a settings row is
 * per-DEFINITION and can only show one. First-in-list is the binder's own draw
 * order, so the row shows the first line the user sees. When B4 gives instances
 * their own rows this function stops being needed; until then it is strictly
 * better than showing a value nothing renders.
 *
 * @returns {Map<string, object>} defId → that instance's normalised `inputs`.
 *          Empty map when the engine is off or holds nothing.
 */
export function engineDrawnInputs(cs, registry) {
  // ⭐ B5 Task 4. The flag is DELETED, not flipped (docs/decisions/2026-08-04-
  // engine-enabled-deleted.md). It was read from the STORED BLOB, so it was false
  // for every user alive and flipping the default could not have healed one; and
  // its only remaining job was to distinguish migrated-but-un-flipped from
  // flipped, a state B5 never creates because it flips in the same commit it
  // migrates. A guard on a key that no longer exists is a guard that reads as
  // live logic, which is why it is gone rather than left `?? true`.
  //
  // 🔑 WHAT THE GUARD ACTUALLY COST, since it is the only one whose deletion a
  // user could have SEEN: this function returned EMPTY on a flag-off chart, so
  // `ChartToolbar` fell back to the legacy MIRROR — and the flag was off for
  // EVERYONE, so the fallback was the shipped path rather than the edge case. It
  // is now unconditional: the panel shows what the engine is drawing with.
  if (!cs) return EMPTY_INPUTS
  const raw = cs.indicatorInstances
  if (!Array.isArray(raw) || raw.length === 0) return EMPTY_INPUTS
  const out = new Map()
  for (const inst of normalizeInstances(raw, registry).kept) {
    if (!ENGINE_MIGRATED_DEF_IDS.has(inst.defId)) continue
    if (out.has(inst.defId)) continue
    out.set(inst.defId, inst.inputs || {})
  }
  return out.size ? out : EMPTY_INPUTS
}

import { getDefinition } from './nativeRegistry'
import { isInstanceTombstone } from '../chartDefaults'
import {
  derivedTargetFor, parsePaneOfTarget, paneOfTarget, sourceInputsOf, instanceLabel,
} from './sourceRef'
import { disambiguateLabels } from './readout'

/**
 * WHERE AN INDICATOR DRAWS — the one place that decides it.
 *
 * ⭐ THIS MODULE EXISTS BECAUSE FOUR PLACES USED TO DECIDE IT SEPARATELY: the
 * migrator (`instances.js`), `instanceControls.placementFor`, `placement.js`'s
 * overlay branch, and `StockChart`'s `volOverlaySet`. Each read
 * `cs.volumeOverlayIndicators` and each drew its own conclusion, and the comment
 * on `placementFor` said out loud that it was "duplicating the rule rather than
 * exporting the migrator's" with a byte-identity test to catch them drifting. A
 * test that catches drift is a test that expects drift. One function instead.
 *
 * ⛔⛔ THE PRECEDENCE, AND IT IS THE WHOLE CONTRACT:
 *
 *     1. an explicit `instance.placement.target`   — the canonical, new answer
 *     2. else `cs.volumeOverlayIndicators`          — the legacy answer, READ ONLY
 *     3. else the definition's declared target      — what the indicator is for
 *
 * ⚠️ LEGACY IS READ, NEVER REWRITTEN. Loading an old chart resolves through (2)
 * and stores nothing; the blob is byte-identical after a load that never touched
 * the placement UI. Only an explicit user action writes (1) — see
 * `setInstanceDisplayTarget`. "Migrate on load" would mean every user's stored
 * settings silently change shape the first time they open a chart, and the one
 * thing worse than two formats is two formats plus a rewrite nobody asked for.
 */

/** The targets a user can currently CHOOSE for a definition that declares
 *  `pane`. A DERIVED instance is offered more than this — see below. */
export const DISPLAY_TARGETS = Object.freeze(['pane', 'volume'])

/**
 * Is `t` a target a user may WRITE?
 *
 * ⭐⭐ SOURCE AND DISPLAY TARGET ARE SEPARABLE, AND THIS IS THE SENTENCE THAT
 * SAYS SO. `MA(RSI)` DEFAULTS into RSI's pane; it is not welded there. So the
 * writable set has to include the two things the fixed list could never express:
 *
 *   `'@rsi'`  — "wherever RSI is", the derived default said out loud. Writing it
 *               is how "put it back with its source" is spelled, and
 *               `setInstanceDisplayTarget` then DELETES the key because it
 *               equals the default. One spelling of the default, as ever.
 *   `'price'` — resolvable since the first pass (`placement.js`) and now
 *               reachable: a moving average of RSI drawn on the candles is a
 *               strange chart, but it is the user's chart, and refusing it here
 *               would mean the pane is a property of the SOURCE rather than a
 *               default.
 */
export function isWritableDisplayTarget(t) {
  if (typeof t !== 'string' || !t) return false
  return DISPLAY_TARGETS.includes(t) || t === 'price' || !!parsePaneOfTarget(t)
}

/**
 * The effective target for one instance.
 *
 * @param {object} instance   an entry from `cs.indicatorInstances`
 * @param {object} cs         chart settings (read for the legacy list only)
 * @param {string} [defTarget] the definition's declared target; looked up when omitted
 */
/**
 * Rule (2) of `resolveDisplayTarget`, on its own — the LEGACY answer.
 *
 * ⭐⭐ EXTRACTED SO THE WRITER AND THE READER SHARE ONE IMPLEMENTATION. It has
 * two callers and they ask the same question from opposite ends:
 * `resolveDisplayTarget` asks *"where does this instance go?"*, and
 * `instanceControls.placementFor` asks *"what should a brand-new instance
 * STORE?"* — and the honest answer to the second is *only this*, never the
 * derived default. See `placementFor` for the measured reason.
 *
 * ⛔ ONLY A PANE OSCILLATOR CAN BE OVERLAID ONTO VOLUME. A price overlay listed
 * in `cs.volumeOverlayIndicators` (which nothing writes, but data is data) keeps
 * its declared target rather than being moved somewhere it cannot draw.
 *
 * @returns {'volume'|null}
 */
export function legacyVolumeTarget(defId, declared, cs) {
  if (declared !== 'pane') return null
  if (!Array.isArray(cs?.volumeOverlayIndicators)) return null
  return cs.volumeOverlayIndicators.includes(defId) ? 'volume' : null
}

/**
 * The key on an instance's `placement` that records USER INTENT.
 *
 * ⭐⭐ ONE BOOLEAN, WRITTEN ONLY WHEN TRUE, AND THAT IS THE WHOLE SCHEMA. The
 * codebase already says "absent means the default" everywhere a choice is
 * optional — `placement.position` omits `'below'`, an instance omits `scope` to
 * mean "every chart" — so a `targetExplicit: false` would be a stored value with
 * the same meaning as no value, and every chart ever saved would churn a byte to
 * gain it. Omission IS the legacy/automatic state.
 *
 * ⛔ IT IS NOT A GENERIC PROVENANCE FRAMEWORK. It answers exactly one question —
 * "did a member choose this destination?" — because that is the only question
 * the ambiguity was about. `placement.pane` (presentation metadata) and
 * `placement.position` (stack side) are untouched and mean what they always did.
 */
export const TARGET_EXPLICIT = 'targetExplicit'

/** Does this instance carry a member's explicit destination choice? */
export function hasExplicitTarget(instance) {
  const p = instance && instance.placement
  return !!(p && p[TARGET_EXPLICIT] === true && typeof p.target === 'string' && p.target)
}

export function resolveDisplayTarget(instance, cs, defTarget, depth = 0) {
  if (!instance || typeof instance !== 'object') return null
  const defId = instance.defId
  if (typeof defId !== 'string' || !defId) return null

  const declared = typeof defTarget === 'string' && defTarget
    ? defTarget
    : getDefinition(defId)?.placement?.target
  if (typeof declared !== 'string' || !declared) return null

  // (1) The canonical answer — AND IT IS ASKED IN TWO DIALECTS, because the blob
  // has two generations in it and only one of them can say what it means.
  //
  // ⚰️⚰️ WHY THERE IS A MARKER AT ALL. `declared` was doing two jobs at once and
  // they are in direct conflict. It is (a) the FALLBACK destination for a source
  // that derives nothing — `derivedTargetFor` answers null for `kind: 'symbol'`,
  // so `sym:QQQ:close` reaches step (3) and the declaration is the only thing
  // that sends a foreign series to its own pane — and it was also (b) the
  // sentinel this step used to decide whether a stored target meant anything.
  // MEASURED 2026-09-15: for `dataSeries` a member legitimately wants BOTH
  // directions (`close` → Own pane, and `sym:QQQ` → Price), which needs
  // `declared !== 'pane'` AND `declared !== 'price'` at the same time. No value of
  // the declaration can satisfy that, which is why re-declaring was rejected and
  // why provenance is recorded rather than inferred.
  //
  // ⭐⭐ (1a) NEW STATE — `targetExplicit: true` MEANS A MEMBER CHOSE THIS. It is
  // honoured whatever it equals, which is the whole point: "primary Close in its
  // own pane" is `target: 'pane'` on a definition that DECLARES `'pane'`, and the
  // equality trick below can never express it. `setInstanceDisplayTarget` is the
  // only writer that stamps it, and it stamps it only when the member picked
  // something the automatic rules would NOT have produced.
  //
  // ⛔⛔ (1b) LEGACY STATE — THE OLD RULE, KEPT EXACTLY, FOR BLOBS ALREADY SAVED.
  // The migrator and `addInstance` wrote `placement: { target: <the declared one> }`
  // onto every instance they created — harmless while every target was static,
  // and fatal to the first one that is not: `MA(RSI)` belongs in RSI's pane, and a
  // `target: 'price'` stored at ADD time (copied straight from the definition,
  // expressing no user intent at all) outranked that forever. Measured live — the
  // MA computed a perfect average of RSI and drew it on the candles' scale. So a
  // marker-less target is still ignored when it restates the declaration.
  //
  // ⚠️ ABSENT IS LEGACY, NOT CORRUPT, AND NOTHING IS REWRITTEN ON LOAD. That is
  // what lets this ship with NO migration: every chart saved before today keeps
  // the exact destination it has always reconstructed to, and an instance becomes
  // provenance-aware the next time a member actually moves it.
  const placement = instance.placement
  const explicit = placement && placement.target
  if (typeof explicit === 'string' && explicit) {
    if (placement[TARGET_EXPLICIT] === true) return explicit
    if (explicit !== declared) return explicit
  }

  // (2) The legacy answer — see `legacyVolumeTarget`, which is the ONE
  // implementation of this rule and is also what `instanceControls.placementFor`
  // reads when it decides what a brand-new instance should STORE.
  const legacy = legacyVolumeTarget(defId, declared, cs)
  if (legacy) return legacy

  // (2.5) ⭐⭐ A DERIVED INDICATOR DEFAULTS TO ITS SOURCE'S PANE. `MA(RSI)` into
  // RSI's pane, `MA(Volume)` into the volume pane, `MA(Close)` onto the candles —
  // the answer a trader expects, and the one that makes those three feel like one
  // feature. It sits BELOW the explicit placement above, so moving it later is an
  // ordinary write that outranks this: a default, never a weld.
  //
  // ⚠️ RESOLVED THROUGH THIS SAME FUNCTION, so a follower of a follower gets the
  // right answer and a source that is itself overlaid on Volume takes its
  // follower with it. Depth is bounded by the recursion guard below.
  if (cs && depth < 8) {
    const def = getDefinition(defId)
    const derived = derivedTargetFor(
      instance, def,
      Array.isArray(cs.indicatorInstances) ? cs.indicatorInstances : [],
      getDefinition,
      (other) => resolveDisplayTarget(other, cs, undefined, depth + 1),
    )
    if (derived) return derived
  }

  // (3) What the indicator is for.
  return declared
}

/**
 * The DEFINITION whose pane an instance draws in, or null for a shared pane.
 *
 * ⭐ THE ONE TRANSLATION FROM "SEMANTIC OWNER" TO "PANE KEY", and every consumer
 * takes it from here — `placement.js` to find the index, `paneLayout` to decide
 * who gets a pane of their own, `StockChart` to decide what sits above Price.
 * Four modules each translating it themselves is exactly the drift
 * `displayTarget.js` was created to end for Volume; this is the dynamic case of
 * the same rule.
 *
 * ⛔ IT ANSWERS A DEFINITION ID, NEVER A PANE INDEX. `computePaneLayout` keys
 * panes by definition id, and an index is a fact about the current stack that
 * changes when anything above it moves. A stored index would break the first time
 * RSI went above Price; a stored definition id cannot.
 */
export function paneOwnerOf(instance, cs) {
  const target = resolveDisplayTarget(instance, cs)
  if (!target || target === 'price' || target === 'volume') return null
  const owner = parsePaneOfTarget(target)
  if (owner) return owner
  // ⭐⭐ AND AN INSTANCE THAT HOSTS ITS OWN PANE IS NAMED BY ITS **INSTANCE**
  // ID (P2.0c). `def.id` here answered "which definition's pane", which collapsed
  // two own-pane RSIs onto one key. `defId` stays the fallback only for a
  // malformed instance carrying no id at all.
  if (!instance) return null
  if (typeof instance.instanceId === 'string' && instance.instanceId) return instance.instanceId
  return typeof instance.defId === 'string' ? instance.defId : null
}

/**
 * Where this instance would go if nobody had moved it — its SOURCE's home, or
 * null when it has no source reference at all.
 *
 * ⭐ IT ANSWERS A UNITS QUESTION, not only a position one. A guest in a shared
 * pane whose target came from HERE is reading the same numbers the host is:
 * `MA(Volume)` in the volume pane is in shares, and belongs on volume's own
 * ladder. A guest that was PARKED there — RSI dragged onto Volume — is not, and
 * needs an axis of its own. `placement.js` asks this to tell them apart, which is
 * why the distinction stays metadata rather than a list of indicator names.
 */
export function derivedTargetOf(instance, cs) {
  if (!instance || !cs) return null
  return derivedTargetFor(
    instance,
    getDefinition(instance.defId),
    Array.isArray(cs.indicatorInstances) ? cs.indicatorInstances : [],
    getDefinition,
    (other) => resolveDisplayTarget(other, cs),
  )
}

/** Definition ids that FOLLOW somebody else's pane rather than owning one. */
export function paneFollowerKeys(instances, cs) {
  const out = new Set()
  for (const inst of (Array.isArray(instances) ? instances : [])) {
    if (!inst || typeof inst !== 'object' || inst.hidden === true) continue
    const target = resolveDisplayTarget(inst, cs)
    const owner = parsePaneOfTarget(target)
    // ⭐ INSTANCE KEYS (P2.0c). An instance that names ANOTHER host draws in that
    // host's pane and reserves none of its own. Comparing against `inst.defId`
    // used to make a second RSI look like its own follower.
    if (owner && owner !== inst.instanceId) { out.add(inst.instanceId); continue }
    // ⚰️⚰️ AND SO DOES ONE DRAWN ON PRICE OR ON VOLUME — THIS WAS THE HOLE.
    //
    // `parsePaneOfTarget` answers only for `@pane:<instanceId>`; for the plain
    // targets `'price'` and `'volume'` it returns null, so an instance the member
    // had put ON THE CANDLES was never counted as a follower. It kept a pane slot
    // in `defaultPaneKeys` and a unit of `paneCountRequired` for a pane it does
    // not have — and then `paneRealization.paneOf()` resolved its key through the
    // binder to the series, which lives in PRICE's pane. `settleArrangement` read
    // that as "the Price pane belongs at the guest's slot" and swapped it there.
    //
    // ⛔ MEASURED IN THE REAL UI, adding a data series to PRICE · VOLUME and then
    // setting its destination to Price — the owner's exact workflow:
    //
    //   before settle  0:[PRICE,guest] | 1:[VOLUME] | 2:[]   guest->0, slot 2
    //   after  settle  0:[VOLUME]      | 1:[PRICE,guest]
    //
    // `swapPanes(0, 2)` put Price at 2 and the empty placeholder at 0; removing
    // the placeholder left VOLUME ON TOP. That is the owner's "adding QQQ moved
    // my Volume", and the layout/physical mismatch it leaves behind — heights
    // computed for Price at slot 0 while Price renders at 1 — is the same event
    // that crushes the Price pane.
    //
    // ⭐ A FOLLOWER IS ANYTHING THAT DRAWS IN SOMEBODY ELSE'S PANE. Own-pane
    // (`'pane'`) is the only target that reserves one, so the test is stated that
    // way round rather than by listing the targets that do not.
    if (target === 'price' || target === 'volume') out.add(inst.instanceId)
  }
  return out
}

/**
 * The definitions an ACTIVE instance placement requires a pane for.
 *
 * ⭐⭐ THE SIBLING OF `paneFollowerKeys`, AND THE OTHER HALF OF THE SAME
 * SENTENCE. That one tells the layout who needs NO pane of their own because they
 * draw inside somebody else's; this one tells it who needs one their DEFINITION
 * never asked for. Both read `resolveDisplayTarget`, so both CONSUME that answer
 * rather than forming their own — which is exactly what the layout call site
 * already says out loud about the exclusion half.
 *
 * ⛔⛔ WITHOUT THIS, AN INSTANCE PLACEMENT IS WRITABLE BUT NOT REALISABLE.
 * `paneLayout.paneTargetIds()` builds the pane-eligible set from each DEFINITION's
 * declared `placement.target === 'pane'`, so a definition that declares `price` —
 * `movingAverage`, `bb`, `vwap`, `sar`, `ichimoku`, `donchian`, `avwap`,
 * `atrBands` — got no pane no matter what the member chose.
 * `isWritableDisplayTarget('pane')` accepted the move, `resolveDisplayTarget`
 * returned it, and `resolvePlacement` then failed closed on a layout that had
 * allocated nothing. The series vanished, silently, with no error anywhere.
 *
 * ⚠️ DEFINITION PLACEMENT IS THE DEFAULT; INSTANCE PLACEMENT IS THE ACTIVE
 * STATE. This changes only what is REALISABLE, never what is DEFAULT: an instance
 * with no stored placement resolves through its definition exactly as before, and
 * appears here only if that definition already declared `pane`.
 *
 * ⚠️ HIDDEN INSTANCES ARE SKIPPED, matching `paneFollowerKeys` and
 * `orderedPaneKeys` — a hidden series draws no ink, and `keepKeys` is the
 * separate, deliberate mechanism for a hidden OWNER whose pane a visible follower
 * still needs.
 *
 * @returns {Set<string>} instanceIds — the key space `computePaneLayout` uses
 */
export function paneOwnKeys(instances, cs) {
  const out = new Set()
  for (const inst of (Array.isArray(instances) ? instances : [])) {
    if (!inst || typeof inst !== 'object' || inst.hidden === true) continue
    if (typeof inst.defId !== 'string' || !inst.defId) continue
    // ⛔ THE RESOLVED ANSWER, NOT `inst.placement.target`. A DERIVED instance's
    // target is computed from its SOURCE (`MA(RSI)` follows RSI), and reading the
    // stored field would call a follower a pane owner.
    if (resolveDisplayTarget(inst, cs) === 'pane') out.add(inst.instanceId)
  }
  return out
}

/**
 * Every definition id currently drawing INSIDE the volume pane.
 *
 * ⚠️ KEYED BY DEFINITION, NOT BY INSTANCE, and that is a real constraint rather
 * than an oversight: the volume pane's left axis is ONE scale, and `placement.js`
 * keys its overlay branch by `def.id`. Two RSI instances overlaid onto volume
 * therefore share that axis — fine while they share a range, and the same
 * per-definition boundary `placement.js` already documents for `'bands'` mode.
 *
 * ⛔ HIDDEN AND TOMBSTONED INSTANCES ARE SKIPPED, for the reason `orderedPaneKeys`
 * skips them: this set is subtracted from the pane stack, so counting an
 * instance that draws nothing would exclude a pane that nothing else fills.
 */
export function volumeOverlayKeys(instances, cs) {
  const out = new Set()
  for (const inst of (Array.isArray(instances) ? instances : [])) {
    if (!inst || typeof inst !== 'object') continue
    let tombstone = false
    try { tombstone = isInstanceTombstone(inst) } catch { /* booby-trapped getter */ }
    if (tombstone || inst.hidden === true) continue
    if (resolveDisplayTarget(inst, cs) === 'volume') out.add(inst.defId)
  }
  // ⭐ AND THE LEGACY LIST STILL COUNTS ON ITS OWN. A chart can name an
  // oscillator in `volumeOverlayIndicators` that has no instance yet — the
  // toolbar checkbox writes the list directly and always has. Dropping those
  // would move a user's overlay back into its own pane on upgrade, which is the
  // one thing "read legacy, do not rewrite it" is supposed to prevent.
  if (Array.isArray(cs?.volumeOverlayIndicators)) {
    const live = new Set()
    for (const inst of (Array.isArray(instances) ? instances : [])) {
      if (inst && typeof inst === 'object' && typeof inst.defId === 'string') live.add(inst.defId)
    }
    for (const id of cs.volumeOverlayIndicators) {
      if (typeof id === 'string' && id && !live.has(id)) out.add(id)
    }
  }
  return out
}

/**
 * The same answer in PANE-KEY language: the instance ids drawing inside volume.
 *
 * ⭐⭐ THE SIBLING `computePaneLayout` NEEDS, AND THE REASON IT IS A SECOND
 * FUNCTION RATHER THAN A WIDENED FIRST. `volumeOverlayKeys` answers "which
 * DEFINITION is overlaid" — the question `placement.js`'s overlay branch and the
 * legacy `cs.volumeOverlayIndicators` list both ask. `excludeKeys` asks a
 * different question: "which PANE KEY reserves no pane", and pane keys are
 * instance ids since P2.0c. Handing the first answer to the second question
 * silently stopped excluding anything, and every volume-overlaid oscillator
 * started reserving a band for a pane the binder never creates.
 *
 * ⛔ NO LEGACY-LIST FALLBACK, deliberately. `volumeOverlayKeys` adds defIds named
 * by `cs.volumeOverlayIndicators` that NO instance carries; those cannot appear in
 * the pane stack either, because `orderedPaneKeys` walks instances. There is
 * nothing for them to exclude.
 */
export function volumeOverlayPaneKeys(instances, cs) {
  const out = new Set()
  for (const inst of (Array.isArray(instances) ? instances : [])) {
    if (!inst || typeof inst !== 'object' || inst.hidden === true) continue
    let tombstone = false
    try { tombstone = isInstanceTombstone(inst) } catch { /* booby-trapped getter */ }
    if (tombstone) continue
    if (typeof inst.instanceId !== 'string' || !inst.instanceId) continue
    if (resolveDisplayTarget(inst, cs) === 'volume') out.add(inst.instanceId)
  }
  return out
}

/**
 * Definition ids that must KEEP a pane even though their own instance is hidden.
 *
 * ⭐⭐ BECAUSE SOMETHING VISIBLE IS DRAWING IN IT. Hiding RSI is a statement about
 * RSI's ink, and `orderedPaneKeys` correctly gives a hidden instance no pane —
 * but `MA(RSI)` is still visible and still computing, and its pane is RSI's. With
 * no pane to join it resolved to nothing and vanished too, which turns the eye
 * icon into a delete button for everything downstream of it.
 *
 * ⚠️ ONLY FOR A VISIBLE FOLLOWER. Hide both and the pane goes, which is right:
 * an empty rectangle is the thing `orderedPaneKeys` skips hidden instances to
 * avoid in the first place.
 */
export function paneOwnersNeeded(instances, cs) {
  const out = new Set()
  for (const inst of (Array.isArray(instances) ? instances : [])) {
    if (!inst || typeof inst !== 'object' || inst.hidden === true) continue
    const owner = parsePaneOfTarget(resolveDisplayTarget(inst, cs))
    // ⭐ HOST KEY vs HOST KEY (P2.0c). `owner` is an instance id now, so comparing
    // it to `inst.defId` never matched and every own-pane instance kept itself
    // alive as its own "follower".
    if (owner && owner !== inst.instanceId) out.add(owner)
  }
  return out
}

/**
 * The destinations a MEMBER may send one instance to — the menu, as data.
 *
 * ⭐⭐ P2.3: PANES BECOME MULTI-SERIES BY BEING *CHOOSABLE*, NOT BY NEW MACHINERY.
 * Every part of "SPY draws in QQQ's pane" already worked before this function
 * existed — `isWritableDisplayTarget` accepts `@<hostInstanceId>`,
 * `resolveDisplayTarget` returns it, `paneOwnKeys`/`paneFollowerKeys` sort hosts
 * from guests, `paneLayout.orderedPaneKeys` allocates the host's pane and
 * `placement.js`'s follower branch joins it on the host's own scale. What was
 * missing was a way to SAY it: the settings menu offered a hard-coded two or
 * three entries and never mentioned another pane. So this phase is an option
 * list, one writer guard, and the existing seams underneath.
 *
 * ⛔⛔ SOURCE AND DESTINATION STAY SEPARATE, and this function is where that is
 * most tempting to break. It never looks at what an instance READS to decide
 * where it may DRAW — a host qualifies by owning a pane, full stop. `MA(QQQ)`
 * may join `SPY`'s pane; two unrelated series may share one. Gating the list on
 * a source relationship would make "where should I draw it?" a property of
 * "what data is this?", which is the one confusion the whole phase exists to
 * prevent.
 *
 * ⛔ THE GATE IS "HAS THIS SERIES SOMEWHERE TO GO", NOT "IS IT DERIVED". The old
 * gate asked `derivedTargetFor` for a source pane and returned nothing when that
 * came back null — which is exactly what a SYMBOL source does (`sym:QQQ:close`
 * resolves no pane, by design, because a canonical symbol is not an instance).
 * So `MA` pointed at QQQ — the headline workflow — had no destination menu at
 * all while `MA` pointed at `close` had one. The honest question is whether the
 * definition reads a source at all; a plain price overlay (Bollinger, VWAP)
 * declares none and still gets no menu, which is the rail
 * `ChartSettingsModal.indicators.test.jsx` has always held.
 *
 * ⚠️ A DEAD HOST IS NEVER OFFERED. Tombstoned instances are skipped, so deleting
 * a pane host removes it from every other series' menu on the next render. What
 * an already-stored target pointing AT that host does is `placement.js`'s
 * long-standing answer — no pane for the owner means no binding, not a guess —
 * and this function deliberately does not paper over it with a phantom entry.
 *
 * @param {object} instance the instance whose menu this is
 * @param {object} cs       chart settings
 * @param {Function} [defOf] definition lookup; the native registry when omitted
 * @returns {{value: string, label: string, group: 'shared'|'panes'}[]}
 */
export function displayTargetOptions(instance, cs, defOf) {
  if (!instance || typeof instance !== 'object') return []
  const lookup = typeof defOf === 'function' ? defOf : getDefinition
  const def = lookup(instance.defId)
  const declared = def && def.placement && def.placement.target
  if (typeof declared !== 'string' || !declared) return []
  if (declared !== 'pane' && sourceInputsOf(def, instance).length === 0) return []

  const instances = Array.isArray(cs?.indicatorInstances) ? cs.indicatorInstances : []
  const self = instance.instanceId
  const hosts = []
  // ⭐⭐ NAMES ARE DISAMBIGUATED AGAINST THE WHOLE CHART, NOT AGAINST THE MENU.
  // A menu that numbered only its own rows would call the member's second QQQ
  // plain `QQQ` while the legend called it `QQQ #2` — and the one place the
  // member checks which pane they meant is the legend. `self` is in the pool for
  // the same reason: it is on the chart even though it is never offered.
  const pool = []
  for (const other of instances) {
    if (!other || typeof other !== 'object') continue
    if (typeof other.instanceId !== 'string' || !other.instanceId) continue
    if (typeof other.defId !== 'string' || !other.defId) continue
    let gone = false
    try { gone = isInstanceTombstone(other) } catch { /* booby-trapped getter */ }
    if (!gone) pool.push(other)
  }
  const labelOf = paneHostLabels(pool, lookup)
  for (const other of instances) {
    if (!other || typeof other !== 'object') continue
    if (typeof other.instanceId !== 'string' || !other.instanceId) continue
    // ⛔ NOT ITSELF. A series that named its own pane as its destination would be
    // its own guest: `paneFollowerKeys` would stop counting it as an owner, the
    // pane it is "following" would never be allocated, and it would vanish.
    if (other.instanceId === self) continue
    let tombstone = false
    try { tombstone = isInstanceTombstone(other) } catch { /* booby-trapped getter */ }
    if (tombstone) continue
    // ⭐ ONLY A HOST CAN BE JOINED, and asking the resolver is what makes that
    // true rather than hopeful. A guest resolves to `@somebodyElse`, so it can
    // never appear here — which is also what makes a placement CYCLE
    // unconstructible through this menu: every offered target already owns a pane.
    if (resolveDisplayTarget(other, cs) !== 'pane') continue
    hosts.push(other)
  }

  const out = []
  const seen = new Set()
  const push = (value, label, group, extra) => {
    if (!value || seen.has(value)) return
    seen.add(value)
    out.push({ value, label, group, ...(extra || {}) })
  }

  // ⭐⭐ WHERE IT IS NOW, WHEN THAT PANE IS GONE (Ruling A, 2026-09-12). The
  // member's placement is preserved — nothing here clears it, and a render must
  // never mutate saved state — so the menu has to be able to SHOW a target it
  // will not offer. Listed first, flagged `missing`, and the view renders it
  // disabled: it is the current state, not a destination.
  //
  // ⛔ WITHOUT IT THE CONTROL LIED. `current` fell through to the first option, so
  // a series parked in a deleted pane read "Price" while drawing nothing at all —
  // the member had no way to learn why their line had vanished, and picking the
  // value already displayed would have been a no-op.
  //
  // ⚠️ AND IT IS NAMELESS, TRUTHFULLY. `instanceTombstone` is `{instanceId,
  // deleted: true}` by explicit design — "a delete must not keep the user's old
  // settings lying around in the blob" — so once the host is removed its display
  // name and its source are GONE, in the session and after a reload alike.
  // `QQQ (missing)` would need the tombstone to carry metadata it deliberately
  // does not, which is a persistence decision and not one to take in passing.
  // See the ledger: this is the one sub-problem of Ruling A that is stopped on.
  const where = resolveDisplayTarget(instance, cs, declared)
  const owner = parsePaneOfTarget(where)
  if (owner && !hosts.some((h) => h.instanceId === owner)) {
    push(where, 'Pane unavailable', 'missing', { missing: true })
  }

  // The three shared destinations, in the order the member reads them.
  push('price', 'Price', 'shared')
  push('volume', 'Volume', 'shared')
  push('pane', 'Own pane', 'shared')
  hosts.forEach((h) => push(paneOfTarget(h.instanceId), labelOf.get(h.instanceId), 'panes'))
  return out
}

/**
 * Menu labels for a set of pane hosts — `QQQ`, `RSI (14)`, `UCTA50`.
 *
 * ⭐ THE SAME TWO RULES THE LEGEND USES, CALLED RATHER THAN RESTATED.
 * `instanceLabel` is what names a chip on the chart, so a pane called `QQQ` in
 * the menu is the pane labelled `QQQ` on screen; `siblingSuffixes` is the
 * existing deterministic tie-break, so two identical QQQ series are `QQQ #1` and
 * `QQQ #2` in both places. `readout.js` already says out loud that these two
 * surfaces "cannot word two copies of one indicator differently" — this is the
 * other surface it meant.
 *
 * ⛔ GROUPED BY THE LABEL THAT COLLIDES, not by definition. Two RSIs with
 * different periods already print `RSI (14)` and `RSI (7)` and need no help; two
 * `dataSeries` on different symbols print `QQQ` and `SPY` and need none either.
 * Only an actual collision is disambiguated, which is why an ordinary chart's
 * menu carries no suffixes at all.
 *
 * ⭐ EXPORTED FOR THE PANE MAP. Chart Data's left column names the same panes
 * this menu names, and naming them twice is how `QQQ #2` in the menu becomes
 * plain `QQQ` in the map that is supposed to explain it. One function, both
 * surfaces — the rule `readout.js` already states for the legend.
 */
export function paneHostLabels(pool, lookup) {
  const labels = disambiguateLabels(pool.map((h) => ({
    defId: h.defId,
    instanceId: h.instanceId,
    inputs: h.inputs || {},
    label: instanceLabel(lookup(h.defId), h),
  })), lookup)
  return new Map(pool.map((h, i) => [h.instanceId, labels[i]]))
}

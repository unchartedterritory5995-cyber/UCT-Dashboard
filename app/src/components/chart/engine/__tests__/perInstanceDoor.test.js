// app/src/components/chart/engine/__tests__/perInstanceDoor.test.js
//
// ─── THE PER-INSTANCE CONTROL DOOR ──────────────────────────────────────────
//
// This file exists because the model change this phase rests on turned out to be
// SMALLER than it looked, and the measurement is what makes it reviewable alone.
//
// Storage, binding and readout have ALWAYS been keyed by `instanceId`: the stored
// list rejects a duplicate `instanceId` and not a duplicate `defId`
// (`instances.validateInstance`), the binder keys on `bindingKey(instanceId,
// plotKey)` (`pool.planBindings`), and the chip resolves inputs per instance.
// Only the WRITE DOOR was per-definition — keyed to `legacyInstanceId(defId)` —
// which is exactly what `setIndicatorEnabled`'s own docstring blames the
// per-definition tombstone on: *"a settings row is per-DEFINITION at v1"*.
//
// So the first three cases below are a PREMISE PROBE, not a feature test. If they
// fail, this phase's dependency order is built on something false and the plan
// must be re-cut rather than patched.
//
// And the last two are the task's real gate: adding four doors must be a provable
// NO-OP for the three that already existed, over every preset × every definition,
// pinned by a digest generated on the tree BEFORE the implementation landed.

import { describe, it, expect } from 'vitest'
import crypto from 'node:crypto'
import { normalizeInstances, validateInstance } from '../instances'
import * as engineRegistry from '../nativeRegistry'
import { planBindings, bindingKey } from '../pool'
import { CHART_DEFAULTS, PRESETS, mergeChartSettings } from '../../chartDefaults'
import {
  findInstance, setInstanceHidden, setInstanceInput, removeInstance, addInstance,
  setIndicatorEnabled, setIndicatorInput, isIndicatorEnabled, removeDefinition, definitionVisibility,
  HIDDEN_VIA_DEFINITION,
} from '../instanceControls'
import { newInstanceId } from '../instances'

describe('the premise: storage and binding are already per-INSTANCE', () => {
  const TWO_RSI = [
    { instanceId: 'legacy:rsi', defId: 'rsi', inputs: { period: 14 }, hidden: false },
    { instanceId: 'inst:rsi:1', defId: 'rsi', inputs: { period: 7 },  hidden: false },
  ]

  it('two instances of ONE definition both survive normalisation', () => {
    const { kept, dropped } = normalizeInstances(TWO_RSI, engineRegistry)
    expect(dropped, 'a duplicate defId was rejected — the premise of this plan is wrong, STOP and report')
      .toEqual([])
    expect(kept.map(i => i.instanceId)).toEqual(['legacy:rsi', 'inst:rsi:1'])
  })

  it('a duplicate instanceId IS rejected — the control that proves the check runs', () => {
    const seenIds = new Set(['legacy:rsi'])
    const res = validateInstance(TWO_RSI[0], engineRegistry, { seenIds })
    expect(res.ok).toBe(false)
    expect(res.errors.join(' ')).toMatch(/duplicate/)
  })

  it('the binder plans TWO separate bindings, keyed by instanceId', () => {
    // ⚠️ `planBindings` returns `{bind, release, reuse}` — NOT the `{desired}` the
    // brief predicted (`pool.js:748`). Adapted WITHOUT weakening the assertion:
    // the two keys must still both be present and still be distinct.
    const { bind } = planBindings(TWO_RSI, engineRegistry, [], {})
    const keys = bind.map(d => d.key)
    expect(keys).toContain(bindingKey('legacy:rsi', 'rsi'))
    expect(keys).toContain(bindingKey('inst:rsi:1', 'rsi'))
    expect(new Set(keys).size, 'two instances collapsed to one binding').toBe(keys.length)
  })
})

const csWith = (instances, indicators = {}) => ({ indicatorInstances: instances, indicators })

describe('the per-INSTANCE door', () => {
  const TWO = () => ([
    { instanceId: 'legacy:rsi', defId: 'rsi', inputs: { period: 14 }, hidden: false },
    { instanceId: 'inst:rsi:1', defId: 'rsi', inputs: { period: 7 },  hidden: false },
  ])

  it('newInstanceId is deterministic and skips a TOMBSTONED id', () => {
    const list = [
      { instanceId: 'inst:rsi:1', defId: 'rsi' },
      { instanceId: 'inst:rsi:2', deleted: true },
    ]
    expect(newInstanceId('rsi', list)).toBe('inst:rsi:3')
    expect(newInstanceId('rsi', list)).toBe('inst:rsi:3')   // pure
  })

  it('setInstanceHidden hides ONE instance and leaves its sibling drawing', () => {
    const next = setInstanceHidden(csWith(TWO()), 'inst:rsi:1', true, engineRegistry)
    const byId = Object.fromEntries(next.indicatorInstances.map(i => [i.instanceId, i]))
    expect(byId['inst:rsi:1'].hidden).toBe(true)
    expect(byId['legacy:rsi'].hidden).toBe(false)
  })

  it('removeInstance tombstones ONE and KEEPS the mirror on while a sibling lives', () => {
    const cs = csWith(TWO(), { rsi: { enabled: true } })
    const next = removeInstance(cs, 'inst:rsi:1', engineRegistry)
    const live = next.indicatorInstances.filter(i => i && i.deleted !== true)
    expect(live.map(i => i.instanceId)).toEqual(['legacy:rsi'])
    expect(next.indicators.rsi.enabled, 'the mirror lied: RSI still draws').toBe(true)
    expect(isIndicatorEnabled(next, 'rsi', { has: () => true })).toBe(true)
  })

  it('…and CLEARS the mirror when the LAST live instance goes', () => {
    let cs = csWith(TWO(), { rsi: { enabled: true } })
    cs = removeInstance(cs, 'inst:rsi:1', engineRegistry)
    cs = removeInstance(cs, 'legacy:rsi', engineRegistry)
    expect(cs.indicators.rsi.enabled).toBe(false)
    expect(isIndicatorEnabled(cs, 'rsi', { has: () => true })).toBe(false)
  })

  it('setInstanceInput writes ONE instance and REFUSES an undeclared key by identity', () => {
    const cs = csWith(TWO())
    const ok = setInstanceInput(cs, 'inst:rsi:1', 'period', 9, engineRegistry)
    expect(findInstance(ok, 'inst:rsi:1').inputs.period).toBe(9)
    expect(findInstance(ok, 'legacy:rsi').inputs.period).toBe(14)
    expect(setInstanceInput(cs, 'inst:rsi:1', 'notAKey', 9, engineRegistry)).toBe(cs)
    expect(setInstanceInput(cs, 'inst:rsi:1', 'period', 7.5, engineRegistry)).toBe(cs)
    expect(setInstanceInput(cs, 'nope', 'period', 9, engineRegistry)).toBe(cs)

    // ⚠️ MEASURED, AND THE BRIEF PREDICTED THE WRONG GUARD. 7.5 above is refused by
    // `coerce` (`Number.isInteger` on an `int` input), NOT by `validateInputValue` — so
    // with only the cases above the whole `validateInputValue` block could be DELETED
    // and every one of them would still pass. What that call uniquely contributes for
    // an `int` is the declared BOUND (`defSchema.js`; rsi.period is `int, min 2,
    // max 100`), so the value that actually reaches it has to be in-type and
    // out-of-range. Both ends, because a one-sided check leaves the other deletable.
    expect(setInstanceInput(cs, 'inst:rsi:1', 'period', 999, engineRegistry),
      'a period above the declared max was stored — `normalizeInstances` DROPS that ' +
      'instance, i.e. the indicator silently disappears on the next paint').toBe(cs)
    expect(setInstanceInput(cs, 'inst:rsi:1', 'period', 1, engineRegistry),
      'a period below the declared min was stored — same disappearance, other end').toBe(cs)
  })

  it('addInstance mints a live instance carrying the DECLARED defaults', () => {
    const cs = csWith([TWO()[0]])
    const next = addInstance(cs, 'rsi', engineRegistry)
    const added = next.indicatorInstances.find(i => i.instanceId === 'inst:rsi:1')
    const declared = engineRegistry.getDefinition('rsi').inputs
      .filter(i => i.default !== undefined)
    expect(added.defId).toBe('rsi')
    expect(added.hidden).toBe(false)
    for (const d of declared) expect(added.inputs[d.key]).toEqual(d.default)
  })

  // A1 (D3): the delete contract moved, unchanged, to `removeDefinition`.
  it('⛔ the per-DEFINITION DELETE door (removeDefinition) still tombstones EVERY instance — unchanged contract', () => {
    const off = removeDefinition(csWith(TWO(), { rsi: { enabled: true } }), 'rsi', engineRegistry)
    expect(off.indicatorInstances.every(i => i.deleted === true || i.defId !== 'rsi')).toBe(true)
    expect(off.indicators.rsi.enabled).toBe(false)
  })

  // ⭐ A1 (D3, owner-approved 2026-10-13): the per-DEFINITION toggle HIDES every instance.
  it('⭐ A1 (D3) — the per-DEFINITION toggle hides EVERY instance, keeps them all, and ON restores byte-identically', () => {
    const cs = csWith(TWO(), { rsi: { enabled: true } })
    const off = setIndicatorEnabled(cs, 'rsi', false, engineRegistry)
    expect(off.indicatorInstances.filter(i => i.deleted === true), 'a hide tombstoned something').toEqual([])
    expect(off.indicatorInstances).toEqual(TWO().map(i => ({ ...i, hidden: true, hiddenVia: HIDDEN_VIA_DEFINITION })))
    expect(off.indicators.rsi.enabled, '⛔ a hide wrote the mirror — it means "exists"').toBe(true)
    expect(isIndicatorEnabled(off, 'rsi', { has: () => true }), 'a hidden instance still exists').toBe(true)
    expect(definitionVisibility(off, 'rsi', { has: () => true }).state).toBe('hidden')
    // ⛔ a second OFF has nothing visible to hide — identity, not a rewrite
    expect(setIndicatorEnabled(off, 'rsi', false, engineRegistry)).toBe(off)
    const on = setIndicatorEnabled(off, 'rsi', true, engineRegistry)
    expect(JSON.stringify(on.indicatorInstances), 'ON did not restore the instances byte for byte')
      .toBe(JSON.stringify(cs.indicatorInstances))
    expect(on.indicators).toEqual(cs.indicators)
  })

  it('⭐ A1 (D3) — an instance the member hid himself is untouched by the definition hide, and gets no marker', () => {
    const mine = [TWO()[0], { ...TWO()[1], hidden: true }]
    const off = setIndicatorEnabled(csWith(mine, { rsi: { enabled: true } }), 'rsi', false, engineRegistry)
    const byId = Object.fromEntries(off.indicatorInstances.map(i => [i.instanceId, i]))
    expect(byId['legacy:rsi']).toEqual({ ...mine[0], hidden: true, hiddenVia: HIDDEN_VIA_DEFINITION })
    expect(byId['inst:rsi:1'], 'the marker leaked onto an instance the definition hide did not hide')
      .toEqual(mine[1])
    // ON restores only what the definition hid
    const on = setIndicatorEnabled(off, 'rsi', true, engineRegistry)
    expect(on.indicatorInstances.map(i => [i.instanceId, i.hidden, 'hiddenVia' in i]))
      .toEqual([['legacy:rsi', false, false], ['inst:rsi:1', true, false]])
  })

  // ⭐⭐ chart-UX-walls TASK 6 — WHY TASK 4's M5 WAS UNKILLABLE, AS AN EQUALITY
  // AND AN INEQUALITY.
  //
  // Task 4 mutated `handleChipRemove` to call `setIndicatorEnabled(defId, false)`
  // instead of `removeInstance(instanceId)` and it SURVIVED the whole suite —
  // correctly, and its report said so rather than fabricating a fixture: with at
  // most ONE instance per definition the two doors produce the same blob, so no
  // test of a product that could not make a second instance could ever tell them
  // apart. This case pins BOTH halves, so the day someone "simplifies" one door
  // into the other the reason is on the page rather than in a report.
  //
  // ⛔ THE BEHAVIOURAL KILL IS NOT HERE, AND CANNOT BE. M5 mutates a handler in
  // `StockChart.jsx`; this file imports no component. It lives in
  // `legendFromDefinitions.test.jsx` (`× on ONE of TWO RSIs leaves the OTHER
  // drawing`), which drives a real chip on a real chart. A case here claiming
  // that kill would be a gate that cannot fail on the mutation it names.
  // A1 (D3): the per-DEFINITION side of this pair is now `removeDefinition` — the toggle
  // hides (pinned in the next case), so the delete-vs-delete equality lives on the door
  // that still deletes. Every assertion is kept.
  it('⭐ removeInstance and removeDefinition DIVERGE the moment TWO instances exist', () => {
    const stable = (cs) => JSON.stringify({
      live: (cs.indicatorInstances || []).filter(i => i && i.deleted !== true).map(i => i.instanceId),
      mirror: cs.indicators && cs.indicators.rsi ? cs.indicators.rsi.enabled : undefined,
    })

    // ── ONE instance: byte-identical, which is the whole reason M5 survived ──
    const one = csWith([TWO()[0]], { rsi: { enabled: true } })
    expect(stable(removeInstance(one, 'legacy:rsi', engineRegistry)),
      'with ONE instance the two doors already disagree — Task 4\'s survivor had a killer all '
      + 'along and its report was wrong about why')
      .toBe(stable(removeDefinition(one, 'rsi', engineRegistry)))

    // ── TWO instances: they must NOT agree ──
    const two = csWith(TWO(), { rsi: { enabled: true } })
    const removed = removeInstance(two, 'inst:rsi:1', engineRegistry)
    const disabled = removeDefinition(two, 'rsi', engineRegistry)
    expect(stable(removed),
      'the per-instance remove and the per-definition toggle STILL produce the same blob on a '
      + 'two-instance chart. `removeInstance` must take the one instance it names; if these are '
      + 'equal, × on one of two RSIs deletes both.')
      .not.toBe(stable(disabled))
    // …and named, so "they differ" cannot be satisfied by differing wrongly.
    expect(removed.indicatorInstances.filter(i => i.deleted !== true).map(i => i.instanceId))
      .toEqual(['legacy:rsi'])
    expect(disabled.indicatorInstances.filter(i => i.deleted !== true)).toEqual([])
    expect(isIndicatorEnabled(removed, 'rsi', { has: () => true })).toBe(true)
    expect(isIndicatorEnabled(disabled, 'rsi', { has: () => true })).toBe(false)
  })

  // ⭐ A1 (D3): and the toggle now diverges from removeInstance even with ONE instance —
  // a hide keeps the instance (and the mirror), the × deletes it.
  it('⭐ A1 (D3) — setIndicatorEnabled(false) diverges from removeInstance even with ONE instance: it keeps it', () => {
    const one = csWith([TWO()[0]], { rsi: { enabled: true } })
    const hidden = setIndicatorEnabled(one, 'rsi', false, engineRegistry)
    expect(hidden.indicatorInstances.filter(i => i.deleted !== true).map(i => [i.instanceId, i.hidden]))
      .toEqual([['legacy:rsi', true]])
    expect(hidden.indicators.rsi.enabled).toBe(true)
    expect(removeInstance(one, 'legacy:rsi', engineRegistry).indicators.rsi.enabled).toBe(false)
  })
})

/** A stable digest of a settings object. `JSON.stringify` with SORTED keys, so
 *  a key-ORDER change (which is invisible to `toEqual`) still moves the number,
 *  and a key added or destroyed by an allow-list cannot hide. */
const digest = (o) => crypto.createHash('sha256')
  .update(JSON.stringify(o, (_k, v) =>
    (v && typeof v === 'object' && !Array.isArray(v))
      ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]]))
      : v))
  .digest('hex')

describe('⭐ the per-DEFINITION doors did not move — an equality, not an opinion', () => {
  // Every preset plus the bare defaults, each read through the REAL merge, then
  // walked through every registered definition with both per-definition doors.
  // A1 (D3): the OFF step is a parameter. The default is the shipped toggle (which now
  // HIDES); `removeDefinition` is the door the pre-A1 OFF moved to verbatim, and the
  // pre-A1 literal is pinned against it below.
  const offViaToggle = (cs, defId) => setIndicatorEnabled(cs, defId, false, engineRegistry)
  const offViaRemove = (cs, defId) => removeDefinition(cs, defId, engineRegistry)
  const corpus = (off = offViaToggle) => {
    const bases = [CHART_DEFAULTS, ...Object.values(PRESETS).map(p => p.settings)]
      .map(b => mergeChartSettings(JSON.stringify(b)))
    const out = []
    for (const base of bases) {
      for (const def of engineRegistry.listDefinitions()) {
        let cs = setIndicatorEnabled(base, def.id, true, engineRegistry)
        out.push(cs)
        const firstNum = (def.inputs || []).find(i => i.type === 'int' && i.default !== undefined)
        if (firstNum) {
          cs = setIndicatorInput(cs, def.id, firstNum.key, firstNum.default + 1, engineRegistry)
          out.push(cs)
        }
        out.push(off(cs, def.id))
      }
    }
    return out
  }

  it('the corpus is not empty and every element is distinct enough to measure', () => {
    const c = corpus()
    expect(c.length, 'an empty corpus proves nothing').toBeGreaterThan(50)
    expect(new Set(c.map(digest)).size, 'every write produced the same blob — the corpus is inert')
      .toBeGreaterThan(10)
  })

  it('⛔ THE LITERAL. Regenerating it instead of investigating is the one thing you may not do', () => {
    // Generated ONCE, on the tree before this task's implementation, by printing
    // `digest(corpus().map(digest).join('|'))`. If it moves, a per-definition
    // door changed behaviour — that is a FINDING, not a number to refresh.
    // 2026-08-12: re-pinned for the additive, default-OFF `compareHideBase` setting
    // ("Group only") added to CHART_DEFAULTS + mergeChartSettings. No per-definition
    // door changed — every corpus blob simply gained `compareHideBase:false`.
    // (Prior value: b73bd284369a0181773fc2c4e487636726f14cb3b1196e35f01f1eaa011303d7)
    // 2026-08-14: re-pinned for the axis-label + dark-pool settings (fd0f43658 /
    // cc945fc64). INVESTIGATED: the CHART_DEFAULTS diff across that batch has
    // ZERO removals — every corpus blob simply gained showPriceLabels:true,
    // showMaLabels:false and darkPool{enabled:false,…}. No per-definition door
    // changed. ⚠️ A genuine finding DID come out of the same batch, in the
    // sibling rail rather than here: `darkPool` was added to CHART_DEFAULTS but
    // not to _OVERRIDE_SECTION_KEYS, so per-chart overrides replaced the whole
    // section instead of merging it (fixed in instanceShape.js).
    // (Prior value: 4cd29324dc8addd6bc54e3f5cbc23bbfcecdc8dc1fea4565d1dcd7eba5ae95f6)
    // 2026-08-16: re-pinned for `header.legendMode` (the on-chart legend's
    // Always / On click / Off mode). INVESTIGATED BY MEASUREMENT rather than by
    // eyeballing the diff: a throwaway rail rebuilt THIS corpus with
    // `header.legendMode` — and only that key — stripped from every base blob,
    // and reproduced the prior literal EXACTLY. So no per-definition door
    // changed behaviour; each corpus blob simply gained one additive key.
    // ⚠️ The sibling trap from the 8/14 batch was checked and does NOT apply:
    // the new key lives inside `header`, which is already in
    // `instanceShape.js::_OVERRIDE_SECTION_KEYS`, so a per-chart override merges
    // the header section instead of replacing it and a grid cell cannot drop the
    // user's mode.
    // 2026-08-16 (second move, same day): the legend DEFAULT flipped 'always' ->
    // 'click'. A VALUE change to the key the previous re-pin added, not a new key.
    // INVESTIGATED BY MEASUREMENT again: rebuilding this corpus with
    // `header.legendMode` stripped reproduces the PRE-FEATURE literal exactly, so
    // no per-definition door changed behaviour.
    // ⭐ 2026-08-17 — RESTORED TO THE PRE-FEATURE LITERAL. Both moves above came
    // from the merge stamping a resolved `legendMode` into every blob; it now
    // carries only an explicit choice, so a default blob is byte-identical to
    // what it was before the feature. This rail coming home is the proof.
    // ⭐ 2026-08-20 — re-pinned for this day's chart-settings additions: (1)
    // `markers.ipo` + `markers.ipoColor` (IPO badge); (2) `crosshair.enabled: true`
    // (crosshair on/off toggle); (3) `watermark.weight: 700` (watermark weight).
    // All are ordinary additive default fields (same class as `markers.earnings` /
    // `crosshair.magnet` / `watermark.sizeScale`), so the corpus digest shifts by
    // exactly those keys. INVESTIGATED, not regenerated: no per-definition door
    // changed behaviour.
    // A1 (D3, owner-approved 2026-10-13): the definition door hides; the old literal now holds for removeDefinition
    expect(digest(corpus(offViaRemove).map(digest).join('|')))
      // 2026-08-24: re-pinned for the graphite default palette retune — color
      // VALUE edits only (candles/volume/earnings → app --gain/--loss, canvas →
      // graphite #17181a); zero keys added/removed, structure byte-identical.
      // 2026-08-24: re-pinned for the per-MA `onTop` z-order setting — each of the
      // five overlays gains one additive default-off key `onTop:false` (behind the
      // candles = prior behavior); nothing else moves.
      // 2026-08-27: re-pinned for the owner default-chart retune — the terminal SMA5
      // overlay was REMOVED (default set 5→4) and the watermark went sizeScale 1.0→1.25
      // + weight 700→500. Value/structure edits to CHART_DEFAULTS only; no
      // per-definition door changed behaviour. INVESTIGATED, not regenerated.
      // 2026-09-14: re-pinned for `dataSeries` (P2.1) — a REGISTRY ADDITION, not a
      // door change. `corpus()` walks `listDefinitions()`, so an eighteenth
      // definition adds two elements per base and the digest necessarily moves.
      // ⛔ INVESTIGATED, NOT REGENERATED, and here is the measurement: the corpus
      // rebuilt with `dataSeries` SKIPPED digests to
      // `a737b2eb1ac8ae684fe2b6279eaafbadf60a242b6f54c86eb472524b110e6f1b` — the
      // previous pin, byte for byte. Every pre-existing definition's enable /
      // input / disable blobs are therefore untouched, and the only difference is
      // the new definition's own elements. `dataSeries` declares no `int` input,
      // so it contributes the enable and disable elements and no third.
      // 2026-09-14: re-pinned for `movingAverage` — a REGISTRY ADDITION, not a door
      // change, exactly like `dataSeries` above. ⛔ INVESTIGATED, NOT REGENERATED:
      // the corpus rebuilt with `movingAverage` SKIPPED digests to
      // `6db73b47e8ae168b0b7fddbc718825f497a0ead6e6c98faae8b610d6e6147643` — the
      // previous pin, byte for byte — so every pre-existing definition's
      // enable/input/disable blobs are untouched. It contributes THREE elements
      // per base rather than two, because unlike `dataSeries` it declares an `int`
      // input (`period`) and the corpus exercises one.
      // 2026-09-15: re-pinned for `paneOrder` — the visual pane arrangement.
      // ⛔ INVESTIGATED, NOT REGENERATED: this corpus serialises whole
      // chart-settings blobs, so it moves with any change to the canonical shape.
      // The shape diff was taken independently on both trees (see the matching
      // note in `alertSets.test.js`): exactly one ADDITIVE key, `paneOrder: []`,
      // nothing removed, no existing value changed — 40 keys → 41. The
      // per-DEFINITION doors this file is about (enable · input · disable) are
      // untouched; what moved is the blob each of them is embedded in.
      // 2026-09-15: re-pinned again for `paneSizes` — the member's chosen pane
      // heights. ⛔ INVESTIGATED, NOT REGENERATED, by the same method: the key
      // sets were enumerated on this tree and on HEAD before the change, and the
      // diff is exactly one ADDITIVE key, `paneSizes: {}` — 41 keys → 42, nothing
      // removed, no existing value changed. The per-DEFINITION doors are again
      // untouched; what moved is the blob they are embedded in.
      // 2026-09-15: re-pinned for DISPLAY-TARGET PROVENANCE. `placementFor` no
      // longer stamps a RESTATEMENT of the definition's declared target onto every
      // instance it creates — that byte expressed no user intent and could not be
      // told apart from one that did, which is the ambiguity
      // `displayTarget.TARGET_EXPLICIT` exists to end.
      // ⛔ INVESTIGATED BY MEASUREMENT, NOT REGENERATED. The corpus was dumped from
      // BOTH trees (this one and a clean worktree at the pre-change commit) and
      // diffed structurally. The result:
      //
      //     175 removed `"placement": {` blocks — 100 `"target": "pane"`,
      //                                           75 `"target": "price"`
      //       0 ADDED LINES OF ANY KIND
      //
      // Every removal is a restatement and nothing else moved: no destination
      // changed (the resolver reaches the identical answer with the key absent,
      // via step (3) `return declared`), no `volume` rewrite was dropped (that one
      // is KEPT — it differs from the declaration and `presentation.availableStyles`
      // reads the stored field), and NO marker appears anywhere in the default
      // corpus, which is the §20 promise that a schema gaining a field must not
      // churn every saved chart. No per-definition door changed behaviour.
      // (Prior value: a6a030675093753839f67f0a3702b4a2bd947cd73b430119badf49787065261f)
      // 2026-09-16: re-pinned for `dollarVolume` — a REGISTRY ADDITION, not a door
      // change, exactly like `dataSeries` and `movingAverage` above.
      // ⛔ INVESTIGATED, NOT REGENERATED, by the same measurement: the corpus
      // rebuilt with `dollarVolume` SKIPPED digests to
      // `e43a0f1f2e9469941fa3b42f2a584648ad397d9c672ce5b4adc385ee96e8a3cd` — the
      // previous pin, byte for byte — so every pre-existing definition's
      // enable/input/disable blobs are untouched. It contributes TWO elements per
      // base (280 vs 270 over five bases), not three, because it declares no `int`
      // input: dollar volume is `volume × close` and has nothing to parameterise.
      // (Prior value: e43a0f1f2e9469941fa3b42f2a584648ad397d9c672ce5b4adc385ee96e8a3cd)
      // 2026-09-16: re-pinned again, for `CHART_DEFAULTS.volume.maPeriod` 50 → 0 —
      // the automatic 50-day volume moving average the owner's §16 removes. A
      // DEFAULT VALUE edit, not a door change and not a key change.
      // ⛔ INVESTIGATED BY MEASUREMENT, NOT REGENERATED. The corpus was rebuilt with
      // `volume.maPeriod` forced back to 50 in every base and NOTHING else altered;
      // it digests to
      // `78107b0d261ec5dc0d4eaa59918be586245d044b450f89fa7d6cf9b1855d9fc7` — the
      // previous pin, byte for byte. So the one moving part is that value: no key
      // was added or removed, and no per-definition door behaves differently.
      // (Prior value: 78107b0d261ec5dc0d4eaa59918be586245d044b450f89fa7d6cf9b1855d9fc7)
      // 2026-09-17: re-pinned for `CHART_DEFAULTS.paneSeriesOrder` — a KEY ADDED to
      // the merge allow-list so a member's within-pane series order survives a
      // reload (`engine/paneSeriesOrder.js`). Not a door change and not a value
      // change to anything that existed.
      // ⛔ INVESTIGATED BY MEASUREMENT, NOT REGENERATED. The merged blob was dumped
      // key-by-key on this tree and on the tree with `chartDefaults.js` reverted,
      // and the two dumps diffed: ONE added line (`paneSeriesOrder = {}`), zero
      // removed, zero changed values — 42 merged keys before, 43 after. Every
      // per-definition door's enable/input/disable blob therefore carries exactly
      // one more empty object and is otherwise byte-identical, and `{}` is "no
      // preference": `resolvePaneSeriesOrder` returns the incoming order untouched.
      // (Prior value: 596ff356bbd69685a073971857eb1876e6c1d9eb62ca715202dc4dffe28cea16)
      // 2026-09-28: re-pinned for `maAdoption.js` (the four default averages are
      // adopted as `ovl:<i>` `movingAverage` instances on every read).
      // ⛔ INVESTIGATED BY MEASUREMENT, NOT REGENERATED. The 280-blob corpus was
      // dumped on this tree and on a clean worktree at 38bb9a421 (which reproduces
      // the previous pin exactly) and diffed: ADDED ONLY — 1,120 adopted entries
      // (1,100 live averages, 4 per blob, plus 20 tombstones), each slot gaining
      // `removed`/`adopted`; ZERO removed or changed lines. The 20 tombstones are
      // the `movingAverage:off` step: the per-DEFINITION door turns every average
      // off, defaults included — which is why `movingAverage` is now `addOnly` and
      // `IndicatorLibraryDialog.toggledRow` never calls that door for it. No other
      // definition's enable/input/disable blob changed beyond carrying the averages.
      // (Prior value: a2d35dcafd3067f47fb03804ece00dd727c1eba27e2204cdbeb02132a93a4a4d)
      // 2026-10-01: re-pinned for SLOW STOCHASTIC — `stoch` gained `smoothK`
      // (declared default 1 = the shipped FAST stochastic, so an absent key keeps
      // every saved instance's meaning) and `meta.createInputs: { smoothK: 3 }`,
      // which the add doors write onto a NEW instance.
      // ⛔ INVESTIGATED BY MEASUREMENT, NOT REGENERATED. The corpus rebuilt on this
      // tree with ONLY `createInputs` switched off (the new input still declared)
      // digests to `4ca66180df6f662a4b874a7e42770c6a9115695bd10a6091aed73a3d3a990474`
      // — the previous pin, byte for byte. So the one moving part is the `stoch`
      // enable door writing `smoothK: 3` onto the instance it creates, and no
      // other door moved.
      // (Prior value: 4ca66180df6f662a4b874a7e42770c6a9115695bd10a6091aed73a3d3a990474)
      // 2026-10-01 (second move, same branch): re-pinned for the Technical
      // library's thirty-three Tier 1 definitions — a REGISTRY ADDITION, not a door
      // change, exactly like `dataSeries`/`movingAverage`/`dollarVolume` above.
      // ⛔ INVESTIGATED BY MEASUREMENT, NOT REGENERATED: the corpus rebuilt with
      // the thirty-three SKIPPED (filtered by `tier1Library.fixture.TIER1_IDS`)
      // digests to `c731ccbbfb1024c2b9520ce5746545c514817409e159cca5fe925bb622778611`
      // — the previous pin, byte for byte — so every pre-existing definition's
      // enable/input/disable blobs are untouched, Session VWAP's new `bands` enum
      // included (an enum is not the `int` this corpus exercises).
      // (Prior value: c731ccbbfb1024c2b9520ce5746545c514817409e159cca5fe925bb622778611)
      // 2026-10-10: re-pinned for `CHART_DEFAULTS.breadthChartType` (the breadth chart type,
      // separate from `chartType`). ⛔ INVESTIGATED BY MEASUREMENT: with chartDefaults.js alone
      // reverted the corpus digests to the previous pin; the corpus spreads CHART_DEFAULTS, so
      // the one moving part is the new default key on every base — no door moved.
      // (Prior value: 8469f829356dab8ef6448a35ecac1ad59eb8c69686c0a7ec686652d13b2ddbd5)
      // 2026-10-25: re-pinned for 96194c642c (`positionCalc.accountSize` default 50,000 →
      // the one unset account size, 100,000; it left this rail red on master). ⛔ INVESTIGATED
      // BY MEASUREMENT: both corpora were dumped (sorted keys) with and without only that
      // default put back to 50000 and diffed — 760 elements each, CHANGED ONLY
      // `positionCalc.accountSize`, 0 added, 0 removed; with it put back this literal and
      // the A1 literal below reproduce byte-for-byte. The corpus spreads CHART_DEFAULTS;
      // no door moved.
      // (Prior value: 6f7743de23fdad1681d202f328898691c2d7151c59787de818b125cbb1fd45be)
      // 2026-11-07: re-pinned for the UCT RS v2/v3 work on `rsLine`, commits d49ec576b4
      // (RS v2, Phase 1 unit 2) .. edd674016f (rsLine v3, 2a-14), on feat/uct-rs-phase1 →
      // feat/uct-rs-phase2a (measured at 9b7e58ce3b). It left this rail and the A1 literal
      // red on both branches. ⛔ INVESTIGATED BY MEASUREMENT, NOT REGENERATED: both corpora
      // were dumped element by element (labelled base|def|step, sorted keys) on this tree
      // and with app/src checked out at ab9693d50b (the parent of d49ec576b4), which
      // reproduces this literal and the A1 literal byte for byte, and diffed. 760 elements
      // each; 745 byte-identical; the 15 that differ are EXACTLY rsLine's on/input/off in
      // each of the five bases, and nothing else in them moved:
      //   · `indicatorInstances[].defVersion` 1 → 3 — the definition's own `version`
      //     (v2 at d49ec576b4, v3 at edd674016f);
      //   · the INPUT step exercises a different key: the corpus bumps the FIRST `int`
      //     input with a default, which was `lineWidth` (1 → 2) and is now the new
      //     `maLength` (21 → 22, declared ahead of it by d49ec576b4). So
      //     `indicators.rsLine.lineWidth: 2` and `inputs.lineWidth: 2` are gone and
      //     `indicators.rsLine.maLength: 22` / `inputs.maLength: 22` arrived in their
      //     place, on the input and off elements.
      // No other definition's enable/input/disable blob changed and no CHART_DEFAULTS key
      // moved — rsLine's own intended change (new inputs, new version), no door moved.
      // (Prior value: 1caded5378e5fe9ae49615e5a953112103fe524e925967b543876d646e0df70e)
      // 2026-11-07: re-pinned for UCT RS v4 (Phase 3 unit 3-08), MEASURED: the corpus
      // rebuilt with every rsLine instance's `defVersion` mapped 4 → 3 (and nothing else
      // touched) digests to the prior value 8ed70382… byte for byte. 15 of 760 elements
      // differ, exactly rsLine's on/input/off in each of the five bases, and only in
      // `defVersion` (the definition's own `version`). The first `int` input is still
      // `maLength` (the new inputs are declared after it), so the input step did not move.
      // No door moved. (Prior value: 8ed703821a52dc3b1c7bc9c404cffdb6b0eee41685fa31238dcaafcb40727735)
      // 2026-11-08: re-pinned for rsLine rev 5 (Deepvue round 2, the RS Rating Reading),
      // MEASURED the same way: every rsLine instance's `defVersion` mapped 5 → 4 (nothing
      // else touched) digests to the prior value f53b16f1… byte for byte. The elements that
      // differ are rsLine's own and only in `defVersion`; the first `int` input is still
      // `maLength`. No door moved. (Prior value: f53b16f12b19922f82c8159640a351296031b5d9e81a0b993cbd686b3180d0d4)
      // 2026-11-10: re-pinned for the UCT RS split (U6 + U7), a REGISTRY ADDITION, not a door
      // change. ⛔ INVESTIGATED BY MEASUREMENT, NOT REGENERATED: the corpus walks
      // `listDefinitions()` (56 definitions now). Rebuilt with `rsRating`, `rsPhases` and
      // `rsVsEma` SKIPPED it digests to the prior value c922cb55… byte for byte (and the
      // toggle corpus to dff12cc1… below), so every pre-existing definition's blobs, rsLine's
      // slim/V5 pair included, are untouched. The three add 40 of the 800 elements
      // (5 bases x [rsRating 3 + rsPhases 3 + rsVsEma 2]): rsRating and rsPhases each declare
      // an `int` input (on/input/off), rsVsEma declares none (on/off). No door moved.
      // (Prior value: c922cb55165e84ffece9fb0ec6f4618c4b5645062de946c825a588a3eef41832)
      // 2026-11-12: re-pinned for UCT RS Exit Warnings (`rsExit`), a REGISTRY ADDITION again, not a
      // door change. ⛔ INVESTIGATED BY MEASUREMENT, NOT REGENERATED: this whole file copied with
      // `rsExit` filtered out of every `listDefinitions()` walk reproduces the prior literal below
      // (49d9202e…) and the toggle corpus's (5e2845d4…) byte for byte, 18 of 18 cases green, so every
      // pre-existing definition's blobs are untouched. The new definition adds 15 elements
      // (5 bases x 3: it declares `int` inputs, so on / input / off). No door moved.
      // (Prior value: 49d9202ed0712dc3e31489061a997cad71a3a5d5a6bc94fda9206182900ae2c3)
      .toBe('991ca84cc84c67ab14dca0ad77a18baba47d78b79d031ef9aae3e3337cf43e4d')
  })

  // ⭐ A1 (D3, owner-approved 2026-10-13): the definition door hides; the old literal now
  // holds for removeDefinition (above). The NEW literal below was not regenerated blind —
  // it is DERIVED first: the two corpora must agree on every ON and INPUT element, and
  // every OFF element must equal its predecessor with each live, visible instance of that
  // definition marked `{hidden: true, hiddenVia: 'definition'}` and nothing else moved
  // (no tombstone, no mirror write, no sever).
  it('⭐ A1 (D3) — the toggle\'s OFF is exactly "hide every visible instance", element by element', () => {
    const hidden = corpus()
    const removed = corpus(offViaRemove)
    expect(hidden.length).toBe(removed.length)
    const hideOf = (prev, defId) => ({
      ...prev,
      indicatorInstances: prev.indicatorInstances.map(i => (
        i && i.deleted !== true && i.defId === defId && i.hidden !== true
          ? { ...i, hidden: true, hiddenVia: HIDDEN_VIA_DEFINITION } : i)),
    })
    let k = 0
    let offs = 0
    for (let b = 0; b < 1 + Object.values(PRESETS).length; b++) {
      for (const def of engineRegistry.listDefinitions()) {
        const hasInput = (def.inputs || []).some(i => i.type === 'int' && i.default !== undefined)
        for (let s = 0; s < (hasInput ? 2 : 1); s++, k++) {
          expect(digest(hidden[k]), `${def.id}: an ON/INPUT element moved — only OFF may`).toBe(digest(removed[k]))
        }
        const prev = hidden[k - 1]
        const off = hidden[k]
        expect(digest(off), `${def.id}: OFF is not exactly a definition hide of its predecessor`)
          .toBe(digest(hideOf(prev, def.id)))
        expect(off.indicators[def.id].enabled, `${def.id}: a hide wrote the mirror`).toBe(true)
        // ⛔ a marker only ever sits on a HIDDEN instance
        expect(off.indicatorInstances.filter(i => i && i.hiddenVia && i.hidden !== true), def.id).toEqual([])
        offs++
        k++
      }
    }
    expect(k).toBe(hidden.length)
    expect(offs, 'no OFF element was checked').toBeGreaterThan(50)
  })

  it('⛔ THE LITERAL (A1) — the shipped toggle\'s corpus', () => {
    // A1 (D3, owner-approved 2026-10-13): the definition door hides; the old literal now holds for removeDefinition
    // DERIVED, NOT REGENERATED: the case above proves this corpus differs from the
    // removeDefinition one ONLY in its OFF elements, each of which is a pure hide.
    // Measured 2026-10-13 only AFTER that case passed and `corpus(offViaRemove)` reproduced
    // the prior literal (6f7743de…) byte for byte.
    // 2026-10-25: re-pinned with the literal above for 96194c642c (accountSize default only;
    // same measurement, same 760-element diff). The element-by-element case above still
    // holds, so the toggle corpus still differs from the removeDefinition one ONLY in its
    // OFF elements. (Prior value: 8ab5b272734563f15dd707eed76d45ea5527049ec3643a84db9523ac67e96063)
    // 2026-11-07: re-pinned with the literal above for the UCT RS v2/v3 work on `rsLine`
    // (d49ec576b4 .. edd674016f; same measurement, ab9693d50b reproduces this prior value
    // byte for byte). The toggle corpus diff is the same 15 rsLine elements and nothing
    // else: `defVersion` 1 → 3, and the input step's key `lineWidth: 2` → `maLength: 22`
    // (the first `int` input is now `maLength`). The element-by-element case above still
    // holds. (Prior value: 529f4941433a715525eca6c42b09a12b6a5f18bd9e734f6dcce5946cfaa5206d)
    // 2026-11-07: re-pinned for UCT RS v4 (unit 3-08), same measurement as the literal
    // above: rsLine's `defVersion` mapped 4 → 3 reproduces the prior value 6145e093…
    // byte for byte; the same 15 rsLine elements, `defVersion` only. The element-by-element
    // case above still holds. (Prior value: 6145e093a600d556527856f1bf3db6c97d9e9a100ad2cf3dee606a309af2a8ee)
    // 2026-11-08: re-pinned for rsLine rev 5 (Deepvue round 2), same measurement: `defVersion`
    // mapped 5 → 4 on the 15 rsLine elements reproduces the prior value 07ee0bff… byte for
    // byte. (Prior value: 07ee0bff1d2a3c05259dfe63c94fac2685a90b188475cb769ffd18e7a3b901ec)
    expect(digest(corpus().map(digest).join('|')))
      // 2026-11-10: re-pinned for the UCT RS split (U6 + U7); see the literal above: the
      // toggle corpus with the three new ids skipped reproduces the prior value byte for byte.
      // (Prior value: dff12cc182d3d17c16617670e436bdc1aa8ef7258f460d64cde42972c39544d0)
      // 2026-11-12: re-pinned for UCT RS Exit Warnings; see the literal above: the toggle corpus with
      // `rsExit` skipped reproduces the prior value (5e2845d4…) byte for byte.
      // (Prior value: 5e2845d4ae574e4f822a053e2945b0c24a6fc11b8e4af345aa88803722ebe894)
      .toBe('51d51f70fbe2fe4cb2ac0ca7a5440c38d1e1345a81a7c518fd9bc57dc9c4623f')
  })
})

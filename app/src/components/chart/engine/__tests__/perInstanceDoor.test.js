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
  setIndicatorEnabled, setIndicatorInput, isIndicatorEnabled,
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

  it('⛔ the per-DEFINITION door still tombstones EVERY instance — unchanged contract', () => {
    const off = setIndicatorEnabled(csWith(TWO(), { rsi: { enabled: true } }), 'rsi', false, engineRegistry)
    expect(off.indicatorInstances.every(i => i.deleted === true || i.defId !== 'rsi')).toBe(true)
    expect(off.indicators.rsi.enabled).toBe(false)
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
  it('⭐ removeInstance and setIndicatorEnabled(false) DIVERGE the moment TWO instances exist', () => {
    const stable = (cs) => JSON.stringify({
      live: (cs.indicatorInstances || []).filter(i => i && i.deleted !== true).map(i => i.instanceId),
      mirror: cs.indicators && cs.indicators.rsi ? cs.indicators.rsi.enabled : undefined,
    })

    // ── ONE instance: byte-identical, which is the whole reason M5 survived ──
    const one = csWith([TWO()[0]], { rsi: { enabled: true } })
    expect(stable(removeInstance(one, 'legacy:rsi', engineRegistry)),
      'with ONE instance the two doors already disagree — Task 4\'s survivor had a killer all '
      + 'along and its report was wrong about why')
      .toBe(stable(setIndicatorEnabled(one, 'rsi', false, engineRegistry)))

    // ── TWO instances: they must NOT agree ──
    const two = csWith(TWO(), { rsi: { enabled: true } })
    const removed = removeInstance(two, 'inst:rsi:1', engineRegistry)
    const disabled = setIndicatorEnabled(two, 'rsi', false, engineRegistry)
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
  const corpus = () => {
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
        out.push(setIndicatorEnabled(cs, def.id, false, engineRegistry))
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
    expect(digest(corpus().map(digest).join('|')))
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
      .toBe('596ff356bbd69685a073971857eb1876e6c1d9eb62ca715202dc4dffe28cea16')
  })
})

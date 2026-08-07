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
    expect(digest(corpus().map(digest).join('|')))
      .toBe('b73bd284369a0181773fc2c4e487636726f14cb3b1196e35f01f1eaa011303d7')
  })
})

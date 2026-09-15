// app/src/components/chart/engine/__tests__/displayTargetProvenance.test.js
//
// ─── "DID A MEMBER CHOOSE THIS?" IS A STORED FACT, NOT AN INFERENCE ─────────
//
// ⚰️⚰️ `declared` WAS DOING TWO JOBS AND THEY CONFLICT. It is the FALLBACK for a
// source that derives nothing — `derivedTargetFor` answers null for
// `kind: 'symbol'`, so `sym:QQQ:close` falls through to the declaration, and that
// is the only thing sending a foreign series to its own pane — and it was ALSO
// the sentinel the resolver used to decide whether a stored target meant
// anything (`explicit !== declared`).
//
// ⛔ MEASURED 2026-09-15, WHICH IS WHY RE-DECLARING WAS REJECTED. A member wants
// both directions on ONE definition:
//
//     dataSeries + close     automatic = price   → wants 'pane'   ⇒ declared ≠ 'pane'
//     dataSeries + sym:QQQ   automatic = pane    → wants 'price'  ⇒ declared ≠ 'price'
//
// No value of the declaration satisfies both. The ambiguity is not in the
// declaration, it is in the STORED BYTE — `{target:'pane'}` on a close series is
// either a creation restatement or a member's choice, and the blob does not say
// which. So provenance is RECORDED rather than inferred.
//
// ⭐⭐ AND NOTHING IS MIGRATED. Absent marker = legacy state, read by exactly the
// old rule, so every chart saved before today reconstructs to the destination it
// always did. The OLD-A..D block below is that promise, and OLD-A is the precise
// regression that killed the re-declaration experiment.

import { describe, it, expect } from 'vitest'
import * as registry from '../nativeRegistry'
import { addInstance, setInstanceDisplayTarget } from '../instanceControls'
import { resolveDisplayTarget, paneOwnKeys, paneFollowerKeys,
         TARGET_EXPLICIT, hasExplicitTarget } from '../displayTarget'
import { resolvePaneOrder, setPaneOrder, PRICE_PANE, VOLUME_PANE } from '../paneOrder'
import { defaultPaneKeys } from '../paneLayout'
import { normalizeInstances } from '../instances'

const QQQ = 'sym:QQQ:close'
const insts = (cs) => (Array.isArray(cs.indicatorInstances) ? cs.indicatorInstances : [])
const inst = (cs, id) => insts(cs).find((i) => i.instanceId === id)
const where = (cs, id) => resolveDisplayTarget(inst(cs, id), cs)
const setSrc = (cs, id, source) => ({
  ...cs,
  indicatorInstances: insts(cs).map((i) => (i.instanceId === id
    ? { ...i, inputs: { ...i.inputs, source } } : i)),
})

/** A chart carrying one data series, built the way the product builds it. */
function series(source) {
  const cs = addInstance({ indicatorInstances: [] }, 'dataSeries', registry)
  const id = insts(cs)[0].instanceId
  return [source === 'close' ? cs : setSrc(cs, id, source), id]
}

/** RSI + an MA reading it — the critical regression, built canonically. */
function maOnRsi() {
  let cs = addInstance({ indicatorInstances: [] }, 'rsi', registry)
  const rsi = insts(cs)[0].instanceId
  cs = addInstance(cs, 'movingAverage', registry)
  const ma = insts(cs).find((i) => i.defId === 'movingAverage').instanceId
  return [setSrc(cs, ma, `@${rsi}::rsi`), ma, rsi]
}

// ⛔ A REAL ROUND TRIP, NOT AN IN-MEMORY HANDOFF (§13). JSON is what persistence
// actually does to a blob, and `normalizeInstances` is what reads it back — the
// validator that DROPS an instance it dislikes, which is the failure mode a
// resolver-only test cannot see.
function reconstruct(cs) {
  const blob = JSON.parse(JSON.stringify(cs))
  const { kept, dropped } = normalizeInstances(blob.indicatorInstances, registry)
  // ⛔ A DROP IS A FAILURE, NOT A DETAIL. The validator rejecting the new key
  // would delete the member's series on the next load — silently, which is the
  // one failure shape this engine refuses. Surface the reason if it ever happens.
  if (dropped.length) throw new Error(`validator dropped: ${JSON.stringify(dropped)}`)
  return { ...blob, indicatorInstances: kept }
}

describe('⭐ §11 A–B — automatic destinations, with nothing stored', () => {
  it('A: a new Data Series on primary Close draws on PRICE', () => {
    const [cs, id] = series('close')
    expect(where(cs, id)).toBe('price')
    expect(paneOwnKeys(insts(cs), cs).has(id), 'it took a pane it does not own').toBe(false)
  })

  it('B: a new Data Series on QQQ gets its OWN PANE', () => {
    const [cs, id] = series(QQQ)
    expect(where(cs, id)).toBe('pane')
    expect(paneOwnKeys(insts(cs), cs).has(id)).toBe(true)
  })

  it('⛔ §9/§20 neither one is born carrying a destination', () => {
    // The restatement is the ambiguity. A chart that has never been arranged must
    // not contain a byte that a later reader could mistake for a decision.
    const [cs, id] = series('close')
    expect(inst(cs, id).placement, 'a new instance was stamped with a target').toBeUndefined()
  })
})

describe('⚰️⚰️ §11 C–D — the two overrides, one of which was IMPOSSIBLE', () => {
  it('C: Close to Own pane is honoured, though it EQUALS the declaration', () => {
    const [cs0, id] = series('close')
    const cs = setInstanceDisplayTarget(cs0, id, 'pane', registry)
    expect(inst(cs, id).placement).toEqual({ target: 'pane', [TARGET_EXPLICIT]: true })
    expect(hasExplicitTarget(inst(cs, id))).toBe(true)
    // ⚰️ THE BUG: `dataSeries` declares `'pane'`, so the old `explicit !== declared`
    // guard threw this exact value away and the member's pane never appeared.
    expect(where(cs, id), 'the Own pane choice was ignored again').toBe('pane')
    expect(paneOwnKeys(insts(cs), cs).has(id), 'no pane was realised for it').toBe(true)
  })

  it('D: QQQ to Price is honoured', () => {
    const [cs0, id] = series(QQQ)
    const cs = setInstanceDisplayTarget(cs0, id, 'price', registry)
    expect(where(cs, id)).toBe('price')
    expect(paneOwnKeys(insts(cs), cs).has(id)).toBe(false)
  })
})

describe('⛔⛔ §11 E–F — MA(RSI), the critical regression', () => {
  it('E: with nothing stored it FOLLOWS RSI', () => {
    const [cs, ma, rsi] = maOnRsi()
    expect(where(cs, ma)).toBe(`@${rsi}`)
    expect(paneOwnKeys(insts(cs), cs).has(ma), 'the MA took a pane of its own').toBe(false)
  })

  it('F: and an explicit Price now sticks — it could not before', () => {
    const [cs0, ma] = maOnRsi()
    const cs = setInstanceDisplayTarget(cs0, ma, 'price', registry)
    // `movingAverage` DECLARES `'price'`, so this too equals the declaration and
    // the old guard discarded it — the MA snapped back into RSI's pane.
    expect(where(cs, ma)).toBe('price')
  })
})

describe('⭐ §11 G — return to automatic clears BOTH keys', () => {
  it('C, D and F each hand the instance back to the rules', () => {
    const [c0, cId] = series('close')
    const c = setInstanceDisplayTarget(setInstanceDisplayTarget(c0, cId, 'pane', registry), cId, 'price', registry)
    expect(inst(c, cId).placement, 'a spent override was left behind').toBeUndefined()
    expect(where(c, cId)).toBe('price')

    const [d0, dId] = series(QQQ)
    const d = setInstanceDisplayTarget(setInstanceDisplayTarget(d0, dId, 'price', registry), dId, 'pane', registry)
    expect(inst(d, dId).placement).toBeUndefined()
    expect(where(d, dId)).toBe('pane')

    const [f0, ma, rsi] = maOnRsi()
    const f = setInstanceDisplayTarget(setInstanceDisplayTarget(f0, ma, 'price', registry), ma, `@${rsi}`, registry)
    expect(inst(f, ma).placement, 'MA(RSI) kept a marker after returning to automatic').toBeUndefined()
    expect(where(f, ma)).toBe(`@${rsi}`)
  })
})

describe('⚰️⚰️ §12 — LEGACY BLOBS RECONSTRUCT EXACTLY AS THEY DO TODAY', () => {
  // ⛔ NO MARKER ANYWHERE IN THIS BLOCK. These are the shapes already sitting in
  // members' saved charts, and the whole no-migration promise is that the new
  // reader does not touch a single one of their destinations.
  const legacy = (defId, source, target, extra) => ({
    indicatorInstances: [{
      instanceId: `inst:${defId}:1`, defId, defVersion: 1,
      inputs: { ...(source === undefined ? {} : { source }), ...(extra || {}) },
      placement: { target }, hidden: false,
    }],
  })

  it('OLD-A: close + target:"pane" still draws on PRICE', () => {
    // ⚰️ THE EXACT REGRESSION THAT KILLED THE RE-DECLARATION. Every Data Series
    // ever created carries this byte as a creation restatement; reading it as a
    // choice would move every one of them into its own pane on load.
    const cs = legacy('dataSeries', 'close', 'pane')
    expect(where(cs, 'inst:dataSeries:1'), 'existing charts moved on load').toBe('price')
  })

  it('OLD-B: QQQ + target:"pane" still gets its own pane', () => {
    expect(where(legacy('dataSeries', QQQ, 'pane'), 'inst:dataSeries:1')).toBe('pane')
  })

  it('OLD-C: MA(RSI) + a "price" restatement still FOLLOWS RSI', () => {
    const cs = {
      indicatorInstances: [
        { instanceId: 'inst:rsi:1', defId: 'rsi', inputs: {}, placement: { target: 'pane' }, hidden: false },
        { instanceId: 'inst:movingAverage:1', defId: 'movingAverage',
          inputs: { source: '@inst:rsi:1::rsi', period: 5, maType: 'sma' },
          placement: { target: 'price' }, hidden: false },
      ],
    }
    expect(where(cs, 'inst:movingAverage:1')).toBe('@inst:rsi:1')
  })

  it('OLD-D: a genuine legacy override (explicit differs from declared) is PRESERVED', () => {
    // ⛔ THE OTHER DIRECTION OF THE SAME PROMISE. Old charts that DID express a
    // choice must not lose it because the new marker is absent from them.
    const cs = legacy('rsi', undefined, 'price')
    expect(where(cs, 'inst:rsi:1'), 'a legitimate old choice was erased').toBe('price')
  })
})

describe('⛔ §13 — save, reconstruct, same destination', () => {
  const cases = () => {
    const [c0, cId] = series('close')
    const [d0, dId] = series(QQQ)
    const [f0, ma] = maOnRsi()
    return [
      ['C close to Own pane', setInstanceDisplayTarget(c0, cId, 'pane', registry), cId, 'pane'],
      ['D QQQ to Price', setInstanceDisplayTarget(d0, dId, 'price', registry), dId, 'price'],
      ['F MA(RSI) to Price', setInstanceDisplayTarget(f0, ma, 'price', registry), ma, 'price'],
    ]
  }

  for (const [name, cs, id, expected] of cases()) {
    it(`${name} survives a JSON round trip and the validator`, () => {
      const back = reconstruct(cs)
      expect(inst(back, id), 'the validator DROPPED the instance').toBeTruthy()
      expect(inst(back, id).placement[TARGET_EXPLICIT], 'the marker did not survive').toBe(true)
      expect(where(back, id)).toBe(expected)
    })
  }

  it('…and so does the return to automatic', () => {
    const [c0, cId] = series('close')
    const c = setInstanceDisplayTarget(setInstanceDisplayTarget(c0, cId, 'pane', registry), cId, 'price', registry)
    const back = reconstruct(c)
    expect(inst(back, cId).placement).toBeUndefined()
    expect(where(back, cId)).toBe('price')
  })
})

describe('⭐ §11 H–I — duplication and source changes', () => {
  it('H: a duplicate keeps the chosen destination AND its provenance', () => {
    const [cs0, id] = series('close')
    const cs = setInstanceDisplayTarget(cs0, id, 'pane', registry)
    // Duplication copies the instance one level deep; the marker rides the
    // placement object, so it cannot be dropped without dropping the target too.
    const src = inst(cs, id)
    const copy = { ...src, instanceId: 'inst:dataSeries:2', placement: { ...src.placement } }
    const two = { ...cs, indicatorInstances: [...insts(cs), copy] }
    expect(where(two, 'inst:dataSeries:2')).toBe('pane')
    expect(paneOwnKeys(insts(two), two).has('inst:dataSeries:2')).toBe(true)
  })

  it('I: an EXPLICIT placement survives a source change…', () => {
    const [cs0, id] = series('close')
    const cs = setSrc(setInstanceDisplayTarget(cs0, id, 'pane', registry), id, QQQ)
    expect(where(cs, id)).toBe('pane')
    const back = setSrc(cs, id, 'close')
    expect(where(back, id), 'the stored choice was recomputed away').toBe('pane')
  })

  it('…while an AUTOMATIC one recomputes from the new source', () => {
    const [cs0, id] = series('close')
    expect(where(cs0, id)).toBe('price')
    const q = setSrc(cs0, id, QQQ)
    expect(where(q, id), 'automatic placement did not follow the source').toBe('pane')
    expect(where(setSrc(q, id, 'volume'), id)).toBe('volume')
  })
})

// ─── §14 / §16 — THE STATE HAS TO BECOME A PANE, AND STAY WHERE IT IS PUT ───
//
// ⛔ RESOLVING TO `'pane'` IS NOT THE SAME AS HAVING ONE. The audit established
// that pane eligibility is `definition default OR resolved instance own-pane
// keys` — `paneLayout.orderedPaneKeys` reads
// `if (!paneIds.has(defId) && !include.has(instanceId)) continue`, with
// `includeKeys` fed from `paneOwnKeys` at `StockChart.jsx:10657`. An explicit
// destination that never reached `includeKeys` would resolve correctly and draw
// nothing at all, which is the exact silent-vanish `paneOwnKeys` was written for.
describe('⭐⭐ §14 — an explicit destination is REALISED, not merely resolved', () => {
  it('Close → Own pane earns a key in the arranged stack', () => {
    const [cs0, id] = series('close')
    const cs = setInstanceDisplayTarget(cs0, id, 'pane', registry)
    const order = resolvePaneOrder(
      cs,
      defaultPaneKeys(insts(cs), {
        excludeKeys: paneFollowerKeys(insts(cs), cs),
        includeKeys: paneOwnKeys(insts(cs), cs),
      }),
      { volumePane: true },
    )
    expect(order, 'the member’s own pane never reached the stack').toContain(id)
    expect(order).toEqual([PRICE_PANE, VOLUME_PANE, id])
  })

  it('…and QQQ → Price gives its pane BACK', () => {
    const [cs0, id] = series(QQQ)
    const cs = setInstanceDisplayTarget(cs0, id, 'price', registry)
    const order = resolvePaneOrder(
      cs,
      defaultPaneKeys(insts(cs), {
        excludeKeys: paneFollowerKeys(insts(cs), cs),
        includeKeys: paneOwnKeys(insts(cs), cs),
      }),
      { volumePane: true },
    )
    expect(order, 'a guest kept a pane slot — this is the swap that moved Volume')
      .toEqual([PRICE_PANE, VOLUME_PANE])
  })
})

describe('⛔ §16 — arrangement survives the new states', () => {
  const stack = (cs) => resolvePaneOrder(
    cs,
    defaultPaneKeys(insts(cs), {
      excludeKeys: paneFollowerKeys(insts(cs), cs),
      includeKeys: paneOwnKeys(insts(cs), cs),
    }),
    { volumePane: true },
  )

  it('a member’s arrangement is not re-derived when one is made explicit', () => {
    // QQQ above Price, arranged by hand; then the member sends it to Price and
    // brings it back. The arrangement is a separate authority from the
    // destination, and the round trip must not quietly reorder the stack.
    const [cs0, id] = series(QQQ)
    const arranged = setPaneOrder(cs0, [id, PRICE_PANE, VOLUME_PANE])
    expect(stack(arranged)).toEqual([id, PRICE_PANE, VOLUME_PANE])

    const guest = setInstanceDisplayTarget(arranged, id, 'price', registry)
    expect(stack(guest), 'sending it to Price disturbed the other panes')
      .toEqual([PRICE_PANE, VOLUME_PANE])

    const home = setInstanceDisplayTarget(guest, id, 'pane', registry)
    expect(stack(home), 'the member’s arrangement was re-derived on the way back')
      .toEqual([id, PRICE_PANE, VOLUME_PANE])
  })

  it('an explicit Close pane joins an arranged stack without displacing it', () => {
    let cs = addInstance({ indicatorInstances: [] }, 'rsi', registry)
    const rsi = insts(cs)[0].instanceId
    cs = setPaneOrder(cs, [rsi, PRICE_PANE, VOLUME_PANE])
    const before = stack(cs)

    cs = addInstance(cs, 'dataSeries', registry)
    const ds = insts(cs).find((i) => i.defId === 'dataSeries').instanceId
    cs = setInstanceDisplayTarget(cs, ds, 'pane', registry)
    const after = stack(cs)

    // ⭐ PAIRWISE, NOT POSITIONAL — inserting a pane necessarily shifts what is
    // below it; what may not change is any relation the member established.
    for (let i = 0; i < before.length; i++) {
      for (let j = i + 1; j < before.length; j++) {
        expect(after.indexOf(before[i]) < after.indexOf(before[j]),
          `${before[i]} / ${before[j]} flipped in ${JSON.stringify(after)}`).toBe(true)
      }
    }
    expect(after).toContain(ds)
  })
})

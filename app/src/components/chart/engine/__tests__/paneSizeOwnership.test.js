// app/src/components/chart/engine/__tests__/paneSizeOwnership.test.js
//
// ─── WHO IS ALLOWED TO OWN A PANE HEIGHT ────────────────────────────────────
//
// ⭐⭐ `paneSizes.test.js` PROVES THE ARITHMETIC; THIS PROVES THE KEY SPACE. The
// share map is keyed by PANE KEY, so the only question that matters for
// correctness is which keys a chart actually has — and that is decided by
// `defaultPaneKeys` + `paneOwnKeys` + `paneFollowerKeys`, not by the size module.
// A size stored against a key the layout never emits is dead state; a key the
// layout emits for something that is not a pane is a size attached to a guest.
//
// ⛔ MEASURED IN THE BROWSER 2026-09-15 (pane-harness, AAPL + QQQ own pane), and
// these rails pin what that measurement found:
//
//     drag QQQ larger   → paneSizes {price 0.6052, inst:dataSeries:1 0.3948}
//                         physical  417 / 272   — held after reconciliation
//     drag smaller      → {…, 0.0435}            physical 643 / 46
//     drag larger again → {price 0.7283, … 0.2717} physical 502 / 187
//     move QQQ above Price (Chart Data)
//                       → paneOrder ["inst:dataSeries:1","price"]
//                         paneSizes UNCHANGED, physical 187 / 502  (swapped)
//     resize at the new index → {price 0.5106, … 0.4894} physical 337 / 352
//     save blob → reconstruct → every one of those identical
//
// The size followed the KEY through a physical reorder, which is the whole
// design. Nothing below re-tests that (paneSizes.test.js owns it) — these cover
// the ownership questions the browser pass could not exhaust.

import { describe, it, expect } from 'vitest'
import * as registry from '../nativeRegistry'
import { addInstance, setInstanceDisplayTarget } from '../instanceControls'
import { paneOwnKeys, paneFollowerKeys } from '../displayTarget'
import { defaultPaneKeys } from '../paneLayout'
import { resolvePaneOrder, setPaneOrder, PRICE_PANE, VOLUME_PANE } from '../paneOrder'
import { setPaneSize, storedPaneSizes, prunePaneSizes } from '../paneSizes'
import { mergeChartSettings } from '../../chartDefaults'

const QQQ = 'sym:QQQ:close'
const insts = (cs) => (Array.isArray(cs.indicatorInstances) ? cs.indicatorInstances : [])
const setSrc = (cs, id, source) => ({
  ...cs,
  indicatorInstances: insts(cs).map((i) => (i.instanceId === id
    ? { ...i, inputs: { ...i.inputs, source } } : i)),
})

/** The pane keys the renderer will actually be handed, filters and all. */
const paneKeys = (cs, volumePane = true) => resolvePaneOrder(
  cs,
  defaultPaneKeys(insts(cs), {
    excludeKeys: paneFollowerKeys(insts(cs), cs),
    includeKeys: paneOwnKeys(insts(cs), cs),
  }),
  { volumePane },
)

function withQqqPane() {
  const cs = addInstance({ indicatorInstances: [] }, 'dataSeries', registry)
  const id = insts(cs)[0].instanceId
  return [setSrc(cs, id, QQQ), id]
}

describe('⛔ a GUEST owns no pane size', () => {
  it('a series displayed on Price is not a size-bearing key at all', () => {
    const [base, id] = withQqqPane()
    expect(paneKeys(base), 'the host case is not set up').toContain(id)

    // The member sends it to Price — it is now a guest in the candles' pane.
    const guest = setInstanceDisplayTarget(base, id, 'price', registry)
    expect(paneKeys(guest), 'a guest kept a pane key, so it could own a height')
      .toEqual([PRICE_PANE, VOLUME_PANE])
    expect(paneFollowerKeys(insts(guest), guest).has(id)).toBe(true)
  })

  it('⭐ …so a size stored against it can never reach the renderer', () => {
    // Nothing stops a stale key sitting in the blob — a member resizes a pane,
    // then sends that series to Price. The entry survives (it is their intent if
    // they send it back) but it must not participate while it is a guest.
    const [base, id] = withQqqPane()
    const sized = setPaneSize(base, id, 0.4)
    const guest = setInstanceDisplayTarget(sized, id, 'price', registry)
    expect(storedPaneSizes(guest)[id], 'the member’s size was destroyed by a move').toBe(0.4)
    expect(paneKeys(guest).includes(id), 'a guest is addressable by the size map').toBe(false)
  })

  it('⛔ and the HOST keeps its own size while a guest comes and goes', () => {
    const [base, host] = withQqqPane()
    let cs = setPaneSize(base, host, 0.35)
    cs = addInstance(cs, 'rsi', registry)                       // a second pane owner
    const rsi = insts(cs).find((i) => i.defId === 'rsi').instanceId
    cs = setInstanceDisplayTarget(cs, rsi, `@${host}`, registry) // …parked INTO QQQ's pane
    expect(paneFollowerKeys(insts(cs), cs).has(rsi), 'the guest is not a follower').toBe(true)
    expect(paneKeys(cs).includes(rsi), 'the guest took a pane key').toBe(false)
    expect(storedPaneSizes(cs)[host], 'the host lost its size when a guest arrived').toBe(0.35)
  })
})

describe('⭐ VOLUME owns a size only when it is a real pane', () => {
  it('separate Volume is a peer and is addressable', () => {
    const [cs] = withQqqPane()
    expect(paneKeys(cs, true)).toContain(VOLUME_PANE)
    const sized = setPaneSize(cs, VOLUME_PANE, 0.25)
    expect(storedPaneSizes(sized)[VOLUME_PANE]).toBe(0.25)
  })

  it('⛔ banded Volume is NOT a pane and gets no key to size', () => {
    // Banded volume draws INSIDE Price. Giving it a height would be sizing a
    // band as though it were a pane — two authorities over the same pixels.
    const [cs] = withQqqPane()
    expect(paneKeys(cs, false), 'banded volume was handed a pane key')
      .not.toContain(VOLUME_PANE)
  })

  it('⭐ and a size left over from its separate-pane days is inert while banded', () => {
    const [base] = withQqqPane()
    const cs = setPaneSize(base, VOLUME_PANE, 0.25)
    expect(paneKeys(cs, false).includes(VOLUME_PANE)).toBe(false)
    expect(storedPaneSizes(cs)[VOLUME_PANE], 'the stored value was silently dropped').toBe(0.25)
  })
})

describe('⛔ an unrelated pane arriving or leaving does not reset intent', () => {
  it('adding RSI leaves QQQ’s and Price’s stored weights untouched', () => {
    const [base, qqq] = withQqqPane()
    let cs = setPaneSize(setPaneSize(base, qqq, 0.30), PRICE_PANE, 0.55)
    const before = { ...storedPaneSizes(cs) }

    cs = addInstance(cs, 'rsi', registry)
    expect(storedPaneSizes(cs), 'adding a pane rewrote the member’s weights').toEqual(before)
    expect(paneKeys(cs)).toContain(insts(cs).find((i) => i.defId === 'rsi').instanceId)
  })

  it('…and removing it again leaves them untouched', () => {
    const [base, qqq] = withQqqPane()
    let cs = setPaneSize(base, qqq, 0.30)
    cs = addInstance(cs, 'rsi', registry)
    const rsi = insts(cs).find((i) => i.defId === 'rsi').instanceId
    const before = { ...storedPaneSizes(cs) }

    const gone = { ...cs, indicatorInstances: insts(cs).filter((i) => i.instanceId !== rsi) }
    expect(storedPaneSizes(gone)).toEqual(before)
    // ⚠️ AND PRUNING IS THE DELIBERATE, SEPARATE ACT — it drops the DEAD key only.
    const pruned = prunePaneSizes(gone, new Set(paneKeys(gone)))
    expect(storedPaneSizes(pruned)[qqq], 'pruning a dead key took a live one with it').toBe(0.30)
  })

  it('⭐ a reorder does not touch the map either', () => {
    const [base, qqq] = withQqqPane()
    const cs = setPaneSize(base, qqq, 0.30)
    const moved = setPaneOrder(cs, [qqq, PRICE_PANE, VOLUME_PANE])
    expect(storedPaneSizes(moved), 'reordering rewrote a size').toEqual(storedPaneSizes(cs))
    expect(moved.paneOrder[0]).toBe(qqq)
  })
})

describe('⚰️ the map survives the door every chart goes through', () => {
  it('⛔ mergeChartSettings carries paneSizes — it is a hard allow-list', () => {
    // A key the allow-list dropped would mean every resize vanished on the next
    // load, silently, which is the failure `paneSizes` exists to prevent.
    const [base, qqq] = withQqqPane()
    const cs = setPaneSize(setPaneSize(base, qqq, 0.3), PRICE_PANE, 0.55)
    const back = mergeChartSettings(JSON.stringify(cs))
    expect(storedPaneSizes(back)).toEqual({ [qqq]: 0.3, [PRICE_PANE]: 0.55 })
  })

  it('⛔ and a chart that was never resized gains NO paneSizes key', () => {
    // §9 default parity: explicit state must arise from an actual resize, never
    // from merely loading a chart.
    const [cs] = withQqqPane()
    const back = mergeChartSettings(JSON.stringify(cs))
    expect(storedPaneSizes(back), 'an untouched chart was migrated into explicit sizing').toEqual({})
  })
})

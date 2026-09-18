// app/src/components/chart/engine/__tests__/paneStability.test.js
//
// ─── ADDING A PANE MAY NOT MOVE THE PANES ALREADY THERE ─────────────────────
//
// ⚰️⚰️ OWNER, ON PRODUCTION: "I had an existing chart with Price + Volume in
// their current positions. I added a data series (QQQ). Without touching Volume
// or changing its pane position, Volume moved to the TOP of the chart layout by
// itself."
//
// ⚠️ THE EXACT SYMPTOM — VOLUME AT INDEX 0 — IS NOT REPRODUCED HERE, and these
// rails do not claim it is. Getting `volume` to the top requires the STORED list
// to begin with it, and no sequence of unrelated adds produces that. What the
// measurement DID find is two deterministic ways an unrelated add reorders
// arranged panes, and those are what is pinned below. If the literal Volume case
// ever surfaces, it is a third mechanism and wants its own rail.
//
// ⛔ THE MECHANISM THAT WAS FIXED. `resolvePaneOrder` spliced an unknown key in
// beside its neighbour in the DEFAULT arrangement, and that default is ordered
// by the instance array — which `withInstances` re-sorts by DEFINITION RANK on
// every canonical write. So a rank table decided where a member's new pane
// landed inside a stack they had arranged by hand. Measured: stored
// `["inst:rsi:1", "price"]`, add QQQ →
//
//     was   ["rsi", "dataSeries", "price", "volume"]   ← above Price
//     now   ["rsi", "price", "volume", "dataSeries"]
//
// ⭐ THE INVARIANT IS PAIRWISE, NOT POSITIONAL. "Nothing moved" cannot mean
// "every index is the same" — inserting a pane necessarily shifts what is below
// it. It means every ordering relation the member established still holds.

import { describe, it, expect } from 'vitest'
import { addInstance } from '../instanceControls'
import { resolvePaneOrder, setPaneOrder, PRICE_PANE, VOLUME_PANE } from '../paneOrder'
import { defaultPaneKeys } from '../paneLayout'
import { nativeVolumeOwnsPane } from '../volumePresentation'
import * as registry from '../nativeRegistry'

const instancesOf = (cs) => (Array.isArray(cs.indicatorInstances) ? cs.indicatorInstances : [])
const order = (cs, volumePane = true) =>
  resolvePaneOrder(cs, defaultPaneKeys(instancesOf(cs), {}), { volumePane })

/** Every pairwise relation in `before` still holds in `after`. */
function pairwiseStable(before, after) {
  const broken = []
  for (let i = 0; i < before.length; i++) {
    for (let j = i + 1; j < before.length; j++) {
      const a = after.indexOf(before[i])
      const b = after.indexOf(before[j])
      if (a < 0 || b < 0) continue           // removed panes are not this rail's business
      if (!(a < b)) broken.push([before[i], before[j]])
    }
  }
  return broken
}

describe('⚰️⚰️ an unrelated add preserves every arranged relation', () => {
  const CASES = [
    ['[price, volume] + qqq', [PRICE_PANE, VOLUME_PANE]],
    ['[volume, price] + qqq', [VOLUME_PANE, PRICE_PANE]],
  ]
  for (const [name, arranged] of CASES) {
    it(name, () => {
      let cs = setPaneOrder({ indicatorInstances: [] }, arranged)
      const before = order(cs)
      cs = addInstance(cs, 'dataSeries', registry)
      const after = order(cs)
      expect(pairwiseStable(before, after), `relations broken in ${JSON.stringify(after)}`).toEqual([])
      // ⛔ AND THE MEMBER'S OWN CHOICE SURVIVES — this is the case that says
      // "Volume stays above Price because the USER put it there".
      expect(after.indexOf(arranged[0]) < after.indexOf(arranged[1])).toBe(true)
    })
  }

  it('⭐ [rsi, price, volume] + qqq — rsi < price < volume all hold', () => {
    let cs = addInstance({ indicatorInstances: [] }, 'rsi', registry)
    const rsi = instancesOf(cs)[0].instanceId
    cs = setPaneOrder(cs, [rsi, PRICE_PANE, VOLUME_PANE])
    const before = order(cs)
    cs = addInstance(cs, 'dataSeries', registry)
    const after = order(cs)
    expect(pairwiseStable(before, after)).toEqual([])
    expect(after.indexOf(rsi)).toBeLessThan(after.indexOf(PRICE_PANE))
    expect(after.indexOf(PRICE_PANE)).toBeLessThan(after.indexOf(VOLUME_PANE))
    // ⚰️ THE MEASURED REGRESSION: QQQ used to land between rsi and price.
    expect(after.indexOf(PRICE_PANE), 'the new pane displaced Price')
      .toBeLessThan(after.length - 1)
  })

  it('⭐ a four-pane arrangement + spy — nothing the member placed moves', () => {
    let cs = { indicatorInstances: [] }
    cs = addInstance(cs, 'dataSeries', registry)
    cs = addInstance(cs, 'rsi', registry)
    const ids = instancesOf(cs).map((i) => i.instanceId)
    cs = setPaneOrder(cs, [ids[0], ids[1], PRICE_PANE, VOLUME_PANE])
    const before = order(cs)
    cs = addInstance(cs, 'dataSeries', registry)      // a second data series
    const after = order(cs)
    expect(pairwiseStable(before, after), `broken in ${JSON.stringify(after)}`).toEqual([])
  })

  it('⚰️⚰️ MACD may not wedge between two arranged panes on definition rank', () => {
    // The brief's explicit case. MACD's rank sits between RSI's and
    // dataSeries', and that used to be enough to place it between them.
    let cs = { indicatorInstances: [] }
    cs = addInstance(cs, 'rsi', registry)
    cs = addInstance(cs, 'dataSeries', registry)
    const ids = instancesOf(cs).map((i) => i.instanceId)
    const rsi = ids.find((k) => k.includes('rsi'))
    const data = ids.find((k) => k.includes('dataSeries'))
    cs = setPaneOrder(cs, [rsi, data, PRICE_PANE, VOLUME_PANE])

    const cs2 = addInstance(cs, 'macd', registry)
    const after = order(cs2)
    const macd = instancesOf(cs2).map((i) => i.instanceId).find((k) => k.includes('macd'))
    expect(after.indexOf(rsi)).toBeLessThan(after.indexOf(data))
    expect(after.indexOf(macd), 'MACD wedged in on definition rank')
      .toBeGreaterThan(after.indexOf(data))
  })

  it('⛔ deleting an unrelated pane leaves the rest in order', () => {
    let cs = { indicatorInstances: [] }
    cs = addInstance(cs, 'rsi', registry)
    cs = addInstance(cs, 'macd', registry)
    const ids = instancesOf(cs).map((i) => i.instanceId)
    cs = setPaneOrder(cs, [ids[0], PRICE_PANE, ids[1], VOLUME_PANE])
    const before = order(cs)
    const kept = before.filter((k) => k !== ids[1])
    const after = order({ ...cs, indicatorInstances: instancesOf(cs).filter((i) => i.instanceId !== ids[1]) })
    expect(pairwiseStable(kept, after)).toEqual([])
  })
})

describe('⛔ a chart with NO arrangement keeps the shipped default', () => {
  it('the default stack is still derived, and is Price · Volume · panes', () => {
    // ⚠️ DELIBERATELY UNCHANGED. Deriving the FIRST stack from the shipped
    // order is legitimate and is the whole backward-compatibility story — a blob
    // with no `paneOrder` must render exactly as it always has. What is no
    // longer allowed is RE-deriving it once the member has arranged something.
    let cs = { indicatorInstances: [] }
    expect(order(cs)).toEqual([PRICE_PANE, VOLUME_PANE])
    cs = addInstance(cs, 'dataSeries', registry)
    const after = order(cs)
    expect(after[0]).toBe(PRICE_PANE)
    expect(after[1]).toBe(VOLUME_PANE)
    expect(after).toHaveLength(3)
    expect(cs.paneOrder ?? [], 'an unarranged chart grew a stored order').toEqual([])
  })
})

describe('⛔ ONE volume predicate, asked by everyone', () => {
  it('an overlay forces a pane whatever the flag says', () => {
    expect(nativeVolumeOwnsPane({ cs: { volumeOverlayIndicators: ['rsi'] } })).toBe(true)
    expect(nativeVolumeOwnsPane({ cs: { volume: { separatePane: false }, volumeOverlayIndicators: ['rsi'] } })).toBe(true)
  })

  it('the props the renderer has, and Chart Data does not, are INPUTS not guesses', () => {
    const cs = { volume: { separatePane: false } }
    expect(nativeVolumeOwnsPane({ cs }), 'the settings-only answer').toBe(false)
    expect(nativeVolumeOwnsPane({ cs, blankVolume: true }), 'a blank volume pane is still a pane').toBe(true)
    expect(nativeVolumeOwnsPane({ cs, volumeSeparatePane: true })).toBe(true)
    expect(nativeVolumeOwnsPane({ cs, shown: false }), 'hidden volume owns nothing').toBe(false)
  })

  it('⭐ the flag alone still means a pane', () => {
    expect(nativeVolumeOwnsPane({ cs: { volume: { separatePane: true } } })).toBe(true)
    expect(nativeVolumeOwnsPane({ cs: {} })).toBe(false)
  })
})

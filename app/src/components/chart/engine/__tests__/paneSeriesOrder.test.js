// app/src/components/chart/engine/__tests__/paneSeriesOrder.test.js
//
// ─── THE THIRD ORDER, RAILED ────────────────────────────────────────────────
//
// ⭐⭐ THE ONE SENTENCE THIS FILE EXISTS TO ENFORCE: `paneSeriesOrder` IS A
// PREFERENCE, NOT AN INVENTORY. It never decides what is in a pane — `cs.overlays`,
// `cs.indicatorInstances` and `resolveDisplayTarget` do — so every read is written
// to be harmless on a blob whose ids have gone stale, and the first assertion in
// most cases below is about the SET, not the order. A reader that can drop a
// member is a reader that can delete an indicator from a member's chart by having
// an old preference, which is a far worse bug than any ordering mistake.
import { describe, it, expect } from 'vitest'
import { mergeChartSettings } from '../../chartDefaults'
import {
  PANE_SERIES_ORDER_KEY,
  storedPaneSeriesOrder,
  resolvePaneSeriesOrder,
  orderPaneRows,
  setPaneSeriesOrder,
  moveSeriesWithinPane,
  moveSeriesTo,
  canMoveSeries,
} from '../paneSeriesOrder'

const PRICE = 'price'
/** A blob with one pane arranged. */
const withOrder = (paneKey, ids, rest) => ({
  ...(rest || {}), [PANE_SERIES_ORDER_KEY]: { [paneKey]: ids },
})
const MEMBERS = ['overlay-0', 'overlay-1', 'overlay-2', 'inst:movingAverage:1']

// ════════════════════════════════════════════════════════════════════════════
describe('the reader — absent, partial, complete, and wrong', () => {
  it('⛔⛔ ABSENT MEANS EXACTLY WHAT THE CHART DOES TODAY', () => {
    // ⭐ THE WHOLE BACKWARD-COMPATIBILITY STORY IN ONE CASE. Every chart that
    // exists has no `paneSeriesOrder`, so this is the branch almost every read
    // takes forever. It must return the incoming array's own order, and the
    // identity check is deliberate: no copy, no sort, nothing to get wrong.
    for (const cs of [{}, null, undefined, { [PANE_SERIES_ORDER_KEY]: null },
      { [PANE_SERIES_ORDER_KEY]: [] }, { [PANE_SERIES_ORDER_KEY]: { volume: ['x'] } }]) {
      expect(resolvePaneSeriesOrder(cs, PRICE, MEMBERS)).toEqual(MEMBERS)
    }
    const rows = MEMBERS.map((id) => ({ id }))
    expect(orderPaneRows({}, PRICE, rows, (r) => r.id), 'the rows array was rebuilt')
      .toBe(rows)
  })

  it('⭐ A COMPLETE PREFERENCE IS OBEYED', () => {
    const cs = withOrder(PRICE, ['overlay-2', 'inst:movingAverage:1', 'overlay-0', 'overlay-1'])
    expect(resolvePaneSeriesOrder(cs, PRICE, MEMBERS))
      .toEqual(['overlay-2', 'inst:movingAverage:1', 'overlay-0', 'overlay-1'])
  })

  it('⭐ A PARTIAL PREFERENCE ORDERS WHAT IT KNOWS AND APPENDS THE REST', () => {
    // ⛔ APPENDED, NOT SPLICED BESIDE A DEFAULT NEIGHBOUR. `resolvePaneOrder`
    // records the measured reason at length: the canonical order a new row would
    // be spliced against is itself derived from definition rank, so splicing lets
    // rank move a row the member placed. Appending cannot disturb any pairwise
    // relation the member established.
    const cs = withOrder(PRICE, ['overlay-2', 'overlay-0'])
    expect(resolvePaneSeriesOrder(cs, PRICE, MEMBERS))
      .toEqual(['overlay-2', 'overlay-0', 'overlay-1', 'inst:movingAverage:1'])
  })

  it('⛔⛔ A STALE ID IS IGNORED — IT CANNOT CONJURE A ROW', () => {
    const cs = withOrder(PRICE, ['overlay-9', 'inst:rsi:7', 'overlay-1', 'overlay-0'])
    const out = resolvePaneSeriesOrder(cs, PRICE, MEMBERS)
    expect([...out].sort(), 'the reader changed the SET, not just the order')
      .toEqual([...MEMBERS].sort())
    expect(out).toEqual(['overlay-1', 'overlay-0', 'overlay-2', 'inst:movingAverage:1'])
  })

  it('⛔⛔ A MEMBER THE PREFERENCE NEVER HEARD OF CANNOT VANISH', () => {
    // The other half of the same rule, and the one that would delete an indicator
    // from a chart: a `paneSeriesOrder` written before a series was added must
    // still return that series.
    const cs = withOrder(PRICE, ['overlay-0'])
    const out = resolvePaneSeriesOrder(cs, PRICE, MEMBERS)
    expect(out).toHaveLength(MEMBERS.length)
    expect(out).toEqual(expect.arrayContaining(MEMBERS))
  })

  it('⛔ A DUPLICATE IN THE STORED LIST IS COLLAPSED, not rendered twice', () => {
    const cs = withOrder(PRICE, ['overlay-1', 'overlay-1', 'overlay-0'])
    expect(resolvePaneSeriesOrder(cs, PRICE, MEMBERS))
      .toEqual(['overlay-1', 'overlay-0', 'overlay-2', 'inst:movingAverage:1'])
  })

  it('⛔ A PREFERENCE BELONGS TO ONE PANE AND REACHES NO OTHER', () => {
    // ⭐ THIS IS THE "MOVED TO ANOTHER PANE" CASE, and it needs no cleanup: the
    // id is simply not a member of the pane being read, so the price arrangement
    // says nothing about the QQQ pane and vice versa.
    const cs = withOrder(PRICE, ['inst:movingAverage:1', 'overlay-0'])
    expect(resolvePaneSeriesOrder(cs, 'inst:dataSeries:1', ['inst:movingAverage:1', 'x']))
      .toEqual(['inst:movingAverage:1', 'x'])
  })

  it('⛔ A MALFORMED BLOB IS DATA, NOT A CRASH', () => {
    for (const bad of [{ [PANE_SERIES_ORDER_KEY]: 'nope' }, { [PANE_SERIES_ORDER_KEY]: 7 },
      { [PANE_SERIES_ORDER_KEY]: { price: 'nope' } },
      { [PANE_SERIES_ORDER_KEY]: { price: [1, null, {}, '', 'overlay-1'] } }]) {
      expect(() => resolvePaneSeriesOrder(bad, PRICE, MEMBERS)).not.toThrow()
      expect([...resolvePaneSeriesOrder(bad, PRICE, MEMBERS)].sort()).toEqual([...MEMBERS].sort())
    }
    expect(storedPaneSeriesOrder({ [PANE_SERIES_ORDER_KEY]: { price: [1, 'a', 'a', ''] } }, PRICE))
      .toEqual(['a'])
  })
})

// ════════════════════════════════════════════════════════════════════════════
describe('orderPaneRows — a multi-output indicator is ONE row', () => {
  it('⭐⭐ ENTRIES SHARING AN ID TRAVEL TOGETHER', () => {
    // ⛔ THE DEFECT THIS PREVENTS IS A SPLIT GROUP. MACD's line and its SIG are
    // two legend entries with one instance id; the legend marks the second as a
    // SIBLING by adjacency alone, so a member's move that put a moving average
    // between them would print MACD and SIG as two unrelated studies.
    const rows = [
      { id: 'inst:macd:1', plot: 'macd' },
      { id: 'inst:macd:1', plot: 'signal' },
      { id: 'overlay-0', plot: 'ma' },
    ]
    const cs = withOrder(PRICE, ['overlay-0', 'inst:macd:1'])
    expect(orderPaneRows(cs, PRICE, rows, (r) => r.id).map((r) => r.plot))
      .toEqual(['ma', 'macd', 'signal'])
  })

  it('⚠️ A ROW WITH NO ID IS KEPT, at the end', () => {
    const rows = [{ id: 'overlay-0' }, { id: null, tag: 'anon' }, { id: 'overlay-1' }]
    const cs = withOrder(PRICE, ['overlay-1', 'overlay-0'])
    const out = orderPaneRows(cs, PRICE, rows, (r) => r.id)
    expect(out).toHaveLength(3)
    expect(out[2].tag, 'an unidentifiable row was dropped from the chart').toBe('anon')
  })
})

// ════════════════════════════════════════════════════════════════════════════
describe('the writer — one slot, one key, one pane', () => {
  const cs0 = {}

  it('⭐ A MIDDLE ROW MOVES UP AND DOWN, and nothing else moves', () => {
    const up = moveSeriesWithinPane(cs0, PRICE, MEMBERS, 'overlay-1', -1)
    expect(resolvePaneSeriesOrder(up, PRICE, MEMBERS))
      .toEqual(['overlay-1', 'overlay-0', 'overlay-2', 'inst:movingAverage:1'])

    const down = moveSeriesWithinPane(cs0, PRICE, MEMBERS, 'overlay-1', 1)
    expect(resolvePaneSeriesOrder(down, PRICE, MEMBERS))
      .toEqual(['overlay-0', 'overlay-2', 'overlay-1', 'inst:movingAverage:1'])
  })

  it('⛔ THE BOUNDARIES ARE NO-OPS, AND THEY DO NOT WRITE', () => {
    // ⭐ THE SAME OBJECT BACK, not an equal one. It is what keeps
    // `if (next !== settings) onChange(next)` from persisting a chart because a
    // member pressed ↑ on the top row — and `canMoveSeries` is what stops the
    // press being offered at all.
    expect(moveSeriesWithinPane(cs0, PRICE, MEMBERS, 'overlay-0', -1)).toBe(cs0)
    expect(moveSeriesWithinPane(cs0, PRICE, MEMBERS, 'inst:movingAverage:1', 1)).toBe(cs0)
    expect(canMoveSeries(cs0, PRICE, MEMBERS, 'overlay-0', -1)).toBe(false)
    expect(canMoveSeries(cs0, PRICE, MEMBERS, 'overlay-0', 1)).toBe(true)
    expect(canMoveSeries(cs0, PRICE, MEMBERS, 'inst:movingAverage:1', 1)).toBe(false)
  })

  it('⛔ A SINGLE-MEMBER PANE CAN GO NEITHER WAY', () => {
    expect(canMoveSeries(cs0, 'inst:dataSeries:1', ['inst:dataSeries:1'], 'inst:dataSeries:1', -1)).toBe(false)
    expect(canMoveSeries(cs0, 'inst:dataSeries:1', ['inst:dataSeries:1'], 'inst:dataSeries:1', 1)).toBe(false)
  })

  it('⛔⛔ A ROW THAT IS NOT IN THIS PANE IS REFUSED, not added', () => {
    // The structural guarantee that arrows cannot cross a pane boundary: the step
    // is taken inside ONE pane's membership list, so there is no index at either
    // end that names anything outside it.
    const next = moveSeriesWithinPane(cs0, PRICE, MEMBERS, 'inst:rsi:1', -1)
    expect(next).toBe(cs0)
    expect(canMoveSeries(cs0, PRICE, MEMBERS, 'inst:rsi:1', -1)).toBe(false)
  })

  it('⛔ A BAD DELTA IS REFUSED — no wrap, no jump, no zero', () => {
    for (const d of [0, 2, -2, NaN, '1', null, undefined]) {
      expect(moveSeriesWithinPane(cs0, PRICE, MEMBERS, 'overlay-1', d)).toBe(cs0)
      expect(canMoveSeries(cs0, PRICE, MEMBERS, 'overlay-1', d)).toBe(false)
    }
  })

  it('⛔⛔ IT WRITES ONE KEY, AND `preset`', () => {
    // ⭐ THE SEPARATION, ASSERTED AS A DIFF. Display, Source, `targetExplicit`,
    // `paneOrder`, the overlay array and the instance array are what the other
    // controls own; a row arrow may not touch any of them, and the cheapest way
    // to keep that true is to compare the whole blob.
    const before = {
      overlays: [{ type: 'EMA', period: 9 }, { type: 'SMA', period: 50 }],
      indicatorInstances: [{ instanceId: 'inst:movingAverage:1', defId: 'movingAverage', inputs: { period: 5 } }],
      paneOrder: ['price', 'volume'],
      volume: { separatePane: true },
    }
    const after = moveSeriesWithinPane(before, PRICE, MEMBERS, 'overlay-1', -1)
    expect(Object.keys(after).sort())
      .toEqual([...Object.keys(before), PANE_SERIES_ORDER_KEY, 'preset'].sort())
    expect(after.preset).toBe('custom')
    for (const key of Object.keys(before)) {
      expect(after[key], `the arrows rewrote \`${key}\``).toBe(before[key])
    }
  })

  it('⭐ A DORMANT PREFERENCE SURVIVES A TRIP TO ANOTHER PANE', () => {
    // ⭐⭐ THE RULING, AND IT COSTS ONE STRING. A member arranges Price, then sends
    // one of those series to the QQQ pane with Display. Its Price entry is now
    // stale — the reader ignores it, so QQQ appends the newcomer at the end, which
    // is the deterministic rule for a member with no preference there. Send it
    // back and the Price entry is live again and its old slot is waiting.
    //
    // ⛔ NO CLEANUP MACHINERY BUYS THIS. It falls out of "a preference is not an
    // inventory": nothing ever has to ask WHY an id went missing.
    const arranged = moveSeriesWithinPane({}, PRICE, MEMBERS, 'inst:movingAverage:1', -1)
    expect(resolvePaneSeriesOrder(arranged, PRICE, MEMBERS)[2]).toBe('inst:movingAverage:1')

    // …it leaves for QQQ. Price forgets nothing; QQQ appends it.
    const awayFromPrice = MEMBERS.filter((id) => id !== 'inst:movingAverage:1')
    expect(resolvePaneSeriesOrder(arranged, PRICE, awayFromPrice)).toEqual(awayFromPrice)
    expect(resolvePaneSeriesOrder(arranged, 'inst:dataSeries:1', ['inst:dataSeries:1', 'inst:movingAverage:1']))
      .toEqual(['inst:dataSeries:1', 'inst:movingAverage:1'])

    // …and it comes home to the slot it left.
    expect(resolvePaneSeriesOrder(arranged, PRICE, MEMBERS)[2]).toBe('inst:movingAverage:1')
  })

  it('⭐ A DELETED SERIES LEAVES A HARMLESS ENTRY, and a revived one finds its slot', () => {
    // `cs.overlays` is TOMBSTONED, never spliced, so `overlay-2` names the same
    // moving average before and after a Remove — which is exactly why the stored
    // id is safe to leave behind and exactly why reviving works with no bookkeeping.
    const arranged = moveSeriesWithinPane({}, PRICE, MEMBERS, 'overlay-2', -1)
    expect(resolvePaneSeriesOrder(arranged, PRICE, MEMBERS)[1]).toBe('overlay-2')

    const removed = MEMBERS.filter((id) => id !== 'overlay-2')
    expect(resolvePaneSeriesOrder(arranged, PRICE, removed)).toEqual(removed)
    expect(resolvePaneSeriesOrder(arranged, PRICE, MEMBERS)[1]).toBe('overlay-2')
  })

  it('⛔ SETTING AN EMPTY ARRANGEMENT IS A NO-OP, not an erasure', () => {
    const cs = withOrder(PRICE, ['overlay-1', 'overlay-0'])
    expect(setPaneSeriesOrder(cs, PRICE, [])).toBe(cs)
    expect(setPaneSeriesOrder(cs, '', ['overlay-0'])).toBe(cs)
    expect(setPaneSeriesOrder(null, PRICE, ['overlay-0'])).toBe(null)
  })

  it('⭐ ARRANGING ONE PANE LEAVES ANOTHER PANE\'S ARRANGEMENT ALONE', () => {
    const cs = withOrder('inst:rsi:1', ['a', 'b'])
    const next = moveSeriesWithinPane(cs, PRICE, MEMBERS, 'overlay-1', -1)
    expect(next[PANE_SERIES_ORDER_KEY]['inst:rsi:1']).toEqual(['a', 'b'])
    expect(next[PANE_SERIES_ORDER_KEY][PRICE][0]).toBe('overlay-1')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
describe('⚰️⚰️ IT SURVIVES A READ — the allow-list trap, for the third time', () => {
  // ⚰️⚰️ MEASURED IN THE BROWSER BEFORE IT WAS BELIEVED. The arrangement wrote
  // correctly, the list and the legend both followed instantly — and `save blob`
  // → `reconstruct` in the pane harness put the canonical order straight back.
  // `mergeChartSettings` returns a hard ALLOW-LIST: a key absent from its RETURN
  // is destroyed on every read, however faithfully it was written. `paneOrder`
  // and `paneSizes` both carry a tombstone recording the same trap; this is the
  // rail that makes the third one impossible to reintroduce silently.
  it('⛔⛔ A STORED ARRANGEMENT COMES BACK OUT OF `mergeChartSettings`', () => {
    const stored = { [PANE_SERIES_ORDER_KEY]: { price: ['overlay-2', 'inst:movingAverage:1'] } }
    const merged = mergeChartSettings(stored)
    expect(merged[PANE_SERIES_ORDER_KEY], 'the arrangement was destroyed on read')
      .toEqual({ price: ['overlay-2', 'inst:movingAverage:1'] })
    expect(resolvePaneSeriesOrder(merged, PRICE, MEMBERS))
      .toEqual(['overlay-2', 'inst:movingAverage:1', 'overlay-0', 'overlay-1'])
  })

  it('⛔ A BLOB WITH NO ARRANGEMENT READS AS "NO PREFERENCE", not as a missing key', () => {
    expect(mergeChartSettings({})[PANE_SERIES_ORDER_KEY]).toEqual({})
    expect(resolvePaneSeriesOrder(mergeChartSettings({}), PRICE, MEMBERS)).toEqual(MEMBERS)
  })

  it('⛔ A MALFORMED STORED VALUE IS SANITISED, NOT CARRIED', () => {
    const merged = mergeChartSettings({ [PANE_SERIES_ORDER_KEY]: {
      price: ['overlay-0', 7, null, ''],
      bad: 'not-an-array',
      empty: [],
      '': ['x'],
    } })
    expect(merged[PANE_SERIES_ORDER_KEY]).toEqual({ price: ['overlay-0'] })
  })

  it('⛔ THE WRITE ROUND-TRIPS — write, read, and the order is the one written', () => {
    const cs = mergeChartSettings({})
    const moved = moveSeriesWithinPane(cs, PRICE, MEMBERS, 'inst:movingAverage:1', -1)
    const reloaded = mergeChartSettings(JSON.parse(JSON.stringify(moved)))
    expect(resolvePaneSeriesOrder(reloaded, PRICE, MEMBERS))
      .toEqual(resolvePaneSeriesOrder(moved, PRICE, MEMBERS))
    expect(resolvePaneSeriesOrder(reloaded, PRICE, MEMBERS))
      .toEqual(['overlay-0', 'overlay-1', 'inst:movingAverage:1', 'overlay-2'])
  })
})

// ════════════════════════════════════════════════════════════════════════════
describe('moveSeriesTo — the DROP half, and the same one key', () => {
  // ⭐ IT IS `movePaneTo`, ONE LEVEL DOWN. A drag needs an ABSOLUTE destination
  // where the arrows needed a step, and the alternative — calling
  // `moveSeriesWithinPane` until the index matches — would write a preference per
  // intermediate position: seven blobs, and seven undo steps, to cross a
  // seven-row pane the member only ever sees the end of.

  const order = (cs) => resolvePaneSeriesOrder(cs, PRICE, MEMBERS)

  it('⭐ IT LANDS *BEFORE* THE ANCHOR, from either direction', () => {
    const cs = mergeChartSettings({})
    expect(order(cs)).toEqual(MEMBERS)
    // downward: the first member lands in front of the third
    expect(order(moveSeriesTo(cs, PRICE, MEMBERS, MEMBERS[0], MEMBERS[2])))
      .toEqual([MEMBERS[1], MEMBERS[0], MEMBERS[2], MEMBERS[3]])
    // upward: the third lands in front of the first
    expect(order(moveSeriesTo(cs, PRICE, MEMBERS, MEMBERS[2], MEMBERS[0])))
      .toEqual([MEMBERS[2], MEMBERS[0], MEMBERS[1], MEMBERS[3]])
  })

  it('⭐ NO ANCHOR MEANS LAST — the position a list has no row for', () => {
    // ⚠️ A LIST HAS ONE MORE POSITION THAN IT HAS ROWS. "After the final member"
    // cannot name a sibling, so the UI passes `null` and this is what reads it.
    const cs = mergeChartSettings({})
    expect(order(moveSeriesTo(cs, PRICE, MEMBERS, MEMBERS[0], null)))
      .toEqual([MEMBERS[1], MEMBERS[2], MEMBERS[3], MEMBERS[0]])
    // …and an anchor that is not a member of THIS pane is not an error, it is
    // simply not found — so the row goes last inside its own pane rather than
    // anywhere near the pane the pointer was over.
    expect(order(moveSeriesTo(cs, PRICE, MEMBERS, MEMBERS[0], 'inst:rsi:1')))
      .toEqual([MEMBERS[1], MEMBERS[2], MEMBERS[3], MEMBERS[0]])
  })

  it('⛔⛔ A DROP THAT CHANGES NOTHING RETURNS THE SAME OBJECT', () => {
    // ⛔ THE COMMONEST WAY A DRAG ENDS is letting go where it started. Returning
    // `cs` by identity is what lets the caller write `if (next !== settings)` and
    // produce no preference write at all — the same promise
    // `moveSeriesWithinPane` keeps at a boundary.
    const cs = mergeChartSettings({})
    expect(moveSeriesTo(cs, PRICE, MEMBERS, MEMBERS[1], MEMBERS[2]), 'its own slot wrote').toBe(cs)
    expect(moveSeriesTo(cs, PRICE, MEMBERS, MEMBERS[1], MEMBERS[1]), 'onto itself wrote').toBe(cs)
    expect(moveSeriesTo(cs, PRICE, MEMBERS, MEMBERS[3], null), 'already last wrote').toBe(cs)
  })

  it('⛔⛔ A ROW THAT IS NOT IN THE PANE IS REFUSED, NOT ADDED', () => {
    // ⛔ THE PREFERENCE-NOT-INVENTORY RULE, at the writer. A drop naming a
    // stranger must not conjure it into the pane's order — that is how a stale id
    // becomes a phantom series.
    const cs = mergeChartSettings({})
    expect(moveSeriesTo(cs, PRICE, MEMBERS, 'inst:gone:9', MEMBERS[0])).toBe(cs)
    expect(moveSeriesTo(cs, PRICE, MEMBERS, '', MEMBERS[0])).toBe(cs)
    expect(moveSeriesTo(cs, '', MEMBERS, MEMBERS[0], MEMBERS[1])).toBe(cs)
    expect(moveSeriesTo(null, PRICE, MEMBERS, MEMBERS[0], MEMBERS[1])).toBeNull()
  })

  it('⛔⛔ IT WRITES ONE KEY, AND THE SET NEVER CHANGES', () => {
    const cs = mergeChartSettings({})
    const next = moveSeriesTo(cs, PRICE, MEMBERS, MEMBERS[0], MEMBERS[3])
    // ⛔ THE SAME MEMBERS, PERMUTED. Not a superset, not a subset.
    expect([...order(next)].sort()).toEqual([...MEMBERS].sort())
    // ⛔ AND NOTHING ELSE ON THE BLOB MOVED. `preset` flips to 'custom' because
    // the member has now arranged something, which is what every other preference
    // writer does.
    const { [PANE_SERIES_ORDER_KEY]: _a, preset: _b, ...restNext } = next
    const { [PANE_SERIES_ORDER_KEY]: _c, preset: _d, ...restPrev } = cs
    expect(restNext).toEqual(restPrev)
    expect(Object.keys(next[PANE_SERIES_ORDER_KEY])).toEqual([PRICE])
  })

  it('⭐ A DROP AND A WALK OF NUDGES AGREE — one destination, two doors', () => {
    // ⛔ THREE DOORS REACH THIS ORDER NOW — a drop, the grip's arrow keys, and
    // whatever comes next — and they must not be able to produce different stored
    // states. Two presses of ↑ and one drag onto the anchor two rows up are the
    // same arrangement, so they must read identical.
    const cs = mergeChartSettings({})
    let walked = cs
    walked = moveSeriesWithinPane(walked, PRICE, MEMBERS, MEMBERS[2], -1)
    walked = moveSeriesWithinPane(walked, PRICE, MEMBERS, MEMBERS[2], -1)
    const dropped = moveSeriesTo(cs, PRICE, MEMBERS, MEMBERS[2], MEMBERS[0])
    expect(order(dropped)).toEqual(order(walked))
    expect(dropped[PANE_SERIES_ORDER_KEY]).toEqual(walked[PANE_SERIES_ORDER_KEY])
  })

  it('⚠️ A LATENT ID SURVIVES A DROP, exactly as it survives a nudge', () => {
    // ⚠️ A SERIES THAT LEFT FOR ANOTHER PANE KEEPS ITS SLOT WAITING. The writer
    // parks ids it cannot place at the end rather than cleaning them up, because
    // cleanup would have to know WHY an id went missing — and "preference, not
    // inventory" means it never has to ask.
    const cs = mergeChartSettings({ [PANE_SERIES_ORDER_KEY]: {
      [PRICE]: [...MEMBERS, 'inst:elsewhere:1'],
    } })
    const next = moveSeriesTo(cs, PRICE, MEMBERS, MEMBERS[0], null)
    expect(next[PANE_SERIES_ORDER_KEY][PRICE], 'the latent id was swept up by a drop')
      .toContain('inst:elsewhere:1')
    expect(order(next), 'a latent id leaked into what is on screen')
      .toEqual([MEMBERS[1], MEMBERS[2], MEMBERS[3], MEMBERS[0]])
  })

  it('⛔ THE DROP ROUND-TRIPS THROUGH THE ALLOW-LIST', () => {
    // ⚠️ `mergeChartSettings` IS A HARD ALLOW-LIST — a key missing from its RETURN
    // is destroyed on every read. This is the same rail the nudge carries, kept
    // for the drop because a save → reconstruct that quietly reverts a member's
    // arrangement is the failure mode that was actually measured once.
    const cs = mergeChartSettings({})
    const moved = moveSeriesTo(cs, PRICE, MEMBERS, MEMBERS[3], MEMBERS[0])
    const reloaded = mergeChartSettings(JSON.parse(JSON.stringify(moved)))
    expect(resolvePaneSeriesOrder(reloaded, PRICE, MEMBERS))
      .toEqual([MEMBERS[3], MEMBERS[0], MEMBERS[1], MEMBERS[2]])
  })
})

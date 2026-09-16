// app/src/components/chart/engine/__tests__/paneOrder.test.js
//
// ─── THE ARRANGEMENT, BEFORE ANY PIXELS DEPEND ON IT ────────────────────────
//
// Pure state. The renderer's half is proved separately (`paneLayout` +
// `stockChartWiring`); this pins the thing both halves read.
//
// ⛔⛔ THE FIRST TWO CASES ARE THE ONES THAT PROTECT EVERY SAVED CHART. A blob
// with no `paneOrder` must resolve to the arrangement the product already
// renders — Price, a separate volume pane if there is one, then the stack — or
// this feature is a silent migration of everyone's layout.

import { describe, it, expect } from 'vitest'
import {
  resolvePaneOrder, setPaneOrder, movePane, movePaneTo, storedPaneOrder,
  PRICE_PANE, VOLUME_PANE, PANE_ORDER_KEY,
} from '../paneOrder'

const KEYS = ['inst:rsi:1', 'inst:macd:1']

describe('⛔⛔ no stored order means TODAY\'s chart, exactly', () => {
  it('Price, then the stack', () => {
    expect(resolvePaneOrder({}, KEYS)).toEqual([PRICE_PANE, ...KEYS])
  })

  it('…and a separate volume pane sits directly under Price, as it does now', () => {
    expect(resolvePaneOrder({}, KEYS, { volumePane: true }))
      .toEqual([PRICE_PANE, VOLUME_PANE, ...KEYS])
  })

  it('⛔ a banded volume is NOT in the stack — it is not a pane', () => {
    expect(resolvePaneOrder({}, KEYS, { volumePane: false })).not.toContain(VOLUME_PANE)
  })

  it('⛔ a malformed stored value is ignored rather than trusted', () => {
    for (const bad of [null, 'price', 42, {}, [1, 2], [null]]) {
      expect(resolvePaneOrder({ [PANE_ORDER_KEY]: bad }, KEYS)).toEqual([PRICE_PANE, ...KEYS])
    }
  })
})

describe('an explicit arrangement is honoured', () => {
  it('⭐⭐ a pane can sit ABOVE Price', () => {
    const cs = setPaneOrder({}, ['inst:rsi:1', PRICE_PANE, 'inst:macd:1'])
    expect(resolvePaneOrder(cs, KEYS)).toEqual(['inst:rsi:1', PRICE_PANE, 'inst:macd:1'])
  })

  it('⭐ Price can sit at the very bottom', () => {
    const cs = setPaneOrder({}, [...KEYS, PRICE_PANE])
    expect(resolvePaneOrder(cs, KEYS)).toEqual([...KEYS, PRICE_PANE])
  })

  it('⭐ Volume is independently placeable — above Price, below Price', () => {
    const opts = { volumePane: true }
    const up = setPaneOrder({}, [VOLUME_PANE, PRICE_PANE, ...KEYS])
    expect(resolvePaneOrder(up, KEYS, opts)).toEqual([VOLUME_PANE, PRICE_PANE, ...KEYS])
    const down = setPaneOrder({}, [PRICE_PANE, ...KEYS, VOLUME_PANE])
    expect(resolvePaneOrder(down, KEYS, opts)).toEqual([PRICE_PANE, ...KEYS, VOLUME_PANE])
  })

  it('⭐⭐ RSI and MACD can be swapped — and it does NOT snap back', () => {
    // ⚰️ THE DEFECT THIS EXISTS FOR: stack order used to be `stackRank`, a
    // per-DEFINITION constant that `withInstances` re-applied on every canonical
    // write. Any arrangement the member made was undone by their next click.
    // `paneOrder` is a separate fact, so no instance write can reach it.
    const cs = setPaneOrder({}, [PRICE_PANE, 'inst:macd:1', 'inst:rsi:1'])
    expect(resolvePaneOrder(cs, KEYS)).toEqual([PRICE_PANE, 'inst:macd:1', 'inst:rsi:1'])
    // a later unrelated settings write keeps the arrangement
    const after = { ...cs, indicatorInstances: [], preset: 'custom' }
    expect(resolvePaneOrder(after, KEYS)).toEqual([PRICE_PANE, 'inst:macd:1', 'inst:rsi:1'])
  })
})

describe('the arrangement is a preference, never a claim about what exists', () => {
  it('⛔ a key that has left the chart is dropped from the RESOLVED order', () => {
    const cs = setPaneOrder({}, ['inst:gone:9', PRICE_PANE, 'inst:rsi:1'])
    expect(resolvePaneOrder(cs, ['inst:rsi:1'])).toEqual([PRICE_PANE, 'inst:rsi:1'])
  })

  it('⭐⭐ …but it is REMEMBERED, so hide → show does not send a pane to the bottom', () => {
    const cs = setPaneOrder({}, ['inst:rsi:1', PRICE_PANE, 'inst:macd:1'])
    // RSI hidden: it owns no pane, so it is not in `paneKeys`
    expect(resolvePaneOrder(cs, ['inst:macd:1'])).toEqual([PRICE_PANE, 'inst:macd:1'])
    // …and shown again it returns to the top, where the member put it
    expect(resolvePaneOrder(cs, KEYS)).toEqual(['inst:rsi:1', PRICE_PANE, 'inst:macd:1'])
  })

  it('⚰️ REORDERING WHILE A PANE IS HIDDEN DOES NOT FORGET IT', () => {
    // ⚰️ THE BITE THAT DID NOT BITE. The case above only proved a stored key
    // survives being filtered out at READ time — it never wrote an order while
    // something was hidden. That is the write that loses it: the UI hands
    // `setPaneOrder` the VISIBLE stack, which has no RSI in it, so without the
    // carry-through RSI's remembered slot is dropped and un-hiding it sends the
    // pane to the bottom. Removing that one line left every other case green.
    let cs = setPaneOrder({}, ['inst:rsi:1', PRICE_PANE, 'inst:macd:1'])
    // RSI is hidden — the member reorders the two panes they can see.
    const visible = ['inst:macd:1']
    cs = movePane(cs, visible, 'inst:macd:1', -1)
    expect(resolvePaneOrder(cs, visible)).toEqual(['inst:macd:1', PRICE_PANE])
    // …and RSI comes back where it was put, not at the bottom.
    expect(storedPaneOrder(cs)).toContain('inst:rsi:1')
    expect(resolvePaneOrder(cs, ['inst:macd:1', 'inst:rsi:1'])[0]).not.toBe('inst:rsi:1')
    expect(resolvePaneOrder(cs, ['inst:macd:1', 'inst:rsi:1'])).toContain('inst:rsi:1')
  })

  it('⚰️ …and a DIRECT write while hidden keeps it too', () => {
    let cs = setPaneOrder({}, ['inst:rsi:1', PRICE_PANE, 'inst:macd:1'])
    cs = setPaneOrder(cs, [PRICE_PANE, 'inst:macd:1'])   // the visible stack only
    expect(storedPaneOrder(cs), 'the hidden pane was forgotten by a reorder')
      .toContain('inst:rsi:1')
  })

  it('⚰️ a NEW pane is APPENDED — it may not displace an arranged one', () => {
    // ⚰️⚰️ RE-PINNED 2026-09-15 — INVESTIGATED, the rule changed on purpose.
    // This asserted the opposite: "a NEW pane appears beside its default
    // neighbour, not always last", expecting
    //
    //     ['inst:rsi:1', 'inst:macd:1', PRICE_PANE]
    //
    // MACD lands above Price purely because its DEFAULT neighbour is RSI and
    // this member happens to have arranged RSI to the top. `dflt` is ordered by
    // the instance array, which `withInstances` re-sorts by DEFINITION RANK on
    // every canonical write — so a rank table was deciding where a member's new
    // pane appeared, and it could appear anywhere in their stack.
    //
    // ⛔ THE OWNER MEASURED THE CONSEQUENCE: adding an unrelated data series
    // moved panes they had placed. Nothing about adding MACD says anything about
    // where it belongs relative to a pane someone deliberately moved, so once an
    // arrangement exists it is authoritative and new panes go to the bottom.
    const cs = setPaneOrder({}, ['inst:rsi:1', PRICE_PANE])
    expect(resolvePaneOrder(cs, KEYS)).toEqual(['inst:rsi:1', PRICE_PANE, 'inst:macd:1'])
  })

  it('⛔⛔ EVERY pairwise relation the member established survives an add', () => {
    // The invariant the example above is one case of. Whatever else changes,
    // two panes the member ordered keep that order when a third appears.
    const cs = setPaneOrder({}, ['inst:rsi:1', PRICE_PANE])
    const before = resolvePaneOrder(cs, ['inst:rsi:1'])
    const after = resolvePaneOrder(cs, KEYS)
    for (let i = 0; i < before.length; i++) {
      for (let j = i + 1; j < before.length; j++) {
        expect(after.indexOf(before[i]) < after.indexOf(before[j]),
          `${before[i]} and ${before[j]} swapped when a pane was added: ${JSON.stringify(after)}`).toBe(true)
      }
    }
  })

  it('⭐ a separate volume pane appearing later lands under Price by default', () => {
    const cs = setPaneOrder({}, ['inst:rsi:1', PRICE_PANE])
    expect(resolvePaneOrder(cs, ['inst:rsi:1'], { volumePane: true }))
      .toEqual(['inst:rsi:1', PRICE_PANE, VOLUME_PANE])
  })
})

describe('the writers', () => {
  const base = () => setPaneOrder({}, [PRICE_PANE, 'inst:rsi:1', 'inst:macd:1'])

  it('⭐ Move up / Move down step one place', () => {
    let cs = base()
    cs = movePane(cs, KEYS, 'inst:rsi:1', -1)
    expect(resolvePaneOrder(cs, KEYS)).toEqual(['inst:rsi:1', PRICE_PANE, 'inst:macd:1'])
    cs = movePane(cs, KEYS, 'inst:rsi:1', 1)
    expect(resolvePaneOrder(cs, KEYS)).toEqual([PRICE_PANE, 'inst:rsi:1', 'inst:macd:1'])
  })

  it('⛔ the boundaries are no-ops, never a wrap', () => {
    const cs = base()
    expect(movePane(cs, KEYS, PRICE_PANE, -1)).toBe(cs)
    expect(movePane(cs, KEYS, 'inst:macd:1', 1)).toBe(cs)
  })

  it('⛔ an unknown key, a bad delta and an absent pane all refuse', () => {
    const cs = base()
    expect(movePane(cs, KEYS, 'nope', -1)).toBe(cs)
    expect(movePane(cs, KEYS, 'inst:rsi:1', 0)).toBe(cs)
    expect(movePane(cs, KEYS, 'inst:rsi:1', -2)).toBe(cs)
  })

  it('⭐ Move up steps over a HIDDEN neighbour rather than doing nothing', () => {
    // Stored: RSI, Price, MACD. RSI hidden ⇒ visible stack is Price, MACD.
    const cs = setPaneOrder({}, ['inst:rsi:1', PRICE_PANE, 'inst:macd:1'])
    const next = movePane(cs, ['inst:macd:1'], 'inst:macd:1', -1)
    expect(resolvePaneOrder(next, ['inst:macd:1'])).toEqual(['inst:macd:1', PRICE_PANE])
  })

  it('⭐⭐ drag and Move up produce the SAME stored state', () => {
    const cs = base()
    const byStep = movePane(cs, KEYS, 'inst:rsi:1', -1)
    const byDrag = movePaneTo(cs, KEYS, 'inst:rsi:1', PRICE_PANE)
    expect(resolvePaneOrder(byDrag, KEYS)).toEqual(resolvePaneOrder(byStep, KEYS))
  })

  it('⭐ dropping past the last pane puts it last', () => {
    const cs = movePaneTo(base(), KEYS, PRICE_PANE, null)
    expect(resolvePaneOrder(cs, KEYS)).toEqual(['inst:rsi:1', 'inst:macd:1', PRICE_PANE])
  })

  it('⛔ dropping a pane on itself changes nothing', () => {
    const cs = base()
    expect(movePaneTo(cs, KEYS, 'inst:rsi:1', 'inst:rsi:1')).toBe(cs)
  })

  it('⛔ the writer marks the blob custom, like every other settings write', () => {
    expect(setPaneOrder({}, [PRICE_PANE]).preset).toBe('custom')
  })

  it('⛔ it never mutates the blob it was handed', () => {
    const cs = base()
    const snap = JSON.stringify(cs)
    movePane(cs, KEYS, 'inst:rsi:1', -1)
    movePaneTo(cs, KEYS, 'inst:rsi:1', null)
    expect(JSON.stringify(cs)).toBe(snap)
  })
})

describe('duplicate hosts are independent', () => {
  it('⭐⭐ two QQQ panes have separate identities and move separately', () => {
    const dup = ['inst:dataSeries:1', 'inst:dataSeries:2']
    let cs = setPaneOrder({}, [PRICE_PANE, ...dup])
    cs = movePane(cs, dup, 'inst:dataSeries:2', -1)
    expect(resolvePaneOrder(cs, dup))
      .toEqual([PRICE_PANE, 'inst:dataSeries:2', 'inst:dataSeries:1'])
    cs = movePane(cs, dup, 'inst:dataSeries:2', -1)
    expect(resolvePaneOrder(cs, dup))
      .toEqual(['inst:dataSeries:2', PRICE_PANE, 'inst:dataSeries:1'])
  })
})

describe('persistence', () => {
  it('⭐⭐ reorder → serialise → reconstruct restores the exact order', () => {
    const cs = setPaneOrder({}, ['inst:macd:1', PRICE_PANE, VOLUME_PANE, 'inst:rsi:1'])
    const round = JSON.parse(JSON.stringify(cs))
    expect(resolvePaneOrder(round, KEYS, { volumePane: true }))
      .toEqual(['inst:macd:1', PRICE_PANE, VOLUME_PANE, 'inst:rsi:1'])
  })

  it('⛔ what is stored is a plain array of strings — nothing to migrate later', () => {
    const cs = setPaneOrder({}, [PRICE_PANE, 'inst:rsi:1'])
    expect(storedPaneOrder(cs)).toEqual([PRICE_PANE, 'inst:rsi:1'])
    expect(JSON.parse(JSON.stringify(cs))[PANE_ORDER_KEY]).toEqual([PRICE_PANE, 'inst:rsi:1'])
  })
})

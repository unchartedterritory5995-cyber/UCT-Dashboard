// app/src/components/chart/engine/__tests__/paneGuestSwap.test.js
//
// ─── A GUEST DOES NOT OWN A SLOT, AND MUST NOT DRAG PRICE INTO ONE ──────────
//
// ⚰️⚰️ THE OWNER'S PRODUCTION WORKFLOW, AND BOTH SYMPTOMS COME FROM IT.
// NVDA with Price and a separate Volume pane; open Chart Data; add a data
// series (QQQ). The series lands ON PRICE — Chart Data shows it as
// "Series · Line · Price" — and the moment it does, VOLUME JUMPS TO THE TOP.
//
// ⛔ CAPTURED IN THE REAL UI, at the `settleArrangement` boundary:
//
//   3-before-settle   0:[PRICE,guest] | 1:[VOLUME] | 2:[]
//                     order ["price","volume","inst:dataSeries:1"]
//                     paneOf  price->0  volume->1  guest->0
//   4-after-settle    0:[VOLUME] | 1:[PRICE,guest]
//
// The guest was still IN the pane order, so settle computed `want = slot 2` for
// it and asked where it lives. `paneOf` resolves an instance key through the
// binder to its SERIES — and a guest's series lives in PRICE's pane — so
// `have = 0`. It issued `swapPanes(0, 2)`, sending Price to 2 and the empty
// placeholder to 0; removing the placeholder left VOLUME ON TOP.
//
// ⭐⭐ AND THIS IS ALSO THE CRUSH. After the swap the LAYOUT still believes Price
// is at slot 0 of a three-pane stack while Price actually renders at 1, so its
// height and margins are computed for a pane it is not in. That is why the same
// topology could look fine in one frame and crushed in the next — the static
// geometry was never the whole story.
//
// ⛔ THE CAUSE WAS ONE MISSING CASE IN `paneFollowerKeys`. It classified a
// follower only via `parsePaneOfTarget`, which answers for `@pane:<instanceId>`
// and returns null for the plain targets `'price'` and `'volume'`. So an
// instance the member put ON THE CANDLES was never counted as a follower, kept a
// pane slot it did not have, and became the lever that moved Price.

import { describe, it, expect, afterEach } from 'vitest'
import { createChart, LineSeries } from 'lightweight-charts'
import { paneFollowerKeys, paneOwnKeys } from '../displayTarget'
import { settleArrangement } from '../paneRealization'
import { defaultPaneKeys } from '../paneLayout'
import { resolvePaneOrder, PRICE_PANE, VOLUME_PANE } from '../paneOrder'

// ⚠️ THE TARGET LIVES AT `placement.target`, and `'pane'` is written by DELETING
// the key — absent means "the definition's own answer", which for a data series
// is its own pane. Spelling it any other way tests a shape the product never
// stores.
const guest = (target) => (target === 'pane'
  ? { defId: 'dataSeries', instanceId: 'inst:dataSeries:1', inputs: {} }
  : { defId: 'dataSeries', instanceId: 'inst:dataSeries:1', inputs: {}, placement: { target } })

describe('⚰️⚰️ an instance displayed on Price is a FOLLOWER', () => {
  it('⛔ it reserves no pane of its own', () => {
    const keys = paneFollowerKeys([guest('price')], {})
    expect(keys.has('inst:dataSeries:1'),
      'a series drawn on the candles was given a pane slot').toBe(true)
  })

  it('⛔ …and so is one displayed on Volume', () => {
    expect(paneFollowerKeys([guest('volume')], {}).has('inst:dataSeries:1')).toBe(true)
  })

  it('⭐ an OWN-PANE instance is NOT a follower — the rail is not vacuous', () => {
    // ⚠️ RSI, NOT A DATA SERIES. `dataSeries` DECLARES `price` as its
    // definition-level target, so an instance of it with no stored placement is
    // a follower and always was — using it here would assert nothing. RSI
    // declares its own pane, so this is the case that can actually fail.
    const own = { defId: 'rsi', instanceId: 'inst:rsi:1', inputs: {} }
    expect(paneFollowerKeys([own], {}).has('inst:rsi:1'),
      'an own-pane indicator was classified as a follower').toBe(false)
    expect([...paneOwnKeys([own], {})]).toContain('inst:rsi:1')
  })

  it('⛔ and a data series left at its DEFINITION default is a follower too', () => {
    // Which is why the owner's QQQ landed on Price without them choosing that:
    // `dataSeries` declares `price`, so "Series · Line · Price" is the default.
    expect(paneFollowerKeys([guest('pane')], {}).has('inst:dataSeries:1')).toBe(true)
  })

  it('⚰️ the resolved pane ORDER therefore omits it', () => {
    const cs = {}
    const insts = [guest('price')]
    const order = resolvePaneOrder(
      cs,
      defaultPaneKeys(insts, { excludeKeys: paneFollowerKeys(insts, cs) }),
      { volumePane: true },
    )
    expect(order, 'the guest kept a slot in the visual order')
      .toEqual([PRICE_PANE, VOLUME_PANE])
  })
})

describe('⚰️⚰️ settle does not swap Price when a guest is present', () => {
  const open = []
  afterEach(() => {
    while (open.length) {
      const h = open.pop()
      try { h.chart.remove() } catch { /* going anyway */ }
      try { h.el.remove() } catch { /* idem */ }
    }
  })

  /** The owner's chart: Price at 0 with a guest in it, Volume at 1. */
  function priceVolumeWithGuest() {
    const el = document.createElement('div')
    document.body.appendChild(el)
    const chart = createChart(el, { width: 600, height: 500 })
    const bars = Array.from({ length: 10 }, (_, i) => ({
      time: `2026-09-${String(i + 1).padStart(2, '0')}`, value: 100 + i,
    }))
    const price = chart.addSeries(LineSeries, {}, 0); price.setData(bars)
    const vol = chart.addSeries(LineSeries, {}, 1); vol.setData(bars)
    const g = chart.addSeries(LineSeries, {}, 0); g.setData(bars)   // a GUEST in Price's pane
    // ⚠️ AND THE EMPTY PLACEHOLDER THE REAL CHART HAD. `paneCountRequired`
    // counted the guest, so `prepare` had reserved a third pane — that spare
    // slot is what made the swap reachable. Without it `moveKeyToSlot` refuses
    // the move and the bug cannot be reproduced at all.
    chart.addPane(true)
    const h = { el, chart, price, vol, g }
    open.push(h)
    return h
  }

  const membership = (h) => h.chart.panes().map((p) => {
    const set = new Set(p.getSeries())
    return [
      set.has(h.price) ? 'PRICE' : null,
      set.has(h.vol) ? 'VOLUME' : null,
      set.has(h.g) ? 'GUEST' : null,
    ].filter(Boolean).join('+')
  }).filter((x) => x !== '')

  it('⛔⛔ THE REGRESSION: a guest key in the order drags Price to its slot', () => {
    // The pre-fix state, reproduced deliberately — the guest IS in the order.
    const h = priceVolumeWithGuest()
    expect(membership(h)).toEqual(['PRICE+GUEST', 'VOLUME'])
    settleArrangement(h.chart, {
      order: [PRICE_PANE, VOLUME_PANE, 'inst:dataSeries:1'],
      priceKey: PRICE_PANE,
      paneOf: (k) => {
        if (k === PRICE_PANE) return h.price.getPane()
        if (k === VOLUME_PANE) return h.vol.getPane()
        return h.g.getPane()          // ⚰️ the guest reports PRICE's pane
      },
    })
    // This is what the owner saw. The case exists so the fix below is not
    // proving something that could never have gone wrong.
    expect(membership(h)[0], 'the library stopped swapping — is the guest case still real?')
      .not.toBe('PRICE+GUEST')
  })

  it('⭐⭐ THE FIX: with the guest excluded, nothing moves', () => {
    const h = priceVolumeWithGuest()
    const cs = {}
    const insts = [guest('price')]
    // The order the product now builds — `paneFollowerKeys` drops the guest.
    const order = resolvePaneOrder(
      cs,
      defaultPaneKeys(insts, { excludeKeys: paneFollowerKeys(insts, cs) }),
      { volumePane: true },
    )
    settleArrangement(h.chart, {
      order,
      priceKey: PRICE_PANE,
      paneOf: (k) => {
        if (k === PRICE_PANE) return h.price.getPane()
        if (k === VOLUME_PANE) return h.vol.getPane()
        return h.g.getPane()
      },
    })
    expect(membership(h), 'Volume moved when an unrelated series was added to Price')
      .toEqual(['PRICE+GUEST', 'VOLUME'])
  })
})

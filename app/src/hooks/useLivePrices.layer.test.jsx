// Live prices on a hidden LAYER board (2026-11-27, the board keep-alive's layer mode; boardVisibility.js). The board
// stays mounted, so its charts' and lists' price hooks would keep their tickers in the 2 s poll and the price stream.
//   P1 (red first) a hidden layer board polls no price (its tickers leave the shared poll); they come back after the
//      show's first paint
//   P2 (red first) a hidden layer board streams no price (its tickers leave the stream)
//   P3 (red first) neither the hide nor the show re-renders either hook when nothing moved; while hidden their prices
//      are the ones held at the hide
//   P4 the <Activity> mode's handle changes nothing
//   P5 (red first) a poll landing while the board is hidden (another board keeps the ticker polled) re-renders nothing;
//      after the show's first paint the hook reads it once
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const reg = vi.hoisted(() => ({ live: new Map(), stream: new Map(), snap: { AAPL: { price: 1 } }, subs: new Set() }))
const bump = (m, list, d) => { for (const t of list) m.set(t, (m.get(t) || 0) + d) }
vi.mock('./livePriceStore', () => ({
  registerTickers: (list) => { bump(reg.live, list, 1); return () => bump(reg.live, list, -1) },
  subscribe: (fn) => { reg.subs.add(fn); return () => reg.subs.delete(fn) },
  getSnapshot: () => reg.snap,
  pollNow: () => {},
}))
vi.mock('../lib/priceStreamManager', () => {
  const snap = { prices: {}, staleSymbols: new Set(), connected: true }
  return {
    subscribe: (list) => { bump(reg.stream, list, 1); return () => bump(reg.stream, list, -1) },
    getSnapshot: () => snap,
  }
})

import useLivePrices from './useLivePrices'
import useRealtimePrices from './useRealtimePrices'
import { BoardVisibilityContext, createBoardVisibility } from '../components/chart/boardVisibility'

beforeEach(() => { reg.live.clear(); reg.stream.clear(); reg.snap = { AAPL: { price: 1 } } })
let renders = 0
const mount = (hook, vis) => renderHook(() => { renders++; return hook(['AAPL']) }, {
  wrapper: ({ children }) => <BoardVisibilityContext.Provider value={vis}>{children}</BoardVisibilityContext.Provider>,
})
const afterPaint = () => act(async () => { await new Promise((r) => setTimeout(r, 60)) })

describe('price hooks on a hidden layer board', () => {
  it('P1 (red first) a hidden layer board polls no price; the show registers it again', async () => {
    const vis = createBoardVisibility({ layer: true })
    const view = mount(useLivePrices, vis)
    expect(reg.live.get('AAPL'), 'NON-VACUITY: a visible board polls its ticker').toBe(1)
    act(() => { vis.set('hidden') })
    expect(reg.live.get('AAPL'), 'a hidden board kept its ticker in the poll').toBe(0)
    act(() => { vis.set('visible') })
    expect(reg.live.get('AAPL'), 'the show registered in its own task').toBe(0)
    await afterPaint()
    expect(reg.live.get('AAPL')).toBe(1)
    view.unmount()
  })

  it('P2 (red first) a hidden layer board streams no price', async () => {
    const vis = createBoardVisibility({ layer: true })
    const view = mount(useRealtimePrices, vis)
    expect(reg.stream.get('AAPL'), 'NON-VACUITY: a visible board streams its ticker').toBe(1)
    expect(reg.live.get('AAPL')).toBe(1)
    act(() => { vis.set('hidden') })
    expect(reg.stream.get('AAPL'), 'a hidden board kept its ticker in the stream').toBe(0)
    expect(reg.live.get('AAPL'), 'a hidden board kept its ticker in the poll').toBe(0)
    act(() => { vis.set('visible') })
    await afterPaint()
    expect(reg.stream.get('AAPL')).toBe(1)
    expect(reg.live.get('AAPL')).toBe(1)
    view.unmount()
  })

  it('P3 (red first) neither the hide nor the show re-renders the hooks when nothing moved', async () => {
    for (const hook of [useLivePrices, useRealtimePrices]) {
      const vis = createBoardVisibility({ layer: true })
      const view = mount(hook, vis)
      await afterPaint()
      const held = view.result.current.prices
      expect(Object.keys(held), 'NON-VACUITY: the hook reads a price').toEqual(['AAPL'])
      const before = renders
      act(() => { vis.set('hidden') })
      view.rerender()
      expect(view.result.current.prices, 'a hidden board saw its prices change').toBe(held)
      act(() => { vis.set('visible') })
      await afterPaint()
      expect(renders - before, `${hook.name}: the hide or the show re-rendered the reader`).toBe(1)   // the rerender() above
      view.unmount()
    }
  })

  it('P5 (red first) a poll landing while hidden re-renders nothing; the show reads it once', async () => {
    const vis = createBoardVisibility({ layer: true })
    const view = mount(useLivePrices, vis)
    await afterPaint()
    reg.snap = { AAPL: { price: 2 } }
    act(() => { for (const f of [...reg.subs]) f() })
    expect(view.result.current.prices.AAPL.price, 'NON-VACUITY: a shown board reads a poll').toBe(2)
    act(() => { vis.set('hidden') })
    const before = renders
    reg.snap = { AAPL: { price: 3 } }
    act(() => { for (const f of [...reg.subs]) f() })
    expect(renders - before, 'a poll re-rendered a hidden board').toBe(0)
    act(() => { vis.set('visible') })
    await afterPaint()
    expect(view.result.current.prices.AAPL.price, 'the show did not read the poll that landed while hidden').toBe(3)
    view.unmount()
  })

  it('P4 the <Activity> handle changes nothing', () => {
    const vis = createBoardVisibility()
    const view = mount(useRealtimePrices, vis)
    act(() => { vis.set('hidden') })
    expect(reg.stream.get('AAPL')).toBe(1)
    expect(reg.live.get('AAPL')).toBe(1)
    view.unmount()
  })
})

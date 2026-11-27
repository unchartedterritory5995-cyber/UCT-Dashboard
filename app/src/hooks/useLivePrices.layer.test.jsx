// Live prices on a hidden LAYER board (2026-11-27, the board keep-alive's layer mode; boardVisibility.js). The board
// stays mounted, so its charts' and lists' price hooks would keep their tickers in the 2 s poll and the price stream.
//   P1 (red first) a hidden layer board polls no price (its tickers leave the shared poll); they come back in the
//      show's own task (a new ticker is polled at once)
//   P2 (red first; review of #2901, M2) the price STREAM stays (one shared stream: no rebuild at a switch, a current
//      price at the show), only the poll leaves
//   P3 (red first) neither the hide nor the show re-renders either hook when nothing moved; while hidden their prices
//      are the ones held at the hide
//   P4 the <Activity> mode's handle changes nothing
//   P5 (red first) a poll landing while the board is hidden (another board keeps the ticker polled) re-renders nothing;
//      after the show's first paint the hook reads it once
//   P6 (red first; review of #2901, M2) a stream tick landing while the board is hidden re-renders nothing (the stream
//      stays subscribed); the show reads the current stream price in its own task
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const reg = vi.hoisted(() => ({ live: new Map(), stream: new Map(), snap: { AAPL: { price: 1 } }, subs: new Set(),
  ssnap: { prices: {}, staleSymbols: new Set(), connected: true }, ssubs: new Set() }))
const bump = (m, list, d) => { for (const t of list) m.set(t, (m.get(t) || 0) + d) }
vi.mock('./livePriceStore', () => ({
  registerTickers: (list) => { bump(reg.live, list, 1); return () => bump(reg.live, list, -1) },
  subscribe: (fn) => { reg.subs.add(fn); return () => reg.subs.delete(fn) },
  getSnapshot: () => reg.snap,
  pollNow: () => {},
}))
vi.mock('../lib/priceStreamManager', () => ({
  subscribe: (list, fn) => { bump(reg.stream, list, 1); reg.ssubs.add(fn); return () => { bump(reg.stream, list, -1); reg.ssubs.delete(fn) } },
  getSnapshot: () => reg.ssnap,
}))

import useLivePrices from './useLivePrices'
import useRealtimePrices from './useRealtimePrices'
import { BoardVisibilityContext, createBoardVisibility } from '../components/chart/boardVisibility'

beforeEach(() => {
  reg.live.clear(); reg.stream.clear(); reg.snap = { AAPL: { price: 1 } }
  reg.ssubs.clear(); reg.ssnap = { prices: {}, staleSymbols: new Set(), connected: true }
})
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
    expect(reg.live.get('AAPL'), 'the show did not register in its own task').toBe(1)
    view.unmount()
  })

  it('P2 (red first) a hidden layer board streams no price', async () => {
    const vis = createBoardVisibility({ layer: true })
    const view = mount(useRealtimePrices, vis)
    expect(reg.stream.get('AAPL'), 'NON-VACUITY: a visible board streams its ticker').toBe(1)
    expect(reg.live.get('AAPL')).toBe(1)
    act(() => { vis.set('hidden') })
    expect(reg.stream.get('AAPL'), 'a hidden board left the shared stream (a rebuild, a stale price at the show)').toBe(1)
    expect(reg.live.get('AAPL'), 'a hidden board kept its ticker in the poll').toBe(0)
    act(() => { vis.set('visible') })
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

  it('P6 (red first) a stream tick while hidden re-renders nothing; the show reads it in its own task', async () => {
    const vis = createBoardVisibility({ layer: true })
    const view = mount(useRealtimePrices, vis)
    await afterPaint()
    const tick = (price) => act(() => {
      reg.ssnap = { ...reg.ssnap, prices: { AAPL: { price, updated_at: Date.now() } } }
      for (const f of [...reg.ssubs]) f()
    })
    tick(5)
    expect(view.result.current.prices.AAPL?.price, 'NON-VACUITY: a shown board takes a stream tick').toBe(5)
    act(() => { vis.set('hidden') })
    const before = renders
    tick(6)
    tick(7)
    expect(renders - before, 'a stream tick re-rendered a hidden board').toBe(0)
    expect(reg.stream.get('AAPL'), 'the hidden board left the shared stream').toBe(1)
    act(() => { vis.set('visible') })
    expect(view.result.current.prices.AAPL?.price, 'the show did not read the stream in its own task').toBe(7)
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

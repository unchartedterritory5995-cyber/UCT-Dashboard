// Live prices on a hidden LAYER board (2026-11-27, the board keep-alive's layer mode; boardVisibility.js). The board
// stays mounted, so its charts' and lists' price hooks would keep their tickers in the 2 s poll and the price stream.
//   P1 (red first) a hidden layer board polls no price (its tickers leave the shared poll); the show registers them again
//   P2 (red first) a hidden layer board streams no price (its tickers leave the stream)
//   P3 while hidden both hooks return what they held at the hide (a chart sees no change until the show)
//   P4 the <Activity> mode's handle changes nothing
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const reg = vi.hoisted(() => ({ live: new Map(), stream: new Map() }))
const bump = (m, list, d) => { for (const t of list) m.set(t, (m.get(t) || 0) + d) }
vi.mock('./livePriceStore', () => {
  const snap = { AAPL: { price: 1 } }
  return {
    registerTickers: (list) => { bump(reg.live, list, 1); return () => bump(reg.live, list, -1) },
    subscribe: () => () => {},
    getSnapshot: () => snap,
    pollNow: () => {},
  }
})
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

beforeEach(() => { reg.live.clear(); reg.stream.clear() })
const mount = (hook, vis) => renderHook(() => hook(['AAPL']), {
  wrapper: ({ children }) => <BoardVisibilityContext.Provider value={vis}>{children}</BoardVisibilityContext.Provider>,
})

describe('price hooks on a hidden layer board', () => {
  it('P1 (red first) a hidden layer board polls no price; the show registers it again', () => {
    const vis = createBoardVisibility({ layer: true })
    const view = mount(useLivePrices, vis)
    expect(reg.live.get('AAPL'), 'NON-VACUITY: a visible board polls its ticker').toBe(1)
    act(() => { vis.set('hidden') })
    expect(reg.live.get('AAPL'), 'a hidden board kept its ticker in the poll').toBe(0)
    act(() => { vis.set('visible') })
    expect(reg.live.get('AAPL')).toBe(1)
    view.unmount()
  })

  it('P2 (red first) a hidden layer board streams no price', () => {
    const vis = createBoardVisibility({ layer: true })
    const view = mount(useRealtimePrices, vis)
    expect(reg.stream.get('AAPL'), 'NON-VACUITY: a visible board streams its ticker').toBe(1)
    expect(reg.live.get('AAPL')).toBe(1)
    act(() => { vis.set('hidden') })
    expect(reg.stream.get('AAPL'), 'a hidden board kept its ticker in the stream').toBe(0)
    expect(reg.live.get('AAPL'), 'a hidden board kept its ticker in the poll').toBe(0)
    act(() => { vis.set('visible') })
    expect(reg.stream.get('AAPL')).toBe(1)
    view.unmount()
  })

  it('P3 while hidden both hooks return what they held at the hide', () => {
    for (const hook of [useLivePrices, useRealtimePrices]) {
      const vis = createBoardVisibility({ layer: true })
      const view = mount(hook, vis)
      const held = view.result.current
      expect(Object.keys(held.prices), 'NON-VACUITY: the hook reads a price').toEqual(['AAPL'])
      act(() => { vis.set('hidden') })
      expect(view.result.current, 'a hidden board saw its prices change at the hide').toBe(held)
      view.rerender()
      expect(view.result.current).toBe(held)
      view.unmount()
    }
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

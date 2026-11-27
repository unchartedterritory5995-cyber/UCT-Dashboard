/**
 * ⚡ (2026-11-26, the board switch) THE LIBRARY RAIL NEVER MOUNTS IN A PANE TOO NARROW FOR IT.
 * `narrow` started false, so every mount of a Watchlist on a board rendered the side rail (175 elements on his TEST
 * board) and took it away again once the pane's ResizeObserver reported the pane narrow: a wasted mount and removal on
 * every board switch (the bench probe: `_side` removed ~30 ms after the body mounted, every time). The width is decided
 * before the rail can mount: seeded with what THIS widget measured last time (WidgetDoorContext names it), else measured
 * in a layout effect before the first paint, with no side rail until it is known.
 *   N1 (red first) a narrow pane: the side rail never mounts
 *   N2 a wide pane: the side rail is on screen from the first paint (mounted before paint, once)
 *   N3 the same widget mounted again (a board switch back): narrow is known from its last measure, no width read at mount
 */
import { render, cleanup } from '@testing-library/react'
import { useState, useEffect } from 'react'
import { vi, describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest'

vi.mock('../useListSubscribeEnabled', () => ({ default: () => false }))
vi.mock('../../../hooks/useLivePrices', () => ({ default: () => ({ prices: {} }) }))
vi.mock('../../Watchlists', () => ({ default: ({ pickName }) => <div data-testid="list">table:{pickName}</div> }))
vi.mock('./WatchlistPicker', () => ({ default: () => <div>list-picker</div> }))
const railMounts = []
vi.mock('./LibraryRail', () => ({
  default: function Rail({ overlay }) {
    useEffect(() => { railMounts.push(overlay ? 'overlay' : 'side') }, [])
    return <nav data-testid="rail" data-overlay={overlay ? 'yes' : 'no'} />
  },
}))

import WatchlistWidget from './WatchlistWidget'
import { UctHeaderSlotContext } from '../uctHeaderSlot'
import { WidgetDoorContext } from '../widgetDoors'

// The pane's width, and how many times it was read. The ResizeObserver reports LATER (as a real one does, after layout),
// never inside observe().
let paneWidth = 200
let widthReads = 0
const RealRO = globalThis.ResizeObserver
const realWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
beforeAll(() => {
  globalThis.ResizeObserver = class { constructor(cb) { this.cb = cb } observe() {} disconnect() {} }
  window.ResizeObserver = globalThis.ResizeObserver
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => { widthReads++; return paneWidth } })
})
afterAll(() => {
  globalThis.ResizeObserver = RealRO
  window.ResizeObserver = RealRO
  if (realWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', realWidth)
})
afterEach(() => { cleanup(); railMounts.length = 0; widthReads = 0 })

function Board({ door = null }) {
  const [opts, setOpts] = useState({ watchKey: 'flagged', watchName: 'Flagged', watchTab: 'mine', libraryRail: true })
  const [ctrl] = useState(() => document.createElement('span'))
  return (
    <WidgetDoorContext.Provider value={door}>
      <UctHeaderSlotContext.Provider value={{ row: null, rowAlways: null, controls: ctrl, claim: null }}>
        <WatchlistWidget color="A" opts={opts} onOptsChange={setOpts} />
      </UctHeaderSlotContext.Provider>
    </WidgetDoorContext.Provider>
  )
}

describe('the library rail and a narrow pane', () => {
  it('N1 (red first) a narrow pane: the side rail never mounts', () => {
    paneWidth = 200
    render(<Board />)
    expect(railMounts.filter((m) => m === 'side'), 'the side rail mounted in a pane too narrow for it').toEqual([])
  })

  it('N2 a wide pane: the side rail is there from the first paint, mounted once', () => {
    paneWidth = 800
    const { getByTestId } = render(<Board />)
    expect(getByTestId('rail').getAttribute('data-overlay')).toBe('no')
    expect(railMounts).toEqual(['side'])
  })

  it('N3 the same widget mounted again knows its width from its last measure: no width read at mount', () => {
    paneWidth = 200
    const first = render(<Board door="board~wl-1" />)
    first.unmount()
    widthReads = 0
    render(<Board door="board~wl-1" />)
    expect(widthReads, 'the remount read the pane width again').toBe(0)
    expect(railMounts.filter((m) => m === 'side')).toEqual([])
  })
})

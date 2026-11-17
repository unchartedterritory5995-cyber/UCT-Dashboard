/**
 * Owner 11-15 (live bug): a Watchlist just added to an empty board is narrow, so its library
 * slides OVER the list, shown only by `opts.libraryFresh`. The first click on a library tab
 * cleared that flag — and the library vanished. It must stay open; only a pick, the scrim or
 * the toggle closes it.
 */
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import { useState } from 'react'
import { vi, describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest'

vi.mock('../useListSubscribeEnabled', () => ({ default: () => false }))
vi.mock('../../../hooks/useLivePrices', () => ({ default: () => ({ prices: {} }) }))
vi.mock('../../Watchlists', () => ({ default: ({ pickName }) => <div data-testid="list">table:{pickName}</div> }))
vi.mock('./WatchlistPicker', () => ({ default: () => <div>list-picker</div> }))
vi.mock('./LibraryRail', () => ({
  default: ({ tab, onTab, overlay }) => (
    <nav data-testid="rail" data-overlay={overlay ? 'yes' : 'no'} data-tab={tab}>
      {['prebuilt', 'community', 'mine'].map((t) => <button key={t} type="button" onClick={() => onTab(t)}>{t}</button>)}
    </nav>
  ),
}))

import WatchlistWidget from './WatchlistWidget'
import { UctHeaderSlotContext } from '../uctHeaderSlot'

// A narrow widget: every element measures 200px wide, under the side-by-side minimum.
const RealRO = globalThis.ResizeObserver
const realWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
beforeAll(() => {
  globalThis.ResizeObserver = class { constructor(cb) { this.cb = cb } observe() { this.cb([]) } disconnect() {} }
  window.ResizeObserver = globalThis.ResizeObserver
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 200 })
})
afterAll(() => {
  globalThis.ResizeObserver = RealRO
  window.ResizeObserver = RealRO
  if (realWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', realWidth)
})
afterEach(cleanup)

function Board() {
  const [opts, setOpts] = useState({ watchKey: 'flagged', watchName: 'Flagged', watchTab: 'mine', libraryRail: true, libraryFresh: true })
  const [ctrl] = useState(() => document.createElement('span'))
  return (
    <UctHeaderSlotContext.Provider value={{ row: null, rowAlways: null, controls: ctrl, claim: null }}>
      <WatchlistWidget color="A" opts={opts} onOptsChange={setOpts} />
      <output data-testid="fresh">{String(opts.libraryFresh)}</output>
    </UctHeaderSlotContext.Provider>
  )
}

describe('Flagged is titled with the signed-in person\'s own label (owner 11-15)', () => {
  it('a saved name from another account never reaches the title', () => {
    function Saved() {
      const [opts, setOpts] = useState({ watchKey: 'flagged', watchName: 'Flagged (Someone Else)', watchTab: 'mine', libraryRail: false })
      const [ctrl] = useState(() => document.createElement('span'))
      return (
        <UctHeaderSlotContext.Provider value={{ row: null, rowAlways: null, controls: ctrl, claim: null }}>
          <WatchlistWidget color="A" opts={opts} onOptsChange={setOpts} />
        </UctHeaderSlotContext.Provider>
      )
    }
    render(<Saved />)
    expect(screen.getByTestId('list').textContent).not.toMatch(/Someone Else/)
    expect(screen.getByTestId('list').textContent).toMatch(/Flagged/)
  })
})

describe('a just-added narrow Watchlist keeps its library open on the first click (owner 11-15)', () => {
  it('clicking Community, then My Lists, keeps the library showing', async () => {
    render(<Board />)
    expect(screen.getByTestId('rail').dataset.overlay).toBe('yes')       // fresh: slid over the list
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'community' })) })
    expect(screen.getByTestId('fresh').textContent).toBe('null')          // the flag is cleared…
    expect(screen.getByTestId('rail').dataset.tab).toBe('community')     // …and the library is still there
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'mine' })) })
    expect(screen.getByTestId('rail').dataset.tab).toBe('mine')
  })
})

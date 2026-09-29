/**
 * TERM-079 (FB-S4-01) — ⛔⛔ A CONTEXT BUS IS A RE-RENDER SOURCE (PERF-4).
 *
 * 2026-09-10: `useHubMode` re-registered on identity change, the hub context value
 * changed on every registration, every consumer re-rendered, and navigation froze
 * app-wide for four and a half hours (`CatalystTable.renderLoop.test.jsx`, rule H14).
 * The architectural fix from that incident is this module's rule: the board's
 * context value is ONE object created once per mount, so being inside the board
 * can never re-render anyone — only a CHANGE on the channel you read can.
 *
 * This file counts renders of real subscriber components and asserts four things,
 * each with a bounded number, never "it didn't hang":
 *   1. publishing on channel X does not re-render a subscriber of channel Y;
 *   2. publishing a value EQUAL to the held one re-renders nobody;
 *   3. the board's host re-rendering re-renders no subscriber (the provider value
 *      is stable — this is the one an unmemoised value turns red);
 *   4. a burst of publishes settles in a bounded number of renders.
 */
import { render, act, cleanup } from '@testing-library/react'
import { memo, useState, useEffect } from 'react'
import { describe, it, expect, afterEach } from 'vitest'

import {
  KIND,
  channelFor,
  createChannelStore,
  listRefCtx,
  symbolSetCtx,
  ContextChannelsProvider,
  useChannel,
  usePublish,
} from './contextChannels'

/** A settled mount renders each subscriber once (twice at most under StrictMode). */
const CAP = 60

afterEach(() => cleanup())

const X = channelFor(KIND.LIST_REF, 'A')
const Y = channelFor(KIND.LIST_REF, 'B')

function makeCounter() {
  const counts = { x: 0, y: 0, pub: 0 }
  // memo(): the only thing that can re-render these is context or a store change —
  // exactly what the rail measures. A parent render alone must not reach them.
  const SubX = memo(function SubX() {
    counts.x += 1
    if (counts.x > CAP) throw new Error(`SubX render loop: ${counts.x}`)
    const v = useChannel(X)
    return <span data-testid="x">{v ? v.value : '-'}</span>
  })
  const SubY = memo(function SubY() {
    counts.y += 1
    if (counts.y > CAP) throw new Error(`SubY render loop: ${counts.y}`)
    const v = useChannel(Y)
    return <span data-testid="y">{v ? v.value : '-'}</span>
  })
  return { counts, SubX, SubY }
}

function mount(store) {
  const { counts, SubX, SubY } = makeCounter()
  let bumpHost = () => {}
  function Host() {
    const [n, setN] = useState(0)
    bumpHost = () => setN((v) => v + 1)
    return (
      <ContextChannelsProvider store={store}>
        <span data-testid="n">{n}</span>
        <SubX />
        <SubY />
      </ContextChannelsProvider>
    )
  }
  const utils = render(<Host />)
  return { ...utils, counts, bumpHost: () => act(() => bumpHost()) }
}

describe('⛔ the channel board cannot become a render loop', () => {
  it('1) publishing on X does not re-render a subscriber of Y', () => {
    const store = createChannelStore()
    const { counts } = mount(store)
    const y0 = counts.y
    const x0 = counts.x
    act(() => { store.publish(X, listRefCtx({ source: 'watchlist', value: '1' }), 'P') })
    act(() => { store.publish(X, listRefCtx({ source: 'watchlist', value: '2' }), 'P') })
    expect(counts.y).toBe(y0)            // untouched
    expect(counts.x).toBe(x0 + 2)        // exactly one render per real change
  })

  it('2) publishing a value EQUAL to the held one re-renders nobody', () => {
    const store = createChannelStore()
    const { counts } = mount(store)
    act(() => { store.publish(X, listRefCtx({ source: 'watchlist', value: '1', label: 'L' }), 'P') })
    const x1 = counts.x
    const y1 = counts.y
    for (let i = 0; i < 5; i += 1) {
      act(() => { store.publish(X, listRefCtx({ source: 'watchlist', value: '1', label: 'L' }), 'P') })
    }
    expect(counts.x).toBe(x1)
    expect(counts.y).toBe(y1)
  })

  it('3) the board host re-rendering re-renders no subscriber (the provider value is stable)', () => {
    const { counts, bumpHost, getByTestId } = mount(createChannelStore())
    const x0 = counts.x
    const y0 = counts.y
    for (let i = 0; i < 5; i += 1) bumpHost()
    expect(getByTestId('n').textContent).toBe('5')   // the host really did re-render
    expect(counts.x).toBe(x0)
    expect(counts.y).toBe(y0)
  })

  it('3b) the provider value is stable even when the board owns its store (no `store` prop)', () => {
    const { counts, bumpHost } = mount(undefined)
    const x0 = counts.x
    for (let i = 0; i < 5; i += 1) bumpHost()
    expect(counts.x).toBe(x0)
  })

  it('3c) a refused publish re-renders nobody', () => {
    const store = createChannelStore()
    const { counts } = mount(store)
    const x0 = counts.x
    act(() => { store.publish(X, symbolSetCtx(['NVDA']), 'Wrong') })
    expect(counts.x).toBe(x0)
  })

  it('4) a publisher that republishes on every render settles — 200 alternating publishes stay bounded', () => {
    const store = createChannelStore()
    const { counts } = mount(store)
    const x0 = counts.x
    act(() => {
      for (let i = 0; i < 200; i += 1) store.publish(X, listRefCtx({ source: 'watchlist', value: String(i % 2) }), 'P')
    })
    // React batches inside one act(): the subscriber commits the final value, not 200 times.
    expect(counts.x - x0).toBeLessThanOrEqual(2)
    expect(counts.y).toBeLessThanOrEqual(2)
  })

  it('4b) a panel that publishes from an effect on every render of its own does not loop', () => {
    const counts = { pub: 0 }
    function EagerPublisher() {
      counts.pub += 1
      if (counts.pub > CAP) throw new Error(`EagerPublisher render loop: ${counts.pub}`)
      const { publish } = usePublish(X, 'Eager')
      const v = useChannel(X)   // it also READS what it publishes — the 2026-09-10 shape
      useEffect(() => { publish(listRefCtx({ source: 'watchlist', value: '7' })) })
      return <span>{v ? v.value : '-'}</span>
    }
    render(<ContextChannelsProvider><EagerPublisher /></ContextChannelsProvider>)
    // Mount, then one re-render when its own publish lands, then the equal-value
    // publish from that render is a no-op. Bounded well under CAP.
    expect(counts.pub).toBeLessThanOrEqual(4)
  })
})

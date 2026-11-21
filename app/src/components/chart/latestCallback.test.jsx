import { describe, it, expect } from 'vitest'
import { Suspense, startTransition, useLayoutEffect, useState } from 'react'
import { render, act, cleanup } from '@testing-library/react'
import { useRenderBox } from './latestCallback'

// useRenderBox's two reads (latestCallback.js): `box.x` is the NEWEST render's value, `box.committed.x` the last
// COMMITTED render's. A render React abandons (an interrupted transition) has already `put` its values, so code
// that runs after a commit must read `committed` or it indexes bars the chart on screen does not show.

const never = new Promise(() => {})
function Gate({ hold }) { if (hold) throw never; return null }

function harness() {
  const io = { set: null, readCommitted: null, readLive: null }
  function Probe({ v }) {
    const box = useRenderBox()
    box.put('bars', v)
    // a handler made in this render, as StockChart's are: reads at use time. Written DURING render on purpose: an
    // abandoned render's handler is exactly the one an event can reach.
    // eslint-disable-next-line react-hooks/immutability -- the test captures what THIS render made
    io.readCommitted = () => box.committed.bars
    // eslint-disable-next-line react-hooks/immutability -- the test captures what THIS render made
    io.readLive = () => box.bars
    return <span data-testid="shown">{v}</span>
  }
  function App() {
    const [s, setS] = useState({ v: 'A', hold: false })
    // eslint-disable-next-line react-hooks/immutability -- the test drives the state from outside
    io.set = setS
    return (
      <>
        <Probe v={s.v} />
        <Suspense fallback={null}><Gate hold={s.hold} /></Suspense>
      </>
    )
  }
  return { io, App }
}

describe('useRenderBox: the committed copy', () => {
  it('an interrupted transition renders B and never commits it: an event still reads A', async () => {
    cleanup()
    const { io, App } = harness()
    const out = render(<App />)
    expect(io.readCommitted()).toBe('A')
    // B renders inside a transition that suspends (a sibling throws): React keeps A on screen, B never commits
    await act(async () => { startTransition(() => io.set({ v: 'B', hold: true })) })
    expect(out.getByTestId('shown').textContent).toBe('A')
    expect(io.readLive()).toBe('B')          // the control: the abandoned render DID put its values
    expect(io.readCommitted()).toBe('A')     // what the chart on screen shows
    // B committed for real: the committed copy follows
    await act(async () => { io.set({ v: 'B', hold: false }) })
    expect(out.getByTestId('shown').textContent).toBe('B')
    expect(io.readCommitted()).toBe('B')
  })

  it('the copy is made before every layout effect of the commit, a child\'s included', () => {
    cleanup()
    const seen = []
    function Child({ box }) {
      // a child's layout effect runs BEFORE its parent's: a copy made in the parent's layout effect is one render late here
      useLayoutEffect(() => { seen.push(box.committed.bars) })
      return null
    }
    function Parent({ v }) {
      const box = useRenderBox()
      box.put('bars', v)
      return <Child box={box} />
    }
    const out = render(<Parent v="A" />)
    out.rerender(<Parent v="B" />)
    expect(seen).toEqual(['A', 'B'])
  })

  it('keeps only its own fields out of the copy', () => {
    cleanup()
    let box = null
    function P() {
      const b = useRenderBox()
      b.put('bars', 1)
      b.put('data', 2)
      useLayoutEffect(() => { box = b })
      return null
    }
    render(<P />)
    expect(Object.keys(box.committed).sort()).toEqual(['bars', 'data'])
  })
})

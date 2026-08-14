// The dark-pool overlay must never crash its host on an unexpected response.
//
// ⛔ THE BUG THIS EXISTS FOR (found 2026-08-14): the hook stored
// `j?.prints || j || []`, so a 200 whose body is an OBJECT without a `prints`
// key (an error payload, a shape change) stored the OBJECT. The filter helpers
// guarded with `!prints || prints.length === 0`, which a non-array passes, and
// the next `.map` threw "prints.map is not a function" — an uncaught error
// inside <TickerPopup>, the app's UNIVERSAL ticker surface, so the whole chart
// modal died for every caller. It surfaced as two LiveFlow popup tests failing
// with "chart-modal not found", which is what an unmounted crash looks like.
//
// ⚠️ THIS FILE'S FIRST DRAFT WAS VACUOUS. With renderHook + waitFor, the throw
// happens in a RE-RENDER (after the fetch resolves), which vitest reports as an
// unhandled error while the assertions still pass — 9 green with
// "prints.map is not a function" printed above them. Mutation-checking is what
// caught it. The hook is therefore rendered under an ERROR BOUNDARY and the
// test asserts the boundary caught NOTHING, so a crash fails the test rather
// than decorating its output.
import { Component } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { useDarkPoolBars } from './useDarkPoolBars'

const respond = (body, ok = true) =>
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok, json: () => Promise.resolve(body) })))

afterEach(() => vi.unstubAllGlobals())

class Boundary extends Component {
  constructor(p) { super(p); this.state = { crashed: false } }
  static getDerivedStateFromError() { return { crashed: true } }
  render() {
    return this.state.crashed
      ? <div data-testid="crashed">crashed</div>
      : this.props.children
  }
}

function Probe({ sym = 'AMD', enabled = true }) {
  const bars = useDarkPoolBars(sym, enabled)
  return <div data-testid="bars" data-count={bars.length} data-array={String(Array.isArray(bars))} />
}

const draw = (props) => render(<Boundary><Probe {...props} /></Boundary>)

/** Fails on a crash instead of letting an unhandled error slip past. */
async function expectNoCrash() {
  await waitFor(() => expect(screen.getByTestId('bars')).toBeInTheDocument())
  expect(screen.queryByTestId('crashed'),
    'the dark-pool overlay crashed its host — the overlay is decoration, the '
    + 'popup is the product; it must degrade to "no overlay", never to a crash')
    .toBeNull()
  return screen.getByTestId('bars')
}

describe('useDarkPoolBars survives every response shape', () => {
  // The shapes a real endpoint can answer with. Objects are the ones that
  // crashed; the rest are kept so the guard can't be narrowed unnoticed.
  const SHAPES = [
    ['an error payload object', { detail: 'not found' }],
    ['an empty object', {}],
    ['a wrapper whose prints is not an array', { prints: { nope: 1 } }],
    ['null', null],
    ['a bare string', 'nope'],
    ['a number', 42],
  ]

  for (const [name, body] of SHAPES) {
    it(`degrades to no overlay on ${name}`, async () => {
      respond(body)
      draw()
      const el = await expectNoCrash()
      await waitFor(() => expect(el.getAttribute('data-array')).toBe('true'))
      expect(el.getAttribute('data-count')).toBe('0')
    })
  }

  it('still renders real prints — the guard did not just disable the feature', async () => {
    respond({ prints: [
      { price: 100, volume: 10, date: '8/13/2026', time: '10:00 AM' },
      { price: 100.5, volume: 20, date: '8/13/2026', time: '10:05 AM' },
      { price: 250, volume: 5, date: '8/13/2026', time: '11:00 AM' },
    ] })
    draw()
    const el = await expectNoCrash()
    // The two near-identical prices cluster; the far one stays separate.
    await waitFor(() => expect(el.getAttribute('data-count')).toBe('2'))
  })

  it('a bare array body (no wrapper) still works', async () => {
    respond([{ price: 100, volume: 10, date: '8/13/2026', time: '10:00 AM' }])
    draw()
    const el = await expectNoCrash()
    await waitFor(() => expect(el.getAttribute('data-count')).toBe('1'))
  })

  it('disabled fetches nothing', async () => {
    respond({ prints: [{ price: 1, volume: 1 }] })
    draw({ enabled: false })
    const el = await expectNoCrash()
    expect(el.getAttribute('data-count')).toBe('0')
    expect(fetch).not.toHaveBeenCalled()
  })
})

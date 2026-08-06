import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// ─── `window.__chartReady` IS A SETTLE SIGNAL, NOT A STOPWATCH ──────────────
//
// It used to be `setTimeout(() => { window.__chartReady = true }, 3500)`. The
// parity harness waits on it and screenshots, so EVERY parity number this repo
// has ever printed — including all of the zeros — was measured against a clock
// rather than against a settled canvas. That is a real defect and this file is
// its gate.
//
// ⛔ IT WAS NOT THE CAUSE OF THE 24-PIXEL ARTEFACT this docstring used to blame
// it for. That diagnosis was refuted: the 24 px reproduce with
// `--instances-side none` (legacy vs legacy, no engine at all), both render
// states appear on BOTH sides at the same rate, and every capture was proven
// pixel-stable. The cause is a bistable rasterisation of the candle series'
// dashed last-price line, and the fix is `?priceline=0`
// (`docs/runbooks/chart-parity-gate.md`).
//
// Two properties are pinned here, and they pull in OPPOSITE directions on
// purpose:
//
//   * the flag must NOT fire merely because 3.5 s elapsed — that is the defect;
//   * it must NEVER fire EARLIER than 3.5 s — a conservative no-regression
//     measure. (NOT because the Morning Wire → Substack renderer consumes the
//     flag: it does not. `grep -rn "__chartReady" <morning-wire>` is empty; that
//     renderer waits on its own canvas-size predicate plus a 1,600 ms settle.
//     Four documents asserted that dependency and none of them checked it.)
//
// jsdom cannot rasterise a chart, so the canvas is stubbed and the QUESTION
// asked is the one that actually matters: does the flag follow what the pixels
// are doing, or does it follow the clock?

const H = vi.hoisted(() => ({ props: [], reset() { H.props.length = 0 } }))

// A stub that puts a real <canvas> inside #chart-export — the element the
// stability detector samples. Without one there is nothing to sample, which is
// itself a case below.
vi.mock('../components/StockChart', () => ({
  default: (props) => {
    H.props.push(props)
    return <canvas data-testid="stock-chart" width={8} height={8} />
  },
}))

const { default: ChartRender } = await import('./ChartRender')

/** Install a 2D context whose pixels are constant, or change on every read. */
function stubCanvas({ changing }) {
  let n = 0
  const getImageData = vi.fn(() => {
    if (changing) n += 1
    return { data: new Uint8ClampedArray([n & 255, 7, 7, 255]) }
  })
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ getImageData }))
  return getImageData
}

/** No 2D context at all — `sample()` returns null and must NOT count as stable. */
function stubNoContext() {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null)
}

async function mount() {
  render(
    <MemoryRouter initialEntries={['/r/chart?sym=PARITY&tf=D']}>
      <ChartRender />
    </MemoryRouter>,
  )
  // The settings fetch fails closed to "no owner settings" (what a logged-out
  // capture gets); that rejection is what arms the readiness effect. Flushed by
  // hand rather than with `waitFor`, which schedules its own timers and stalls
  // under `useFakeTimers`.
  await act(async () => { await vi.advanceTimersByTimeAsync(1) })
  await act(async () => { await vi.advanceTimersByTimeAsync(1) })
  expect(H.props.length, 'the route never mounted the chart').toBeGreaterThan(0)
  expect(window.__chartReady, 'the readiness effect never armed').toBe(false)
}

const tick = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

const origGetContext = HTMLCanvasElement.prototype.getContext

beforeEach(() => {
  cleanup()
  H.reset()
  delete window.__chartReady
  delete window.__chartReadyMs
  delete window.__chartReadyReason
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('hermetic'))))
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] })
})

afterEach(() => {
  vi.useRealTimers()
  HTMLCanvasElement.prototype.getContext = origGetContext
})

describe('ChartRender — window.__chartReady', () => {
  it('a canvas that HOLDS STILL is ready just after the 3.5s floor, and says why', async () => {
    stubCanvas({ changing: false })
    await mount()

    await tick(3000)
    expect(window.__chartReady,
      'fired BEFORE the 3.5s floor — the Substack renderer has always had that settle').toBe(false)

    await tick(1000)
    expect(window.__chartReady).toBe(true)
    expect(window.__chartReadyReason).toBe('stable')
    expect(window.__chartReadyMs).toBeGreaterThanOrEqual(3500)
  })

  it('a canvas that KEEPS CHANGING is NOT ready at 3.5s — the timer alone is not the signal', async () => {
    stubCanvas({ changing: true })
    await mount()

    // The exact moment the deleted implementation flipped the flag.
    await tick(3600)
    expect(window.__chartReady,
      'ready while the pixels are still moving — this is the defect, restored').toBe(false)

    // …still not, well past it.
    await tick(6000)
    expect(window.__chartReady).toBe(false)

    // …and it does not hang a capture forever: the ceiling fires and SAYS it did,
    // so the harness can report that the double-capture is the only thing left
    // holding the line.
    await tick(12000)
    expect(window.__chartReady).toBe(true)
    expect(window.__chartReadyReason).toBe('ceiling')
  })

  it('nothing to sample counts as NOT stable, never as stable-by-default', async () => {
    // A missing 2D context (or no canvas at all) must ride to the ceiling. The
    // fail-toward-waiting direction: hashing "nothing" and calling it settled
    // would reproduce the stopwatch with extra steps.
    stubNoContext()
    await mount()

    await tick(4000)
    expect(window.__chartReady).toBe(false)

    await tick(17000)
    expect(window.__chartReady).toBe(true)
    expect(window.__chartReadyReason).toBe('ceiling')
  })

  it('the flag starts FALSE and is re-armed on every render of the route', async () => {
    stubCanvas({ changing: false })
    await mount()
    expect(window.__chartReady).toBe(false)
  })
})

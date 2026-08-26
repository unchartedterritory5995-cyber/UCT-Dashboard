import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// With `?compare=`, the overlays are a second fetch StockChart makes on its own.
// Measured 2026-08-25: a compare render captured on the first-bars latch alone
// showed the % scale and no lines. These pin that `window.__chartBarsReady`
// waits for BOTH signals when comparisons are asked for, and for the base
// latch alone when they are not. The mock hands its props to the test so the
// two callbacks can be fired in either order.

vi.mock('../components/StockChart', async () => {
  const React = await import('react')
  return {
    default: (props) => {
      React.useEffect(() => { globalThis.__chartProps = props }, [props])
      return <canvas data-testid="stock-chart" width={8} height={8} />
    },
  }
})

const { default: ChartRender } = await import('./ChartRender')

function mount(query) {
  return render(
    <MemoryRouter initialEntries={[`/r/chart?${query}`]}>
      <ChartRender />
    </MemoryRouter>,
  )
}
const fire = (name) => act(() => { globalThis.__chartProps[name]?.() })

beforeEach(() => { window.__chartBarsReady = 'stale-from-a-previous-page' })
afterEach(() => { cleanup(); delete globalThis.__chartProps })

describe('ChartRender readiness with ?compare=', () => {
  it('waits for the overlays as well as the base bars', () => {
    mount('sym=NVDA&tf=D&compare=SPY,QQQ')
    expect(window.__chartBarsReady).toBe(false)
    fire('onBarsReady')
    expect(window.__chartBarsReady).toBe(false)          // the base latch alone is not enough
    fire('onComparisonsReady')
    expect(window.__chartBarsReady).toBe(true)
  })

  it('accepts the two signals in either order', () => {
    mount('sym=NVDA&tf=D&compare=SPY')
    fire('onComparisonsReady')
    expect(window.__chartBarsReady).toBe(false)
    fire('onBarsReady')
    expect(window.__chartBarsReady).toBe(true)
  })

  it('needs only the base latch when nothing is compared', () => {
    mount('sym=NVDA&tf=D')
    expect(typeof globalThis.__chartProps.onComparisonsReady).toBe('function')
    fire('onBarsReady')
    expect(window.__chartBarsReady).toBe(true)
  })
})

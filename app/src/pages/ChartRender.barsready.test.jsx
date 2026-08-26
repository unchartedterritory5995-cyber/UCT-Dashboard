import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// The Discord renderer must never capture a chart that has no bars yet. The
// page publishes `window.__chartBarsReady` from StockChart's first-bars latch;
// these pin that it starts FALSE on every mount and flips only when StockChart
// says so. The mock fires the latch on mount only when told to.

vi.mock('../components/StockChart', async () => {
  const React = await import('react')
  return {
    default: (props) => {
      React.useEffect(() => { if (globalThis.__fireBarsReady) props.onBarsReady?.() }, [])
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

beforeEach(() => { window.__chartBarsReady = 'stale-from-a-previous-page' })
afterEach(() => { cleanup(); delete globalThis.__fireBarsReady })

describe('ChartRender window.__chartBarsReady', () => {
  it('is false on mount until StockChart reports its first bars', () => {
    globalThis.__fireBarsReady = false
    mount('sym=NVDA&tf=5&bars=110')
    expect(window.__chartBarsReady).toBe(false)
  })

  it('flips to true when StockChart fires onBarsReady', () => {
    globalThis.__fireBarsReady = true
    mount('sym=NVDA&tf=5&bars=110')
    expect(window.__chartBarsReady).toBe(true)
  })
})

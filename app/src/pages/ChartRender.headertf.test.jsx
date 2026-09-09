import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// The header price/change badge used to always fetch `tf=D` bars regardless of
// the page's own `?tf=`, so a Weekly or Hourly render showed the DAILY
// close/change in its header while the chart below it plotted a different
// timeframe entirely (see the comment above the effect in ChartRender.jsx).

vi.mock('../components/StockChart', () => ({
  default: () => <canvas data-testid="stock-chart" width={8} height={8} />,
}))

const { default: ChartRender } = await import('./ChartRender')

function mount(query) {
  return render(
    <MemoryRouter initialEntries={[`/r/chart?${query}`]}>
      <ChartRender />
    </MemoryRouter>,
  )
}

function stubBarsByTf(barsByTf) {
  vi.stubGlobal('fetch', vi.fn((input) => {
    const url = String(typeof input === 'string' ? input : (input?.url || ''))
    if (url.includes('/api/ticker-meta/')) {
      return Promise.resolve({ ok: true, json: async () => ({ name: '' }) })
    }
    if (url.includes('/api/bars/')) {
      const m = url.match(/[?&]tf=([^&]+)/)
      const tf = m ? decodeURIComponent(m[1]) : null
      const bars = barsByTf[tf]
      if (bars) return Promise.resolve({ ok: true, json: async () => ({ bars }) })
    }
    return Promise.resolve({ ok: false })
  }))
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ChartRender header meta fetch', () => {
  it('reads bars for the PAGE tf on a Weekly render, not a hardcoded Daily', async () => {
    stubBarsByTf({
      D: [{ c: 100 }, { c: 101 }],
      W: [{ c: 200 }, { c: 210 }],
    })
    mount('sym=QQQ&tf=W')
    await waitFor(() => expect(screen.getByText('$210.00')).toBeTruthy())
    expect(fetch.mock.calls.some(([u]) => String(u).includes('/api/bars/') && String(u).includes('tf=W'))).toBe(true)
    expect(fetch.mock.calls.some(([u]) => String(u).includes('/api/bars/') && String(u).includes('tf=D'))).toBe(false)
  })

  it('reads bars for the PAGE tf on an Hourly render', async () => {
    stubBarsByTf({
      D: [{ c: 100 }, { c: 101 }],
      60: [{ c: 719.06 }, { c: 718.96 }],
    })
    mount('sym=QQQ&tf=60')
    await waitFor(() => expect(screen.getByText('$718.96')).toBeTruthy())
    expect(fetch.mock.calls.some(([u]) => String(u).includes('/api/bars/') && String(u).includes('tf=60'))).toBe(true)
  })

  it('still reads Daily bars on a Daily render', async () => {
    stubBarsByTf({ D: [{ c: 50 }, { c: 55 }] })
    mount('sym=SPY&tf=D')
    await waitFor(() => expect(screen.getByText('$55.00')).toBeTruthy())
  })
})

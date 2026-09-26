import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// `window.__chartHeaderReady` — the header (company, price, change) is DOM text filled from
// its own lookups, which neither readiness flag waited for. 2026-09-25: the first /chart after
// a web deploy captured AMD's weekly header as just "AMD W". The house renderer now waits on
// this flag (`=== false` holds it), so it must start false, flip once the lookups SETTLE —
// success or failure — and be true at once when the URL already carries the header.

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

let realFetch
beforeEach(() => { realFetch = globalThis.fetch; window.__chartHeaderReady = 'stale-from-a-previous-page' })
afterEach(() => { cleanup(); globalThis.fetch = realFetch })

describe('ChartRender window.__chartHeaderReady', () => {
  it('is false while the header lookups are in flight and true once they land', async () => {
    let release
    const gate = new Promise((r) => { release = r })
    globalThis.fetch = vi.fn(async (url) => {
      await gate
      const body = String(url).includes('/api/ticker-meta/')
        ? { name: 'Advanced Micro Devices, Inc.' }
        : { bars: [{ c: 560 }, { c: 630.63 }] }
      return { ok: true, json: async () => body }
    })
    mount('sym=AMD&tf=W&h=670')
    expect(window.__chartHeaderReady).toBe(false)
    release()
    await waitFor(() => expect(window.__chartHeaderReady).toBe(true))
  })

  it('still flips when the lookups FAIL — a broken endpoint costs a header, never a render', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('502') })
    mount('sym=AMD&tf=W&h=670')
    await waitFor(() => expect(window.__chartHeaderReady).toBe(true))
  })

  it('is true at once when the URL already carries the whole header', () => {
    globalThis.fetch = vi.fn(() => new Promise(() => {}))
    mount('sym=AMD&tf=W&h=670&company=Advanced%20Micro%20Devices&price=630.63&chg=12.65')
    expect(window.__chartHeaderReady).toBe(true)
    expect(globalThis.fetch).not.toHaveBeenCalledWith(expect.stringContaining('/api/ticker-meta/'))
  })
})

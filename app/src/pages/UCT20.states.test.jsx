// U20: a failed leadership read is a failure with Retry, never "not yet available — check
// back"; the portfolio tile never tells members to run the engine (quality pass 2026-10-05).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders, screen } from '../test-utils'
import { SWRConfig } from 'swr'
import UCT20 from './UCT20'
import UCT20Performance from '../components/tiles/UCT20Performance'

afterEach(() => { vi.unstubAllGlobals() })
const route = (map) => vi.fn((url) => {
  const k = Object.keys(map).find((p) => String(url).includes(p))
  const [status, body] = k ? map[k] : [200, {}]
  return Promise.resolve({ ok: status < 300, status, json: async () => body })
})
const fresh = (el) => <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>{el}</SWRConfig>

describe('UCT 20 states', () => {
  it('a 503 on /api/leadership reads as could-not-read with Retry', async () => {
    vi.stubGlobal('fetch', route({ '/api/leadership': [503, { detail: 'down' }] }))
    renderWithProviders(fresh(<UCT20 />))
    expect((await screen.findByTestId('uct20-error')).textContent).toMatch(/could not be read right now/)
    expect(screen.queryByText(/not yet available/)).toBeNull()
  })

  it('a failed holdings read says so above the list instead of blanking DAYS / SINCE ADD to dashes', async () => {
    vi.stubGlobal('fetch', route({
      '/api/leadership': [200, { stocks: [], status: 'ok', last_updated: null }],
      '/api/uct20/portfolio': [503, { detail: 'down' }],
    }))
    renderWithProviders(fresh(<UCT20 />))
    expect((await screen.findByTestId('uct20-holdings-error')).textContent).toMatch(/could not be read right now/)
  })

  it('a healthy holdings read shows no such note (control)', async () => {
    vi.stubGlobal('fetch', route({
      '/api/leadership': [200, { stocks: [], status: 'ok', last_updated: null }],
      '/api/uct20/portfolio': [200, { open_positions: [], trades: [] }],
    }))
    renderWithProviders(fresh(<UCT20 />))
    await screen.findByText(/not yet available/)
    expect(screen.queryByTestId('uct20-holdings-error')).toBeNull()
  })

  it('an empty list says when it is built and that the page re-checks', async () => {
    vi.stubGlobal('fetch', route({ '/api/leadership': [200, { stocks: [], status: 'ok', last_updated: null }] }))
    renderWithProviders(fresh(<UCT20 />))
    expect((await screen.findByText(/not yet available/)).closest('div').textContent).toMatch(/checks for it again every hour/)
  })

  it('the portfolio tile: a failure says so; an empty tracker never says "run the engine"', async () => {
    vi.stubGlobal('fetch', route({ '/api/uct20/portfolio': [503, { detail: 'down' }] }))
    const { unmount } = renderWithProviders(fresh(<UCT20Performance />))
    expect((await screen.findByTestId('uct20-portfolio-error')).textContent).toMatch(/could not be read/)
    unmount()
    vi.stubGlobal('fetch', route({ '/api/uct20/portfolio': [200, {}] }))
    renderWithProviders(fresh(<UCT20Performance />))
    expect((await screen.findByText(/No portfolio history yet/)).textContent).not.toMatch(/run the Morning Wire engine/)
  })
})

// Audit 2026-10-08 (IVH P1 point 7, P2 point 12): the standalone IVH panel rendered a blank body for
// a status it did not recognise, and a `no_log` answer said "no sessions yet" twice.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { SWRConfig } from 'swr'
import IvHistoryPanel from './IvHistoryPanel'

const serve = (body) => {
  global.fetch = vi.fn((url) => (String(url).endsWith('/iv-history/AAPL')
    ? Promise.resolve({ ok: true, status: 200, json: async () => body })
    : Promise.resolve({ ok: false, status: 404, json: async () => ({}) })))
}
const mount = (p = {}) => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><IvHistoryPanel sym="AAPL" {...p} /></SWRConfig>,
)
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('IvHistoryPanel states', () => {
  it('standalone (offNotice): an unrecognised status says so with a Retry, never a blank body', async () => {
    serve({ symbol: 'AAPL', status: 'rebuilding', points: [] })
    mount({ offNotice: true })
    const box = await screen.findByTestId('iv-history-unrecognised')
    expect(box.textContent).toMatch(/came back in a form this panel can't read/)
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })

  it('under the chain (no offNotice) an unrecognised status still stays absent', async () => {
    serve({ symbol: 'AAPL', status: 'rebuilding', points: [] })
    const { container } = mount()
    await new Promise((r) => setTimeout(r, 30))
    expect(container.innerHTML).toBe('')
  })

  it('no_log says "no sessions yet" once, not again as a partial reason', async () => {
    serve({ symbol: 'AAPL', status: 'no_log', points: [], partial: true,
      partial_reasons: ['The options log holds no sessions yet.'], rank: null, rank_note: 'needs 20.',
      method: 'm.', source: 'UCT options log' })
    mount({ offNotice: true })
    const panel = await screen.findByTestId('iv-history')
    expect(panel.textContent.match(/holds no sessions yet/g)).toHaveLength(1)
    expect(screen.getByTestId('iv-coverage').textContent).not.toMatch(/Partial:/)
  })
})

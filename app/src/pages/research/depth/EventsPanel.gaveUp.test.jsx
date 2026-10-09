// Audit 2026-10-08 (lane A): once EVTS stops re-asking, it names the source still pending — a
// pending filing or catalyst read was announced as "The earnings read".
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { SWRConfig } from 'swr'

vi.mock('./depthFetch', async (orig) => ({
  ...(await orig()),
  usePendingReask: () => ({ exhausted: true, retry: () => {} }),
}))
import EventsPanel from './EventsPanel'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('names the pending source when automatic checking stops', async () => {
  const body = {
    ticker: 'AAPL', state: 'ok', reason: null, offset_unit: 'weekdays', prints: [], events: [],
    sources: { earnings: { state: 'ok' }, filing: { state: 'pending' }, uct_catalyst: { state: 'ok' }, room_spike: { state: 'ok' } },
  }
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) }))
  render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><EventsPanel sym="aapl" /></SWRConfig>)
  const note = await screen.findByTestId('pending-gave-up')
  expect(note.textContent).toMatch(/^The Filing read is still being built/)
  expect(note.textContent).not.toMatch(/earnings/i)
})

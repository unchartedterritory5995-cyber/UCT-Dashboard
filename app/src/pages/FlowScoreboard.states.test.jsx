// FREC: a failed read is a failure with Retry, never "The tracker is warming up"; the
// payload's generated_at is shown (quality pass 2026-10-05).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { MemoryRouter } from 'react-router-dom'
import FlowScoreboard from './FlowScoreboard'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const wrap = () => render(
  <MemoryRouter><SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
    <FlowScoreboard embedded />
  </SWRConfig></MemoryRouter>,
)

describe('FlowScoreboard states', () => {
  it('a 503 reads as could-not-read with Retry, not warming up', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 503, json: async () => ({}) })))
    wrap()
    expect((await screen.findByTestId('scoreboard-error')).textContent).toMatch(/could not be read right now/)
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(screen.queryByText(/warming up/)).toBeNull()
  })

  it('a genuinely young tracker says so and says it re-checks', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: async () => ({ picks_tracked: 0, too_new: 3, generated_at: '2026-10-05T20:12:00+00:00' }) })))
    wrap()
    expect((await screen.findByText(/warming up/)).textContent).toMatch(/re-checks every five minutes/)
    expect(screen.getByTestId('scoreboard-asof').textContent).toBe('Scores as of Oct 5, 4:12 PM ET.')
  })
})

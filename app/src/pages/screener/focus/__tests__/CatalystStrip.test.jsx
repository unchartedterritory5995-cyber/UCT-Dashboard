import { render, screen, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { vi, beforeEach, afterEach, expect, test } from 'vitest'
import CatalystStrip, { SETTLE_MS } from '../CatalystStrip'

const EVENTS = {
  MU: [
    { type: 'earnings', date: '2026-09-24', title: 'Beat and raised on HBM demand', direction: 'up', move_pct: 8.4 },
    { type: 'catalyst', date: '2026-08-12', title: 'New memory roadmap', direction: 'up', move_pct: 3.1 },
    { type: 'breaking', date: '2026-07-01', title: 'Older headline', direction: 'down', move_pct: -2 },
  ],
}
beforeEach(() => {
  globalThis.fetch = vi.fn(async (u) => {
    const sym = decodeURIComponent(String(u).split('/api/news-catalysts/')[1].split('?')[0])
    return { ok: true, status: 200, json: async () => ({ symbol: sym, status: EVENTS[sym] ? 'ready' : 'none', events: EVENTS[sym] || [] }) }
  })
})
afterEach(() => { vi.useRealTimers() })
const mount = sym => render(
  <MemoryRouter><SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><CatalystStrip sym={sym} /></SWRConfig></MemoryRouter>)
const urls = () => fetch.mock.calls.map(([u]) => String(u))

test('names the two newest catalysts and links to the full Catalysts tab', async () => {
  mount('MU')
  await waitFor(() => expect(screen.getByText('Beat and raised on HBM demand')).toBeInTheDocument())
  expect(screen.getByText('New memory roadmap')).toBeInTheDocument()
  expect(screen.queryByText('Older headline')).toBeNull()
  expect(screen.getByText('+8.4%')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /All catalysts/ })).toHaveAttribute('href', '/research/MU?section=catalysts')
})

test('it only ever PEEKS: the read never asks the server to generate', async () => {
  mount('MU')
  await waitFor(() => expect(fetch).toHaveBeenCalled())
  expect(urls().every(u => u.endsWith('?generate=0'))).toBe(true)
})

test('a stock with nothing on record says so and offers the research page to find them', async () => {
  mount('ZZZ')
  await waitFor(() => expect(screen.getByTestId('pane-catalysts')).toHaveTextContent('No catalysts on record'))
  expect(screen.getByRole('link', { name: /Find catalysts/ })).toHaveAttribute('href', '/research/ZZZ?section=catalysts')
})

test('stepping through rows reads only the stock the selection settles on', async () => {
  vi.useFakeTimers()
  const { rerender } = mount('AAA')
  for (const s of ['BBB', 'CCC', 'MU']) {
    rerender(<MemoryRouter><SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><CatalystStrip sym={s} /></SWRConfig></MemoryRouter>)
    await act(async () => { vi.advanceTimersByTime(SETTLE_MS / 4) })
  }
  await act(async () => { vi.advanceTimersByTime(SETTLE_MS * 2) })
  vi.useRealTimers()
  await waitFor(() => expect(urls()).toEqual(['/api/news-catalysts/MU?generate=0']))
})

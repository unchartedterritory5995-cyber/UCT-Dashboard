// /r/chart takes the server's answer to its one token-checked read.
//
// The page forwards `?token=` to /api/r/chart-settings. A 401 or 403 there shows "unauthorized"
// and no chart. Every other outcome of that read (200, another failure, no answer) draws the chart,
// as before: a settings lookup that merely fails must not cost the chart.
//
// The chart itself is replaced by a marker element here: what this file pins is which of the two
// the page renders, and jsdom cannot draw a canvas chart.
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../components/StockChart', () => ({
  default: () => <div data-testid="chart" />,
}))

import ChartRender from './ChartRender'

const TOKEN = 'token-from-the-address'

function stubSettings(reply) {
  const fetchMock = vi.fn((url) => {
    const u = String(url)
    if (u.startsWith('/api/r/chart-settings')) return reply(u)
    return Promise.resolve(new Response('{}', { status: 503 }))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const settingsCalls = (fetchMock) => fetchMock.mock.calls
  .map((c) => String(c[0])).filter((u) => u.startsWith('/api/r/chart-settings'))

const mount = (qs = `sym=NVDA&tf=D&token=${TOKEN}`) => render(
  <MemoryRouter initialEntries={[`/r/chart?${qs}`]}><ChartRender /></MemoryRouter>)

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('/r/chart and the settings read', () => {
  it.each([403, 401])('a %i answer shows "unauthorized" and no chart', async (status) => {
    const fetchMock = stubSettings(() => Promise.resolve(new Response('{}', { status })))
    mount()

    expect(await screen.findByText('unauthorized')).toBeInTheDocument()
    expect(screen.queryByTestId('chart')).toBeNull()
    // The page asked the server with the address's token.
    expect(settingsCalls(fetchMock)).toEqual([`/api/r/chart-settings?token=${TOKEN}`])
  })

  it('a 200 answer draws the chart', async () => {
    const fetchMock = stubSettings(() => Promise.resolve(
      new Response(JSON.stringify({ chart_settings: null }), { status: 200 })))
    mount()

    expect(await screen.findByTestId('chart')).toBeInTheDocument()
    await waitFor(() => expect(settingsCalls(fetchMock)).toHaveLength(1))
    await new Promise((r) => setTimeout(r, 30))
    expect(screen.queryByText('unauthorized')).toBeNull()
    expect(screen.getByTestId('chart')).toBeInTheDocument()
  })

  it.each([500, 503, 429])('a %i answer still draws the chart (the read fails open)', async (status) => {
    const fetchMock = stubSettings(() => Promise.resolve(new Response('{}', { status })))
    mount()

    await waitFor(() => expect(settingsCalls(fetchMock)).toHaveLength(1))
    await new Promise((r) => setTimeout(r, 30))
    expect(screen.queryByText('unauthorized')).toBeNull()
    expect(screen.getByTestId('chart')).toBeInTheDocument()
  })

  it('no answer at all (network error) still draws the chart', async () => {
    const fetchMock = stubSettings(() => Promise.reject(new TypeError('Failed to fetch')))
    mount()

    await waitFor(() => expect(settingsCalls(fetchMock)).toHaveLength(1))
    await new Promise((r) => setTimeout(r, 30))
    expect(screen.queryByText('unauthorized')).toBeNull()
    expect(screen.getByTestId('chart')).toBeInTheDocument()
  })
})

// PACKET-AA CP1 (fingerprint f7fb7c477) — standalone UI for the previously
// zero-caller POST /api/flow-explain endpoint. Component-level tests only:
// this file is NOT mounted anywhere yet (CP2, a separate partner-ack-gated
// checkpoint, does that).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import FlowExplainButton from './FlowExplainButton'

const PRINT = {
  ticker: 'NVDA', cp: 'C', strike: 130, exp: '2026-08-21', dte: 14,
  premium: 45000, volume: 500, oi: 200, side: 'ASK', spot: 128.5,
  order_type: 'SWEEP', color: 'green',
}

function mockFetch(response) {
  global.fetch = vi.fn(() => Promise.resolve(response))
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('FlowExplainButton / FlowExplainModal', () => {
  it('renders a trigger and nothing else until clicked', () => {
    render(<FlowExplainButton print={PRINT} />)
    expect(screen.getByTestId('flow-explain-trigger')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opening the trigger fetches POST /api/flow-explain/ with the print fields', async () => {
    mockFetch({
      ok: true,
      json: () => Promise.resolve({
        explanation: 'A sweep buying calls above the ask.',
        signals: ['aggressive', 'itm'],
        cached: false, model: 'claude-sonnet-4-6',
      }),
    })
    render(<FlowExplainButton print={PRINT} />)
    fireEvent.click(screen.getByTestId('flow-explain-trigger'))

    await waitFor(() => expect(screen.getByText(/A sweep buying calls/i)).toBeInTheDocument())

    const [url, opts] = global.fetch.mock.calls[0]
    expect(url).toBe('/api/flow-explain/')
    expect(opts.method).toBe('POST')
    const body = JSON.parse(opts.body)
    expect(body).toMatchObject({
      ticker: 'NVDA', cp: 'C', strike: 130, exp: '2026-08-21', dte: 14,
      premium: 45000, volume: 500, oi: 200, side: 'ASK', spot: 128.5,
      order_type: 'SWEEP', color: 'green',
    })
  })

  it('shows a loading state while the request is in flight', async () => {
    let resolveFetch
    global.fetch = vi.fn(() => new Promise(r => { resolveFetch = r }))
    render(<FlowExplainButton print={PRINT} />)
    fireEvent.click(screen.getByTestId('flow-explain-trigger'))
    expect(screen.getByText(/Explaining/i)).toBeInTheDocument()
    resolveFetch({ ok: true, json: () => Promise.resolve({ explanation: 'x', signals: [], cached: false, model: 'm' }) })
    await waitFor(() => expect(screen.getByText('x')).toBeInTheDocument())
  })

  it('a deterministic-fallback response is labeled honestly, never framed as AI', async () => {
    mockFetch({
      ok: true,
      json: () => Promise.resolve({
        explanation: 'Deep ITM call, opening volume.',
        signals: ['itm'], cached: false, model: 'deterministic-fallback',
      }),
    })
    render(<FlowExplainButton print={PRINT} />)
    fireEvent.click(screen.getByTestId('flow-explain-trigger'))
    await waitFor(() => expect(screen.getByText(/Deep ITM call/i)).toBeInTheDocument())
    expect(screen.getByText(/not AI-generated right now/i)).toBeInTheDocument()
  })

  it('a 429 (daily cap hit) shows the server\'s exact message', async () => {
    mockFetch({
      ok: false, status: 429,
      json: () => Promise.resolve({ detail: 'Daily explain limit reached (50/day). Resets at midnight ET.' }),
    })
    render(<FlowExplainButton print={PRINT} />)
    fireEvent.click(screen.getByTestId('flow-explain-trigger'))
    await waitFor(() => expect(screen.getByText(/Daily explain limit reached \(50\/day\)/i)).toBeInTheDocument())
  })

  it('a 402 (not paid) shows a plain paywall message', async () => {
    mockFetch({ ok: false, status: 402, json: () => Promise.resolve({}) })
    render(<FlowExplainButton print={PRINT} />)
    fireEvent.click(screen.getByTestId('flow-explain-trigger'))
    await waitFor(() => expect(screen.getByText(/require a paid plan/i)).toBeInTheDocument())
  })

  it('a network error shows a generic inline failure, never throws', async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error('network down')))
    render(<FlowExplainButton print={PRINT} />)
    fireEvent.click(screen.getByTestId('flow-explain-trigger'))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/try again/i))
  })

  it('a cached response shows a "Cached read" note', async () => {
    mockFetch({
      ok: true,
      json: () => Promise.resolve({ explanation: 'x', signals: [], cached: true, model: 'claude-sonnet-4-6' }),
    })
    render(<FlowExplainButton print={PRINT} />)
    fireEvent.click(screen.getByTestId('flow-explain-trigger'))
    await waitFor(() => expect(screen.getByText(/Cached read/i)).toBeInTheDocument())
  })

  it('closing and reopening the modal fires a fresh request', async () => {
    mockFetch({
      ok: true,
      json: () => Promise.resolve({ explanation: 'first', signals: [], cached: false, model: 'm' }),
    })
    render(<FlowExplainButton print={PRINT} />)
    fireEvent.click(screen.getByTestId('flow-explain-trigger'))
    await waitFor(() => expect(screen.getByText('first')).toBeInTheDocument())
    fireEvent.click(screen.getByLabelText('Close'))
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByTestId('flow-explain-trigger'))
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2))
  })
})

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// Settings supply the tag vocab; mock the hook so the pickers are deterministic
// (and so we don't drag in the account/settings SWR fetch chain).
vi.mock('../../hooks/useJ2Settings', () => ({
  default: () => ({
    settings: { mistakeTags: ['FOMO', 'chasing', 'no_stop'], emotionTags: ['greedy', 'calm'] },
    accountId: 'acc1',
  }),
}))

import RapidTagFlow from './RapidTagFlow'

const TRADES = [
  { id: 't1', symbol: 'NVDA', side: 'Long', pnlDollar: 120.5, exitDate: '2026-07-01', mistakeTags: [], emotionTags: [] },
  { id: 't2', symbol: 'TSLA', side: 'Short', pnlDollar: -80, exitDate: '2026-07-02', mistakeTags: [], emotionTags: [] },
]

let patchCalls

// Fetch stub: GET /api/j2/trades → the list envelope; PATCH → echo the body back
// as the updated trade (and record the call for assertions).
function makeFetch(list) {
  return vi.fn((url, opts = {}) => {
    const method = opts.method || 'GET'
    const u = String(url)
    if (method === 'GET' && u.includes('/api/j2/trades')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ trades: list, total: list.length }) })
    }
    if (method === 'PATCH') {
      const body = JSON.parse(opts.body)
      patchCalls.push({ url: u, body })
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'x', ...body }) })
    }
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) })
  })
}

beforeEach(() => {
  patchCalls = []
})

describe('RapidTagFlow', () => {
  it('opens on the first closed trade with both tag pickers + progress', async () => {
    global.fetch = makeFetch(TRADES)
    render(<RapidTagFlow open onClose={vi.fn()} onComplete={vi.fn()} />)

    // Trade 1 identity + "1 / 2" progress.
    expect(await screen.findByText('NVDA')).toBeInTheDocument()
    expect(screen.getByText('1 / 2')).toBeInTheDocument()
    // A mistake-vocab chip AND an emotion-vocab chip render (both pickers present).
    expect(screen.getByRole('button', { name: 'FOMO' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'greedy' })).toBeInTheDocument()
  })

  it('selecting a mistake + Save PATCHes /api/j2/trades/{id} with the tag and advances', async () => {
    global.fetch = makeFetch(TRADES)
    render(<RapidTagFlow open onClose={vi.fn()} onComplete={vi.fn()} />)
    await screen.findByText('NVDA')

    fireEvent.click(screen.getByRole('button', { name: 'FOMO' }))
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    // Advances to trade 2.
    expect(await screen.findByText('TSLA')).toBeInTheDocument()
    expect(screen.getByText('2 / 2')).toBeInTheDocument()

    // Exactly one PATCH, to t1, carrying the selected mistake tag + emotion field.
    expect(patchCalls).toHaveLength(1)
    expect(patchCalls[0].url).toContain('/api/j2/trades/t1')
    expect(patchCalls[0].body.mistakeTags).toContain('FOMO')
    expect(patchCalls[0].body).toHaveProperty('emotionTags')
  })

  it('finishing the last trade calls onComplete', async () => {
    const onComplete = vi.fn()
    global.fetch = makeFetch(TRADES)
    render(<RapidTagFlow open onClose={vi.fn()} onComplete={onComplete} />)
    await screen.findByText('NVDA')

    fireEvent.click(screen.getByRole('button', { name: /save/i }))   // t1 → advance
    await screen.findByText('TSLA')
    fireEvent.click(screen.getByRole('button', { name: /save/i }))   // t2 (last) → finish

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
    expect(patchCalls).toHaveLength(2)
  })

  it('Skip advances without a PATCH', async () => {
    global.fetch = makeFetch(TRADES)
    render(<RapidTagFlow open onClose={vi.fn()} onComplete={vi.fn()} />)
    await screen.findByText('NVDA')

    fireEvent.click(screen.getByRole('button', { name: /^skip$/i }))
    expect(await screen.findByText('TSLA')).toBeInTheDocument()
    expect(patchCalls).toHaveLength(0)
  })

  it('empty closed-trade list → the friendly empty message', async () => {
    global.fetch = makeFetch([])
    render(<RapidTagFlow open onClose={vi.fn()} onComplete={vi.fn()} />)
    expect(await screen.findByText(/no closed trades to tag yet/i)).toBeInTheDocument()
  })
})

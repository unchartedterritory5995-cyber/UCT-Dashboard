/**
 * TERM-009 — a member's call record on their profile card (opt-in, losses included).
 * Asserted on rendered text.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { CallRecord } from './ProfileCard'
import { AuthContext } from '../../../context/AuthContext'

const RECORD = {
  public: false, mine: true,
  summary: { marks: 4, priced: 3, unpriced: 1, up: 1, down: 1, flat: 1, median_move_pct: 0 },
  rows: [
    { message_id: 1, ticker: 'NVDA', called_price: 100, move_pct: 10 },
    { message_id: 2, ticker: 'AMD', called_price: 100, move_pct: -5 },
    { message_id: 4, ticker: 'ZZZZ', called_price: 5, move_pct: null },
  ],
}
let record
let status

beforeEach(() => {
  record = { ...RECORD }
  status = 200
  global.fetch = vi.fn((url, opts) => {
    if (opts?.method === 'PUT') {
      record = { ...record, public: JSON.parse(opts.body).enabled }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ public: record.public }) })
    }
    return Promise.resolve({ ok: status === 200, status, json: () => Promise.resolve(record) })
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

function renderAs(meId, userId = 'u-member') {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <AuthContext.Provider value={{ user: { id: meId } }}>
        <CallRecord userId={userId} />
      </AuthContext.Provider>
    </SWRConfig>,
  )
}

describe('CallRecord (TERM-009)', () => {
  it('shows moves since each mention, the loss included, and what it could not price', async () => {
    renderAs('u-member')
    const summary = await screen.findByTestId('call-record-summary')
    expect(summary.textContent).toMatch(/1 up · 1 down · 1 flat/)
    expect(summary.textContent).toMatch(/1 not priced now/)
    expect(screen.getByText(/\$AMD at \$100\.00 → -5\.0%/)).toBeTruthy()
    expect(screen.getByText(/\$ZZZZ at \$5\.00 → no price now/)).toBeTruthy()
    expect(screen.queryByText(/win/i)).toBeNull()
  })

  it('tells the owner a private record is visible only to them, and offers to share it', async () => {
    renderAs('u-member')
    expect((await screen.findByTestId('call-record')).textContent).toMatch(/only you can see this/)
    fireEvent.click(screen.getByRole('button', { name: 'Share my call record publicly' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop sharing my call record' })).toBeTruthy())
    expect(global.fetch.mock.calls.some(([u, o]) => u === '/api/community/me/call-record' && o?.method === 'PUT')).toBe(true)
  })

  it('another member sees no switch, and nothing at all when the record is not shared', async () => {
    record = { ...RECORD, public: true, mine: false }
    const { unmount } = renderAs('u-other')
    await screen.findByTestId('call-record')
    expect(screen.queryByRole('button')).toBeNull()
    unmount()
    status = 404
    renderAs('u-other')
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(screen.queryByTestId('call-record')).toBeNull()
  })
})

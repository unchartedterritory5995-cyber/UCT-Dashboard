import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

// TERM-049 -- the History tab. Asserted on RENDERED TEXT:
//   * every row shows its lane, its date and its SOURCE;
//   * the room lane is a count, never message text;
//   * a failed read says "unavailable", never an empty history;
//   * an unreadable lane is named as missing, not absent.

afterEach(() => { cleanup(); vi.resetModules(); vi.doUnmock('../../../hooks/useMobileSWR') })

const BODY = {
  ticker: 'NVDA', since: '2026-07-01', days: 90,
  lanes: { wire: { status: 'ok' }, book: { status: 'ok' }, catalysts: { status: 'ok' }, room: { status: 'ok' } },
  timeline: [
    { date: '2026-09-26', lane: 'room', mentions: 2, text: 'Mentioned 2 times in the community room', source: 'buzz_mentions', as_of: '2026-09-26', ref: 'x' },
    { date: '2026-09-25', lane: 'book', event: 'entered', text: 'Entered the UCT 20', source: 'uct20_compositions', as_of: '2026-09-25', ref: 'x' },
    { date: '2026-09-24', lane: 'wire', mentions: 2, text: 'Named in the Morning Wire (2 mentions)', source: 'wire_archive', as_of: '2026-09-24', ref: 'x' },
  ],
}

async function renderWith(data, isLoading = false) {
  vi.resetModules()
  vi.doMock('../../../hooks/useMobileSWR', () => ({ default: () => ({ data, isLoading }) }))
  const { default: Tab } = await import('./HistoryTab')
  return render(<Tab sym="nvda" />)
}

describe('HistoryTab', () => {
  it('renders each row with its lane, date and source', async () => {
    await renderWith({ ok: true, body: BODY })
    expect(screen.getAllByTestId('history-row')).toHaveLength(3)
    expect(screen.getByText(/Entered the UCT 20/)).toBeTruthy()
    expect(screen.getByText(/UCT 20 ledger, as of 2026-09-25/)).toBeTruthy()
    expect(screen.getByText(/Morning Wire archive, as of 2026-09-24/)).toBeTruthy()
  })

  it('shows the room lane as a count only', async () => {
    await renderWith({ ok: true, body: BODY })
    expect(screen.getByText(/Mentioned 2 times in the community room/)).toBeTruthy()
    expect(screen.getByText(/Community mention counts/)).toBeTruthy()
  })

  it('a failed read is unavailable, never an empty history', async () => {
    await renderWith({ ok: false, httpStatus: 500, body: null })
    expect(screen.getByTestId('history-unavailable').textContent).toMatch(/does not mean nothing happened/)
    expect(screen.queryByTestId('history-empty')).toBeNull()
  })

  it('names an unreadable lane as missing', async () => {
    await renderWith({ ok: true, body: { ...BODY, lanes: { ...BODY.lanes, catalysts: { status: 'unavailable' } } } })
    expect(screen.getByTestId('history-lane-unavailable').textContent).toMatch(/Catalysts/)
  })

  it('an empty history says so in words', async () => {
    await renderWith({ ok: true, body: { ...BODY, timeline: [] } })
    expect(screen.getByTestId('history-empty').textContent).toMatch(/No recorded mentions of NVDA/)
  })
})

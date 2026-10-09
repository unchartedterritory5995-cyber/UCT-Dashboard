// V15 — MOVE / WIIM. Rails:
//   * NEW is marked from the SERVER's since-last-visit diff, row by row (not everything, not nothing);
//   * an intelligence outage says "could not check", never reads as a quiet tape;
//   * the dark flag (404) says "isn't switched on yet", not "error";
//   * the numbered rows are published to the shell for row <GO>.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
import jsonFetcher from '../../../utils/jsonFetcher'
import MovePanel, { factKey, catalystKey, moveRows } from './MovePanel'

const F1 = { kind: 'analyst', label: 'Upgraded to Buy', as_of: '2026-10-01' }
const F2 = { kind: 'filing', label: '8-K filed', as_of: '2026-10-02' }
const C1 = { market_date: '2026-10-02', tag: 'Catalyst', thesis_text: 'Beat and raise' }

beforeEach(() => { jsonFetcher.mockReset() })

describe('MovePanel', () => {
  it('marks NEW only the rows the server says are new since the last visit', async () => {
    jsonFetcher.mockResolvedValue({
      sym: 'NVDA', intelligence: { status: 'ok', facts: [F1, F2] }, catalysts: [C1], catalyst_status: 'ok',
      since_last_visit: { first_visit: false, last_visit_at: 1_790_000_000, new: [factKey(F2), catalystKey(C1)] },
    })
    const onRows = vi.fn()
    render(<MovePanel sym="NVDA" onRows={onRows} />)
    const facts = await screen.findByTestId('terminal-move-facts')
    const items = within(facts).getAllByRole('listitem')
    expect(items.map((li) => li.dataset.new)).toEqual(['false', 'true'])
    expect(within(screen.getByTestId('terminal-move-catalysts')).getByRole('listitem').dataset.new).toBe('true')
    expect(screen.getByTestId('terminal-move-since').textContent).toContain('2 new since your last visit')
    // the last-visit time is on the market clock and says so, whatever zone the viewer is in
    expect(screen.getByTestId('terminal-move-since').textContent).toContain('(9/21/2026, 10:13:20 AM ET)')
    expect(jsonFetcher).toHaveBeenCalledWith('/api/terminal/move/NVDA')
    expect(onRows).toHaveBeenCalledWith(moveRows('NVDA'))
  })

  it('a first visit says so', async () => {
    jsonFetcher.mockResolvedValue({ intelligence: { status: 'ok', facts: [] }, catalysts: [], catalyst_status: 'ok',
      since_last_visit: { first_visit: true, new: [] } })
    render(<MovePanel sym="AMD" />)
    expect((await screen.findByTestId('terminal-move-since')).textContent).toContain('First MOVE visit to AMD')
  })

  it('an outage is reported, never read as "nothing happened"', async () => {
    jsonFetcher.mockResolvedValue({ intelligence: { status: 'unavailable', facts: [] }, catalysts: [],
      catalyst_status: 'unavailable', since_last_visit: { first_visit: false, new: [] } })
    render(<MovePanel sym="AMD" />)
    await screen.findByTestId('terminal-move')
    expect(screen.getByText(/not "no news"/)).toBeTruthy()
    expect(screen.queryByTestId('terminal-move-nothing')).toBeNull()
  })

  it('the dark flag (404) reads as "not switched on", any other failure as retry', async () => {
    jsonFetcher.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 404 }))
    const { unmount } = render(<MovePanel sym="AMD" />)
    expect((await screen.findByTestId('terminal-move-error')).textContent).toContain("isn't switched on yet")
    unmount()
    jsonFetcher.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 500 }))
    render(<MovePanel sym="AMD" />)
    expect((await screen.findByTestId('terminal-move-error')).textContent).toContain('AMD MOVE again')
  })

  it('a failed read is an error with a Retry that reads again (2026-10-07: copy only before)', async () => {
    jsonFetcher.mockResolvedValue({ ticker: 'AMD', intel: {}, catalysts: [] })
    jsonFetcher.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 503 }))
    render(<MovePanel sym="AMD" />)
    const err = await screen.findByTestId('terminal-move-error')
    expect(err.getAttribute('data-kind')).toBe('error')
    const before = jsonFetcher.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(jsonFetcher.mock.calls.length).toBe(before + 1))
  })

  it('every numbered row is a command the registry knows', async () => {
    const { BY_CODE } = await import('../functions')
    for (const cmd of moveRows('NVDA')) expect(BY_CODE[cmd.split(' ')[1]], cmd).toBeTruthy()
  })
})

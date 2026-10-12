import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

// Notebook P1 round 4 (re-review 2, N-M5): after an update lands while the editor held unsent words, the host waits
// for the words to be saved and then asks the editor for its clean re-read. The editor can still REFUSE that
// re-read (it returns false: a read in flight, an adoption pending...). One refusal must not be the end: the host
// asks again on the same poll, inside the same two-minute cap.
vi.mock('./StyleUpdateSheet', () => ({
  default: ({ onApplied }) => (
    <button type="button" onClick={() => onApplied({ id: 'n1', title: 'T' }, { toVersion: 3, styleName: 'Weekend prep' })}>apply now</button>
  ),
  StyleChooser: ({ onPick }) => <button type="button" onClick={() => onPick('s1')}>pick a style</button>,
}))

import StyleHost, { APPLIED_WHILE_TYPING } from './StyleHost'

const NOTE = { id: 'n1', title: 'T', styleId: 's1', styleVersion: 1 }
// Mount the host and open the (stubbed) sheet. `dirty` is what the editor still holds that the server does not.
function mount({ dirty, reread }) {
  const api = {
    last: { current: { updatedAt: 'x' } }, send: async () => true, adopt: vi.fn(), dirty, reread: { current: reread },
  }
  const out = render(<StyleHost note={NOTE} ask={1} api={api} />)
  return { ...out, api }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('the re-read after an update that landed over unsent words', () => {
  it('waits for the words, and a refused re-read is asked for again until the editor takes it', async () => {
    let held = [1]
    const reread = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValue(undefined)                       // the third ask is accepted
    mount({ dirty: () => held, reread })
    fireEvent.click(screen.getByRole('button', { name: 'pick a style' }))
    fireEvent.click(screen.getByRole('button', { name: 'apply now' }))
    expect(screen.getByText(APPLIED_WHILE_TYPING)).toBeTruthy()
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(reread).not.toHaveBeenCalled()                   // the words are still unsent: no re-read yet
    held = []
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    expect(reread).toHaveBeenCalledTimes(1)                 // clean, but refused
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(reread).toHaveBeenCalledTimes(3)                 // asked again on the poll, then taken
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(reread).toHaveBeenCalledTimes(3)                 // and then it stops
  })

  it('does not ask forever: it gives up with the two-minute cap', async () => {
    const reread = vi.fn().mockResolvedValue(false)
    let held = [1]
    mount({ dirty: () => held, reread })
    fireEvent.click(screen.getByRole('button', { name: 'pick a style' }))
    fireEvent.click(screen.getByRole('button', { name: 'apply now' }))
    held = []
    await act(async () => { await vi.advanceTimersByTimeAsync(130000) })
    const asked = reread.mock.calls.length
    expect(asked).toBeGreaterThan(3)
    await act(async () => { await vi.advanceTimersByTimeAsync(30000) })
    expect(reread.mock.calls.length).toBe(asked)
  })
})

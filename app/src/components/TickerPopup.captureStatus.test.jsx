// RW-NEW-02 (a11y second review, 2026-10-01, WCAG 4.1.3 Status Messages): the
// result line shown after "Save price to Notebook" / "Save analyst consensus
// to Notebook" (success, generic failure, and the locked-note refusal) was a
// plain, non-live <span> -- no role, no aria-live -- mounted only once a
// message existed, and auto-dismissed after exactly 2500ms regardless of
// whether the message was good news or something a member had to act on. A
// page-wide live-region census at the moment of a real refusal (the rewalk's
// own evidence) found nothing announcing anything.
//
// ⛔ Only the DISPLAY changes here. `captureFinancialFact.js`'s two capture
// functions, and `lib/offline/f5Freeze.test.js`'s freeze on their call
// sites, are untouched -- these tests mock the functions' RETURN VALUE only.
import { renderWithProviders, screen, fireEvent, act } from '../test-utils'
import { vi, test, expect, describe, beforeEach, afterEach } from 'vitest'

vi.mock('../utils/prefetchBars', () => ({
  prefetchAllTimeframes: vi.fn(), prefetchBars: vi.fn(), prefetchBar: vi.fn(), default: vi.fn(),
}))
vi.mock('./chart/SymbolSearch', () => ({ default: () => null }))
vi.mock('./chart/pane/ChartPane', () => ({ default: () => <div data-testid="pane-stub" /> }))

const capturePriceToNotebook = vi.fn()
const captureConsensusToNotebook = vi.fn()
vi.mock('../pages/journal-2-0/lib/captureFinancialFact', () => ({
  capturePriceToNotebook: (...args) => capturePriceToNotebook(...args),
  captureConsensusToNotebook: (...args) => captureConsensusToNotebook(...args),
}))

import TickerPopup from './TickerPopup'

function statusRegion() { return screen.getByTestId('capture-status') }
async function openModal() {
  renderWithProviders(<TickerPopup sym="NVDA" />)
  fireEvent.click(screen.getByTestId('ticker-NVDA'))
  await screen.findByTestId('pane-stub')
}
// `captureCurrentPrice`/`captureCurrentConsensus` are async (a dynamic import
// plus an awaited mock) and their onClick is not itself awaited by React, so
// a bare `fireEvent.click` returns before the status text lands. Wait for
// the text itself (findByText's MutationObserver path runs on a microtask,
// so it settles even under fake timers) rather than guessing at a flush.
async function clickAndWaitFor(btn, expectedText) {
  fireEvent.click(btn)
  await screen.findByText(expectedText)
}

beforeEach(() => {
  capturePriceToNotebook.mockReset()
  captureConsensusToNotebook.mockReset()
  // shouldAdvanceTime: true ties fake-timer progress to real wall-clock time,
  // so ordinary promise/microtask-driven waits (findByText) still settle;
  // explicit vi.advanceTimersByTimeAsync calls below are what actually move
  // the capture-toast timers forward deterministically.
  vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(() => {
  vi.useRealTimers()
})

describe('RW-NEW-02: the status region exists before any message', () => {
  test('role=status, aria-live=polite, aria-atomic=true, and empty, the instant the modal opens', async () => {
    await openModal()
    const region = statusRegion()
    expect(region).toHaveAttribute('role', 'status')
    expect(region).toHaveAttribute('aria-live', 'polite')
    expect(region).toHaveAttribute('aria-atomic', 'true')
    expect(region).toHaveTextContent('')
    expect(region).not.toHaveAttribute('role', 'alert')
  })
})

describe('RW-NEW-02: a success message', () => {
  test('appears inside the SAME region and clears after its short life', async () => {
    capturePriceToNotebook.mockResolvedValue('NVDA price captured to Notebook')
    await openModal()
    const btn = screen.getByRole('button', { name: "Save NVDA's current price to Notebook" })
    await clickAndWaitFor(btn, 'NVDA price captured to Notebook')
    const region = statusRegion()
    expect(region).toHaveAttribute('role', 'status')
    expect(region).toHaveTextContent('NVDA price captured to Notebook')
    await act(async () => { await vi.advanceTimersByTimeAsync(2500) })
    expect(region).toHaveTextContent('')
  })

  test('never uses role=alert for a routine success', async () => {
    capturePriceToNotebook.mockResolvedValue('NVDA price captured to Notebook')
    await openModal()
    await clickAndWaitFor(
      screen.getByRole('button', { name: "Save NVDA's current price to Notebook" }),
      'NVDA price captured to Notebook',
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('RW-NEW-02: the locked-note refusal', () => {
  const LOCKED_MSG = 'NVDA price not saved — that note is locked. Unlock it in the Notebook first.'

  test('the text lands in the SAME live region the success message would use', async () => {
    capturePriceToNotebook.mockResolvedValue(LOCKED_MSG)
    await openModal()
    await clickAndWaitFor(
      screen.getByRole('button', { name: "Save NVDA's current price to Notebook" }),
      LOCKED_MSG,
    )
    const region = statusRegion()
    expect(region).toHaveAttribute('role', 'status')
    expect(region).toHaveAttribute('aria-live', 'polite')
    expect(region).toHaveTextContent(LOCKED_MSG)
  })

  test('is STILL present after 2500ms -- the old auto-dismiss window', async () => {
    capturePriceToNotebook.mockResolvedValue(LOCKED_MSG)
    await openModal()
    await clickAndWaitFor(
      screen.getByRole('button', { name: "Save NVDA's current price to Notebook" }),
      LOCKED_MSG,
    )
    await act(async () => { await vi.advanceTimersByTimeAsync(2500) })
    expect(statusRegion()).toHaveTextContent(LOCKED_MSG)
  })

  test('is gone only after the longer hold (>= 8s total)', async () => {
    capturePriceToNotebook.mockResolvedValue(LOCKED_MSG)
    await openModal()
    await clickAndWaitFor(
      screen.getByRole('button', { name: "Save NVDA's current price to Notebook" }),
      LOCKED_MSG,
    )
    await act(async () => { await vi.advanceTimersByTimeAsync(7999) })
    expect(statusRegion()).toHaveTextContent(LOCKED_MSG)
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(statusRegion()).toHaveTextContent('')
  })

  test('the analyst-consensus door produces the SAME long-hold behaviour', async () => {
    const consensusLockedMsg = 'NVDA analyst consensus not saved — that note is locked. Unlock it in the Notebook first.'
    captureConsensusToNotebook.mockResolvedValue(consensusLockedMsg)
    await openModal()
    await clickAndWaitFor(
      screen.getByRole('button', { name: "Save NVDA's analyst consensus to Notebook" }),
      consensusLockedMsg,
    )
    const region = statusRegion()
    expect(region).toHaveTextContent(consensusLockedMsg)
    await act(async () => { await vi.advanceTimersByTimeAsync(2500) })
    expect(region).toHaveTextContent(consensusLockedMsg)
  })
})

describe('RW-NEW-02: a generic capture failure', () => {
  test('also gets the long hold, not just the named lock refusal', async () => {
    capturePriceToNotebook.mockResolvedValue('Capture failed — try again')
    await openModal()
    await clickAndWaitFor(
      screen.getByRole('button', { name: "Save NVDA's current price to Notebook" }),
      'Capture failed — try again',
    )
    const region = statusRegion()
    expect(region).toHaveTextContent('Capture failed — try again')
    await act(async () => { await vi.advanceTimersByTimeAsync(2500) })
    expect(region).toHaveTextContent('Capture failed — try again')
    await act(async () => { await vi.advanceTimersByTimeAsync(5500) })
    expect(region).toHaveTextContent('')
  })
})

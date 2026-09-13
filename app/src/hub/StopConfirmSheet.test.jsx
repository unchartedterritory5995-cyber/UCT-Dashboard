/**
 * Phase 3 §3.4 / §4 A3 — the stop-confirm sheet.
 *
 * ⛔ EVERY ASSERTION HERE IS ON RENDERED TEXT, not on state (CLAUDE.md, "Assert user-facing
 * feedback by RENDERED TEXT, never by state"). The two joystick toast defects that shipped were
 * both correct state transitions whose only broken half was the sentence a member reads, and a
 * refusal nobody sees is the same as no refusal at all.
 *
 * The load-bearing tests are the two side-flip ones and `fires onConfirm exactly once`.
 */
import { describe, it as vitestIt, expect, afterAll, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import StopConfirmSheet from './StopConfirmSheet'

// ⛔ RAIL (house convention): `vitest -t` is a REGEX, and a filter matching nothing exits 0 and
// reads as a PASS. These counters catch a `-t` typo or a stray `.only`/`.skip`.
let definedCount = 0
let executedCount = 0
function it(name, fn) {
  definedCount += 1
  return vitestIt(name, (...args) => { executedCount += 1; return fn(...args) })
}
afterAll(() => {
  expect(executedCount).toBeGreaterThan(0)
  expect(executedCount).toBe(definedCount)
})

const LONG = {
  symbol: 'AAPL',
  side: 'Long',
  entry: 178.10,
  shares: 100,
  currentStop: 176.00,
  originalStop: 176.00,
  stop: 177.30,
}
const SHORT = {
  symbol: 'TSLA',
  side: 'Short',
  entry: 178.10,
  shares: 100,
  currentStop: 181.00,
  originalStop: 181.00,
  stop: 180.20,
}

const open = (props = {}) => render(
  <StopConfirmSheet onConfirm={() => {}} onClose={() => {}} {...LONG} {...props} />,
)

const primary = () => screen.getByTestId('hub-stop-primary')
const field = () => screen.getByTestId('hub-stop-input')

describe('the sheet says what it is about to write', () => {
  it('the price is IN the button, not behind it', () => {
    // ⛔ A confirm that says only "Confirm" makes the member verify the value somewhere else,
    // and the whole point of the gesture is that they never looked away (plan §3.4).
    open()
    expect(primary()).toHaveTextContent('Set stop 177.30')
  })

  it('body carries symbol, current stop, new stop and new R', () => {
    open()
    expect(screen.getByTestId('hub-stop-symbol')).toHaveTextContent('AAPL long')
    expect(screen.getByTestId('hub-stop-current')).toHaveTextContent('Current stop 176.00')
    expect(screen.getByTestId('hub-stop-new')).toHaveTextContent('New stop 177.30')
    // rAtStop(178.10, 176.00, 177.30, 'Long', 100) = (177.30-178.10)/2.10 = -0.38...
    expect(screen.getByTestId('hub-stop-r')).toHaveTextContent('New R -0.4R')
  })

  it('R renders an em dash when it is not computable — never 0, never blank', () => {
    // A missing original stop means the position cannot say what it risks. "We cannot compute
    // your R" and "your R is zero" are different facts and only one is about the trade.
    open({ originalStop: null })
    expect(screen.getByTestId('hub-stop-r')).toHaveTextContent('New R —')
  })
})

describe('the steppers and the field are the EQUAL path (WCAG 2.5.1), not a fallback', () => {
  it('+ and − move exactly one tick, and the button text follows', () => {
    open()
    fireEvent.click(screen.getByLabelText('Increase stop'))
    expect(primary()).toHaveTextContent('Set stop 177.31')
    fireEvent.click(screen.getByLabelText('Decrease stop'))
    fireEvent.click(screen.getByLabelText('Decrease stop'))
    expect(primary()).toHaveTextContent('Set stop 177.29')
  })

  it('the numeric field reaches the identical value the gesture would', () => {
    const onConfirm = vi.fn()
    open({ onConfirm })
    fireEvent.change(field(), { target: { value: '177.55' } })
    expect(primary()).toHaveTextContent('Set stop 177.55')
    fireEvent.click(primary())
    expect(onConfirm).toHaveBeenCalledWith(177.55)
  })

  it('⛔ the steppers cannot walk a Long stop up through its entry', () => {
    // The accessible path is clamped by the SAME function the gesture uses. If it were not,
    // the equal path would be the one that can corrupt a position.
    open({ stop: 178.08 })
    fireEvent.click(screen.getByLabelText('Increase stop'))
    fireEvent.click(screen.getByLabelText('Increase stop'))
    fireEvent.click(screen.getByLabelText('Increase stop'))
    expect(primary()).toHaveTextContent('Set stop 178.09')
    expect(screen.queryByTestId('hub-stop-refusal')).toBeNull()
  })
})

describe('⛔ the side-flip guard refuses, in plain English, BOTH directions', () => {
  it('Long — a stop above the entry', () => {
    open()
    fireEvent.change(field(), { target: { value: '181.40' } })
    expect(screen.getByTestId('hub-stop-refusal')).toHaveTextContent(
      'A stop at 181.40 is above your entry of 178.10. For a long position the stop goes below '
      + 'the entry — that is what makes it a stop.',
    )
    expect(primary()).toBeDisabled()
  })

  it('Short — a stop below the entry', () => {
    render(<StopConfirmSheet onConfirm={() => {}} onClose={() => {}} {...SHORT} />)
    fireEvent.change(field(), { target: { value: '174.90' } })
    expect(screen.getByTestId('hub-stop-refusal')).toHaveTextContent(
      'A stop at 174.90 is below your entry of 178.10. For a short position the stop goes above '
      + 'the entry.',
    )
    expect(primary()).toBeDisabled()
  })

  it('a refused stop writes NOTHING even if the button is clicked anyway', () => {
    const onConfirm = vi.fn()
    open({ onConfirm })
    fireEvent.change(field(), { target: { value: '181.40' } })
    fireEvent.click(primary())
    expect(onConfirm).not.toHaveBeenCalled()
  })
})

describe('the once-only latch', () => {
  it('fires onConfirm exactly once across three taps', () => {
    // A double-tap on a slow network is the ordinary case, and `PUT /api/j2/positions/{id}` is
    // not idempotent in any way a member would recognise as safe.
    const onConfirm = vi.fn()
    open({ onConfirm })
    fireEvent.click(primary())
    fireEvent.click(primary())
    fireEvent.click(primary())
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onConfirm).toHaveBeenCalledWith(177.30)
  })

  it('cancel writes nothing and closes', () => {
    const onConfirm = vi.fn()
    const onClose = vi.fn()
    open({ onConfirm, onClose })
    fireEvent.click(screen.getByTestId('hub-stop-cancel'))
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })
})

// The answer card's trade block on a COURSE question's trade (2026-11-14 screen check): it printed "undefined" under
// the stop and an empty entry note, and named "the Bull Flag rules" for levels that come from the real example.
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TradeBlock, Takeaway } from './TradeReview'
import { reviewTrade } from '../challenges/hardMode'

const signal = { t: '2024-01-02', o: 100, h: 102, l: 99, c: 101.5 }
const forward = [
  { t: '2024-01-03', o: 101.5, h: 104, l: 101, c: 103.5 },
  { t: '2024-01-04', o: 103.5, h: 106, l: 103, c: 105.5 },
]

describe('TradeBlock on a course trade', () => {
  it('never prints "undefined" and names the example, not a setup\'s rules', () => {
    const plan = { entry: 101.2, stop: 98.95, t1: 107.95, t2: 112.45, direction: 'bullish', enters_intraday: true, trim_r: [3, 5] }
    const { container } = render(<TradeBlock trade={reviewTrade({ ...plan, source: 'course' }, signal, forward)} name="Bull Flag" />)
    expect(container.textContent).not.toMatch(/undefined/)
    expect(screen.getByText(/The trade · this example/)).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/Bull Flag rules/)
  })

  it('prints the notes the course trade carries', () => {
    const plan = { entry: 101.2, stop: 98.95, t1: 107.95, t2: 112.45, direction: 'bullish', enters_intraday: true, trim_r: [3, 5],
      source: 'course', entry_note: "the fill on the chart's last day", stop_note: "under that day's low" }
    const { container } = render(<TradeBlock trade={reviewTrade(plan, signal, forward)} name="Bull Flag" />)
    expect(container.textContent).toMatch(/the fill on the chart's last day/)
    expect(container.textContent).toMatch(/under that day's low · risk 2\.2%/)
  })

  // the screen check (2026-11-14): the 3R and 5R box held the whole D-013 sentence (13 lines on a phone), and the advance
  // read "session 0" for a best price on the buy day itself
  it('the 3R and 5R box says when each mark traded; the line under the boxes says what each mark is', () => {
    const plan = { entry: 101.2, stop: 98.95, t1: 107.95, t2: 112.45, direction: 'bullish', enters_intraday: true, trim_r: [3, 5], source: 'course' }
    const { container } = render(<TradeBlock trade={reviewTrade(plan, signal, forward)} name="Bull Flag" />)
    const legs = [...container.querySelectorAll('[role="list"] > div')]
    expect(legs[2].querySelector('span').textContent).toBe('3R not reached · 5R not reached')
    const line = container.querySelector('p').textContent
    expect(line).toMatch(/3R is a mark on the ruler; the stop can move up to breakeven between 2R and 5R\. 5R is inside the 5 to 10R zone where a first sell into strength is often best, by judgment, usually day 3 or later\./)
    // a plan marked at 2R and 4R: neither is in the 5 to 10R zone
    const low = render(<TradeBlock trade={reviewTrade({ ...plan, trim_r: [2, 4] }, signal, forward)} name="Bull Flag" />)
    expect(low.container.querySelector('p').textContent).toMatch(/4R is a mark on the ruler/)
    expect(low.container.querySelector('p').textContent).not.toMatch(/4R is inside the 5 to 10R zone/)
  })

  it('a best price on the buy day itself reads "on the buy day", never "session 0"', () => {
    // entered during the signal day, whose high (102) is the best price: nothing after it goes higher
    const plan = { entry: 101.2, stop: 98.95, t1: 107.95, t2: 112.45, direction: 'bullish', enters_intraday: true, source: 'course' }
    const { container } = render(<TradeBlock trade={reviewTrade(plan, signal, [{ t: '2024-01-03', o: 101, h: 101.5, l: 99.5, c: 100 }])} name="Bull Flag" />)
    expect(container.textContent).toMatch(/to the best high, on the buy day/)
    expect(container.textContent).not.toMatch(/session 0/)
  })

  // the 2026-11-15 screen check of an intraday course chart: the card said "the stop was hit on session 1" for the first
  // five-minute bar, and the advance quoted the fill bar's own high, printed before the fill at its close
  it('an intraday course trade counts bars, from the bar after the fill', () => {
    const bar = { t: 1789480800, o: 326.09, h: 326.63, l: 325.33, c: 325.74 }
    const after = [{ t: 1789481100, o: 325.7, h: 326.13, l: 324.87, c: 325 }]
    const plan = { entry: 325.74, stop: 325.28, t1: 327.12, t2: 328.04, direction: 'bullish', enters_intraday: false, unit: 'bar', source: 'course' }
    const { container } = render(<TradeBlock trade={reviewTrade(plan, bar, after)} name="Opening Range Breakout" />)
    expect(container.textContent).toMatch(/The stop was hit on bar 1/)
    expect(container.textContent).not.toMatch(/session/)
    // never the fill bar's own earlier high (326.63, +0.3%); the next bar takes the stop, so no new high counts
    expect(container.textContent).toMatch(/no new high after entry/)
    expect(container.textContent).not.toMatch(/\+0\.3%/)
    // and the card's headline sentence (the fifth screen pass: it still said "the stop was hit on session 1")
    const head = render(<Takeaway trade={reviewTrade(plan, bar, after)} />)
    expect(head.container.textContent).toMatch(/then the stop was hit on bar 1/)
    expect(head.container.textContent).not.toMatch(/session/)
  })

  it('a detector plan still names the setup rules', () => {
    const plan = { entry: 101.2, stop: 98.95, t1: 107.95, t2: 112.45, direction: 'bullish', entry_note: 'a cent over the high', stop_note: 'the low' }
    render(<TradeBlock trade={reviewTrade(plan, signal, forward)} name="Bull Flag" />)
    expect(screen.getByText(/The trade · the Bull Flag rules/)).toBeInTheDocument()
  })
})

// The answer card's trade block on a COURSE question's trade (2026-11-14 screen check): it printed "undefined" under
// the stop and an empty entry note, and named "the Bull Flag rules" for levels that come from the real example.
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TradeBlock } from './TradeReview'
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

  it('a detector plan still names the setup rules', () => {
    const plan = { entry: 101.2, stop: 98.95, t1: 107.95, t2: 112.45, direction: 'bullish', entry_note: 'a cent over the high', stop_note: 'the low' }
    render(<TradeBlock trade={reviewTrade(plan, signal, forward)} name="Bull Flag" />)
    expect(screen.getByText(/The trade · the Bull Flag rules/)).toBeInTheDocument()
  })
})

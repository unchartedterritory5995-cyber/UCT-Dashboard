// THE REPLAY STOPS AND ASKS (ui/ReplayPause), as Hard mode and the chart games play it: the server's question at 3R
// (api/services/study_trade.replay_checks, on the owner's D-013 of 2026-11-12) keys holding, offers the old "sell a third:
// 3R is a fixed trim" as a WRONG choice, and its why says what the day changes (replayTicks.replayChecks: the buy day is
// day 1; day 1 or 2 is too early to sell).
import { describe, expect, it, vi, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import ReplayPause from './ReplayPause'
import { replayChecks } from '../challenges/replayTicks'

// the shape study_trade.replay_checks sends (its words are pinned by tests/test_study_trade.py)
const CHECKS = [{ at: 't1', q: '3R just traded. What does the plan do here?',
  choices: ['Hold: 3R is a mark, and the stop can move up to breakeven', 'Sell a third: 3R is a fixed trim', 'Sell it all: the trade is done', 'Buy more: it is working'],
  answer: 0, why: '3R is a mark on the ruler, not a sell order.', early: 'That is too early to sell, so holding is the plan today.',
  later: 'From day 3 on a sell into a strong push can be a judgment, but 3R itself is never the reason.' }]

afterEach(cleanup)

describe('ReplayPause', () => {
  it('marks the old fixed third wrong, lights the hold, and says the day in the why', () => {
    // 3R traded on session 1: day 2 of the trade
    const [check] = replayChecks({ kind: 'plan', t1At: 1, t2At: null, stoppedSession: null, checks: CHECKS })
    const onDone = vi.fn()
    render(<ReplayPause check={check} onDone={onDone} testId="pause" />)
    expect(screen.getByTestId('pause')).toHaveTextContent('The replay stops · 3R')
    fireEvent.click(screen.getByTestId('pause-choice-1'))
    expect(screen.getByTestId('pause-choice-1').getAttribute('data-state')).toBe('wrong')
    expect(screen.getByTestId('pause-choice-0').getAttribute('data-state')).toBe('right')
    expect(screen.getByTestId('pause')).toHaveTextContent('Not the plan. 3R is a mark on the ruler, not a sell order. This is day 2 of the trade. That is too early to sell, so holding is the plan today.')
    fireEvent.click(screen.getByTestId('pause-go'))
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('from day 3 on, the hold is still the plan and the why says a sell is a judgment, never because of 3R', () => {
    const [check] = replayChecks({ kind: 'plan', t1At: 4, t2At: null, stoppedSession: null, checks: CHECKS })
    render(<ReplayPause check={check} onDone={() => {}} testId="pause" />)
    fireEvent.click(screen.getByTestId('pause-choice-0'))
    expect(screen.getByTestId('pause')).toHaveTextContent('That is the plan. 3R is a mark on the ruler, not a sell order. This is day 5 of the trade. From day 3 on a sell into a strong push can be a judgment, but 3R itself is never the reason.')
  })
})

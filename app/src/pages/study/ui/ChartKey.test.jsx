// The chart key under every revealed chart: each level's name, price, why it sits there (the plan's own words) and what
// the bars after it did. Nothing in it is invented.
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import ChartKey from './ChartKey'

const plan = { kind: 'plan', long: true, entry: 11.05, stop: 10.66, t1: 11.83, t2: 12.22, t1At: 3, t2At: null, stoppedSession: 5,
  entry_note: "over the red day's high, on the Kicker day", stop_note: "under the Kicker's low", trail: 'under each higher low' }

describe('ChartKey', () => {
  it("names every level with its price, the plan's reason and what happened after", () => {
    render(<ChartKey trade={plan} testId="key" />)
    const key = screen.getByTestId('key')
    expect(key).toHaveTextContent('Entry11.05')
    expect(key).toHaveTextContent("over the red day's high, on the Kicker day")
    expect(key).toHaveTextContent("Stop10.66under the Kicker's low")
    expect(key).toHaveTextContent('hit after 5 sessions')
    expect(key).toHaveTextContent('3.5% risk from the entry')
    expect(key).toHaveTextContent('reached in 3 sessions')
    expect(key).toHaveTextContent('not reached before the stop')
    expect(key).toHaveTextContent('Trailunder each higher low')
  })

  it('a setup without a trade shows the line it must hold, and whether it held', () => {
    render(<ChartKey trade={{ kind: 'signal', short: false, line: 42.1, broke: null }} testId="key" />)
    expect(screen.getByTestId('key')).toHaveTextContent('Must hold42.10')
    expect(screen.getByTestId('key')).toHaveTextContent('held through the run')
  })

  it('draws nothing without a trade', () => {
    const { container } = render(<ChartKey trade={null} />)
    expect(container).toBeEmptyDOMElement()
  })
})

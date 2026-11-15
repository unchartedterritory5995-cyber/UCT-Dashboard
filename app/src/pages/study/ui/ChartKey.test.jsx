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
    // 3R and 5R are marks on the ruler, never fixed sells (the owner's D-013, 2026-11-12, superseding B19 and E51): 3R is
    // where the stop can move up to breakeven, 5R sits in the 5 to 10R zone where a first sell into strength is often best
    expect(key).toHaveTextContent('3R11.83three times the risk: a mark on the ruler, not a sell; the stop can move up to breakeven between 2R and 5R')
    expect(key).toHaveTextContent('5R12.22five times the risk: inside the 5 to 10R zone, where a first sell into strength is often best, by judgment, usually day 3 or later')
    expect(key.textContent).not.toMatch(/target|third|trim/i)
  })

  it('names the marks from the plan\'s own trim_r, and only 5 to 10R is the zone to sell into', () => {
    render(<ChartKey trade={{ ...plan, trim_r: [2, 4] }} testId="key" />)
    expect(screen.getByTestId('key')).toHaveTextContent('2R11.83twice the risk: a mark on the ruler, not a sell')
    expect(screen.getByTestId('key')).toHaveTextContent('4R12.22four times the risk: a mark on the ruler, not a sell')
    expect(screen.getByTestId('key').textContent).not.toMatch(/zone/)
  })

  it('a setup without a trade shows the line it must hold, and whether it held', () => {
    render(<ChartKey trade={{ kind: 'signal', short: false, line: 42.1, broke: null }} testId="key" />)
    expect(screen.getByTestId('key')).toHaveTextContent('Must hold42.10')
    expect(screen.getByTestId('key')).toHaveTextContent('held through the run')
  })

  // the screen check (2026-11-14): each cell drew the row's divider as its own top border, at its own height, so the
  // dividers stepped where a row's cells differed in height and stopped short under the status pill (whose own border
  // replaced it). One rule element now runs across the whole row between two levels; the pill sits in a cell of its
  // own, so a row is always five cells; a drill key standing apart from its chart (the replay control between) is framed
  it('one rule between two levels, five cells to a row with the pill inside the last; a detached key carries its frame', () => {
    render(<ChartKey trade={plan} testId="key" detached />)
    const key = screen.getByTestId('key')
    const rows = [...key.querySelectorAll('[role="listitem"]')]
    expect(rows.every((r) => r.children.length === 5)).toBe(true)
    expect(rows[0].lastElementChild.firstElementChild.textContent).toBe('bought here')
    expect(rows[0].lastElementChild.className).toMatch(/statusCell/)
    // a rule before every row but the first, and nothing else between them
    const kids = [...key.children].slice(1)
    expect(kids.map((e) => (e.getAttribute('role') === 'listitem' ? 'row' : /sep/.test(e.className) ? 'rule' : '?')))
      .toEqual(rows.flatMap((_, i) => (i ? ['rule', 'row'] : ['row'])))
    expect(key.className).toMatch(/detached/)
  })

  it('draws nothing without a trade', () => {
    const { container } = render(<ChartKey trade={null} />)
    expect(container).toBeEmptyDOMElement()
  })
})

import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { EndReport, EndStatement, EndTrophy } from './EndLooks'
import { bySetup, tierOf } from './endMath'

// Focus round 3: three end screens. Every number on them is counted from the run; these pin the counting.
const log = [
  { name: 'Bear gap', ticker: 'DUOL', ok: true }, { name: 'Bear gap', ticker: 'THO', ok: false, said: 'Nothing fired' },
  { name: 'Oops Reversal', ticker: 'VG', ok: false, said: 'Kicker' }, { name: 'Nothing fired', ticker: '', ok: false, said: 'Bear gap' },
]
const results = log.map((r) => r.ok)

describe('the end screen, three versions', () => {
  it('tiers a run by the share named, and names the next tier', () => {
    expect(tierOf(8, 8)).toMatchObject({ key: 'legend', next: null })
    expect(tierOf(6, 8)).toMatchObject({ key: 'gold', next: { name: 'Legendary', more: 2 } })
    expect(tierOf(5, 8)).toMatchObject({ key: 'silver', next: { name: 'Gold', more: 1 } })
    expect(tierOf(1, 8)).toMatchObject({ key: 'bronze', next: { name: 'Silver', more: 3 } })
    expect(tierOf(0, 8)).toMatchObject({ key: 'none', next: { name: 'Bronze', more: 1 } })
  })
  it('scores every setup in the run, worst first', () => {
    expect(bySetup(log).map((r) => [r.name, r.ok, r.n])).toEqual([['Nothing fired', 0, 1], ['Oops Reversal', 0, 1], ['Bear gap', 1, 2]])
  })
  it('the report card sends the member to practise a real setup, never to "Nothing fired"', () => {
    const { container } = render(<EndReport right={1} total={4} xp={8} log={log} results={results} />)
    expect(container.textContent).toContain('Practise Oops Reversal')
    expect(container.textContent).not.toContain('Practise Nothing fired')
  })
  it('the trophy and the statement say the score as counted', () => {
    expect(render(<EndTrophy right={1} total={4} xp={8} log={log} results={results} />).container.textContent).toContain('1 of 4 named without a ticker')
    const st = render(<EndStatement right={1} total={4} xp={8} log={log} results={results} date="Nov 8, 2026" />).container
    expect(st.querySelectorAll('[role="row"]')).toHaveLength(5)
    expect(st.textContent).toContain('Missed')
  })
})

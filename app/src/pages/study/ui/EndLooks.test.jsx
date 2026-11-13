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
    // a short run: the next tier can be out of reach, so the hint names the medal the next right answer really lights
    expect(tierOf(2, 3)).toMatchObject({ key: 'silver', next: { name: 'Legendary', more: 1 } })
    expect(tierOf(1, 2)).toMatchObject({ key: 'silver', next: { name: 'Legendary', more: 1 } })
    expect(tierOf(0, 1)).toMatchObject({ key: 'none', next: { name: 'Legendary', more: 1 } })
    expect(tierOf(1, 3)).toMatchObject({ key: 'bronze', next: { name: 'Silver', more: 1 } })
    expect(tierOf(2, 4)).toMatchObject({ key: 'silver', next: { name: 'Gold', more: 1 } })
    expect(tierOf(0, 0)).toMatchObject({ key: 'none', next: { name: 'Bronze', more: 1 } })
    // every hint, on every run length up to 12: the named tier is the one those extra right answers would earn
    for (let total = 1; total <= 12; total += 1) {
      for (let right = 0; right < total; right += 1) {
        const { next } = tierOf(right, total)
        expect(tierOf(right + next.more, total).name, `${right} of ${total}`).toBe(next.name)
      }
    }
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

describe('EndHard run cards', () => {
  it('a miss names what was said and what it was', async () => {
    const { render, screen } = await import('@testing-library/react')
    const { EndHard } = await import('./EndLooks')
    render(<EndHard right={0} total={1} log={[{ name: 'Kicker', ticker: 'JBI', ok: false, said: 'Yes', was: 'No' }]} results={[false]} onAgain={() => {}} onBack={() => {}} />)
    expect(screen.getByText('you said Yes, it was No')).toBeInTheDocument()
  })
})

describe('the level bar on the end screen', () => {
  it('fills from the run start to its end, and calls a level up when the run crosses one', async () => {
    const { render, screen } = await import('@testing-library/react')
    const { EndHard } = await import('./EndLooks')
    render(<EndHard right={1} total={1} log={[]} results={[true]} onAgain={() => {}} onBack={() => {}} level={{ before: 480, after: 530 }} />)
    expect(screen.getByTestId('hard-level')).toHaveTextContent('+50 XP this run')
    expect(screen.getByTestId('hard-level-up')).toHaveTextContent('Level up · Level 2 · Bronze')
  })
  it('no level up inside a level', async () => {
    const { render, screen } = await import('@testing-library/react')
    const { EndHard } = await import('./EndLooks')
    render(<EndHard right={1} total={1} log={[]} results={[true]} onAgain={() => {}} onBack={() => {}} level={{ before: 100, after: 130 }} testIdPrefix="boss" />)
    expect(screen.getByTestId('boss-level')).toHaveTextContent('370 XP to Level 2')
    expect(screen.queryByTestId('boss-level-up')).toBeNull()
  })
})

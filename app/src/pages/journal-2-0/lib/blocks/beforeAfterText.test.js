// "Before / after this rule" sentences (Notebook P2b Task 9; spec §P2 item 2; R-P2b-3). Never a
// percentage on fewer than 10 trades without saying so.
import { describe, it, expect } from 'vitest'
import { windowLines } from './beforeAfterText'

const w = (o) => ({ trades: 0, wins: 0, winRate: null, rCount: 0, avgR: null, adherenceCount: 0, adherence: null, small: true, ...o })

describe('windowLines (spec: never a percentage on fewer than 10 trades without saying so)', () => {
  it('empty', () => {
    expect(windowLines(w({}))).toEqual({ winRate: 'No trades', avgR: 'No R recorded', adherence: 'No checklist record' })
  })
  it('small: counts, and says why there is no rate', () => {
    expect(windowLines(w({ trades: 7, wins: 4, winRate: 4 / 7 })).winRate).toBe('4 of 7 won (too few trades to read as a rate)')
  })
  it('enough: a rate with its sample', () => {
    const l = windowLines(w({ trades: 21, wins: 13, winRate: 13 / 21, small: false, rCount: 18, avgR: 1.4, adherenceCount: 12, adherence: 0.8 }))
    expect(l).toEqual({ winRate: '62% won (13 of 21 trades)', avgR: '+1.40 R average (over 18 trades)',
      adherence: '80% of checklist items followed (over 12 trades)' })
  })
  it('adherence under 10 records says so', () => {
    expect(windowLines(w({ trades: 30, small: false, adherenceCount: 6, adherence: 0.5 })).adherence)
      .toBe('50% of checklist items followed (only 6 trades: too few to read as a rate)')
  })
  it('a CONTROL at the boundary: 10 records is a rate, 9 is not', () => {
    expect(windowLines(w({ adherenceCount: 10, adherence: 0.5 })).adherence).toBe('50% of checklist items followed (over 10 trades)')
    expect(windowLines(w({ adherenceCount: 9, adherence: 0.5 })).adherence).toMatch(/too few to read as a rate/)
  })
  it('m5: with no `small` from the server, the sample decides (n < 10 is small)', () => {
    const noFlag = (o) => { const x = w(o); delete x.small; return x }
    expect(windowLines(noFlag({ trades: 7, wins: 4, winRate: 4 / 7 })).winRate).toBe('4 of 7 won (too few trades to read as a rate)')
    expect(windowLines(noFlag({ trades: 12, wins: 6, winRate: 0.5 })).winRate).toBe('50% won (6 of 12 trades)')
    // CONTROL: the server's own answer still wins when it gives one
    expect(windowLines(w({ trades: 12, wins: 6, winRate: 0.5, small: true })).winRate).toBe('6 of 12 won (too few trades to read as a rate)')
  })
  it('a losing average reads with its sign, and no window at all reads as empty', () => {
    expect(windowLines(w({ trades: 3, rCount: 3, avgR: -0.5 })).avgR).toBe('-0.50 R average (over 3 trades)')
    expect(windowLines(null)).toEqual({ winRate: 'No trades', avgR: 'No R recorded', adherence: 'No checklist record' })
  })
})

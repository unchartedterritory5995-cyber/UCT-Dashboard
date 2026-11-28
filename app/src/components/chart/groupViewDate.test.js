// (zero-network PR 1.3) the date a colour group's charts are at
import { describe, it, expect, beforeEach } from 'vitest'
import { publishGroupDate, groupDateFor, _resetGroupDatesForTests } from './groupViewDate'

beforeEach(() => _resetGroupDatesForTests())

describe('groupViewDate', () => {
  it('a chart\'s date is its group\'s; another group is untouched; null clears the owner', () => {
    publishGroupDate('A', 'c1', '2006-03-14')
    expect(groupDateFor('A')).toBe('2006-03-14')
    expect(groupDateFor('B')).toBe(null)
    publishGroupDate('A', 'c1', null)
    expect(groupDateFor('A')).toBe(null)
  })
  it('two charts on one colour: the latest published wins; one leaving leaves the other\'s', () => {
    publishGroupDate('A', 'c1', '2006-03-14')
    publishGroupDate('A', 'c2', '2012-01-03')
    expect(groupDateFor('A')).toBe('2012-01-03')
    publishGroupDate('A', 'c2', null)
    expect(groupDateFor('A')).toBe('2006-03-14')
  })
  it('a chart that publishes AGAIN is the latest (its new date wins over a chart that published after its first)', () => {
    publishGroupDate('A', 'c1', '2006-03-14')
    publishGroupDate('A', 'c2', '2012-01-03')
    publishGroupDate('A', 'c1', '2008-06-02')
    expect(groupDateFor('A')).toBe('2008-06-02')
  })
})

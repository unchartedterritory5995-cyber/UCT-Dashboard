import { describe, it, expect } from 'vitest'
import { countsLine, filterLessons, lessonVerdictBody, livePct, verdictWord } from './studyHubHelpers'

const LESSONS = [
  { key: 'hammer', label: 'Hammer', charts: { approved: 14 }, verdict: { verdict: 'approve' } },
  { key: 'doji', label: 'Doji', charts: { approved: 2, draft: 3 }, verdict: null },
  { key: 'kicking-bullish', label: 'Kicking (Bull)', charts: {}, verdict: { verdict: 'fix' } },
]

describe('studyHubHelpers', () => {
  it('countsLine names what is live, waiting and cut, and leaves zeros out', () => {
    expect(countsLine({ approved: 604, draft: 0, rejected: 222, retired: 0 })).toBe('604 live · 222 rejected')
    expect(countsLine({ approved: 0, draft: 0 })).toBe('nothing yet')
    expect(countsLine(null)).toBe('nothing yet')
  })

  it('livePct is the live share of what is live or waiting', () => {
    expect(livePct({ approved: 3, draft: 1, rejected: 50 })).toBe(75)
    expect(livePct({})).toBe(0)
  })

  it('filterLessons keeps by verdict, by thinness and by name', () => {
    expect(filterLessons(LESSONS, { filter: 'todo' }).map((l) => l.key)).toEqual(['doji'])
    expect(filterLessons(LESSONS, { filter: 'approve' }).map((l) => l.key)).toEqual(['hammer'])
    expect(filterLessons(LESSONS, { filter: 'fix' }).map((l) => l.key)).toEqual(['kicking-bullish'])
    expect(filterLessons(LESSONS, { filter: 'thin' }).map((l) => l.key)).toEqual(['doji', 'kicking-bullish'])
    expect(filterLessons(LESSONS, { q: 'KICK' }).map((l) => l.key)).toEqual(['kicking-bullish'])
    expect(filterLessons(null)).toEqual([])
  })

  it('lessonVerdictBody is a screen note on the lessons view that names the lesson', () => {
    expect(lessonVerdictBody(LESSONS[1], 'fix', '  needs the trend  ')).toEqual({
      screen: 'lessons', kind: 'learning', verdict: 'fix', text: 'needs the trend',
      context: { lesson_key: 'doji', label: 'Doji' },
    })
    expect(lessonVerdictBody(LESSONS[0], 'approve', '').kind).toBe('great')
    expect(lessonVerdictBody(LESSONS[0], 'approve', '').text).toBeNull()
  })

  it('verdictWord reads the latest verdict', () => {
    expect(LESSONS.map(verdictWord)).toEqual(['Approved', 'Not reviewed', 'Needs fix'])
  })
})

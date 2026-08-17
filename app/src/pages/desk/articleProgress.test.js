import { beforeEach, describe, expect, test, vi } from 'vitest'
import * as p from './articleProgress'

const NOW = 1787000000000
const DAY = 24 * 3600 * 1000

beforeEach(() => { localStorage.clear() })

describe('remembering a place', () => {
  test('a place saved is a place returned', () => {
    p.save('s1', { sectionId: 'market-breadth-data', pct: 0.42 }, NOW)
    expect(p.load('s1', NOW)).toMatchObject({ sectionId: 'market-breadth-data', pct: 0.42 })
  })

  test('articles do not bleed into each other', () => {
    p.save('s1', { sectionId: 'a', pct: 0.4 }, NOW)
    p.save('s2', { sectionId: 'b', pct: 0.6 }, NOW)
    expect(p.load('s1', NOW).sectionId).toBe('a')
    expect(p.load('s2', NOW).sectionId).toBe('b')
    expect(p.load('never-read', NOW)).toBeNull()
  })

  test('the newest position for an article wins', () => {
    p.save('s1', { sectionId: 'a', pct: 0.2 }, NOW)
    p.save('s1', { sectionId: 'z', pct: 0.7 }, NOW + 1000)
    expect(p.load('s1', NOW + 1000).sectionId).toBe('z')
  })
})

describe('when NOT to offer a resume', () => {
  test('barely started — jumping is more disruptive than helpful', () => {
    p.save('s1', { sectionId: 'a', pct: 0.01 }, NOW)
    expect(p.load('s1', NOW)).toBeNull()
    expect(JSON.parse(localStorage.getItem('uct.desk.article.progress'))).toEqual({})
  })

  test('effectively finished — never offer to resume the end', () => {
    p.save('s1', { sectionId: 'a', pct: 0.98 }, NOW)
    expect(p.load('s1', NOW)).toBeNull()
    // ⛔ Assert the SAVE side too. load() applies the same range guard, so
    // checking only load() passes even if save() happily stored the entry —
    // and a stored 98% would resurface the moment either guard moved.
    expect(JSON.parse(localStorage.getItem('uct.desk.article.progress'))).toEqual({})
  })

  test('reaching the end CLEARS an earlier bookmark', () => {
    p.save('s1', { sectionId: 'a', pct: 0.4 }, NOW)
    p.save('s1', { sectionId: 'z', pct: 0.99 }, NOW + 1000)
    expect(p.load('s1', NOW + 1000)).toBeNull()
  })

  test('a position with no section is not a position', () => {
    p.save('s1', { sectionId: '', pct: 0.4 }, NOW)
    expect(p.load('s1', NOW)).toBeNull()
  })

  test('last month is a different week, not "where I left off"', () => {
    p.save('s1', { sectionId: 'a', pct: 0.4 }, NOW)
    expect(p.load('s1', NOW + 61 * DAY)).toBeNull()
  })

  test('clear() forgets it', () => {
    p.save('s1', { sectionId: 'a', pct: 0.4 }, NOW)
    p.clear('s1')
    expect(p.load('s1', NOW)).toBeNull()
  })
})

describe('storage hygiene', () => {
  test('it does not grow without bound', () => {
    for (let i = 0; i < p.MAX_ENTRIES + 25; i++) {
      p.save(`s${i}`, { sectionId: 'a', pct: 0.4 }, NOW + i)
    }
    const kept = Object.keys(JSON.parse(localStorage.getItem('uct.desk.article.progress')))
    expect(kept.length).toBe(p.MAX_ENTRIES)
    // the most recent survive, the oldest are dropped
    expect(kept).toContain(`s${p.MAX_ENTRIES + 24}`)
    expect(kept).not.toContain('s0')
  })

  test('expired entries are pruned on the next write', () => {
    p.save('old', { sectionId: 'a', pct: 0.4 }, NOW)
    p.save('new', { sectionId: 'a', pct: 0.4 }, NOW + 61 * DAY)
    const kept = Object.keys(JSON.parse(localStorage.getItem('uct.desk.article.progress')))
    expect(kept).toEqual(['new'])
  })
})

describe('storage failure must never break the reader', () => {
  test('corrupt JSON reads as empty', () => {
    localStorage.setItem('uct.desk.article.progress', '{not json')
    expect(p.load('s1', NOW)).toBeNull()
    expect(() => p.save('s1', { sectionId: 'a', pct: 0.4 }, NOW)).not.toThrow()
  })

  test('a non-object payload reads as empty', () => {
    localStorage.setItem('uct.desk.article.progress', '["nope"]')
    expect(p.load('s1', NOW)).toBeNull()
  })

  test('a quota error on write is swallowed', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(() => p.save('s1', { sectionId: 'a', pct: 0.4 }, NOW)).not.toThrow()
    spy.mockRestore()
  })

  test('a missing slug is a no-op, not a crash', () => {
    expect(() => p.save('', { sectionId: 'a', pct: 0.4 }, NOW)).not.toThrow()
    expect(p.load('', NOW)).toBeNull()
    expect(() => p.clear(undefined)).not.toThrow()
  })
})

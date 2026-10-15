import { describe, it, expect } from 'vitest'
import { memberChapterTitle } from './playerUtils'

describe('memberChapterTitle', () => {
  it('drops an internal production note', () => {
    expect(memberChapterTitle('Season opener (private recording, ep 919 season 12)')).toBe('Season opener')
    expect(memberChapterTitle('Intro (internal only)')).toBe('Intro')
  })
  it('keeps ordinary parentheticals', () => {
    expect(memberChapterTitle('Breakout setups (CLSK, HUT)')).toBe('Breakout setups (CLSK, HUT)')
    expect(memberChapterTitle('Special guest (Manrav)')).toBe('Special guest (Manrav)')
  })
  it('never empties a title', () => {
    expect(memberChapterTitle('(private recording, ep 3)')).toBe('(private recording, ep 3)')
    expect(memberChapterTitle(undefined)).toBe('')
  })
})

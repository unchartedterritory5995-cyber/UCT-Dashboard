import { describe, it, expect } from 'vitest'
import { boardRefusalIn, boardRefusalSentence, boardLayoutRefusalSentence } from './boardBound'

describe('boardRefusalIn', () => {
  it('finds the bound sentence inside a longer refusal, whole', () => {
    const s = boardRefusalSentence(17)
    expect(boardRefusalIn(`I didn't change anything: ${s}`)).toBe(s)
  })
  it('finds nothing in any other refusal, the layout one included', () => {
    expect(boardRefusalIn(boardLayoutRefusalSentence(20))).toBe(null)
    expect(boardRefusalIn("I didn't change anything: there's no empty space for a News.")).toBe(null)
    expect(boardRefusalIn(null)).toBe(null)
  })
})

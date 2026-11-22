// Notebook simplify pass 2 (A7): the phone top bar names the page a member is on. On the Notebook it said
// "Journal" (the longest matching prefix was /journal); it says "Notebook" on every /journal/notebook address,
// and every other Journal page still says "Journal".
import { describe, expect, it } from 'vitest'
import { titleFor } from './MobileNav'

describe('the phone top bar title (titleFor)', () => {
  it('reads "Notebook" on the Notebook and on any address under it', () => {
    expect(titleFor('/journal/notebook')).toBe('Notebook')
    expect(titleFor('/journal/notebook/setups')).toBe('Notebook')
  })

  it('still reads "Journal" on the rest of the Journal', () => {
    expect(titleFor('/journal')).toBe('Journal')
    expect(titleFor('/journal/trades')).toBe('Journal')
    // a prefix match is whole segments only: a sibling that merely starts with the word is not the Notebook
    expect(titleFor('/journal/notebooks')).toBe('Journal')
  })

  it('an address no row names falls back to the app name', () => {
    expect(titleFor('/nowhere')).toBe('UCT')
  })
})

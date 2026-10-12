// R-M2-1 (e): the regime's display words. Equality with the board property's labels is railed in Python
// (tests/test_house_sizing_table.py, against the live BUILTIN_PROPERTY_DEFS); here, every id the sizing
// table knows has a word, and the lookup is by own key.
import { describe, it, expect } from 'vitest'
import { REGIME_WORDS, regimeWord } from './regimeWords'
import { REGIME_OF } from './houseSizing'

describe('regimeWords', () => {
  it('every regime id the sizing table knows has a display word, and no other', () => {
    expect(Object.keys(REGIME_WORDS).sort()).toEqual(Object.keys(REGIME_OF).sort())
    expect(Object.keys(REGIME_WORDS).length).toBe(4)                    // non-vacuity
  })
  it('the word is the board label, never the table key', () => {
    expect(regimeWord('amber')).toBe('Yellow')
    expect(REGIME_OF.amber).toBe('YELLOW')
  })
  it('an id it does not hold, or an inherited key, is null', () => {
    for (const id of ['constructor', 'toString', 'purple', '', null, undefined, 3]) expect(regimeWord(id), String(id)).toBeNull()
  })
})

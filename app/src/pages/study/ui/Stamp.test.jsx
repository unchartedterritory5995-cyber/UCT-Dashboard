// The verdict seal's word (the Study screen check, 2026-11-14): the lesson's inline seal printed its word at 8 px, a size
// the eight-letter "Named it" needs to fit the 72 px seal. A short word ("Right", "Miss") takes the legible size.
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import Stamp, { STAMP_SHORT_WORD } from './Stamp'

const word = (c) => c.querySelector('[data-word]')

describe('the seal word', () => {
  it('a short word takes the legible size; "Named it" keeps the squeeze it needs', () => {
    expect(STAMP_SHORT_WORD).toBe(5)
    const right = render(<Stamp ok word="Right" inline />)
    expect(word(right.container).textContent).toBe('Right')
    expect(word(right.container).className).toMatch(/stampWordShort/)
    const miss = render(<Stamp ok={false} inline />)
    expect(word(miss.container).textContent).toBe('Miss')
    expect(word(miss.container).className).toMatch(/stampWordShort/)
    const named = render(<Stamp ok inline />)
    expect(word(named.container).textContent).toBe('Named it')
    expect(word(named.container).className).not.toMatch(/stampWordShort/)
  })
})

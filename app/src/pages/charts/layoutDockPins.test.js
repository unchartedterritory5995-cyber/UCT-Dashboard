// shiftPin: a non-integer index leaves the rail as it was (it used to step past `to` and never stop).
import { describe, it, expect } from 'vitest'
import { shiftPin } from './layoutDockPins'

describe('shiftPin', () => {
  const pins = ['a', 'b', 'c', 'd']
  it('moves one slot like repeated Move left / Move right', () => {
    expect(shiftPin(pins, 0, 2)).toEqual(['b', 'c', 'a', 'd'])
    expect(shiftPin(pins, 3, 1)).toEqual(['a', 'd', 'b', 'c'])
  })
  it('a non-integer or out-of-range index returns the rail unchanged', () => {
    for (const [f, t] of [[0.5, 2], [0, 1.5], [NaN, 1], [0, Infinity], ['1', 2], [-1, 2], [0, 4]]) expect(shiftPin(pins, f, t)).toBe(pins)
  })
})

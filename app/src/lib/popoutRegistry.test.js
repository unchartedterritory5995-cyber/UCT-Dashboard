import { describe, it, expect } from 'vitest'
import { registerPopout, hasOpenPopouts } from './popoutRegistry'

describe('popoutRegistry', () => {
  it('is false with nothing registered', () => {
    expect(hasOpenPopouts()).toBe(false)
  })

  it('stays true until every registration is released', () => {
    const a = registerPopout()
    const b = registerPopout()
    expect(hasOpenPopouts()).toBe(true)
    a()
    expect(hasOpenPopouts()).toBe(true)
    b()
    expect(hasOpenPopouts()).toBe(false)
  })

  it('a double unregister does not underflow or release someone else', () => {
    const a = registerPopout()
    const b = registerPopout()
    a()
    a()
    expect(hasOpenPopouts()).toBe(true)
    b()
    expect(hasOpenPopouts()).toBe(false)
    const c = registerPopout()
    expect(hasOpenPopouts()).toBe(true)
    c()
  })
})

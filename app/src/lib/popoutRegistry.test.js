import { describe, it, expect } from 'vitest'
import { registerPopout, hasOpenPopouts, subscribePopouts } from './popoutRegistry'

describe('popoutRegistry subscribers', () => {
  it('tells a subscriber only when the count crosses zero, not per window', () => {
    let calls = 0
    const stop = subscribePopouts(() => { calls += 1 })
    const a = registerPopout()
    expect(calls).toBe(1)
    const b = registerPopout()
    expect(calls, 'a second window does not change the answer').toBe(1)
    b()
    expect(calls).toBe(1)
    a()
    expect(calls).toBe(2)
    stop()
    registerPopout()()
    expect(calls, 'after unsubscribing nothing arrives').toBe(2)
  })
})

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

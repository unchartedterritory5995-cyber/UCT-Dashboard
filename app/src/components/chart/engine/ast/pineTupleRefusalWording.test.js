import { describe, it, expect } from 'vitest'
import { translatePine } from './pine'

describe('⭐⭐ ta.supertrend refuses its tuple form with its own real reason', () => {
  it('names the recurrence gap, not the generic "no tuple form" list', () => {
    const t = translatePine(`//@version=6
indicator("t3", overlay=true)
[dir, level] = ta.supertrend(3, 10)
plot(dir)
`, { strict: true })
    expect(t.ok).toBe(false)
    expect(t.refusal.guard).toBe('pine:tuple')
    expect(t.refusal.message).toMatch(/previous bar|its own previous value|recurrence/i)
    expect(t.refusal.message).not.toMatch(/the ones it can take apart are/)
  })

  it('CONTROL: an unrelated unknown-tuple callee still gets the generic list', () => {
    const t = translatePine(`//@version=6
indicator("t3b", overlay=true)
[a, b] = ta.nonexistentThing(1, 2)
plot(a)
`, { strict: true })
    expect(t.ok).toBe(false)
    expect(t.refusal.message).toMatch(/the ones it can take apart are/)
  })

  it('CONTROL: bb/macd/kc are unaffected', () => {
    const t = translatePine(`//@version=6
indicator("t3c", overlay=true)
[mid, upper, lower] = ta.bb(close, 20, 2)
plot(mid)
`, { strict: true })
    expect(t.ok).toBe(true)
  })
})

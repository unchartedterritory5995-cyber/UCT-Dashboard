import { describe, it, expect } from 'vitest'
import { translatePine } from './pine'

// ⭐⭐ 2026-10-29: `ta.supertrend` TRANSLATES. This file used to pin its tuple REFUSAL
// ("its own previous value … a missing primitive"), which was right while the grammar
// had no self-reference. The tuple is now `callExpansions.js::supertrendTrees` — the
// three bounded `accum` recurrences that KEEP the ratchet and the flip — and
// `supertrend.test.js` holds every published bar to Pine's own source. What stays here
// is that a WRONG destructure of it is told the shape, never the generic list.
describe('⭐⭐ ta.supertrend — the tuple translates, a wrong shape names the right one', () => {
  it('the two-name destructure translates (names are the script\'s own)', () => {
    const t = translatePine(`//@version=6
indicator("t3", overlay=true)
[dir, level] = ta.supertrend(3, 10)
plot(dir)
`, { strict: true })
    expect(t.ok, t.ok ? '' : t.refusal.message).toBe(true)
  })

  it('three names: refused with the spelling that works, not the generic list', () => {
    const t = translatePine(`//@version=6
indicator("t3", overlay=true)
[a, b, c] = ta.supertrend(3, 10)
plot(a)
`, { strict: true })
    expect(t.ok).toBe(false)
    expect(t.refusal.guard).toBe('pine:tuple')
    expect(t.refusal.message).toContain('[supertrend, direction] = ta.supertrend(factor, atrPeriod)')
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

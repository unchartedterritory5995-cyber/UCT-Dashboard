// The plain-words drafts: every setup has three short steps and a "not it" line, and no lesson shows one until the owner
// approves it (the bank's words stay until then).
import { describe, expect, it } from 'vitest'
import { PLAIN_RULES, approvedPlainRule } from './studyPlainRules'

describe('the setups in plain words', () => {
  it('every draft is three short steps and a not-it line', () => {
    for (const [id, r] of Object.entries(PLAIN_RULES)) {
      expect(r.steps, id).toHaveLength(3)
      for (const step of r.steps) expect(step.length, `${id}: ${step}`).toBeLessThan(170)
      expect(r.notIt.length, id).toBeGreaterThan(10)
      expect(/the firm/i.test(r.steps.join(' ') + r.notIt), id).toBe(false)
    }
  })

  it('nothing shows before the owner approves it', () => {
    for (const id of Object.keys(PLAIN_RULES)) {
      expect(approvedPlainRule(id), id).toBe(PLAIN_RULES[id].approved ? PLAIN_RULES[id] : null)
    }
    expect(approvedPlainRule('setup.nope')).toBe(null)
  })
})

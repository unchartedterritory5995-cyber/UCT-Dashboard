// O7: `model:unavailable` is the provider refusing OUR account (a key, a permission, credit).
// The member is told what they are told for an outage, never the reason, and never the sentence
// that blames the assistant's answer.

import { describe, it, expect } from 'vitest'
import { memberRefusal } from './memberWords'

describe('model:unavailable in member words', () => {
  const said = memberRefusal('model:unavailable', 'the UCT Agent is not available right now')

  it('reads as "briefly unavailable", the same as an outage', () => {
    expect(said).toBe(memberRefusal('model:transport', 'the UCT Agent could not be reached'))
    expect(said).toMatch(/unavailable/i)
  })

  it('says nothing about keys, money or the provider', () => {
    expect(said).not.toMatch(/credit|billing|payment|key|provider|anthropic|40[123]/i)
  })

  it('CONTROL: another model gate still gets the model-fault sentence, which is a different one', () => {
    expect(memberRefusal('model:no-tool', 'x')).not.toBe(said)
  })
})

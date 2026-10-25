// Task 9.6c: the ONE idempotency-key helper (rulings R-43, R-48, R-49, R-50, W9-R48), lifted out of builtWidgets so
// toolsCrud's Duplicate uses the same generator and the same per-intent rule. builtWidgets re-exports it; the rails
// below prove the two names are the same objects, so there is no second generator to drift.
import { describe, it, expect, vi, afterEach } from 'vitest'
import * as keys from './idempotencyKeys'
import * as built from './builtWidgets'

const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
afterEach(() => vi.unstubAllGlobals())

describe('idempotencyKeys: one home', () => {
  it('builtWidgets re-exports the very same functions (no second generator)', () => {
    for (const name of ['newIdempotencyKey', 'isIdempotencyKey', 'outcomeConfirmed', 'keyedSender']) {
      expect(typeof keys[name]).toBe('function')
      expect(built[name]).toBe(keys[name])
    }
  })

  it('a uuid4 without crypto.randomUUID (outside a secure context), and with no crypto at all', () => {
    vi.stubGlobal('crypto', { getRandomValues: (b) => { b.fill(0xab); return b } })
    expect(keys.newIdempotencyKey()).toMatch(UUID4)
    vi.stubGlobal('crypto', undefined)
    const a = keys.newIdempotencyKey()
    const b = keys.newIdempotencyKey()
    expect(a).toMatch(UUID4)
    expect(b).toMatch(UUID4)
    expect(a).not.toBe(b)
  })

  it('keyedSender takes its own `confirmed` rule (a caller whose answers have another shape)', async () => {
    const send = keys.keyedSender({ confirmed: (got) => got === 'settled' })
    const seen = []
    const answers = ['lost', 'settled', 'settled']
    const go = () => send('i', null, async (k) => { seen.push(k); return answers.shift() })
    await go()
    await go()
    await go()
    expect(seen[1]).toBe(seen[0])                 // unconfirmed by ITS rule: the same key
    expect(seen[2]).not.toBe(seen[1])             // confirmed: a fresh key
  })
})

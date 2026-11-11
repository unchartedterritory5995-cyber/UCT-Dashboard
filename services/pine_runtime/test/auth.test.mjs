// W5-T6 rails: request signing, rotation, skew and replay (design 3.6).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, createHmac } from 'node:crypto'
import {
  MIN_SECRET_LENGTH, SKEW_SECONDS, ReplayGuard, parseSecrets, parseSignatureHeader, signHeader, signature, verifyBody,
} from '../auth.mjs'
import { SECRET, SECRET_2 } from './helpers.mjs'

const T = 1_800_000_000
const BODY = Buffer.from('{"protocol":1}')

test('v1 is HMAC-SHA256(secret, t "." sha256hex(body)), the wire formula T11 signs with', () => {
  const want = createHmac('sha256', SECRET).update(`${T}.${createHash('sha256').update(BODY).digest('hex')}`).digest('hex')
  assert.equal(signature(SECRET, T, BODY), want)
  assert.equal(signHeader(SECRET, T, BODY), `t=${T},v1=${want}`)
})

test('the signature is bound to the body, the timestamp and the key', () => {
  const p = parseSignatureHeader(signHeader(SECRET, T, BODY), T)
  assert.equal(verifyBody([SECRET], p, BODY), true)
  assert.equal(verifyBody([SECRET], p, Buffer.from('{"protocol":2}')), false, 'another body')
  assert.equal(verifyBody([SECRET], { ...p, t: T + 1 }, BODY), false, 'another timestamp')
  assert.equal(verifyBody([SECRET_2], p, BODY), false, 'another key')
})

test('rotation: any listed secret verifies; a removed one does not', () => {
  const p = parseSignatureHeader(signHeader(SECRET_2, T, BODY), T)
  assert.equal(verifyBody([SECRET, SECRET_2], p, BODY), true, 'the second listed secret verifies')
  assert.equal(verifyBody([SECRET], p, BODY), false, 'once removed it is refused')
  assert.deepEqual(parseSecrets(` ${SECRET} , ${SECRET_2}`), [SECRET, SECRET_2])
})

test('a missing, weak or empty secret refuses to boot, and the message never carries a value', () => {
  assert.throws(() => parseSecrets(undefined), /unset or empty/)
  assert.throws(() => parseSecrets(''), /unset or empty/)
  const weak = 'w'.repeat(MIN_SECRET_LENGTH - 1)
  assert.throws(() => parseSecrets(`${SECRET},${weak}`), (e) => /entry 2 of 2 is shorter than 32/.test(e.message) && !e.message.includes(weak) && !e.message.includes(SECRET))
  assert.throws(() => parseSecrets(`${SECRET},`), /entry 2 of 2 is empty/)
  assert.deepEqual(parseSecrets('k'.repeat(MIN_SECRET_LENGTH)), ['k'.repeat(MIN_SECRET_LENGTH)])
})

test('header: malformed or absent is refused; the clock allows exactly SKEW_SECONDS either way', () => {
  assert.match(parseSignatureHeader(undefined, T).reason, /no signature/)
  for (const h of ['t=1,v1=zz', `v1=${'a'.repeat(64)},t=${T}`, `t=${T},v1=${'A'.repeat(64)}`, `t=${T},v1=${'a'.repeat(63)}`,
    `t=-5,v1=${'a'.repeat(64)}`, ` t=${T},v1=${'a'.repeat(64)}`]) {
    assert.match(parseSignatureHeader(h, T).reason, /malformed/, h)
  }
  const h = signHeader(SECRET, T, BODY)
  assert.equal(parseSignatureHeader(h, T + SKEW_SECONDS).t, T)
  assert.equal(parseSignatureHeader(h, T - SKEW_SECONDS).t, T)
  assert.match(parseSignatureHeader(h, T + SKEW_SECONDS + 1).reason, /more than 60 s/)
  assert.match(parseSignatureHeader(h, T - SKEW_SECONDS - 1).reason, /more than 60 s/)
})

test('replay: a signature is admitted once inside the window, and forgotten only after it', () => {
  const g = new ReplayGuard()
  assert.equal(g.admit('a', T, T), true)
  assert.equal(g.admit('a', T, T + 1), false)
  assert.equal(g.admit('b', T, T + 1), true, 'another signature is not a replay')
  assert.equal(g.admit('a', T, T + SKEW_SECONDS), false, 'still remembered at the edge of the window')
  assert.equal(g.admit('a', T, T + SKEW_SECONDS + 1), true, 'pruned once the clock check would refuse it anyway')
  assert.ok(g.seen.size <= 2, 'expired entries are pruned')
})

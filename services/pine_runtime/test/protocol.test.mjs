// W5-T6 rails: the closed schema and the door's hash checks (design 3.2, section 4 L5).
// Run: node --test services/pine_runtime/test/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  MAX_DOC_BYTES, MAX_JOBS, SCHEMA_GUARD, INTEGRITY_GUARD, ENGINE_GUARD, DOC_UNKNOWN_GUARD,
  parseRunRequest, sameIdentity,
} from '../protocol.mjs'
import { DOOR, IDENTITY, barsWire, f64b64, mutate, rng, validRequest } from './helpers.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const body = (o) => Buffer.from(JSON.stringify(o))
const parse = (o, door = DOOR) => parseRunRequest(Buffer.isBuffer(o) ? o : body(o), door)
function refused(o, status, guard, re) {
  const r = parse(o)
  assert.equal(r.ok, false, 'expected a refusal')
  assert.equal(r.status, status, r.sentence)
  assert.equal(r.guard, guard)
  if (re) assert.match(r.sentence, re)
  return r
}

test('a valid request parses, and the bars come back decoded', () => {
  const r = parse(validRequest())
  assert.equal(r.ok, true, r.sentence)
  assert.equal(r.request.jobs.length, 2)
  const bars = r.request.jobs[0].bars
  assert.ok(bars.c instanceof Float64Array)
  assert.deepEqual([...bars.c], [100.5, 101.5, 102.5, 103.5, 104.5])
  assert.equal(bars.bytes, undefined, 'raw bytes are not handed on')
  assert.deepEqual(r.request.definition.doc.compute.fn, 'runtime')
  assert.deepEqual(r.request.jobs[0].ctx.runtimeInputs, { length: 14 })
})

test('fuzz (L5): 600 seeded mutations of a valid request are each a 400 at the schema', () => {
  const rand = rng(0x5eed)
  const names = new Set()
  for (let i = 0; i < 600; i += 1) {
    const m = mutate(rand)
    const r = parseRunRequest(m.body, DOOR)
    assert.equal(r.ok, false, `mutation ${i} (${m.name}) was accepted`)
    assert.equal(r.status, 400, `mutation ${i} (${m.name}): ${r.sentence}`)
    assert.equal(r.guard, SCHEMA_GUARD)
    names.add(m.name.split(' ')[0])
  }
  // The fuzz exercised every operator, so a broken operator cannot pass as "no refusals seen".
  for (const op of ['extra', 'missing', 'truncated', 'byte']) assert.ok(names.has(op), `operator ${op} never ran`)
})

test('protocol must be 1, and a missing key is named as missing', () => {
  for (const p of [0, 2, '1']) { const q = validRequest(); q.protocol = p; refused(q, 400, SCHEMA_GUARD, /^protocol: must be 1$/) }
  for (const [at, key] of [[(q) => q, 'profile'], [(q) => q.definition, 'doc'], [(q) => q.jobs[0].bars, 'sha256'], [(q) => q.jobs[0].ctx, 'historyFromListing']]) {
    const q = validRequest(); delete at(q)[key]
    refused(q, 400, SCHEMA_GUARD, new RegExp(`missing key "${key}"`))
  }
})

test('closed sets: an unknown key is refused at every level', () => {
  const levels = [
    (q) => q, (q) => q.engine, (q) => q.definition, (q) => q.jobs[1], (q) => q.jobs[1].symbol,
    (q) => q.jobs[1].bars, (q) => q.jobs[1].ctx,
  ]
  for (const at of levels) {
    const q = validRequest()
    at(q).extra = true
    refused(q, 400, SCHEMA_GUARD, /unknown key "extra"/)
  }
})

test('caps: jobs, bars.n, doc bytes, want, ids', () => {
  const tooMany = validRequest({ jobs: 1 })
  tooMany.jobs = Array.from({ length: MAX_JOBS + 1 }, (_, i) => ({ ...tooMany.jobs[0], job: `J${i}` }))
  refused(tooMany, 400, SCHEMA_GUARD, /^jobs:/)
  const atCap = validRequest({ jobs: 1 })
  atCap.jobs = Array.from({ length: MAX_JOBS }, (_, i) => ({ ...atCap.jobs[0], job: `J${i}` }))
  assert.equal(parse(atCap).ok, true, 'MAX_JOBS itself is accepted')

  const none = validRequest(); none.jobs = []
  refused(none, 400, SCHEMA_GUARD, /^jobs:/)

  const small = { ...DOOR, maxBars: 4 }
  const r = parseRunRequest(body(validRequest()), small)
  assert.equal(r.status, 400); assert.match(r.sentence, /bars\.n: must be an integer from 1 to 4/)
  assert.equal(parseRunRequest(body(validRequest()), { ...DOOR, maxBars: 5 }).ok, true, 'n = maxBars is accepted')

  const big = 'x'.repeat(MAX_DOC_BYTES)
  refused(validRequest({ doc: JSON.stringify({ a: big }) }), 400, SCHEMA_GUARD, /definition\.doc: is larger than/)
  const fits = JSON.stringify({ a: 'x'.repeat(MAX_DOC_BYTES - 8) })
  assert.equal(Buffer.byteLength(fits), MAX_DOC_BYTES)
  assert.equal(parse(validRequest({ doc: fits })).ok, true, 'a document of exactly MAX_DOC_BYTES is accepted')

  const dupWant = validRequest(); dupWant.jobs[0].want = ['a', 'a']
  refused(dupWant, 400, SCHEMA_GUARD, /want\[1\]: repeats/)
  const dupJob = validRequest(); dupJob.jobs[1].job = dupJob.jobs[0].job
  refused(dupJob, 400, SCHEMA_GUARD, /jobs\[1\]\.job: repeats/)
})

test('values: tf from the chart set, finite bars, increasing t, canonical base64, exact length', () => {
  const tf = validRequest(); tf.jobs[0].tf = '240'
  refused(tf, 400, SCHEMA_GUARD, /jobs\[0\]\.tf: must be one of 1, 5, 15, 30, 60, D, W, M/)
  for (const [col, values, re] of [
    ['c', [1, 2, NaN, 4, 5], /bars\.c: row 2 is not a finite number/],
    ['v', [1, 2, 3, Infinity, 5], /bars\.v: row 3 is not a finite number/],
    ['t', [1, 2, 2, 4, 5], /bars\.t: is not strictly increasing at row 2/],
    ['t', [1, 2, 3, 5, 4], /bars\.t: is not strictly increasing at row 4/],
    ['o', [1, 2, 3, 4], /bars\.o: must hold exactly n = 5/],
  ]) {
    const q = validRequest()
    q.jobs[0].bars[col] = f64b64(values)
    refused(q, 400, SCHEMA_GUARD, re)
  }
  const ws = validRequest(); ws.jobs[0].bars.h = `${ws.jobs[0].bars.h.slice(0, 8)}\n${ws.jobs[0].bars.h.slice(8)}`
  refused(ws, 400, SCHEMA_GUARD, /bars\.h: must be canonical base64/)
  const urlsafe = validRequest(); urlsafe.jobs[0].bars.h = urlsafe.jobs[0].bars.h.replace(/\+/g, '-').replace(/\//g, '_')
  if (urlsafe.jobs[0].bars.h !== validRequest().jobs[0].bars.h) refused(urlsafe, 400, SCHEMA_GUARD, /canonical base64/)
  const unpadded = validRequest(); unpadded.jobs[0].bars.n = 1
  for (const k of ['t', 'o', 'h', 'l', 'c', 'v']) unpadded.jobs[0].bars[k] = f64b64([1]).replace(/=+$/, '')
  refused(unpadded, 400, SCHEMA_GUARD, /canonical base64/)
  // Base64 whose unused trailing bits are set decodes to the same bytes but is not canonical.
  const padBits = validRequest(); padBits.jobs[0].bars.n = 1
  for (const k of ['t', 'o', 'h', 'l', 'c', 'v']) padBits.jobs[0].bars[k] = 'AAAAAAAA8D8='
  assert.equal(parse(padBits).guard, INTEGRITY_GUARD, 'control: the canonical text passes the schema (only its stale hash is refused)')
  for (const k of ['t', 'o', 'h', 'l', 'c', 'v']) padBits.jobs[0].bars[k] = 'AAAAAAAA8D9='
  refused(padBits, 400, SCHEMA_GUARD, /bars\.t: must be canonical base64/)
  const inputs = validRequest(); inputs.jobs[0].ctx.runtimeInputs = { length: [14] }
  refused(inputs, 400, SCHEMA_GUARD, /runtimeInputs\."length"/)
  const forming = validRequest(); forming.jobs[0].ctx.newestBarIsForming = 'false'
  refused(forming, 400, SCHEMA_GUARD, /newestBarIsForming: must be true or false/)
})

test('a body that is not valid UTF-8 is refused, even where any string would be accepted', () => {
  const q = validRequest(); q.jobs[0].ctx.runtimeInputs = { label: 'aXb' }
  const text = Buffer.from(JSON.stringify(q))
  const at = text.indexOf('aXb') + 1
  assert.equal(parse(text).ok, true, 'control: the same body with a plain byte is accepted')
  text[at] = 0xff
  refused(text, 400, SCHEMA_GUARD, /body: is not UTF-8 JSON/)
})

test('engine identity: every field must equal the service\'s; an integer equals its decimal string', () => {
  for (const k of Object.keys(IDENTITY)) {
    const q = validRequest()
    q.engine[k] = k === 'bundle_sha256' ? 'cd'.repeat(32) : k === 'runtime_language' ? 'pinex' : IDENTITY[k] + 1
    refused(q, 409, ENGINE_GUARD)
  }
  const asText = validRequest(); asText.engine.script_engine = '5'; asText.engine.runtime_ir = '1'
  assert.equal(parse(asText).ok, true, '"5" and 5 are one value (the T3 codec rule)')
  assert.equal(sameIdentity({ ...IDENTITY, script_engine: '5' }, IDENTITY), true)
  assert.equal(sameIdentity({ ...IDENTITY, script_engine: '05' }, IDENTITY), false)
})

test('hashes are recomputed: a doc or bars mismatch is refused, an absent doc is doc-unknown', () => {
  const docLie = validRequest(); docLie.definition.doc_sha256 = '0'.repeat(64)
  refused(docLie, 422, INTEGRITY_GUARD, /doc_sha256 does not match/)
  const swapped = validRequest(); swapped.definition.doc = JSON.stringify({ id: 'other' })
  refused(swapped, 422, INTEGRITY_GUARD, /doc_sha256 does not match/)
  const barsLie = validRequest(); barsLie.jobs[1].bars.sha256 = barsWire(6).sha256
  refused(barsLie, 422, INTEGRITY_GUARD, /jobs\[1\]\.bars\.sha256 does not match/)
  const tampered = validRequest(); tampered.jobs[0].bars.c = f64b64([100.5, 101.5, 102.5, 103.5, 999])
  refused(tampered, 422, INTEGRITY_GUARD, /jobs\[0\]\.bars\.sha256/)
  const absent = validRequest(); absent.definition.doc = null
  refused(absent, 409, DOC_UNKNOWN_GUARD)
  const notObject = validRequest({ doc: '[1,2]' })
  refused(notObject, 400, SCHEMA_GUARD, /must be a JSON object/)
})

test('caps restate no Python authority: MAX_DOC_BYTES and MAX_JOBS equal the values the web pod declares', () => {
  const rd = readFileSync(resolve(REPO, 'api', 'services', 'runtime_definitions.py'), 'utf8')
  const m = /^RUNTIME_MAX_DEFINITION_BYTES = (\d+) \* (\d+)$/m.exec(rd)
  assert.ok(m, 'runtime_definitions.RUNTIME_MAX_DEFINITION_BYTES is declared as <a> * <b>')
  assert.equal(MAX_DOC_BYTES, Number(m[1]) * Number(m[2]))
  const sr = readFileSync(resolve(REPO, 'api', 'services', 'screener', 'scan_run.py'), 'utf8')
  const j = /^MAX_RUN_SYMBOLS = (\d+)$/m.exec(sr)
  assert.ok(j, 'scan_run.MAX_RUN_SYMBOLS is declared')
  assert.equal(MAX_JOBS, Number(j[1]))
})

test('W9-T11: ctx.historyWindowBars is optional, a positive integer when present, and absent when not sent', () => {
  const plain = parse(Buffer.from(JSON.stringify(validRequest())))
  assert.equal(plain.ok, true)
  assert.equal('historyWindowBars' in plain.request.jobs[0].ctx, false, 'a job that states no window carries none')
  const q = validRequest(); q.jobs[0].ctx.historyWindowBars = 4321
  const r = parse(Buffer.from(JSON.stringify(q)))
  assert.equal(r.ok, true)
  assert.equal(r.request.jobs[0].ctx.historyWindowBars, 4321)
  for (const bad of [0, -1, 1.5, '5000', null, true]) {
    const b = validRequest(); b.jobs[0].ctx.historyWindowBars = bad
    refused(b, 400, SCHEMA_GUARD, /historyWindowBars: must be a positive integer/)
  }
})

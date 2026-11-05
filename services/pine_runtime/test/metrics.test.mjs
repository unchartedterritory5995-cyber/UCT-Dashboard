// W5-T9 rails: GET /v1/metrics (signed, same key) and the numbers behind it (metrics.mjs).
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { request as httpRequest } from 'node:http'
import { SIGNATURE_HEADER, signHeader } from '../auth.mjs'
import { LATENCY_WINDOW, createMetrics, percentile } from '../metrics.mjs'
import { PROFILES } from '../protocol.mjs'
import { createPineRuntimeServer, listenDualStack } from '../server.mjs'
import { DOOR, SECRET, SECRET_2, validRequest } from './helpers.mjs'

const T = 1_800_000_000
const servers = []
after(async () => { for (const s of servers) await new Promise((d) => s.close(d)) })

function call(port, { method = 'GET', path = '/v1/metrics', body = Buffer.alloc(0), headers = {} } = {}) {
  return new Promise((done, fail) => {
    const req = httpRequest({ host: '127.0.0.1', port, method, path, headers: { 'content-length': body.length, ...headers } }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        let json = null
        try { json = JSON.parse(text) } catch { /* not json */ }
        done({ status: res.statusCode, json, text })
      })
    })
    req.on('error', fail)
    req.end(body)
  })
}
const sig = (body = Buffer.alloc(0), { secret = SECRET, t = T } = {}) => ({ [SIGNATURE_HEADER]: signHeader(secret, t, body) })

async function boot(o = {}) {
  // W5-INT: in the result schema T7b's seal checks (sentence, warm-up); T9's fixture predated the seal,
  // so after the T7b+T9 merge every run here was a 500.
  const runner = o.runner || (async (req) => req.jobs.map((j, i) => (i === 1
    ? { job: j.job, status: 'withheld', refusals: [{ key: '*', guard: 'runtime:limit', sentence: 'x', bar: 3 }], ms: 40 }
    : { job: j.job, status: 'ok', columns: {}, refusals: [{ key: 'p1', guard: 'runtime:server-output-absent', sentence: 'x', bar: null }],
      warmup: { withheldBars: 0 }, ms: 10 + i })))
  const logs = []
  const server = createPineRuntimeServer({ secrets: [SECRET, SECRET_2], door: DOOR, runner, now: () => T, log: (l) => logs.push(l),
    poolStats: () => ({ starts: 2, kills: 1, recycles: 0, ooms: 0, crashes: 0, queued: 7, live: 2 }),
    canaryStatus: () => ({ ok: true, runs: 3, reds: 0, intervalMs: 900000, last: { verdict: 'green' } }),
    boot: { engine: '5/1/1', bundle: 'abababababab', node: 'v20', workers: 2 }, ...o.server })
  const port = await listenDualStack(server, 0)
  servers.push(server)
  return { port, logs }
}
const runBody = (n) => Buffer.from(JSON.stringify(validRequest({ jobs: n })))

test('percentile: nearest rank, null when empty', () => {
  assert.equal(percentile([], 50), null)
  assert.equal(percentile([5], 95), 5)
  const v = Array.from({ length: 100 }, (_, i) => 100 - i)
  assert.equal(percentile(v, 50), 50)
  assert.equal(percentile(v, 95), 95)
  assert.equal(percentile([3, 1, 2], 100), 3)
})

test('the window keeps the newest LATENCY_WINDOW samples', () => {
  const m = createMetrics()
  for (let i = 0; i < LATENCY_WINDOW + 50; i += 1) m.answered('alert', [{ status: 'ok', ms: i, refusals: [] }])
  const s = m.snapshot()
  assert.equal(s.latency_ms.alert.n, LATENCY_WINDOW)
  assert.equal(s.latency_ms.alert.p50, 50 + Math.ceil(LATENCY_WINDOW / 2) - 1)
  assert.equal(s.jobs.alert.ok, LATENCY_WINDOW + 50)
  assert.deepEqual(Object.keys(s.latency_ms), [...PROFILES])
})

test('a signed GET answers 200 with every field of design 3.8 and counts what the door saw', async () => {
  const { port } = await boot()
  const body = runBody(2)
  assert.equal((await call(port, { method: 'POST', path: '/v1/run', body, headers: sig(body) })).status, 200)
  // an unsigned run is refused at the door and counted by guard
  assert.equal((await call(port, { method: 'POST', path: '/v1/run', body })).status, 401)
  const r = await call(port, { headers: sig(Buffer.alloc(0), { secret: SECRET_2 }) })
  assert.equal(r.status, 200)
  const m = r.json
  assert.equal(m.protocol, 1)
  assert.deepEqual(m.jobs.alert, { ok: 1, withheld: 1 })
  assert.deepEqual(m.jobs.sweep, { ok: 0, withheld: 0 })
  assert.equal(m.refusals['runtime:limit'], 1)
  assert.equal(m.refusals['runtime:server-output-absent'], 1)
  assert.equal(m.refusals['runtime:server-auth'], 1)
  assert.deepEqual(m.latency_ms.alert, { n: 2, p50: 10, p95: 40 })
  assert.equal(m.latency_ms.sweep.p50, null)
  assert.equal(m.instructions, null, 'not on the wire yet: null, never 0')
  // W5-INT: the result lane's own counts. Two misses; the runtime:limit stop is stored, the ok answer
  // is not (its per-output refusal is a runtime:server-* guard, which design 3.3 never caches)
  assert.deepEqual({ ...m.cache, bytes: undefined }, { hits: 0, misses: 2, stored: 1, entries: 1, bytes: undefined })
  assert.ok(m.cache.bytes > 0)
  assert.equal(createMetrics().snapshot().cache, null, 'no result cache: null, never 0')
  assert.equal(m.queue_depth, 7)
  assert.deepEqual(m.workers, { live: 2, starts: 2, recycles: 0, kills: 1, ooms: 0, crashes: 0 })
  assert.ok(m.heap.used_bytes > 0 && m.heap.rss_bytes > 0)
  assert.deepEqual(m.canary, { ok: true, runs: 3, reds: 0, intervalMs: 900000, last: { verdict: 'green' } })
  assert.deepEqual(m.engine, DOOR.identity)
  assert.equal(m.boot.workers, 2)
})

test('/v1/metrics refuses without a valid signature: unsigned, wrong key, stale clock, body-bound, replay (401, nothing served)', async () => {
  const { port } = await boot()
  const bad = (r) => { assert.equal(r.status, 401); assert.equal(r.json.error.guard, 'runtime:server-auth'); assert.ok(!('jobs' in r.json)) }
  bad(await call(port))
  bad(await call(port, { headers: sig(Buffer.alloc(0), { secret: 'x'.repeat(40) }) }))
  bad(await call(port, { headers: sig(Buffer.alloc(0), { t: T - 3600 }) }))
  bad(await call(port, { headers: sig(Buffer.from('not empty')) }))
  const ok = await call(port, { headers: sig() })
  assert.equal(ok.status, 200)
  bad(await call(port, { headers: sig() }))
})

test('/v1/metrics is GET only, and holds no source, owner or document text', async () => {
  const { port } = await boot()
  assert.equal((await call(port, { method: 'POST', headers: sig() })).status, 405)
  const body = runBody(2)
  await call(port, { method: 'POST', path: '/v1/run', body, headers: sig(body) })
  const r = await call(port, { headers: sig(Buffer.alloc(0), { t: T + 1 }) })
  assert.equal(r.status, 200)
  for (const needle of ['hmac:', 'compute', 'plot(close)', 'SYM0', 'u_0123456789ab']) assert.ok(!r.text.includes(needle), needle)
})

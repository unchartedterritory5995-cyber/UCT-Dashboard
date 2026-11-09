// W5-T7 rails on the REAL server bundle, through the supervisor (server.mjs) and the pool:
//   - the hostile corpus (design section 4): every case ends in a NAMED stop and the supervisor
//     stays healthy; the two cases too large for the door are refused there, and named by the pool;
//   - L6 cross-tenant: job A then job B on ONE worker answers B exactly as a cold run of B;
//   - L7 load: 50 maximal-cost jobs at sweep priority, and one alert still completes inside its
//     deadline, ahead of the sweep, with /health answering throughout.
// Pools are 1-2 workers and are closed here.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer, request as httpRequest } from 'node:http'
import { SIGNATURE_HEADER, signHeader } from '../auth.mjs'
import { POOL_DEFAULTS, createPool } from '../pool.mjs'
import { SERVICE_POOL_OPTIONS, createPineRuntimeServer, loadBundle, main } from '../server.mjs'
import { SECRET } from './helpers.mjs'
import { FAKE_BUNDLE, buildRealBundle, decodeColumn, docOf, parsedJob, parsedRequest, wireRequest } from './poolFixtures.mjs'

const H = (body, decl = 'indicator("t7")') => `//@version=5\n${decl}\n${body}`

/** The design's hostile corpus. `stop` is the guard measured on this engine; `says` names the limit IN
 *  PLAIN WORDS (`limits.js::LIMIT_PLAIN`) and `limit` is its engine name, never in the sentence (LIMITS r1;
 *  the service emits it as a field only in phase 2, `job.mjs::EMIT_REFUSAL_LIMIT`). */
const TOKEN = /[A-Z][A-Z0-9]*_[A-Z0-9_]+/
const CORPUS = [
  { name: 'infinite while', source: H('x = 0\nwhile true\n    x += 1\nplot(x)'), stop: 'runtime:limit', limit: 'WHILE_ITERATIONS', says: /the number of passes one `while` loop may make/ },
  { name: 'for up to 1e12', source: H('x = 0.0\nfor i = 0 to 1e12\n    x += 1\nplot(x)'), stop: 'runtime:limit', limit: 'INSTRUCTIONS_PER_BAR', says: /the number of steps a script may take on one bar/ },
  { name: 'string doubling', source: H('s = "ab"\nfor i = 0 to 60\n    s := s + s\nplot(str.length(s))'), stop: 'runtime:limit', limit: 'MEMORY', says: /the memory a script may use/ },
  { name: 'array growth', source: H('var a = array.new_float()\nfor i = 0 to 999\n    array.push(a, i)\nplot(array.size(a))'), stop: 'runtime:limit', limit: 'ARRAY_ELEMENTS', says: /the number of elements a script's arrays may hold/ },
  // the design expects "refused at build"; this engine stops it as runtime:statement (see EVIDENCE)
  { name: 'deep UDF recursion', source: H('f(n) => n <= 0 ? 0 : f(n - 1) + 1\nplot(f(100))'), stop: 'runtime:statement', says: /./ },
  { name: 'request.security', source: H('x = request.security("NASDAQ:MSFT", "D", close)\nplot(x)'), stop: 'runtime:request', says: /another symbol or timeframe/ },
  { name: 'varip on a sliding window', source: H('varip int k = 0\nk += 1\nplot(k)', 'indicator("t7", calc_bars_count=50)'), stop: 'runtime:varip', says: /varip/ },
]
/** Too large for the door (doc > 128 KiB): refused there with zero jobs, and named by the pool itself. */
const OVERSIZED = [
  { name: '512 KiB + 1 source', source: H(`plot(close)\n//${'x'.repeat(512 * 1024)}`), stop: 'runtime:limit', limit: 'PROGRAM_SIZE', says: /byte limit a script drawn bar by bar is read under/ },
  // the design expects an IR limit; this engine stops it as runtime:statement (see EVIDENCE)
  { name: '200k-node expression', source: H(`plot(${Array(200000).fill('1').join('+')})`), stop: 'runtime:statement', says: /./ },
]
const HEAVY = H('x = 0.0\nfor i = 0 to 5000\n    x += i\nplot(x)') // ~166k instructions a bar: under the cap, maximal cost

let real
let door
before(async () => {
  real = await buildRealBundle()
  door = await loadBundle(real.outfile)
})
after(() => real.cleanup())

async function serve(pool) {
  const server = createPineRuntimeServer({ secrets: [SECRET], door, runner: pool.run, canary: () => pool.ready(), log: () => {} })
  await new Promise((d) => server.listen(0, '127.0.0.1', d))
  return { server, port: server.address().port, close: () => new Promise((d) => server.close(d)) }
}
function post(port, payload) {
  const body = Buffer.from(JSON.stringify(payload))
  return new Promise((done, fail) => {
    const r = httpRequest({ host: '127.0.0.1', port, method: 'POST', path: '/v1/run',
      headers: { 'content-length': body.length, [SIGNATURE_HEADER]: signHeader(SECRET, Math.floor(Date.now() / 1000), body) } }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => done({ status: res.statusCode, json: JSON.parse(Buffer.concat(chunks).toString('utf8')) }))
    })
    r.on('error', fail)
    r.end(body)
  })
}
function health(port) {
  const t0 = Date.now()
  return new Promise((done, fail) => {
    httpRequest({ host: '127.0.0.1', port, path: '/health' }, (res) => { res.resume(); res.on('end', () => done({ status: res.statusCode, ms: Date.now() - t0 })) })
      .on('error', fail).end()
  })
}

test('hostile corpus: every case ends in a named stop, by the VM and never by the hard kill, and the supervisor stays healthy', async () => {
  const pool = await createPool({ bundle: real.outfile, workers: 2 })
  const http = await serve(pool)
  try {
    for (const c of CORPUS) {
      const { status, json } = await post(http.port, wireRequest(door.identity, { doc: docOf(c.source), jobs: [{ name: c.name }] }))
      assert.equal(status, 200, c.name)
      const [r] = json.results
      assert.equal(r.status, 'withheld', c.name)
      assert.equal(r.columns, undefined, `${c.name}: a stop carries no columns`)
      assert.equal(r.refusals[0].key, '*', c.name)
      assert.equal(r.refusals[0].guard, c.stop, `${c.name}: ${JSON.stringify(r.refusals)}`)
      assert.match(r.refusals[0].sentence, c.says, c.name)
      assert.doesNotMatch(r.refusals[0].sentence, TOKEN, `${c.name}: no engine token reaches the sentence`)
      assert.ok(!('limit' in r.refusals[0]), `${c.name}: phase 1 emits no limit field (job.mjs EMIT_REFUSAL_LIMIT)`)
    }
    for (const c of OVERSIZED) {
      const { status, json } = await post(http.port, wireRequest(door.identity, { doc: docOf(c.source), jobs: [{ name: c.name }] }))
      assert.equal(status, 400, `${c.name}: the door refuses the document`)
      assert.match(json.error.sentence, /definition\.doc: is larger than/)
      const [r] = await pool.run(parsedRequest({ doc: docOf(c.source), jobs: [parsedJob(c.name, { n: 300 })] }))
      assert.equal(r.refusals[0].guard, c.stop, `${c.name}: ${JSON.stringify(r.refusals)}`)
      assert.match(r.refusals[0].sentence, c.says, c.name)
      assert.doesNotMatch(r.refusals[0].sentence, TOKEN, c.name)
    }
    assert.equal(pool.stats().kills, 0, 'no case needed the hard kill')
    assert.equal(pool.stats().crashes + pool.stats().ooms, 0)
    assert.equal((await health(http.port)).status, 200)
    const { json } = await post(http.port, wireRequest(door.identity, { doc: docOf(H('plot(ta.sma(close, 3))')), jobs: [{ name: 'after' }] }))
    assert.equal(json.results[0].status, 'ok')
  } finally {
    await http.close()
    await pool.close()
  }
})

const outputsOf = (r) => Object.fromEntries(Object.entries(r.columns).map(([k, v]) => [k, decodeColumn(v)]))

test('L6 cross-tenant: job A then job B on one worker answers B exactly as a cold run of B', async () => {
  const A = { doc: docOf(H('plot(ta.ema(close, 9))')), job: parsedJob('A', { n: 300, seed: 0 }) }
  const B = { doc: docOf(H('plot(ta.rsi(close, 14))')), job: parsedJob('B', { n: 300, seed: 1 }) }
  const Bx = { doc: A.doc, job: parsedJob('A+1', { n: 301, seed: 0 }) } // A's document over A's bars plus one
  const shared = await createPool({ bundle: real.outfile, workers: 1, recycleJobs: 1000 })
  let afterA
  let afterAx
  try {
    const [worker] = shared.threadIds()
    await shared.run(parsedRequest({ doc: A.doc, jobs: [A.job] }))
    ;[afterA] = await shared.run(parsedRequest({ doc: B.doc, jobs: [B.job] }))
    ;[afterAx] = await shared.run(parsedRequest({ doc: Bx.doc, jobs: [Bx.job] }))
    assert.deepEqual(shared.threadIds(), [worker], 'all three ran on the same worker')
  } finally {
    await shared.close()
  }
  for (const [label, x, got] of [['B after A', B, afterA], ['A+1 after A', Bx, afterAx]]) {
    const fresh = await createPool({ bundle: real.outfile, workers: 1 })
    try {
      const [cold] = await fresh.run(parsedRequest({ doc: x.doc, jobs: [x.job] }))
      assert.equal(got.status, 'ok', `${label}: ${JSON.stringify(got.refusals)}`)
      assert.deepEqual(outputsOf(got), outputsOf(cold), label)
      assert.deepEqual(got.refusals, cold.refusals, label)
    } finally {
      await fresh.close()
    }
  }
})

test('L6 cross-tenant: what one job leaves in the bundle\'s session state is reset before the next', async () => {
  const pool = await createPool({ bundle: FAKE_BUNDLE, workers: 1, recycleJobs: 1000 })
  try {
    for (let i = 0; i < 3; i += 1) {
      const [r] = await pool.run(parsedRequest({ source: 'count' }))
      assert.deepEqual([decodeColumn(r.columns.sessions)[0], decodeColumn(r.columns.ledgers)[0]], [1, 1], `job ${i} starts cold`)
    }
    const [resumed] = await pool.run(parsedRequest({ source: 'resumed' }))
    assert.equal(resumed.status, 'withheld')
    assert.equal(resumed.refusals[0].guard, 'runtime:server-integrity')
  } finally {
    await pool.close()
  }
})

test('L7 load: 50 maximal-cost sweep jobs, and one alert completes inside its deadline, ahead of the sweep', async () => {
  const pool = await createPool({ bundle: real.outfile, workers: 2 })
  const http = await serve(pool)
  try {
    let sweepDoneAt = null
    const t0 = Date.now()
    const sweep = post(http.port, wireRequest(door.identity, {
      profile: 'sweep', owner: 'hmac:5eeb5eeb5eeb5eeb', doc: docOf(HEAVY),
      jobs: Array.from({ length: 50 }, (_, i) => ({ name: `S${i}`, seed: i })),
    })).then((r) => { sweepDoneAt = Date.now(); return r })
    await new Promise((d) => setTimeout(d, 300))
    const h = await health(http.port)
    assert.equal(h.status, 200)
    assert.ok(h.ms < 1000, `/health answered in ${h.ms} ms under load`)
    const a0 = Date.now()
    const alert = await post(http.port, wireRequest(door.identity, { profile: 'alert', owner: 'hmac:a1e7a1e7a1e7a1e7',
      doc: docOf(H('plot(ta.sma(close, 3))')), jobs: [{ name: 'ALERT' }] }))
    const alertMs = Date.now() - a0
    assert.equal(alert.status, 200)
    assert.equal(alert.json.results[0].status, 'ok')
    assert.ok(alertMs < POOL_DEFAULTS.deadlinesMs.alert, `the alert took ${alertMs} ms`)
    assert.equal(sweepDoneAt, null, 'the alert finished while the sweep was still running')
    const s = await sweep
    assert.equal(s.status, 200)
    assert.equal(s.json.results.length, 50)
    for (const r of s.json.results) assert.ok(r.status === 'ok' || typeof r.refusals[0].guard === 'string', r.job)
    assert.ok(sweepDoneAt - t0 > alertMs, 'the sweep took longer than the alert waited')
  } finally {
    await http.close()
    await pool.close()
  }
})

const freePort = () => new Promise((done) => {
  const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => done(port)) })
})
function getStatus(port, path) {
  return new Promise((done, fail) => {
    httpRequest({ host: '127.0.0.1', port, path }, (res) => { res.resume(); res.on('end', () => done(res.statusCode)) }).on('error', fail).end()
  })
}

test('wiring: a request the queue cannot hold is 429 runtime:server-busy, and none of its jobs is queued', async () => {
  const pool = await createPool({ bundle: real.outfile, workers: 1, queueDepth: 1 })
  const http = await serve(pool)
  try {
    const busy = pool.run(parsedRequest({ doc: docOf(HEAVY), jobs: [parsedJob('hold', { n: 300 })] }))
    const { status, json } = await post(http.port, wireRequest(door.identity, { doc: docOf(H('plot(close)')), jobs: [{ name: 'X0' }, { name: 'X1' }] }))
    assert.equal(status, 429)
    assert.equal(json.error.guard, 'runtime:server-busy')
    assert.equal(pool.stats().queued, 0)
    await busy
  } finally {
    await http.close()
    await pool.close()
  }
})

test('wiring: the service boot runs the pool with the L4 self-test, which refuses this unflagged process', async () => {
  assert.deepEqual(SERVICE_POOL_OPTIONS, { requireL4: true })
  const text = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8')
  assert.match(text, /if \(isMain\) \{[^}]*main\(\{ pool: SERVICE_POOL_OPTIONS \}\)/)
  const port = await freePort()
  await assert.rejects(main({ env: { PINE_RUNTIME_SERVICE_SECRET: SECRET, PORT: String(port) }, bundle: real.outfile,
    pool: { ...SERVICE_POOL_OPTIONS, workers: 1 }, log: () => {} }), /L4 self-test found fsWrite, spawn, codegen allowed/)
})

test('wiring: main({ pool }) runs the pool on its own bundle and closing the server stops it', async () => {
  const port = await freePort()
  const logs = []
  const server = await main({ env: { PINE_RUNTIME_SERVICE_SECRET: SECRET, PORT: String(port) }, bundle: real.outfile,
    pool: { workers: 1 }, log: (l) => logs.push(l) })
  let closed = false
  try {
    assert.match(logs[0], / workers=1 port=/)
    assert.equal(await getStatus(port, '/ready'), 200)
    const { status, json } = await post(port, wireRequest(door.identity, { doc: docOf(H('plot(ta.sma(close, 3))')), jobs: [{ name: 'M' }] }))
    assert.equal(status, 200)
    assert.equal(json.results[0].status, 'ok')
    await new Promise((d) => server.close(d))
    closed = true
    for (let i = 0; i < 100 && !logs.includes('[pine-runtime] pool stopped'); i += 1) await new Promise((d) => setTimeout(d, 50))
    assert.ok(logs.includes('[pine-runtime] pool stopped'), JSON.stringify(logs))
  } finally {
    if (!closed) await new Promise((d) => server.close(d))
  }
})

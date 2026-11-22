// W5-T9 rails: the parity canary (canary.mjs) and the readiness it drives (design 3.8).
// The canary runs through the REAL pool on the REAL bundle; the red cases use T4's own
// perturbation of the bundle's VM `+` (tools/pine_runtime_host_parity.mjs perturb()) and
// hand-made runners that lie in one named way each.
import { test, after, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer as netServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { perturb } from '../../../tools/pine_runtime_host_parity.mjs'
import {
  CANARY_CASES, CANARY_INTERVAL_MS, CANARY_PROFILE, DIVERGED_PREFIX, createCanary, loadCanaryInputs, runCanary,
} from '../canary.mjs'
import { BUSY_GUARD, createPool } from '../pool.mjs'
import { PROFILES } from '../protocol.mjs'
import { loadBundle, main } from '../server.mjs'
import { SECRET } from './helpers.mjs'
import { buildRealBundle } from './poolFixtures.mjs'

let real
let bad
let door
let badDoor
let inputs
before(async () => {
  real = await buildRealBundle()
  const dir = mkdtempSync(join(tmpdir(), 'pine-rt-t9-bad-'))
  const file = join(dir, 'pine-runtime.mjs')
  writeFileSync(file, perturb(readFileSync(real.outfile, 'utf8')))
  bad = { dir, outfile: file }
  door = await loadBundle(real.outfile)
  badDoor = await loadBundle(bad.outfile)
  inputs = loadCanaryInputs()
})
after(() => { real.cleanup(); rmSync(bad.dir, { recursive: true, force: true }) })

async function withPool(bundle, fn) {
  const pool = await createPool({ bundle, workers: 2 })
  try { return await fn(pool) } finally { await pool.close() }
}

const freePort = () => new Promise((done) => {
  const s = netServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => done(port)) })
})
const get = async (port, path, headers = {}) => {
  const r = await fetch(`http://127.0.0.1:${port}${path}`, { headers })
  return { status: r.status, json: await r.json().catch(() => null) }
}
const waitFor = async (fn, ms = 20_000) => {
  const end = Date.now() + ms
  while (Date.now() < end) { if (await fn()) return true; await new Promise((d) => setTimeout(d, 50)) }
  return false
}

test('the case list: 10 distinct corpus cases, 8 computed and 2 withheld by name, one digest each', () => {
  assert.equal(CANARY_CASES.length, 10)
  assert.equal(new Set(CANARY_CASES).size, 10)
  assert.equal(CANARY_PROFILE, 'sweep')
  assert.ok(PROFILES.includes(CANARY_PROFILE))
  assert.equal(CANARY_INTERVAL_MS, 15 * 60 * 1000)
  const recs = CANARY_CASES.map((n) => inputs.expected.cases[n])
  assert.equal(recs.filter((r) => r.status === 'ok').length, 8)
  assert.equal(recs.filter((r) => r.status === 'withheld').length, 2)
  assert.equal(new Set(recs.filter((r) => r.status === 'ok').map((r) => r.digest)).size, 8)
  assert.ok(recs.filter((r) => r.status === 'withheld').every((r) => r.guards.length === 1))
  assert.throws(() => loadCanaryInputs({ names: ['no_such_case@listing'] }), /not in the host-parity corpus/)
})

test('GREEN: the real bundle through the real pool equals every committed digest', async () => {
  await withPool(real.outfile, async (pool) => {
    const r = await runCanary({ run: pool.run, inputs, identity: door.identity })
    assert.deepEqual({ verdict: r.verdict, checked: r.checked, diverged: r.diverged, inconclusive: r.inconclusive },
      { verdict: 'green', checked: 10, diverged: [], inconclusive: [] })
  })
})

test('RED: a perturbed bundle (one VM operator through Math.fround) is red by case name, and logs the line', async () => {
  const logs = []
  await withPool(bad.outfile, async (pool) => {
    const canary = createCanary({ run: pool.run, inputs, identity: badDoor.identity, log: (l) => logs.push(l) })
    const r = await canary.runOnce()
    assert.equal(r.verdict, 'red')
    assert.ok(r.diverged.length >= 1)
    assert.ok(r.diverged.every((d) => CANARY_CASES.includes(d.case) && d.field === 'digest'))
    assert.equal(canary.ok(), false)
    assert.equal(canary.status().ok, false)
    assert.equal(canary.status().reds, 1)
    assert.ok(logs.some((l) => l.startsWith(`${DIVERGED_PREFIX} case=`) && CANARY_CASES.some((c) => l.includes(`case=${c} `))))
  })
})

test('a runner that answers a withheld case with another stop, or throws, is red by case', async () => {
  const wrongGuard = async (req) => [{ job: req.jobs[0].job, status: 'withheld', refusals: [{ key: '*', guard: 'runtime:limit', bar: null }] }]
  const r1 = await runCanary({ run: wrongGuard, inputs, identity: door.identity })
  assert.equal(r1.verdict, 'red')
  const ok2 = CANARY_CASES.filter((n) => inputs.expected.cases[n].status === 'ok')
  assert.ok(ok2.every((n) => r1.diverged.some((d) => d.case === n && d.field === 'status')))
  const throwing = async () => { throw Object.assign(new Error('x'), { guard: BUSY_GUARD }) }
  const r2 = await runCanary({ run: throwing, inputs, identity: door.identity })
  assert.equal(r2.verdict, 'red')
  assert.equal(r2.diverged.length, 10)
})

test('an engine identity that moved without regenerating expected-digests.json is red as engine-identity', async () => {
  const moved = { ...door.identity, script_engine: Number(door.identity.script_engine) + 1 }
  const echo = async (req) => [{ job: req.jobs[0].job, status: 'ok', columns: {}, refusals: [] }]
  const r = await runCanary({ run: echo, inputs, identity: moved })
  assert.equal(r.verdict, 'red')
  assert.equal(r.diverged[0].case, 'engine-identity')
  assert.equal(r.diverged[0].field, 'script_engine')
})

test('inconclusive (a busy pool, the wall clock) is never a verdict: it cannot turn the canary red or green', async () => {
  const busy = async (req) => [{ job: req.jobs[0].job, status: 'withheld', refusals: [{ key: '*', guard: BUSY_GUARD, bar: null }] }]
  const r = await runCanary({ run: busy, inputs, identity: door.identity })
  assert.equal(r.verdict, 'inconclusive')
  assert.equal(r.inconclusive.length, 10)
  const canary = createCanary({ run: busy, inputs, identity: door.identity, log: () => {} })
  await canary.runOnce()
  assert.equal(canary.ok(), false, 'never green: not ready')
  assert.equal(canary.status().ok, null)
  // green, then an inconclusive run leaves it green; a red run clears it; a green run restores it
  await withPool(real.outfile, async (pool) => {
    let mode = 'real'
    const run = (req) => (mode === 'busy' ? busy(req) : pool.run(req))
    const c = createCanary({ run, inputs, identity: door.identity, log: () => {} })
    await c.runOnce()
    assert.equal(c.ok(), true)
    mode = 'busy'
    await c.runOnce()
    assert.equal(c.ok(), true)
    assert.equal(c.status().last.verdict, 'inconclusive')
    mode = 'real'
    await c.runOnce()
    assert.equal(c.status().last.verdict, 'green')
  })
})

test('the timer: every 15 minutes, unref-ed, never overlapping, stoppable', async () => {
  const calls = []
  let fn
  const handle = { unref() { calls.push('unref') } }
  const run = async (req) => { calls.push(`run:${req.profile}`); return [{ job: req.jobs[0].job, status: 'withheld', refusals: [{ key: '*', guard: BUSY_GUARD }] }] }
  const c = createCanary({ run, inputs, identity: door.identity, log: () => {},
    setTimer: (f, ms) => { fn = f; calls.push(`every:${ms}`); return handle }, clearTimer: (h) => calls.push(h === handle ? 'cleared' : 'wrong') })
  c.start()
  c.start()
  assert.deepEqual(calls, ['every:900000', 'unref'])
  const a = c.runOnce()
  const b = c.runOnce()
  assert.equal(a, b, 'a run in progress is joined, not doubled')
  await a
  assert.equal(calls.filter((x) => x.startsWith('run:')).length, 10)
  assert.ok(calls.filter((x) => x.startsWith('run:')).every((x) => x === 'run:sweep'))
  fn()
  await c.stop()
  assert.equal(calls.includes('cleared'), true)
  assert.equal(calls.filter((x) => x === 'cleared').length, 1)
})

test('service: /ready is 503 until the canary is green, then 200, and /v1/metrics reports the canary', async () => {
  const port = await freePort()
  const logs = []
  const server = await main({ env: { PINE_RUNTIME_SERVICE_SECRET: SECRET, PORT: String(port) }, bundle: real.outfile,
    pool: { workers: 2 }, canary: true, log: (l) => logs.push(l) })
  try {
    assert.equal(await waitFor(async () => (await get(port, '/ready')).status === 200), true)
    assert.equal((await get(port, '/health')).status, 200)
    assert.ok(logs.some((l) => /^\[pine-runtime\] boot engine=\d+\/\d+\/\d+ bundle=[0-9a-f]{12} node=v/.test(l)))
    assert.ok(!logs.some((l) => l.includes('CANARY DIVERGED')))
  } finally { await new Promise((d) => server.close(d)); await waitFor(() => logs.some((l) => l.includes('pool stopped')), 10_000) }
})

test('service on a perturbed bundle: /ready stays 503 for good, /health stays 200, CANARY DIVERGED is logged', async () => {
  const port = await freePort()
  const logs = []
  const server = await main({ env: { PINE_RUNTIME_SERVICE_SECRET: SECRET, PORT: String(port) }, bundle: bad.outfile,
    pool: { workers: 2 }, canary: true, log: (l) => logs.push(l) })
  try {
    assert.equal(await waitFor(() => logs.some((l) => l.startsWith(DIVERGED_PREFIX))), true)
    assert.equal((await get(port, '/ready')).status, 503)
    assert.equal((await get(port, '/health')).status, 200)
  } finally { await new Promise((d) => server.close(d)); await waitFor(() => logs.some((l) => l.includes('pool stopped')), 10_000) }
})

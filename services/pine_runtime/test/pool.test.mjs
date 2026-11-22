// W5-T7 rail: the job pool (pool.mjs) on the stand-in bundle (fixtures/fakeBundle.mjs): priority,
// owner caps, queue depth, deadlines, the hard kill, the heap cap, crashes and recycling. Every
// pool is 1-3 workers and is closed by its test.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BUSY_GUARD, BusyError, OOM_GUARD, POOL_DEFAULTS, PRIORITY, WORKER_FAILED_GUARD, createPool } from '../pool.mjs'
import { PROFILES } from '../protocol.mjs'
import { FAKE_BUNDLE, decodeColumn, maxOverlap, parsedRequest, spanOf } from './poolFixtures.mjs'

async function withPool(opts, fn) {
  const pool = await createPool({ bundle: FAKE_BUNDLE, workers: 1, ...opts })
  try { return await fn(pool) } finally { await pool.close() }
}
const runOne = (pool, o) => pool.run(parsedRequest(o)).then((r) => r[0])
const delay = (ms) => new Promise((d) => setTimeout(d, ms))

test('the design numbers: limits, kill, recycle, depth, caps, deadlines; PRIORITY names each profile once', () => {
  assert.deepEqual(POOL_DEFAULTS.resourceLimits, { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 })
  assert.equal(POOL_DEFAULTS.killMs, 10_000)
  assert.equal(POOL_DEFAULTS.recycleJobs, 500)
  assert.equal(POOL_DEFAULTS.recycleMs, 30 * 60_000)
  assert.equal(POOL_DEFAULTS.queueDepth, 2000)
  assert.deepEqual(POOL_DEFAULTS.ownerCaps, { 'on-demand': 4 })
  assert.deepEqual(POOL_DEFAULTS.deadlinesMs, { alert: 15_000, 'on-demand': 60_000, backtest: 60_000, record: 60_000, sweep: 120_000 })
  assert.deepEqual(PRIORITY, ['alert', 'on-demand', 'backtest', 'record', 'sweep'])
  assert.deepEqual([...PRIORITY].sort(), [...PROFILES].sort())
  assert.deepEqual(Object.keys(POOL_DEFAULTS.deadlinesMs).sort(), [...PROFILES].sort())
})

test('every worker runs under the resourceLimits, and a job is answered once, in order', async () => {
  const limits = { maxOldGenerationSizeMb: 48, maxYoungGenerationSizeMb: 8, stackSizeMb: 2 }
  await withPool({ workers: 2, resourceLimits: limits }, async (pool) => {
    for (const l of pool.limits()) {
      assert.equal(l.maxOldGenerationSizeMb, 48)
      assert.equal(l.maxYoungGenerationSizeMb, 8)
      assert.equal(l.stackSizeMb, 2)
    }
    const r = await pool.run(parsedRequest({ jobs: ['A', 'B', 'C'] }))
    assert.deepEqual(r.map((x) => [x.job, x.status]), [['A', 'ok'], ['B', 'ok'], ['C', 'ok']])
    assert.deepEqual(decodeColumn(r[0].columns.opts), [2, 2, 2], 'the adapter passed two opts')
  })
  await withPool({}, async (pool) => {
    for (const l of pool.limits()) assert.equal(l.maxOldGenerationSizeMb, POOL_DEFAULTS.resourceLimits.maxOldGenerationSizeMb)
  })
})

test('priority: alert > on-demand > backtest > record > sweep, FIFO inside a profile', async () => {
  await withPool({}, async (pool) => {
    const busy = runOne(pool, { source: 'sleep:300' })
    await delay(50)
    const order = []
    const queued = ['sweep', 'record', 'backtest', 'on-demand', 'alert', 'alert'].map((profile, i) =>
      runOne(pool, { profile, owner: `hmac:${String(i).padStart(16, '0')}` }).then((r) => order.push(`${profile}:${i}`)))
    await Promise.all([busy, ...queued])
    assert.deepEqual(order, ['alert:4', 'alert:5', 'on-demand:3', 'backtest:2', 'record:1', 'sweep:0'])
  })
})

test('owner cap: one owner holds at most its cap in flight, and another owner passes its waiting jobs', async () => {
  await withPool({ workers: 3, ownerCaps: { 'on-demand': 2 } }, async (pool) => {
    const a = pool.run(parsedRequest({ profile: 'on-demand', owner: 'hmac:aaaaaaaaaaaaaaaa', source: 'sleep:250', jobs: ['A0', 'A1', 'A2', 'A3'] }))
    await delay(60)
    const b = pool.run(parsedRequest({ profile: 'on-demand', owner: 'hmac:bbbbbbbbbbbbbbbb', source: 'sleep:250', jobs: ['B0'] }))
    const [ra, [rb]] = await Promise.all([a, b])
    const spans = ra.map(spanOf)
    assert.equal(maxOverlap(spans), 2, 'owner A never has more than 2 in flight')
    const aThird = spans.map((s) => s[0]).sort((x, y) => x - y)[2]
    assert.ok(spanOf(rb)[0] < aThird, 'owner B started before owner A\'s third job')
  })
  await withPool({ workers: 3, ownerCaps: { 'on-demand': 1 } }, async (pool) => {
    const r = await pool.run(parsedRequest({ profile: 'alert', owner: 'hmac:aaaaaaaaaaaaaaaa', source: 'sleep:250', jobs: ['A0', 'A1', 'A2'] }))
    assert.equal(maxOverlap(r.map(spanOf)), 3, 'a profile with no cap runs one owner on every worker')
  })
})

test('queue depth: a request that does not fit is refused whole (429 runtime:server-busy) and queues nothing', async () => {
  await withPool({ queueDepth: 2 }, async (pool) => {
    const busy = runOne(pool, { source: 'sleep:300' })
    await delay(50)
    await assert.rejects(pool.run(parsedRequest({ jobs: ['A', 'B', 'C'] })), (e) => e instanceof BusyError && e.guard === BUSY_GUARD && e.status === 429)
    assert.equal(pool.stats().queued, 0)
    const fits = await pool.run(parsedRequest({ jobs: ['A', 'B'] }))
    assert.deepEqual(fits.map((x) => x.status), ['ok', 'ok'])
    await busy
  })
})

test('deadline: a job still queued past its profile deadline is withheld runtime:server-busy, before the queue moves', async () => {
  await withPool({ deadlinesMs: { ...POOL_DEFAULTS.deadlinesMs, sweep: 100 } }, async (pool) => {
    const busy = runOne(pool, { source: 'sleep:500' })
    await delay(50)
    const late = await runOne(pool, { profile: 'sweep' })
    const answeredAt = Date.now()
    assert.equal(late.status, 'withheld')
    assert.equal(late.refusals[0].guard, BUSY_GUARD)
    const [, end] = spanOf(await busy)
    assert.ok(answeredAt < end, 'answered at its deadline, not when a worker freed')
  })
  await withPool({ deadlinesMs: { ...POOL_DEFAULTS.deadlinesMs, alert: 100 } }, async (pool) => {
    const r = await runOne(pool, { source: 'sleep:300' })
    assert.equal(r.status, 'ok', 'a job dispatched before its deadline is answered by its run, even when the run outlasts it')
  })
})

test('hard kill: a job past killMs is withheld runtime:time-budget and its worker is never reused', async () => {
  await withPool({ killMs: 300 }, async (pool) => {
    const [before] = pool.threadIds()
    const r = await runOne(pool, { source: 'hang' })
    assert.equal(r.status, 'withheld')
    assert.equal(r.refusals[0].guard, 'runtime:time-budget')
    assert.equal(pool.stats().kills, 1)
    const after = await runOne(pool, { source: 'echo' })
    assert.equal(after.status, 'ok')
    assert.ok(!pool.threadIds().includes(before), 'the killed worker is gone')
    assert.equal(pool.threadIds().length, 1, 'and replaced')
  })
})

test('heap cap: a job that exhausts its heap is withheld runtime:server-worker-oom; the pool serves on', async () => {
  await withPool({ resourceLimits: { maxOldGenerationSizeMb: 16, maxYoungGenerationSizeMb: 4, stackSizeMb: 4 } }, async (pool) => {
    const r = await runOne(pool, { source: 'oom' })
    assert.equal(r.status, 'withheld')
    assert.equal(r.refusals[0].guard, OOM_GUARD)
    assert.equal(pool.stats().ooms, 1)
    assert.equal((await runOne(pool, { source: 'echo' })).status, 'ok')
  })
})

test('crash: a worker that exits mid-job is withheld runtime:server-worker-failed; the pool serves on', async () => {
  await withPool({}, async (pool) => {
    const [before] = pool.threadIds()
    const r = await runOne(pool, { source: 'exit' })
    assert.equal(r.status, 'withheld')
    assert.equal(r.refusals[0].guard, WORKER_FAILED_GUARD)
    assert.equal(pool.stats().crashes, 1)
    assert.equal((await runOne(pool, { source: 'echo' })).status, 'ok')
    assert.ok(!pool.threadIds().includes(before))
  })
})

test('recycle: a worker retires after recycleJobs jobs, or once it is recycleMs old', async () => {
  await withPool({ recycleJobs: 2 }, async (pool) => {
    const [first] = pool.threadIds()
    await runOne(pool, {})
    assert.deepEqual(pool.threadIds(), [first])
    await runOne(pool, {})
    assert.equal(pool.stats().recycles, 1)
    assert.equal((await runOne(pool, {})).status, 'ok', 'a fresh worker took the retired one\'s place')
    assert.ok(!pool.threadIds().includes(first))
    assert.equal(pool.threadIds().length, 1)
  })
  let clock = 0
  await withPool({ recycleMs: 1000, now: () => clock }, async (pool) => {
    const [first] = pool.threadIds()
    await runOne(pool, {})
    assert.equal(pool.stats().recycles, 0)
    clock = 1000
    await runOne(pool, {})
    assert.equal(pool.stats().recycles, 1)
    await runOne(pool, {})
    assert.ok(!pool.threadIds().includes(first))
  })
})

test('close: queued jobs are answered as stops, every worker exits', async () => {
  const pool = await createPool({ bundle: FAKE_BUNDLE, workers: 1 })
  const busy = runOne(pool, { source: 'sleep:300' })
  await delay(50)
  const waiting = runOne(pool, {})
  await pool.close()
  assert.equal((await waiting).refusals[0].guard, WORKER_FAILED_GUARD)
  assert.equal((await busy).status, 'withheld')
  assert.deepEqual(pool.threadIds(), [])
  assert.equal(pool.ready(), false)
  await assert.rejects(pool.run(parsedRequest({})))
})

test('boot: a bundle that cannot serve refuses the pool, and leaves no worker running', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pine-rt-t7-boot-'))
  try {
    const bad = join(dir, 'bad.mjs')
    writeFileSync(bad, "export const RUNTIME_TIME_BUDGET_GUARD = 'runtime:time-budget'\n")
    await assert.rejects(createPool({ bundle: bad, workers: 2 }), /exports no computeRuntimeColumns/)
    const copy = join(dir, 'fake.mjs')
    copyFileSync(FAKE_BUNDLE, copy)
    const pool = await createPool({ bundle: copy, workers: 1 })
    assert.equal(pool.ready(), true)
    await pool.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ─── W5-INT ──────────────────────────────────────────────────────────────────────

test('boot: a bundle with no explicit wall budget refuses the pool (a wall-clock stop could be named runtime:limit)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pine-rt-int-budget-'))
  try {
    const nobudget = join(dir, 'nobudget.mjs')
    writeFileSync(nobudget, readFileSync(FAKE_BUNDLE, 'utf8').replace('export const RUNTIME_PANE_TIME_BUDGET_MS = 1000', 'export const RUNTIME_PANE_TIME_BUDGET_MS = null'))
    assert.ok(readFileSync(nobudget, 'utf8').includes('RUNTIME_PANE_TIME_BUDGET_MS = null'), 'fixture edit applied')
    await assert.rejects(createPool({ bundle: nobudget, workers: 1 }), /RUNTIME_PANE_TIME_BUDGET_MS/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

/** Wait until `cond()` holds, at most `ms`; returns whether it did (never loops forever). */
async function until(cond, ms = 10_000) {
  const end = Date.now() + ms
  while (Date.now() < end) { if (cond()) return true; await delay(20) }
  return cond()
}

test('respawn: a replacement that fails to boot makes the pool NOT ready, is retried with backoff, and recovers', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pine-rt-int-respawn-'))
  const bundle = join(dir, 'fake.mjs')
  copyFileSync(FAKE_BUNDLE, bundle)
  const good = readFileSync(bundle)
  // two workers: the one that stays healthy must not mask the failing replacement
  const pool = await createPool({ bundle, workers: 2, recycleJobs: 1, respawnBaseMs: 40, respawnMaxMs: 200 })
  try {
    assert.equal(pool.ready(), true)
    writeFileSync(bundle, "export const RUNTIME_TIME_BUDGET_GUARD = 'runtime:time-budget'\n") // the next worker cannot load it
    assert.equal((await runOne(pool, {})).status, 'ok', 'the loaded worker still serves')
    // that job retired the worker (recycleJobs 1); its replacement fails to boot
    assert.ok(await until(() => pool.stats().bootFailures >= 1), 'the replacement boot failure is counted')
    assert.equal(pool.stats().live, 1, 'the other worker is still live')
    assert.equal(pool.ready(), false, 'a pool with a failing replacement is not ready (/ready 503), even with a live worker')
    assert.ok(await until(() => pool.stats().bootFailures >= 3), 'it is retried, more than once')
    assert.equal(pool.ready(), false)
    writeFileSync(bundle, good)
    assert.ok(await until(() => pool.ready()), 'a later retry boots and the pool is ready again')
    assert.equal((await runOne(pool, {})).status, 'ok')
  } finally {
    await pool.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

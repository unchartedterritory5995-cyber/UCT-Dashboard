// e99 server budget (coordinator ruling 2026-11-26) — THE SERVICE HOLDS A RUN TO THE MEMBER'S OWN BUDGET.
// job.mjs passes the browser worker's `budgetScales` (HP-7: test/adapter.test.mjs), so a run here is held to
// runtimePaneBudgetFor(bars), and server.mjs keeps that from holding the shared pool unbounded:
//   SCALE   the bundle's budget rule as the service reads it: 1,000 ms for EVERY n <= 5,000 (exhaustive), the
//           worker's numbers above (8,509 -> 4,509 ms, 32,768 -> the 12,000 ms ceiling);
//   KILL    the pool's hard kill is derived from the bundle's ceiling and sits past every budget a run can get,
//           and the real boot passes it, so a run past its budget stops BY NAME before its worker is terminated;
//   SWEEP   a sweep job above the floor's bars is refused by name; 5,000 bars, or another profile, are not;
//   CAP     one request's scaled time above the floor is capped at 30 s; a job past it is withheld by name and
//           never reaches the pool; a request whose jobs all fit reaches the pool unchanged (the same object).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildPineRuntime } from '../../../app/scripts/build-pine-runtime.mjs'
import { parseRunRequest, SCHEMA_GUARD } from '../protocol.mjs'
import {
  loadBundle, serviceKillMs, withRequestBudget, KILL_MARGIN_MS, REQUEST_EXTRA_BUDGET_MS, REQUEST_BUDGET_GUARD,
} from '../server.mjs'
import { DOOR, barsWire, validRequest } from './helpers.mjs'

let dir
let door
before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'pine-rt-budget-'))
  const outfile = join(dir, 'pine-runtime.mjs')
  await buildPineRuntime({ outfile, logLevel: 'silent', env: {} })
  door = await loadBundle(outfile)
})
after(() => rmSync(dir, { recursive: true, force: true }))

test('SCALE: the service reads the worker\'s budget rule from the bundle; every n <= 5,000 is the 1,000 ms floor', () => {
  const b = door.budget
  assert.equal(b.floorMs, 1000)
  assert.equal(b.floorBars, 5000)
  assert.equal(b.ceilingMs, 12000)
  for (let n = 1; n <= b.floorBars; n += 1) {
    if (b.budgetFor(n) !== b.floorMs) assert.fail(`SCALE: ${n} bars got ${b.budgetFor(n)} ms, not the floor`)
  }
  assert.equal(b.budgetFor(5001), 1001)
  assert.equal(b.budgetFor(8509), 4509, 'SCALE: kernel-channel SPY 1D, the worker\'s 4,509 ms')
  assert.equal(b.budgetFor(32768), 12000, 'SCALE: the longest intraday window gets the ceiling')
  assert.equal(door.sweepMaxBars, b.floorBars)
})

test('KILL: the hard kill sits past every budget a run can get, and the real boot passes it', () => {
  const kill = serviceKillMs(door)
  assert.equal(kill, door.budget.ceilingMs + KILL_MARGIN_MS)
  assert.ok(KILL_MARGIN_MS >= 1000, 'KILL: a margin of at least a second')
  for (const n of [1, 5000, 8509, 17000, door.maxBars]) {
    assert.ok(door.budget.budgetFor(n) < kill, `KILL: ${n} bars' budget ${door.budget.budgetFor(n)} ms is under the kill`)
  }
  // the boot hands the pool the derived kill, BEFORE the caller's options (a test may override, the boot does not)
  const src = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8')
  assert.match(src, /createPool\(\{ workers: workersOf\(env\), killMs: serviceKillMs\(door\), \.\.\.poolOpts, bundle \}\)/,
    'KILL: main() passes killMs: serviceKillMs(door)')
})

const sweepOf = (n, profile = 'sweep') => {
  const req = validRequest({ jobs: 1 })
  req.profile = profile
  req.jobs[0].bars = barsWire(n)
  return Buffer.from(JSON.stringify(req), 'utf8')
}

test('SWEEP: a sweep job above the floor\'s bars is refused by name; at the floor, or another profile, it is not', () => {
  const d = { ...DOOR, sweepMaxBars: 5000 }
  const over = parseRunRequest(sweepOf(5001), d)
  assert.equal(over.ok, false, 'SWEEP: 5,001 bars on a sweep')
  assert.equal(over.guard, SCHEMA_GUARD)
  assert.match(over.sentence, /jobs\[0\]\.bars\.n/)
  assert.match(over.sentence, /a sweep job carries at most 5000 bars/)
  assert.equal(parseRunRequest(sweepOf(5000), d).ok, true, 'SWEEP: 5,000 bars is a sweep job')
  assert.equal(parseRunRequest(sweepOf(5001, 'alert'), d).ok, true, 'SWEEP: an alert job may carry more')
})

const reqOf = (...ns) => ({ profile: 'alert', jobs: ns.map((n, i) => ({ job: `J${i}`, bars: { n } })) })

test('CAP: a request whose jobs all fit reaches the pool unchanged; 50 jobs of 5,000 bars add nothing', async () => {
  const seen = []
  const runner = async (r) => { seen.push(r); return r.jobs.map((j) => ({ job: j.job, status: 'ok' })) }
  const capped = withRequestBudget(runner, door.budget)
  const sweep = reqOf(...Array(50).fill(5000))
  const out = await capped(sweep)
  assert.equal(seen[0], sweep, 'CAP: the very request object, untouched')
  assert.equal(out.length, 50)
  const fits = reqOf(32768, 32768) // 11 s + 11 s above the floor = 22 s
  await capped(fits)
  assert.equal(seen[1], fits)
})

test('CAP: a job past the 30 s above the floor is withheld by name, in its place, and never reaches the pool', async () => {
  const seen = []
  const runner = async (r) => { seen.push(r); return r.jobs.map((j) => ({ job: j.job, status: 'ok' })) }
  const capped = withRequestBudget(runner, door.budget)
  // 11 s + 11 s = 22 s; the third would make 33 s; a 5,000-bar job after it adds nothing and still runs
  const out = await capped(reqOf(32768, 32768, 32768, 5000))
  assert.deepEqual(seen[0].jobs.map((j) => j.job), ['J0', 'J1', 'J3'], 'CAP: the pool is handed the jobs that fit')
  assert.deepEqual(out.map((r) => r.job), ['J0', 'J1', 'J2', 'J3'], 'CAP: every job answered once, in order')
  assert.equal(out[2].status, 'withheld')
  assert.equal(out[2].refusals[0].guard, REQUEST_BUDGET_GUARD)
  assert.equal(out[2].refusals[0].key, '*')
  assert.match(out[2].refusals[0].sentence, /more than 30 s/)
  assert.equal(REQUEST_EXTRA_BUDGET_MS, 30000)
  assert.ok(REQUEST_BUDGET_GUARD.startsWith('runtime:server-'), 'CAP: a server guard, never cached, never a verdict')
})

test('CAP: the server runs every request through the cap (the result lane and the plain path)', () => {
  const src = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8')
  assert.match(src, /resultLane\.answer\(checked\.request, runJobs, seal\) : seal\(await runJobs\(checked\.request\)\)/)
  assert.match(src, /const runJobs = runner && door && door\.budget \? withRequestBudget\(runner, door\.budget\) : runner/)
})

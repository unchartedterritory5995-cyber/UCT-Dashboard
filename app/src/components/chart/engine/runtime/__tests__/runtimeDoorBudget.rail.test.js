// app/src/components/chart/engine/runtime/__tests__/runtimeDoorBudget.rail.test.js
//
// ─── ⛔⛔ THE MEMBER DOORS STILL STOP A RUN AT 1,000 ms, BY NAME ──────────────────
//
// The vendor harness grades parity on a clock that never moves
// (`ourSide.js::PARITY_CLOCK`, through `runtimeColumns.setRuntimeDoorClock`), because a
// wall-clock stop answers "how busy was the box", never "does our value equal
// TradingView's": under load delta-rsi's cold run passed 1,000 ms and graded
// INCONCLUSIVE while its values MATCH. That seam must not cost a member the budget.
// This rail holds the budget where members meet it, on a STUBBED host clock (no
// wall-clock reading decides any assertion here):
//   1. the worker (`runtimeWorker.js`), the door every browser with workers runs;
//   2. the on-this-thread fallback (`runtimeAsync.runHere`), a browser with none;
//   3. the synchronous door (`runtimeColumnsFor`) through the registry, the strip's
//      named refusal included;
//   4. no shipped module installs a door clock (the seam is a grader's, only);
// and each has its control: on a clock that barely moves, the same run draws.
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import * as registry from '../../nativeRegistry'
import {
  runtimeColumnsFor, setRuntimeRunner, setRuntimeDoorClock,
  RUNTIME_PANE_TIME_BUDGET_MS, RUNTIME_TIME_BUDGET_GUARD,
} from '../runtimeColumns'
import { workerRunner, resetRuntimeAsync } from '../runtimeAsync'

const LF = String.fromCharCode(10)
const TINY = ['//@version=5', 'indicator("t")', 'var float s = 0.0', 's := s + close', 'plot(s)', ''].join(LF)
const rtDef = (id) => ({
  id, version: 1,
  compute: { kind: 'runtime', fn: `budget:${id}`, source: TINY, outputs: { value: 0 } },
  meta: { name: 'budget' }, plots: [{ key: 'value' }],
})
const rows = (n) => Array.from({ length: n }, (_, i) => ({ t: 1e9 + i * 86400, o: 1, h: 2, l: 0.5, c: 1 + (i % 7), v: 10 }))
const OVER = new RegExp(`took more than ${RUNTIME_PANE_TIME_BUDGET_MS} ms`)

/** The host clock every door reads by default, stubbed: each read advances `step` ms. */
function stubHostClock(step) {
  let t = 0
  return vi.spyOn(globalThis.performance, 'now').mockImplementation(() => { t += step; return t })
}
// one read past the budget on the run's first check; a VM `WALL_TIME` (5,000 ms) stop
// would need five, so a door that lost its budget is stopped by the VM's limit
// instead (`runtime:limit`) and fails the guard assertion below, by name
const PAST = RUNTIME_PANE_TIME_BUDGET_MS + 1
const CRAWL = 0.0001

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  resetRuntimeAsync()
  setRuntimeRunner(null)
  setRuntimeDoorClock(null)
})

describe('the pane budget is 1,000 ms (the number members are promised)', () => {
  it('RUNTIME_PANE_TIME_BUDGET_MS', () => {
    expect(RUNTIME_PANE_TIME_BUDGET_MS).toBe(1000)
  })
})

describe('⛔ 1 — the worker stops a run past the budget, by name', () => {
  const posted = []
  const SELF = { postMessage: (m) => posted.push(m) }
  async function workerAnswer(def, r) {
    vi.stubGlobal('self', SELF)
    await import('../runtimeWorker.js')
    posted.length = 0
    SELF.onmessage({ data: { id: 1, def, rows: r, ctx: { tf: 'D' } } })
    return structuredClone(posted[0])
  }

  it('past it: ok false, guard runtime:time-budget, the sentence names 1000 ms', async () => {
    stubHostClock(PAST)
    const msg = await workerAnswer(rtDef('u_budget_w1'), rows(40))
    expect(msg.ok).toBe(false)
    expect(msg.error.guard).toBe(RUNTIME_TIME_BUDGET_GUARD)
    expect(msg.error.message).toMatch(OVER)
  })

  it('CONTROL — the same run on a crawling clock draws every bar', async () => {
    stubHostClock(CRAWL)
    const msg = await workerAnswer(rtDef('u_budget_w2'), rows(40))
    expect(msg.ok).toBe(true)
    expect(msg.columns.value.length).toBe(40)
  })
})

describe('⛔ 2 — a browser with no worker runs here, under the same budget', () => {
  const runOnce = (run, def, r) => new Promise((resolve) => run(def, r, { tf: 'D' }, (err, cols) => resolve({ err, cols })))
  const noWorkers = () => workerRunner(() => { throw new Error('no workers in this browser') })

  it('past it: the job is answered with runtime:time-budget and no columns', async () => {
    stubHostClock(PAST)
    const got = await runOnce(noWorkers(), rtDef('u_budget_h1'), rows(40))
    expect(got.cols).toBeNull()
    expect(got.err && got.err.guard).toBe(RUNTIME_TIME_BUDGET_GUARD)
    expect(got.err.message).toMatch(OVER)
  })

  it('CONTROL — on a crawling clock it draws', async () => {
    stubHostClock(CRAWL)
    const got = await runOnce(noWorkers(), rtDef('u_budget_h2'), rows(40))
    expect(got.err).toBeNull()
    expect(got.cols.value.length).toBe(40)
  })
})

describe('⛔ 3 — the synchronous door, through the registry: a named refusal the strip can say', () => {
  it('past it: computeFor carries the stop; runtimeRunStopOf names runtime:time-budget and 1000 ms', () => {
    registry.registerRuntimeLane(runtimeColumnsFor)
    stubHostClock(PAST)
    const def = rtDef('u_budget_s1')
    const cols = registry.computeFor(def, rows(40), undefined, { tf: 'D' })
    expect(cols.value).toBeUndefined()
    const stop = registry.runtimeRunStopOf(def, cols)
    expect(stop && stop.guard).toBe(RUNTIME_TIME_BUDGET_GUARD)
    expect(stop.sentence).toMatch(OVER)
  })

  it('CONTROL — on a crawling clock it draws', () => {
    registry.registerRuntimeLane(runtimeColumnsFor)
    stubHostClock(CRAWL)
    const cols = registry.computeFor(rtDef('u_budget_s2'), rows(40), undefined, { tf: 'D' })
    expect(cols.value.length).toBe(40)
  })

  it('the parity seam is what moves it, and only while installed: a frozen door clock draws past the host clock, null restores the stop', () => {
    registry.registerRuntimeLane(runtimeColumnsFor)
    stubHostClock(PAST)
    setRuntimeDoorClock(() => 0)
    expect(registry.computeFor(rtDef('u_budget_s3'), rows(40), undefined, { tf: 'D' }).value.length).toBe(40)
    setRuntimeDoorClock(null)
    const def = rtDef('u_budget_s4')
    const stop = registry.runtimeRunStopOf(def, registry.computeFor(def, rows(40), undefined, { tf: 'D' }))
    expect(stop && stop.guard).toBe(RUNTIME_TIME_BUDGET_GUARD)
  })
})

describe('⛔ 4 — no shipped module installs a door clock', () => {
  const SRC = path.resolve(process.cwd(), 'src')
  const isTestInfra = (rel) => /(^|\/)__tests__\//.test(rel) || /\.test\.[jt]sx?$/.test(rel)
  function callers() {
    const out = []
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name)
        if (e.isDirectory()) { if (e.name !== 'node_modules') walk(full); continue }
        if (!/\.(m?js|jsx|ts|tsx)$/.test(e.name)) continue
        if (/\bsetRuntimeDoorClock\s*\(/.test(fs.readFileSync(full, 'utf8'))) out.push(path.relative(SRC, full).split(path.sep).join('/'))
      }
    }
    walk(SRC)
    return out.sort()
  }

  it('every caller is test infrastructure, and the declaring module calls nothing but declares it', () => {
    const all = callers()
    // CONTROL — the scan really finds callers: the harness installs it, this rail calls it
    expect(all).toContain('components/chart/engine/__tests__/vendorHarness/ourSide.js')
    expect(all).toContain('components/chart/engine/runtime/__tests__/runtimeDoorBudget.rail.test.js')
    const shipped = all.filter((rel) => !isTestInfra(rel))
    expect(shipped, 'a shipped module installs a door clock: members would lose the wall-clock budget')
      .toEqual(['components/chart/engine/runtime/runtimeColumns.js'])
    const decl = fs.readFileSync(path.join(SRC, 'components/chart/engine/runtime/runtimeColumns.js'), 'utf8')
    expect(decl.match(/\bsetRuntimeDoorClock\s*\(/g).length, 'runtimeColumns.js only declares the seam').toBe(1)
  })
})

// app/src/components/chart/engine/runtime/__tests__/runtimeLanePreload.test.js
//
// ⚡ PRELOAD (perf/pine-runtime-chunk-preload) — the per-bar lane's worker is spawned ahead of the
// first run, and only where the rules allow it:
//   1. `warmRuntimeLane` spawns ONE worker, posts nothing, and the first job reuses it;
//   2. the chart's warm (`runtimeLaneWarm.armRuntimeLaneWarm`) waits for the first paint and idle
//      time, asks the runtime gate AT THE MOMENT, needs a definition on that lane, warms once;
//   3. the member door spawns the worker when it mints a runtime document (runtime pane on), and a
//      member whose pane is off spawns nothing;
//   4. `nativeRegistry.definitionUsesRuntimeLane` is the one predicate for "on that lane".
import { describe, it, expect, vi, afterEach } from 'vitest'
import { warmRuntimeLane, workerRunner, resetRuntimeAsync } from '../runtimeAsync.js'
import { computeRuntimeColumns, setRuntimeRunner } from '../runtimeColumns.js'
import { armRuntimeLaneWarm, __resetRuntimeLaneWarm } from '../../runtimeLaneWarm.js'
import * as registry from '../../nativeRegistry.js'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import { __permitRuntimePaneForTests, __resetRuntimePanePermission } from '../../runtimePaneGate'
import { __allowEveryRuntimeScriptForTests, __resetRuntimeAllowList } from '../../runtimeKill'

const SOURCE = '//@version=5\nindicator("t")\nvar float s = 0.0\ns := s + close\nplot(s)\n'
const DEF = { id: 'x', compute: { fn: 'x', source: SOURCE, outputs: { v: 0 } } }
const bars = () => Array.from({ length: 30 }, (_, i) => ({ t: 1e9 + i * 86400, o: 1, h: 2, l: 0.5, c: 1 + i, v: 10 }))

function fakeWorkerFactory() {
  const made = []
  const factory = () => {
    const w = {
      posted: [],
      postMessage(msg) {
        this.posted.push(msg)
        queueMicrotask(() => this.onmessage({ data: { id: msg.id, ok: true, columns: computeRuntimeColumns(msg.def, msg.rows, msg.ctx) } }))
      },
      terminate() {},
    }
    made.push(w)
    return w
  }
  return { factory, made }
}

afterEach(() => {
  resetRuntimeAsync()
  setRuntimeRunner(null)
  __resetRuntimeLaneWarm()
  __resetRuntimePanePermission()
  __resetRuntimeAllowList()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('1. warmRuntimeLane: the worker before the first run', () => {
  it('spawns exactly one worker and posts nothing; a second warm reuses it', () => {
    const { factory, made } = fakeWorkerFactory()
    expect(warmRuntimeLane({ factory })).toBe(true)
    expect(warmRuntimeLane({ factory })).toBe(true)
    expect(made.length).toBe(1)
    expect(made[0].posted).toEqual([])
  })

  it('the first job after a warm runs on the warm worker (no second spawn)', async () => {
    const { factory, made } = fakeWorkerFactory()
    warmRuntimeLane({ factory })
    const run = workerRunner(factory)
    const got = await new Promise((resolve) => run(DEF, bars(), { tf: 'D' }, (err, cols) => resolve({ err, cols })))
    expect(got.err).toBeNull()
    expect(got.cols.v.length).toBe(30)
    expect(made.length).toBe(1)
    expect(made[0].posted.length).toBe(1)
  })

  it('control: without a Worker and without a factory nothing is spawned (tests, a non-browser host)', () => {
    expect(typeof Worker).toBe('undefined')
    expect(warmRuntimeLane()).toBe(false)
  })
})

describe('2. the chart warm: after the first paint, idle, permitted, on that lane, once', () => {
  const harness = ({ permitted = true, usesLane = true } = {}) => {
    const afterPaint = []
    const idle = []
    const loads = []
    const deps = {
      afterPaint: (fn) => afterPaint.push(fn),
      idle: (fn) => idle.push(fn),
      permitted: () => (typeof permitted === 'function' ? permitted() : permitted),
      usesLane: () => (typeof usesLane === 'function' ? usesLane() : usesLane),
      load: () => { loads.push(1); return Promise.resolve() },
    }
    const flush = () => { for (const f of afterPaint.splice(0)) f(); for (const f of idle.splice(0)) f() }
    return { deps, afterPaint, idle, loads, flush }
  }

  it('nothing is loaded before the first paint, nor before idle time', () => {
    const h = harness()
    expect(armRuntimeLaneWarm(h.deps)).toBe(true)
    expect(h.loads.length).toBe(0)
    for (const f of h.afterPaint.splice(0)) f()
    expect(h.loads.length).toBe(0)
    for (const f of h.idle.splice(0)) f()
    expect(h.loads.length).toBe(1)
  })

  it('⛔ a member whose runtime pane is not permitted fetches NOTHING', () => {
    const h = harness({ permitted: false })
    armRuntimeLaneWarm(h.deps)
    h.flush()
    expect(h.loads.length).toBe(0)
  })

  it('⛔ the gate is asked at the moment of warming, not at arming', () => {
    let on = true
    const h = harness({ permitted: () => on })
    armRuntimeLaneWarm(h.deps)
    on = false
    h.flush()
    expect(h.loads.length).toBe(0)
  })

  it('⛔ a member with no definition on that lane fetches nothing; a later install re-arms and warms', () => {
    let has = false
    const h = harness({ usesLane: () => has })
    armRuntimeLaneWarm(h.deps)
    h.flush()
    expect(h.loads.length).toBe(0)
    has = true
    expect(armRuntimeLaneWarm(h.deps)).toBe(true)
    h.flush()
    expect(h.loads.length).toBe(1)
  })

  it('warms at most once per page, however many charts arm it', () => {
    const h = harness()
    armRuntimeLaneWarm(h.deps)
    armRuntimeLaneWarm(h.deps)
    h.flush()
    armRuntimeLaneWarm(h.deps)
    h.flush()
    expect(h.loads.length).toBe(1)
  })
})

describe('3. the member door spawns the worker when it mints a runtime document', () => {
  // A fake global Worker, so the door's default factory has something to construct.
  const spawned = []
  class FakeWorker {
    constructor(url, opts) { spawned.push({ url: String(url), opts }); this.posted = [] }
    postMessage(m) { this.posted.push(m) }
    terminate() {}
  }
  // A script the host lane refuses and the runtime lane draws (the self-check script the
  // coverage census uses: a `var` accumulator under an `if`).
  const RUNTIME_ONLY = ['//@version=5', "indicator('lane self-check')", 'var float acc = 0.0',
    'if close > open', '    acc := acc + 1', 'plot(acc)'].join(String.fromCharCode(10))

  it('runtime pane on: one worker, at the door, before any run is posted', () => {
    spawned.length = 0
    vi.stubGlobal('Worker', FakeWorker)
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
    __permitRuntimePaneForTests()
    __allowEveryRuntimeScriptForTests()
    const d = memberPaneDefinition({ source: RUNTIME_ONLY, id: 'u_preload', name: 'preload' })
    expect(d.ok, d.reason || '').toBe(true)
    expect(d.lane).toBe('runtime')
    expect(spawned.length).toBe(1)
    expect(spawned[0].url).toMatch(/runtimeWorker/)
  })

  it('⛔ runtime pane off: the same script spawns nothing', () => {
    spawned.length = 0
    vi.stubGlobal('Worker', FakeWorker)
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '')
    memberPaneDefinition({ source: RUNTIME_ONLY, id: 'u_preload_off', name: 'preload' })
    expect(spawned.length).toBe(0)
  })
})

describe('4. one predicate for "on the per-bar lane"', () => {
  it('a runtime document, a run half and a run-read paint are; a plain host document is not', () => {
    expect(registry.definitionUsesRuntimeLane({ compute: { kind: 'runtime' } })).toBe(true)
    expect(registry.definitionUsesRuntimeLane({ compute: { kind: 'ast', runtimeObjects: { source: 'x' } } })).toBe(true)
    expect(registry.definitionUsesRuntimeLane({ compute: { kind: 'ast', runtimeColours: { source: 'x' } } })).toBe(true)
    expect(registry.definitionUsesRuntimeLane({ compute: { kind: 'ast' } })).toBe(false)
    expect(registry.definitionUsesRuntimeLane(null)).toBe(false)
  })
})

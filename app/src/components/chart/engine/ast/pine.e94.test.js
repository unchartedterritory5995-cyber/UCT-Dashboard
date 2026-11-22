// @vitest-environment node
// app/src/components/chart/engine/ast/pine.e94.test.js
//
// ─── ⭐⭐ ENGINE e94 (NUMBER PENDING) — NO ANSWER DEPENDS ON HOW FAST THE MACHINE IS ────────────────────────────────
//
// docs/pine/evidence/2026-11-22-e94-deterministic-budgets/EVIDENCE.md. A served script drew on one run and refused its
// drawing on the next: the translator's window THREW `pine:timeout` from a sampled clock check, a resolve site caught
// the throw as "unknown" (`catch { return null }`), and the object pass dropped the step. These rails hold the fix:
//   1. THE LATCH: a translation whose window trips at ANY clock read of the call answers the WHOLE script by name.
//      The clock is planted at every read of a real translation in turn (a clock that jumps past the window at its
//      K-th read), so the trip lands in the output loop, in the object pass and inside resolutions (the ones a catch
//      swallows); every K answers either the untouched translation (the window never passed) or the whole-script
//      refusal, never anything in between.
//   2. THE STEP BUDGET: every step of one call counts; past the budget the whole script refuses by name; the count
//      is the same on every run (no clock in it).
//   3. THE MEMBER DOOR'S RUNS: inside the door every runtime clock stands still (`withMemberDoorClock`), so a host
//      clock that races (a machine many times slower, as the VM's `WALL_TIME` sees it) leaves the door's answer
//      byte-identical; the control: the same racing clock DOES stop the same probe outside the door.
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine, lastTranslateWindow, PINE_TRANSLATE_CALL_MAX_STEPS, PINE_TRANSLATE_BUDGET_MS } from './pine.js'
import { withMemberDoorClock } from '../runtime/runtimeColumns.js'
import { buildRuntimeIr } from './pineRuntimeFrontend.js'
import { lowerIrProgram } from '../runtime/lowerIr.js'
import { execute } from '../runtime/vm.js'
import { runtimeClockOpts } from './pineRuntimeClock.js'
import { memberPaneDefinition, MEMBER_PANE_DEF_PREFIX } from '../../builder/memberPane/memberPaneDefinition.js'

const REPO = path.resolve(__dirname, '../../../../../..')
const corpus = (n) => fs.readFileSync(path.join(REPO, 'corpus/committed', n), 'utf8')
const DRAWS = corpus('auto-trendline-dojiemoji__c21f83602c.pine')
const TWIN = corpus('twin-range-filter__xF3L2PeXm7.pine')
const CLOUDS = fs.readFileSync(path.join(REPO, 'tests/fixtures/member/uncharted-clouds.pine'), 'utf8')
const canon = (v) => JSON.stringify(v, (k, x) => (typeof x === 'function' ? undefined : x))

afterEach(() => { vi.restoreAllMocks() })

/** A window clock that stands at 0 and jumps past any budget at its K-th read (counting from the window's opening). */
function plantedClock(k) {
  let reads = 0
  return () => { reads += 1; return reads > k ? 1e12 : 0 }
}
/** How many times a translation reads its window clock. */
function clockReads(source, opts) {
  let reads = 0
  translatePine(source, { ...opts, now: () => { reads += 1; return 0 }, budgetMs: 1000 })
  return reads
}
const wholeRefusal = (t) => !t.ok && (t.outputs || []).length === 0 && t.refusal && t.refusal.guard === 'pine:timeout'
  && /gave up after 1000ms/.test(t.refusal.message)

describe('1. ⭐⭐ the latch: a window that trips at ANY clock read answers the whole script by name', () => {
  for (const [name, source, opts] of [
    ['a script that draws (the object pass)', DRAWS, { strict: true, objects: true }],
    ['a script of many outputs (the output loop)', TWIN, { strict: true }],
  ]) {
    it(name, () => {
      const base = translatePine(source, { ...opts, now: () => 0, budgetMs: 1000 })
      expect(base.ok, 'the control: the untouched translation answers').toBe(true)
      const reads = clockReads(source, opts)
      expect(reads, 'the translation reads its clock more than once (a sweep with something to plant in)').toBeGreaterThan(2)
      const baseText = canon(base)
      let refused = 0
      let untouched = 0
      for (let k = 1; k <= reads + 1; k += 1) {
        const t = translatePine(source, { ...opts, now: plantedClock(k), budgetMs: 1000 })
        // a read past `k` that asks the deadline trips the window; one that only stamps a time (a Resolver's own
        // fallback deadline, set at construction) does not, and then nothing later asked: the translation is untouched
        if (canon(t) === baseText) { untouched += 1; continue }
        // ⛔ NEVER IN BETWEEN: not a partial translation, not a per-output cut, not a dropped step
        expect(wholeRefusal(t), `k=${k} of ${reads}: the whole script refuses by name, not ${t.ok ? 'a partial translation' : JSON.stringify(t.refusal)}`).toBe(true)
        refused += 1
      }
      expect(refused, 'the sweep tripped the window at many reads (the planting reached the translation)').toBeGreaterThan(reads / 2)
      expect(untouched, 'a clock that never passed the window: the translation untouched').toBeGreaterThan(0)
    })
  }

  // ⭐⭐ PLANTED INSIDE A RESOLUTION: the clock passes the window ONLY when the Resolver's sampled check asks it (its
  // n-th ask), i.e. inside `resolve`, where resolve sites catch a throw as "unknown" (`catch { return null }`). Every
  // such plant answers the whole script by name, at the token it was resolving.
  for (const [name, source, every] of [
    ['a script of many outputs', TWIN, 1],
    ['a script that draws, with resolutions deep enough to be sampled', corpus('artemis-oscillator-pro__ea1097ca9e.pine'), 5],
  ]) {
    it(`planted at a resolution's sampled clock check: ${name}`, () => {
      const opts = { strict: true, objects: true }
      const fromResolution = () => /checkClock/.test(new Error().stack || '')
      let checks = 0
      translatePine(source, { ...opts, budgetMs: 1000, now: () => { if (fromResolution()) checks += 1; return 0 } })
      expect(checks, 'the translation is deep enough for the sampled check').toBeGreaterThan(10)
      let planted = 0
      for (let n = 1; n <= checks; n += every) {
        let seen = 0
        const t = translatePine(source, { ...opts, budgetMs: 1000,
          now: () => { if (!fromResolution()) return 0; seen += 1; return seen >= n ? 1e12 : 0 } })
        expect(wholeRefusal(t), `the ${n}-th sampled check: the whole script refuses by name, not ${t.ok ? 'a partial translation' : JSON.stringify(t.refusal)}`).toBe(true)
        expect(t.refusal.line, 'at the token it was resolving').not.toBe(null)
        planted += 1
      }
      expect(planted).toBeGreaterThan(5)
    }, 120000)
  }
})

describe('2. the step budget: deterministic, whole-call, by name', () => {
  it('past the call\'s budget the whole script refuses, naming the steps', () => {
    const t = translatePine(TWIN, { strict: true, maxCallSteps: 50, budgetMs: 0 })
    expect(t.ok).toBe(false)
    expect(t.outputs).toEqual([])
    expect(t.refusal.guard).toBe('pine:timeout')
    expect(t.refusal.message).toMatch(/gave up after 50 resolution steps for the whole script/)
  })
  it('the count is the same on every run (no clock in it), and the shipped budget is far above it (the control)', () => {
    const a = translatePine(TWIN, { strict: true, budgetMs: 0 })
    const stepsA = lastTranslateWindow().steps
    const b = translatePine(TWIN, { strict: true, budgetMs: 0 })
    const stepsB = lastTranslateWindow().steps
    expect(a.ok && b.ok).toBe(true)
    expect(stepsA).toBeGreaterThan(50)
    expect(stepsB).toBe(stepsA)
    expect(lastTranslateWindow().trip).toBe(null)
    expect(PINE_TRANSLATE_CALL_MAX_STEPS / stepsA).toBeGreaterThan(100)
  })
})

describe('3. ⭐⭐ the member door\'s runs: the host clock racing changes nothing inside the door', () => {
  /** The host's runtime clock racing: every read 10 s later than the last (any VM `WALL_TIME` passes at once). */
  const race = () => { let t = 0; return vi.spyOn(performance, 'now').mockImplementation(() => { t += 10000; return t }) }
  it('a probe run: completes inside the door on a racing clock; the control: outside, the VM stops it (WALL_TIME)', () => {
    const N = 120
    const rows = Array.from({ length: N }, (_, i) => ({ t: 1600000000 + i * 86400, o: 100 + i, h: 101 + i, l: 99 + i, c: 100 + i, v: 1000 }))
    const src = '//@version=5\nindicator("t")\nvar float s = 0.0\nfor i = 0 to 50\n    s := s + close * 0.0001\nplot(s)\n'
    const run = () => {
      const built = buildRuntimeIr(src, { bars: rows, inputs: {}, objectTrees: [], pane: true, tf: 'D', basePeriod: 'D', ...runtimeClockOpts(false, { tf: 'D' }) })
      expect(built.ok, 'the control: the script builds').toBe(true)
      const program = lowerIrProgram(built.ir, { historyFromListing: true })
      return execute(program, { bars: N, series: ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(rows.map((b) => b[k]))),
        columns: program.columns, confirmed: true, barTimes: rows.map((b) => b.t) })
    }
    const real = run()
    const stub = race()
    let inside = null
    let outside = null
    try {
      inside = withMemberDoorClock(run)
      try { run(); outside = 'completed' } catch (e) { outside = String(e && (e.limit || e.message)) }
    } finally { stub.mockRestore() }
    expect(canon(Array.from(inside.outputs[0])), 'inside the door: the same values on a racing clock').toBe(canon(Array.from(real.outputs[0])))
    expect(outside, 'outside the door the racing clock stops the run (the rail can tell)').toMatch(/WALL_TIME/)
  })
  it('the whole door: byte-identical on a racing runtime clock', () => {
    const real = memberPaneDefinition({ source: CLOUDS, id: MEMBER_PANE_DEF_PREFIX })
    const stub = race()
    const raced = memberPaneDefinition({ source: CLOUDS, id: MEMBER_PANE_DEF_PREFIX })
    stub.mockRestore()
    expect(canon(raced)).toBe(canon(real))
  }, 120000)
})

describe('⭐⭐ e94 — the shipped budgets are the census\'s, never a placeholder or a measurement\'s lift', () => {
  it('the step budget: 2x or more the most step-hungry served script, and not the 400M placeholder', () => {
    // e94's census, both lanes: the most steps one served script spent in one translatePine call: 230,299,396
    expect(PINE_TRANSLATE_CALL_MAX_STEPS).toBe(500000000)
    expect(PINE_TRANSLATE_CALL_MAX_STEPS).not.toBe(400000000)
    expect(PINE_TRANSLATE_CALL_MAX_STEPS / 230299396).toBeGreaterThanOrEqual(2)
  })
  it('the wall stop: the census\'s value (a measurement lifts it to 600 s in its own snapshot only)', () => {
    expect(PINE_TRANSLATE_BUDGET_MS).toBe(1080000)
    expect(PINE_TRANSLATE_BUDGET_MS).not.toBe(600000)
  })
})

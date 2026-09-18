// W3 / R9 — the smoothness instrument's rail.
//
// ⛔⛔ THE WHOLE POINT OF THIS FILE IS THAT EVERY READING IS SHOWN GOING BOTH WAYS. The owner's
// standing rule (CLAUDE.md, "A THROWAWAY PROBE GETS A CONTROL TOO"): before a measurement's first
// result is reported or acted on, show it returning the OTHER answer on a known case. This module
// is not a throwaway — it is the instrument every M1–M4 number in `design-bar.md` will come from —
// so the same rule applies with more force, not less. A clean capture and a janky capture are both
// driven here from synthetic frame times, and the assertions name the difference.
//
// ⛔ AND IT RUNS WITH NO BROWSER. Every browser surface is injected, so `raf` is a queue this file
// drains by hand and `now` is a number this file advances. That is not only for CI: it means the
// instrument can be driven to a state a real device may never reproduce on demand — a 400ms stall,
// a hidden tab, an engine with no long-task support.
import { describe, it as vitestIt, expect, afterAll } from 'vitest'
import {
  createFrameCapture, SMOOTHNESS_CAP, FRAME_BUDGET_MS, DROPPED_FRAME_GAP_MS,
} from './hubSmoothness'

// House convention: `vitest -t` is a regex, and a filter matching nothing exits 0 and reads as a
// PASS. These counters catch a `-t` typo or a stray `.only`/`.skip`.
let definedCount = 0
let executedCount = 0
function it(name, fn) {
  definedCount += 1
  return vitestIt(name, (...args) => { executedCount += 1; return fn(...args) })
}
afterAll(() => {
  expect(executedCount).toBeGreaterThan(0)
  expect(executedCount).toBe(definedCount)
})

/**
 * A fake browser. `frames` is the list of gaps (ms) to deliver, in order.
 *
 * ⭐ The clock ONLY advances when a frame is delivered, so the summary is a pure function of the
 * gap list — there is no wall-clock flake in this file at all.
 */
function rig({ frames = [], visibility = () => 'visible', longTasks = null } = {}) {
  let t = 1000
  let queued = null
  const env = {
    now: () => t,
    raf: (cb) => { queued = cb; return 1 },
    caf: () => { queued = null },
    visibility,
    observeLongTasks: (onEntry) => {
      if (longTasks === null) return { supported: false, stop() {} }
      for (const d of longTasks) onEntry({ duration: d })
      return { supported: true, stop() {} }
    },
  }
  const drain = (gaps) => {
    // The first rAF fires at the start time (gap 0 is not counted — `frames > 0` guards it).
    if (queued) { const cb = queued; queued = null; cb(t) }
    for (const g of gaps) {
      t += g
      if (!queued) break
      const cb = queued; queued = null; cb(t)
    }
  }
  return { env, drain: () => drain(frames), advance: (ms) => { t += ms }, at: () => t }
}

const SIXTY = Array(30).fill(FRAME_BUDGET_MS)

describe('the smoothness instrument reports both answers', () => {
  it('CONTROL — a clean 60fps capture reports no dropped frames', () => {
    const { env, drain } = rig({ frames: SIXTY })
    const cap = createFrameCapture(env)
    cap.start(); drain()
    const s = cap.stop()

    expect(s.valid, `voided as ${s.voidReason}`).toBe(true)
    expect(s.frames).toBe(SIXTY.length + 1)
    expect(s.droppedFrames, 'a clean capture reported dropped frames').toBe(0)
    expect(s.gapMs.p50).toBeCloseTo(FRAME_BUDGET_MS, 1)
    expect(s.fps).toBeCloseTo(60, 0)
  })

  it('⛔ THE OTHER ANSWER — a stuttering capture reports the drops, and the same code path', () => {
    // Same rig, same assertions, one changed input: three frames take four vsyncs' worth.
    const janky = [...Array(20).fill(FRAME_BUDGET_MS), 68, 71, 66, ...Array(7).fill(FRAME_BUDGET_MS)]
    const { env, drain } = rig({ frames: janky })
    const cap = createFrameCapture(env)
    cap.start(); drain()
    const s = cap.stop()

    expect(s.valid).toBe(true)
    expect(s.droppedFrames, 'the instrument cannot see a stall it was handed').toBe(3)
    expect(s.gapMs.max).toBeGreaterThan(DROPPED_FRAME_GAP_MS)
    // p50 is unmoved by three outliers — which is why p95 and max are both reported.
    expect(s.gapMs.p50).toBeCloseTo(FRAME_BUDGET_MS, 1)
    expect(s.gapMs.p95).toBeGreaterThan(s.gapMs.p50)
    expect(s.fps).toBeLessThan(60)
  })

  it('input→paint latency is the wait to the NEXT frame, and only the first unpaired input counts', () => {
    const { env, drain, at } = rig({ frames: [FRAME_BUDGET_MS, FRAME_BUDGET_MS] })
    const cap = createFrameCapture(env)
    cap.start()
    // Two pointer events between the same pair of frames: the FIRST is the one that waited.
    cap.markInput(at() - 9)
    cap.markInput(at() - 1)
    drain()
    const s = cap.stop()

    expect(s.inputLatencyMs.samples, 'both inputs were paired with one paint').toBe(1)
    expect(s.inputLatencyMs.max, 'the later input won, so the wait is understated').toBeGreaterThan(8)
  })
})

describe('the ways it refuses rather than reports', () => {
  it('⛔ A HIDDEN TAB IS VOID, NEVER SLOW — and the numbers would have looked like jank', () => {
    // Chrome throttles rAF in a background tab, so these gaps are the BROWSER, not the hub.
    const { env, drain } = rig({ frames: [500, 480, 510], visibility: () => 'hidden' })
    const cap = createFrameCapture(env)
    cap.start(); drain()
    const s = cap.stop()

    expect(s.valid).toBe(false)
    expect(s.voidReason).toBe('hidden')
    // ⭐ THE CONTROL THAT MAKES THE REFUSAL MEANINGFUL: the same gaps on a VISIBLE tab are a real,
    // valid, catastrophic reading. So `valid:false` is a judgement about the tab, not about the
    // magnitude — which is exactly the distinction that would be lost if it just returned zeros.
    const visible = rig({ frames: [500, 480, 510] })
    const cap2 = createFrameCapture(visible.env)
    cap2.start(); visible.drain()
    const s2 = cap2.stop()
    expect(s2.valid).toBe(true)
    expect(s2.droppedFrames).toBe(3)
  })

  it('⛔ a capture that never got two frames is VOID, not a 0ms gap', () => {
    const { env, drain } = rig({ frames: [] })
    const cap = createFrameCapture(env)
    cap.start(); drain()
    const s = cap.stop()
    expect(s.valid).toBe(false)
    expect(s.voidReason).toBe('too-few-frames')
    expect(s.gapMs.p50, 'an empty window must not report a number').toBeNull()
  })

  it('⛔ NO LONG-TASK SUPPORT REPORTS null, NEVER 0 — iOS Safari is the target device', () => {
    const { env, drain } = rig({ frames: SIXTY })                 // longTasks: null => unsupported
    const cap = createFrameCapture(env)
    cap.start(); drain()
    const s = cap.stop()

    expect(s.longTasks.supported).toBe(false)
    expect(s.longTasks.count, '0 would read as "this device had no long tasks"').toBeNull()
    expect(s.longTasks.totalMs).toBeNull()

    // CONTROL: where the engine DOES support them, real counts come back — so `null` above is a
    // statement about the engine and not about this module being unable to count.
    const sup = rig({ frames: SIXTY, longTasks: [120, 75] })
    const cap2 = createFrameCapture(sup.env)
    cap2.start(); sup.drain()
    const s2 = cap2.stop()
    expect(s2.longTasks.supported).toBe(true)
    expect(s2.longTasks.count).toBe(2)
    expect(s2.longTasks.maxMs).toBe(120)
  })

  it('⛔ a saturated buffer SAYS SO — `lesson_a_saturated_instrument_reports_zero`', () => {
    const many = Array(SMOOTHNESS_CAP + 40).fill(FRAME_BUDGET_MS)
    const { env, drain } = rig({ frames: many })
    const cap = createFrameCapture(env)
    cap.start(); drain()
    const s = cap.stop()

    expect(s.frames, 'frames SEEN must exceed the cap').toBeGreaterThan(SMOOTHNESS_CAP)
    expect(s.dropped, 'the samples the cap refused are not reported').toBeGreaterThan(0)
    expect(s.capacity).toBe(SMOOTHNESS_CAP)
  })
})

describe('the charter holds', () => {
  it('⛔ NO SINK: starting and stopping a capture touches no network API', async () => {
    const calls = []
    const stubs = ['fetch', 'sendBeacon', 'XMLHttpRequest']
    const saved = {}
    for (const k of stubs) {
      saved[k] = globalThis[k]
      globalThis[k] = (...a) => { calls.push([k, ...a]); return undefined }
    }
    try {
      const { env, drain } = rig({ frames: SIXTY })
      const cap = createFrameCapture(env)
      cap.start(); cap.markInput(); drain(); cap.stop()
    } finally {
      for (const k of stubs) globalThis[k] = saved[k]
    }
    expect(calls, 'the smoothness instrument reached the network').toEqual([])

    // CONTROL: the stubs above really do record, so the empty array is an absence and not a
    // spy that was never wired. (`an absence is only evidence if the instrument could have seen
    // a presence` — the rule this repo has paid for six times in one session.)
    const probe = []
    const savedFetch = globalThis.fetch
    globalThis.fetch = (...a) => { probe.push(a); return undefined }
    try { globalThis.fetch('/x') } finally { globalThis.fetch = savedFetch }
    expect(probe).toHaveLength(1)
  })

  it('⛔ NO VERDICTS: the summary carries no threshold, no pass/fail, no "janky"', () => {
    const { env, drain } = rig({ frames: [...Array(10).fill(FRAME_BUDGET_MS), 400] })
    const cap = createFrameCapture(env)
    cap.start(); drain()
    const s = cap.stop()
    const json = JSON.stringify(s).toLowerCase()

    for (const word of ['pass', 'fail', 'janky', 'smooth', 'threshold', 'budget']) {
      expect(json, `the summary renders a verdict ("${word}") — the bar lives in design-bar.md`)
        .not.toContain(word)
    }
    // It still REPORTED the stall — refusing to judge is not refusing to measure.
    expect(s.gapMs.max).toBe(400)
  })
})

// app/src/pages/formulas/deviceDrawTime.js
//
// HOW LONG A SHARED INDICATOR TAKES TO COMPUTE ON THIS DEVICE (Studio lane R6).
//
// The server's class on a listing ("Light to draw") is a count: the same on every machine, and
// the only thing that can refuse a listing. This is the other half, for the person looking at a
// share page: the time a fresh run of the same indicator over the same 5,000-bar reference chart
// took in THIS browser. It is said as this device's, and it decides nothing.
//
//   · the engine's own headless export computes it (`engine/headlessCompute.js`) over the
//     engine's own reference series (`engine/referenceSeries.js`): the chart's code, no chart;
//   · ⛔ only a formula (`compute.kind === 'ast'`). A pasted script's run belongs in a worker,
//     and this page never runs one on the page's own thread to time it;
//   · the faster of two runs (the first pays for the browser warming up), and only one when the
//     first is already slow;
//   · ⛔ never a number for a run that did not finish whole: a refusal, a thrown error or an
//     engine that would not load is "no time", and the page then says nothing.
//
// The engine is loaded on demand, after the page has painted, so the share page's first open
// carries none of it.
//
// ⛔⛔ THE ENGINE'S OWN SWITCH IS ASKED FIRST (`engine/memberPaneGate.js`). The headless export
// brings the member script lane with it (`headlessCompute.js` imports `runtime/runtimeColumns.js`),
// and that lane has one switch that must close EVERY path to it: with the switch off this module
// never loads the engine, and answers BY NAME that this device's time was not measured
// (`UNMEASURED_LANE_OFF`). It never makes up a number. The rail that holds this is the engine's:
// `engine/__tests__/memberPaneGate.test.js`, which walks every import path from the app's entry.
import { useEffect, useState } from 'react'
import { memberPaneEnabled } from '../../components/chart/engine/memberPaneGate'

/** Why there is no time: the engine's script lane is switched off in this build, so the engine was
 *  not loaded. The page says so in words (`loadWords.deviceTimeLine`). */
export const UNMEASURED_LANE_OFF = 'lane-off'

/** A first run slower than this is not repeated. */
export const SLOW_RUN_MS = 50

const loadEngine = async () => {
  const [headless, reference] = await Promise.all([
    import('../../components/chart/engine/headlessCompute.js'),
    import('../../components/chart/engine/referenceSeries.js'),
  ])
  return {
    computeHeadless: headless.computeHeadless,
    referenceBars: reference.referenceBars,
    referenceOptions: reference.referenceOptions,
  }
}

const clock = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now())

/**
 * Time one formula on this device.
 * @returns {Promise<null | { ms: number, bars: number } | { unmeasured: string }>}
 *   null: nothing to say (not a formula, or the run did not finish whole);
 *   `{ unmeasured: UNMEASURED_LANE_OFF }`: the engine's switch is off, so nothing was run.
 */
export async function measureDeviceDraw(definition, { load = loadEngine, now = clock, laneOn = memberPaneEnabled() } = {}) {
  const compute = definition && definition.compute
  if (!compute || compute.kind !== 'ast') return null
  // ⛔ before the engine is loaded: the switch closes this path too
  if (laneOn !== true) return { unmeasured: UNMEASURED_LANE_OFF }
  let engine
  try {
    engine = await load()
  } catch {
    return null
  }
  let bars
  let opts
  try {
    bars = engine.referenceBars()
    opts = engine.referenceOptions()
  } catch {
    return null
  }
  if (!Array.isArray(bars) || !bars.length) return null
  let best = null
  for (let run = 0; run < 2; run += 1) {
    const t0 = now()
    let out
    try {
      out = engine.computeHeadless(definition, bars, opts)
    } catch {
      return null
    }
    const ms = now() - t0
    if (!out || out.refusal || !Array.isArray(out.outputs)) return null
    if (!Number.isFinite(ms) || ms < 0) return null
    best = best === null ? ms : Math.min(best, ms)
    if (ms > SLOW_RUN_MS) break
  }
  return { ms: best, bars: bars.length }
}

const whenIdle = (fn) => {
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(fn, { timeout: 1500 })
    return () => window.cancelIdleCallback(id)
  }
  const id = setTimeout(fn, 250)
  return () => clearTimeout(id)
}

/**
 * The time for `definition`, once the page is idle; null until then, and null for good when there
 * is none to give. `enabled` false never loads the engine.
 */
export function useDeviceDrawTime(definition, enabled, options) {
  const [time, setTime] = useState(null)
  useEffect(() => {
    setTime(null)
    if (!enabled || !definition) return undefined
    let alive = true
    const cancel = whenIdle(() => {
      measureDeviceDraw(definition, options).then((t) => { if (alive) setTime(t) })
    })
    return () => { alive = false; cancel() }
    // `options` is a test seam (a fixed loader and clock); a caller that passes one keeps it stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [definition, enabled])
  return time
}

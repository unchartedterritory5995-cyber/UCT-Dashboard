// The rail under FD's "the server already built these charts" fast path.
//
// `OptionsFlow.jsx`'s FD memo used to call `buildCharts(cc)` on EVERY recompute,
// on the main thread, even when its own filters had dropped nothing — and the
// server had already run the identical pure function over the identical rows.
// FD now returns `D` unchanged when `cc.length === D.clean_confirmed.length`.
//
// That shortcut is only sound while TWO properties hold in flowCompute:
//
//   1. the charts embedded in processFlowData's result ARE
//      buildCharts(result.clean_confirmed) — same rows, same function;
//   2. buildCharts is a pure function of its input array, so equal input
//      (element-for-element, in order) gives an equal answer.
//
// Both are properties of THIS module, not of the component, so they are testable
// here and they are what would silently break the page: if processFlowData ever
// built its charts from a different slice (pre-filter rows, a capped subset, a
// re-sorted array), FD's fast path would serve the WRONG chart data with no
// error anywhere — the tables would simply be built from a different population.
//
// ⛔ A control accompanies each assertion. Without one, both tests would pass
// just as happily against empty arrays — which is exactly how an earlier parity
// suite in this directory passed vacuously on expired-contract fixture data.
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { parseCSV, processFlowData, buildCharts, chartsBuildStats } from './flowCompute'

const HERE = dirname(fileURLToPath(import.meta.url))
const CSV = resolve(HERE, '../../../public/flow-data.csv')

// The chart keys buildCharts owns. Derived from a real call rather than typed,
// so a new chart added to buildCharts is covered the day it lands.
let D
let chartKeys

beforeAll(() => {
  const rows = parseCSV(readFileSync(CSV, 'utf8'))
  D = processFlowData(rows, null)
  chartKeys = Object.keys(buildCharts(D.clean_confirmed))
})

describe('the server result already carries buildCharts(clean_confirmed)', () => {
  it('is not vacuous — the tape produced real confirmed trades and real chart keys', () => {
    expect(D.clean_confirmed.length).toBeGreaterThan(100)
    expect(chartKeys.length).toBeGreaterThan(0)
  })

  it('rebuilding from clean_confirmed reproduces the charts processFlowData returned', () => {
    const rebuilt = buildCharts(D.clean_confirmed)
    for (const k of chartKeys) {
      expect(rebuilt[k], `chart "${k}" drifted from what processFlowData returned`).toEqual(D[k])
    }
  })

  it('CONTROL: a DIFFERENT row population produces different charts', () => {
    // Halve the population. If this still matched, the assertion above would be
    // proving nothing — it would mean the charts do not depend on their input.
    const half = D.clean_confirmed.slice(0, Math.floor(D.clean_confirmed.length / 2))
    const other = buildCharts(half)
    const differs = chartKeys.some(k => JSON.stringify(other[k]) !== JSON.stringify(D[k]))
    expect(differs, 'charts did not change when the input population changed').toBe(true)
  })
})

describe('buildCharts is pure over its input', () => {
  it('the same rows in the same order give an equal answer twice', () => {
    const a = buildCharts(D.clean_confirmed)
    const b = buildCharts(D.clean_confirmed)
    expect(b).toEqual(a)
  })

  it('does not mutate the trades it reads', () => {
    const before = JSON.stringify(D.clean_confirmed.slice(0, 50))
    buildCharts(D.clean_confirmed)
    expect(JSON.stringify(D.clean_confirmed.slice(0, 50))).toBe(before)
  })

  it('a filter that drops nothing yields an array equal to its input', () => {
    // This is the exact shape of FD's length test: filter preserves order and
    // never substitutes elements, so equal length after a filter means the same
    // elements in the same order — which is why length is a sufficient test.
    const kept = D.clean_confirmed.filter(() => true)
    expect(kept.length).toBe(D.clean_confirmed.length)
    expect(kept.every((t, i) => t === D.clean_confirmed[i])).toBe(true)
  })
})

describe('the build counter reports real runs', () => {
  it('counts a call and the rows it walked', () => {
    const before = { calls: chartsBuildStats.calls, rows: chartsBuildStats.rows }
    buildCharts(D.clean_confirmed)
    expect(chartsBuildStats.calls).toBe(before.calls + 1)
    expect(chartsBuildStats.rows).toBe(before.rows + D.clean_confirmed.length)
  })
})

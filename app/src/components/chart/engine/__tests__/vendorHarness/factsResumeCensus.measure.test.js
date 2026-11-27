// app/src/components/chart/engine/__tests__/vendorHarness/factsResumeCensus.measure.test.js
//
// ─── ⭐⭐ (e101 S1) THE FACTS RESUME, HELD TO A COLD RUN ACROSS THE CORPUS ─────────────────────────────────────────────
//
// `runtimeColumns.js::factsSessionFor` lets a run asked under new symbol facts (the exchange, the listing date, the
// classification) resume from the session of the same run asked under the old ones, proved by `resumableFrom`. This
// census builds every committed corpus script through the member door (runtime pane ON), and for each one the door put
// on the RUNTIME lane it runs, on a real daily series:
//   A  under the facts a cold switch first asks with (exchange unknown, listing date in flight),
//   B  under the settled facts (B may resume from A's session: that is the change),
//   B' the same ask cold (sessions dropped, the facts resume off),
// on the listing (a plain run) and off it (the warm-up curtain's two runs, each with its own session), and holds B to
// B' BIT FOR BIT: every column (`Object.is` per bar), the drawings record, the warm-up record, the realtime record,
// and a stop's guard and sentence.
// ⛔ OPT-IN (`RUNTIME_PERF_CENSUS=digest`). It asserts NO mismatch and that some runs resumed (non-vacuity).
//   cd app && RUNTIME_PERF_CENSUS=digest node node_modules/vitest/vitest.mjs run \
//     src/components/chart/engine/__tests__/vendorHarness/factsResumeCensus.measure.test.js
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import * as registry from '../../nativeRegistry'
import { enterMemberDoor, HARNESS_DEF_ID } from './ourSide'
import {
  computeRuntimeColumns, resetRuntimeSessions, resetRuntimeLedgers, runtimeIncrementalOf, __factsResumeOffForTests,
  RUNTIME_WARMUP_KEY, RUNTIME_REALTIME_KEY,
} from '../../runtime/runtimeColumns'
import { RUNTIME_OBJECTS_KEY } from '../../runtime/runtimeObjects'

const RUN = process.env.RUNTIME_PERF_CENSUS === 'digest'
const REPO = path.resolve(process.cwd(), '..')
const CORPUS = path.join(REPO, 'corpus', 'committed')
const SERIES = path.join(REPO, 'tests', 'fixtures', 'vendor', 'harness', 'vw-deadband-ticks-aapl-1d-2026-09-28.json')
const N_BARS = 1500

afterEach(() => { vi.unstubAllEnvs(); __factsResumeOffForTests(false); resetRuntimeSessions(); resetRuntimeLedgers() })

const freshBars = (rows) => rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
const symbol = (facts) => ({ ticker: 'AAPL', industry: null, sector: null, securityType: 'CS', ...facts })
const FIRST = { exchange: null, firstTradeDatePending: true }
const SETTLED = { exchange: 'NASDAQ', firstTradeDate: '1980-12-12' }

/** Everything a run answers, as plain data: its columns' bits, its records, or its stop. */
function imageOf(fn) {
  try {
    const cols = fn()
    const columns = {}
    for (const k of Object.keys(cols).sort()) {
      const c = cols[k]
      columns[k] = c && typeof c.length === 'number'
        ? Array.from(c, (v) => (typeof v === 'number' ? (Object.is(v, -0) ? '-0' : Number.isNaN(v) ? 'NaN' : v) : v))
        : c
    }
    const rec = (key) => (cols[key] === undefined ? null : JSON.stringify(cols[key]))
    // ⛔ `secondRunStoppedAt` is left out: where the curtain's probe stopped B (a diagnostic nothing reads, absent on
    // EVERY resumed A, a live tick's included, `computeOffListing`). `withheldBars`, the value, is compared.
    const w = cols[RUNTIME_WARMUP_KEY]
    const warmup = w === undefined ? null : JSON.stringify(w && typeof w === 'object' ? { ...w, secondRunStoppedAt: undefined } : w)
    return { ok: true, cols, image: JSON.stringify({ columns, objects: rec(RUNTIME_OBJECTS_KEY), warmup,
      realtime: rec(RUNTIME_REALTIME_KEY) }) }
  } catch (err) {
    return { ok: false, image: JSON.stringify({ guard: err && err.guard, limit: err && err.limit, message: String(err && err.message) }),
      wall: !!(err && (err.limit === 'WALL_TIME' || /WALL_TIME/.test(String(err.message)))) }
  }
}

describe.skipIf(!RUN)('the facts resume equals a cold run on every corpus script (opt-in)', () => {
  it('holds B to B\' bit for bit, on and off the listing', () => {
    const cap = JSON.parse(fs.readFileSync(SERIES, 'utf8'))
    const rows = cap.bars.rows.slice(-N_BARS)
    expect(rows.length).toBe(N_BARS)
    const files = fs.readdirSync(CORPUS).filter((f) => f.endsWith('.pine')).sort()
    expect(files.length).toBeGreaterThan(200)
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
    const tally = { scripts: 0, runs: 0, resumed: 0, full: 0, identical: 0, wallNoise: 0, mismatch: [] }
    for (const f of files) {
      const source = fs.readFileSync(path.join(CORPUS, f), 'utf8')
      let door
      try { door = enterMemberDoor(source) } catch { registry.uninstallUserDefinition(HARNESS_DEF_ID); continue }
      try {
        if (!door.def || !door.built || door.built.lane !== 'runtime') continue
        tally.scripts += 1
        for (const listing of [true, false]) {
          const ctx = (facts) => ({ tf: 'D', newestBarIsForming: false, historyFromListing: listing, symbol: symbol(facts) })
          resetRuntimeSessions(); resetRuntimeLedgers()
          imageOf(() => computeRuntimeColumns(door.def, freshBars(rows), ctx(FIRST)))
          const b = imageOf(() => computeRuntimeColumns(door.def, freshBars(rows), ctx(SETTLED)))
          resetRuntimeSessions(); resetRuntimeLedgers()
          __factsResumeOffForTests(true)
          const cold = imageOf(() => computeRuntimeColumns(door.def, freshBars(rows), ctx(SETTLED)))
          __factsResumeOffForTests(false)
          tally.runs += 1
          const inc = b.ok ? runtimeIncrementalOf(b.cols) : null
          if (inc && inc.resumedFrom !== null) tally.resumed += 1
          else tally.full += 1
          if (b.image === cold.image) tally.identical += 1
          else if (b.wall || cold.wall) tally.wallNoise += 1
          else tally.mismatch.push(`${f} listing=${listing}`)
        }
      } finally {
        registry.uninstallUserDefinition(HARNESS_DEF_ID)
      }
    }
    // eslint-disable-next-line no-console
    console.log(`facts resume census: ${JSON.stringify({ ...tally, mismatch: tally.mismatch.length })}\n`
      + tally.mismatch.map((m) => `  MISMATCH ${m}`).join('\n'))
    const out = process.env.RUNTIME_PERF_OUT
    if (out) {
      fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true })
      fs.writeFileSync(out, `${JSON.stringify(tally, null, 1)}\n`)
    }
    expect(tally.scripts).toBeGreaterThan(50) // non-vacuity: the runtime corpus was reached
    expect(tally.resumed).toBeGreaterThan(0)  // non-vacuity: the facts resume served runs
    expect(tally.mismatch).toEqual([])
  }, 3600000)
})

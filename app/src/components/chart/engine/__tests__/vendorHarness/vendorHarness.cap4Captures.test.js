// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.cap4Captures.test.js
//
// CAP4 (2026-10-04, step 91) - the 2026-10-03 capture queues, captured on the TradingView
// rig as unsaved Create-new drafts (editor buffer sha256 read back equal to the committed
// probe), read with `tv_capture.js`, moved out through the hash-receipted clipboard and
// assembled by `verify_capture.mjs` (VERDICT: PASS).
//
// Two kinds of rail here:
//   1. VENDOR FACTS - what TradingView printed / plotted, read straight off the capture.
//      These are the evidence the owning lane serves from; they do not involve the engine.
//   2. OUR GRADE - each row of `cap4-verdicts.json` (written by `cap4Captures.measure.test.js`
//      from the harness's own verdict, never by hand): MATCH is an `expect`; DIVERGE is an
//      `it.fails` asserting MATCH beside the named signature control.
import { describe, it, expect, vi, afterEach } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'

import { gradeCapture, loadCapture, HARNESS_DIR } from './harness'
import { cap3Signature } from './cap3Signature'
import { loadPineLibraryStore } from '../../ast/__tests__/pineLibraryStoreLoader.js'
import { clearPineLibraries } from '../../ast/pineLibraryStore'
import { enterMemberDoor } from './ourSide'
import * as registry from '../../nativeRegistry'
import { runtimeColumnsFor, __gradeWithoutPaneClockForTests } from '../../runtime/runtimeColumns'

afterEach(() => { vi.unstubAllEnvs() })
const T = 600000
const STORE_DIR = process.env.PINE_LIBRARY_STORE || ''
const CAP4 = JSON.parse(fs.readFileSync(path.join(__dirname, 'cap4-verdicts.json'), 'utf8')).captures
const cap = (id) => loadCapture(path.join(HARNESS_DIR, `${id}.json`)).capture
const col = (c, title) => {
  const plot = c.study.plots.find((p) => p.title === title)
  expect(plot, `plot ${title}`).toBeTruthy()
  const at = c.plotValues.fields.indexOf(plot.id)
  return c.plotValues.rows.map((r) => r[at])
}
const cellsByRow = (c) => {
  const m = {}
  for (const x of c.objects.records.tableCells) (m[x.row] = m[x.row] || [])[x.col] = x.t
  return m
}

const gradeRow = (row) => {
  if (row.library) loadPineLibraryStore(STORE_DIR)
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  if (row.state === 'runtime') vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  const v = gradeCapture(cap(row.id)).verdict
  vi.unstubAllEnvs()
  clearPineLibraries()
  return v
}

describe('CAP4 - Q-H5a vw-h5-format-volume, AMEX:SPY 1D (vendor witness)', () => {
  const ID = 'vw-h5-format-volume-spy-1d-2026-10-04'
  it('the source is the committed probe; one table, 17 rows x 2 cells', () => {
    const c = cap(ID)
    expect(c.source.sha256).toBe('693f3893b23c4faaac82d6fdd5f0f157ab50d404dc4282cd19bc6905168e213e')
    expect(c.symbol.full_name).toBe('AMEX:SPY')
    expect(c.objects.counts).toMatchObject({ tables: 1, tableCells: 34 })
  })
  it('str.tostring(x, format.volume): K below a million, trailing zeros trimmed, half rounds up, NO roll-over at 999,999,600 ("1000M"), T above a billion thousand', () => {
    expect(cellsByRow(cap(ID))).toEqual({
      0: ['H00_control', '3.126M'], // 3,125,951
      1: ['H1', '0'], // 0
      2: ['H2', '7'], // 7
      3: ['H3', '999'], // 999
      4: ['H4', '1K'], // 1,000
      5: ['H5', '1.5K'], // 1,500
      6: ['H6', '12.345K'], // 12,345
      7: ['H7', '999.999K'], // 999,999
      8: ['H8', '1M'], // 1,000,000
      9: ['H9', '3.1M'], // 3,100,000
      10: ['H10', '3.126M'], // 3,125,500 - an exact tie rounds up
      11: ['H11', '3.126M'], // 3,125,501
      12: ['H12', '1000M'], // 999,999,600 - rounds to 1000.000M, the unit does NOT roll over
      13: ['H13', '1B'], // 1,000,000,000
      14: ['H14', '-1.5K'], // -1,500
      15: ['H15', '-3.1M'], // -3,100,000
      16: ['H16', '2.5T'], // 2.5e12
    })
  })
})

describe('CAP4 - Q-H5b vw-h5-request-timeframe-text, AMEX:SPY 1D (vendor witness)', () => {
  const ID = 'vw-h5-request-timeframe-text-spy-1d-2026-10-04'
  it('the source is the committed probe; 300 bars (bar_index 8177..8476, not from the listing)', () => {
    const c = cap(ID)
    expect(c.source.sha256).toBe('a0dea71de09f4ab4e31454167dcf52522994d7b5ee9ae072a6f4e441a4476be2')
    expect(c.bars.count).toBe(300)
    const bi = col(c, 'T00_bar_index_CONTROL')
    expect(bi[0]).toBe(8177)
    expect(bi.every((x, i) => x === 8177 + i)).toBe(true)
  })
  it('inside request.security(<own>, tf, ...), timeframe.* is the REQUESTED timeframe on every bar: W 10080, M 43830, 240 -> 240, 3 -> 3; the chart reads multiplier 1', () => {
    const c = cap(ID)
    expect(new Set(col(c, 'T01_week'))).toEqual(new Set([10080]))
    expect(new Set(col(c, 'T02_month'))).toEqual(new Set([43830]))
    expect(new Set(col(c, 'T03_240'))).toEqual(new Set([240]))
    expect(new Set(col(c, 'T04_3'))).toEqual(new Set([3]))
    expect(new Set(col(c, 'T05_chart_multiplier_CONTROL'))).toEqual(new Set([1]))
  })
})

describe('CAP4 - Q-RT7a/b vw-rt7-empty-reduce-fixnan, AMEX:SPY 1D FULL history (vendor witness)', () => {
  const ID = 'vw-rt7-empty-reduce-fixnan-spy-1d-2026-10-04'
  it('the source is the committed probe; 8477 bars from the listing (1993-01-29), bar_index 0..8476', () => {
    const c = cap(ID)
    expect(c.source.sha256).toBe('cbe8acbc6e871843cd191b855d8069a900e79d6be6eda1aede8b3913988b8140')
    expect(c.history.startsAtBar0).toBe(true)
    expect(c.bars.count).toBe(8477)
    expect(c.bars.rows[0][0]).toBe(728317800)
    expect(col(c, 'E00_bar_index_CONTROL').every((x, i) => x === i)).toBe(true)
  })
  it('E01-E06: max / min / sum / avg of an EMPTY array and sum / avg of (na, na) are na on every bar - no runtime error, and sum is NOT 0', () => {
    const c = cap(ID)
    for (const t of ['E01_max_empty', 'E02_min_empty', 'E03_sum_empty', 'E04_avg_empty', 'E05_sum_all_na', 'E06_avg_all_na']) {
      expect(new Set(col(c, t)), t).toEqual(new Set([null]))
    }
  })
  it('F01 / F02a / F02b: fixnan equals the hand replay (the last real value, na before the first) on all 8477 bars; two call sites keep two memories', () => {
    const c = cap(ID)
    const fix = (xs) => { let last = null; return xs.map((x) => { if (x !== null) last = x; return last }) }
    const x = c.bars.rows.map((b, i) => (i < 3 || (i >= 20 && i <= 26) || i % 3 === 1 ? null : b[4]))
    const hi = c.bars.rows.map((b, i) => (i % 4 === 0 ? b[2] : null))
    expect(col(c, 'F00_x_CONTROL')).toEqual(x)
    expect(col(c, 'F01_fixnan')).toEqual(fix(x))
    expect(col(c, 'F02a_fixnan_in_fn')).toEqual(fix(x))
    expect(col(c, 'F02b_fixnan_in_fn_second_site')).toEqual(fix(hi))
  })
})

describe('CAP4 - why our door does not answer Q-H5b / Q-RT7 (the named walls these captures are the evidence for)', () => {
  it('Q-H5b: both door states refuse the 240 request by name (pine:request, lower-tf:store-unmeasured)', () => {
    for (const state of ['on', 'runtime']) {
      const v = gradeRow({ id: 'vw-h5-request-timeframe-text-spy-1d-2026-10-04', state })
      expect(v.verdict).toBe('INCONCLUSIVE')
      expect(v.reason).toMatch(/pine:request/)
      expect(v.reason).toMatch(/lower-tf:store-unmeasured/)
    }
  }, T)
  it('Q-RT7: the objects pane refuses fixnan (pine:na); the runtime run stops on bar 0 by name at `array.sum of an empty array`, which TradingView answers na', () => {
    const ID = 'vw-rt7-empty-reduce-fixnan-spy-1d-2026-10-04'
    expect(gradeRow({ id: ID, state: 'on' }).reason).toMatch(/pine:na/)
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
    const c = cap(ID)
    const door = enterMemberDoor(c.source.text)
    expect(door.built.lane).toBe('runtime')
    const bars = c.bars.rows.map((b) => ({ time: new Date(b[0] * 1000).toISOString().slice(0, 10), open: b[1], high: b[2], low: b[3], close: b[4], volume: b[5] }))
    __gradeWithoutPaneClockForTests(true)
    let err = null
    try { runtimeColumnsFor(door.def, bars, undefined, { tf: 'D', symbol: 'SPY', historyFromListing: true, barIndexFromFirstBar: true }) } catch (e) { err = e }
    __gradeWithoutPaneClockForTests(false)
    registry.uninstallUserDefinition(door.def.id)
    expect(err && err.guard).toBe('runtime:failed')
    expect(String(err.message)).toMatch(/stopped on bar 0 of 8477 .*array\.sum of an empty array/)
  }, T)
})

describe('CAP4 - our grade of each capture, pinned by measured signature', () => {
  it('every row carries a measured signature', () => {
    expect(CAP4.length).toBeGreaterThan(0)
    for (const row of CAP4) expect(row.signature, `${row.id} ${row.state}`).toBeTruthy()
  })
  for (const row of CAP4) {
    const run = row.library && !STORE_DIR ? it.skip : it
    if (row.signature && row.signature.verdict === 'MATCH') {
      run(`${row.id} (${row.state}): MATCH`, () => { expect(gradeRow(row).verdict).toBe('MATCH') }, T)
      continue
    }
    if (row.signature && row.signature.verdict === 'DIVERGE') {
      ;(row.library && !STORE_DIR ? it.skip : it.fails)(`${row.id} (${row.state}): MATCH`, () => {
        expect(gradeRow(row).verdict).toBe('MATCH')
      }, T)
    }
    run(`control: ${row.id} (${row.state}) - the grade is the measured signature (${row.signature && row.signature.verdict})`, () => {
      expect(cap3Signature(gradeRow(row))).toEqual(row.signature)
    }, T)
  }
})

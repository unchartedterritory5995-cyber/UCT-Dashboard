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

const gradeRow = (row) => {
  if (row.library) loadPineLibraryStore(STORE_DIR)
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  if (row.state === 'runtime') vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  const v = gradeCapture(cap(row.id)).verdict
  vi.unstubAllEnvs()
  clearPineLibraries()
  return v
}
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

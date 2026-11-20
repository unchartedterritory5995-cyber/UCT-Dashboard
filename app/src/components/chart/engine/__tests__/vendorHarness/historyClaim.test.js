// app/src/components/chart/engine/__tests__/vendorHarness/historyClaim.test.js
//
// ⭐⭐ THE REFUTATION RULE (coordinator ruling 2026-11-19): a capture whose OWN bar_index control row does not
// read 0, 1, 2 … has its `history.startsAtBar0` claim refuted and read as FALSE; the receipt is untouched.
// `tools/vendor_harness/history_claim.mjs` is the one authority every grader reads the claim through.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { loadCapture, gradeCapture, REPO } from './harness'
import { validateCapture } from '../../../../../../../tools/vendor_harness/schema.mjs'
import { runOurSide } from './ourSide'
import { parent, joinedFromListing } from './c38Joined'
import {
  startsAtBar0Holds, startsAtBar0Refuted, barIndexControlRow,
} from '../../../../../../../tools/vendor_harness/history_claim.mjs'

const fixture = (id) => loadCapture(path.join(REPO, 'tests', 'fixtures', 'vendor', `${id}.json`)).capture
const INT_CAST = 'vw-int-cast-spy-1d-2026-09-27'              // claims bar 0; its own row reads 8172 on bar 0
const NVI_TRUNC = 'vw-nvi-pvi-spy-1d-truncated-2026-09-27'    // claims bar 0; its own row reads 7432 on bar 0
const NVI_FULL = 'vw-nvi-pvi-spy-1d-full-2026-09-27'          // claims bar 0, and its row reads 0, 1, 2 … (TRUE)

describe('the claim as the graders read it', () => {
  it.each([[INT_CAST, 8172], [NVI_TRUNC, 7432]])('%s: claimed, and REFUTED by its own bar_index row (%s on bar 0)', (id, first) => {
    const cap = fixture(id)
    expect(cap.history.startsAtBar0).toBe(true)                // what the metadata says
    expect(validateCapture(cap).ok).toBe(true)                 // the receipt is untouched: nothing was edited
    expect(barIndexControlRow(cap).values[0]).toBe(first)
    expect(startsAtBar0Refuted(cap)).toMatch(new RegExp(`reads ${first} on its bar 0`))
    expect(startsAtBar0Holds(cap)).toBe(false)
  })
  it('CONTROL: a TRUE claim (the full-history capture, its row reads 0, 1, 2 …) holds, unrefuted', () => {
    const cap = fixture(NVI_FULL)
    expect(barIndexControlRow(cap).values.slice(0, 3)).toEqual([0, 1, 2])
    expect(startsAtBar0Refuted(cap)).toBeNull()
    expect(startsAtBar0Holds(cap)).toBe(true)
  })
  it('CONTROL: a claim with NO control row keeps its claim (nothing to refute it)', () => {
    const cap = JSON.parse(JSON.stringify(fixture(NVI_FULL)))
    cap.study.plots = cap.study.plots.filter((p) => !/bar_index/.test(p.title))
    expect(barIndexControlRow(cap)).toBeNull()
    expect(startsAtBar0Holds(cap)).toBe(true)
  })
  it('CONTROL: no claim, nothing to refute (a row that does not start at 0 is the ordinary case)', () => {
    const cap = JSON.parse(JSON.stringify(fixture(INT_CAST)))
    cap.history = { startsAtBar0: false, why: 'not asserted' }
    expect(startsAtBar0Refuted(cap)).toBeNull()
    expect(startsAtBar0Holds(cap)).toBe(false)
  })
  it("CONTROL: a capture JOINED onto the listing (its rows only for its window) holds: the row is read at ITS bar's position", () => {
    // ⚰️ the first version held each value to its ROW number, and refuted every joined capture (c29, c38, c45 went red)
    const j = joinedFromListing(parent('vw-ne-na-spy-1d-2026-09-30'), { control: 'Q00_bar_index_CONTROL', id: 'claim' })
    const row = barIndexControlRow(j)
    expect(row.values[0]).toBeGreaterThan(1000)                  // the window's first row is deep in the listing's history
    expect(j.bars.rows.length).toBeGreaterThan(row.values.length)
    expect(startsAtBar0Refuted(j)).toBeNull()
    expect(startsAtBar0Holds(j)).toBe(true)
  })
  it('the claim is read where the row BEGINS: a first value off by one is refuted there', () => {
    const cap = JSON.parse(JSON.stringify(fixture(NVI_FULL)))
    const at = cap.plotValues.fields.indexOf(barIndexControlRow(cap).id)
    cap.plotValues.rows[0][at] = 1
    expect(startsAtBar0Refuted(cap)).toMatch(/reads 1 on its bar 0/)
  })
  it('CONTROL: a calc_bars_count capture (its rows read 0, 1, 2 … on the LAST bars) holds: 0 is where TradingView began counting', () => {
    const cap = fixture('harness/vw-cs1-calc-bars-rddt-1d-2026-11-14')
    const row = barIndexControlRow(cap)
    expect(row.values.slice(0, 3)).toEqual([0, 1, 2])
    expect(cap.bars.rows.length).toBeGreaterThan(row.values.length)  // the rows are a suffix of the bars
    expect(startsAtBar0Refuted(cap)).toBeNull()
    expect(startsAtBar0Holds(cap)).toBe(true)
  })
  it('CONTROL: a row that starts at 0 and is off LATER is not refuted (that number is graded DIVERGE: C45)', () => {
    const cap = JSON.parse(JSON.stringify(fixture(NVI_FULL)))
    const at = cap.plotValues.fields.indexOf(barIndexControlRow(cap).id)
    cap.plotValues.rows[5][at] = 6
    expect(startsAtBar0Refuted(cap)).toBeNull()
  })
})

describe('wired: the lane context and the grade read the claim through history_claim.mjs', () => {
  it.each([[INT_CAST, false], [NVI_FULL, true]])('%s: historyFromListing is %s', (id, want) => {
    const ours = runOurSide(fixture(id))
    expect(ours.ok).toBe(true)
    expect(ours.ctx.historyFromListing).toBe(want)
    expect(ours.notes.some((n) => /REFUTED/.test(n))).toBe(!want)
  }, 120000)
  it('vw-int-cast: bar_index MATCHes and nothing DIVERGEs (I00 read DIVERGE while the claim was believed)', () => {
    // the suite's default lane is the host lane, where I01-I05 / I09 are hidden constants (INCONCLUSIVE on colour)
    const g = gradeCapture(fixture(INT_CAST))
    expect(g.verdict.verdict).not.toBe('DIVERGE')
    expect(g.verdict.plots.find((p) => p.title === 'I00_bar_index_CONTROL').verdict).toBe('MATCH')
    expect(g.verdict.plots.filter((p) => p.verdict === 'DIVERGE')).toEqual([])
  }, 120000)
  it('vw-nvi-pvi truncated grades MATCH on every item (it read 8 of 9 DIVERGE while the claim was believed)', () => {
    const g = gradeCapture(fixture(NVI_TRUNC))
    expect(g.verdict.verdict).toBe('MATCH')
  }, 120000)
})

describe('one authority: no grader reads the raw claim', () => {
  // the capture PRODUCERS write it, and the strategy capture validator requires it to be asserted at all
  const ALLOWED = new Set(['tools/vendor_harness/history_claim.mjs', 'tools/vendor_harness/tv_capture.js',
    'tools/vendor_harness/strategy_capture.mjs'])
  const files = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p) } else if (/\.(m?js|jsx)$/.test(e.name) && !/\.test\./.test(e.name)) files.push(p)
    }
  }
  walk(path.join(REPO, 'app', 'src'))
  walk(path.join(REPO, 'tools', 'vendor_harness'))
  it('reads the trees it claims to (a rail over nothing passes)', () => {
    expect(files.length).toBeGreaterThan(1000)
    expect(files.some((f) => f.endsWith('ourSide.js'))).toBe(true)
  })
  it('`startsAtBar0 === true` appears only where a capture is MADE, never where one is graded', () => {
    const raw = files.map((f) => path.relative(REPO, f).replace(/\\/g, '/'))
      .filter((rel) => !ALLOWED.has(rel) && /startsAtBar0\s*===\s*true/.test(fs.readFileSync(path.join(REPO, rel), 'utf8')))
    expect(raw, 'read the claim through tools/vendor_harness/history_claim.mjs::startsAtBar0Holds').toEqual([])
  })
})

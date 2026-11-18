// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.supplyBehind.test.js
//
// SUPPLY BEHIND THE CAPTURE (coordinator ruling, 2026-11-18): a capture's FORMING newest bar read another
// symbol's newest session; when the supply recorded beside it holds no row of that session (recorded EARLIER),
// our side cannot answer that bar from it. That one bar grades INCONCLUSIVE by name, the plot's verdict
// follows from the other bars, and the counterfactual compare (supply attribution, rule 3) gets the same mask.
// Read `supplyAttribution.js` (SUPPLY BEHIND THE CAPTURE) for the conditions.
// ⚰️ Measured on rs-rating-fred6724-w-{rddt,nvda}-1w-2026-11-17: captured 2026-11-17T21:16Z beside an SPX supply
// recorded 2026-11-16T23:13Z (newest row 2026-11-16); TradingView's forming week read the 2026-11-17 close.
import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { gradeCapture, REPO } from './harness'
import { supplyBehindOf, supplyBehindRecord, sessionReadAt, SUPPLY_BEHIND_ALIGNMENTS } from './supplyAttribution'
import { sealCapture } from '../../../../../../../tools/vendor_harness/schema.mjs'
import { MATCH_SUBSTITUTED } from '../../../../../../../tools/vendor_harness/compare.mjs'

vi.setConfig({ testTimeout: 600000 })

const HARNESS = path.join(REPO, 'tests/fixtures/vendor/harness')
const SUPPLY = path.join(REPO, 'tests/fixtures/vendor-supply')
const load = (id) => JSON.parse(fs.readFileSync(path.join(HARNESS, `${id}.json`), 'utf8'))
const RDDT_W = 'rs-rating-fred6724-w-rddt-1w-2026-11-17'
const NVDA_W = 'rs-rating-fred6724-w-nvda-1w-2026-11-17'
const rsLineOf = (verdict) => verdict.plots.find((p) => p.title === 'RS Line')
const behind = (over = {}) => supplyBehindRecord({ capturedAtUTC: '2026-11-17T21:16:39.028Z', newestBarIsForming: true,
  symbol: 'SPX', alignment: 'previous-session', newestRowDay: '2026-11-16', recordedAtUTC: '2026-11-16T23:13:34Z', ...over })

describe('the session a capture read (capturedAtUTC + the NYSE calendar)', () => {
  it.each([
    ['2026-11-17T21:16:39.028Z', '2026-11-17', 'after the close (16:16 ET): that day'],
    ['2026-11-18T15:01:00Z', '2026-11-18', 'in session (10:01 ET): that day'],
    ['2026-11-18T14:31:00Z', '2026-11-18', '09:31 ET: the session has opened'],
    ['2026-11-18T14:29:00Z', '2026-11-17', '09:29 ET: not yet open, the day before'],
    ['2026-11-18T12:47:00Z', '2026-11-17', 'pre-market (07:47 ET): the day before'],
    ['2026-11-19T02:00:00Z', '2026-11-18', '21:00 ET, after the post-market: that day'],
    ['2026-11-21T15:00:00Z', '2026-11-20', 'a Saturday: the Friday'],
    ['2026-11-23T03:00:00Z', '2026-11-20', 'Sunday 22:00 ET: the Friday'],
    ['2026-11-26T16:00:00Z', '2026-11-25', 'Thanksgiving (a holiday): the day before'],
  ])('%s -> %s (%s)', (at, want) => {
    expect(sessionReadAt(at)).toBe(want)
  })
  it('an unreadable timestamp reads no session', () => {
    expect(sessionReadAt(null)).toBe(null)
    expect(sessionReadAt('not a time')).toBe(null)
  })
})

describe('the rule (pure)', () => {
  it('a supply whose newest row is a session BEFORE the one the forming bar read is behind', () => {
    const r = behind()
    expect(r).toMatchObject({ symbol: 'SPX', newestRow: '2026-11-16', session: '2026-11-17' })
    expect(r.sentence).toMatch(/predates session 2026-11-17/)
  })
  it('BOUNDARY: a supply that HOLDS the session read is not behind (the bar is graded normally)', () => {
    expect(behind({ newestRowDay: '2026-11-17' })).toBe(null)
    expect(behind({ newestRowDay: '2026-11-18' })).toBe(null)
  })
  it('only a FORMING newest bar', () => {
    expect(behind({ newestBarIsForming: false })).toBe(null)
    expect(behind({ newestBarIsForming: undefined })).toBe(null)
  })
  it('only a symbol aligned by exchange session: the sparse RS seed (stale by design) never qualifies', () => {
    expect(SUPPLY_BEHIND_ALIGNMENTS.has('same-date-gaps-na')).toBe(false)
    expect(behind({ alignment: 'same-date-gaps-na' })).toBe(null)
    expect(behind({ alignment: undefined })).toBe(null)
  })
})

describe('committed captures', () => {
  it('both 2026-11-17 weekly RS Rating captures: SPX recorded a session behind (11-16 for the 11-17 session)', () => {
    for (const id of [RDDT_W, NVDA_W]) {
      expect(supplyBehindOf(load(id)), id).toMatchObject({ symbol: 'SPX', newestRow: '2026-11-16', session: '2026-11-17' })
    }
  })

  it('⭐ SCOPE: of every committed capture with a recorded supply, the rule applies to exactly these two', () => {
    const touched = []
    let withSupply = 0
    for (const f of fs.readdirSync(SUPPLY).filter((x) => x.endsWith('.json')).sort()) {
      const id = f.slice(0, -'.json'.length)
      if (!fs.existsSync(path.join(HARNESS, f))) continue
      withSupply += 1
      if (supplyBehindOf(load(id))) touched.push(id)
    }
    expect(withSupply).toBeGreaterThan(10)                 // the census compared something
    expect(touched).toEqual([NVDA_W, RDDT_W])
  })

  it('RDDT 1W: the RS line agrees on every settled week; the forming week INCONCLUSIVE by name, not DIVERGE', () => {
    const cap = load(RDDT_W)
    const n = cap.bars.rows.length
    const { verdict } = gradeCapture(cap)
    const p = rsLineOf(verdict)
    expect(p.verdict, p.reason).not.toBe('DIVERGE')
    expect(p.supplyBehind).toMatchObject({ verdict: 'INCONCLUSIVE', bar: n - 1, symbol: 'SPX', session: '2026-11-17', newestRow: '2026-11-16' })
    expect(p.reason).toMatch(/newest bar INCONCLUSIVE by name: .*predates session 2026-11-17.*\(supplyBehind\)/)
    expect(p.stats.supplyBehindBars).toBe(1)
    expect(p.stats.steady.divergent).toBe(0)
    expect(p.stats.compared).toBe(n - 1)                     // every other bar IS compared
    expect(verdict.supplyBehind.plots).toContain('RS Line')
    expect(verdict.plots.filter((x) => x.verdict === 'DIVERGE')).toEqual([])
  })

  it('CONTROL: the same capture timed before the 11-17 session (the supply then holds what it read) grades the bar: DIVERGE', () => {
    const cap = load(RDDT_W)
    cap.capturedAtUTC = '2026-11-17T04:00:00.000Z'          // 23:00 ET on 11-16: the session read is 11-16
    const sealed = sealCapture(cap)
    expect(supplyBehindOf(sealed)).toBe(null)
    const p = rsLineOf(gradeCapture(sealed).verdict)
    expect(p.verdict).toBe('DIVERGE')
    expect(p.supplyBehind).toBeUndefined()
    expect(p.stats.steadyDivergent.map((d) => d.bar)).toEqual([cap.bars.rows.length - 1])
  })

  it('NVDA 1W: the accepted S&P 500 history (Q-RS9) is supply-attributed on its 266 weeks; the forming week INCONCLUSIVE by name', () => {
    const cap = load(NVDA_W)
    const n = cap.bars.rows.length
    const p = rsLineOf(gradeCapture(cap).verdict)
    expect(p.verdict, p.reason).toBe(MATCH_SUBSTITUTED)
    expect(p.supplyAttributed).toMatchObject({ symbol: 'SPX', bars: 266, datesDiffer: 266 })
    expect(p.supplyAttributed.witness).toContain('rs-spx-daily-spy-1d-2026-11-15')
    expect(p.supplyBehind).toMatchObject({ verdict: 'INCONCLUSIVE', bar: n - 1, session: '2026-11-17' })
  })

  it('CONTROL: without the mask on the newest bar (the capture timed before 11-17), NVDA 1W stays DIVERGE', () => {
    const cap = load(NVDA_W)
    cap.capturedAtUTC = '2026-11-17T04:00:00.000Z'
    const p = rsLineOf(gradeCapture(sealCapture(cap)).verdict)
    expect(p.verdict).toBe('DIVERGE')
    expect(p.supplyAttributed).toBeUndefined()
  })
})

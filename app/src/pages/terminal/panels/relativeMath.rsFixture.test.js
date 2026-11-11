// The Terminal's RRG against the SHARED fixture the server reads (UCT RS Phase 3, unit 3-03).
//
// ⛔ ONE FORMULA, TWO LANES. Engineering map 2026-11-08 decision D1: the chart's Rotation
// reading, the screener's `rrg_quadrant` and the Compare tab all use THIS file's `rrgPath`
// formula (`RRG_METHOD`), ported to `api/services/relative_strength.rrg_columns`. Both lanes
// read `tests/fixtures/indicators/rs_rrg.json` — `tests/test_rs_phase3_math.py` runs the
// Python port over it, this file runs the real `rrgPath` — so a change to either side is red
// until the other moves with it. The expected values were written once by a generator that
// imported neither lane (exact rational arithmetic); the fixture's `note` derives three rows.
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { closesFromBars, quadrantOf, rrgPath, QUADRANTS, RRG_METHOD } from './relativeMath'

// vitest runs from `app/`; resolve from the repo root too, and fail LOUDLY if neither hits
// (a suite that found no fixture would pass on zero assertions).
const FIX = [
  join(process.cwd(), '..', 'tests', 'fixtures', 'indicators'),
  join(process.cwd(), 'tests', 'fixtures', 'indicators'),
].find((p) => existsSync(join(p, 'rs_rrg.json')))
if (!FIX) throw new Error(`rs_rrg.json not found from cwd ${process.cwd()}`)
const fx = JSON.parse(readFileSync(join(FIX, 'rs_rrg.json'), 'utf8'))

// `|got − exp| <= relTol × max(1, |exp|)`, the fixtures' tolerance rule (_schema.md).
const close = (got, exp) => Math.abs(got - exp) <= fx.relTol * Math.max(1, Math.abs(exp))

const sym = closesFromBars({ bars: fx.bars })
const bench = closesFromBars({ bars: fx.benchmarkBars })
const method = { ratioLen: fx.params.ratio_len, momLen: fx.params.mom_len, tail: fx.bars.length }
const path = rrgPath(sym, bench, method)
const dateOf = (bar) => new Date(bar.t * 1000).toISOString().slice(0, 10)

describe('rs_rrg.json — the Terminal lane', () => {
  it('pins the shipped constants: RRG_METHOD and QUADRANTS are the fixture\'s', () => {
    expect(RRG_METHOD.ratioLen).toBe(fx.params.ratio_len)
    expect(RRG_METHOD.momLen).toBe(fx.params.mom_len)
    expect(QUADRANTS).toEqual(fx.quadrantNames)
  })

  it('reads every bar of both series (none dropped by closesFromBars)', () => {
    expect(sym).toHaveLength(fx.bars.length)
    expect(bench).toHaveLength(fx.benchmarkBars.length)
  })

  it('every point rrgPath plots is the fixture\'s rsRatio / rsMomentum on that bar', () => {
    expect(path).not.toBeNull()
    const exp = fx.expected
    const want = fx.bars
      .map((b, i) => ({ d: dateOf(b), x: exp.rsRatio[i], y: exp.rsMomentum[i] }))
      .filter((p) => p.x !== null && p.y !== null)
    // the Terminal plots exactly the bars where the server has BOTH coordinates
    expect(path.tail.map((p) => p.d)).toEqual(want.map((p) => p.d))
    path.tail.forEach((p, k) => {
      expect(close(p.x, want[k].x), `${p.d} x ${p.x} vs ${want[k].x}`).toBe(true)
      expect(close(p.y, want[k].y), `${p.d} y ${p.y} vs ${want[k].y}`).toBe(true)
    })
    expect(want.length).toBeGreaterThan(40)
  })

  it('every quadrant code is QUADRANTS[code − 1] of quadrantOf on the same point', () => {
    const byDate = new Map(path.tail.map((p) => [p.d, p]))
    let seen = 0
    fx.bars.forEach((b, i) => {
      const code = fx.expected.quadrant[i]
      const p = byDate.get(dateOf(b))
      if (code === null) { expect(p).toBeUndefined(); return }
      expect(QUADRANTS[code - 1]).toBe(quadrantOf(p.x, p.y))
      seen += 1
    })
    expect(seen).toBe(path.tail.length)
    expect(new Set(fx.expected.quadrant.filter((q) => q !== null))).toEqual(new Set([1, 2, 3, 4]))
  })

  it('the head is the last fixture bar, and the default 8-point tail is its last 8 points', () => {
    const last = fx.bars.length - 1
    expect(path.asOf).toBe(dateOf(fx.bars[last]))
    expect(QUADRANTS[fx.expected.quadrant[last] - 1]).toBe(path.quadrant)
    const shipped = rrgPath(sym, bench)
    expect(shipped.tail).toEqual(path.tail.slice(-RRG_METHOD.tail))
  })

  it('the halted benchmark week (stock bar 33) is skipped, not plotted and not zeroed', () => {
    const halted = dateOf(fx.bars[33])
    expect(bench.some((p) => p.d === halted)).toBe(false)
    expect(path.tail.some((p) => p.d === halted)).toBe(false)
    expect(fx.expected.rsRatio[33]).toBeNull()
    // the bar after it is the note's hand-derived row: ratio 98.561117, momentum 103.278405
    const after = path.tail.find((p) => p.d === dateOf(fx.bars[34]))
    expect(after.x).toBeCloseTo(98.561117, 5)
    expect(after.y).toBeCloseTo(103.278405, 5)
    expect(quadrantOf(after.x, after.y)).toBe('Improving')
  })
})

// ─── THE CLOCK ORACLE, READ FROM THE LANE THAT WROTE IT ─────────────────────
//
// ⛔⛔ THIS FILE CLOSES A ONE-WAY PIN. `tests/fixtures/ast/clock_parity.json` was
// RECORDED from `computeClock` and read only by `tests/test_ast_clock_parity.py`,
// so it held PYTHON to a frozen snapshot of JS behaviour while the JS side was
// never re-run against it. The consequence was measurable: dropping `'15'` from
// `CLOCK_INTRADAY_TFS`, or adding `'3'`, changed no committed number that any
// gate compared — the corpus carries `tf: '5'` and `'D'`/`'W'`/`'M'` only, so the
// other four codes and all five NON-codes were asserted in exactly one lane.
//
// ⭐ THE TIMEFRAME LIST IS THE ONE HAND COPY THIS SECTION COULD NOT AVOID.
// `indicators.js` is pinned by `interpret.test.js` as an import-free LEAF, so it
// cannot read the manifest, and the eight codes are literals in each lane. The
// only honest answer to a hand copy is to measure it from both sides — which is
// what this file is.
//
// ⚠️ IT IS THE `selfLag.test.js` IDIOM: the fixture is the authority and both
// lanes are held to it, so a lane that drifts fails against the OTHER LANE'S OWN
// OUTPUT rather than against numbers somebody retyped in a docstring.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { computeClock, CLOCK_COLUMNS } from '../../indicators.js'
import { TABLE } from './parse.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE = path.join(HERE, '..', '..', '..', '..', '..', '..',
  'tests', 'fixtures', 'ast', 'clock_parity.json')

const doc = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))

/** NaN → null, so this lane's columns are comparable to the recorded JSON. */
const clean = (col) => Array.from(col, (v) => (Number.isNaN(v) ? null : v))

const same = (got, want, what) => {
  expect(got.length, `${what}: length`).toBe(want.length)
  for (let i = 0; i < want.length; i++) {
    if (want[i] === null) {
      expect(got[i], `${what} bar ${i}: produced ${got[i]} where the fixture has nothing`).toBe(null)
    } else {
      expect(got[i], `${what} bar ${i}`).not.toBe(null)
      expect(Math.abs(got[i] - want[i]), `${what} bar ${i}: ${got[i]} vs ${want[i]}`).toBeLessThan(1e-9)
    }
  }
}

describe('the clock oracle — this lane against the committed fixture', () => {
  it('the fixture names exactly the columns the manifest declares', () => {
    expect(Object.keys(doc.expected).sort()).toEqual(Object.keys(TABLE.clock).sort())
    expect([...CLOCK_COLUMNS].sort()).toEqual(Object.keys(TABLE.clock).sort())
  })

  it('every column matches bar for bar, across the DST change and the weekend', () => {
    const cols = computeClock(doc.bars, doc.tf)
    for (const name of Object.keys(doc.expected)) {
      same(clean(cols[name]), doc.expected[name], name)
    }
  })

  it('⭐ THE TIMEFRAME VOCABULARY, BOTH DIRECTIONS — every code AND every non-code', () => {
    // ⛔ THE `null` ROWS ARE THE POINT. `3`, `1H`, `2D`, `d` and `""` are not
    // codes this platform ships; a lane guessing from the string's SHAPE would
    // call `3` intraday and `2D` daily with total confidence. Dropping a real
    // code from the list reds the other half of the same block.
    const probes = Object.entries(doc.tf_booleans)
    expect(probes.length).toBeGreaterThanOrEqual(10)
    let answered = 0
    let refused = 0
    for (const [tf, expectedFlags] of probes) {
      const cols = computeClock(doc.bars, tf === '__absent__' ? undefined : tf)
      for (const [flag, want] of Object.entries(expectedFlags)) {
        const got = clean(cols[flag])
        expect(got[0], `tf=${JSON.stringify(tf)} ${flag}`).toBe(want)
        // Flat for the whole column: a timeframe is not a per-bar fact, so a lane
        // that made it one would still agree on bar 0.
        expect(got.every((v) => v === want), `tf=${JSON.stringify(tf)} ${flag} is not flat`).toBe(true)
      }
      if (Object.values(expectedFlags).every((v) => v === null)) refused += 1
      else answered += 1
    }
    // ⚠️ NON-VACUITY, BOTH HALVES: a probe set that was all codes, or all
    // non-codes, would satisfy the loop and measure one direction.
    expect(answered, 'no probe was a shipped code').toBeGreaterThanOrEqual(8)
    expect(refused, 'no probe was an unshipped code').toBeGreaterThanOrEqual(5)
  })

  it('⛔ a series that is not in SECONDS refuses the time columns — and ONLY those', () => {
    const cols = computeClock(doc.non_instant_bars, 'D')
    for (const name of Object.keys(doc.non_instant_expected)) {
      same(clean(cols[name]), doc.non_instant_expected[name], `non-instant ${name}`)
    }
    const blank = Object.entries(doc.non_instant_expected)
      .filter(([, col]) => col.every((v) => v === null)).map(([n]) => n)
    expect(blank.sort()).toEqual(['dayofmonth', 'dayofweek', 'hour', 'minute',
      'month', 'sessionfirst', 'time', 'year'])
  })

  it('⛔ `sessionfirst` is WINDOW-INDEPENDENT — every slice agrees from its second bar', () => {
    // It reads the PREVIOUS bar's ET day, declares `lookback: 1` for it, and is
    // blank on the oldest bar. Before that pad, slicing the series made its new
    // leading bar claim to open a session whether or not it did.
    const full = clean(computeClock(doc.bars, doc.tf).sessionfirst)
    same(full, doc.expected.sessionfirst, 'sessionfirst (full)')
    for (const [cut, want] of Object.entries(doc.sliced_sessionfirst)) {
      const i = Number(cut)
      const got = clean(computeClock(doc.bars.slice(i), doc.tf).sessionfirst)
      same(got, want, `sessionfirst on bars[${i}:]`)
      expect(got[0], `bars[${i}:] fabricated a value on its warm-up bar`).toBe(null)
      expect(got.slice(1), `bars[${i}:] disagrees with the full series`)
        .toEqual(full.slice(i + 1))
    }
    // ⛔ NON-VACUITY: a slice must START inside a session, or this passes on a
    // fixture where the fabricated 1 happened to be correct.
    expect(Object.keys(doc.sliced_sessionfirst).some((c) => full[Number(c) + 1] === 0)).toBe(true)
  })
})

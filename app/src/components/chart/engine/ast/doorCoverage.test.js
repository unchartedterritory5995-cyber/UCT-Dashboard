// app/src/components/chart/engine/ast/doorCoverage.test.js
//
// ─── 🔴 THE RATCHET ON DOOR REACHABILITY ────────────────────────────────────
//
// ⛔⛔ THE PROGRAM WAS FINDING THESE ONE AT A TIME, BY HAND. `hma` shipped and
// nobody wired TC2000's `HAVG` for a day. `pow` and `valuewhen` are declared,
// computed and correct from the native builder and unreachable from the Pine
// door in any spelling. `ta.tr` refuses while bare `tr` works. Every one of
// those was discovered by a human reading a script — which is the manual method
// the owner asked us to get ahead of.
//
// ⭐ THIS MAKES IT MECHANICAL. The engine declares its functions as data, and a
// translator can only emit a name that appears in its own source, so the holes
// fall out of the two artifacts with no corpus, no fixture and no indicator to
// port. `lesson_a_corpus_is_blind_beside_what_it_measures`, answered at the level
// of the whole import program: 75 chosen scripts can only ever measure the names
// those 75 scripts use.
//
// ⛔ AND IT IS A RATCHET, NOT A REPORT. The ceilings below may only ever fall.
// Closing a hole is free; opening one goes red and names it. A measurement that
// nobody is obliged to improve is a dashboard.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { TABLE } from './parse'
import { unreachableNames, holesByDoor, report } from './doorCoverage'

const DIR = path.resolve(process.cwd(), 'src/components/chart/engine/ast')
const src = (f) => fs.readFileSync(path.join(DIR, f), 'utf8')
const SOURCES = {
  pine: src('pine.js'),
  thinkscript: src('thinkscript.js'),
  pcf: src('pcf.js'),
}

const MISSING = unreachableNames(SOURCES)
const HOLES = holesByDoor(SOURCES)

describe('the probe measures something, and can be wrong in only one direction', () => {
  it('⛔⛔ a PLANTED name absent from every door is found', () => {
    // Without this, an always-empty result would satisfy every ceiling below and
    // the ratchet would read as perfect coverage. `lesson_a_gate_that_cannot_fail`.
    const planted = {
      ...TABLE,
      functions: { ...TABLE.functions, zzNoDoorReachesThis: { args: [], argRoles: [] } },
    }
    const m = unreachableNames(SOURCES, planted)
    expect(m.pine).toContain('zzNoDoorReachesThis')
    expect(m.thinkscript).toContain('zzNoDoorReachesThis')
    expect(m.pcf).toContain('zzNoDoorReachesThis')
  })

  it('⛔ a name that IS in a door is not reported absent from it', () => {
    // The other direction of the same control: `sma` is in all three translators,
    // so a probe that reported it missing is broken rather than revealing.
    // ⚰️ THAT IS NOT HYPOTHETICAL — the first version of this probe built its
    // pattern as `` `\b${n}\b` `` inside a TEMPLATE LITERAL, where `\b` is the
    // BACKSPACE CHARACTER. Every pattern was `<BS>sma<BS>`, nothing matched, and
    // the report announced that `sma`, `rsi` and `stdev` were unreachable from
    // every importer. A tool that finds holes must not manufacture them.
    expect(MISSING.pine).not.toContain('sma')
    expect(MISSING.thinkscript).not.toContain('sma')
    expect(MISSING.pcf).not.toContain('sma')
  })

  it('⛔ the match is on a WHOLE WORD — `pow` is not found inside `power`', () => {
    const m = unreachableNames({ fake: 'const power = 1; superstoch()' },
      { functions: { pow: {}, stoch: {}, power: {} } })
    expect(m.fake).toContain('pow')
    expect(m.fake).toContain('stoch')
    expect(m.fake).not.toContain('power')
  })
})

describe('🔴 THE RATCHET — these ceilings may only ever fall', () => {
  // ⛔ CEILINGS, NOT EQUALITIES. An exact count reds this file when somebody
  // CLOSES a hole, which trains the next reader to edit a number instead of
  // reading a win. Lower them when you close one; never raise one.
  //
  // Measured 2026-08-29, the day this probe was written:
  //   63 declared · pine reaches 38 · thinkScript 37 · pcf 42
  //   38 names unreachable through at least one importer
  //   10 unreachable through ALL THREE: avwap, donchianLower/Middle/Upper,
  //      ichimokuChikou/Kijun/SpanA/SpanB/Tenkan, valuewhen
  it('no door may reach FEWER names than it does today', () => {
    const declared = Object.keys(TABLE.functions).length
    expect(declared - MISSING.pine.length).toBeGreaterThanOrEqual(38)
    expect(declared - MISSING.thinkscript.length).toBeGreaterThanOrEqual(37)
    expect(declared - MISSING.pcf.length).toBeGreaterThanOrEqual(42)
  })

  it('the total hole count may only fall', () => {
    expect(HOLES.length).toBeLessThanOrEqual(38)
  })

  it('⛔⛔ and the ten reachable from NO importer are named, not counted', () => {
    // ⭐ A ROSTER BEATS A COUNT. Every one of these is a capability this engine
    // ships, evaluates correctly, and no member can reach by pasting anything —
    // and each is an indicator all three rival platforms have. Naming them is
    // what makes them workable; a number would just sit there.
    const nowhere = HOLES.filter((h) => h.absentFrom.length === 3).map((h) => h.name)
    expect(nowhere.length).toBeLessThanOrEqual(10)
    // The roster is asserted as a SUPERSET check so closing any one is green:
    // every name still unreachable must be one we already knew about.
    const KNOWN = [
      'avwap', 'donchianLower', 'donchianMiddle', 'donchianUpper',
      'ichimokuChikou', 'ichimokuKijun', 'ichimokuSpanA', 'ichimokuSpanB',
      'ichimokuTenkan', 'valuewhen',
    ]
    for (const n of nowhere) {
      expect(KNOWN, `${n} became unreachable from every door — a REGRESSION`)
        .toContain(n)
    }
  })

  it('⭐ the report leads with its denominator', () => {
    const r = report(SOURCES)
    expect(r.line).toMatch(/^63 declared/)
    expect(r.line).toContain('pine reaches')
  })
})

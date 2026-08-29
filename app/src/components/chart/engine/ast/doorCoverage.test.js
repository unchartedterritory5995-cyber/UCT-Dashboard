// app/src/components/chart/engine/ast/doorCoverage.test.js
//
// ─── 🔴 THE RATCHET ON DOOR REACHABILITY ────────────────────────────────────
//
// ⛔⛔ THE PROGRAM WAS FINDING THESE ONE AT A TIME, BY HAND. `hma` shipped and
// nobody wired TC2000's `HAVG` for a day. `pow` and `valuewhen` are declared,
// computed and correct from the native builder, and no member can reach either
// by pasting Pine. Every one was found by a human reading a script — the manual
// method that was supposed to come AFTER the infrastructure, not instead of it.
//
// ⭐ THIS MAKES IT MECHANICAL, and each door is measured by the method that is
// VALID FOR IT — which took three tries to get right and both wrong versions are
// railed below so they cannot come back:
//   • PINE is PROBED, because Pine v3/v4 uses bare names that coincide with ours
//     and its resolver looks names up in the TABLE generically.
//   • THINKSCRIPT and TC2000 are READ off their own published maps
//     (`TS_CALL_SHAPES.engine`, `PCF_FUSED.fn`, `PCF_CALLS.fn`), because they
//     spell `ema` as `MovAvgExponential` and `XAVGC` — probing them with OUR
//     spelling asks whether they accept a language they do not speak.
//
// ⛔ IT IS A RATCHET, NOT A REPORT. The ceilings may only ever fall. A
// measurement nobody is obliged to improve is a dashboard.

import { describe, it, expect } from 'vitest'

import { TABLE, parseFormula } from './parse'
import { translatePine } from './pine'
import { TS_CALL_SHAPES } from './thinkscript'
import { PCF_FUSED, PCF_CALLS } from './pcf'
import {
  functionReachability, report, nameHoles, adapterGaps,
  mappedFunctions, unmappedFor,
} from './doorCoverage'

const ROWS = functionReachability({
  native: (s) => ({ result: parseFormula(s) }),
  pine: translatePine,
})
const TS_REACH = mappedFunctions(TS_CALL_SHAPES)
const PCF_REACH = mappedFunctions(PCF_FUSED, PCF_CALLS)
const DECLARED = Object.keys(TABLE.functions).length

describe('the probe measures something, and cannot manufacture a hole', () => {
  it('⛔⛔ EVERY declared function is reachable NATIVELY — the probe is well-formed', () => {
    // ⭐ THE PRECONDITION FOR EVERY OTHER NUMBER HERE. If our own box refused one
    // of these calls, the probe would be building an invalid expression and every
    // "unreachable" verdict downstream would be about the probe, not the door.
    const bad = ROWS.filter((r) => r.native.status !== 'reachable')
      .map((r) => `${r.call} [${r.native.guard}]`)
    expect(bad, 'the probe built a call this engine itself refuses').toEqual([])
  })

  it('⚰️ SOURCE-ABSENCE IS NOT A VALID TEST, and this is the counterexample', () => {
    // ⛔ A PREVIOUS VERSION OF THIS FILE SHIPPED ON THE PREMISE that "a translator
    // can only emit a name that appears in its own source, so absence PROVES
    // unreachability". It reported 38 holes. THE PREMISE IS FALSE: these names
    // appear NOWHERE in `pine.js` and every one translates, because the resolver
    // consults the TABLE rather than naming them — which is the entire point of a
    // closed manifest. Six of that version's 38 "holes" were not holes.
    // This case exists so nobody rebuilds it that way.
    const byName = Object.fromEntries(ROWS.map((r) => [r.name, r]))
    for (const n of ['cos', 'sin', 'tan', 'exp', 'log10', 'rma']) {
      expect(byName[n].pine.status, `${n} should translate from Pine`).toBe('reachable')
    }
  })

  it('⛔ a refusal about the CALL is not a refusal about the NAME', () => {
    // The distinction the previous version collapsed. `valuewhen` refuses with
    // `pine:role-order` — the door KNOWS the name and could not map our argument
    // list. Reporting that as "Pine has never heard of valuewhen" sends somebody
    // to add a name that is already there.
    const vw = ROWS.find((r) => r.name === 'valuewhen')
    expect(vw.pine.status).toBe('call-unmapped')
    expect(vw.pine.guard).toMatch(/role-order|arity/)
  })

  it('⛔ the map reader finds a PLANTED mapping, and ignores a shapeless entry', () => {
    // Without this an always-empty reader satisfies every ceiling below.
    // ⚰️ AND IT ALREADY FAILED ONCE THE OTHER WAY: reading only `fn` reported
    // thinkScript at 0/63 because `TS_CALL_SHAPES` names the field `engine`.
    expect(mappedFunctions({ a: { fn: 'zzPlantedFn' } }).has('zzPlantedFn')).toBe(true)
    expect(mappedFunctions({ a: { engine: 'zzPlantedEngine' } }).has('zzPlantedEngine')).toBe(true)
    expect(mappedFunctions({ a: { nothing: 1 }, b: null, c: 7 }).size).toBe(0)
  })
})

describe('🔴 THE RATCHET — these ceilings may only ever fall', () => {
  // Measured 2026-08-29, by the methods above:
  //   63 declared
  //   PINE  reaches 43 · 0 names it does not know · 20 known-but-unmapped
  //   THINKSCRIPT maps reach 21 · TC2000 maps reach 33
  // ⛔ CEILINGS, NOT EQUALITIES. An exact count reds this file when somebody
  // CLOSES a hole, which trains the next reader to edit a number instead of
  // reading a win. Lower them when you close one; never raise one.

  it('Pine may not reach fewer names than it does today', () => {
    const reach = ROWS.filter((r) => r.pine.status === 'reachable').length
    expect(reach).toBeGreaterThanOrEqual(43)
  })

  it('⭐ Pine KNOWS every declared name — no name-hole may ever appear', () => {
    // A genuinely strong property, and worth pinning as an equality rather than a
    // ceiling: there is no declared function Pine's door has never heard of. Every
    // remaining Pine gap is a SIGNATURE question, which is a different and much
    // cheaper kind of work than teaching a door a new name.
    expect(nameHoles(ROWS).filter((h) => h.absentFrom.includes('pine'))).toEqual([])
  })

  it('the name-mapping doors may not map fewer names than they do today', () => {
    expect(TS_REACH.size).toBeGreaterThanOrEqual(21)
    expect(PCF_REACH.size).toBeGreaterThanOrEqual(33)
  })

  it('the Pine adapter-gap roster may only shrink', () => {
    expect(adapterGaps(ROWS).length).toBeLessThanOrEqual(20)
  })

  it('⛔⛔ the names NO door reaches are NAMED, not counted', () => {
    // ⭐ A ROSTER BEATS A COUNT. These are capabilities the engine ships and
    // evaluates correctly that a member cannot reach from ANY of the three
    // languages — and every one is an indicator all three rival platforms have.
    // Naming them is what makes them workable.
    const pineOut = new Set(ROWS.filter((r) => r.pine.status !== 'reachable').map((r) => r.name))
    const nowhere = Object.keys(TABLE.functions)
      .filter((n) => pineOut.has(n) && !TS_REACH.has(n) && !PCF_REACH.has(n))
      .sort()
    const KNOWN = [
      'avwap', 'donchianLower', 'donchianMiddle', 'donchianUpper',
      'ichimokuChikou', 'ichimokuKijun', 'ichimokuSpanA', 'ichimokuSpanB',
      'ichimokuTenkan', 'idiv', 'mfi', 'mod', 'valuewhen', 'williamsR',
    ]
    // A SUPERSET check, so closing any one is green while a NEW name falling out
    // of every door is a named regression.
    for (const n of nowhere) {
      expect(KNOWN, `${n} is now unreachable from every door — a REGRESSION`).toContain(n)
    }
    expect(nowhere.length).toBeLessThanOrEqual(KNOWN.length)
  })

  it('⭐ the report leads with its denominator', () => {
    const r = report(ROWS)
    expect(r.line).toMatch(new RegExp(`^${DECLARED} declared`))
    expect(r.line).toContain('reachable:')
  })
})

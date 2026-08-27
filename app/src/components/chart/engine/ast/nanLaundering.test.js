/** X23, IN THE OTHER LANE — a comparison launders a hole into a confident answer.
 *
 *  🔴 THE TWO OPERATORS DISAGREE ABOUT WHAT NaN MEANS, AND THEY ARE ADJACENT IN
 *  ONE TABLE. `cmp` collapses NaN to 0 (*"A COMPARISON AGAINST NaN IS 0, NOT
 *  NaN … the one place JS and Python agree by luck"*), while `logical`
 *  propagates it (*"NaN PROPAGATES THROUGH `&&`, `||`, `!` AND `?:`"*). Both are
 *  deliberate, both are documented, and the pair invites one reading this file
 *  exists to settle by CONSTRUCTION rather than by argument:
 *
 *      is `logical`'s NaN branch reachable at all, given that a scan tree
 *      almost always reaches it THROUGH a comparison that has already
 *      destroyed the NaN?
 *
 *  ⭐ IT IS REACHABLE — but only through an operand that is NOT a comparison,
 *  which is not the spelling a member writes. So the honesty is real and the
 *  path that matters bypasses it, which is a narrower and sharper statement than
 *  "a branch that cannot fire".
 *
 *  ⚠️ THE PYTHON LANE OWNS THE FIX AND THIS LANE OWES NO TWIN. The remedy is a
 *  question asked BEFORE evaluating (`ast_interpret.unresolved_inputs`), and its
 *  consumer is the server-side universe sweep, which owes a member a COVERAGE
 *  RECEIPT. A browser evaluates ONE symbol, holds its own bars, and draws a hole
 *  as a gap in the line — there is no receipt here to protect. That asymmetry is
 *  DECLARED in `unresolved_scalars`'s own docstring ("PYTHON-ONLY, DECLARED
 *  RATHER THAN FORGOTTEN") and the last test in this file keeps it true from
 *  this side.
 */
import { describe, it, expect } from 'vitest'

import { interpret } from './interpret.js'
import { BAR_READERS } from './parse.js'
import TABLE from './closedTable.json'

const SER = (name) => ({ type: 'series', name })
const NUM = (value) => ({ type: 'num', value })
const OP = (name, ...args) => ({ type: 'op', name, args })
const CALL = (name, ...args) => ({ type: 'call', name, args })

/** The bar shape the SERVER's nightly sweep hands the walker for `tf="D"`:
 *  `bars_sqlite` stores a daily `ts` as a `YYYYMMDD` int, which is below
 *  `VWAP_MIN_INSTANT` and is refused as a unit error. */
const dailyBars = (n = 8) => Array.from({ length: n }, (_, i) => ({
  t: 20260601 + i, o: 10, h: 11, l: 9, c: 10 + i, v: 100 + i,
}))

/** Bars whose `t` is a REAL instant, crossing an ET session boundary.
 *  ⚠️ TWO ET DAYS DELIBERATELY — a session accumulator does not answer for bars
 *  whose boundary is not visible in the series, so a one-day control would agree
 *  with its subject for the wrong reason. */
const instantBars = (n = 120) => Array.from({ length: n }, (_, i) => {
  const c = 10 + i * 0.25
  return { t: 1781046000 + i * 300, o: c, h: c + 1, l: c - 1, c, v: 1000 }
})

const VWAP = CALL('vwap')
const GT = OP('>', SER('close'), VWAP)
/** One column, NORMALISED to a plain array with `null` for a hole.
 *
 *  ⚠️ THIS LANE RETURNS A `Float64Array` AND SPELLS A HOLE `NaN`; the Python
 *  lane returns a list and spells it `None`. That is a real difference in the
 *  CARRIER, not in the answer -- `tools/ast_conformance.py::run_py` performs the
 *  same normalisation before every cross-lane digest -- and writing the
 *  assertions against the raw carrier would make this file about JavaScript's
 *  typed arrays instead of about the NaN rule. */
const run = (ast, bars, tf) => Array.from(
  interpret(ast, bars, undefined, undefined, undefined, { tf }),
  (v) => (typeof v === 'number' && Number.isNaN(v) ? null : v))

describe('a comparison launders a bar reader hole — both polarities', () => {
  it('answers a confident NO for every bar, and a confident YES when negated', () => {
    const bars = dailyBars()

    // The hole is REAL and visible at the leaf.
    expect(run(VWAP, bars, 'D')).toEqual(bars.map(() => null))

    // …and invisible one node up, in BOTH directions. A rail on one is half a
    // rail: `>` is the screen that finds NOTHING, `!`/`||` is the screen that
    // finds EVERYTHING, and a member cannot tell either from a real result.
    expect(run(GT, bars, 'D')).toEqual(bars.map(() => 0))
    expect(run(OP('!', GT), bars, 'D')).toEqual(bars.map(() => 1))
    expect(run(OP('||', GT, OP('>', SER('volume'), NUM(1))), bars, 'D'))
      .toEqual(bars.map(() => 1))
  })

  it('CONTROL: the same trees answer with real variety on bars that CAN be computed', () => {
    // Without this the block above is satisfied by a fixture that simply never
    // computes anything, which proves nothing about the laundering.
    const live = instantBars()
    expect(run(VWAP, live, '5').some((v) => typeof v === 'number')).toBe(true)
    expect(new Set(run(GT, live, '5'))).not.toEqual(new Set([0]))
  })
})

describe("logical's NaN branch — reachable, but not by the path that matters", () => {
  it('fires when an operand is NOT a comparison', () => {
    const bars = dailyBars()
    // `&&` declares `yields: "bool"` whatever its operands are (see
    // `closedTable.json::operators`), so this is a legal, savable scan.
    expect(TABLE.operators['&&'].yields).toBe('bool')
    expect(run(OP('&&', VWAP, OP('>', SER('volume'), NUM(1))), bars, 'D'))
      .toEqual(bars.map(() => null))
    expect(run(OP('!', VWAP), bars, 'D')).toEqual(bars.map(() => null))
    expect(run({ type: 'op', name: '?:', args: [VWAP, NUM(1), NUM(0)] }, bars, 'D'))
      .toEqual(bars.map(() => null))
  })

  it('does NOT fire when it is reached through a comparison — which is how members write it', () => {
    const bars = dailyBars()
    // `close > vwap() && volume > 1` — both operands are comparisons, `cmp` has
    // already turned the hole into 0, and `logical` never sees a NaN to be
    // honest about. Same question, two spellings, two different receipts.
    expect(run(OP('&&', GT, OP('>', SER('volume'), NUM(1))), bars, 'D'))
      .toEqual(bars.map(() => 0))
  })
})

describe('EVERY declared bar reader — DERIVED from closedTable.json', () => {
  /** A legal call's arguments, read off the entry's OWN declaration.
   *  ⛔ NO HAND LIST: a third `reads: "bars"` entry is exercised the day it
   *  lands. A future `int` role that is neither an anchor nor a window fails
   *  here BY NAME rather than being skipped. */
  const argsFor = (name, spec, anchor) => spec.args.map((kind, i) => {
    const role = String(spec.argRoles[i]).toLowerCase()
    if (kind === 'series') return SER('close')
    if (kind === 'int' && role.includes('anchor')) return NUM(anchor)
    if (kind === 'int') return NUM(5)
    throw new Error(
      `${name} declares argument ${i} as ${kind} (role ${role}); this rail has `
      + 'no recipe for it, and a bar reader with no case is an entry whose hole '
      + 'nothing measures')
  })

  /** The bar sets that can put a `reads: "bars"` entry into a hole.
   *
   *  ⛔ NOT ONE FIXTURE, AND NOT A PER-NAME MAP. Both kinds of hole are declared
   *  in the manifest and neither is a property of a NAME: an instant-anchored
   *  entry (`lookback: "session"`) holes when the bars carry no real instant,
   *  and a windowed entry holes on a series shorter than its window. A third
   *  entry of EITHER kind is covered the day it lands; a fourth KIND fails by
   *  name below rather than being skipped. */
  const holeFixtures = (met) => ({
    "the server's daily bar shape — `t` is a YYYYMMDD int, not an instant":
      dailyBars(met.length),
    "a series shorter than the entry's own declared window": met.slice(0, 2),
  })

  it('is laundered wherever it holes, and computable where it does not', () => {
    // NON-VACUITY, as a floor rather than an assumption.
    expect(BAR_READERS.length).toBeGreaterThanOrEqual(2)

    const met = instantBars()
    const anchor = met[1].t

    const swept = []
    for (const name of BAR_READERS) {
      const node = CALL(name, ...argsFor(name, TABLE.functions[name], anchor))

      // (a) the entry CAN compute — so (b) is about the bars, not the fixture.
      expect(run(node, met, '5').some((v) => typeof v === 'number')).toBe(true)

      // (b) …and wherever it holes, the comparison launders that hole into a
      //     confident 0. ⛔ ROT CONTROL: if no fixture can hole it any more, or
      //     the laundering stops, THIS GOES RED naming it rather than continuing
      //     to prove a defect that no longer exists.
      const holed = []
      for (const [why, sample] of Object.entries(holeFixtures(met))) {
        const own = run(node, sample, 'D')
        if (own[own.length - 1] !== null) continue
        const laundered = run(OP('>', SER('close'), node), sample, 'D')
        expect(laundered[laundered.length - 1],
          `${name}: with ${why}, its hole is no longer laundered into a confident 0`)
          .toBe(0)
        holed.push(why)
      }
      expect(holed.length,
        `${name} declares reads:'bars' and no fixture here can hole it any more `
        + '— either its holes are gone (say so deliberately) or it holes for a '
        + 'THIRD reason nothing here models')
        .toBeGreaterThan(0)
      swept.push(name)
    }
    expect(swept).toEqual([...BAR_READERS])
  })
})

describe('the declared asymmetry between the lanes', () => {
  it('this lane has NO unresolved-inputs twin, deliberately', async () => {
    // ⛔ CHECKED, NOT RESTATED. `unresolved_scalars` declares itself PYTHON-ONLY
    // because a browser has no coverage receipt to protect; widening it to
    // `unresolved_inputs` had to keep that declaration TRUE. If this lane ever
    // grows a twin, either it has a real consumer — and the Python docstring is
    // now FALSE and must be corrected — or it is dead code.
    const mod = await import('./interpret.js')
    const twins = Object.keys(mod).filter((k) => /^unresolved/i.test(k))
    expect(twins).toEqual([])
  })
})

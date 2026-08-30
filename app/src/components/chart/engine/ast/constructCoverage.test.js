// app/src/components/chart/engine/ast/constructCoverage.test.js
//
// ─── 🔴 WHICH LANGUAGE CONSTRUCTS REACH THIS ENGINE, MEASURED ON REAL CODE ───
//
// ⛔⛔ `doorCoverage` ANSWERS THIS FOR FUNCTION NAMES AND NOTHING ANSWERS IT FOR
// CONSTRUCTS. A member does not paste `sma`; they paste a script that carries
// persistent state, a higher-timeframe read, a helper function and a loop. Which
// of those SHAPES each door can take was being discovered one script at a time, by
// hand — the same complaint `doorCoverage`'s own header makes, one level up.
//
// ⚰️ AND THE OBVIOUS WAY TO BUILD THIS IS WRONG. The first attempt wrote a minimal
// script per construct per door and asked whether it translated. It reported that
// Pine cannot take a lag-1 recurrence — which is FALSE: `s := 0.5 * s + close`
// folds to `accum(0, 0.5 * self + close, 250)` today. The hand-written probe used
// `nz(s[1], 0)`, a spelling the door reads differently, so the measurement was of
// THE PROBE. It also reported if-chain folding as a thinkScript gap, and
// thinkScript folds `if/then/else` blocks to a ternary today. Both doors are
// SHAPE-SENSITIVE, which is exactly why `doorCoverage` had to be rebuilt twice.
//
// ⭐⭐ SO EVERY NUMBER HERE COMES OFF THE COMMITTED CORPORA — real scripts, written
// by other people, in their own idioms. Detection is per DIALECT (Pine spells it
// `request.security`, thinkorswim spells it `AggregationPeriod`), and the verdict
// is the DOOR'S OWN, never a re-derivation.
//
// ⚠️ AND ATTRIBUTION IS DELIBERATELY WEAK, BECAUSE HONEST. A script carries several
// constructs, so "scripts using X that refuse" is NOT "X is why they refused". The
// guard roster beside each row is what carries the causal claim, and it is the
// door's own guard. A single number here would be a stronger claim than the method
// can support (`lesson_an_audit_is_where_to_look_not_what_to_trust`).

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { translatePine } from './pine.js'
import { translateThinkScript } from './thinkscript.js'

const dir = (p) => path.resolve(process.cwd(), p)

const CORPORA = [
  { lang: 'pine', dir: '../tests/fixtures/pine', ext: '.pine', translate: translatePine },
  { lang: 'pine', dir: '../tests/fixtures/pine_community', ext: '.pine', translate: translatePine },
  { lang: 'thinkscript', dir: '../tests/fixtures/thinkscript', ext: '.ts', translate: translateThinkScript },
]

/** One construct, spelled per dialect. ⛔ A construct with no pattern for a dialect
 *  is NOT counted there — an absent spelling is "we did not look", never "zero". */
const CONSTRUCTS = [
  { name: 'higher-timeframe',
    pine: /request\.security|[^.\w]security\s*\(/,
    thinkscript: /AggregationPeriod|GetAggregationPeriod/ },
  { name: 'persistent-state',
    pine: /(^|\n)\s*var(ip)?\s+\w|:=/,
    thinkscript: /CompoundValue|(^|\n)\s*rec\s+\w/ },
  { name: 'user-defined-fn',
    pine: /(^|\n)\s*\w+\s*\([^)]*\)\s*=>/,
    thinkscript: /(^|\n)\s*script\s+\w+/ },
  { name: 'bounded-loop',
    pine: /(^|\n)\s*for\s+\w+\s*=|(^|\n)\s*while\s/,
    thinkscript: /\bfold\s+\w+\s*=/ },
  { name: 'collections',
    pine: /\barray\.|\bmatrix\.|\bmap\./,
    thinkscript: null },
  { name: 'drawing-objects',
    pine: /\b(box|line|label|table|polyline)\.new\b/,
    thinkscript: /\bAddChartBubble\b|\bAddCloud\b/ },
  { name: 'session-clock',
    pine: /[^.\w]time\s*\(|\btimestamp\s*\(/,
    thinkscript: /GetTime\b|SecondsFromTime|SecondsTillTime|RegularTrading/ },
  { name: 'type-cast',
    pine: /(^|[^.\w])(int|float|bool)\s*\(/,
    thinkscript: null },
  { name: 'other-symbol',
    pine: /request\.security\s*\(\s*["']|ticker\.new/,
    thinkscript: /close\s*\(\s*"|\bopen\s*\(\s*"/ },
]

/** Every corpus file, with the door's own verdict and the constructs it carries. */
const SCRIPTS = CORPORA.flatMap(({ lang, dir: d, ext, translate }) =>
  fs.readdirSync(dir(d)).filter((f) => f.endsWith(ext)).sort().map((f) => {
    const src = fs.readFileSync(path.join(dir(d), f), 'utf8')
    let out
    try { out = translate(src) } catch (e) { out = { ok: false, refusal: { guard: 'THREW' } } }
    return {
      file: f,
      lang,
      ok: !!out.ok,
      guard: out.ok ? null : ((out.refusal && out.refusal.guard) || 'unknown'),
      uses: CONSTRUCTS.filter((c) => c[lang] && c[lang].test(src)).map((c) => c.name),
    }
  }))

/** For one construct: who uses it, who gets through, and what stops the rest. */
function row(name) {
  const using = SCRIPTS.filter((s) => s.uses.includes(name))
  const ok = using.filter((s) => s.ok)
  const guards = {}
  for (const s of using.filter((x) => !x.ok)) guards[s.guard] = (guards[s.guard] || 0) + 1
  return { name, uses: using.length, translates: ok.length, guards }
}

const ROWS = CONSTRUCTS.map((c) => row(c.name))

describe('the measurement is real before any number is read off it', () => {
  it('⛔ the corpora are there and the doors answered', () => {
    // Without this a moved fixture directory leaves every row 0/0 and every
    // ceiling below satisfied forever.
    expect(SCRIPTS.length).toBeGreaterThanOrEqual(70)
    expect(SCRIPTS.filter((s) => s.ok).length).toBeGreaterThan(20)
    expect(SCRIPTS.filter((s) => !s.ok).length).toBeGreaterThan(10)
  })

  it('⛔ no script THREW — a door that throws is not refusing, it is broken', () => {
    expect(SCRIPTS.filter((s) => s.guard === 'THREW').map((s) => s.file)).toEqual([])
  })

  it('⛔ detection found something for every construct that claims a spelling', () => {
    // ⚰️ A REGEX THAT MATCHES NOTHING IS INDISTINGUISHABLE FROM A CONSTRUCT NOBODY
    // USES, and both read as "covered". This is the control that tells them apart.
    const dead = ROWS.filter((r) => r.uses === 0).map((r) => r.name)
    expect(dead, 'these patterns matched no real script — the pattern is wrong, or '
      + 'the construct is genuinely absent and should be deleted from the list').toEqual([])
  })

  it('⭐ the report is readable, and prints itself', () => {
    const lines = ROWS
      .slice()
      .sort((a, b) => (b.uses - b.translates) - (a.uses - a.translates))
      .map((r) => {
        const gaps = Object.entries(r.guards).sort((a, b) => b[1] - a[1])
          .map(([g, n]) => `${g}×${n}`).join(' ')
        return `${r.name.padEnd(18)} ${String(r.translates).padStart(2)}/${String(r.uses).padEnd(3)} `
          + `translate   ${gaps}`
      })
    console.log(`\n${SCRIPTS.filter((s) => s.ok).length}/${SCRIPTS.length} scripts translate\n`
      + `${lines.join('\n')}\n`)
    expect(lines.length).toBe(CONSTRUCTS.length)
  })
})

describe('🔴 THE RATCHET — a construct may only ever reach FURTHER', () => {
  // ⛔ FLOORS, NOT EQUALITIES. An exact count reds this file when somebody makes a
  // construct reach further, which trains the next reader to edit a number instead
  // of reading a win. Raise one when you close a gap; never lower one.
  //
  // ⚰️ THESE WERE TYPED FROM JUDGEMENT ON THE FIRST DRAFT AND SEVEN OF THE NINE
  // WERE WRONG — `higher-timeframe` was guessed at 15 and measures 9. An acceptance
  // number is a forecast until it is derived, and a forecast committed as a gate
  // reds the build for the author rather than for a regression
  // (`lesson_an_acceptance_number_is_a_forecast_until_derived`). Every value below
  // is now READ OFF the run above, with the denominator beside it so the ratio is
  // legible without recomputing it.
  const FLOOR = {
    'higher-timeframe': 9,     // of 22 that use it
    'persistent-state': 14,    // of 29 that use it
    'user-defined-fn': 11,    // of 24 that use it
    'bounded-loop': 5,     // of 13 that use it
    collections: 4,     // of 10 that use it
    'drawing-objects': 7,     // of 23 that use it
    'session-clock': 1,     // of 7 that use it
    'type-cast': 0,     // of 5 that use it
    'other-symbol': 0,     // of 2 that use it
  }

  for (const name of Object.keys(FLOOR)) {
    it(`${name} reaches at least ${FLOOR[name]} scripts`, () => {
      const r = ROWS.find((x) => x.name === name)
      expect(r, `${name} vanished from the construct list`).toBeTruthy()
      expect(r.translates).toBeGreaterThanOrEqual(FLOOR[name])
    })
  }

  it('⛔ every floor names a construct that is actually measured', () => {
    // A floor for a construct nobody detects is a gate that cannot fail.
    expect(Object.keys(FLOOR).sort()).toEqual(CONSTRUCTS.map((c) => c.name).sort())
  })
})

// 🔴 THE thinkScript DOOR'S VOCABULARY RAILS.
//
// ⭐ THE REFUSAL SET IS THE PRODUCT HERE. This module translates nothing yet —
// what it ships today is a CLOSED list of the reasons it may ever say no, each
// one a sentence no other door in this engine says. That is not decoration: a
// guard that shares a phrase with another guard lets a `toThrow(/…/)` keep
// passing with the safety it was watching deleted, and every gate in this repo
// that checks a refusal checks it by its words.
//
// ⛔ AND IT IS CLOSED IN TWO PLACES THAT FAIL DIFFERENTLY, ON PURPOSE. The
// source sweep below catches a guard string typed into this module that the
// table does not declare; the constructor check catches one arriving from
// ANOTHER module at runtime, which no regex over this file could ever see.
// `REFUSALS` stays the single authority — both rails read it.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import {
  translateThinkScript, lexThinkScript, readStatements, ThinkScriptRefusal,
  TS_STATE_WARMUP, TS_CALL_SHAPES, TS_WORD_OPERATORS, TS_PRECEDENCE,
  TS_UNCITED, argumentPlan,
  REFUSALS as TS, NOTES as TS_NOTES,
} from './thinkscript.js'
import { REFUSALS as PINE, printFormula } from './pine.js'
import { PCF_REFUSALS as PCF } from './pcf.js'
import { TABLE, parseFormula, astHash, REFUSALS as PARSE } from './parse.js'
import { REFUSALS as INTERPRET, interpret } from './interpret.js'
import { REFUSALS as BUDGET } from './budget.js'
import { REFUSALS as SENTENCE } from './sentence.js'

/** ⚠️ `new URL('./thinkscript.js', import.meta.url)` DOES NOT WORK HERE — under
 *  Vite `import.meta.url` is an `http://` URL and `readFileSync` rejects it
 *  ("The URL must be of scheme file"). Vitest runs from `app/`, which is the
 *  same anchor `pine.corpus.test.js` resolves its fixtures from. */
const MODULE_PATH = path.resolve(process.cwd(), 'src/components/chart/engine/ast/thinkscript.js')

/** ⛔ THE SWEEPS BELOW READ CODE, NOT PROSE. `thinkscript.js` explains its own
 *  guards at length — including, since W3.3, the shape of a COMPUTED one — and a
 *  sweep that counted a comment would report a guard nothing emits and, worse,
 *  would go red for a paragraph that documents the very hole it is watching.
 *  ⚠️ Deliberately naive (block comments, and lines that BEGIN with `//`), which
 *  is exactly the comment vocabulary this module uses; the control in each sweep
 *  is what proves the stripping did not eat the code as well. */
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')

const readSource = () => stripComments(fs.readFileSync(MODULE_PATH, 'utf8'))

const OTHER_DOORS = [['pine', PINE], ['pcf', PCF], ['parse', PARSE],
  ['interpret', INTERPRET], ['budget', BUDGET], ['sentence', SENTENCE]]

/** ⭐ THE MEASURED REACHABLE SET — TWENTY-TWO of the twenty-nine after W3.4.
 *  Typed ONCE and read by the two tests that partition the table, so
 *  "reachable", "written but unreachable" and "not written at all" can never
 *  overlap or leave a guard in none of the three.
 *
 *  ⚠️ `:roundtrip` LEFT THIS SET IN FIX ROUND 1 and that is a gain, not a loss:
 *  its only reachable case was a chained offset, which now refuses
 *  `:offset-chained` at the bracket instead of being discovered by a failed
 *  round trip that could only name the output. It is pinned as written-and-
 *  unreachable below, beside `:study-ref` — which went the other way, and is
 *  reachable now that `reference` is read.
 *
 *  ⏳ W3.4 ADDED THREE — `:arity`, `:named-argument` and `:window`, the three
 *  the W3.3 partition named as "the call-shape guards that need the function
 *  map". They are here because the map's MECHANISM landed with the expressions;
 *  the map itself is still W3.5's. */
const REACHABLE = [
  'thinkscript:arity', 'thinkscript:block', 'thinkscript:builtin', 'thinkscript:character',
  'thinkscript:cycle', 'thinkscript:empty', 'thinkscript:enum-arm', 'thinkscript:fold',
  'thinkscript:function', 'thinkscript:future-offset', 'thinkscript:input-kind',
  'thinkscript:named-argument', 'thinkscript:no-output',
  'thinkscript:offset-chained', 'thinkscript:offset-literal', 'thinkscript:state',
  'thinkscript:statement', 'thinkscript:study-ref', 'thinkscript:syntax',
  'thinkscript:type', 'thinkscript:undefined', 'thinkscript:window',
]

/** The sentence for a guard, read from the one authority rather than retyped —
 *  a rail that quotes a message it typed itself is checking its own spelling. */
const REFUSALS_TEXT = (g) => TS[g]

describe('the refusal vocabulary', () => {
  it('every pair INVOLVING a thinkscript guard is disjoint, in both directions', () => {
    // ⛔ EVERY PAIR THAT TOUCHES THIS DOOR, over the union of all SIX declared
    // tables — the widest this repo has compared. Two gates sharing a phrase let
    // a `toThrow(/…/)` pass with the safety deleted.
    // ⚠️ SCOPED TO PAIRS INVOLVING `thinkscript:` deliberately. W3.2's probe
    // measured the other 81 sentences against each other and found ZERO
    // collisions, so nothing is being absorbed here — but the scoping stays,
    // because a collision between two doors this lane does not own is a finding
    // to report, never a rail this lane quietly starts enforcing.
    // ⭐ THE NOTES JOIN THE SWEEP. `ignored[]` carries sentences a member reads
    // beside refusals, and a note whose words are a refusal's words lets a gate
    // that matches on words pass with the refusal deleted — the same failure,
    // one table over.
    const others = OTHER_DOORS
      .flatMap(([d, t]) => Object.entries(t).map(([g, text]) => ({ address: `${d}:${g}`, text })))
    const mine = [...Object.entries(TS), ...Object.entries(TS_NOTES)]
      .map(([g, text]) => ({ address: g, text }))
    const collisions = []
    for (const a of mine) {
      for (const b of [...others, ...mine]) {
        if (a.address === b.address) continue
        if (a.text === b.text || a.text.includes(b.text) || b.text.includes(a.text)) {
          collisions.push(`${a.address} <-> ${b.address}`)
        }
      }
    }
    expect(collisions).toEqual([])
    // ⚠️ FLOORS, NOT COUNTS. These two exist so the sweep above cannot pass by
    // comparing nothing — a typed total beside a table another lane is still
    // growing goes red for the table growing correctly.
    expect(others.length, 'a disjointness sweep with no other door is not a sweep').toBeGreaterThan(40)
    expect(mine.length, 'a disjointness sweep with no thinkscript guard is not a sweep').toBeGreaterThan(20)
  })

  it('every guard is namespaced, declared, and says something', () => {
    for (const [guard, text] of Object.entries(TS)) {
      expect(guard.startsWith('thinkscript:'), guard).toBe(true)
      expect(guard.startsWith('thinkscript:note-'), `${guard} is a NOTE code, not a guard`).toBe(false)
      expect(typeof text, guard).toBe('string')
      expect(text.length, guard).toBeGreaterThan(20)
    }
    // ⭐ AND THE `note-` PREFIX IS THE CONTRACT, not a naming habit: it is what
    // lets the source sweep below tell a note from a guard without a second
    // hand-typed list of which is which.
    for (const [code, text] of Object.entries(TS_NOTES)) {
      expect(code.startsWith('thinkscript:note-'), code).toBe(true)
      expect(text.length, code).toBeGreaterThan(20)
    }
  })

  it('the table is frozen, so a caller cannot edit the reasons out from under a rail', () => {
    expect(Object.isFrozen(TS)).toBe(true)
    expect(Object.isFrozen(TS_NOTES)).toBe(true)
  })

  it('the set is CLOSED — every guard string in the module is one a table declares', () => {
    // Derived from the module's own source: no `thinkscript:` string may appear
    // in `thinkscript.js` that `REFUSALS` or `NOTES` does not declare.
    const src = readSource()
    const emitted = new Set([...src.matchAll(/'(thinkscript:[a-z-]+)'/g)].map((m) => m[1]))
    const declared = { ...TS, ...TS_NOTES }
    expect([...emitted].filter((g) => !(g in declared))).toEqual([])
    // ⛔ NON-VACUITY, DERIVED FROM THE AUTHORITY RATHER THAN TYPED. A bad path
    // or a broken regex yields an empty set; this says the sweep found the whole
    // declared table. ⚠️ It replaces `emitted.size > 15`, which LOOKED like a
    // floor and was not: the table's own quoted keys satisfied it on their own.
    expect([...emitted].sort()).toEqual(Object.keys(declared).sort())
  })

  it('⭐⭐ …and a COMPUTED guard is SEEN — the W3.2 blindness, closed the only way it can be', () => {
    // ⛔⛔ THE INHERITED ⏳ SAID "WIDEN THE SOURCE SWEEP TO MATCH
    // `` `thinkscript:${…}` `` TOO, OR IT SHIPS BLIND". Widening it to MATCH one
    // would still not CHECK it: a regex can read the prefix and can never read
    // `kind`, so a computed guard the table does not declare would pass a wider
    // sweep exactly as it passes the narrow one. W3.2 measured that twice — it
    // planted this very shape and every rail stayed green.
    //
    // ⭐ SO THE SWEEP DETECTS THEM AND PINS THE SET, MEASURED EMPTY. This task
    // writes every guard as a literal, so the sweep above is COMPLETE — which is
    // a fact worth holding still, because the day somebody writes the first
    // computed guard this goes red and tells them that `assertDeclared` in
    // `thinkscript.js` is then the only check that exists.
    const src = readSource()
    const computed = [...src.matchAll(/`thinkscript:\$\{([^}]*)\}`/g)].map((m) => m[1])
    expect(computed,
      'a computed guard is unreadable to any regex — declare it in REFUSALS and rely on '
      + 'assertDeclared, which is the ONLY thing that can check it').toEqual([])
    // ⛔ AND THE CONTROL, because a pattern that matches nothing is
    // indistinguishable from a pattern that cannot match. This is the exact
    // shape W3.2's review planted; the sweep must be able to see it.
    const planted = 'throw new ThinkScriptRefusal(`thinkscript:${kind}`, msg, at)'
    expect([...planted.matchAll(/`thinkscript:\$\{([^}]*)\}`/g)].map((m) => m[1])).toEqual(['kind'])
  })

  it('⭐ …and TWENTY-TWO of the twenty-nine are now reachable, which is measured, not assumed', () => {
    // ⛔ A CLOSED SET SAYS NOTHING ABOUT HOW MUCH OF IT IS REACHABLE. Measured by
    // RUNNING it — the only honest source for "what does this thing emit" — and
    // pinned BY NAME, so the next new guard reds this and has to be acknowledged
    // rather than quietly joining a set nobody was counting.
    // ⏳ W3.2 measured TWO, W3.3 nineteen. The six still out are the constructs
    // W3.6 classifies (`:aggregation`, `:symbol`, `:time`, `:strategy`,
    // `:account`) plus `:unsupported`, pinned by name in the next test.
    const reached = new Set()
    for (const src of [
      '', '   \n',
      'plot p = close § 1;',
      'def x = close\nplot p = x > 0;',
      'plot p = close > open;\nAddLabel(yes, "x", Color.RED);',
      'plot p = HL2;',
      // ⚠️ THE `:function` PROBE MOVED IN W3.4 and had to. It was
      // `Average(close, 50)`, which this task MAPS — so the probe would have gone
      // on passing while measuring nothing. `TTM_Squeeze` is proprietary and
      // thinkorswim publishes no formula for it, so it is a wall that will still
      // be a wall after the function map lands.
      'plot scan = close > TTM_Squeeze(close, 20);',
      'plot p = Average(source = close, length = 5);',
      'plot p = Average(close, 5, 9);',
      'plot p = Average(close, 5.5);',
      'plot p = mystery;',
      'def a = b;\ndef b = a;\nplot p = a;',
      'def x = x[1];\nplot p = x;',
      'plot p = Double.POSITIVE_INFINITY;',
      'plot p = close[close];',
      'plot p = close[-1];',
      'def y;\nif close > open then { y = 1; } else { y = 2; }\nplot p = y;',
      'declare lower;',
      'input benchmark;\nplot p = close;',
      'plot p = close[1][2];',
      'def x = fold i = 0 to 8 with p do p + close;\nplot q = x;',
      'input mode = {default UseA, UseB};\nplot p = if mode == mode.UseZ then close else open;',
      'plot p = reference RSI("length" = 14)."RSI";',
    ]) {
      for (const r of translateThinkScript(src).refusals) reached.add(r.guard)
    }
    expect([...reached].sort()).toEqual(REACHABLE)
  })

  it('…and exactly one more guard is REFERENCED in code without being reachable', () => {
    // ⛔ THE GAP BETWEEN "WRITTEN INTO CODE" AND "REACHABLE" IS WHERE DEAD
    // SCAFFOLDING HIDES, so it is pinned by name too. `thinkscript:roundtrip` is
    // written where the printed text fails to read back as the tree it came
    // from — and after fix round 1 nothing reaches it: its one reachable case, a
    // chained offset, is now decided at the bracket. It is KEPT because the
    // printer and the parser are two different tables and a drift between them
    // must refuse loudly rather than ship a wrong formula. Stripping the
    // declaration tables is what makes this measurable at all: sweeping the
    // whole file just finds the names the tables spell.
    const src = readSource()
    const strip = (re) => {
      const m = re.exec(src)
      expect(m, `${re} must match, or this test measures the whole file`).toBeTruthy()
      return m[0]
    }
    const code = src
      .replace(strip(/export const REFUSALS = Object\.freeze\(\{[\s\S]*?\n\}\)/), '')
      .replace(strip(/export const NOTES = Object\.freeze\(\{[\s\S]*?\n\}\)/), '')
    const inCode = new Set([...code.matchAll(/'(thinkscript:[a-z-]+)'/g)].map((m) => m[1]))
    const reachable = new Set(REACHABLE)
    expect([...inCode].filter((g) => !reachable.has(g) && !(g in TS_NOTES)).sort())
      .toEqual(['thinkscript:roundtrip'])
    // ⛔ AND EVERY REACHABLE GUARD IS ACTUALLY WRITTEN HERE, so `REACHABLE` cannot
    // drift into naming a guard some other module emits.
    expect(REACHABLE.filter((g) => !inCode.has(g))).toEqual([])
  })

  it('…and the six still UNWRITTEN are named, so a later task cannot quietly drop one', () => {
    // ⛔ THE THIRD SET, AND THE ONE A ROADMAP ACTUALLY LIVES IN. These are
    // declared vocabulary no line of this module writes yet; each belongs to a
    // named later task (`:aggregation` `:symbol` `:time` `:strategy` `:account`
    // to W3.6). ⭐ AND `:unsupported` IS IN HERE, which is the notification that
    // matters: it was the ONLY thing this translator could say at W3.2 and
    // nothing says it now.
    // ⏳ W3.3 LISTED NINE. `:arity`, `:named-argument` and `:window` left this
    // set in W3.4 with the call-shape mechanism they were waiting on.
    const src = readSource()
    const table = /export const REFUSALS = Object\.freeze\(\{[\s\S]*?\n\}\)/.exec(src)
    const code = src.replace(table[0], '')
    const inCode = new Set([...code.matchAll(/'(thinkscript:[a-z-]+)'/g)].map((m) => m[1]))
    expect(Object.keys(TS).filter((g) => !inCode.has(g)).sort()).toEqual([
      'thinkscript:account', 'thinkscript:aggregation',
      'thinkscript:strategy', 'thinkscript:symbol', 'thinkscript:time',
      'thinkscript:unsupported',
    ])
    // ⛔ THE THREE SETS PARTITION THE TABLE — no guard in two of them, none in
    // none of them. Without this, moving a guard between the lists above could
    // lose one entirely and every assertion would still pass.
    expect([...REACHABLE, 'thinkscript:roundtrip',
      ...Object.keys(TS).filter((g) => !inCode.has(g))].sort()).toEqual(Object.keys(TS).sort())
  })

  it('⭐ …and CLOSED at runtime too, for a guard this file could never see', () => {
    // ⛔ THE SOURCE SWEEP ABOVE IS BLIND TO ANOTHER MODULE. A later task throws
    // `ThinkScriptRefusal` from its own file; a typo'd guard there would reach a
    // member as a refusal with no sentence at all. The constructor reads the one
    // authority, so the mistake dies where it is made.
    // ⚠️ `nosuchguard` is deliberately a name no table version will ever carry.
    expect(() => new ThinkScriptRefusal('thinkscript:nosuchguard', 'x', null))
      .toThrow(/thinkscript:nosuchguard/)
    // …and a declared one constructs cleanly, so the check above is not simply
    // "the constructor always throws".
    const ok = new ThinkScriptRefusal('thinkscript:fold', REFUSALS_TEXT('thinkscript:fold'), { line: 3, column: 5, index: 9, token: 'fold' })
    expect(ok.guard).toBe('thinkscript:fold')
    expect(ok.name).toBe('ThinkScriptRefusal')
    expect(ok.at.line).toBe(3)
    expect(ok instanceof Error).toBe(true)
  })

  it('the refusal class is its own, never shared with Pine or TC2000', () => {
    // ⛔ ONE SHARED CLASS LETS ONE GUARD'S DELETION BE COVERED BY ANOTHER
    // GUARD'S TEST — `PineRefusal` and `PcfRefusal` are separate for the same
    // reason and this one joins them.
    const r = new ThinkScriptRefusal('thinkscript:fold', 'x', null)
    expect(r.constructor.name).toBe('ThinkScriptRefusal')
    expect(r.at).toBe(null)
  })
})

describe('the empty and the unreadable', () => {
  it('an empty source refuses by name with no line', () => {
    const out = translateThinkScript('')
    expect(out.ok).toBe(false)
    expect(out.version).toBe('thinkscript')
    expect(out.refusal.guard).toBe('thinkscript:empty')
    expect(out.refusal.line).toBe(null)
    expect(out.refusal.message).toBe(TS['thinkscript:empty'])
  })

  it('whitespace, null and a non-string are the same empty answer, never a crash', () => {
    for (const bad of ['   \n\t\n', null, undefined, 42, {}, []]) {
      const out = translateThinkScript(bad)
      expect(out.ok, String(bad)).toBe(false)
      expect(out.refusal.guard, String(bad)).toBe('thinkscript:empty')
      expect(out.refusals.length, String(bad)).toBe(1)
    }
  })

  it("the return shape is translatePine's, key for key", () => {
    // ⚠️ MEASURED ON BOTH ANSWERS. At W3.2 this ran on `plot x = close;`, which
    // refused; that script TRANSLATES now, so a shape test pinned to it would
    // only ever have seen the succeeding branch from here on.
    for (const src of ['plot x = close;', 'plot x = TTM_Squeeze(close, 20);']) {
      const out = translateThinkScript(src)
      for (const k of ['ok', 'version', 'declaration', 'title', 'outputs', 'selected',
        'refusal', 'refusals', 'ignored', 'folded']) {
        expect(Object.prototype.hasOwnProperty.call(out, k), `${src} → ${k}`).toBe(true)
      }
      expect(Array.isArray(out.outputs), src).toBe(true)
      expect(Array.isArray(out.ignored), src).toBe(true)
      expect(Array.isArray(out.folded), src).toBe(true)
      expect(Array.isArray(out.refusals), src).toBe(true)
      expect(out.declaration, src).toBe(null)
      expect(out.title, src).toBe(null)
    }
    expect(translateThinkScript('plot x = close;').selected).toBe(0)
    expect(translateThinkScript('plot x = TTM_Squeeze(close, 20);').selected).toBe(-1)
  })

  it('an output ROW carries the eight keys `ImportBox` and the corpus both read', () => {
    const row = translateThinkScript('plot x = close;').outputs[0]
    expect(Object.keys(row).sort()).toEqual(
      ['ast', 'column', 'formula', 'hidden', 'inputsFolded', 'kind', 'line', 'refusal', 'title'])
    expect(row.line).toBe(1)
    expect(row.column).toBe(1)
  })

  it('a refusal value carries the seven keys every other door in this engine carries', () => {
    // ⭐ THE SHAPE IS A CONTRACT, NOT A CONVENIENCE. `ImportBox` and the corpus
    // fixture both read these by name; a missing `token` reads as "somewhere in
    // your script", which is not a refusal a member can act on.
    const r = translateThinkScript('plot x = TTM_Squeeze(close, 20);').refusal
    expect(Object.keys(r).sort()).toEqual(
      ['column', 'excerpt', 'guard', 'index', 'line', 'message', 'token'])
  })
})

describe('what the reader still refuses, and where it says so', () => {
  // ⏳ THIS BLOCK WAS `the skeleton refuses EVERYTHING` AND ITS ASSERTIONS WERE
  // WRITTEN TO GO RED HERE — W3.2 said so in these words: "These assertions go
  // RED at W3.3 when the walls first move, and that is the notification." They
  // did. Every fact they held that is still a fact is kept, re-aimed at a script
  // this reader genuinely cannot read; the ones that only held while EVERYTHING
  // refused at line 1 are gone, and the corpus fixture is where their
  // replacement lives.

  it('a script whose function this task has not mapped refuses, by name', () => {
    const out = translateThinkScript('def a = TTM_Squeeze(close, 20);\nplot scan = close > a;\n')
    expect(out.ok).toBe(false)
    expect(out.refusal.guard).toBe('thinkscript:function')
    expect(out.refusal.message).toBe(TS['thinkscript:function'])
    // ⚠️ THE OUTPUT ROW IS STILL OFFERED, carrying its own refusal — the member
    // is told WHICH of their plots failed, not that "the script" failed.
    expect(out.outputs).toHaveLength(1)
    expect(out.outputs[0].refusal.guard).toBe('thinkscript:function')
    expect(out.outputs[0].formula).toBe(null)
  })

  it('⭐ the caret is under the token the refusal names, and the token is REAL text', () => {
    // ⛔ "IT REFUSED" IS SATISFIABLE BY A TRANSLATOR THAT POINTS AT NOTHING.
    // A token taken from a TRIMMED line is not at the column it claims the
    // moment that line is indented, so the caret and the token disagree and
    // neither is checkable. ⚠️ W3.2's version of this ran on an indented
    // `declare`, which now reads and is ignored; the indentation is what
    // mattered and it is kept.
    const src = '   def a = TTM_Squeeze(close, 20);\nplot scan = close > a;\n'
    const out = translateThinkScript(src)
    const r = out.refusal
    const line = src.split('\n')[r.line - 1]
    expect(r.line).toBe(1)
    expect(r.column).toBe(12)
    expect(r.token).toBe('TTM_Squeeze')
    expect(line.slice(r.column - 1, r.column - 1 + r.token.length)).toBe('TTM_Squeeze')
    expect(r.excerpt).toBe(`${line}\n${' '.repeat(r.column - 1)}^`)
    expect(r.index).toBe(11)
  })

  it('a blank line and a `#` banner move a position without moving a column', () => {
    // ⚠️ THE CALL HERE WAS `Sum(close, 3)` UNTIL W3.5 MAPPED `Sum`. A position
    // test needs a call that refuses, and one that refuses PERMANENTLY:
    // `TTM_Squeeze` is proprietary and thinkorswim publishes no formula for it,
    // so it can never be mapped out from under this. The columns are unchanged —
    // both names begin at the same offset.
    const src = '\n# Mobius\n\n   plot x = TTM_Squeeze(close, 3);\n'
    const out = translateThinkScript(src)
    const line = src.split('\n')[out.refusal.line - 1]
    expect(out.refusal.line).toBe(4)
    expect(out.refusal.column).toBe(13)
    expect(out.refusal.token).toBe('TTM_Squeeze')
    expect(line.slice(out.refusal.column - 1, out.refusal.column - 1 + 11)).toBe('TTM_Squeeze')
  })

  it('a pasted CRLF or CR script is read as the same lines an LF one is', () => {
    // ⛔ A WEAKER VERSION OF THIS TEST COULD NOT FAIL, AND THE MUTATION SWEEP
    // CAUGHT IT. Asserting only `line === 1` on a CRLF source passes with the
    // normalisation deleted, because line 1 is line 1 either way. The two facts
    // that actually depend on it are the CARET LINE (a stray `\r` lands inside
    // the excerpt a member reads) and the LINE COUNT of a CR-only paste — every
    // committed corpus file is LF, so the corpus gate never exercises either and
    // this is the only place they are held. A member pasting out of a Windows
    // editor is the ordinary case, not the exotic one.
    const crlf = translateThinkScript('  plot x = TTM_Squeeze(close, 3);\r\n')
    expect(crlf.refusal.line).toBe(1)
    expect(crlf.refusal.column).toBe(12)
    expect(crlf.refusal.token).toBe('TTM_Squeeze')
    expect(crlf.refusal.excerpt).toBe('  plot x = TTM_Squeeze(close, 3);\n           ^')
    expect(crlf.refusal.excerpt).not.toContain('\r')

    // A CR-only paste is three lines, so the refusal lands on the third —
    // unsplit, it would be one line and the caret would be 27 columns out.
    const cr = translateThinkScript('\r\rplot x = TTM_Squeeze(close, 3);')
    expect(cr.refusal.line).toBe(3)
    expect(cr.refusal.column).toBe(10)
    expect(cr.refusal.token).toBe('TTM_Squeeze')
  })

  it('`refusals` is the whole list and `refusal` is its first, both with excerpts', () => {
    const out = translateThinkScript('plot x = TTM_Squeeze(close, 3);')
    expect(out.refusals).toEqual([out.refusal])
    expect(out.refusals[0].excerpt).toContain('^')
  })

  it('⭐ refusals are ordered by POSITION, so the first one is the first thing wrong', () => {
    // ⛔ NOT BY THE ORDER THE READER HAPPENED TO PRODUCE THEM. A statement this
    // reader cannot read is found while walking the source; an output's refusal
    // is found afterwards, when the plot is resolved. Sorting by production
    // order would report the chrome on line 9 ahead of the function on line 2 —
    // and the function is the thing the member has to fix.
    const out = translateThinkScript(
      'def a = TTM_Squeeze(close, 20);\nplot p = a > 0;\nAddLabel(yes, "x", Color.RED);\n')
    expect(out.refusals.map((r) => [r.line, r.guard])).toEqual([
      [1, 'thinkscript:function'],
      [3, 'thinkscript:statement'],
    ])
  })
})

describe('the warm-up this translator gives a carried value', () => {
  it('is declared here, stated out loud, and is one trading year', () => {
    // ⚠️ THE SAME NUMBER `pine.js::PINE_STATE_WARMUP` PICKED, DECLARED AGAIN
    // rather than imported — that constant is not exported and `pine.js` is
    // another lane's file. Two translators may legitimately differ here.
    expect(TS_STATE_WARMUP).toBe(250)
  })
})

describe('the lexer reads what members actually paste', () => {
  const firstRefusal = (src) => translateThinkScript(src).refusal

  it('⭐ keywords and built-ins are CASE-INSENSITIVE — 13-scan-52-week-high is published that way', () => {
    // `Def High52 = Highest(High,52);` runs on thinkorswim exactly as posted, so
    // a case-sensitive reader would refuse real code for a reason that is not real.
    const out = translateThinkScript('Def X = Close;\nPlot Scan = X > 0;\n')
    expect(out.ok).toBe(true)
    expect(out.outputs[out.selected].formula).toBe('close > 0')
  })

  it('a `#` comment and a `#hint` are not code', () => {
    const out = translateThinkScript('# a header\ninput nFE = 8;#hint nFE: length\nplot p = close > nFE;\n')
    expect(out.ok).toBe(true)
    expect(out.outputs[out.selected].formula).toBe('close > 8')
  })

  it('⭐ a U+2013 EN-DASH used as a minus is normalised, and RECORDED — never refused', () => {
    // `10-rsi-laguerre` pastes `(1 – alpha)` from a forum post. The character is
    // not thinkScript's, but refusing it would be refusing a published script for
    // a copy-paste artefact of the site it was published on.
    const out = translateThinkScript('def a = 1;\nplot p = close – a;\n')
    expect(out.ok).toBe(true)
    expect(out.outputs[out.selected].formula).toBe('close - 1')
    expect(out.ignored.some((n) => n.code === 'thinkscript:note-endash' && n.line === 2)).toBe(true)
    // ⛔ AND ONLY THE LINE THAT CARRIED ONE. "we noted a dash" is satisfied by
    // noting every line; the note is a record of WHERE the paste was repaired.
    expect(out.ignored.filter((n) => n.code === 'thinkscript:note-endash').map((n) => n.line)).toEqual([2])
  })

  it('⛔ a character that is NOT a dash look-alike still refuses at its own column', () => {
    const r = firstRefusal('plot p = close § 1;\n')
    expect(r.guard).toBe('thinkscript:character')
    expect(r.line).toBe(1)
    expect(r.column).toBe(16)
    expect(r.token).toBe('§')
  })

  it('a statement that never ends refuses at the token it ran out on', () => {
    const r = firstRefusal('def x = close\nplot p = x > 0;\n')
    expect(r.guard).toBe('thinkscript:syntax')
    expect(r.line).toBe(2)
  })

  it('…and a run that reaches EOF with no terminator refuses at its LAST token', () => {
    // ⛔ THE OTHER HALF OF THE SPLITTER, and it fails differently: above, the `;`
    // arrived and swallowed the next statement; here it never arrives at all.
    const r = firstRefusal('plot p = close >\n')
    expect(r.guard).toBe('thinkscript:syntax')
    expect(r.line).toBe(1)
    expect(r.column).toBe(16)
  })

  it('⭐ EVERY position is measured on INDENTED input — a caret under whitespace points at nothing', () => {
    // ⚠️ THE W3.2 CAUTIONARY TALE, RAILED. Its corpus check passed TAUTOLOGICALLY
    // because every committed fixture happens to start unindented, while the
    // shipped caret pointed at whitespace for any indented paste. A member pastes
    // a fragment out of the middle of a study; indentation is the ordinary case.
    const src = '    def x = close;\n      plot p = mystery > 0;\n'
    const r = translateThinkScript(src).refusal
    const line = src.split('\n')[r.line - 1]
    expect(r.line).toBe(2)
    expect(r.column).toBe(16)
    expect(r.token).toBe('mystery')
    expect(line.slice(r.column - 1, r.column - 1 + r.token.length)).toBe('mystery')
    expect(r.excerpt).toBe(`${line}\n${' '.repeat(r.column - 1)}^`)
    expect(r.index).toBe(src.indexOf('mystery'))
  })

  it('the lexer is its own door, and it reports a token AT its column', () => {
    // The brief names `lexThinkScript` as this task's produced interface; a
    // reader that only ever runs inside the translator cannot be measured for
    // the thing the translator depends on — the position of every token.
    const { tokens, lines } = lexThinkScript('  plot "DI+" = high[1];\n')
    expect(lines).toEqual(['  plot "DI+" = high[1];', ''])
    expect(tokens.map((t) => `${t.kind}:${t.value}@${t.line}:${t.column}`)).toEqual([
      'ident:plot@1:3', 'string:DI+@1:8', 'punct:=@1:14', 'ident:high@1:16',
      'punct:[@1:20', 'number:1@1:21', 'punct:]@1:22', 'punct:;@1:23',
    ])
  })

  it('a dotted name is ONE token, and `<>` is one too', () => {
    const { tokens } = lexThinkScript('Double.NaN <> AverageType.HULL')
    expect(tokens.map((t) => t.value)).toEqual(['Double.NaN', '<>', 'AverageType.HULL'])
  })

  it('⭐ the statement splitter ends a BLOCK at its brace and an enum at its `;`', () => {
    // ⛔ THE TWO SHAPES THAT MAKE "SPLIT ON `;`" INSUFFICIENT, and they pull in
    // opposite directions: `input mode = {default A, B};` closes its brace and
    // then wants its `;`, while `if … { … } else { … }` closes its brace and is
    // OVER. Getting either wrong swallows the statement after it.
    const runs = (src) => readStatements(lexThinkScript(src).tokens)
      .map((s) => s.tokens.map((t) => t.value).join(' '))
    expect(runs('input mode = {default A, B};\nplot p = close;\n'))
      .toEqual(['input mode = { default A , B }', 'plot p = close'])
    expect(runs('if close > open then {\n a = 1;\n} else {\n a = 2;\n}\nplot p = close;\n'))
      .toEqual(['if close > open then { a = 1 ; } else { a = 2 ; }', 'plot p = close'])
  })

  it('⭐ the script symbol table and the engine table are folded DIFFERENTLY', () => {
    // ⛔ ONE SHARED NORMALISATION WOULD MAKE `bull_cross` AND `bullcross` THE SAME
    // MEMBER NAME. thinkorswim matches identifiers case-insensitively and nothing
    // more; the engine's own table lookup also strips `_` (`pine.js::normaliseName`),
    // which is right for `williams_r` → `williamsR` and wrong for a member's name.
    const shared = translateThinkScript('def bull_cross = close > open;\nplot p = bullcross;\n')
    expect(shared.refusal.guard).toBe('thinkscript:undefined')
    expect(shared.refusal.token).toBe('bullcross')
    // …and the case fold IS applied, so this is not simply "no fold at all".
    const cased = translateThinkScript('def bull_cross = close > open;\nplot p = BULL_Cross;\n')
    expect(cased.ok).toBe(true)
    expect(cased.outputs[cased.selected].formula).toBe('close > open')
  })
})

describe('declare, input, def and plot', () => {
  it('`declare lower;` is ignored and RECORDED, never dropped', () => {
    const out = translateThinkScript('declare lower;\nplot p = close > 0;\n')
    expect(out.ok).toBe(true)
    expect(out.ignored.map((n) => n.line)).toContain(1)
    expect(out.ignored.find((n) => n.line === 1).message).toMatch(/lower/i)
    expect(out.declaration).toBe('lower')
  })

  it('an input folds to its default and is NAMED OUT LOUD', () => {
    const out = translateThinkScript('input length = 14;\nplot p = close > length;\n')
    expect(out.outputs[out.selected].formula).toBe('close > 14')
    expect(out.folded).toEqual([expect.objectContaining({ name: 'length', folded: '14' })])
  })

  it('a PRICE input folds to the series it names', () => {
    const out = translateThinkScript('input src = close;\nplot p = src > open;\n')
    expect(out.outputs[out.selected].formula).toBe('close > open')
    expect(out.folded).toEqual([expect.objectContaining({ name: 'src', folded: 'close' })])
  })

  it('⭐ an ENUM input folds to the arm marked `default`, and the arm is named', () => {
    // `20-roc-stdev-lower` and `06-vwap-rejection` both write `{default X, Y, Z}`;
    // `17-compoundvalue` writes `{default UseCompoundValue, ManualCalculation}`.
    const out = translateThinkScript(
      'input mode = {default UseA, UseB};\nplot p = if mode == mode.UseA then close else open;\n')
    expect(out.outputs[out.selected].formula).toBe('close')
    expect(out.folded).toEqual([expect.objectContaining({ name: 'mode', folded: 'UseA' })])
  })

  it('…and the arm NOT taken decides the other way, so the fold is a READ not a default', () => {
    // ⛔ WITHOUT THIS THE TEST ABOVE PASSES FOR A TRANSLATOR THAT ALWAYS TAKES THE
    // `then` BRANCH. The corpus depends on the false arm: `17-compoundvalue`
    // plots BOTH modes and only one of them is the one the member gets.
    const out = translateThinkScript(
      'input mode = {UseA, default UseB};\nplot p = if mode == mode.UseA then close else open;\n')
    expect(out.outputs[out.selected].formula).toBe('open')
    expect(out.folded).toEqual([expect.objectContaining({ name: 'mode', folded: 'UseB' })])
  })

  it('⛔⛔ an arm the input NEVER DECLARED refuses — a silent fold to `false` is the one thing this lane exists to prevent', () => {
    // ⛔⛔ MEASURED IN W3.3 REVIEW, AND IT IS THE LANE'S NON-NEGOTIABLE. `mode ==
    // mode.UseZ` folded to `false` with NO REFUSAL AT ALL, so
    // `if … then close else open` silently became `open`. The member gets a
    // chart that looks right and is wrong — worse than any refusal. The cause
    // was structural: `readEnumDefault` threw the arm list away, so nothing
    // COULD check membership.
    const src = 'input mode = {default UseA, UseB};\nplot p = if mode == mode.UseZ then close else open;\n'
    const out = translateThinkScript(src)
    expect(out.ok).toBe(false)
    const r = out.refusal
    expect(r.guard).toBe('thinkscript:enum-arm')
    expect(r.token).toBe('mode.UseZ')
    expect(r.line).toBe(2)
    expect(r.column).toBe(21)
    expect(src.split('\n')[1].slice(r.column - 1, r.column - 1 + r.token.length)).toBe('mode.UseZ')
  })

  it('…and the `!=` form refuses too, so the fix is not "an unknown arm is always false"', () => {
    // ⛔ WITHOUT THIS, A FIX THAT FOLDED AN UNKNOWN ARM TO `true` INSTEAD OF
    // `false` would pass the test above while mistranslating the other way.
    const r = translateThinkScript(
      'input mode = {default UseA, UseB};\nplot p = if mode != mode.UseZ then close else open;\n').refusal
    expect(r.guard).toBe('thinkscript:enum-arm')
    expect(r.token).toBe('mode.UseZ')
  })

  it('⛔ …and two DIFFERENT enum families never quietly compare unequal', () => {
    const r = translateThinkScript(
      'input mode = {default UseA, UseB};\nplot p = if mode == AverageType.UseA then close else open;\n').refusal
    expect(r.guard).toBe('thinkscript:enum-arm')
    expect(r.token).toBe('AverageType.UseA')
  })

  it('⛔ …and an undeclared arm refuses OUTSIDE a comparison as well', () => {
    const r = translateThinkScript('input mode = {default UseA, UseB};\nplot p = mode.UseZ;\n').refusal
    expect(r.guard).toBe('thinkscript:enum-arm')
    expect(r.token).toBe('mode.UseZ')
  })

  it('…while a DECLARED arm still folds, both ways — the guard must not close the door it protects', () => {
    const a = translateThinkScript(
      'input mode = {default UseA, UseB};\nplot p = if mode == mode.UseA then close else open;\n')
    expect(a.ok).toBe(true)
    expect(a.outputs[a.selected].formula).toBe('close')
    const b = translateThinkScript(
      'input mode = {UseA, default UseB};\nplot p = if mode == mode.UseA then close else open;\n')
    expect(b.ok).toBe(true)
    expect(b.outputs[b.selected].formula).toBe('open')
  })

  it('an input with no default refuses BY NAME rather than guessing one', () => {
    const r = translateThinkScript('input benchmark;\nplot p = close > 0;\n').refusals
      .find((x) => x.guard === 'thinkscript:input-kind')
    expect(r).toBeTruthy()
    expect(r.token).toBe('benchmark')
  })

  it('`yes` and `no` are 1 and 0', () => {
    expect(translateThinkScript('plot p = if close > open then yes else no;\n')
      .outputs[0].formula).toBe('close > open ? 1 : 0')
  })

  it('`Double.NaN` is the engine\'s not-computable, spelled the way the parser reads it', () => {
    // Pine's bare `na` already expands to `0 / 0` here (an identity across both
    // lanes, riding the `_binary_div` seam) — this is the same value.
    expect(translateThinkScript('plot p = if close > open then close else Double.NaN;\n')
      .outputs[0].formula).toBe('close > open ? close : 0 / 0')
  })

  it('`Double.Pi` is the literal; ⛔ an INFINITY refuses — a canonical tree carries finite numbers only', () => {
    expect(translateThinkScript('plot p = close * Double.Pi;\n').outputs[0].formula)
      .toBe('close * 3.141592653589793')
    const r = translateThinkScript('plot p = close * Double.POSITIVE_INFINITY;\n').refusal
    expect(r.guard).toBe('thinkscript:type')
    expect(r.token).toBe('Double.POSITIVE_INFINITY')
  })

  it('a QUOTED plot name is an identifier, and reading it later is reading that plot', () => {
    // `03-adx-dmi-lower` writes `plot "DI+" = …` and then uses `"DI+"` in `def DX`.
    const out = translateThinkScript('plot "DI+" = high - low;\nplot D = "DI+" * 2;\n')
    expect(out.ok).toBe(true)
    expect(out.outputs[1].formula).toBe('(high - low) * 2')
    expect(out.outputs[0].title).toBe('DI+')
  })

  it('⭐ a FORWARD-DECLARED `def x;` assigned later is one binding, not an undefined name', () => {
    // `10-rsi-laguerre`, `17-compoundvalue`, `06-vwap-rejection` and
    // `20-roc-stdev` all declare first and assign after.
    const out = translateThinkScript('def x;\nx = close - open;\nplot p = x > 0;\n')
    expect(out.ok).toBe(true)
    expect(out.outputs[out.selected].formula).toBe('close - open > 0')
  })

  it('…and a forward-declared PLOT is one output, not two', () => {
    // `10-rsi-laguerre` writes `plot RSI;` at the top and `RSI = …;` 40 lines down.
    const out = translateThinkScript('plot RSI;\nRSI = close > open;\n')
    expect(out.ok).toBe(true)
    expect(out.outputs).toHaveLength(1)
    expect(out.outputs[0].formula).toBe('close > open')
  })

  it('⛔ a forward declaration nobody ever assigns refuses, rather than reading as blank', () => {
    const r = translateThinkScript('def x;\nplot p = x > 0;\n').refusal
    expect(r.guard).toBe('thinkscript:undefined')
    expect(r.token).toBe('x')
  })

  it('⛔ a name never given a value refuses at the name, not at the plot', () => {
    const r = translateThinkScript('plot p = mystery > 0;\n').refusal
    expect(r.guard).toBe('thinkscript:undefined')
    expect(r.token).toBe('mystery')
    expect(r.column).toBe(10)
  })

  it('⛔ a thinkorswim built-in this engine has no field for refuses as a BUILT-IN, not as a typo', () => {
    // ⛔ `HL2` IS REAL thinkScript (`01-supertrend-mobius` uses it). Reporting
    // "this name is used before anything gives it a value" would send a member
    // hunting for a `def` they never omitted.
    const r = translateThinkScript('plot p = HL2 > close;\n').refusal
    expect(r.guard).toBe('thinkscript:builtin')
    expect(r.token).toBe('HL2')
  })

  it('⛔ two names defined through each other refuse as a cycle', () => {
    const r = translateThinkScript('def a = b + 1;\ndef b = a + 1;\nplot p = a;\n').refusal
    expect(r.guard).toBe('thinkscript:cycle')
  })

  it('⛔ …and a name that reads its OWN previous bar refuses as carried STATE, not as a cycle', () => {
    // `def ST = if close < ST[1] then UP else DN;` — the two are different facts
    // and a member fixes them differently. The bounded accumulator that reads
    // this is `CompoundValue`, and it is a later task's.
    const r = translateThinkScript('def x = x[1] + 1;\nplot p = x;\n').refusal
    expect(r.guard).toBe('thinkscript:state')
    expect(r.token).toBe('x')
  })

  it('⭐ the column offered FIRST is the one that answers yes or no, not the first one written', () => {
    // ⛔ A MEMBER PASTING A STUDY WANTS A SCAN, and most published studies plot
    // their levels before their signal. `treeYieldsBool` is IMPORTED from
    // `pine.js` to decide this — one `yields` reader for the engine — so this is
    // also the only thing holding that import honest.
    const out = translateThinkScript('plot band = high - low;\nplot sig = close > open;\n')
    expect(out.ok).toBe(true)
    expect(out.selected).toBe(1)
    expect(out.outputs[out.selected].formula).toBe('close > open')
    // …and with no boolean anywhere it is simply the first, so the rule above is
    // a PREFERENCE and not "always the last one".
    const flat = translateThinkScript('plot a = high - low;\nplot b = close * 2;\n')
    expect(flat.selected).toBe(0)
  })

  it('a bare expression with no plot IS the output — 16-scan-rsi-crosses has no `plot` at all', () => {
    const out = translateThinkScript('close > open\n')
    expect(out.ok).toBe(true)
    expect(out.outputs).toHaveLength(1)
    expect(out.outputs[0].kind).toBe('condition')
    expect(out.outputs[0].formula).toBe('close > open')
  })

  it('⛔ a chained bar offset refuses at the SECOND BRACKET, not at the plot name', () => {
    // ⛔ W3.3 REVIEW: `plot p = close[1][1];` is legal thinkScript and refused
    // `:roundtrip` with the caret on `p` — a caret on CORRECT code, which sends
    // a member to fix the wrong thing. Same class as W3.2's whitespace caret.
    // `close[1][1]` and `close[2]` are the same column with two hashes, so the
    // engine refuses the chain; the member's fix is at the bracket.
    const src = 'plot p = close[1][1];\n'
    const r = translateThinkScript(src).refusal
    expect(r.guard).toBe('thinkscript:offset-chained')
    expect(r.line).toBe(1)
    expect(r.column).toBe(18)
    expect(r.token).toBe('[')
    expect(src.split('\n')[0].slice(r.column - 1, r.column)).toBe('[')
  })

  it('⛔ the same plot name twice refuses — two columns under one title is not a study', () => {
    // ⚠️ DISCLOSED AS AN ASYMMETRY IN W3.3 AND GUARDED HERE: a duplicate `def`
    // refused while a duplicate `plot` quietly produced two columns both titled
    // `p`, with `ok: true`.
    const r = translateThinkScript('plot p = close;\nplot p = open;\n').refusal
    expect(r.guard).toBe('thinkscript:statement')
    expect(r.line).toBe(2)
    expect(r.token).toBe('p')
  })

  it('…while a plot REUSING a `def` name still reads, because 11-money-flow is published that way', () => {
    // ⛔ THE GUARD ABOVE MUST NOT CLOSE THIS DOOR. `def mfi = …; plot MFI = mfi;`
    // is published and running, and identifiers here fold case-insensitively, so
    // those two are one key.
    const out = translateThinkScript('def mfi = close - open;\nplot MFI = mfi;\n')
    expect(out.ok).toBe(true)
    expect(out.outputs[out.selected].formula).toBe('close - open')
  })

  it('⛔ a bare CALL is chrome, not an output — `AddLabel(…)` answers with no value to screen on', () => {
    // ⛔ THE ONE RULE THAT KEEPS `assert(…)`, `AddCloud(…)` AND
    // `signal.AssignValueColor(…)` FROM BECOMING COLUMNS. W3.6 turns this subset
    // into `ignored`; today it refuses, and it refuses at the call.
    const out = translateThinkScript('plot p = close > open;\nAddLabel(yes, "hi", Color.RED);\n')
    expect(out.outputs).toHaveLength(1)
    const r = out.refusals.find((x) => x.guard === 'thinkscript:statement')
    expect(r.line).toBe(2)
    expect(r.column).toBe(1)
    expect(r.token).toBe('AddLabel')
    expect(out.ok, 'a statement this translator cannot read refuses the whole script').toBe(false)
  })

  it('⛔ a multi-statement block refuses as a block, naming the word that opened it', () => {
    const r = translateThinkScript('def y;\nif close > open then {\n  y = 1;\n} else {\n  y = 2;\n}\nplot p = y;\n').refusal
    expect(r.guard).toBe('thinkscript:block')
    expect(r.line).toBe(2)
    expect(r.token).toBe('if')
  })

  it('⛔ a script with nothing to read refuses `no-output`', () => {
    const r = translateThinkScript('declare lower;\n').refusal
    expect(r.guard).toBe('thinkscript:no-output')
  })

  it('⭐ a call this lane maps NO shape for refuses at the FUNCTION NAME', () => {
    // ⏳ THE MEASURED WALL. W3.3 measured it with `Average`, which W3.4 maps; the
    // wall did not disappear, it MOVED, and this is where it stands now.
    // `TTM_Squeeze` is proprietary — thinkorswim publishes no formula for it — so
    // the honest answer stays the token and the reason, never a neighbouring
    // function that happens to be in the table.
    const r = translateThinkScript('def a = TTM_Squeeze(close, 20);\nplot scan = close > a;\n').refusal
    expect(r.guard).toBe('thinkscript:function')
    expect(r.line).toBe(1)
    expect(r.column).toBe(9)
    expect(r.token).toBe('TTM_Squeeze')
  })

  it('⭐⭐ DOCUMENTED thinkScript never refuses `:syntax` — the CLASS, not just the corpus', () => {
    // ⛔⛔ THE CORPUS RAIL IN `thinkscript.corpus.test.js` IS CORPUS-SCOPED BY
    // CONSTRUCTION and structurally cannot see a construct no fixture happens to
    // use. W3.3 review found three that way: `between`, `reference` and `script`
    // are all documented thinkScript and all reported "this thinkScript line does
    // not end where a statement has to end" — a FALSE REASON at a true position,
    // which is the worse half of a wrong refusal and sends a member to rewrite
    // code that was already correct.
    //
    // ⚠️ THIS LIST IS THE SCOPE, AND IT IS HAND-WRITTEN ON PURPOSE. It cannot
    // claim to cover a language of thousands of names; what it does is hold the
    // constructs the reference documents and this reader parses, so the next
    // task adds a row rather than rediscovering the class.
    const cases = [
      // ⭐ THE `between` OPERATOR LEFT THIS LIST IN W3.4 — it TRANSLATES now, and
      // an honest refusal became an honest translation rather than a wall moving.
      // Its CALL form stays, and stays for a stated reason: a thinkorswim
      // FUNCTION called `Between` needs its own citation off its own page, which
      // is the function map's job, not the operator table's.
      ['plot p = between(close, low, high);', 'thinkscript:function', 'between'],
      // a study reference — thinkorswim does not publish the formula
      ['plot p = reference RSI("length" = 14)."RSI";', 'thinkscript:study-ref', 'reference'],
      // a user-defined script is a program, and this engine stores one expression
      ['script foo {\n  plot out = close;\n}\nplot p = foo(1);', 'thinkscript:block', 'script'],
    ]
    for (const [src, guard, token] of cases) {
      const r = translateThinkScript(src).refusal
      expect(r, src).toBeTruthy()
      expect(r.guard, src).toBe(guard)
      expect(r.token, src).toBe(token)
      const line = src.split('\n')[r.line - 1]
      expect(line.slice(r.column - 1, r.column - 1 + token.length), src).toBe(token)
    }
    // ⛔ AND THE CONTROL. Without it this rail is satisfied by a reader that has
    // stopped being able to say `:syntax` at all — a genuinely unfinished
    // statement must still say it.
    expect(translateThinkScript('plot p = close >').refusal.guard).toBe('thinkscript:syntax')
  })

  it('…and an UNREFERENCED def never refuses, because nothing reads it', () => {
    // ⛔ RESOLUTION IS LAZY ON PURPOSE. A study that defines nine intermediates
    // and plots one of them must not be refused for the eight the member's
    // column never touches.
    const out = translateThinkScript('def unused = TTM_Squeeze(close, 20);\nplot p = close > open;\n')
    expect(out.ok).toBe(true)
    expect(out.refusals).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────── //
// W3.4 — THE EXPRESSIONS
// ─────────────────────────────────────────────────────────────────────────── //

const formulaOf = (src) => {
  const out = translateThinkScript(src)
  return out.outputs[out.selected === -1 ? 0 : out.selected].formula
}
const astHashOf = (text) => astHash(parseFormula(text).ast)
const printFormulaOf = (ast) => printFormula(ast)

describe('precedence, per the thinkScript reference', () => {
  const f = (expr) => translateThinkScript(`plot p = ${expr};\n`).outputs[0].formula

  it('`*` binds tighter than `+`, and the printed text says so with the fewest brackets', () => {
    expect(f('close + open * 2')).toBe('close + open * 2')
    expect(f('(close + open) * 2')).toBe('(close + open) * 2')
  })

  it('comparison is looser than arithmetic, `and` looser than comparison, `or` looser than `and`', () => {
    expect(f('close > open + 1 and low < high or volume > 0'))
      .toBe('close > open + 1 && low < high || volume > 0')
  })

  it('`!` is unary and binds tightest; `-` negates', () => {
    expect(f('!(close > open)')).toBe('!(close > open)')
    expect(f('-close + open')).toBe('-close + open')
  })

  it('the WORD operators are the symbol operators — the reference calls them "human-readable"', () => {
    // ⭐ EVERY ROW HERE IS ON thinkorswim's OWN Comparison Operators PAGE, which
    // lists the word spelling and the symbol as SEPARATE ROWS WITH THE SAME
    // DESCRIPTION (`is greater than` / `>` both read "is greater than"). So this
    // is not a convenience mapping: the two spellings are one operator, and the
    // reader must not have a second grammar for the long one.
    expect(f('close is greater than open')).toBe('close > open')
    expect(f('close is less than open')).toBe('close < open')
    expect(f('close is equal to open')).toBe('close == open')
    expect(f('close is not equal to open')).toBe('close != open')
    expect(f('close equals open')).toBe('close == open')
    expect(f('close <> open')).toBe('close != open')
    expect(f('close && open || low')).toBe('close && open || low')
  })

  it('⭐ `is false` IS `!` — the reference prints them in ONE ROW, `!, is false`', () => {
    // ⛔ SO THIS IS QUOTATION, NOT INFERENCE. The Logical Operators page's NOT row
    // spells both, which makes `is false` the same operator `!` already is.
    expect(f('!(close > open)')).toBe('!(close > open)')
    expect(f('(close > open) is false')).toBe('!(close > open)')
    // …and its neighbour row, `is true | logical value`, resolves to the operand
    // UNCHANGED: passing the value straight through hands this engine exactly the
    // truthiness decision thinkorswim's own runtime makes, which is what every
    // other boolean context in this translator already does.
    expect(f('(close > open) is true')).toBe('close > open')
    // ⭐ THE CONTROL — the two are not the same answer, so neither is a no-op the
    // other's test would cover.
    expect(f('(close > open) is true')).not.toBe(f('(close > open) is false'))
  })

  it('⭐ the LONGER word operator wins — `is greater than or equal to` is not `is greater than`', () => {
    // ⛔ THE ONE ORDERING BUG THIS TABLE CAN HAVE, and it is silent: matching the
    // short phrase first reads `a is greater than or equal to b` as
    // `a > (or equal to b)`, which then dies as a syntax error at `or` — a wrong
    // reason at a wrong token for a spelling the reference publishes.
    expect(f('close is greater than or equal to open')).toBe('close >= open')
    expect(f('close is less than or equal to open')).toBe('close <= open')
  })

  it('`if c then a else b` is the ternary, and it nests right', () => {
    expect(f('if close > open then 1 else if close < open then -1 else 0'))
      .toBe('close > open ? 1 : close < open ? -1 : 0')
  })

  it('⭐ `between` is INCLUSIVE both ends — the reference says "(inclusive)"', () => {
    expect(f('close between low and high')).toBe('close >= low && close <= high')
  })

  it('⭐ …and `between` binds where the reference PUTS it: with the comparisons', () => {
    // ⚠️ THE BRIEF PUT `between` ON ITS OWN TIER, LOOSER THAN COMPARISON. The
    // reference's Comparison Operators page (fetched 2026-08-26) lists `between`,
    // `crosses`, `crosses above` and `crosses below` as ROWS OF THE COMPARISON
    // TABLE — so they are comparisons, and a separate tier would be this
    // translator's invention. ⚠️ `between` is also the ONE operator the
    // precedence page gives no row to, bounding it in prose only to levels
    // 6..10; `thinkscript.js` marks it as the single inferred rung and says
    // where the inference comes from. Same-tier and left-associative gives the reading
    // the phrase needs anyway: the left operand is whatever comparison has been
    // built so far, which is the same operand the brief's looser tier hands it.
    //
    // ⭐ THE LOAD-BEARING HALF IS THE `and`. `between` SPENDS an `and` closing
    // its own phrase, so a reader that let the logical `and` win would silently
    // take `high and volume > 0` as the upper bound — a wrong column, not a
    // refusal. The bounds are read at the tier ABOVE `and` for exactly that
    // reason.
    expect(f('close between low and high and volume > 0'))
      .toBe('close >= low && close <= high && volume > 0')
  })

  it('⭐ `within N bars` is "true at least once in the last N bars, INCLUDING this one"', () => {
    // The reference: "true at least one time for the given number of bars starting
    // from the current one" / "at least one Doji among three candles including the
    // current one".
    // ⛔ `highest(cond, N) > 0` IS that sentence — an identity over a 0/1 column,
    // available in the shipped table today. `barssince` is not needed and would
    // add a lookback declaration nobody measured.
    expect(f('close > open within 3 bars')).toBe('highest(close > open, 3) > 0')
    expect(f('close > open within 1 bars')).toBe('highest(close > open, 1) > 0')
  })

  it('⛔⛔ `within` IS THE LOOSEST OPERATOR IN THE LANGUAGE — level 12, looser than `and`', () => {
    // ⛔⛔ THE DEFECT THIS TEST EXISTS FOR, AND IT SHIPPED. W3.4 put `within` on
    // a rung of its own TIGHTER than `and`, on the stated premise that
    // thinkorswim "does not publish a precedence table". IT DOES — level 12,
    // the loosest row on it — and at the wrong rung this is what a member got:
    //
    //   plot p = high < high[1] and low > low[1] within 3 bars;
    //     emitted  high < high[1] && highest(low > low[1], 3) > 0
    //     correct  highest(high < high[1] && low > low[1], 3) > 0
    //     → 53 of 158 bars disagree, and BOTH pass the round trip and the save
    //       door. A chart that looks right and is wrong: the one outcome this
    //       translator exists to prevent.
    //
    // ⭐ That is `14-scan-inside-bar` written the natural one-line way, which is
    // why the corpus could not see it — the fixture spells the condition as a
    // `def` on its own line.
    expect(f('high < high[1] and low > low[1] within 3 bars'))
      .toBe('highest(high < high[1] && low > low[1], 3) > 0')
    expect(f('close > open or volume > 0 within 5 bars'))
      .toBe('highest(close > open || volume > 0, 5) > 0')
    // …and the plain shapes still read the way they always did.
    expect(f('close > open within 3 bars')).toBe('highest(close > open, 3) > 0')
    // ⭐ THE TRAILING `bars` IS WHAT CLOSES THE COUNT, so an `and` AFTER the
    // phrase still joins the whole thing rather than being swallowed into it.
    expect(f('close > open within 2 bars and volume > 0'))
      .toBe('highest(close > open, 2) > 0 && volume > 0')
  })

  it('⛔ EQUALITY IS LOOSER THAN RELATIONAL — the page gives them levels 7 and 6, not one tier', () => {
    // ⛔ W3.4 COLLAPSED THEM ONTO ONE RUNG, so `close == open < high` grouped as
    // `(close == open) < high`; the published table binds `<` tighter, giving
    // `close == (open < high)` — 74 of 160 bars disagree. ⭐ The two groupings
    // PRINT DIFFERENTLY (`printFormula` parenthesises the looser child), so the
    // text alone tells them apart.
    expect(f('close == open < high')).toBe('close == open < high')
    expect(f('close != open >= low')).toBe('close != open >= low')
    // …and the control: the other grouping is a DIFFERENT string, so the two
    // assertions above cannot both be satisfied by a reader that ignores tiers.
    expect(f('(close == open) < high')).toBe('(close == open) < high')
  })

  it('⭐ `if` is level 11 and `within` is 12, so an `else` arm stops before `within`', () => {
    // The one place the ternary's own rung is observable: `within` is LOOSER
    // than `if`, so it takes the whole conditional rather than just the `else`
    // branch. Read the other way the window would silently cover one arm.
    expect(f('if close > open then 1 else 0 within 2 bars'))
      .toBe('highest(close > open ? 1 : 0, 2) > 0')
    // …while `or` (10) is TIGHTER than `if` (11) and so belongs to the arm.
    expect(f('if close > open then 1 else 0 or volume > 0'))
      .toBe('close > open ? 1 : 0 || volume > 0')
  })

  it('⏳ `from` is the ONE published operator this reader does not parse, and it is MEASURED', () => {
    // ⛔ NOT "ABSENT AND HARMLESS" — measured, and it is the wrong-REASON class.
    // `from` is level 1 on the published table, beside `[]`. Nothing here parses
    // it, so it falls out of the expression as a leftover token and refuses
    // `thinkscript:syntax` AT `from` — the right position with a false reason,
    // which is the same defect W3.3 fixed for `between`, `reference` and
    // `script`. It is NOT fixed here because fixing it means deciding what
    // `close from 2 bars ago` MEANS, and this lane has no fetched citation for
    // that; guessing it is an offset would be exactly the silent mistranslation
    // the whole door exists to prevent.
    // ⏳ HANDED ON with the measurement rather than a comment claiming it is
    // fine: whoever cites the page gives it a named guard and adds its row to
    // the `DOCUMENTED thinkScript never refuses :syntax` list below, which is
    // where this class is held and which this pins as knowingly incomplete.
    const r = translateThinkScript('plot p = close from 2 bars ago;\n').refusal
    expect(r.guard).toBe('thinkscript:syntax')
    expect(r.token).toBe('from')
    expect(r.column).toBe(16)
  })

  it('⛔ every operator this reader parses has a PUBLISHED level — no rung is invented', () => {
    // ⭐ DERIVED, NOT TYPED BESIDE THE LADDER. `TS_PRECEDENCE` is copied from
    // thinkorswim's own Operator-Precedence page; this asserts that every word
    // phrase the reader matches and every symbol it lexes as an operator has a
    // row there, so an operator can never again be given a rung somebody made
    // up. ⚠️ `between` is the ONE exception and is declared as such in the
    // source: the page bounds it in prose and gives it no row.
    for (const entry of TS_WORD_OPERATORS) {
      const phrase = entry.words.join(' ')
      expect(Object.prototype.hasOwnProperty.call(TS_PRECEDENCE, phrase), phrase).toBe(true)
      expect(TS_PRECEDENCE[phrase], phrase).toBeGreaterThanOrEqual(1)
      expect(TS_PRECEDENCE[phrase], phrase).toBeLessThanOrEqual(12)
    }
    const SYMBOLS = ['*', '/', '%', '+', '-', '<', '>', '<=', '>=',
      '==', '!=', '<>', '&&', '||']
    for (const sym of SYMBOLS) {
      expect(Object.prototype.hasOwnProperty.call(TS_PRECEDENCE, sym), sym).toBe(true)
    }
    // ⛔⛔ AND THE REVERSE DIRECTION, which is the half a mutation found missing:
    // a key NOTHING READS. The claim this map makes is "thinkorswim's table,
    // copied row for row" — and a row for an operator the reader cannot parse
    // makes that claim quietly false while every assertion above still passes.
    // Measured: adding `'from': 1` (a real row of the page this reader does NOT
    // parse) left all 106 tests green until this existed.
    // ⚠️ `if` is the one key with no infix spelling — `parseValue` looks it up by
    // name for the `else` arm's rung — so it is accounted for BY NAME here
    // rather than by widening the sweep until nothing can fail it.
    const reachable = new Set([...SYMBOLS, 'if',
      ...TS_WORD_OPERATORS.map((e) => e.words.join(' '))])
    expect(Object.keys(TS_PRECEDENCE).filter((k) => !reachable.has(k)),
      'a level nothing looks up is a row this map claims to copy and does not use').toEqual([])
    // ⭐ AND THE PAGE'S OWN ORDERING, spot-checked where this lane got it wrong:
    // relational binds tighter than equality, equality than the logical words,
    // and `within` is the loosest thing in the language.
    expect(TS_PRECEDENCE['<']).toBeLessThan(TS_PRECEDENCE['=='])
    expect(TS_PRECEDENCE['==']).toBeLessThan(TS_PRECEDENCE['is true'])
    expect(TS_PRECEDENCE['is true']).toBeLessThan(TS_PRECEDENCE.and)
    expect(TS_PRECEDENCE.and).toBeLessThan(TS_PRECEDENCE.or)
    expect(TS_PRECEDENCE.or).toBeLessThan(TS_PRECEDENCE.if)
    expect(TS_PRECEDENCE.if).toBeLessThan(TS_PRECEDENCE.within)
    expect(Math.max(...Object.values(TS_PRECEDENCE))).toBe(TS_PRECEDENCE.within)
    expect(Object.isFrozen(TS_PRECEDENCE)).toBe(true)
  })

  it('⛔ every row of the word-operator table is REACHABLE, and parses as ITSELF', () => {
    // ⭐ DERIVED FROM THE TABLE, NEVER TYPED BESIDE IT. This walks
    // `TS_WORD_OPERATORS` itself, so a row that is unreachable — most obviously
    // one shadowed by a shorter row that PREFIXES it — is reported by its own
    // phrase rather than by a count that happens to still add up. It is the
    // behavioural half of the longest-match guard: that guard cannot be killed
    // by a single-site mutation (with the rows written longest-first, "first
    // match" and "longest match" agree, so it is an EQUIVALENT MUTANT), and this
    // is what still fails if a row is ever added in the wrong place.
    for (const entry of TS_WORD_OPERATORS) {
      const phrase = entry.words.join(' ')
      if (entry.kind === 'binary') {
        expect(f(`close ${phrase} open`), phrase).toBe(`close ${entry.op} open`)
      } else if (entry.kind === 'postfix') {
        expect(f(`close ${phrase}`), phrase).toBe(entry.op === null ? 'close' : '!close')
      } else if (entry.kind === 'cross') {
        expect(f(`close ${phrase} open`), phrase).toBe(
          entry.dir === 'above' ? 'crossOver(close, open)'
            : entry.dir === 'below' ? 'crossUnder(close, open)'
              : 'crossOver(close, open) || crossUnder(close, open)')
      } else if (entry.kind === 'between') {
        expect(f(`close ${phrase} low and high`), phrase).toBe('close >= low && close <= high')
      } else if (entry.kind === 'within') {
        expect(f(`close ${phrase} 3 bars`), phrase).toBe('highest(close, 3) > 0')
      } else {
        // ⛔ NEVER A SILENT SKIP. A kind with no probe would let a whole family
        // of rows pass this rail without being run — the vacuous green this repo
        // keeps paying for.
        throw new Error(`${phrase}: this rail has no probe for kind ${entry.kind} — add one`)
      }
    }
    // non-vacuity, and no two rows spelling the same phrase
    expect(TS_WORD_OPERATORS.length).toBeGreaterThan(10)
    expect(new Set(TS_WORD_OPERATORS.map((e) => e.words.join(' '))).size)
      .toBe(TS_WORD_OPERATORS.length)
    expect(Object.isFrozen(TS_WORD_OPERATORS)).toBe(true)
  })

  it('⭐ `crosses` is the engine\'s crossing function, in all THREE spellings', () => {
    expect(f('close crosses above open')).toBe('crossOver(close, open)')
    expect(f('close crosses below open')).toBe('crossUnder(close, open)')
    // ⭐ BARE `crosses` IS "EITHER DIRECTION", and the disjunction of the two
    // named crossings is exactly that sentence — not a third convention. The
    // prior-bar edge is this engine's (`crossOver` is `a > b && a[1] <= b[1]`),
    // which the module header states out loud.
    expect(f('close crosses open')).toBe('crossOver(close, open) || crossUnder(close, open)')
  })

  it('`%` is the engine\'s `mod`, which is a FUNCTION rather than an operator', () => {
    // The reference's Arithmetic Operators page (fetched 2026-08-26) reads `%` →
    // "remainder"; `closedTable.json` reads `mod` → "the remainder of {0} divided
    // by {1}". One identity, and the printed text names the function a member can
    // then read in the formula box.
    expect(f('close % 2')).toBe('mod(close, 2)')
    expect(f('close % 2 == 0')).toBe('mod(close, 2) == 0')
  })
})

describe('bar offsets', () => {
  const f = (expr) => translateThinkScript(`plot p = ${expr};\n`).outputs[0].formula

  it('`x[n]` is the engine\'s own offset node, spelled the same way', () => {
    expect(f('close[1]')).toBe('close[1]')
    expect(f('close - close[2]')).toBe('close - close[2]')
  })

  it('`[0]` folds away — one column can never have two hashes', () => {
    expect(f('close[0] > open[0]')).toBe('close > open')
  })

  it('an offset of a DEFINED NAME is an offset of its whole expression', () => {
    const out = translateThinkScript('def a = high - low;\nplot p = a[1] > 0;\n')
    expect(out.outputs[out.selected].formula).toBe('(high - low)[1] > 0')
  })

  it('an offset whose index is a FOLDED INPUT reduces, exactly as a length does', () => {
    const out = translateThinkScript('input n = 3;\nplot p = close - close[n];\n')
    expect(out.outputs[out.selected].formula).toBe('close - close[3]')
  })

  it('⛔ a FUTURE offset refuses by name at the index — 23-previous-day writes `c[-1]`', () => {
    const r = translateThinkScript('plot p = close[-1];\n').refusal
    expect(r.guard).toBe('thinkscript:future-offset')
    expect(r.line).toBe(1)
  })

  it('⛔ an index that cannot reduce to a whole number refuses at the index', () => {
    const r = translateThinkScript('def n = Average(close, 3);\nplot p = close[n];\n').refusal
    expect(r.guard).toBe('thinkscript:offset-literal')
  })
})

describe('named arguments resolve by the DECLARED parameter order', () => {
  it('`StDev(data = x, length = n)` is `stdev(x, n)` whatever order they are written in', () => {
    const a = translateThinkScript('plot p = StDev(data = close, length = 20);\n').outputs[0].formula
    const b = translateThinkScript('plot p = StDev(length = 20, data = close);\n').outputs[0].formula
    expect(a).toBe('stdev(close, 20)')
    expect(b).toBe(a)
  })

  it('a QUOTED argument name is the same name — 19 writes `MovAvgExponential("length" = 21)`', () => {
    expect(translateThinkScript('plot p = Highest("data" = close, "length" = 5);\n').outputs[0].formula)
      .toBe('highest(close, 5)')
  })

  it('⛔ an argument name the function does not declare refuses BY NAME', () => {
    const r = translateThinkScript('plot p = Average(source = close, length = 5);\n').refusal
    expect(r.guard).toBe('thinkscript:named-argument')
    expect(r.token).toBe('source')
  })

  it('⭐ …and the SAME call with the declared name translates — the guard did not simply start refusing', () => {
    // ⛔ THE OVER-REFUSAL DIRECTION. A guard that refuses every named argument
    // also "passes" the test above, and W3.3's most valuable mutation was exactly
    // this shape: emptying an arm list reds five tests, which is how you know a
    // guard is a guard and not a wall.
    expect(translateThinkScript('plot p = Average(data = close, length = 5);\n').outputs[0].formula)
      .toBe('sma(close, 5)')
  })

  it('positionals fill the slots the names left open, left to right', () => {
    expect(translateThinkScript('plot p = Average(close, length = 5);\n').outputs[0].formula)
      .toBe('sma(close, 5)')
    expect(translateThinkScript('plot p = Average(close, 5);\n').outputs[0].formula)
      .toBe('sma(close, 5)')
  })

  it('⛔ one slot filled TWICE refuses — a second value for `data` is not a second argument', () => {
    const r = translateThinkScript('plot p = Average(close, data = open);\n').refusal
    expect(r.guard).toBe('thinkscript:arity')
  })

  it('⛔ …and so does a call handed more values than the shape declares', () => {
    const r = translateThinkScript('plot p = Average(close, 5, 9);\n').refusal
    expect(r.guard).toBe('thinkscript:arity')
    expect(r.token).toBe('Average')
  })

  it('⭐ a DOCUMENTED default fills a missing argument; a parameter with NONE refuses', () => {
    // ⛔ A GUESSED DEFAULT IS INVISIBLE IN THE RESULT — the member gets a window
    // they never asked for and never see — so a parameter only fills from a
    // number the reference actually publishes.
    // ⚠️⚠️ AND W3.4 HAD THIS BACKWARDS FOR `StDev`. It shipped `defaults: {}` on
    // the claim that the page published none, so `StDev(close)` OVER-REFUSED
    // `:arity`; the page its own `cite` names reads "Default values: length: 12".
    // Worse than the miss: the mutation sweep then railed the wrong reading in
    // place, which is how a wrong answer stops being re-checked. Fix round 1.
    expect(translateThinkScript('plot p = Average(close);\n').outputs[0].formula)
      .toBe('sma(close, 12)')
    expect(translateThinkScript('plot p = Highest(high);\n').outputs[0].formula)
      .toBe('highest(high, 12)')
    expect(translateThinkScript('plot p = StDev(close);\n').outputs[0].formula)
      .toBe('stdev(close, 12)')
    // ⭐ AND THE OTHER DIRECTION, which is now a REAL case rather than a wrong
    // one: `data` has no published default on any of these pages, so a call that
    // omits it refuses at the call rather than inventing a series.
    const r = translateThinkScript('plot p = Average();\n').refusal
    expect(r.guard).toBe('thinkscript:arity')
    expect(r.token).toBe('Average')
  })

  it('⛔ a length that is not a written whole number refuses AT THE LENGTH', () => {
    // ⛔ `lint.js::resolveDeclaration` answers UNKNOWN for a window that is not a
    // `num` node, which fails the whole tree closed to `repaints` at the save
    // door. Refusing here names the length; refusing there would name the badge.
    const computed = translateThinkScript('def n = close - open;\nplot p = Average(close, n);\n').refusal
    expect(computed.guard).toBe('thinkscript:window')
    const fractional = translateThinkScript('plot p = Average(close, 5.5);\n').refusal
    expect(fractional.guard).toBe('thinkscript:window')
    const negative = translateThinkScript('plot p = Average(close, -5);\n').refusal
    expect(negative.guard).toBe('thinkscript:window')
    // ⭐ AND THE CONTROL: a folded input length is a written whole number by the
    // time the engine sees it, so this guard must not eat the commonest shape in
    // the corpus.
    expect(translateThinkScript('input len = 50;\nplot p = Average(close, len);\n')
      .outputs[0].formula).toBe('sma(close, 50)')
  })

  it('⛔ `within N bars` needs a positive whole number too, and says `:window` when it has none', () => {
    for (const bad of ['close > open within 0 bars', 'close > open within 2.5 bars']) {
      const r = translateThinkScript(`plot p = ${bad};\n`).refusal
      expect(r.guard, bad).toBe('thinkscript:window')
    }
    // the control — the same phrase with a real count still translates
    expect(translateThinkScript('plot p = close > open within 4 bars;\n').outputs[0].formula)
      .toBe('highest(close > open, 4) > 0')
  })
})

describe('the CALL SHAPES this task maps, and the promise each one makes', () => {
  // ⚠️ THE ARITY RAIL THAT LIVED HERE HAS MOVED, AND IT MOVED BECAUSE IT WENT
  // RED EXACTLY WHERE IT SAID IT WOULD. W3.4 asserted `shape.params.length ===
  // TABLE.functions[shape.engine].args.length` and wrote beside it that
  // `ATR(length)` → `atr(high, low, close, n)` would turn it red, and that the
  // red was "the notification, not a bug". W3.5's answer is the explicit argument
  // plan railed in `THE ARGUMENT PLAN` at the foot of this file — stronger in
  // both directions than the one-for-one count, which could only ever have been
  // satisfied by shapes that happened to line up. ⛔ It is NOT deleted: replacing
  // a rail with a weaker one is how a notification gets silenced. Read it there.
  it('⛔ a call this task has NOT mapped still refuses at its own name', () => {
    // ⭐ THE WALL DID NOT DISAPPEAR, IT MOVED. `TTM_Squeeze` is proprietary and
    // thinkorswim publishes no formula for it, so it refuses here and will refuse
    // in every later task too.
    const r = translateThinkScript('plot p = TTM_Squeeze(close, 20);\n').refusal
    expect(r.guard).toBe('thinkscript:function')
    expect(r.token).toBe('TTM_Squeeze')
  })
})

describe('the round trip is the proof that nothing half-translated', () => {
  it('every formula this module emits reads back as the SAME tree', () => {
    for (const expr of ['close > open + 1 and low < high', 'if close > open then 1 else 0',
      'close[1] * -2', 'close between low and high', 'close > open within 3 bars',
      'close crosses above open', 'close % 2 == 0', 'Average(close, 20) > StDev(close, 20)']) {
      const out = translateThinkScript(`plot p = ${expr};\n`)
      const row = out.outputs[0]
      expect(row.refusal, expr).toBe(null)
      expect(astHashOf(row.formula), expr).toBe(astHashOf(printFormulaOf(row.ast)))
    }
  })

  it('⭐ and the whole-script path emits the same text for a member as for a rail', () => {
    // ⛔ NOT A TAUTOLOGY DRESSED AS A RAIL. `formulaOf` walks the door's own
    // `selected` index, which is what `ImportBox` reads; the row above reads
    // `outputs[0]`. A door that selected the wrong column would pass one and fail
    // the other.
    expect(formulaOf('def a = Average(close, 50);\nplot scan = close > a;\n'))
      .toBe('close > sma(close, 50)')
  })
})

// ─────────────────────────────────────────────────────────────────────────── //
// W3.5 — THE FUNCTION MAP
// ─────────────────────────────────────────────────────────────────────────── //
//
// ⛔⛔ EVERY `it` BELOW NAMES THE PAGE ITS IDENTITY CAME FROM, and that is the
// acceptance criterion rather than decoration. W3.4's Critical was a comment
// claiming the language "does not publish a precedence table" — it publishes a
// twelve-level one — and that false sentence is WHY nobody looked. So each row
// here quotes what was fetched (2026-08-26, toslc.thinkorswim.com), and where no
// quote could be found the identity is REFUSED BY NAME instead of guessed.
//
// ⭐ AND EVERY MAPPING IS CHECKED NUMERICALLY IN BOTH DIRECTIONS in
// `the maths, measured on real bars` at the foot of this file. A one-directional
// test blesses the inverse bug: W3.4 shipped an enum defect whose `!=` form
// failed the opposite way and passed every rail it had.

/** The refusal a whole script came back with, or `null`. */
const refusalOf = (src) => translateThinkScript(src).refusal

describe('the function map — mapped ONLY where thinkorswim publishes the same maths', () => {
  const f = (expr) => translateThinkScript(`plot p = ${expr};\n`).outputs[0].formula
  const guard = (expr) => translateThinkScript(`plot p = ${expr};\n`).refusal.guard

  // Functions/Tech-Analysis/Average — "Returns the average value of a set of data
  // for the last `length` bars", formula `Sum(data, length) / length`, length 12.
  it('Average → sma', () => expect(f('Average(close, 50)')).toBe('sma(close, 50)'))

  // Functions/Math---Trig/Sum — "Returns the sum of values for the specified
  // number of bars. The default value of `length` is `12`."
  it('Sum → sum', () => expect(f('Sum(volume, 14)')).toBe('sum(volume, 14)'))

  // Functions/Tech-Analysis/Highest & /Lowest — "the highest|lowest value of
  // `data` for the last `length` bars"; length default 12.
  it('Highest / Lowest → highest / lowest', () => {
    expect(f('Highest(high, 52)')).toBe('highest(high, 52)')
    expect(f('Lowest(low, 20)')).toBe('lowest(low, 20)')
  })

  // Functions/Statistical/StDev — the page reimplements itself as
  // `Sqrt(Average(Sqr(data), length) - Sqr(Average(data, length)))`, divided by
  // `length` both times, i.e. the POPULATION deviation — which is the divisor
  // `closedTable.json::_functions_excluded.variance` declares for `stdev`.
  it('StDev → stdev (both are the population divisor n)', () =>
    expect(f('StDev(close, 20)')).toBe('stdev(close, 20)'))

  // Functions/Tech-Analysis/WildersAverage — "the Wilder's Moving Average of
  // `data` with a smoothing coefficient that equals `1/length`… The first value
  // is calculated as the simple moving average and then all values are
  // calculated as the exponential moving average." `_functions_smoothing` states
  // OUR `rma` identically: alpha `1/n`, seed = the mean of the first full window.
  it('WildersAverage → rma, and the seed matches too', () =>
    expect(f('WildersAverage(close, 14)')).toBe('rma(close, 14)'))

  // Functions/Tech-Analysis/ExpAverage — "α is a smoothing coefficient equal to
  // `2/(length + 1)`", and "EMA1 = price1".
  it('ExpAverage → ema, with the SEED difference recorded as a note', () => {
    const out = translateThinkScript('plot p = ExpAverage(close, 12);\n')
    expect(out.outputs[0].formula).toBe('ema(close, 12)')
    // ⚠️ thinkorswim seeds on the FIRST PRICE; this engine seeds on the mean of
    // the first full window (`_functions_smoothing`). Same alpha, different first
    // window, converging — the identical relationship `_functions_atr_convention`
    // already records against Pine. It is SAID, not hidden.
    expect(out.ignored.some((n) => n.code === 'thinkscript:note-seed')).toBe(true)
  })

  it('⭐ the seed note is attached to the CALL, not to the script', () => {
    // A script with no ExpAverage in it must not carry the note, or the note
    // stops meaning anything and a member learns to skip the list.
    expect(translateThinkScript('plot p = Average(close, 12);\n')
      .ignored.some((n) => n.code === 'thinkscript:note-seed')).toBe(false)
    // …and WildersAverage does NOT carry it: that one is exact on both sides.
    expect(translateThinkScript('plot p = WildersAverage(close, 12);\n')
      .ignored.some((n) => n.code === 'thinkscript:note-seed')).toBe(false)
  })

  // Functions/Math---Trig/AbsValue — "Returns the absolute value of an argument."
  // /Sqrt — "Calculates the square root of an argument."
  // /Sqr — "Calculates the square of an argument."  (an identity in `pow`)
  // /Power — "the value of the first argument raised to the power of the second".
  // /Log — "Returns the NATURAL logarithm of an argument."
  // /Max, /Min — "Returns the greater|smaller of two values."
  it('AbsValue / Sqrt / Sqr / Power / Log / Max / Min', () => {
    expect(f('AbsValue(close - open)')).toBe('abs(close - open)')
    expect(f('Sqrt(close)')).toBe('sqrt(close)')
    expect(f('Sqr(close)')).toBe('pow(close, 2)')
    expect(f('Power(close, 2)')).toBe('pow(close, 2)')
    expect(f('Log(close)')).toBe('ln(close)')
    expect(f('Max(close, open)')).toBe('max(close, open)')
    expect(f('Min(close, open)')).toBe('min(close, open)')
  })

  // Functions/Math---Trig/IsNaN — "evaluates whether a specified parameter is not
  // a number". `closedTable::_functions_na` — `na` "INSPECTS that state", yields
  // bool.
  it('IsNaN → na', () => expect(f('IsNaN(close)')).toBe('na(close)'))

  // Functions/Math---Trig/Round — `numberOfDigits` DEFAULT VALUE 2 (read off the
  // page's own Default-value column); this table's `round` is round-to-whole.
  it('Round(x, 0) maps; ⛔ any other digit count refuses', () => {
    expect(f('Round(close, 0)')).toBe('round(close)')
    expect(guard('Round(close, 2)')).toBe('thinkscript:function')
    // ⛔ AND THE BARE FORM REFUSES, which is the case that matters: the page's
    // published default is TWO, so `Round(close)` is `Round(close, 2)` and is
    // NOT this engine's `round`. Mapping it would round to a whole number while
    // the member asked for two decimals — silent, and wrong on nearly every bar.
    expect(guard('Round(close)')).toBe('thinkscript:function')
  })
})

describe('MovingAverage — the enum dispatch, on thinkorswim`s own five constants', () => {
  const f = (expr) => translateThinkScript(`plot p = ${expr};\n`).outputs[0].formula

  // Functions/Tech-Analysis/MovingAverage — `MovingAverage(int averageType,
  // IDataHolder data, int length)`, "Available average types are: Simple,
  // Exponential, Weighted, Wilder's, and Hull", `averageType` default
  // `AverageType.Simple`, `length` default 12.
  // Constants/AverageType lists the five arms: EXPONENTIAL HULL SIMPLE WEIGHTED
  // WILDERS.
  it('dispatches on the enum', () => {
    expect(f('MovingAverage(AverageType.SIMPLE, close, 10)')).toBe('sma(close, 10)')
    expect(f('MovingAverage(AverageType.EXPONENTIAL, close, 10)')).toBe('ema(close, 10)')
    expect(f('MovingAverage(AverageType.WILDERS, close, 10)')).toBe('rma(close, 10)')
    expect(f('MovingAverage(AverageType.WEIGHTED, close, 10)')).toBe('wma(close, 10)')
  })

  it('the PUBLISHED default is Simple, and the published length is 12', () => {
    // ⚠️ `averageType` IS THE FIRST PARAMETER, so the default is reachable only
    // by naming the others — `MovingAverage(close)` means averageType = close,
    // which is what thinkorswim would read too, and it refuses below.
    expect(f('MovingAverage(data = close)')).toBe('sma(close, 12)')
    expect(f('MovingAverage(data = close, length = 20)')).toBe('sma(close, 20)')
    expect(f('MovingAverage(AverageType.SIMPLE, close)')).toBe('sma(close, 12)')
  })

  it('⛔ HULL refuses — this engine declares no `hma`, MEASURED not assumed', () => {
    const r = translateThinkScript('plot p = MovingAverage(AverageType.HULL, close, 10);\n').refusal
    expect(r.guard).toBe('thinkscript:function')
    expect(r.message).toMatch(/HULL/i)
    // ⭐ AND IT IS DERIVED: the day `hma` lands in the manifest this refusal must
    // stop, with no edit in `thinkscript.js`. The arm maps to the NAME `hma`, and
    // `engineCall`'s table lookup is what refuses.
    expect(Object.keys(TABLE.functions)).not.toContain('hma')
    expect(r.message).toContain('hma')
  })

  it('⭐ an averageType that is a FOLDED INPUT dispatches on the folded value', () => {
    expect(translateThinkScript(
      'input at = AverageType.WILDERS;\nplot p = MovingAverage(at, close, 5);\n')
      .outputs[0].formula).toBe('rma(close, 5)')
  })

  it('⛔ an arm thinkorswim does not publish refuses, rather than falling back to Simple', () => {
    // ⛔ THE FAILURE DIRECTION THAT MATTERS. Falling back to the default here
    // would answer `sma` for a member who asked for something else — a chart that
    // looks right and is wrong, which is the one outcome this door exists against.
    const r = translateThinkScript('plot p = MovingAverage(AverageType.TRIANGULAR, close, 10);\n').refusal
    expect(r.guard).toBe('thinkscript:enum-arm')
  })

  it('⛔ a value that is not an AverageType at all refuses', () => {
    expect(translateThinkScript('plot p = MovingAverage(close, close, 10);\n').refusal.guard)
      .toBe('thinkscript:enum-arm')
    expect(translateThinkScript('input at = {default UseA, UseB};\nplot p = MovingAverage(at, close, 10);\n')
      .refusal.guard).toBe('thinkscript:enum-arm')
  })
})

describe('TrueRange — the page publishes its own reimplementation, and this emits THAT', () => {
  const f = (expr) => translateThinkScript(`plot p = ${expr};\n`).outputs[0].formula

  // Functions/Tech-Analysis/TrueRange — `TrueRange(IDataHolder high, IDataHolder
  // close, IDataHolder low)` — NOTE THE ORDER — and the page's own Example is
  //   script TrueRangeTS { input high = high; input close = close; input low = low;
  //     plot TrueRangeTS = Max(close[1], high) - Min(close[1], low); }
  // followed by "The resulting plots coincide forming a single curve."
  //
  // ⛔ THAT SENTENCE IS THE CITATION, and it is why this emits the page's form
  // rather than Pine's three-way `max(h - l, max(|h - c1|, |l - c1|))`. The brief
  // asked for Pine's; the page publishes its own, node for node, and asserts the
  // two curves coincide. Both were measured equal on the shared parity series
  // (0 differing bars of 579) — see the numeric block — so this is a choice of
  // which quotation to emit, not a change of maths.
  it('⭐ expands to the page`s own formula, by role, in thinkorswim`s order (h, c, l)', () => {
    expect(f('TrueRange(high, close, low)')).toBe('max(close[1], high) - min(close[1], low)')
  })

  it('⛔ the roles in another order are a DIFFERENT tree, and it says so', () => {
    // The parameter names are POSITIONS, so a member who wrote them in Pine's
    // order gets Pine's order translated literally rather than silently repaired.
    expect(f('TrueRange(high, low, close)')).toBe('max(low[1], high) - min(low[1], close)')
  })

  it('named arguments reach the same tree in any written order', () => {
    expect(f('TrueRange(low = low, high = high, close = close)'))
      .toBe('max(close[1], high) - min(close[1], low)')
  })

  it('⛔ no parameter has a published default, so an incomplete call refuses', () => {
    expect(translateThinkScript('plot p = TrueRange(high, close);\n').refusal.guard)
      .toBe('thinkscript:arity')
  })

  it('⭐ the shared `close[1]` is ONE node, so the budget counts it once', () => {
    const out = translateThinkScript('plot p = TrueRange(high, close, low);\n')
    const t = out.outputs[0].ast
    expect(t.args[0].args[0]).toBe(t.args[1].args[0])
  })
})

describe('ATR — the study whose OWN description publishes both of its defaults', () => {
  const f = (expr) => translateThinkScript(`plot p = ${expr};\n`).outputs[0].formula

  // Tech-Indicators/studies-library/A-B/ATR — "By default, the average true range
  // is a 14-period Wilder's moving average of this value; both the period and the
  // type of moving average can be customized using the study input parameters."
  // `closedTable::_functions_atr_convention` proves OUR `atr` IS Wilder's to
  // 5.4e-16 over 565 bars against an independent construction.
  it('ATR → atr(high, low, close, n) — both defaults come off that sentence', () => {
    expect(f('ATR(14)')).toBe('atr(high, low, close, 14)')
    expect(f('ATR(length = 14)')).toBe('atr(high, low, close, 14)')
    expect(f('ATR()')).toBe('atr(high, low, close, 14)')
    expect(f('ATR(20)')).toBe('atr(high, low, close, 20)')
  })

  it('⛔ ATR asked for another averageType refuses rather than returning Wilder`s', () => {
    const r = translateThinkScript('plot p = ATR(14, AverageType.SIMPLE);\n').refusal
    expect(r.guard).toBe('thinkscript:function')
    expect(r.message).toMatch(/SIMPLE/i)
    // …and the WILDERS spelling written out explicitly is the same call as the
    // default, not a second answer.
    expect(f('ATR(14, AverageType.WILDERS)')).toBe('atr(high, low, close, 14)')
  })
})

describe('the refusals this map makes BY NAME, and why each one is a refusal', () => {
  const guard = (expr) => translateThinkScript(`plot p = ${expr};\n`).refusal.guard

  it('⛔ HighestAll / LowestAll refuse with the bounded-form sentence', () => {
    // Functions/Tech-Analysis/HighestAll — "Returns the highest value of `data`
    // for ALL BARS IN THE CHART". ⛔ That makes the answer depend on the request
    // (`lesson_a_derived_value_must_not_depend_on_the_request`), which is the
    // same reason `closedTable` excludes `obv`.
    for (const call of ['HighestAll(high)', 'LowestAll(low)']) {
      const r = translateThinkScript(`plot p = ${call};\n`).refusal
      expect(r.guard, call).toBe('thinkscript:function')
      expect(r.message, call).toMatch(/every bar|whole chart|how many bars/i)
      expect(r.message, call).toMatch(/Highest\(|Lowest\(/)
    }
  })

  it('⛔ Floor refuses — this engine declares no `floor` callable, measured', () => {
    // Functions/Math---Trig/Floor — "Rounds a value down to the nearest integer".
    // There is no `floor` in `closedTable.functions`, and `round` is round-to-
    // whole (half away from zero), which is a DIFFERENT function on every value
    // whose fraction is ≥ .5. Mapping it would be wrong on about half of all bars.
    expect(guard('Floor(close)')).toBe('thinkscript:function')
    expect(Object.keys(TABLE.functions)).not.toContain('floor')
    expect(Object.keys(TABLE.functions)).not.toContain('ceil')
  })

  it('⛔⛔ RSI refuses BY NAME — the study page publishes NO default for `length` or `price`', () => {
    // ⛔ THIS CORRECTS THE LANE BRIEF, and the correction is a measurement.
    // The brief's reference table says `RSI(length=, price=)` → `rsi(price,
    // length)`. Fetched 2026-08-26, the RSI study page's Input Parameters table
    // has NO "Default value" column at all (unlike every thinkScript FUNCTIONS
    // page, which does), and its description publishes defaults only for the
    // over-bought level (70), the over-sold level (30) and the average type
    // (Wilder's). `length` and `price` have none.
    // ⇒ `RSI()` cannot be mapped without inventing 14 and `close`, and inventing
    // semantics without a citation is the exact risk this door exists against.
    const r = translateThinkScript('plot p = RSI() crosses above 30;\n').refusal
    expect(r.guard).toBe('thinkscript:function')
    expect(r.token).toBe('RSI')
    // ⭐ AND THE CONTROL: the engine DOES declare `rsi`, so this is a refusal
    // about a missing CITATION, never about a missing function.
    expect(Object.keys(TABLE.functions)).toContain('rsi')
  })

  it('⛔ a call the manifest does NOT declare refuses at its own token', () => {
    const r = translateThinkScript('plot p = InertiaAll(close);\n').refusal
    expect(r.guard).toBe('thinkscript:function')
    expect(r.token).toBe('InertiaAll')
    expect(r.column).toBe(10)
  })

  it('⛔ the wrong number of arguments refuses BY NAME, not by mis-mapping', () => {
    expect(guard('Average(close, 5, 3)')).toBe('thinkscript:arity')
    expect(guard('Sqrt(close, 2)')).toBe('thinkscript:arity')
    expect(guard('Max(close)')).toBe('thinkscript:arity')
  })

  it('⛔ a length that is not a written whole number refuses', () => {
    expect(guard('Average(close, high)')).toBe('thinkscript:window')
    expect(guard('Sum(volume, high)')).toBe('thinkscript:window')
  })
})

describe('⭐⭐ THE ARGUMENT PLAN — the answer to the arity rail W3.4 left red on purpose', () => {
  // W3.4 asserted `shape.params.length === TABLE.functions[shape.engine].args
  // .length` and said in its own comment that `ATR(length)` → `atr(high, low,
  // close, n)` would turn it red, and that the red was "the notification, not a
  // bug". The notification arrived — and not only for ATR: `MovingAverage` has
  // three parameters for two engine arguments, `Round` two for one, `Sqr` one for
  // two, `TrueRange` three for no single call at all.
  //
  // ⭐ SO THE PLAN IS DECLARED PER ENGINE ARGUMENT, AND CHECKED BOTH WAYS. A
  // shape carries `args[]` — one entry per ENGINE argument, in engine order —
  // where each entry is `{from: <a thinkorswim parameter>}`, `{series: <a bar
  // field the engine declares and the thinkorswim call does not carry>}` or
  // `{const: <a literal the identity requires>}`. Every thinkorswim parameter
  // must then be accounted for exactly once: consumed by an `args` entry, listed
  // in `gates` (checked but contributing no node), or listed in `unused` with the
  // reason. Nothing may be silently dropped — a dropped parameter IS the silent
  // mistranslation this rail exists to catch.

  const enginesOf = (shape) => (shape.dispatch ? Object.values(shape.dispatch)
    : shape.engine ? [shape.engine] : (shape.engines || []))

  it('⛔ every engine name a shape names is one the CLOSED TABLE declares', () => {
    const missing = []
    for (const [k, s] of Object.entries(TS_CALL_SHAPES)) {
      for (const e of enginesOf(s)) {
        // ⭐ `hull → hma` is DELIBERATELY exempt: the arm names an engine the
        // table has not declared yet, and the refusal is the table lookup itself.
        if (s.pending && s.pending.includes(e)) continue
        if (!Object.prototype.hasOwnProperty.call(TABLE.functions, e)) missing.push(`${k} → ${e}`)
      }
    }
    expect(missing).toEqual([])
    expect(Object.keys(TS_CALL_SHAPES).length).toBeGreaterThan(15)
  })

  it('⛔ every shape CITES the page it was read from', () => {
    for (const [name, shape] of Object.entries(TS_CALL_SHAPES)) {
      expect(typeof shape.cite, name).toBe('string')
      expect(shape.cite.length, name).toBeGreaterThan(40)
      expect(new Set(shape.params).size, `${name} declares a parameter twice`).toBe(shape.params.length)
    }
  })

  it('⛔ every ENGINE argument is filled, and the plan agrees with the engine`s own argRoles', () => {
    let checked = 0
    for (const [name, shape] of Object.entries(TS_CALL_SHAPES)) {
      if (shape.refuse) continue
      if (shape.expand) {
        // ⚠️ AN EXPANSION FILLS NO SINGLE ENGINE ARITY — `TrueRange` becomes a
        // subtraction of two calls — so its plan is one entry per thinkorswim
        // PARAMETER and every entry must be a `from`. Nothing is invented inside
        // an expansion either: its engine names are checked above.
        expect(argumentPlan(shape), `${name} is an expansion`).toBe(null)
        expect(shape.args.map((a) => a.from), name).toEqual(shape.params)
        checked += 1
        continue
      }
      for (const engine of enginesOf(shape)) {
        if (shape.pending && shape.pending.includes(engine)) continue
        const spec = TABLE.functions[engine]
        const plan = argumentPlan(shape)
        expect(plan, `${name} has no argument plan`).not.toBe(null)
        expect(plan.length, `${name} → ${engine}`).toBe(spec.args.length)
        plan.forEach((a, i) => {
          if (a.series === undefined) return
          // ⭐ A SUPPLIED BAR FIELD IS CROSS-CHECKED AGAINST THE ENGINE'S OWN
          // DECLARED ROLE, so `atr`'s (high, low, close) order is read off the
          // table rather than retyped here. Swap two and this reds by name.
          expect(Object.keys(TABLE.series), `${name}.args[${i}]`).toContain(a.series)
          expect(spec.argRoles[i], `${name}.args[${i}] fills ${engine}`).toBe(a.series)
        })
        checked += 1
      }
    }
    // non-vacuity: the sweep looked at real shapes, not at an empty map
    expect(checked).toBeGreaterThan(15)
  })

  it('⭐ a recurrence`s POSITIONS come from the table, not from this file', () => {
    // ⛔ `compoundvalue` declares `argsByRole`, and `argumentPlan` turns roles
    // into indices through `closedTable.json::accum.recurrence`. Move the seed
    // and the body in the manifest and the plan follows with no edit here.
    const shape = TS_CALL_SHAPES.compoundvalue
    const spec = TABLE.functions.accum
    const plan = argumentPlan(shape)
    expect(plan[spec.recurrence.seed]).toEqual({ from: 'historical data' })
    expect(plan[spec.recurrence.body]).toEqual({ from: 'visible data' })
    expect(plan[spec.recurrence.warmup]).toEqual({ const: TS_STATE_WARMUP })
    // …and the CONTROL: a table whose recurrence names other slots produces
    // another plan, so the indices above are not three constants in disguise.
    const swapped = {
      ...TABLE,
      functions: {
        ...TABLE.functions,
        accum: { ...spec, recurrence: { ...spec.recurrence, seed: 1, body: 0 } },
      },
    }
    expect(argumentPlan(shape, swapped)[0]).toEqual({ from: 'visible data' })
  })

  it('⛔ every thinkorswim PARAMETER is accounted for exactly once', () => {
    for (const [name, shape] of Object.entries(TS_CALL_SHAPES)) {
      if (shape.refuse) continue
      const consumed = (argumentPlan(shape) || shape.args || [])
        .filter((a) => a.from).map((a) => a.from)
      const gated = Object.keys(shape.gates || {})
      const unused = Object.keys(shape.unused || {})
      const all = [...consumed, ...gated, ...unused]
      expect(new Set(all).size, `${name} accounts for a parameter twice`).toBe(all.length)
      expect([...all].sort(), `${name} leaves a parameter unaccounted for`)
        .toEqual([...shape.params].sort())
      // ⛔ AND AN IGNORED PARAMETER MUST SAY WHY, in a sentence long enough to be
      // a reason rather than a shrug.
      for (const [p, why] of Object.entries(shape.unused || {})) {
        expect(typeof why, `${name}.unused.${p}`).toBe('string')
        expect(why.length, `${name}.unused.${p}`).toBeGreaterThan(30)
      }
    }
  })

  it('⛔ every DEFAULT names a parameter the shape declares', () => {
    for (const [name, shape] of Object.entries(TS_CALL_SHAPES)) {
      for (const p of Object.keys(shape.defaults || {})) {
        expect(shape.params, `${name} defaults an undeclared parameter ${p}`).toContain(p)
      }
    }
  })

  it('the table is frozen, so a caller cannot map a function out from under a rail', () => {
    expect(Object.isFrozen(TS_CALL_SHAPES)).toBe(true)
  })

  it('⭐ THE MAP IS DERIVED: a function the MANIFEST gains is callable with no edit here', () => {
    // ⛔⛔ THIS CORRECTS THE LANE BRIEF, WHICH ASKED FOR A NAME FALLBACK.
    // `pine.js` maps any `ta.<name>` straight onto `TABLE.functions` and its own
    // rail invents `ta.zigzaggery` to prove it. That is safe in Pine because the
    // `ta.` namespace makes "this is an engine function" explicit. thinkScript
    // has NO namespace, and the same trick here is a mistranslation machine:
    // `MACD(12, 26, 9)` is thinkorswim's MACD study with fast 12 / slow 26 /
    // signal 9, while this engine's `macd(series, int, int)` would read it as the
    // MACD **of the number 12**. That parses, prints, round-trips and saves.
    expect(translateThinkScript('plot p = MACD(12, 26, 9);\n').refusal.guard)
      .toBe('thinkscript:function')
    expect(Object.keys(TABLE.functions)).toContain('macd')

    // ⭐ SO THE DERIVED CLAIM IS MADE THE SAFE WAY, AND IT IS STILL MEASURED: a
    // MAPPED identity names a table KEY and looks it up at call time, so a
    // manifest that gains `hma` makes `AverageType.HULL` translate with no edit
    // in `thinkscript.js`.
    const withHull = {
      ...TABLE,
      functions: {
        ...TABLE.functions,
        hma: {
          args: ['series', 'int'], lookback: 'arg1', yields: 'num',
          argRoles: ['source', 'period'], sentence: 'the {1}-bar Hull average of {0}',
        },
      },
    }
    const out = translateThinkScript(
      'plot p = MovingAverage(AverageType.HULL, close, 9);\n', { table: withHull })
    expect(out.ok).toBe(true)
    expect(out.outputs[0].formula).toBe('hma(close, 9)')
    // ⛔ …and the CONTROL: against the shipped manifest the same paste refuses,
    // so the case above cannot pass for a translator that accepts every name.
    expect(translateThinkScript('plot p = MovingAverage(AverageType.HULL, close, 9);\n')
      .refusal.guard).toBe('thinkscript:function')
  })

  it('⛔ every name this task looked up and REFUSED is written down, with its reason', () => {
    // ⭐ A REFUSAL NOBODY RECORDED GETS RE-LITIGATED AS AN OVERSIGHT. Each of
    // these was fetched before it was refused, and each still refuses at its own
    // token today.
    expect(Object.keys(TS_UNCITED).length).toBeGreaterThan(5)
    for (const [name, why] of Object.entries(TS_UNCITED)) {
      expect(why.length, name).toBeGreaterThan(60)
      expect(Object.keys(TS_CALL_SHAPES), `${name} is both mapped and refused`)
        .not.toContain(name.toLowerCase())
      const r = translateThinkScript(`plot p = ${name}(close, 5);\n`).refusal
      expect(r.guard, name).toBe('thinkscript:function')
      expect(r.token, name).toBe(name)
    }
  })

  it('⛔ a call this task has NOT mapped still refuses at its own name', () => {
    const r = translateThinkScript('plot p = TTM_Squeeze(close, 20);\n').refusal
    expect(r.guard).toBe('thinkscript:function')
    expect(r.token).toBe('TTM_Squeeze')
  })
})

describe('state — CompoundValue is the accumulator; a SEEDLESS recursion is not', () => {
  const f = (src) => { const o = translateThinkScript(src); return o.outputs[o.selected].formula }

  // Functions/Others/CompoundValue — `CompoundValue(int length, IDataHolder
  // visible data, IDataHolder historical data)`, `length` default 1:
  // "if a bar number is greater than `length` then the `visible data` value is
  // returned, otherwise the `historical data` value is returned."
  // ⇒ the historical value IS the seed and the visible one IS the update, which
  // is exactly `accum(seed, update, warmup)`'s shape.
  it('⭐ CompoundValue(1, hold-or-replace, seed) is the accumulator', () => {
    expect(f('def c = CompoundValue(1, if close > open then close else c[1], 0);\nplot p = c;\n'))
      .toBe(`accum(0, close > open ? close : self, ${TS_STATE_WARMUP})`)
  })

  it('🔴🔴 THE OFF-BY-ONE RAIL — inside x`s own update, `x[1]` IS `self`, tree for tree', () => {
    // ⛔ thinkorswim counts from ONE here and this engine counts from ZERO. `x[1]`
    // is the value x held on the PREVIOUS bar, which is exactly what `self`
    // already is; `x[2]` is `self[1]`, and the mapping is `k - 1`. An off-by-one
    // reads a bar too far back on EVERY bar and still draws a plausible line.
    const spec = TABLE.functions.accum
    const one = translateThinkScript(
      'def y = CompoundValue(1, if close > open then close else y[1], 0);\nplot p = y;\n')
    const body = one.outputs[0].ast.args[spec.recurrence.body]
    expect(printFormula(body)).toBe(`close > open ? close : ${spec.recurrence.binds}`)
    // ⭐ AND IT IS BARE `self`, NOT `self[0]` OR `self[1]` — tree for tree against
    // what a bare self-reference is. Emit `k` instead of `k - 1` here and this
    // whole script starts refusing, which is how the mutation is caught.
    expect(astHash(body.args[2])).toBe(astHash(parseFormula(spec.recurrence.binds).ast))

    // ⚠️⚠️ AND THE HONEST HALF: `x[2]` IS WRITTEN AS `self[1]` AND IS UNREACHABLE
    // TODAY. `pine.js::forgetsItsSeed` — the ONE convergence rule, imported —
    // answers NO for any body in which `self` appears under an offset, because it
    // is conservative by construction. So a body reading two bars back refuses at
    // the gate rather than reaching the `k - 1`. That is a REFUSAL, never a wrong
    // column, and relaxing it belongs in `forgetsItsSeed` where both translators
    // read it — not in a second copy here.
    const two = translateThinkScript(
      'def y = CompoundValue(2, if close > open then close else y[2], 0);\nplot p = y;\n')
    expect(two.refusal.guard).toBe('thinkscript:state')
  })

  it('⭐ the accumulator`s positions come from the TABLE`s own `recurrence`, never typed', () => {
    const spec = TABLE.functions.accum
    const out = translateThinkScript(
      'def c = CompoundValue(1, if close > open then close else c[1], 0);\nplot p = c;\n')
    const call = out.outputs[0].ast
    expect(call.type).toBe('call')
    expect(call.name).toBe('accum')
    expect(printFormula(call.args[spec.recurrence.seed])).toBe('0')
    expect(call.args[spec.recurrence.warmup]).toEqual({ type: 'num', value: TS_STATE_WARMUP })
    expect(printFormula(call.args[spec.recurrence.body])).toContain(spec.recurrence.binds)
  })

  it('⛔⛔ an update that never FORGETS its seed refuses — measured, not assumed', () => {
    // 🔴 `accum` re-seeds a fixed number of bars back, so `self + volume` is a
    // 250-bar ROLLING SUM, not a running total. Measured on the shared parity
    // series: `accum(0, self + volume, 250)` matches a rolling 250-bar sum on
    // 579 of 579 bars and differs from the true cumulative sum on 579 of 579.
    // Translating thinkorswim's running total into it would be wrong on EVERY
    // bar while drawing a perfectly plausible line.
    // ⭐ THE GATE IS `pine.js::forgetsItsSeed`, IMPORTED — one rule, one owner.
    // Two copies of a convergence rule is how two translators come to disagree
    // about the same engine function.
    const r = refusalOf('def v = CompoundValue(1, v[1] + volume, 0);\nplot p = v;\n')
    expect(r.guard).toBe('thinkscript:state')
    expect(r.message).toMatch(/rolling|forget/i)
  })

  it('⛔ the reference`s own Fibonacci example refuses, and that is CORRECT', () => {
    // The CompoundValue page's example is `def x = CompoundValue(2, x[1] + x[2],
    // 1);`. It never forgets its seed, so the bounded accumulator cannot hold it:
    // measured, `accum(1, self + self[1], 250)` runs to 2.07e52 and flatlines.
    expect(refusalOf('def x = CompoundValue(2, x[1] + x[2], 1);\nplot p = x;\n').guard)
      .toBe('thinkscript:state')
  })

  it('⛔⛔ a SEEDLESS self-recursion refuses and names CompoundValue as the fix', () => {
    // ⛔ THIS IS A RULING, AND IT IS MEASURED. thinkorswim leaves an
    // uninitialised `x[1]` undefined on the first bars (tutorial ch.12), and this
    // engine's not-computable is `0 / 0`. But a NaN seed is only harmless for an
    // update that never READS self in the value it produces: measured,
    // `accum(0 / 0, close < self ? high : low, 250)` equals the zero-seeded form
    // on 0 of 579 bars' difference, while `accum(0 / 0, max(self, close), 250)`
    // is NaN on EVERY bar. There is no seed this translator may invent, so it
    // refuses and names the construct thinkorswim itself publishes for supplying
    // one.
    const r = refusalOf('def x = if close < x[1] then high else low;\nplot p = x;\n')
    expect(r.guard).toBe('thinkscript:state')
    expect(r.message).toMatch(/CompoundValue/)
  })

  it('⭐ two independent accumulators each own their own `self`', () => {
    const out = translateThinkScript(
      'def a = CompoundValue(1, if close > open then close else a[1], 0);\n'
      + 'def b = CompoundValue(1, if low < high then low else b[1], 1);\n'
      + 'plot p = a + b;\n')
    expect(out.outputs[0].formula)
      .toBe(`accum(0, close > open ? close : self, ${TS_STATE_WARMUP})`
        + ` + accum(1, low < high ? low : self, ${TS_STATE_WARMUP})`)
  })

  it('⛔ `self` outside its own update is not reachable at all', () => {
    // A member cannot type the accumulator's reserved name into a thinkScript
    // paste and reach the engine's binding: `self` is not a thinkorswim name.
    expect(refusalOf('plot p = self + 1;\n').guard).toBe('thinkscript:undefined')
  })

  it('⛔ a deep self-lag refuses at the GATE, and never reaches evaluation', () => {
    // `interpret.js::MAX_SELF_LAG` is 4, so `self[5]` would be refused at
    // EVALUATION — after a formula had already been offered to a member and
    // saved. The convergence gate refuses it at TRANSLATION instead, which is the
    // door a member is standing at.
    const r = refusalOf(
      'def x = CompoundValue(6, if close > open then close else x[6], 0);\nplot p = x;\n')
    expect(r).not.toBe(null)
    expect(r.guard).toBe('thinkscript:state')
  })

  it('⭐ the length argument is DECLARED unused, with the reason a member can read', () => {
    // thinkorswim's `length` says how many leading bars use the historical value;
    // this engine's warm-up is `accum`'s own, and the convergence gate above is
    // what makes the difference invisible after warm-up. Recorded as a note.
    const out = translateThinkScript(
      'def c = CompoundValue(9, if close > open then close else c[1], 0);\nplot p = c;\n')
    expect(out.outputs[0].formula).toBe(`accum(0, close > open ? close : self, ${TS_STATE_WARMUP})`)
    expect(out.ignored.some((n) => n.code === 'thinkscript:note-warmup')).toBe(true)
  })
})

describe('X21 — the constructed adversarial inputs the corpus is blind to', () => {
  // ⛔⛔ THE CORPUS IS HONEST ABOUT WHAT IT MEASURES AND BLIND TO WHOLE CLASSES
  // BESIDE IT. With either of W3.4's two mistranslations live, the corpus fixture
  // printed byte-identical output. Ten handled grammar features have no corpus
  // script that reaches them — `is true`/`is false` at published level 8 is an
  // entire precedence rung, and the six long word-spellings' longest-match guard
  // is reached by nothing. Every identity this task maps is exercised HERE,
  // against those rungs, because that intersection is what nothing else tests.
  const f = (expr) => translateThinkScript(`plot p = ${expr};\n`).outputs[0].formula

  it('a mapped call under the LONGEST word-spelling parses as the long operator', () => {
    expect(f('Average(close, 10) is greater than or equal to Average(close, 20)'))
      .toBe('sma(close, 10) >= sma(close, 20)')
    expect(f('Average(close, 10) is less than or equal to Average(close, 20)'))
      .toBe('sma(close, 10) <= sma(close, 20)')
    expect(f('Highest(high, 20) is not equal to Lowest(low, 20)'))
      .toBe('highest(high, 20) != lowest(low, 20)')
    // ⭐ AND THE SHORT PREFIXES STILL MEAN THEMSELVES beside the same calls.
    expect(f('Average(close, 10) is greater than Average(close, 20)'))
      .toBe('sma(close, 10) > sma(close, 20)')
    expect(f('Average(close, 10) is less than Average(close, 20)'))
      .toBe('sma(close, 10) < sma(close, 20)')
    expect(f('Average(close, 10) is equal to Average(close, 20)'))
      .toBe('sma(close, 10) == sma(close, 20)')
    expect(f('Average(close, 10) equals Average(close, 20)'))
      .toBe('sma(close, 10) == sma(close, 20)')
  })

  it('level 8 — `is true` / `is false` over a mapped call, on the published rung', () => {
    expect(f('IsNaN(close) is true')).toBe('na(close)')
    expect(f('IsNaN(close) is false')).toBe('!na(close)')
    // ⭐ THE RUNG ITSELF: `is false` is LOOSER than `==` and TIGHTER than `and`,
    // so this brackets one way and not the other. Nothing in the corpus reaches
    // this, and an assumed tier would print the same text for both.
    expect(f('Average(close, 5) == Average(close, 9) is false'))
      .toBe('!(sma(close, 5) == sma(close, 9))')
    expect(f('IsNaN(close) is false and close > open'))
      .toBe('!na(close) && close > open')
  })

  it('a mapped call inside `within`, `between` and `crosses`', () => {
    expect(f('Average(close, 10) crosses above Average(close, 20)'))
      .toBe('crossOver(sma(close, 10), sma(close, 20))')
    expect(f('close between Lowest(low, 20) and Highest(high, 20)'))
      .toBe('close >= lowest(low, 20) && close <= highest(high, 20)')
    expect(f('close > Average(close, 50) within 5 bars'))
      .toBe('highest(close > sma(close, 50), 5) > 0')
  })

  it('a mapped call under a bar offset, and under negation', () => {
    expect(f('Average(close, 10)[1] > Average(close, 10)'))
      .toBe('sma(close, 10)[1] > sma(close, 10)')
    expect(f('-AbsValue(close - open)')).toBe('-abs(close - open)')
  })

  it('⭐ nesting a mapped call inside another mapped call', () => {
    expect(f('Average(TrueRange(high, close, low), 14)'))
      .toBe('sma(max(close[1], high) - min(close[1], low), 14)')
    expect(f('Highest(Average(close, 10), 20)')).toBe('highest(sma(close, 10), 20)')
    expect(f('Sqrt(Sqr(close - open))')).toBe('sqrt(pow(close - open, 2))')
  })

  it('⛔ and the NEGATIVE direction of each: a near-miss spelling refuses', () => {
    // ⛔ AN OVER-REFUSING GUARD ALSO "CLOSES" A FINDING. Each of these is a real
    // thinkorswim name this map does NOT carry, so each must refuse at its own
    // token while its neighbour above translates.
    for (const [call, token] of [['AverageTrue(close, 5)', 'AverageTrue'],
      ['HighestHigh(high, 5)', 'HighestHigh'], ['LogTen(close)', 'LogTen'],
      ['MovingAvg(close, 5)', 'MovingAvg']]) {
      const r = translateThinkScript(`plot p = ${call};\n`).refusal
      expect(r.guard, call).toBe('thinkscript:function')
      expect(r.token, call).toBe(token)
    }
  })
})

describe('the maths, measured on real bars — BOTH directions for every identity', () => {
  // ⛔⛔ ONE DIRECTION BLESSES THE INVERSE BUG. W3.4's enum defect failed the
  // opposite way in its `!=` form and passed every rail it had. So each case
  // below asserts the translated column EQUALS the identity it claims to be AND
  // DIFFERS from the nearest thing it could have been mistranslated into.
  const ROOT = (() => {
    let dir = process.cwd()
    for (let i = 0; i < 8; i++) {
      if (fs.existsSync(path.join(dir, 'app', 'src', 'components', 'StockChart.jsx'))) return dir
      const up = path.dirname(dir)
      if (up === dir) break
      dir = up
    }
    throw new Error(`thinkscript.test: could not find the repo root from ${process.cwd()}`)
  })()
  const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'))
  const CORPUS = readJson('tests/fixtures/ast/corpus.json')
  const [barsRel, barsName] = CORPUS.bars.split('#')
  const BARS = readJson(readJson(barsRel).fixtures[barsName].barsFrom).bars

  /** A thinkScript expression, translated and then COMPUTED on the shared parity
   *  series — the same tape the pixel gate, the alert replay and the Python
   *  conformance lane all read. */
  const columnOf = (thinkScript) => {
    const out = translateThinkScript(`plot p = ${thinkScript};\n`)
    expect(out.outputs[0].refusal, thinkScript).toBe(null)
    return Array.from(interpret(parseFormula(out.outputs[0].formula).ast, BARS, {}))
  }
  const engineColumn = (formula) => Array.from(interpret(parseFormula(formula).ast, BARS, {}))

  /** How many bars two columns disagree on, NaN-aware. */
  const differing = (a, b) => {
    let n = 0
    for (let i = 0; i < a.length; i += 1) {
      const x = a[i]
      const y = b[i]
      if (Number.isNaN(x) && Number.isNaN(y)) continue
      if (Number.isNaN(x) !== Number.isNaN(y) || Math.abs(x - y) > 1e-9) n += 1
    }
    return n
  }

  it('the tape is real, so nothing below can pass by comparing two empty arrays', () => {
    expect(BARS.length).toBeGreaterThan(400)
  })

  it('the four MovingAverage arms are four DIFFERENT columns', () => {
    const arms = {
      SIMPLE: 'sma(close, 10)', EXPONENTIAL: 'ema(close, 10)',
      WILDERS: 'rma(close, 10)', WEIGHTED: 'wma(close, 10)',
    }
    const got = {}
    for (const arm of Object.keys(arms)) {
      got[arm] = columnOf(`MovingAverage(AverageType.${arm}, close, 10)`)
      expect(differing(got[arm], engineColumn(arms[arm])), arm).toBe(0)
    }
    // ⛔ AND PAIRWISE DISTINCT, so "they all map to sma" could never pass.
    const names = Object.keys(arms)
    for (let i = 0; i < names.length; i += 1) {
      for (let j = i + 1; j < names.length; j += 1) {
        expect(differing(got[names[i]], got[names[j]]),
          `${names[i]} vs ${names[j]}`).toBeGreaterThan(400)
      }
    }
  })

  it('TrueRange IS the true range — against an independent oracle, and it is not the bar range', () => {
    const got = columnOf('TrueRange(high, close, low)')
    const oracle = BARS.map((b, i) => (i === 0 ? NaN
      : Math.max(b.h - b.l, Math.abs(b.h - BARS[i - 1].c), Math.abs(b.l - BARS[i - 1].c))))
    expect(differing(got, oracle)).toBe(0)
    // ⭐ AND THE FORM THE BRIEF ASKED FOR agrees with the page's own, which is
    // what makes emitting the page's quotation a choice of wording, not of maths.
    expect(differing(got, engineColumn(
      'max(high - low, max(abs(high - close[1]), abs(low - close[1])))'))).toBe(0)
    // ⛔ …and it is NOT simply the bar range. ⚠️ MEASURED AS A PROPERTY, NOT AS A
    // COUNT: this parity series is a smooth intraday tape and the true range
    // exceeds the bar range on only THREE of its 579 bars, so `>100` would fail
    // for a correct mapping. The two facts that discriminate are that TR is never
    // SMALLER than the bar range and is sometimes strictly larger.
    const barRange = engineColumn('high - low')
    expect(got.every((v, i) => Number.isNaN(v) || v >= barRange[i] - 1e-9)).toBe(true)
    expect(got.filter((v, i) => !Number.isNaN(v) && v > barRange[i] + 1e-9).length)
      .toBeGreaterThan(0)
    expect(differing(got, barRange)).toBeGreaterThan(0)
  })

  it('ATR is Wilder`s — against an independent construction — and is NOT an SMA of TR', () => {
    const got = columnOf('ATR(14)')
    const tr = BARS.map((b, i) => (i === 0 ? NaN
      : Math.max(b.h - b.l, Math.abs(b.h - BARS[i - 1].c), Math.abs(b.l - BARS[i - 1].c))))
    const wilder = []
    let seed = 0
    for (let i = 0; i < BARS.length; i += 1) {
      if (i < 14) { wilder.push(NaN); if (i >= 1) seed += tr[i]; continue }
      if (i === 14) { seed += tr[i]; wilder.push(seed / 14); continue }
      wilder.push(wilder[i - 1] + (tr[i] - wilder[i - 1]) / 14)
    }
    expect(differing(got, wilder)).toBe(0)
    expect(differing(got, engineColumn('sma(max(close[1], high) - min(close[1], low), 14)')))
      .toBeGreaterThan(400)
  })

  it('Log is the NATURAL log, and is measurably not the base-10 one', () => {
    const got = columnOf('Log(close)')
    expect(differing(got, engineColumn('ln(close)'))).toBe(0)
    expect(differing(got, engineColumn('log10(close)'))).toBeGreaterThan(400)
  })

  it('Sqr is the square, Sqrt the root, and neither is the other', () => {
    expect(differing(columnOf('Sqr(close)'), engineColumn('close * close'))).toBe(0)
    expect(differing(columnOf('Sqrt(close)'), engineColumn('pow(close, 0.5)'))).toBe(0)
    expect(differing(columnOf('Sqr(close)'), columnOf('Sqrt(close)'))).toBeGreaterThan(400)
  })

  it('Round(x, 0) rounds to a whole number, and is not the identity', () => {
    const got = columnOf('Round(close, 0)')
    expect(got.every((v) => Number.isNaN(v) || Number.isInteger(v))).toBe(true)
    expect(differing(got, engineColumn('close'))).toBeGreaterThan(400)
  })

  it('Sum is the rolling sum, and is not the average of the same window', () => {
    const got = columnOf('Sum(volume, 14)')
    expect(differing(got, engineColumn('sma(volume, 14) * 14'))).toBe(0)
    expect(differing(got, engineColumn('sma(volume, 14)'))).toBeGreaterThan(400)
  })

  it('CompoundValue holds its value — and the seed really is forgotten', () => {
    const held = columnOf('0')  // touch the helper once with something trivial
    expect(held.length).toBe(BARS.length)
    const a = translateThinkScript(
      'def c = CompoundValue(1, if close > open then close else c[1], 0);\nplot p = c;\n')
    const b = translateThinkScript(
      'def c = CompoundValue(1, if close > open then close else c[1], 999);\nplot p = c;\n')
    const ca = engineColumn(a.outputs[a.selected].formula)
    const cb = engineColumn(b.outputs[b.selected].formula)
    // ⭐ TWO DIFFERENT SEEDS, ONE COLUMN — which is exactly what the convergence
    // gate promises, and it is measured rather than argued.
    expect(differing(ca, cb)).toBe(0)
    // …and it is a real column, not all-NaN.
    expect(ca.filter((v) => !Number.isNaN(v)).length).toBeGreaterThan(100)
  })
})

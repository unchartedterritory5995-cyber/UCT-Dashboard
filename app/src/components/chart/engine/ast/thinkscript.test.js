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
  TS_STATE_WARMUP, TS_CALL_SHAPES, TS_WORD_OPERATORS, REFUSALS as TS, NOTES as TS_NOTES,
} from './thinkscript.js'
import { REFUSALS as PINE, printFormula } from './pine.js'
import { PCF_REFUSALS as PCF } from './pcf.js'
import { TABLE, parseFormula, astHash, REFUSALS as PARSE } from './parse.js'
import { REFUSALS as INTERPRET } from './interpret.js'
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
    const src = '\n# Mobius\n\n   plot x = Sum(close, 3);\n'
    const out = translateThinkScript(src)
    const line = src.split('\n')[out.refusal.line - 1]
    expect(out.refusal.line).toBe(4)
    expect(out.refusal.column).toBe(13)
    expect(out.refusal.token).toBe('Sum')
    expect(line.slice(out.refusal.column - 1, out.refusal.column - 1 + 3)).toBe('Sum')
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
    const crlf = translateThinkScript('  plot x = Sum(close, 3);\r\n')
    expect(crlf.refusal.line).toBe(1)
    expect(crlf.refusal.column).toBe(12)
    expect(crlf.refusal.token).toBe('Sum')
    expect(crlf.refusal.excerpt).toBe('  plot x = Sum(close, 3);\n           ^')
    expect(crlf.refusal.excerpt).not.toContain('\r')

    // A CR-only paste is three lines, so the refusal lands on the third —
    // unsplit, it would be one line and the caret would be 27 columns out.
    const cr = translateThinkScript('\r\rplot x = Sum(close, 3);')
    expect(cr.refusal.line).toBe(3)
    expect(cr.refusal.column).toBe(10)
    expect(cr.refusal.token).toBe('Sum')
  })

  it('`refusals` is the whole list and `refusal` is its first, both with excerpts', () => {
    const out = translateThinkScript('plot x = Sum(close, 3);')
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
    // translator's invention. Same-tier and left-associative gives the reading
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

  it('⭐ …and `within` must never bind TIGHTER than comparison — its operand is a CONDITION', () => {
    // ⚠️ THE BOUNDARY IS THE MEASUREMENT, NOT THE RUNG. `within` is a RESERVED
    // WORD, not a row of the comparison table, and its left operand is a
    // CONDITION — so `close > open within 3 bars` can only mean
    // `(close > open) within 3 bars`. Bound TIGHTER it would take `open` as its
    // condition and leave the `>` dangling, and these two assertions red.
    //
    // ⛔ WHAT THIS TEST DOES **NOT** MEASURE, said out loud because the sweep
    // measured it: moving `within` from its own rung (25) onto the comparison
    // tier (30) changes nothing here and nothing anywhere — the loop is
    // left-associative, so at either rung `within` is handed the comparison
    // already built. Only a move ABOVE comparison is observable. The earlier
    // draft of this comment claimed the 25-vs-30 asymmetry was load-bearing; it
    // is not, and a comment asserting a difference no rail can see is exactly
    // the second-authority defect this lane keeps paying for.
    expect(f('close > open within 3 bars')).toBe('highest(close > open, 3) > 0')
    expect(f('close > open within 2 bars and volume > 0'))
      .toBe('highest(close > open, 2) > 0 && volume > 0')
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

  it('⭐ a DOCUMENTED default fills a missing argument; an UNDOCUMENTED one refuses', () => {
    // ⛔ THE ASYMMETRY IS DELIBERATE AND IT IS THE WHOLE POINT. The reference
    // publishes `length` default 12 for `Average` and for `Highest`/`Lowest`; it
    // publishes no default for `StDev` on the page this lane quoted. A translator
    // that guessed 12 for `StDev` would ship a member a 12-bar deviation they
    // never asked for and never see — a chart that looks right and is wrong.
    expect(translateThinkScript('plot p = Average(close);\n').outputs[0].formula)
      .toBe('sma(close, 12)')
    expect(translateThinkScript('plot p = Highest(high);\n').outputs[0].formula)
      .toBe('highest(high, 12)')
    const r = translateThinkScript('plot p = StDev(close);\n').refusal
    expect(r.guard).toBe('thinkscript:arity')
    expect(r.token).toBe('StDev')
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
  it('⛔ every engine name a shape names is one the CLOSED TABLE declares', () => {
    // ⭐ THE MODULE HEADER'S PROMISE, MADE MECHANICAL. "Every engine name this
    // module emits is LOOKED UP in the table at translation time" — so a shape
    // pointing at a function the table does not declare is a mistranslation
    // waiting for the day someone re-partitions the table. W2a moved it to
    // version 2 while this lane was mid-flight; this is what makes that safe.
    const missing = Object.entries(TS_CALL_SHAPES)
      .filter(([, s]) => !Object.prototype.hasOwnProperty.call(TABLE.functions, s.engine))
      .map(([k, s]) => `${k} → ${s.engine}`)
    expect(missing).toEqual([])
    // non-vacuity: the sweep looked at a real, non-empty map
    expect(Object.keys(TS_CALL_SHAPES).length).toBeGreaterThan(3)
  })

  it('⛔ every shape CITES the page it was read from, and fills the engine\'s arity', () => {
    for (const [name, shape] of Object.entries(TS_CALL_SHAPES)) {
      expect(typeof shape.cite, name).toBe('string')
      expect(shape.cite.length, name).toBeGreaterThan(20)
      // ⛔ THE PARAMS ARE THE ENGINE'S ARGUMENTS, ONE FOR ONE, for every shape
      // this task maps. ⚠️ W3.5 maps `ATR(length)` onto `atr(high, low, close, n)`
      // — four engine arguments from one thinkorswim parameter — and will need an
      // explicit plan; this rail goes red the moment that lands, which is the
      // notification, not a bug.
      expect(shape.params.length, name).toBe(TABLE.functions[shape.engine].args.length)
      expect(new Set(shape.params).size, `${name} declares a parameter twice`).toBe(shape.params.length)
    }
  })

  it('the table is frozen, so a caller cannot map a function out from under a rail', () => {
    expect(Object.isFrozen(TS_CALL_SHAPES)).toBe(true)
  })

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

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
  TS_STATE_WARMUP, REFUSALS as TS, NOTES as TS_NOTES,
} from './thinkscript.js'
import { REFUSALS as PINE } from './pine.js'
import { PCF_REFUSALS as PCF } from './pcf.js'
import { REFUSALS as PARSE } from './parse.js'
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

/** ⭐ THE MEASURED REACHABLE SET AT W3.3 — seventeen of the twenty-seven. Typed
 *  ONCE and read by the two tests that partition the table, so "reachable",
 *  "written but unreachable" and "not written at all" can never overlap or leave
 *  a guard in none of the three. */
const REACHABLE = [
  'thinkscript:block', 'thinkscript:builtin', 'thinkscript:character', 'thinkscript:cycle',
  'thinkscript:empty', 'thinkscript:fold', 'thinkscript:function', 'thinkscript:future-offset',
  'thinkscript:input-kind', 'thinkscript:no-output', 'thinkscript:offset-literal',
  'thinkscript:roundtrip', 'thinkscript:state', 'thinkscript:statement',
  'thinkscript:syntax', 'thinkscript:type', 'thinkscript:undefined',
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

  it('⭐ …and SIXTEEN of the twenty-seven are now reachable, which is measured, not assumed', () => {
    // ⛔ A CLOSED SET SAYS NOTHING ABOUT HOW MUCH OF IT IS REACHABLE. Measured by
    // RUNNING it — the only honest source for "what does this thing emit" — and
    // pinned BY NAME, so W3.4's first new guard reds this and has to be
    // acknowledged rather than quietly joining a set nobody was counting.
    // ⏳ W3.2 measured TWO. The eleven still out are the constructs W3.4-W3.6
    // classify (`:aggregation`, `:symbol`, `:time`, `:strategy`, `:account`,
    // `:fold`) plus the call-shape guards that need the function map
    // (`:arity`, `:window`, `:named-argument`), plus `:study-ref` and
    // `:unsupported` — both pinned by name in the next test.
    const reached = new Set()
    for (const src of [
      '', '   \n',
      'plot p = close § 1;',
      'def x = close\nplot p = x > 0;',
      'plot p = close > open;\nAddLabel(yes, "x", Color.RED);',
      'plot p = HL2;',
      'plot scan = close > Average(close, 50);',
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
    ]) {
      for (const r of translateThinkScript(src).refusals) reached.add(r.guard)
    }
    expect([...reached].sort()).toEqual(REACHABLE)
  })

  it('…and exactly one more guard is REFERENCED in code without being reachable', () => {
    // ⛔ THE GAP BETWEEN "WRITTEN INTO CODE" AND "REACHABLE" IS WHERE DEAD
    // SCAFFOLDING HIDES, so it is pinned by name too. `thinkscript:study-ref` is
    // written where a member is taken off a value this engine resolved — and
    // every path that could reach it today goes through a CALL, which refuses
    // `thinkscript:function` one step earlier. It goes live with W3.6's study
    // references. Stripping the declaration tables is what makes this measurable
    // at all: sweeping the whole file just finds the names the tables spell.
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
      .toEqual(['thinkscript:study-ref'])
    // ⛔ AND EVERY REACHABLE GUARD IS ACTUALLY WRITTEN HERE, so `REACHABLE` cannot
    // drift into naming a guard some other module emits.
    expect(REACHABLE.filter((g) => !inCode.has(g))).toEqual([])
  })

  it('…and the nine still UNWRITTEN are named, so a later task cannot quietly drop one', () => {
    // ⛔ THE THIRD SET, AND THE ONE A ROADMAP ACTUALLY LIVES IN. These are
    // declared vocabulary no line of this module writes yet; each belongs to a
    // named later task (`:aggregation` `:symbol` `:time` `:strategy` `:account`
    // to W3.6, `:arity` `:window` `:named-argument` to W3.4). ⭐ AND
    // `:unsupported` IS IN HERE, which is the notification that matters: it was
    // the ONLY thing this translator could say at W3.2 and nothing says it now.
    const src = readSource()
    const table = /export const REFUSALS = Object\.freeze\(\{[\s\S]*?\n\}\)/.exec(src)
    const code = src.replace(table[0], '')
    const inCode = new Set([...code.matchAll(/'(thinkscript:[a-z-]+)'/g)].map((m) => m[1]))
    expect(Object.keys(TS).filter((g) => !inCode.has(g)).sort()).toEqual([
      'thinkscript:account', 'thinkscript:aggregation', 'thinkscript:arity',
      'thinkscript:named-argument', 'thinkscript:strategy',
      'thinkscript:symbol', 'thinkscript:time', 'thinkscript:unsupported',
      'thinkscript:window',
    ])
    // ⛔ THE THREE SETS PARTITION THE TABLE — no guard in two of them, none in
    // none of them. Without this, moving a guard between the lists above could
    // lose one entirely and every assertion would still pass.
    expect([...REACHABLE, 'thinkscript:study-ref',
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
    for (const src of ['plot x = close;', 'plot x = Average(close, 50);']) {
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
    expect(translateThinkScript('plot x = Average(close, 50);').selected).toBe(-1)
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
    const r = translateThinkScript('plot x = Average(close, 50);').refusal
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
    const out = translateThinkScript('def a = Average(close, 50);\nplot scan = close > a;\n')
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
    const src = '   def a = Average(close, 50);\nplot scan = close > a;\n'
    const out = translateThinkScript(src)
    const r = out.refusal
    const line = src.split('\n')[r.line - 1]
    expect(r.line).toBe(1)
    expect(r.column).toBe(12)
    expect(r.token).toBe('Average')
    expect(line.slice(r.column - 1, r.column - 1 + r.token.length)).toBe('Average')
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
      'def a = Average(close, 50);\nplot p = a > 0;\nAddLabel(yes, "x", Color.RED);\n')
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

  it('a bare expression with no plot IS the output — 16-scan-rsi-crosses has no `plot` at all', () => {
    const out = translateThinkScript('close > open\n')
    expect(out.ok).toBe(true)
    expect(out.outputs).toHaveLength(1)
    expect(out.outputs[0].kind).toBe('condition')
    expect(out.outputs[0].formula).toBe('close > open')
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

  it('⭐ a call refuses at the FUNCTION NAME — this task maps none of them yet', () => {
    // ⏳ THE MEASURED WALL OF W3.3. Every thinkorswim call reaches the engine
    // table through a map that is W3.4's; until it exists the honest answer is
    // the token and the reason, never a neighbouring function.
    const r = translateThinkScript('def a = Average(close, 50);\nplot scan = close > a;\n').refusal
    expect(r.guard).toBe('thinkscript:function')
    expect(r.line).toBe(1)
    expect(r.column).toBe(9)
    expect(r.token).toBe('Average')
  })

  it('…and an UNREFERENCED def never refuses, because nothing reads it', () => {
    // ⛔ RESOLUTION IS LAZY ON PURPOSE. A study that defines nine intermediates
    // and plots one of them must not be refused for the eight the member's
    // column never touches.
    const out = translateThinkScript('def unused = Average(close, 50);\nplot p = close > open;\n')
    expect(out.ok).toBe(true)
    expect(out.refusals).toEqual([])
  })
})

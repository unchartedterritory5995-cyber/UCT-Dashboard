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

import { translateThinkScript, ThinkScriptRefusal, TS_STATE_WARMUP, REFUSALS as TS } from './thinkscript.js'
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
const readSource = () => fs.readFileSync(MODULE_PATH, 'utf8')

const OTHER_DOORS = [['pine', PINE], ['pcf', PCF], ['parse', PARSE],
  ['interpret', INTERPRET], ['budget', BUDGET], ['sentence', SENTENCE]]

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
    const others = OTHER_DOORS
      .flatMap(([d, t]) => Object.entries(t).map(([g, text]) => ({ address: `${d}:${g}`, text })))
    const mine = Object.entries(TS).map(([g, text]) => ({ address: g, text }))
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
      expect(typeof text, guard).toBe('string')
      expect(text.length, guard).toBeGreaterThan(20)
    }
  })

  it('the table is frozen, so a caller cannot edit the reasons out from under a rail', () => {
    expect(Object.isFrozen(TS)).toBe(true)
  })

  it('the set is CLOSED — every guard string in the module is one this table declares', () => {
    // Derived from the module's own source: no guard string may appear in
    // `thinkscript.js` that this table does not declare.
    const src = readSource()
    const emitted = new Set([...src.matchAll(/'(thinkscript:[a-z-]+)'/g)].map((m) => m[1]))
    expect([...emitted].filter((g) => !(g in TS))).toEqual([])
    expect(emitted.size, 'a closure sweep that found no guards is not a sweep').toBeGreaterThan(15)
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
    const out = translateThinkScript('plot x = close;')
    for (const k of ['ok', 'version', 'declaration', 'title', 'outputs', 'selected',
      'refusal', 'refusals', 'ignored', 'folded']) {
      expect(Object.prototype.hasOwnProperty.call(out, k), k).toBe(true)
    }
    expect(Array.isArray(out.outputs)).toBe(true)
    expect(Array.isArray(out.ignored)).toBe(true)
    expect(Array.isArray(out.folded)).toBe(true)
    expect(Array.isArray(out.refusals)).toBe(true)
    expect(out.selected).toBe(-1)
    expect(out.declaration).toBe(null)
    expect(out.title).toBe(null)
  })

  it('a refusal value carries the seven keys every other door in this engine carries', () => {
    // ⭐ THE SHAPE IS A CONTRACT, NOT A CONVENIENCE. `ImportBox` and the corpus
    // fixture both read these by name; a missing `token` reads as "somewhere in
    // your script", which is not a refusal a member can act on.
    const r = translateThinkScript('plot x = close;').refusal
    expect(Object.keys(r).sort()).toEqual(
      ['column', 'excerpt', 'guard', 'index', 'line', 'message', 'token'])
  })
})

describe('⏳ the skeleton refuses EVERYTHING, and says so at a real position', () => {
  // ⛔ THIS IS THE MEASURED STARTING LINE, NOT A PLACEHOLDER. Pinning it makes
  // every later task's gain a fact rather than a claim. These assertions go RED
  // at W3.3 when the walls first move, and that is the notification.

  it('a script this translator will one day read refuses today, by name', () => {
    const out = translateThinkScript('def a = Average(close, 50);\nplot scan = close > a;\n')
    expect(out.ok).toBe(false)
    expect(out.refusal.guard).toBe('thinkscript:unsupported')
    expect(out.refusal.message).toBe(TS['thinkscript:unsupported'])
    expect(out.outputs).toEqual([])
  })

  it('⭐ the caret is under the token the refusal names, and the token is REAL text', () => {
    // ⛔ "IT REFUSED" IS SATISFIABLE BY A TRANSLATOR THAT POINTS AT NOTHING.
    // `lines[0].trim().slice(0, 12)` — the shape this started as — produces a
    // token that is NOT at the column it claims the moment a first line is
    // indented, so the caret and the token disagree and neither is checkable.
    const src = '   declare lower;\nplot x = close;\n'
    const out = translateThinkScript(src)
    const r = out.refusal
    const line = src.split('\n')[r.line - 1]
    expect(r.line).toBe(1)
    expect(r.column).toBe(4)
    expect(r.token).toBe('declare')
    expect(line.slice(r.column - 1, r.column - 1 + r.token.length)).toBe('declare')
    expect(r.excerpt).toBe(`${line}\n${' '.repeat(r.column - 1)}^`)
    expect(r.index).toBe(3)
  })

  it('a leading blank line is skipped, because a caret on nothing points at nothing', () => {
    const out = translateThinkScript('\n\nplot x = close;\n')
    expect(out.refusal.line).toBe(3)
    expect(out.refusal.column).toBe(1)
    expect(out.refusal.token).toBe('plot')
  })

  it('a first token that is not a word is still named, one character wide', () => {
    const out = translateThinkScript('# Mobius\nplot x = close;\n')
    expect(out.refusal.line).toBe(1)
    expect(out.refusal.column).toBe(1)
    expect(out.refusal.token).toBe('#')
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
    const crlf = translateThinkScript('  declare lower;\r\nplot x = close;\r\n')
    expect(crlf.refusal.line).toBe(1)
    expect(crlf.refusal.column).toBe(3)
    expect(crlf.refusal.token).toBe('declare')
    expect(crlf.refusal.excerpt).toBe('  declare lower;\n  ^')
    expect(crlf.refusal.excerpt).not.toContain('\r')

    // A CR-only paste is three lines, so the two blank ones are skipped and the
    // refusal lands on the third — unsplit, it would be one line at column 3.
    const cr = translateThinkScript('\r\rplot x = close;')
    expect(cr.refusal.line).toBe(3)
    expect(cr.refusal.column).toBe(1)
    expect(cr.refusal.token).toBe('plot')
  })

  it('`refusals` is the whole list and `refusal` is its first, both with excerpts', () => {
    const out = translateThinkScript('plot x = close;')
    expect(out.refusals).toEqual([out.refusal])
    expect(out.refusals[0].excerpt).toContain('^')
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

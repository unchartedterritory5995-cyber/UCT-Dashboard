/**
 * ⭐⭐ A CRASH MUST NEVER ARRIVE WEARING A GUARD NAME.
 *
 * ⚰️ `parseFormula` ended with
 * `guard: err instanceof TableRefusal ? err.guard : 'canonicalise:node'`, so any
 * exception that was not a refusal was relabelled as one. A stack overflow in the
 * recursive walker reached the member as `canonicalise:node` — "I don't recognise
 * this node shape" — for a formula made of nothing but `+` and `1`.
 *
 * ⛔ AND NOTHING IN THIS REPO COULD SEE IT. A laundered crash is `ok: false`, it
 * carries a guard name, and every census, log and fixture counts it as refused.
 * That is why the fix is a CLASSIFIER and not a better fallback guard: there is no
 * guard name that makes "the engine broke" true.
 *
 * This file pins the class, not the instance.
 */
import { describe, it, expect } from 'vitest'

import {
  canonicalise, classifyThrow, isRefusal, parseFormula,
  ENGINE_ERROR, MESSAGELESS_GUARDS, REFUSALS as PARSE_REFUSALS, TableRefusal,
} from './parse.js'
import { REFUSALS as BUDGET_REFUSALS } from './budget.js'
import { REFUSALS as INTERPRET_REFUSALS, TableRefusal as InterpretRefusal } from './interpret.js'
import { REFUSALS as PINE_REFUSALS } from './pine.js'
import { REFUSALS as SENTENCE_REFUSALS } from './sentence.js'
import { REFUSALS as THINKSCRIPT_REFUSALS, ThinkScriptRefusal } from './thinkscript.js'
import { PcfRefusal, PCF_REFUSALS } from './pcf.js'
import { PineRefusal } from './pine.js'
import { SentenceRefusal } from './sentence.js'
import { NotFoldable } from './bind.js'

/** ⭐ THE REGISTRY IS DERIVED FROM THE MODULES THAT OWN IT, never listed here.
 *  A guard list typed in a test is the same defect as a count typed beside the
 *  list it describes — it goes stale on the first rename and still passes. */
const REGISTRY = new Set([
  ...Object.keys(PARSE_REFUSALS),
  ...Object.keys(BUDGET_REFUSALS),
  ...Object.keys(INTERPRET_REFUSALS),
  ...Object.keys(PINE_REFUSALS),
  ...Object.keys(SENTENCE_REFUSALS),
  ...Object.keys(THINKSCRIPT_REFUSALS),
  ...Object.keys(PCF_REFUSALS),
  ...MESSAGELESS_GUARDS,
])

/** `parseFormula`'s body after jsep — so an injected throw lands exactly where a
 *  real one would, in the walker, inside the door's own catch. */
const driveWalker = (tree) => {
  try {
    return { ok: true, ast: canonicalise(tree) }
  } catch (err) {
    return classifyThrow(err)
  }
}

/** A tree whose very first property read throws whatever you hand it. */
const treeThatThrows = (err) => ({ get type() { throw err } })

describe('⛔⛔ K1 — an injected crash surfaces as an ENGINE ERROR, not a refusal', () => {
  for (const [label, make] of [
    ['RangeError', () => new RangeError('Maximum call stack size exceeded')],
    ['TypeError', () => new TypeError("Cannot read properties of null (reading 'name')")],
  ]) {
    it(`a ${label} at the walker keeps its message and gets NO guard`, () => {
      const err = make()
      const out = driveWalker(treeThatThrows(err))

      expect(out.ok).toBe(false)
      expect(out.status).toBe(ENGINE_ERROR)
      expect(out.engineError).toBe(label)
      // ⭐ THE ORIGINAL MESSAGE, UNEDITED. A rewritten one loses the only
      // description of what actually broke.
      expect(out.error).toBe(err.message)
      // ⛔⛔ THE WHOLE RULING IN ONE ASSERTION.
      expect(Object.prototype.hasOwnProperty.call(out, 'guard')).toBe(false)
      expect(out.guard).toBeUndefined()
    })
  }

  it('⭐⭐ AND THE REFUSAL COUNT DOES NOT MOVE', () => {
    // A census counts a result as refused when it carries a guard. Two injected
    // crashes must add two results and ZERO refusals.
    const refusing = [
      'close[1][2]',          // canonicalise:offset-chained
      'this',                 // canonicalise:this
      "tf(close)",            // canonicalise:timeframe
    ].map((src) => parseFormula(src))
    for (const r of refusing) expect(r.ok, JSON.stringify(r)).toBe(false)

    const countRefused = (rows) => rows.filter(
      (r) => Object.prototype.hasOwnProperty.call(r, 'guard')).length

    const before = countRefused(refusing)
    expect(before).toBe(refusing.length) // control: these really are refusals

    const withCrashes = [
      ...refusing,
      driveWalker(treeThatThrows(new RangeError('boom'))),
      driveWalker(treeThatThrows(new TypeError('bang'))),
    ]
    expect(withCrashes.length).toBe(refusing.length + 2)
    expect(countRefused(withCrashes)).toBe(before)
  })

  it('⛔ a REAL refusal still comes back as one, through the same classifier', () => {
    const out = driveWalker({ type: 'ThisExpression' })
    expect(out.ok).toBe(false)
    expect(out.status).toBeUndefined()
    expect(REGISTRY.has(out.guard)).toBe(true)
  })
})

describe('⭐ isRefusal crosses the two deliberate TableRefusal classes', () => {
  // ⛔ `parse.js` and `interpret.js` each export their OWN `TableRefusal`, on
  // purpose — the census recognises a refusal BY TYPE so one door's guard cannot
  // be covered by the other's test. That is right for a test and WRONG in a
  // `catch`, which does not know which door threw: `instanceof` would relabel the
  // other module's refusal as this door's guard, which is this ruling's defect
  // one class identity along.
  it('recognises EVERY refusal class, derived from the modules that define them', () => {
    // ⭐ SEVEN classes, six constructors (TableRefusal appears twice under two
    // identities). Listed as CONSTRUCTORS, so a renamed class fails to import
    // rather than silently dropping out of the sweep.
    // ⛔ THE GUARD NAME IS TAKEN FROM EACH MODULE'S OWN TABLE, never typed here:
    // `ThinkScriptRefusal` VALIDATES its guard at construction ("the refusal set
    // is closed") and throws a plain Error on an undeclared one — so an invented
    // name would fail for the wrong reason and read as this predicate breaking.
    const CLASSES = [
      ['parse.TableRefusal', TableRefusal, Object.keys(PARSE_REFUSALS)[0]],
      ['interpret.TableRefusal', InterpretRefusal, Object.keys(INTERPRET_REFUSALS)[0]],
      ['PcfRefusal', PcfRefusal, Object.keys(PCF_REFUSALS)[0]],
      ['PineRefusal', PineRefusal, Object.keys(PINE_REFUSALS)[0]],
      ['SentenceRefusal', SentenceRefusal, Object.keys(SENTENCE_REFUSALS)[0]],
      ['ThinkScriptRefusal', ThinkScriptRefusal, Object.keys(THINKSCRIPT_REFUSALS)[0]],
    ]
    for (const [label, , guard] of CLASSES) {
      expect(typeof guard, `${label}: its REFUSALS table is empty`).toBe('string')
    }
    for (const [label, Klass, guard] of CLASSES) {
      expect(isRefusal(new Klass(guard, 'x')), `${label} must read as a refusal`)
        .toBe(true)
    }
    expect(CLASSES.length).toBeGreaterThanOrEqual(6)
  })

  it('⛔ NotFoldable carries `what` and NO guard — so it is NOT a refusal', () => {
    // The control on widening the predicate to the field: a thrown Error that is
    // genuinely not a refusal must still read as a crash.
    const nf = new NotFoldable('close')
    expect(nf.guard).toBeUndefined()
    expect(isRefusal(nf)).toBe(false)
  })

  it('and refuses everything that is not one', () => {
    expect(isRefusal(new RangeError('x'))).toBe(false)
    expect(isRefusal(new TypeError('x'))).toBe(false)
    expect(isRefusal(null)).toBe(false)
    expect(isRefusal(undefined)).toBe(false)
    expect(isRefusal('canonicalise:node')).toBe(false)
    // a bare object wearing the name but carrying no guard is not a refusal
    expect(isRefusal({ name: 'TableRefusal' })).toBe(false)
    expect(isRefusal({ name: 'TableRefusal', guard: '' })).toBe(false)
  })

  it('⭐ the two classes really ARE distinct — the control on the test above', () => {
    // If they were ever merged, `isRefusal` crossing them would be trivially true
    // and this file would stop testing anything.
    expect(TableRefusal).not.toBe(InterpretRefusal)
    expect(new InterpretRefusal('g', 'm') instanceof TableRefusal).toBe(false)
  })
})

describe('⛔⛔ K2 — every guard a door emits exists in the registry', () => {
  const SOURCES = [
    'close[1][2]', 'this', '[1, 2]', 'x = 1', 'close.foo', 'close[-1]',
    'close[close]', 'tf(close)', "tf(close, 'W', 1)", "sym('!!bad!!', close)",
    "syminfo('Ticker')", 'text_contains(close)', '1 +', '', '   ',
    'close;;open', 'unknown_name_xyz', "sym(close, 'SPY')",
  ]

  it('⭐ THE SWEEP — no door invents a guard name', () => {
    const emitted = new Set()
    for (const src of SOURCES) {
      const r = parseFormula(src)
      if (r.ok) continue
      if (Object.prototype.hasOwnProperty.call(r, 'guard')) emitted.add(r.guard)
    }
    expect(emitted.size, 'the sweep refused nothing — it cannot police anything')
      .toBeGreaterThan(3)
    const unregistered = [...emitted].filter((g) => !REGISTRY.has(g))
    expect(unregistered, 'these guard names exist in no REFUSALS table and are not '
      + 'declared messageless — a guard nobody registered is a typo with a '
      + 'confident sentence attached').toEqual([])
  })

  it('⛔ THE R6 CONTROL — a FAKE guard goes red through the same checker', () => {
    // Without this, a checker that accepted everything would pass the sweep above
    // and the rail would be ceremony.
    const fake = 'canonicalise:not-a-real-guard'
    expect(REGISTRY.has(fake)).toBe(false)
    const out = classifyThrow(new TableRefusal(fake, 'a synthetic refusal'))
    expect(out.guard).toBe(fake)
    const unregistered = [out.guard].filter((g) => !REGISTRY.has(g))
    expect(unregistered).toEqual([fake])
  })

  it('⭐ `parser` is a REGISTERED guard even though it has no sentence of ours', () => {
    // jsep's syntax error is the member's message, unedited — the character offset
    // is what the text box needs — so `parser` has a guard NAME and no REFUSALS
    // entry. Declared rather than special-cased, so the sweep can tell
    // "deliberately messageless" from "never registered".
    expect(MESSAGELESS_GUARDS).toContain('parser')
    expect(REGISTRY.has('parser')).toBe(true)
    expect(Object.keys(PARSE_REFUSALS)).not.toContain('parser')

    const r = parseFormula('1 +')
    expect(r.ok).toBe(false)
    expect(r.guard).toBe('parser')
  })

  it('⛔ and the registry is not trivially large or trivially empty', () => {
    // A control on the derivation itself: if an import silently became `{}` the
    // sweep would pass by accepting nothing.
    expect(REGISTRY.size).toBeGreaterThan(50)
    for (const g of ['canonicalise:node', 'budget:nodes', 'resolve:name']) {
      expect(REGISTRY.has(g), `${g} missing — a REFUSALS import has gone empty`).toBe(true)
    }
  })
})

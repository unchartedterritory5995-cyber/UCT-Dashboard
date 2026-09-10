// app/src/components/chart/engine/ast/symbolScope.test.js
//
// ─── ⭐⭐ KIND 4 — WHAT `syminfo.*` MAY SAY, AND WHERE TEXT MAY GO ────────────
//
// Two claims, and they fail for different reasons on purpose:
//
//   THE CONTAINMENT — text is only ever an OPERAND. A `textop` yields a NUMBER
//   and sits wherever a number sits; `str` and `symtext` may appear nowhere but
//   directly beneath one. That is what let the closed table admit
//   `str.contains` without gaining a second value system in every walk that
//   prices, lints and evaluates a tree, and it is enforced STRUCTURALLY rather
//   than by a rule somebody has to remember.
//
//   THE VENDOR GATE — `syminfo.prefix` and `syminfo.tickerid` are TradingView
//   strings. A member compares them with `==` and `str.contains`, where a
//   plausible-but-unmeasured spelling does not degrade the answer, it INVERTS
//   it. So the fold serves them only for an exchange with a witnessed capture.
//
// ⭐⭐ AS OF 2026-09-10 THE GATE IS OPEN FOR SIX SPELLINGS AND SHUT FOR THE REST,
// which is a far better fixture than "shut for everything": both directions are
// now driven by REAL data. `confirmed` holds exactly `_YF_EXCHANGE`'s six
// distinct outputs, each with a witness symbol; every FMP free-text spelling
// still refuses.
//
// ⚰️ THE FIELD WAS NAMED `syminfo.exchange` HERE UNTIL THAT DATE. No such
// identifier exists in Pine v6 — the vendor answers CE10272 — so these tests
// asserted the serving of a name that could not compile. Renamed, not aliased:
// 0 of 502 tracked .pine files used the old name.
//
// ⛔ THE SECOND CLAIM IS STILL THE ONE THAT COULD PASS FOR THE WRONG REASON, and
// `symbolConstantsWith` still takes the map as a parameter so the POSITIVE
// CONTROL can drive the serving path with a synthetic witness independently of
// whatever `confirmed` happens to hold today
// (`lesson_built_tested_green_and_unreachable`).

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { astHash, parseFormula } from './parse.js'
import { printFormula, translatePine, BUILTIN_SYMBOL_SCOPED, BUILTIN_SYMBOL_UNSERVED } from './pine.js'
import {
  foldBound, foldScalar, foldText, bindingConstants, symbolConstants,
  symbolConstantsWith, SYMBOL_EXCHANGE_CONFIRMED, NotFoldable,
} from './bind.js'
import { interpret, maxLookback } from './interpret.js'
import SCOPE from './symbolScope.json'

const HEAD = '//@version=5\nindicator("t")\n'
const SYM = { ticker: 'SPY', exchange: 'NYSE Arca' }
// ⭐ AN UNWITNESSED SPELLING, AND IT MUST STAY UNWITNESSED. 'NASDAQ Global Select'
// is a real string our FMP leg can produce and is a `store_to_pine` PROPOSAL, so
// it exercises the refusal against data the store genuinely emits rather than
// against a nonsense value. If a future capture witnesses it, repoint this at
// another proposal line — do not delete the refusal tests.
const UNWITNESSED = { ticker: 'SPY', exchange: 'NASDAQ Global Select' }
const BARS = Array.from({ length: 8 }, (_, i) => ({
  t: 1700000000 + i * 86400, o: 10, h: 11, l: 9, c: 10 + i, v: 100,
}))

const TICKER = { type: 'symtext', name: 'ticker' }
const SLASH = { type: 'str', value: '/' }
const CONTAINS = { type: 'textop', name: 'contains', args: [TICKER, SLASH] }

// ═══ containment ════════════════════════════════════════════════════════════

describe('⛔ CONTAINMENT — text is an OPERAND and never a value', () => {
  it('1 · a `str` node outside a textop is refused, and the refusal NAMES it', () => {
    // ⭐ ASSERTED THROUGH `astHash`, WHICH IS THE PERSISTED-ARTIFACT DOOR. A tree
    // that arrived over a wire or came back out of a database never met
    // `convertTextOperand`, so a door-side check alone would leave the invariant
    // true only for trees this process built a millisecond ago.
    expect(() => astHash({
      type: 'call', name: 'sma', args: [SLASH, { type: 'num', value: 5 }],
    })).toThrow(/str node may only be an operand of a textop/)
  })

  it('2 · a `symtext` node outside a textop is refused the same way', () => {
    expect(() => astHash({ type: 'op', name: '+', args: [TICKER, { type: 'num', value: 1 }] }))
      .toThrow(/symtext node may only be an operand of a textop/)
  })

  it('3 · …and the containment check is NOT vacuous — inside one, it passes', () => {
    // ⛔ THE POSITIVE CONTROL FOR THE TWO ABOVE. A parentage check that refused
    // everything would satisfy both of them and break the feature; this is the
    // half that proves it discriminates.
    expect(typeof astHash(CONTAINS)).toBe('string')
    expect(astHash(CONTAINS)).toBe(astHash(CONTAINS))
  })

  it('4 · a text node that reaches the EVALUATOR is refused, never computed', () => {
    // ⛔ THE ORDER IS THE INVARIANT: fold first, then evaluate. A `textop` in a
    // tree handed to `interpret` means the fold did not run, and answering it
    // anyway would be the one failure mode this design exists to prevent — a
    // confident number produced by a pass that never resolved the binding.
    expect(() => interpret(CONTAINS, BARS, {})).toThrow()
  })

  it('5 · an EXPRESSION is not a text operand, and the parse door says so', () => {
    // A member could reasonably type this. The refusal belongs at the door they
    // typed at, not four passes later when a fold tries to read a moving average
    // as a string.
    const r = parseFormula("text_contains(sma(close, 5), 'x')")
    expect(r.ok).toBe(false)
    expect(r.guard).toBe('canonicalise:textop')
    expect(r.error).toMatch(/never an expression/)
  })

  it('⭐ …and the whole shape ROUND-TRIPS, so a saved definition survives', () => {
    // The tree is persisted BEFORE the fold — it has to, because the next symbol
    // folds it differently — so print/parse must be exact or a definition cannot
    // be stored at all. This is the failure that gated the whole wave.
    const printed = printFormula(CONTAINS)
    expect(printed).toBe("text_contains(syminfo('ticker'), '/')")
    const back = parseFormula(printed)
    expect(back.ok, back.error).toBe(true)
    expect(back.ast).toEqual(CONTAINS)
  })

  it('⭐ …and the fold REMOVES it — nothing textual survives into a folded tree', () => {
    // ⭐ A BOOLEAN POSITION, WHICH IS WHERE THE REAL SCRIPT PUTS IT. `Uncharted
    // Volume` line 222 feeds its answer to `isRatioSymbol`, never to a window
    // length — so a fold that only rewrote INT SLOTS would leave the node in the
    // tree and the evaluator would refuse a definition that was decidable.
    const folded = foldBound(
      {
        type: 'op',
        name: '?:',
        args: [CONTAINS, { type: 'num', value: 0 }, { type: 'series', name: 'close' }],
      },
      bindingConstants({ symbol: SYM }),
    )
    expect(folded.args[0]).toEqual({ type: 'num', value: 0 })
    const kinds = []
    const walk = (n) => {
      if (!n || typeof n !== 'object') return
      kinds.push(n.type)
      for (const a of n.args || []) walk(a)
    }
    walk(folded)
    expect(kinds).not.toContain('textop')
    expect(kinds).not.toContain('symtext')
    expect(kinds).not.toContain('str')
  })

  it('⭐ …and it costs ZERO bars, because a binding decides it', () => {
    expect(maxLookback(CONTAINS)).toBe(0)
  })
})

// ═══ the vendor gate ════════════════════════════════════════════════════════

describe('⛔ THE VENDOR GATE — an unwitnessed exchange spelling is not served', () => {
  it('⭐ `confirmed` holds exactly the SIX witnessed spellings — the capture landed', () => {
    // ⚰️ THIS ASSERTED `toEqual([])` UNTIL 2026-09-10 and carried the note "when a
    // capture lands this goes RED, and the correct edit is to update the sentence,
    // not to delete the assertion." The capture landed; the sentence is updated and
    // the assertion is still here, now pinning the other direction — that nothing
    // sneaks IN without a witness either.
    expect(Object.keys(SYMBOL_EXCHANGE_CONFIRMED).sort()).toEqual(
      ['Cboe BZX', 'NASDAQ', 'NYSE', 'NYSE American', 'NYSE Arca', 'OTC'])
    // ⛔ AND THE MAP IS MANY-TO-ONE — measured, not assumed. Two distinct store
    // spellings answer 'AMEX', so this object must never be inverted.
    expect(SYMBOL_EXCHANGE_CONFIRMED['NYSE Arca']).toBe('AMEX')
    expect(SYMBOL_EXCHANGE_CONFIRMED['NYSE American']).toBe('AMEX')
  })

  it('⭐ every confirmed row carries all four of {pine, witness, captured, how}', () => {
    // An entry without a witness is an assertion wearing a data structure, and
    // `SYMBOL_EXCHANGE_CONFIRMED` FILTERS on `witness` — so a row missing one is
    // silently DROPPED rather than loudly wrong. This is what makes that visible.
    const rows = Object.entries(SCOPE.confirmed).filter(([k]) => !k.startsWith('_'))
    expect(rows.length).toBe(6)
    for (const [stored, v] of rows) {
      for (const field of ['pine', 'witness', 'captured', 'how']) {
        expect(typeof v[field], `${stored} is missing ${field}`).toBe('string')
        expect(v[field].length, `${stored}.${field} is empty`).toBeGreaterThan(0)
      }
    }
  })

  it('⭐⭐ a WITNESSED spelling now serves all three, off the real manifest', () => {
    // SPY on 'NYSE Arca' is witnessed, so this drives the SERVING path with no
    // synthetic map at all — the production specialisation, end to end.
    const c = symbolConstants(SYM)
    expect(c['syminfo.ticker']).toBe('SPY')
    expect(c['syminfo.prefix']).toBe('AMEX')
    expect(c['syminfo.tickerid']).toBe('AMEX:SPY')
  })

  it('⛔ an UNWITNESSED spelling still refuses both vendor fields', () => {
    // The discriminator. Without it the test above passes for a serving path that
    // answers for EVERY symbol — which is the inversion the gate exists to
    // prevent, wearing a green suite.
    const c = symbolConstants(UNWITNESSED)
    expect(c['syminfo.ticker']).toBe('SPY')
    expect(c['syminfo.prefix']).toBeUndefined()
    expect(c['syminfo.tickerid']).toBeUndefined()
  })

  it('⭐ POSITIVE CONTROL — with a WITNESS, the serving path answers', () => {
    // ⛔ WITHOUT THIS, EVERY ASSERTION ABOVE IS SATISFIED BY A SERVING PATH THAT
    // DOES NOT EXIST. This drives the same function with a synthetic witness and
    // requires the fields to appear, so the refusals above are a statement about
    // the DATA rather than about code nobody has run.
    const c = symbolConstantsWith({ 'NYSE Arca': 'AMEX' }, SYM)
    expect(c['syminfo.prefix']).toBe('AMEX')
    expect(c['syminfo.tickerid']).toBe('AMEX:SPY')
    // …and the fold then answers a question about it, end to end.
    expect(foldText({ type: 'symtext', name: 'tickerid' }, c)).toBe('AMEX:SPY')
    expect(foldScalar({
      type: 'textop',
      name: 'contains',
      args: [{ type: 'symtext', name: 'tickerid' }, SLASH],
    }, c)).toBe(0)
  })

  it('⛔ and the refusal carries the MEASUREMENT reason, not a grammar one', () => {
    // ⛔ DRIVEN BY THE UNWITNESSED SYMBOL. Pointing this at SYM would now throw
    // nothing at all, and the test would pass by never entering the catch —
    // green because the refusal never fired, which is the shape this file exists
    // to refuse.
    let what = null
    try {
      foldText({ type: 'symtext', name: 'prefix' }, symbolConstants(UNWITNESSED))
    } catch (err) {
      expect(err).toBeInstanceOf(NotFoldable)
      what = err.what
    }
    expect(what, 'the unwitnessed spelling did not refuse at all').not.toBeNull()
    expect(what).toContain('syminfo.prefix')
    expect(what).toMatch(/has not measured/)
  })

  it('⚠️ the store vocabulary this engine KNOWS ABOUT is covered by a proposal', () => {
    // ⭐ DERIVED FROM `ticker_meta.py`, NOT RETYPED. `_YF_EXCHANGE` is the bounded
    // half of our store's exchange vocabulary; the FMP half is free text and
    // cannot be enumerated, which is exactly why an unknown spelling refuses
    // rather than being passed through. A value added there without a line here
    // fails BY NAME on the day it lands.
    const src = readFileSync(
      path.resolve(process.cwd(), '..', 'api/services/ticker_meta.py'), 'utf8')
    const block = src.slice(src.indexOf('_YF_EXCHANGE = {'))
    const body = block.slice(0, block.indexOf('}') + 1)
    const stored = [...body.matchAll(/:\s*"([^"]+)"/g)].map((m) => m[1])
    expect(stored.length, 'the _YF_EXCHANGE probe found nothing — it has moved')
      .toBeGreaterThan(5)
    const proposals = new Set(Object.keys(SCOPE.store_to_pine || {}))
    const missing = [...new Set(stored)].filter((s) => !proposals.has(s))
    expect(missing,
      `symbolScope.json::store_to_pine does not name these spellings our own store `
      + `can produce: ${missing.join(', ')}`).toEqual([])
  })

  it('⛔ …and a PROPOSAL is still never served — only a WITNESS is', () => {
    // The proposal list is expectation written down so the probe knows what to
    // check. Reading it in the serving path would turn every guess into a shipped
    // answer in one edit. Six of those lines now have witnesses; the rest must
    // still refuse, and BOTH halves are asserted so this cannot pass by the map
    // being empty OR by it being full.
    let served = 0
    let refused = 0
    for (const stored of Object.keys(SCOPE.store_to_pine || {})) {
      if (stored.startsWith('_')) continue
      const c = symbolConstants({ ticker: 'SPY', exchange: stored })
      const witnessed = Object.prototype.hasOwnProperty.call(SYMBOL_EXCHANGE_CONFIRMED, stored)
      if (witnessed) {
        served += 1
        expect(c['syminfo.prefix'], `${stored} HAS a witness and did not serve`)
          .toBe(SYMBOL_EXCHANGE_CONFIRMED[stored])
      } else {
        refused += 1
        expect(c['syminfo.prefix'], `${stored} was served from the PROPOSAL`)
          .toBeUndefined()
      }
    }
    // ⛔ NON-VACUITY, BOTH WAYS. Without these the loop passes if every line
    // happens to fall on one side.
    expect(served, 'no proposal line had a witness — the capture did not land')
      .toBeGreaterThan(0)
    expect(refused, 'every proposal line had a witness — the refusal half of this '
      + 'test is no longer exercised, so repoint UNWITNESSED at a spelling that stays so')
      .toBeGreaterThan(0)
  })
})

// ═══ the door ═══════════════════════════════════════════════════════════════

describe('⛔ the six unserved fields refuse BY NAME, with their own sentences', () => {
  it('the roster is the data file, and it is not empty', () => {
    expect(Object.keys(BUILTIN_SYMBOL_UNSERVED).sort()).toEqual([
      'syminfo.currency', 'syminfo.description', 'syminfo.mintick',
      'syminfo.pointvalue', 'syminfo.session', 'syminfo.type',
    ])
  })

  for (const field of ['type', 'currency', 'session', 'mintick', 'pointvalue', 'description']) {
    it(`⛔ \`syminfo.${field}\` — and the refusal does NOT say the grammar lacks it`, () => {
      const r = translatePine(`${HEAD}plot(close + str.length(syminfo.${field}))\n`)
      expect(r.ok).toBe(false)
      const said = [r.refusal, ...(r.refusals || [])].filter(Boolean).map((x) => x.what || x.detail || x.message || '').join(' ')
      expect(said).toContain(`syminfo.${field}`)
      // ⭐ THE SENTENCE MATTERS AS MUCH AS THE VERDICT. "the engine grammar does
      // not hold this name" is FALSE one line from where `syminfo.ticker`
      // resolves, and a refusal that is false about its own neighbour teaches a
      // reader to distrust every refusal in the file. This is the mistake
      // `barstate.islast` shipped with for weeks.
      expect(said).not.toContain('the engine grammar does not hold')
      expect(said).toContain('holds its sibling')
    })
  }

  // ── the rule the mintick fix generalises to ────────────────────────────────
  //
  // ⚰️ `str.length(syminfo.mintick)` REFUSED `str.length` — naming the one part
  // of the line that was fine, and sending a member to delete a call they could
  // have kept. The fix was not local: whenever a line carries several refusable
  // constructs, the one NAMED must be the innermost unserved thing, never an
  // outer construct that would have been fine on its own.
  //
  // ⛔ THREE NESTINGS, BECAUSE ONE WOULD ONLY RE-TEST THE CASE THE FIXTURE FOUND.
  // Each puts the unserved name under a DIFFERENT kind of outer construct, so a
  // fix that happened to work for text predicates and nowhere else fails here.
  const NESTED = [
    ['inside a served TEXT op',
      'plot(close + str.length(syminfo.session))', 'syminfo.session', 'str.length'],
    ['inside served ARITHMETIC',
      'plot(close * 2 + syminfo.pointvalue)', 'syminfo.pointvalue', null],
    ['inside a TERNARY arm',
      'plot(close > 1 ? syminfo.currency : close)', 'syminfo.currency', null],
  ]
  for (const [label, body, inner, outer] of NESTED) {
    it(`⛔ the INNERMOST unserved name is the one refused — ${label}`, () => {
      const r = translatePine(`${HEAD}${body}\n`)
      expect(r.ok).toBe(false)
      const said = [r.refusal, ...(r.refusals || [])].filter(Boolean)
        .map((x) => x.what || x.detail || x.message || '').join(' ')
      expect(said, `expected the refusal to name ${inner}`).toContain(inner)
      if (outer) {
        // ⭐ AND NOT THE OUTER ONE. This half is what the original defect
        // violated: the sentence named `str.length`, which was never the problem.
        expect(said, `the refusal named the outer construct \`${outer}\` instead`)
          .not.toContain(`\`${outer}\``)
      }
      expect(said).not.toContain('the engine grammar does not hold')
    })
  }

  it('⭐ …while the three symbol-scoped names DO resolve at the door', () => {
    expect(Object.keys(BUILTIN_SYMBOL_SCOPED).sort())
      .toEqual(['syminfo.prefix', 'syminfo.ticker', 'syminfo.tickerid'])
    const r = translatePine(
      `${HEAD}isRatio = str.contains(syminfo.ticker, "/")\nplot(isRatio ? 0 : close)\n`)
    expect(r.refusal, r.refusal && r.refusal.what).toBe(null)
  })
})

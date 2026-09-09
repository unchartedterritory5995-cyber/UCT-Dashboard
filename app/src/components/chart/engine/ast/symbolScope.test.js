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
//   THE VENDOR GATE — `syminfo.exchange` and `syminfo.tickerid` are TradingView
//   strings this engine has NOT measured. A member compares them with `==` and
//   `str.contains`, where a plausible-but-unmeasured spelling does not degrade
//   the answer, it INVERTS it. So the fold serves them only for an exchange with
//   a witnessed capture, and `confirmed` is empty today.
//
// ⛔ THE SECOND CLAIM IS THE ONE THAT COULD PASS FOR THE WRONG REASON. With an
// empty witness map every "it refuses" assertion is satisfied by a serving path
// that does not exist at all. `symbolConstantsWith` takes the map as a parameter
// precisely so the POSITIVE CONTROL below can drive the serving path with a
// synthetic witness — proving the refusal is about the DATA and not about code
// nobody has ever seen run (`lesson_built_tested_green_and_unreachable`).

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
  it('`confirmed` is empty, and that is the honest state rather than an oversight', () => {
    // ⚠️ WHEN A CAPTURE LANDS THIS GOES RED, and the correct edit is to update the
    // sentence — not to delete the assertion. It is what keeps "nothing has been
    // measured" from quietly becoming untrue in either direction.
    expect(Object.keys(SYMBOL_EXCHANGE_CONFIRMED)).toEqual([])
  })

  it('so `syminfo.ticker` resolves and the other two do NOT', () => {
    const c = symbolConstants(SYM)
    expect(c['syminfo.ticker']).toBe('SPY')
    expect(c['syminfo.exchange']).toBeUndefined()
    expect(c['syminfo.tickerid']).toBeUndefined()
  })

  it('⭐ POSITIVE CONTROL — with a WITNESS, the serving path answers', () => {
    // ⛔ WITHOUT THIS, EVERY ASSERTION ABOVE IS SATISFIED BY A SERVING PATH THAT
    // DOES NOT EXIST. This drives the same function with a synthetic witness and
    // requires the fields to appear, so the refusals above are a statement about
    // the DATA rather than about code nobody has run.
    const c = symbolConstantsWith({ 'NYSE Arca': 'AMEX' }, SYM)
    expect(c['syminfo.exchange']).toBe('AMEX')
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
    let what = null
    try {
      foldText({ type: 'symtext', name: 'exchange' }, symbolConstants(SYM))
    } catch (err) {
      expect(err).toBeInstanceOf(NotFoldable)
      what = err.what
    }
    expect(what).toContain('syminfo.exchange')
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

  it('⛔ …and a PROPOSAL is never served — only a witness is', () => {
    // The proposal list is eleven lines of expectation written down so the probe
    // knows what to check. Reading it in the serving path would turn eleven
    // guesses into eleven shipped answers in a single edit.
    for (const stored of Object.keys(SCOPE.store_to_pine || {})) {
      if (stored.startsWith('_')) continue
      const c = symbolConstants({ ticker: 'SPY', exchange: stored })
      expect(c['syminfo.exchange'], `${stored} was served from the PROPOSAL`)
        .toBeUndefined()
    }
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

  it('⭐ …while the three symbol-scoped names DO resolve at the door', () => {
    expect(Object.keys(BUILTIN_SYMBOL_SCOPED).sort())
      .toEqual(['syminfo.exchange', 'syminfo.ticker', 'syminfo.tickerid'])
    const r = translatePine(
      `${HEAD}isRatio = str.contains(syminfo.ticker, "/")\nplot(isRatio ? 0 : close)\n`)
    expect(r.refusal, r.refusal && r.refusal.what).toBe(null)
  })
})

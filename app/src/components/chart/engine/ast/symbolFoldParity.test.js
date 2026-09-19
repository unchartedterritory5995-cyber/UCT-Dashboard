// app/src/components/chart/engine/ast/symbolFoldParity.test.js
//
// ─── ⭐⭐ R-K — BOTH LANES FOLD EVERY `syminfo.*` MEMBER IDENTICALLY ─────────
//
// Owner ruling, 2026-09-13. The JS lane's `bind.js` and the Python lane's
// `ast_bind.py` each answer "what does this symbol make constant?", and a member
// gets whichever lane happens to evaluate their script. If the two disagree on
// one field for one symbol, the same script says two different things.
//
// ⛔ THE FIXED SYMBOL SET IS THE POINT. Three symbols, chosen because each one
// exercises a different branch and the branches are the whole design:
//
//   SPY      NYSE Arca  — a WITNESSED exchange. `ticker`, `prefix` and `tickerid`
//                         all resolve; the pairing was confirmed independently on
//                         the rig (`symbolInfo().exchange === "NYSE Arca"`).
//   AGEN     NASDAQ     — a second witnessed exchange, so "it works for SPY" is
//                         not a statement about one hard-coded row.
//   BTC/USD  (none)     — an UNWITNESSED symbol, and the `contains(ticker, "/")`
//                         case: `syminfo.ticker` still resolves and the ratio
//                         test still answers, while `tickerid` correctly refuses.
//
// ⭐ THE THIRD IS THE ONE THAT MATTERS MOST. `str.contains(syminfo.ticker, "/")`
// is how a script asks "am I on a pair or ratio chart", and it must answer 1 on
// BTC/USD and 0 on SPY WITHOUT any exchange witness — otherwise the refusal
// swallows a question the engine can answer from the ticker alone.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { describe, it, expect } from 'vitest'
import {
  symbolConstants, bindingConstants, foldScalar, foldText, foldBound, NotFoldable,
} from './bind'

const REPO = path.resolve(process.cwd(), '..')

/** The set, and the branch each member is here to drive. */
const SYMBOLS = [
  { ticker: 'SPY', exchange: 'NYSE Arca', drives: 'a witnessed exchange' },
  { ticker: 'AGEN', exchange: 'NASDAQ', drives: 'a second witnessed exchange' },
  { ticker: 'BTC/USD', exchange: null, drives: 'no witness, and the ratio test' },
]

/** Every `syminfo.*` the corpus actually reads, measured rather than listed.
 *  ⛔ THE COUNTS ARE THE REASON THE CONTRACT IS TWO FIELDS AND NOT SIX. */
const MEMBERS = ['ticker', 'tickerid', 'prefix', 'mintick', 'type', 'currency', 'session']

const CONTAINS = (field, needle) => ({
  type: 'textop', name: 'contains',
  args: [{ type: 'symtext', name: field }, { type: 'str', value: needle }],
})

function jsFold(symbol) {
  const consts = bindingConstants({ symbol })
  const out = {}
  for (const m of MEMBERS) {
    try { out[m] = foldText({ type: 'symtext', name: m }, consts) }
    catch (e) { out[m] = e instanceof NotFoldable ? `REFUSED:${e.what}` : `THREW:${e.message}` }
  }
  return out
}

function pyFold(symbol) {
  const script = [
    'import json, sys',
    `sys.path.insert(0, ${JSON.stringify(REPO)})`,
    'from api.services import ast_bind as b',
    `sym = json.loads(${JSON.stringify(JSON.stringify(symbol))})`,
    'consts = b.binding_constants(symbol=sym)',
    `out = {}`,
    `for m in ${JSON.stringify(MEMBERS)}:`,
    '    try: out[m] = b.fold_text({"type": "symtext", "name": m}, consts)',
    '    except b.NotFoldable as e: out[m] = "REFUSED:" + str(e.what)',
    '    except Exception as e: out[m] = "THREW:" + str(e)',
    'print(json.dumps(out))',
  ].join('\n')
  const raw = execFileSync('python', ['-c', script], {
    encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  })
  return JSON.parse(raw.trim().split('\n').pop())
}

describe('R-K — the two lanes fold one symbol the same way', () => {
  for (const s of SYMBOLS) {
    it(`⭐ ${s.ticker} (${s.drives}) — every member, string for string`, () => {
      const js = jsFold(s)
      const py = pyFold(s)
      expect(py).toEqual(js)
      // ⛔ NON-VACUITY: a run where BOTH lanes refused everything would satisfy
      // `toEqual` and prove nothing. At least the ticker must have resolved.
      expect(js.ticker).toBe(s.ticker)
    })
  }

  it('⭐⭐ a witnessed exchange resolves `tickerid`, an unwitnessed one refuses BY NAME', () => {
    const spy = jsFold(SYMBOLS[0])
    expect(spy.prefix).toBe('AMEX')          // NYSE Arca → AMEX, witnessed by AMEX:SPY
    expect(spy.tickerid).toBe('AMEX:SPY')
    const agen = jsFold(SYMBOLS[1])
    expect(agen.tickerid).toBe('NASDAQ:AGEN')
    const btc = jsFold(SYMBOLS[2])
    expect(btc.ticker).toBe('BTC/USD')
    // ⭐ The refusal NAMES THE FIELD, which is the half a member can act on.
    expect(btc.tickerid).toMatch(/^REFUSED:syminfo\.tickerid/)
    expect(btc.prefix).toMatch(/^REFUSED:syminfo\.prefix/)
  })

  it('⛔ the six unserved members refuse in BOTH lanes, on every symbol', () => {
    // `mintick`, `type`, `currency`, `session` are refused BY NAME at the door
    // (`symbolScope.json::unserved`) — the fold must not invent them either, and
    // it must not invent them differently in the two lanes.
    for (const s of SYMBOLS) {
      const js = jsFold(s)
      for (const m of ['mintick', 'type', 'currency', 'session']) {
        expect(js[m], `${s.ticker}.${m}`).toMatch(/^REFUSED:/)
      }
    }
  })

  it('⭐⭐ THE RATIO TEST — `contains(ticker,"/")` answers without any witness', () => {
    // The shape T5 measured 18 times in `uncharted-volume-v2`, and the reason
    // the unwitnessed case still has to fold: this question is answerable from
    // the ticker alone.
    const on = (sym, node) => foldScalar(node, bindingConstants({ symbol: sym }))
    expect(on(SYMBOLS[2], CONTAINS('ticker', '/'))).toBe(1)   // BTC/USD
    expect(on(SYMBOLS[0], CONTAINS('ticker', '/'))).toBe(0)   // SPY
    expect(on(SYMBOLS[1], CONTAINS('ticker', '/'))).toBe(0)   // AGEN

    // …and BOTH operands of the `or` v2 actually writes become numbers on a
    // witnessed symbol. ⭐ `foldBound` folds bind-time TEXT, not arithmetic — the
    // `or` itself stays an `op` with two `num` children and the evaluator does
    // the rest, which is the right division of labour and worth pinning so a
    // future "why isn't this a num" does not get answered by widening the fold.
    const OR = {
      type: 'op', name: 'or',
      args: [CONTAINS('ticker', '/'), CONTAINS('tickerid', '/')],
    }
    const folded = foldBound(OR, bindingConstants({ symbol: SYMBOLS[0] }))
    expect(folded.type).toBe('op')
    expect(folded.args.map((a) => a.type)).toEqual(['num', 'num'])
    expect(folded.args.map((a) => a.value)).toEqual([0, 0])

    // ⛔⛔ AND ON AN UNWITNESSED SYMBOL IT STILL REFUSES — one operand is not
    // enough. `contains(ticker,"/")` folds to 1 on BTC/USD and is decisive in
    // Pine's own semantics, but this engine evaluates both arguments of an `or`,
    // so the unsettled `tickerid` half survives and the evaluator names it.
    // ⭐ THAT IS A REAL LIMIT AND IT IS WRITTEN DOWN RATHER THAN ROUNDED OFF:
    // v2's ratio test resolves on a witnessed symbol and refuses on an
    // unwitnessed one, and the refusal says `syminfo.tickerid`.
    const left = foldBound(OR, bindingConstants({ symbol: SYMBOLS[2] }))
    expect(left.type).toBe('op')
    expect(left.args[0]).toEqual({ type: 'num', value: 1 })
    expect(left.args[1].type).toBe('textop')
  })

  it('⛔ a bare STRING contributes nothing — the seam that was dark for a week', () => {
    // `astColumnsFor` passed `ctx.sym` (a string) here until 2026-09-13, and
    // this is the line that made it silent rather than loud.
    expect(symbolConstants('SPY')).toEqual({})
    expect(symbolConstants({ ticker: 'SPY', exchange: 'NYSE Arca' }))
      .toMatchObject({ 'syminfo.ticker': 'SPY', 'syminfo.tickerid': 'AMEX:SPY' })
  })

  it('⭐ the witness table is READ, not typed here', () => {
    // If this file listed NYSE Arca → AMEX itself it would be a second authority
    // over the one question the capture settled.
    const scope = JSON.parse(fs.readFileSync(
      path.join(REPO, 'app/src/components/chart/engine/ast/symbolScope.json'), 'utf8'))
    expect(scope.confirmed['NYSE Arca'].pine).toBe('AMEX')
    expect(scope.confirmed['NYSE Arca'].witness).toBe('AMEX:SPY')
    expect(scope.confirmed.NASDAQ.pine).toBe('NASDAQ')
  })
})

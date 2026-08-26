import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { parse as parseJs } from 'acorn'

// ⭐ `./budget.js` IS THE FIRST IMPORT IN THIS FILE ON PURPOSE, AND IT IS A RAIL
// RATHER THAN A HABIT. `budget.js` and `interpret.js` import each other; a cycle
// resolves differently depending on which module the graph ENTERS through, so
// the two directions are two different measurements. `interpret.test.js` enters
// through the interpreter; this file enters through the budget. If the cycle
// broke in this direction every case below would fail at import time — which is
// the loudest possible way for it to be reported.
import {
  DEFAULT_BUDGET, CAP_GUARD, REFUSALS as BUDGET_REFUSALS,
  checkBudget, assertBudget, effectiveBudget, seriesRefs,
} from './budget.js'
import {
  interpret, maxLookback, nodeCount, TableRefusal, REFUSALS as INTERPRET_REFUSALS,
} from './interpret.js'
import {
  parseFormula, canonicalise, TABLE, REFUSALS as PARSE_REFUSALS, SESSION_MAX_BARS,
} from './parse.js'

/** The repo root, found by walking up — the same helper `interpret.test.js` and
 *  `lint.test.js` use, and it THROWS BY NAME rather than defaulting, because a
 *  helper that returned a default here would make every fixture-driven case
 *  below silently read nothing. */
const ROOT = (() => {
  let dir = process.cwd()
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'app', 'src', 'components', 'StockChart.jsx'))) return dir
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  throw new Error(`ast/budget.test: could not find the repo root from ${process.cwd()}`)
})()

const AST_DIR = path.join(ROOT, 'app', 'src', 'components', 'chart', 'engine', 'ast')
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'))
/** ⚠️ CRLF NORMALISED AT THE DOOR. `core.autocrlf` is on in this checkout, so a
 *  multi-line `\n` anchor otherwise matches zero times. That has cost this
 *  programme a measurement already, on eight separate tasks. */
const readSource = (file) => fs.readFileSync(path.join(AST_DIR, file), 'utf8').replace(/\r\n/g, '\n')

const CORPUS = readJson('tests/fixtures/ast/corpus.json')
const ESCAPES = readJson('tests/fixtures/ast/escapes.json')

/** ⭐ THE BARS ARE RESOLVED THROUGH THE CORPUS'S OWN DECLARATION, NOT RE-TYPED —
 *  the same two links `interpret.test.js` follows, so this file and every other
 *  gate in the phase provably read ONE series. */
const BARS = (() => {
  const [rel, name] = String(CORPUS.bars).split('#')
  const entry = readJson(rel).fixtures[name]
  if (!entry || !entry.barsFrom) throw new Error(`${rel}#${name} carries no barsFrom`)
  const bars = readJson(entry.barsFrom).bars
  if (bars.length !== entry.bar_count) {
    throw new Error(`${entry.barsFrom} holds ${bars.length} bars, not the recorded ${entry.bar_count}`)
  }
  return bars
})()

const num = (value) => ({ type: 'num', value })
const series = (name) => ({ type: 'series', name })
const op = (name, ...args) => ({ type: 'op', name, args })

/** A canonical tree of EXACTLY `n` nodes, built ITERATIVELY.
 *
 *  A recursive builder would die constructing the very input the node budget
 *  exists to refuse — the same reason `nodeCount` and `maxLookback` are
 *  iterative. A `u-` chain gives exact control of the count (one node per
 *  wrap), which a `1 + (1 + …)` chain cannot: that one only produces ODD counts,
 *  so it can never land ON a boundary. */
const chainOfNodes = (n) => {
  let node = num(1)
  for (let i = 1; i < n; i++) node = op('u-', node)
  return node
}

/** A canonical tree that performs EXACTLY `n` base-series reads. */
/** A canonical tree reading EXACTLY `n` DISTINCT declared names.
 *
 *  ⭐ SERIES FIRST, THEN SCALARS, AND THE CONTINUATION IS NOT A CONVENIENCE. The
 *  manifest declares five bar series, so a fixture that cycled them could never
 *  reach a cap of eight once `seriesRefs` began counting DISTINCT reads — it
 *  measured 5 and the boundary test failed with "the fixture is not AT the cap",
 *  which is the fixture telling the truth. A scalar rides the SAME `series` node
 *  and is a per-symbol column read, so it costs exactly the data this cap is
 *  about; drawing from both is what makes `n` reachable and still honest.
 *
 *  ⛔ NAMES COME FROM THE MANIFEST, NEVER TYPED, so a rename cannot turn this
 *  into a `resolve:name` case refused at a different door. */
const chainOfSeries = (n) => {
  const names = [...Object.keys(TABLE.series), ...Object.keys(TABLE.scalars)]
  if (n > names.length) throw new Error(`chainOfSeries(${n}): the manifest declares only ${names.length} names`)
  let node = series(names[0])
  for (let i = 1; i < n; i++) node = op('+', node, series(names[i]))
  return node
}

const guardOf = (fn) => {
  try { fn() } catch (e) {
    return e instanceof TableRefusal ? e.guard : `NOT-A-REFUSAL:${e.name}`
  }
  return 'REACHED-A-VALUE'
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. THE CAPS, AND THE TOTALITY THAT KEEPS THEM FROM ROTTING APART
// ═════════════════════════════════════════════════════════════════════════════

describe('the three caps are a closed set, declared once', () => {
  it('every cap has a guard, every guard has a sentence, and there are no orphans', () => {
    // ⛔ BOTH DIRECTIONS, DERIVED. A cap with no guard is a number nothing reads;
    // a guard with no cap is a refusal nothing can produce — the shape of
    // `lesson_gate_that_cannot_fail`. Neither survives a set equality both ways,
    // and neither is visible to a test that reads one list.
    const caps = Object.keys(DEFAULT_BUDGET).sort()
    expect(Object.keys(CAP_GUARD).sort()).toEqual(caps)
    expect(Object.values(CAP_GUARD).sort())
      .toEqual(Object.keys(BUDGET_REFUSALS).sort())
    for (const cap of caps) {
      expect(typeof DEFAULT_BUDGET[cap], `${cap} is not a number`).toBe('number')
      expect(Number.isInteger(DEFAULT_BUDGET[cap]) && DEFAULT_BUDGET[cap] >= 1).toBe(true)
    }
    expect(caps.length).toBeGreaterThanOrEqual(3)
    expect(Object.isFrozen(DEFAULT_BUDGET)).toBe(true)
  })

  it('every budget guard is namespaced `budget:` and NOTHING ELSE is', () => {
    // The census reconciles the guard that FIRED against the guard a case
    // DECLARES by FAMILY (`budget:nodes` -> `budget`). A budget guard that did
    // not carry the prefix would reconcile as a different door and the zero
    // would stop being attributable — which is the whole defect this file exists
    // to close.
    for (const guard of Object.keys(BUDGET_REFUSALS)) expect(guard.startsWith('budget:')).toBe(true)
    for (const guard of Object.keys(INTERPRET_REFUSALS)) expect(guard.startsWith('budget:')).toBe(false)
    for (const guard of Object.keys(PARSE_REFUSALS)) expect(guard.startsWith('budget:')).toBe(false)
  })

  it('the refusal sentences are DISJOINT across all three tables, both ways', () => {
    // ⛔ Two gates sharing a phrase let a `toThrow(/…/)` pass with the safety
    // deleted, and that has happened in this repo (Phase C Task 9's M1). The
    // substring half is the one a set-equality misses: "exceeds the node budget"
    // being a substring of another sentence would make a match on it useless.
    const all = { ...PARSE_REFUSALS, ...INTERPRET_REFUSALS, ...BUDGET_REFUSALS }
    expect(Object.keys(all).length).toBe(
      Object.keys(PARSE_REFUSALS).length
      + Object.keys(INTERPRET_REFUSALS).length
      + Object.keys(BUDGET_REFUSALS).length)
    const sentences = Object.values(all)
    expect(new Set(sentences).size).toBe(sentences.length)
    for (const a of sentences) {
      for (const b of sentences) {
        if (a !== b) expect(b.includes(a), `${JSON.stringify(a)} is a substring of ${JSON.stringify(b)}`).toBe(false)
      }
    }
  })

  it('the caps have HEADROOM over everything this repo actually ships', () => {
    // ⚠️ THE OTHER DIRECTION OF THE SAME RISK. A cap tight enough to refuse the
    // committed corpus would take `--check` red the moment it landed, and a cap
    // nothing can reach is not a guard. Both numbers are MEASURED here rather
    // than asserted in a comment.
    let worst = { maxNodes: 0, maxLookback: 0, maxSeriesRefs: 0 }
    for (const c of CORPUS.cases) {
      const r = checkBudget(c.ast, null)
      expect(r.ok, `${c.id} is over budget: ${r.error}`).toBe(true)
      worst = {
        maxNodes: Math.max(worst.maxNodes, r.measured.maxNodes),
        maxLookback: Math.max(worst.maxLookback, r.measured.maxLookback),
        maxSeriesRefs: Math.max(worst.maxSeriesRefs, r.measured.maxSeriesRefs),
      }
    }
    for (const cap of Object.keys(DEFAULT_BUDGET)) {
      // ⭐⭐ `maxLookback` IS THE ONE CAP THE CORPUS IS SUPPOSED TO REACH, and
      // that is a consequence of ruling O7 rather than a relaxation. The cap is
      // DERIVED as `max(NESTED_RECURRENCE_WARMUP, sessionMaxBars)`, so a
      // session-anchored entry does not merely approach it — it IS it, by
      // construction, at whatever number a session turns out to be. Demanding
      // headroom there would demand that the cap be bigger than the thing it was
      // sized to hold, which is a rail asking for its own subject to be wrong.
      // ⛔ EQUALITY IS STILL THE CEILING: one bar past it refuses, and the case
      // below measures exactly which shapes that costs.
      if (cap === 'maxLookback') {
        expect(worst[cap], `${cap}: the corpus is OVER the cap`)
          .toBeLessThanOrEqual(DEFAULT_BUDGET[cap])
        continue
      }
      expect(worst[cap], `${cap}: the corpus already sits AT the cap`).toBeLessThan(DEFAULT_BUDGET[cap])
    }
    // …and the equality is REAL rather than a widening nothing uses: some case
    // in the committed corpus must actually sit at the lookback cap, or the arm
    // above is an exemption granted to nobody.
    expect(worst.maxLookback, 'no corpus case reaches the lookback cap — the arm above is dead')
      .toBe(DEFAULT_BUDGET.maxLookback)
    expect(CORPUS.cases.length).toBeGreaterThanOrEqual(17)
  })

  it('⛔ A SESSION-ANCHORED CALL SATURATES THE LOOKBACK BUDGET — what that COSTS, by name', () => {
    // 🔴 THE MEMBER-VISIBLE CONSEQUENCE OF RULING O7, MEASURED RATHER THAN
    // DISCOVERED IN SUPPORT. `maxLookback` was derived to hold exactly one ET
    // session and `vwap()` declares exactly one ET session — so it uses the
    // WHOLE budget and there is nothing left for anything wrapped around it.
    // Bare and in pointwise arithmetic it is fine; ANY windowed or offset
    // composition refuses `budget:lookback`, at the save door and at compute.
    //
    // ⚠️ THIS IS NOT A BUG TO FIX HERE. The alternatives are a bigger cap (which
    // widens every other window AND the bar-offset ceiling with it — they are
    // one number by design) or a session-anchored entry that UNDER-declares its
    // window, which `_functions_warmup` forbids. It is written down so the next
    // lane reads it instead of finding it in a member's screenshot.
    const usable = ['vwap()', 'avwap(1762189200)', 'close > vwap()',
                    'vwap() - avwap(1762189200)']
    for (const src of usable) {
      const tree = parseFormula(src).ast
      expect(maxLookback(tree), src).toBe(DEFAULT_BUDGET.maxLookback)
      expect(checkBudget(tree, null).ok, `${src} must still be usable`).toBe(true)
    }
    // ⛔ `crossOver(close, vwap())` IS FIRST IN THIS LIST BECAUSE IT IS FIRST
    // IN A MEMBER'S HEAD. The original version of this case named `sma`,
    // `change` and the bar offset and omitted the one formula anybody actually
    // types — a rail that covers the shapes an engineer thinks of is not a rail
    // over the shapes a member writes.
    const refused = ['crossOver(close, vwap())', 'highest(vwap(), 2)',
                     'sma(vwap(), 20)', 'change(vwap())', 'vwap()[1]']
    for (const src of refused) {
      const tree = parseFormula(src).ast
      expect(maxLookback(tree), src).toBeGreaterThan(DEFAULT_BUDGET.maxLookback)
      const r = checkBudget(tree, null)
      expect(r.ok, `${src} unexpectedly fits`).toBe(false)
      expect(r.guard, src).toBe('budget:lookback')
      // ⭐ AND THE MESSAGE SAYS WHICH BUDGET AND WHY, NOT JUST "too long". Two
      // bare numbers one apart read as an arbitrary rejection; the member has no
      // way to know the fix is not a smaller window.
      expect(r.error, src).toMatch(/lookback budget/)
      expect(r.error, src).toMatch(/vwap\(\)/)
      expect(r.error, src).toMatch(/one whole trading session/)
      expect(r.error, src).toMatch(/nothing can be wrapped around it/)
    }
    // ⛔ AND IT IS NOT GLUED TO EVERY REFUSAL. A node-budget refusal, and a
    // lookback refusal with no session-anchored call in it, say nothing about
    // sessions — otherwise the clause is decoration rather than a reason.
    const deepOffset = parseFormula(`close[${DEFAULT_BUDGET.maxLookback + 1}]`).ast
    const plain = checkBudget(deepOffset, null)
    expect(plain.ok).toBe(false)
    expect(plain.guard).toBe('budget:lookback')
    expect(plain.error).not.toMatch(/trading session/)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 2. BOTH DOORS, AND BOTH LETHAL
// ═════════════════════════════════════════════════════════════════════════════

describe('a budget is checked at REGISTRATION and again at COMPUTE', () => {
  it('both are lethal, and the reason is not belt-and-braces', () => {
    // ⛔ BOTH, AND THE REASON IS NOT BELT-AND-BRACES.
    // Registration-only: a definition registered under one budget and run under a
    //   later, smaller one computes forever at the old cost.
    // Compute-only: the refusal arrives as a chart that draws sometimes — spec §6
    //   state 4, when it should have been an error the author saw while typing.
    // The registration check is the UX; the compute check is the SAFETY, and the
    // safety one is the one a mutation must not be able to delete quietly.
    const fat = chainOfNodes(DEFAULT_BUDGET.maxNodes + 1)
    expect(checkBudget(fat, DEFAULT_BUDGET).ok).toBe(false)
    expect(() => interpret(fat, BARS, {})).toThrow(/exceeds the node budget/)
  })

  it('the compute-time refusal is a TableRefusal carrying a `budget:` guard', () => {
    // ⛔ THE TYPE IS THE CONTRACT. `tools/ast_conformance.py` recognises a
    // refusal BY TYPE and reconciles `.guard` against the guard the case
    // declares; a look-alike class carrying `name = 'TableRefusal'` is exactly
    // the "right type for the wrong reason" blindness that instrument declared
    // about itself.
    expect(guardOf(() => interpret(chainOfNodes(DEFAULT_BUDGET.maxNodes + 1), BARS, {})))
      .toBe('budget:nodes')
    expect(guardOf(() => interpret(parseFormula(`sma(close, ${DEFAULT_BUDGET.maxLookback + 1})`).ast, BARS, {})))
      .toBe('budget:lookback')
    expect(guardOf(() => interpret(chainOfSeries(DEFAULT_BUDGET.maxSeriesRefs + 1), BARS, {})))
      .toBe('budget:series')
  })

  it('each cap admits AT the boundary and refuses ONE over it', () => {
    // ⭐ AT the cap, not near it. A guard tested only with a wildly oversized
    // input passes with an off-by-one in either direction, and an off-by-one
    // that ADMITS is a guard that is not there for the case it was written for.
    // Every number below is READ OUT OF `DEFAULT_BUDGET`, never typed.
    const N = DEFAULT_BUDGET.maxNodes
    expect(nodeCount(chainOfNodes(N))).toBe(N)
    expect(checkBudget(chainOfNodes(N), null).ok).toBe(true)
    expect(checkBudget(chainOfNodes(N + 1), null)).toMatchObject({ ok: false, guard: 'budget:nodes' })

    const L = DEFAULT_BUDGET.maxLookback
    expect(maxLookback(parseFormula(`sma(close, ${L})`).ast)).toBe(L)
    expect(checkBudget(parseFormula(`sma(close, ${L})`).ast, null).ok).toBe(true)
    expect(checkBudget(parseFormula(`sma(close, ${L + 1})`).ast, null))
      .toMatchObject({ ok: false, guard: 'budget:lookback' })

    const S = DEFAULT_BUDGET.maxSeriesRefs
    expect(seriesRefs(chainOfSeries(S))).toBe(S)
    expect(checkBudget(chainOfSeries(S), null).ok).toBe(true)
    expect(checkBudget(chainOfSeries(S + 1), null))
      .toMatchObject({ ok: false, guard: 'budget:series' })

    // …and a tree AT every cap still COMPUTES, which is the half a refusal-only
    // test never checks: a guard that refused everything would satisfy all three
    // negative assertions above.
    expect(interpret(parseFormula(`sma(close, ${L})`).ast, BARS, {}).length).toBe(BARS.length)
    expect(interpret(chainOfSeries(S), BARS, {}).length).toBe(BARS.length)
    expect(interpret(chainOfNodes(N), BARS, {}).length).toBe(BARS.length)
  })

  it('the lookback budget is a TREE SUM, not the largest single argument', () => {
    // `sma(sma(close, n), n)` looks back 2n bars, not n. A budget that read the
    // largest argument would admit a formula that needs more history than the
    // chart holds — and a column that is NaN for its whole visible range is a line
    // the user cannot see and cannot debug.
    //
    // ⚰️ THE WINDOW WAS THE LITERAL 300, CHOSEN SO 600 CLEARED A CAP OF 550. When
    // the cap moved to hold one session, 600 stopped tripping it and this case
    // went green while measuring nothing — a hand-typed number beside the cap it
    // was derived from. `n` is now derived FROM the cap, so the pair straddles it
    // wherever it sits.
    const cap = DEFAULT_BUDGET.maxLookback
    const n = Math.ceil((cap + 1) / 2)
    expect(2 * n).toBeGreaterThan(cap)      // the nest must exceed it…
    expect(n).toBeLessThanOrEqual(cap)      // …and one leg alone must not.
    expect(maxLookback(parseFormula(`sma(sma(close, ${n}), ${n})`).ast)).toBe(2 * n)
    expect(checkBudget(parseFormula(`sma(close, ${n})`).ast, null).ok).toBe(true)
    expect(checkBudget(parseFormula(`sma(sma(close, ${n}), ${n})`).ast, null))
      .toMatchObject({ ok: false, guard: 'budget:lookback' })
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 3. THE STORED BUDGET IS USER DATA
// ═════════════════════════════════════════════════════════════════════════════

describe('a budget declared on a definition OVERRIDES the default, downward ONLY', () => {
  it('a stored budget can tighten and can never raise', () => {
    // ⛔ DOWNWARD ONLY. `compute.budget` arrives from a stored definition, which
    // is USER DATA. A stored budget that could RAISE the cap is a stored value
    // that turns off its own limit — the same class as an `active=0` that also
    // blinds a soak, refused for the same reason.
    expect(effectiveBudget({ maxNodes: 9999 }).maxNodes).toBe(DEFAULT_BUDGET.maxNodes)
    expect(effectiveBudget({ maxNodes: 8 }).maxNodes).toBe(8)
    // …for EVERY cap, derived rather than spot-checked on one of them.
    for (const cap of Object.keys(DEFAULT_BUDGET)) {
      expect(effectiveBudget({ [cap]: DEFAULT_BUDGET[cap] * 10 })[cap]).toBe(DEFAULT_BUDGET[cap])
      expect(effectiveBudget({ [cap]: 1 })[cap]).toBe(1)
      expect(effectiveBudget({ [cap]: DEFAULT_BUDGET[cap] })[cap]).toBe(DEFAULT_BUDGET[cap])
    }
  })

  it('the clamp is INSIDE checkBudget, so no caller can route around it', () => {
    // ⚠️ A CLAMP A CALLER HAS TO REMEMBER IS A CLAMP SOMEBODY FORGETS. There must
    // be no code path in which a cap above the default is honoured — not even one
    // a caller constructs by hand and passes straight in.
    const fat = chainOfNodes(DEFAULT_BUDGET.maxNodes + 1)
    expect(checkBudget(fat, { maxNodes: 1e9 })).toMatchObject({ ok: false, guard: 'budget:nodes' })
    expect(checkBudget(fat, { maxNodes: 1e9 }).caps.maxNodes).toBe(DEFAULT_BUDGET.maxNodes)
    expect(() => interpret(fat, BARS, {}, { maxNodes: 1e9 })).toThrow(/exceeds the node budget/)
    // …and a TIGHTER stored budget really does reach compute, which is the whole
    // reason the compute check re-reads it rather than trusting registration.
    const slim = parseFormula('sma(close, 20)').ast
    expect(() => interpret(slim, BARS, {})).not.toThrow()
    expect(guardOf(() => interpret(slim, BARS, {}, { maxLookback: 19 }))).toBe('budget:lookback')
  })

  it('a malformed stored budget falls back to the CEILING, never above it', () => {
    // A blob that is not a whole number ≥ 1 is `defSchema`'s problem at a
    // different door. What matters here is the DIRECTION of the fallback: the
    // default IS the ceiling, so falling back to it can only tighten relative to
    // no budget at all.
    for (const junk of [null, undefined, 'lots', {}, [], { maxNodes: 'lots' },
      { maxNodes: 0 }, { maxNodes: -5 }, { maxNodes: 12.5 }, { maxNodes: NaN },
      { maxNodes: Infinity }, { maxNodes: true }]) {
      const eff = effectiveBudget(junk)
      for (const cap of Object.keys(DEFAULT_BUDGET)) {
        expect(eff[cap], `${JSON.stringify(junk)} moved ${cap}`).toBe(DEFAULT_BUDGET[cap])
      }
    }
    // an UNDECLARED key is ignored rather than absorbed — a stored blob cannot
    // introduce a cap this module has no guard for.
    expect(Object.keys(effectiveBudget({ maxWhatever: 3 })).sort())
      .toEqual(Object.keys(DEFAULT_BUDGET).sort())
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 4. THE DOOR. THIS IS THE DEFECT THE WHOLE FILE IS ABOUT.
// ═════════════════════════════════════════════════════════════════════════════

describe('every refusal comes from the door whose claim it is', () => {
  const budgetCases = ESCAPES.cases.filter((c) => String(c.guard).startsWith('budget:'))

  it('the corpus carries a case for EVERY cap, named — not a count', () => {
    // ⚠️ A LIST, NOT A COUNT. A count survives a rename; a list names the case
    // that moved. And without this floor every assertion below is satisfied by an
    // EMPTY corpus, which is how `escaped == parsed` is satisfied by `0 == 0`.
    expect(budgetCases.map((c) => c.id).sort())
      .toEqual(['lookback_too_deep', 'nested_lookback', 'too_many_nodes', 'too_many_series'])
    const declared = new Set(budgetCases.map((c) => c.guard))
    expect([...declared].sort()).toEqual(Object.keys(BUDGET_REFUSALS).sort())
  })

  it('each budget case is refused BY ITS OWN GUARD, with its own fragment', () => {
    // 🔴 THE DEFECT THIS REPLACES, NAMED. The escape census used to hand each
    // case's JSEP tree straight to `interpret`; the Python lane has no parser, so
    // all fifteen were refused at the ROOT by `interpret:node` — including these,
    // which read IDENTICALLY with no budget in the product at all. A refusal from
    // the wrong door is not evidence for the claim it is credited to.
    // ⚠️ `canonicalise` FIRST, AND THIS FILE'S OWN FIRST RUN IS WHY THE LINE IS
    // HERE. Written without it, `lookback_too_deep` and `nested_lookback` fired
    // `interpret:node` — because `escapes.json`'s `ast` is the JSEP tree, and a
    // jsep tree offered to `interpret` is refused at the ROOT for a reason that
    // has nothing to do with a budget. That is THE defect, reproduced inside the
    // test written to forbid it, on its first execution. A user's formula travels
    // jsep -> canonicalise -> interpret, and so does this.
    const problems = []
    for (const c of budgetCases) {
      const tree = c.astFrom ? generated(c.astFrom) : canonicalise(c.ast)
      let fired = null
      let message = ''
      try {
        interpret(tree, BARS, {})
      } catch (e) {
        if (!(e instanceof TableRefusal)) { problems.push(`${c.id}: ${e.name} is not a refusal`); continue }
        fired = e.guard
        message = e.message
      }
      if (fired === null) { problems.push(`${c.id}: REACHED A VALUE`); continue }
      if (fired !== c.guard) { problems.push(`${c.id}: fired ${fired}, declares ${c.guard}`); continue }
      if (!message.includes(c.refuse)) problems.push(`${c.id}: ${JSON.stringify(message)} lacks ${JSON.stringify(c.refuse)}`)
    }
    expect(problems).toEqual([])
  })

  it('a refusal that belongs to another guard is NOT re-labelled as a budget one', () => {
    // ⭐ THE OTHER HALF OF THE SAME RULE, AND THE ONE A BUDGET IS MOST LIKELY TO
    // BREAK. `checkBudget` calls `maxLookback`, which refuses `resolve:function`,
    // `resolve:arity` and `resolve:window`; because the budget now runs FIRST,
    // those refusals are raised from INSIDE it. They must still name their own
    // door — the refusal names what DECIDED, never what was on the stack.
    const call = (name, ...args) => ({ type: 'call', name, args })
    expect(guardOf(() => interpret(call('rugpull', series('close'), num(3)), BARS, {}))).toBe('resolve:function')
    expect(guardOf(() => interpret(call('sma', series('close')), BARS, {}))).toBe('resolve:arity')
    expect(guardOf(() => interpret(call('sma', series('close'), series('close')), BARS, {}))).toBe('resolve:window')
    expect(guardOf(() => interpret(series('globalThis'), BARS, {}))).toBe('resolve:name')
    expect(guardOf(() => interpret({ type: 'wat' }, BARS, {}))).toBe('interpret:node')
    // …and the same through the REGISTRATION door, which returns a result for a
    // budget and THROWS for anything else. A `checkBudget` that swallowed these
    // into `{ok:false, guard:'budget:*'}` would move four cases to the wrong door
    // in one edit.
    expect(guardOf(() => checkBudget(call('rugpull', series('close'), num(3)), null))).toBe('resolve:function')
    expect(guardOf(() => checkBudget({ type: 'wat' }, null))).toBe('interpret:node')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 5. A RangeError IS NOT A REFUSAL, AND IT CANNOT BE MADE INTO ONE
// ═════════════════════════════════════════════════════════════════════════════

describe('a stack overflow can never be dressed up as a budget refusal', () => {
  /** Every `TryStatement` in a JS source, found by an AST walk. */
  const trysIn = (source) => {
    const found = []
    const walk = (node) => {
      if (!node || typeof node !== 'object') return
      if (Array.isArray(node)) { node.forEach(walk); return }
      if (node.type === 'TryStatement') found.push(node)
      for (const [key, value] of Object.entries(node)) {
        if (key === 'type' || key === 'start' || key === 'end') continue
        if (value && typeof value === 'object') walk(value)
      }
    }
    walk(parseJs(source, { ecmaVersion: 2023, sourceType: 'module' }))
    return found
  }

  it('the scanner FINDS a relabelling catch — the positive control, first', () => {
    // ⛔ A DETECTOR NOBODY PROVED CAN FIRE IS NOT A DETECTOR. This is the mutation
    // the rail below exists to forbid, written out in full, and the scan must see
    // it. Without this the next assertion is satisfied by a broken walker.
    const mutated = `
      export function interpret (ast, bars) {
        try { return walk(ast, bars) }
        catch (e) { throw new TableRefusal('budget:nodes', 'exceeds the node budget') }
      }
    `
    expect(trysIn(mutated).length).toBe(1)
    // …and a source with the same words in a COMMENT is NOT a hit, which is the
    // half a grep gets wrong in the direction that fails a clean file.
    expect(trysIn('// try { } catch (e) { throw new TableRefusal("budget:nodes") }\nexport const x = 1').length).toBe(0)
  })

  it('neither the budget nor the interpreter contains a single `try`', () => {
    // ⭐ STRUCTURAL, BECAUSE IN THIS LANE IT CAN NO LONGER BE BEHAVIOURAL — and
    // saying so is the point rather than a hedge. `maxNodes` is 128, and a
    // canonical tree's DEPTH can never exceed its node count, so the recursive
    // walker below the budget can now be reached with at most 128 frames. The
    // `RangeError` is therefore UNREACHABLE through `interpret`, which means the
    // relabelling defect can be INTRODUCED but never OBSERVED — exactly the shape
    // that rots green. The Python lane keeps the behavioural proof (it can lower
    // its own recursion limit); this lane keeps the structural one.
    //
    // ⛔ AN AST, NEVER A GREP. `git grep -c admit_alert_fire` said 2, then 3, on
    // this branch, and every one was PROSE IN A COMMENT — both modules below talk
    // about `try` and `catch` in their headers at length.
    for (const file of ['budget.js', 'interpret.js']) {
      expect(trysIn(readSource(file)).length, `${file} grew a try — a caught RangeError is one line from being a refusal`).toBe(0)
    }
    // …and the control that keeps the reader honest: `parse.js` DOES have them
    // (`parseFormula` is the door that never throws), so "zero" above is a
    // property of those two files and not of this scanner.
    expect(trysIn(readSource('parse.js')).length).toBeGreaterThan(0)
  })

  it('the 8,001-node tree is refused by the BUDGET, not by a crash', () => {
    // The measurement is what decided, and it is reported: `nodeCount` answers
    // 8001 (iteratively — it survives the tree that kills the walker) and the cap
    // is 128. A `RangeError` relabelled as a refusal would carry no such number,
    // and could not carry a truthful one.
    const fat = chainOfNodes(8001)
    expect(nodeCount(fat)).toBe(8001)
    const r = checkBudget(fat, null)
    expect(r).toMatchObject({ ok: false, guard: 'budget:nodes' })
    expect(r.measured.maxNodes).toBe(8001)
    expect(r.caps.maxNodes).toBe(DEFAULT_BUDGET.maxNodes)
    expect(guardOf(() => interpret(fat, BARS, {}))).toBe('budget:nodes')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 6. THE ONE DECLARED DIVERGENCE, AND WHY IT CANNOT BITE
// ═════════════════════════════════════════════════════════════════════════════

describe('maxLookback answers 0 for a series the table does not declare', () => {
  it('the divergence is real, pinned by name, and it authorises NO work', () => {
    // ⏳ HANDED FORWARD BY TASK 7 AS THE ONE DECLARED DIVERGENCE: `maxLookback`
    // treats EVERY `series` node as 0 lookback, including a name the table has
    // never heard of. A budget computed from a wrong lookback is a budget that
    // does not bind — so this is the case that has to be argued, not assumed.
    //
    // ⭐ IT CANNOT BITE, AND THE PROOF IS THE ORDER OF THE DOORS RATHER THAN A
    // SECOND CHECK. `maxLookback` is only ever WRONG about a name that does not
    // resolve; a tree containing such a name is refused by `resolve:name` before
    // it computes a single bar. So the 0 can never authorise work: there is no
    // input for which the budget says yes and the walker then runs.
    expect(maxLookback(series('globalThis'))).toBe(0)
    expect(TABLE.series.globalThis).toBeUndefined()
    expect(checkBudget(series('globalThis'), null).ok).toBe(true)   // the budget admits it…
    expect(guardOf(() => interpret(series('globalThis'), BARS, {}))).toBe('resolve:name')  // …and it never runs

    // ⛔ AND FIXING IT HERE WOULD BE THE WRONG DOOR AGAIN. Refusing an undeclared
    // name inside the budget would move `escapes.json`'s three `resolve:name`
    // cases under a `budget:*` guard — re-creating, in one edit, the exact defect
    // this task was written to remove. Those three are asserted to stay put.
    for (const name of ['toString', 'hasOwnProperty', 'globalThis']) {
      expect(checkBudget(series(name), null).ok).toBe(true)
      expect(guardOf(() => interpret(series(name), BARS, {}))).toBe('resolve:name')
    }

    // ⚠️ THE ONE PLACE AN UNDECLARED NAME *IS* COUNTED IS `seriesRefs`, and it is
    // counted CONSERVATIVELY — an over-count can only tighten the budget.
    expect(seriesRefs(series('globalThis'))).toBe(1)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 7. THE MODULE CYCLE
// ═════════════════════════════════════════════════════════════════════════════

describe('budget.js and interpret.js import each other, and it resolves', () => {
  it('every binding this graph entered through budget.js is live', () => {
    // The graph this file created ENTERS at `budget.js`. `interpret.test.js`
    // enters at `interpret.js`. Both directions have to work, and a broken cycle
    // in either shows up as an import-time failure rather than a wrong answer —
    // which is the good kind of failure.
    expect(typeof checkBudget).toBe('function')
    expect(typeof assertBudget).toBe('function')
    expect(typeof interpret).toBe('function')
    expect(typeof nodeCount).toBe('function')
    expect(typeof maxLookback).toBe('function')
    expect(TableRefusal.prototype).toBeInstanceOf(Error)
    // …and the classes really are the SAME one, which is what makes an
    // `instanceof` in a caller mean anything.
    expect(assertBudget(num(1), null).ok).toBe(true)
    let caught = null
    try { assertBudget(chainOfNodes(DEFAULT_BUDGET.maxNodes + 1), null) } catch (e) { caught = e }
    expect(caught).toBeInstanceOf(TableRefusal)
    expect(caught.name).toBe('TableRefusal')
  })
})

/** `tools/ast_conformance.py::generate_ast`'s specs, in CANONICAL shape.
 *
 *  ⚠️ The Python side generates a JSEP tree and canonicalises it; this builds the
 *  canonical tree directly, because this file has no parser step to run for
 *  `gen:nest`'s ellipsis-bearing `source`. Both are ITERATIVE for the same
 *  reason. The sizes are read out of the spec string, never re-typed. */
function generated(spec) {
  let m = /^gen:nest\((\d+)\)$/.exec(String(spec))
  if (m) {
    let node = num(1)
    for (let i = 0; i < Number(m[1]); i++) node = op('+', num(1), node)
    return node
  }
  m = /^gen:seriesChain\((\d+)\)$/.exec(String(spec))
  if (m) {
    // ⭐ THE NAMES COME OUT OF THE MANIFEST, exactly as the Python generator's
    // do, and SORTED so both lanes build the same tree from the same spec.
    //
    // ⭐ SERIES *AND* SCALARS, AND DISTINCT — the same change `ast_conformance.py`
    // made, for the same reason. `seriesRefs` counts DISTINCT reads, so a chain
    // that cycled the five bar fields measured five however long it got, and this
    // spec exists to EXCEED a cap of eight. A scalar rides the same `series` node
    // and is a per-symbol column read, so it costs the data the cap is about.
    const names = [...Object.keys(TABLE.series).sort(), ...Object.keys(TABLE.scalars).sort()]
    const want = Number(m[1])
    if (want > names.length) throw new Error(`gen:seriesChain(${want}): the manifest declares ${names.length}`)
    let node = series(names[0])
    for (let i = 1; i < want; i++) node = op('+', node, series(names[i]))
    return node
  }
  throw new Error(`unknown AST generator spec: ${spec}`)
}

// --------------------------------------------------------------------------- //
// 🔴 THE SESSION WINDOW DOES NOT FIT THIS BUDGET — DECLARED, NOT SMOOTHED OVER
// --------------------------------------------------------------------------- //

describe('the `session` lookback and the lookback cap', () => {
  it('⭐ the cap HOLDS at least one session — the ruling that made the grammar usable', () => {
    // ⭐ CONTROLLER RULING O7 (2026-08-26). One extended ET session is longer than
    // the nested-recurrence warmup the cap used to be, so before this every
    // `lookback: "session"` call refused `budget:lookback` at the save door AND at
    // compute — a declared grammar that shipped unusable.
    //
    // ⛔ THE CAP WAS NOT MOVED "TO MAKE ONE SCRIPT PASS", which the note above it
    // forbids. It moved for a reason of the same KIND as the 500 → 550 move: a
    // whole declared grammar the spec requires, with the number derived from this
    // engine's own definition of a session rather than chosen to fit.
    expect(DEFAULT_BUDGET.maxLookback).toBeGreaterThanOrEqual(SESSION_MAX_BARS)

    // …and the refusal is really gone, measured through the same cap on the one
    // shape that can reach `maxLookback` with a session-sized window today.
    const sessionDeep = { type: 'offset', value: SESSION_MAX_BARS, args: [{ type: 'series', name: 'close' }] }
    expect(maxLookback(sessionDeep)).toBe(SESSION_MAX_BARS)
    expect(checkBudget(sessionDeep, undefined).ok).toBe(true)

    // ⛔ AND THE CAP IS STILL A GUARD, NOT A LATCH. One bar past it still refuses —
    // `lesson_gate_that_cannot_fail` is what this line is against.
    const tooDeep = { type: 'offset', value: DEFAULT_BUDGET.maxLookback + 1, args: [{ type: 'series', name: 'close' }] }
    expect(checkBudget(tooDeep, undefined)).toMatchObject({ ok: false, guard: CAP_GUARD.maxLookback })
    let guard = null
    try { assertBudget(tooDeep, undefined) } catch (err) { guard = err.guard }
    expect(guard, 'the SAFETY half must refuse it too, not just the UX half').toBe(CAP_GUARD.maxLookback)
  })

  it('⛔⛔ the cap is DERIVED from the session constant, never typed to match it', () => {
    // The binding condition of the ruling. Two numbers that must agree, typed in
    // two places, is this repo's most repeated defect — and it would be a poor
    // thing to introduce in the change that removed the FIFTH hand-written copy of
    // the lookback grammar.
    const src = readSource('budget.js')
    const cap = DEFAULT_BUDGET.maxLookback
    expect(new RegExp(`(?<![\\d.])${cap}(?![\\d.])`).test(src),
      `budget.js spells the lookback cap as the literal ${cap} instead of deriving it ` +
      'from the session constant',
    ).toBe(false)
    expect(src.includes('Math.max(NESTED_RECURRENCE_WARMUP, SESSION_MAX_BARS)'),
      'the cap no longer reads as "the larger of the two families it holds"').toBe(true)

    // ⚠️ THE `Math.max` IS LOAD-BEARING IN BOTH DIRECTIONS. If a corrected session
    // were ever SHORTER than the floor, dropping the floor would silently refuse
    // the nested-recurrence family the 2026-08-22 move was made to admit.
    const floor = Number(/const NESTED_RECURRENCE_WARMUP = (\d+)/.exec(src)?.[1])
    expect(Number.isInteger(floor)).toBe(true)
    expect(floor).toBeGreaterThanOrEqual(524)   // accum-in-accum: 250 + 250 + ATR's 22 + 1
    expect(cap).toBe(Math.max(floor, SESSION_MAX_BARS))
  })

  it('the budget holds no READER of a lookback declaration — it thresholds the measurement', () => {
    // ⭐ THE DISTINCTION THE RULING TURNS ON, AND IT IS NARROW. The budget MAY read
    // the session CONSTANT — its cap is derived from it. What it must never hold is
    // a second READER of a `lookback` declaration: the thing that turns `'session'`
    // into a number is `maxLookback`, once, in `interpret.js`.
    const src = readSource('budget.js')
    for (const reader of ['spec.lookback', 'SESSION_LOOKBACK']) {
      expect(src.includes(reader),
        `budget.js resolves a lookback declaration itself (${reader}) instead of ` +
        'thresholding the measurement that already does',
      ).toBe(false)
    }
  })
})

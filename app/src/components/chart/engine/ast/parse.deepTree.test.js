/**
 * ⭐⭐ `canonicalise` MUST NOT DIE ON A TREE IT IS SUPPOSED TO REFUSE.
 *
 * `convert` was recursive, one frame per node, so its ceiling was a property of
 * THE RUNNING MACHINE'S STACK rather than of the node budget that exists to bound
 * exactly this. Measured on this runtime, 2026-09-11, by importing the pre-change
 * file beside the new one and bisecting:
 *
 *     recursive convert : survives 5,468 nodes deep, dies by 5,500
 *     iterative convert : 200,000 deep, fine
 *
 * ⚰️ AND THE OVERFLOW DID NOT LOOK LIKE AN OVERFLOW. `parseFormula` ends with
 * `guard: err instanceof TableRefusal ? err.guard : 'canonicalise:node'`, and a
 * `RangeError` is not a `TableRefusal` — so a stack overflow reached the member
 * as **`canonicalise:node`**, the "I don't recognise this node shape" refusal,
 * for a formula made entirely of `+` and `1`. Measured through the same door:
 *
 *     OLD parseFormula(12,000 terms) -> refused: canonicalise:node
 *     NEW parseFormula(12,000 terms) -> ok, and the BUDGET then refuses it
 *
 * That is why nothing caught it: a laundered `RangeError` is indistinguishable
 * from an ordinary table refusal in every census, log and fixture — it has a
 * guard name, it is `ok: false`, and it is counted as refused. `budget.js` says
 * in writing that a `RangeError` is NOT a refusal and that it holds no `try` so
 * it cannot become one. The laundering happened one layer above it.
 *
 * ⛔ SO THE FIX IS TO STOP OVERFLOWING, NOT TO CATCH THE OVERFLOW — a caught
 * overflow is the defect above, made official.
 *
 * ⚠️ THE CORPUS CASE DOES NOT PROVE THIS. `escapes.json::too_many_nodes` is
 * `gen:nest(4000)` = 4,001 deep, which is UNDER the measured ceiling, so it
 * passed before this change and passes after. It is pinned here because it is the
 * declared claim; the regression proof is the self-calibrating control below.
 */
import { describe, it, expect } from 'vitest'
import { canonicalise, parseFormula } from './parse.js'
import { assertBudget, DEFAULT_BUDGET } from './budget.js'
import ESCAPES from '../../../../../../tests/fixtures/ast/escapes.json'

const CASE = ESCAPES.cases.find((c) => c.id === 'too_many_nodes')

/** The `gen:nest(N)` generator, in the shape `tools/ast_conformance.py` builds
 *  it: a right-leaning chain of N `+` nodes over `1` — N+1 deep, 2N+1 nodes.
 *  The SIZE is read off the corpus spec, never typed here. */
function nestSpec(spec) {
  const m = /^gen:nest\((\d+)\)$/.exec(spec || '')
  return m ? Number(m[1]) : null
}

function buildNest(n) {
  let node = { type: 'Literal', value: 1, raw: '1' }
  for (let i = 0; i < n; i += 1) {
    node = {
      type: 'BinaryExpression',
      operator: '+',
      left: { type: 'Literal', value: 1, raw: '1' },
      right: node,
    }
  }
  return node
}

function countCanonical(root) {
  let n = 0
  const stack = [root]
  while (stack.length) {
    const node = stack.pop()
    if (!node || typeof node !== 'object') continue
    n += 1
    for (const kid of node.args || []) stack.push(kid)
  }
  return n
}

/** ⭐⭐ THE CONTROL CALIBRATES ITSELF, because the number it needs is a property
 *  of the engine running the test and not of this repo.
 *
 *  A MINIMAL recursive walk — two arguments, no switch, no allocation — is the
 *  cheapest frame a tree walker can have, so its ceiling is an UPPER BOUND on
 *  every real one's. `convert` did far more per frame and died at 5,468 while
 *  this dies later; that direction is what makes the bound safe. Any depth past
 *  this ceiling is therefore a depth the old recursion could not have survived,
 *  on whatever engine is running right now.
 */
function naiveRecursionCeiling() {
  const walk = (node) => (node && node.type === 'BinaryExpression'
    ? 1 + Math.max(walk(node.left), walk(node.right))
    : 1)
  const dies = (n) => {
    try { walk(buildNest(n)); return false } catch (err) { return err instanceof RangeError }
  }
  let lo = 1000
  let hi = 1000
  while (!dies(hi)) {
    lo = hi
    hi *= 2
    if (hi > 4_000_000) return null // no reachable ceiling — the control is void
  }
  while (hi - lo > 250) {
    const mid = Math.floor((lo + hi) / 2)
    if (dies(mid)) hi = mid; else lo = mid
  }
  return hi
}

describe('⛔⛔ a tree too deep for a recursive walker reaches its DOOR', () => {
  it('the corpus still declares this case, and still declares its size', () => {
    expect(CASE, 'escapes.json no longer carries `too_many_nodes`').toBeTruthy()
    expect(nestSpec(CASE.astFrom), `astFrom moved to ${CASE.astFrom}`).toBeGreaterThan(0)
    expect(CASE.guard).toBe('budget:nodes')
  })

  it('⭐ the corpus case converts, then refuses at the guard it names', () => {
    const n = nestSpec(CASE.astFrom)
    let ast
    expect(() => { ast = canonicalise(buildNest(n)) }).not.toThrow()
    expect(countCanonical(ast)).toBe(2 * n + 1) // n `op` + n+1 `num`

    let refusal = null
    try {
      assertBudget(ast, DEFAULT_BUDGET)
    } catch (err) {
      refusal = err
    }
    expect(refusal, `the budget let ${2 * n + 1} nodes through`).toBeTruthy()
    expect(refusal).not.toBeInstanceOf(RangeError)
    expect(refusal.guard).toBe(CASE.guard)
    expect(String(refusal.message)).toContain(CASE.refuse)
  })

  it('⭐⭐ THE DEPTH CONTROL — past any recursion\'s reach, the BUDGET answers', () => {
    const ceiling = naiveRecursionCeiling()
    expect(ceiling, 'no recursive walk on this engine overflows at any reachable '
      + 'depth, so nothing here can prove the iterative walker is load-bearing')
      .toBeTruthy()

    // Comfortably past the cheapest possible recursive frame's ceiling, so the
    // walker that used to be here could not have reached the door at all.
    const depth = ceiling * 2
    const source = Array(depth + 1).fill('1').join('+')

    const parsed = parseFormula(source)
    // ⛔ THE OLD FAILURE MODE, NAMED. A RangeError laundered through
    // `parseFormula`'s catch arrives here as exactly this guard — so asserting
    // "not canonicalise:node" is asserting "the stack did not decide this".
    expect(parsed.guard, `a ${depth}-deep chain of '+' was refused as an unknown `
      + 'node shape — that is a laundered stack overflow, not a table refusal')
      .not.toBe('canonicalise:node')
    expect(parsed.ok, parsed.error).toBe(true)

    let refusal = null
    try {
      assertBudget(parsed.ast, DEFAULT_BUDGET)
    } catch (err) {
      refusal = err
    }
    expect(refusal).toBeTruthy()
    expect(refusal).not.toBeInstanceOf(RangeError)
    expect(refusal.guard).toBe('budget:nodes')
  })
})

describe('⭐ the iterative walker assembles children in the ORIGINAL order', () => {
  // ⛔ THE STACK PUSHES CHILDREN IN REVERSE so they COMPLETE left-to-right. Get
  // that backwards and every non-commutative expression silently inverts —
  // `close - open` becomes `open - close` — and nothing else in the suite is
  // shaped to notice, because both trees are structurally valid.
  it('a subtraction keeps its operands on the correct sides', () => {
    const r = parseFormula('close - open')
    expect(r.ok).toBe(true)
    expect(r.ast).toEqual({
      type: 'op',
      name: '-',
      args: [{ type: 'series', name: 'close' }, { type: 'series', name: 'open' }],
    })
  })

  it('a ternary keeps test / consequent / alternate in that order', () => {
    const r = parseFormula('close > open ? high : low')
    expect(r.ok).toBe(true)
    expect(r.ast.name).toBe('?:')
    expect(r.ast.args[0]).toEqual({
      type: 'op',
      name: '>',
      args: [{ type: 'series', name: 'close' }, { type: 'series', name: 'open' }],
    })
    expect(r.ast.args[1]).toEqual({ type: 'series', name: 'high' })
    expect(r.ast.args[2]).toEqual({ type: 'series', name: 'low' })
  })

  it('a right-nested chain comes back right-nested, all the way down', () => {
    // Deep enough to exercise the stack, shallow enough that the OLD recursion
    // handled it — so this asserts EQUIVALENCE, not the new capability.
    const depth = 200
    const ast = canonicalise(buildNest(depth))
    let node = ast
    for (let i = 0; i < depth; i += 1) {
      expect(node.type).toBe('op')
      expect(node.name).toBe('+')
      expect(node.args[0]).toEqual({ type: 'num', value: 1 })
      node = node.args[1]
    }
    expect(node).toEqual({ type: 'num', value: 1 })
  })
})

describe('⭐ refusal ORDER survived the rewrite', () => {
  // ⛔ `refuse` THROWS, so which guard fires first is BEHAVIOUR — `escapes.json`
  // fates cases to guards by name. The recursion ran a node's own guards and then
  // descended left-to-right; these are the two ways the rewrite could have
  // stopped doing that.
  it("a PARENT's guard beats its child's", () => {
    // `sym`'s ticker-shape guard is on the parent; the child `tf(close)` is a
    // one-argument timeframe read, an offence in its own right. The parent wins.
    const r = parseFormula("sym('!!bad!!', tf(close))")
    expect(r.ok).toBe(false)
    expect(r.guard).toBe('canonicalise:symbol')
  })

  it('the LEFT sibling refuses before the right one', () => {
    const left = parseFormula("tf(close) + sym('!!bad!!', close)")
    expect(left.ok).toBe(false)
    expect(left.guard).toBe('canonicalise:timeframe')

    // ⭐ THE MIRROR, and it is the control: swap the operands and the OTHER guard
    // must answer. Without it, a walker that always reported
    // `canonicalise:timeframe` would satisfy the assertion above.
    const right = parseFormula("sym('!!bad!!', close) + tf(close)")
    expect(right.ok).toBe(false)
    expect(right.guard).toBe('canonicalise:symbol')
  })
})

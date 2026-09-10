// ─── ITEM 9 — THE GROUP C RAIL, WRITTEN AGAINST THE ORDER AND NOT THE OUTCOME ──
//
// ⛔⛔ THE OUTCOME-SHAPED VERSION OF THIS TEST WOULD PASS VACUOUSLY, WHICH IS THE
// WHOLE REASON THIS FILE LOOKS THE WAY IT DOES. The obvious rail is "`import x as
// ta` then `ta.sma` must not fold to our `ta.sma`". That is green today — but for
// a reason that has nothing to do with resolution order: `pine:module` refuses
// every import OUTRIGHT, before any name is resolved, so the collision is
// unreachable and the assertion never exercises the thing it names.
//
// ⚠️ AND IT WOULD KEEP PASSING RIGHT UP UNTIL THE DAY IMPORTS ARE SUPPORTED, then
// start silently permitting the collision. A rail that expires without ever going
// red is `lesson_an_arming_condition_that_names_a_test_expires` wearing new
// clothes, and this repo has paid for that shape before.
//
// ⭐ SO WHAT IS ASSERTED IS THE ORDERING ITSELF, structurally: inside the
// dotted-name branch of the resolver, THE SCRIPT'S OWN SCOPE IS CONSULTED BEFORE
// THE BUILTINS ARE. `typeRefusalFor` reads `this.types` (types the script
// DECLARED) and `this.env` (names it BOUND); every `BUILTIN_*` map is the engine's
// vocabulary. If the builtins were asked first, a user type or local named
// `syminfo` would resolve to the Pine namespace and the member would get a
// confident wrong answer instead of `pine:type`.
//
// ⭐⭐ THIS IS CHECKED WHILE THE COLLISION IS STILL UNREACHABLE, which is exactly
// the point: the ordering is pinned NOW, so the day `pine:module` stops refusing
// imports the guarantee is already in place rather than needing to be remembered.
//
// ⛔ Group C is NOT vocabulary and must never be added to a builtins table —
// `zen.toWhole`, `mymas.ema`, `kernels.rationalQuadratic` are imported LIBRARY
// calls and `upVolumes.sum`, `direction.neutral` are user-defined TYPE field
// reads. Declaring them would make the engine claim to implement functions it has
// never seen. See `docs/pine/r11-vocabulary-gap.md`.

import fs from 'fs'
import path from 'path'
import url from 'url'
import { describe, it, expect } from 'vitest'
import { Parser } from 'acorn'

const HERE = path.dirname(url.fileURLToPath(import.meta.url))
const PINE = path.join(HERE, 'pine.js')
const SRC = fs.readFileSync(PINE, 'utf-8')

const AST = Parser.parse(SRC, {
  ecmaVersion: 'latest', sourceType: 'module', ranges: true,
})

/** Every node in the tree, flat. Small enough at this file's size, and it keeps
 *  the walk honest — no visitor list to fall out of date with acorn. */
function* walk(node) {
  if (!node || typeof node.type !== 'string') return
  yield node
  for (const k of Object.keys(node)) {
    if (k === 'type' || k === 'range' || k === 'loc') continue
    const v = node[k]
    if (Array.isArray(v)) { for (const c of v) yield* walk(c) }
    else if (v && typeof v.type === 'string') yield* walk(v)
  }
}

const NODES = [...walk(AST)]

/** The dotted-name branches of the resolver: `if (dot > 0) { … }`. There is more
 *  than one site that tests a dot, so they are found by SHAPE and then filtered
 *  to the one(s) that actually resolve against the builtins. */
const dottedBranches = NODES.filter((n) =>
  n.type === 'IfStatement'
  && n.test?.type === 'BinaryExpression'
  && n.test.operator === '>'
  && n.test.left?.type === 'Identifier'
  && n.test.left.name === 'dot'
  && n.test.right?.value === 0
  && n.consequent)

const inRange = (node, lo, hi) => node.range[0] >= lo && node.range[1] <= hi

/** First source offset at which `name` is referenced inside [lo, hi). */
function firstRefOffset(name, lo, hi) {
  let best = Infinity
  for (const n of NODES) {
    if (!n.range || !inRange(n, lo, hi)) continue
    if (n.type === 'Identifier' && n.name === name) best = Math.min(best, n.range[0])
    if (n.type === 'MemberExpression' && n.property?.type === 'Identifier'
        && n.property.name === name) best = Math.min(best, n.range[0])
  }
  return best
}

/** First offset at which ANY `BUILTIN_*` map is referenced inside [lo, hi). */
function firstBuiltinOffset(lo, hi) {
  let best = Infinity
  let which = null
  for (const n of NODES) {
    if (!n.range || !inRange(n, lo, hi)) continue
    if (n.type === 'Identifier' && /^BUILTIN_[A-Z_]+$/.test(n.name)
        && n.range[0] < best) { best = n.range[0]; which = n.name }
  }
  return { offset: best, which }
}

describe('⛔ Group C — the script\'s own scope is consulted BEFORE the builtins', () => {
  it('⭐ NON-VACUITY — the probe finds the resolver\'s dotted branch at all', () => {
    expect(dottedBranches.length, 'no `if (dot > 0)` branch was found in pine.js — '
      + 'the resolver has been reshaped and this rail is measuring nothing')
      .toBeGreaterThan(0)
  })

  /** The branch under test is the one that reaches the vocabulary. Selecting it by
   *  what it CONTAINS rather than by a line number, so a refactor moves it without
   *  silently disarming the rail. */
  const resolving = dottedBranches.filter((b) =>
    firstBuiltinOffset(b.consequent.range[0], b.consequent.range[1]).offset < Infinity)

  it('⭐ NON-VACUITY — at least one dotted branch actually reaches a BUILTIN_ map', () => {
    expect(resolving.length, 'no dotted branch references any BUILTIN_* map, so '
      + '"scope before builtins" has nothing to be true OR false about — the '
      + 'control that stops this file passing for the wrong reason')
      .toBeGreaterThan(0)
  })

  it('⛔⛔ typeRefusalFor is called BEFORE any BUILTIN_ lookup in that branch', () => {
    for (const b of resolving) {
      const [lo, hi] = [b.consequent.range[0], b.consequent.range[1]]
      const scopeAt = firstRefOffset('typeRefusalFor', lo, hi)
      const { offset: builtinAt, which } = firstBuiltinOffset(lo, hi)

      expect(scopeAt, 'a dotted branch resolves against '
        + `\`${which}\` without consulting \`typeRefusalFor\` first. That call is `
        + 'what reads `this.types` (types the script DECLARED) and `this.env` '
        + '(names it BOUND). Without it a user type or local named `syminfo` '
        + 'resolves to the Pine namespace and the member gets a confident wrong '
        + 'answer instead of `pine:type`.').toBeLessThan(Infinity)

      expect(scopeAt, `the builtins (\`${which}\`) are consulted at offset `
        + `${builtinAt}, BEFORE the script's own scope at ${scopeAt}. `
        + 'ORDER IS THE INVARIANT: whichever is asked first wins, so builtins-first '
        + 'means a script\'s own declaration can be shadowed by our vocabulary. '
        + '⛔ Do not fix this by asserting an outcome — the collision is currently '
        + 'unreachable because `pine:module` refuses imports outright, so an '
        + 'outcome test passes vacuously and expires the day imports land.')
        .toBeLessThan(builtinAt)
    }
  })

  it('⭐ typeRefusalFor really does read the script\'s scope, not a static list', () => {
    // Without this, the ordering above could be satisfied by a `typeRefusalFor`
    // that consults nothing — the order would be right and the guarantee empty.
    const fn = NODES.find((n) =>
      (n.type === 'MethodDefinition' || n.type === 'Property')
      && n.key?.name === 'typeRefusalFor')
    expect(fn, 'typeRefusalFor is gone — the rail above is pinning a call to '
      + 'something that no longer exists').toBeTruthy()
    const body = SRC.slice(fn.range[0], fn.range[1])
    expect(body, 'typeRefusalFor no longer reads `this.types` — it is not '
      + 'consulting the types the SCRIPT declared').toMatch(/this\.types/)
    expect(body, 'typeRefusalFor no longer reads `this.env` — it is not '
      + 'consulting the names the SCRIPT bound').toMatch(/this\.env/)
  })
})

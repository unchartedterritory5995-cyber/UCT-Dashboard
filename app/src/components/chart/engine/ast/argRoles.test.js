// ─── `argRoles` WAS DOCUMENTATION, AND TWO ENTRIES SHIPPED DEPENDING ON IT ───
//
// ⭐⭐ THE MEASURED DEFECT THIS FILE EXISTS FOR. `closedTable.json` declares, per
// function, an `args` list of NODE kinds (`series` / `int`) and an `argRoles`
// list of NAMES. `_functions_arg_roles` says in as many words that a role is NOT
// a requirement — `atr`'s slot 0 is called `high` because that is what an
// untranslated call means, not because it must be the `high` series — and that is
// right for every role naming a COLUMN. It is wrong for a role naming a KIND.
//
// `barssince(cond, n)` and `valuewhen(cond, src, n)` landed 2026-08-26 declaring
// `argRoles[0] = condition` over an `args[0]` that says only `series`. Nothing
// read the second half, so:
//
//     barssince(close, 100)      -> 0.0 on EVERY bar   (a price is never zero,
//                                                       so "bars since it was
//                                                       last true" is 0 forever)
//     valuewhen(close, high, 5)  -> high on EVERY bar
//
// ⛔ PLAUSIBLE ON EVERY BAR AND WRONG ON EVERY BAR — the failure shape
// `pine.js::PINE_INEXPRESSIBLE` refuses whole families to avoid, reachable from
// the builder, saveable, scannable and alertable.
//
// ⛔ THIS FILE RAILS THE JS LANE ON ITS OWN. `tests/test_ast_arg_roles.py` rails
// the Python twin, and neither is the other's oracle
// (`lesson_rail_the_mirror_not_just_the_lane`: a fix railed in one lane leaves
// its mirror green and unguarded — this branch has already paid for that once,
// on `valueWhen`'s window).
//
// ⛔ AND THE ANSWER IS NOT RE-DERIVED HERE. The guard asks `sentence.js::yieldsOf`
// — this lane's ONE resolver of the manifest's `yields` — because a
// `COMPARISONS.has(node.name)` list is what `_yields` exists to retire, and
// `pine.js::treeYieldsBool` already measured what a second reader costs: it
// agreed with `yieldsOf` the day it was written and said `false` for every
// `clock` entry the moment tableVersion 2 declared five of them `bool`.

import { describe, expect, it, vi } from 'vitest'
import { TABLE } from './parse.js'
import { interpret, REFUSALS, TableRefusal } from './interpret.js'
import { yieldsOf, SENTENCE_RULES } from './sentence.js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const HERE = path.dirname(fileURLToPath(import.meta.url))

/** The guard both lanes refuse with. Pinned to the declaration, never assumed. */
const GUARD = 'resolve:condition'

/** ⛔ NOT A MONOTONE RAMP. On an always-up series `close > open` is true on every
 *  bar and the CORRECT `barssince` is 0 everywhere — identical to what the defect
 *  produces, so the fixture could not tell the fix from the bug. */
const BARS = Array.from({ length: 60 }, (_, i) => {
  const up = i % 7 === 0 || i % 7 === 3
  const o = 100 + i * 0.1
  const c = o + (up ? 0.8 : -0.5)
  return { t: 1780000000 + i * 300, o, h: Math.max(o, c) + 0.4, l: Math.min(o, c) - 0.4, c, v: 1000 + i }
})

const NUM = (v) => ({ type: 'num', value: v })
const SER = (n) => ({ type: 'series', name: n })
const OP = (n, ...a) => ({ type: 'op', name: n, args: a })
const CALL = (n, ...a) => ({ type: 'call', name: n, args: a })

// ⛔ `close > high` IS THE TRAP: a legal condition that is NEVER true, so
// `valuewhen` under it answers nothing and "correct usage still works" passes
// vacuously. `close > open` is the up-bar test a member actually writes.
const A_CONDITION = OP('>', SER('close'), SER('open'))
const PRICE = 'close'
const SOURCE = 'high'
const SOURCE_FIELD = TABLE.series[SOURCE].field

const BOGUS = {
  barssince: CALL('barssince', SER(PRICE), NUM(10)),
  valuewhen: CALL('valuewhen', SER(PRICE), SER(SOURCE), NUM(5)),
}

const col = (tree, run = interpret) => Array.from(run(tree, BARS, {}),
  (v) => (v === null || v === undefined || Number.isNaN(v) ? null : v))

function refusalOf(tree, run = interpret) {
  try { run(tree, BARS, {}); return null } catch (e) { return e }
}

/** Every `[function, slot, role, want]` the manifest makes a REQUIREMENT.
 *  ⛔ DERIVED — a roster typed here stops covering the day a third entry declares
 *  a condition, which is the defect above one level up. */
function enforcedSlots() {
  const wanted = Object.fromEntries(Object.entries(TABLE._functions_arg_role_kinds || {})
    .filter(([role]) => !role.startsWith('_')))
  const out = []
  for (const name of Object.keys(TABLE.functions).sort()) {
    const roles = TABLE.functions[name].argRoles
    if (!Array.isArray(roles)) continue
    roles.forEach((role, i) => { if (role in wanted) out.push([name, i, role, wanted[role]]) })
  }
  return out
}

/** A legal call to `name` with `arg` in `slot` and a plain filler elsewhere. */
function callWith(name, slot, arg) {
  const args = TABLE.functions[name].args.map((k) => (k === 'int' ? NUM(5) : SER(PRICE)))
  args[slot] = arg
  return { type: 'call', name, args }
}

// ═══ 1. the declaration exists, and entries use it ═════════════════════════

describe('the manifest declares which roles are REQUIREMENTS', () => {
  it('…and it is not empty, so nothing below passes vacuously', () => {
    const kinds = Object.entries(TABLE._functions_arg_role_kinds || {})
      .filter(([role]) => !role.startsWith('_'))
    expect(kinds.length,
      'closedTable.json declares no `_functions_arg_role_kinds`; every case in '
      + 'this file derives its subject from that section').toBeGreaterThan(0)
    const slots = enforcedSlots()
    expect(slots.length).toBeGreaterThanOrEqual(2)
    expect(slots.map(([n]) => n)).toEqual(expect.arrayContaining(['barssince', 'valuewhen']))
  })

  it('⚠️ every declared kind is the BOOLEAN one, because the SENTENCE says so', () => {
    // The refusal reads "a condition argument must be a 0/1 column" — plain words
    // naming ONE kind. A role declared `num` would be enforced correctly and
    // refused by a sentence describing the wrong kind, which is a refusal that
    // names the wrong cause. Re-derive the sentence before widening this.
    const odd = Object.entries(TABLE._functions_arg_role_kinds || {})
      .filter(([role, kind]) => !role.startsWith('_') && kind !== 'bool')
    expect(odd, `${GUARD}'s sentence names a 0/1 column in plain words`).toEqual([])
    expect(REFUSALS[GUARD]).toContain('0/1')
  })
})

// ═══ 2. BOTH DIRECTIONS ════════════════════════════════════════════════════

describe('a PRICE where the manifest declares a CONDITION', () => {
  it('is refused BY NAME, naming the function, the position, the role and the fix', () => {
    for (const [fn, tree] of Object.entries(BOGUS)) {
      const err = refusalOf(tree)
      expect(err, `${fn} computed a column instead of refusing`).toBeInstanceOf(TableRefusal)
      expect(err.guard).toBe(GUARD)
      expect(err.message).toContain(REFUSALS[GUARD])
      expect(err.message, 'the refusal must name the function').toContain(fn)
      expect(err.message, 'the refusal must name the argument position').toContain('argument 0')
      expect(err.message, 'the refusal must name the role').toContain('condition')
      // ⛔ AND WHAT WOULD UNBLOCK IT. A refusal that names no cure costs the
      // member the whole derivation again — and a wrong "no" has no red test.
      expect(err.message).toContain('compare it to something')
    }
  })

  it('…while a REAL condition still computes, and the column is not constant', () => {
    const since = col(CALL('barssince', A_CONDITION, NUM(10)))
    const when = col(CALL('valuewhen', A_CONDITION, SER(SOURCE), NUM(5)))
    for (const [label, c] of [['barssince', since], ['valuewhen', when]]) {
      const answered = c.filter((v) => v !== null)
      expect(answered.length, `${label} answered nothing — the guard ate it`).toBeGreaterThan(0)
      expect(new Set(answered).size,
        `${label} answered the SAME value on every bar — that is the DEFECT's own `
        + 'signature, so this fixture cannot tell the fix from the bug').toBeGreaterThan(1)
    }
  })

  it('the fixture can TELL THEM APART — the control for the control', () => {
    const ups = BARS.filter((b) => b.c > b.o).length
    expect(ups).toBeGreaterThan(0)
    expect(ups).toBeLessThan(BARS.length)
    const correct = col(CALL('barssince', A_CONDITION, NUM(10))).filter((v) => v !== null)
    expect(new Set(correct)).not.toEqual(new Set([0]))
  })
})

describe('TOTALITY — every enforced slot, in both directions', () => {
  for (const [name, slot, role, want] of enforcedSlots()) {
    it(`${name} argument ${slot} (${role} -> ${want}) refuses a price and accepts a condition`, () => {
      const err = refusalOf(callWith(name, slot, SER(PRICE)))
      expect(err, `${name}[${slot}] accepted a price`).toBeInstanceOf(TableRefusal)
      expect(err.guard).toBe(GUARD)
      expect(err.message).toContain(role)
      expect(col(callWith(name, slot, A_CONDITION)).some((v) => v !== null)).toBe(true)
    })
  }

  it('an entry with NO enforced role is UNTOUCHED — the blast radius, measured', () => {
    const enforced = new Set(enforcedSlots().map(([n]) => n))
    const free = Object.keys(TABLE.functions).sort().filter((n) => !enforced.has(n)
      && String(TABLE.functions[n].args) === String(['series', 'int']))
    expect(free.length, 'no free (series, int) entry left to prove the guard is scoped')
      .toBeGreaterThan(0)
    for (const name of free) {
      expect(col(CALL(name, SER(PRICE), NUM(5))).some((v) => v !== null), name).toBe(true)
    }
  })
})

// ═══ 3. DELETE THE BRANCH — the resolver's ANSWER is load-bearing ══════════

describe('⛔ delete the branch: the guard is `yieldsOf`, not a hand-list', () => {
  it('with `yieldsOf` forced to say bool, the bogus tree COMPUTES — and here is what it says',
    async () => {
      // ⭐ THIS IS THE DELETE-THE-BRANCH PROOF FOR THE RESOLUTION HALF. Nothing
      // about the guard's shape changes; only the resolver's ANSWER does. If the
      // guard were a private walk over the table, this would change nothing and
      // the case would fail — which is exactly the second-reader defect it is
      // aimed at.
      vi.resetModules()
      vi.doMock('./sentence.js', async () => ({
        ...(await vi.importActual('./sentence.js')),
        yieldsOf: () => 'bool',
      }))
      try {
        const mod = await import('./interpret.js')
        const since = col(BOGUS.barssince, mod.interpret)
        const when = col(BOGUS.valuewhen, mod.interpret)

        expect(new Set(since), 'the recorded defect is 0.0 on EVERY bar').toEqual(new Set([0]))
        expect(when, 'valuewhen over a price hands back its SOURCE on every bar')
          .toEqual(BARS.map((b) => b[SOURCE_FIELD]))

        // ⚠️ AND ASSERT ON THE TRUTHINESS, NOT ONLY ON THE COLUMN. This branch has
        // measured a guard whose deletion left a column byte-identical while
        // flipping the comparison built on it. Here it is the reverse and worse:
        // a plausible run of zeroes whose every SCAN spelling is CONSTANT over
        // the whole universe — nothing matches, or everything does.
        const bogusGt = col(OP('>', BOGUS.barssince, NUM(0)), mod.interpret)
        const bogusEq = col(OP('==', BOGUS.barssince, NUM(0)), mod.interpret)
        expect(new Set(bogusGt)).toEqual(new Set([0]))
        expect(new Set(bogusEq)).toEqual(new Set([1]))

        const goodGt = col(OP('>', CALL('barssince', A_CONDITION, NUM(10)), NUM(0)))
        expect(new Set(goodGt).size,
          'the correct comparison is constant too — this case cannot distinguish')
          .toBeGreaterThan(1)
        const differing = bogusGt.filter((v, i) => v !== goodGt[i]).length
        expect(differing,
          `${differing} of ${BARS.length} bars differ; 0 differing means this `
          + 'fixture cannot see the branch and the rail proves nothing')
          .toBeGreaterThanOrEqual(20)
      } finally {
        vi.doUnmock('./sentence.js')
        vi.resetModules()
      }
    })

  it('…and with `yieldsOf` forced to say num, even a REAL condition is refused', async () => {
    // The other direction of the same probe: the guard reads the resolver's
    // answer rather than the tree's shape, so a resolver that lies in the other
    // direction must refuse what is genuinely correct. A guard that ignored
    // `yieldsOf` would pass this by accident.
    vi.resetModules()
    vi.doMock('./sentence.js', async () => ({
      ...(await vi.importActual('./sentence.js')),
      yieldsOf: () => 'num',
    }))
    try {
      const mod = await import('./interpret.js')
      const err = refusalOf(CALL('barssince', A_CONDITION, NUM(10)), mod.interpret)
      expect(err).toBeInstanceOf(mod.TableRefusal)
      expect(err.guard).toBe(GUARD)
    } finally {
      vi.doUnmock('./sentence.js')
      vi.resetModules()
    }
  })

  it('the shipped `yieldsOf` really does separate these two trees', () => {
    // ⛔ THE CONTROL FOR THE MOCK. If `yieldsOf` answered the same thing for both
    // trees, forcing it would prove nothing about the guard.
    expect(yieldsOf(SER(PRICE), SENTENCE_RULES)).toBe('num')
    expect(yieldsOf(A_CONDITION, SENTENCE_RULES)).toBe('bool')
  })
})

// ═══ 4. the guard is DERIVED, and the source says so ═══════════════════════

describe('the guard reads the manifest and asks the ONE resolver', () => {
  const SOURCE_TEXT = readFileSync(path.join(HERE, 'interpret.js'), 'utf8')

  /** The body of `assertArgRoles`, by brace balance — never a line count. */
  function guardBody(src) {
    const at = src.indexOf('function assertArgRoles')
    expect(at, '`assertArgRoles` is gone from interpret.js').toBeGreaterThan(-1)
    let i = src.indexOf('{', at)
    let depth = 0
    for (let j = i; j < src.length; j++) {
      if (src[j] === '{') depth += 1
      else if (src[j] === '}') { depth -= 1; if (depth === 0) return src.slice(i, j + 1) }
    }
    throw new Error('unbalanced braces in assertArgRoles')
  }

  it('it CALLS `yieldsOf` rather than deciding for itself', () => {
    // The same structural claim `pine.test.js` makes about `treeYieldsBool`, for
    // the same reason: a comment asserting agreement beside code that disagrees
    // is the artifact a later engineer audits against.
    expect(guardBody(SOURCE_TEXT)).toMatch(/yieldsOf\(/)
  })

  it('and it spells NO role name as a literal — the roster is DATA', () => {
    // ⛔ A hard-coded `role === 'condition'` passes every behavioural case above
    // and stops covering the day the manifest declares a second role. The guard
    // must be unable to know the word.
    const roles = Object.keys(TABLE._functions_arg_role_kinds || {}).filter((r) => !r.startsWith('_'))
    expect(roles.length).toBeGreaterThan(0)
    const body = guardBody(SOURCE_TEXT)
    for (const role of roles) {
      expect(body, `assertArgRoles spells the role ${role} as a literal`)
        .not.toMatch(new RegExp(`['"\`]${role}['"\`]`))
    }
  })

  it('the roster it compiles IS the manifest section, minus the notes', () => {
    // The behavioural half of the same claim: what the guard enforces equals what
    // the manifest declares, so a role added there needs no edit in interpret.js.
    const declared = Object.entries(TABLE._functions_arg_role_kinds || {})
      .filter(([role, kind]) => !role.startsWith('_') && typeof kind === 'string')
    expect(enforcedSlots().length,
      'the manifest declares roles that no entry uses — the guard would be inert')
      .toBeGreaterThan(0)
    expect(declared.length).toBeGreaterThan(0)
  })
})

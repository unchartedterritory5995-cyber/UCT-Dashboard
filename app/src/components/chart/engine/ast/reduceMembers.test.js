// app/src/components/chart/engine/ast/reduceMembers.test.js
//
// ─── ⭐⭐ R9 — WHAT `array.*` REDUCES ACTUALLY DO ───────────────────────────
//
// The a5 census found 0 of 209 reduce/search uses admissible and reachable, and the
// first instinct was to retire the family on that number. **Ruling 0.2 forbids it:** a
// threshold governs what is BUILT, never what is REMOVED, and `sum`/`max`/`min`/`avg`
// are already in `REDUCE_MEMBERS` and `HANDLED` (`arrayVectors.js:55`, `:59`). So the
// question was measured instead of assumed — and the measurement found a real defect
// and a false claim.
//
// ⚰️ THE DEFECT. `sum`, `max` and `min` fold, and every one of them produced
// `pine:roundtrip` — *"the translator wrote formula text it could not read back, so it
// emitted none"* — for ANY slot content, literal or series. The cause is the same
// class as BUG 1, a wrong-language object spliced into an output tree:
//
//     vec.slots holds BINDINGS, not finished nodes — the `get` branch four lines
//     above says exactly that and calls `this.resolveBinding(...)`. The reduce branch
//     fed the raw bindings straight into `cOp('+', [...])`.
//
// So a member using `array.sum` got nothing at all, while `HANDLED` claimed it worked.
//
// ⚰️ THE FALSE CLAIM. `avg` is in `REDUCE_MEMBERS` and therefore in `HANDLED`, and the
// fold implements only `sum`/`max`/`min` — so `array.avg` refuses `pine:collection`
// like any unhandled member. The set said four; the code does three.
import { describe, it, expect } from 'vitest'
import { translatePine } from './pine.js'
import { REDUCE_MEMBERS, HANDLED } from './arrayVectors.js'

const HEAD = '//@version=6\nindicator("t", overlay=true)\nplot(close, "real")\n'

// ✅ THE MARKER IS GONE. It was `const run = it.fails`, committed at 158ca0d0a so the
// acceptance was on record before the fix; every case below passed BECAUSE it failed.
// The fix commit deletes it, which is the whole point of writing it that way.
const run = it

/** A settled 3-slot vector, then one read. */
const src = (read) => `${HEAD}var a = array.new<float>(3)\n`
  + 'for i = 0 to 2\n    array.set(a, i, i)\n'
  + `plot(${read}, "r")\n`

const readOf = (text, opts = { strict: true }) => {
  const t = translatePine(src(text), opts)
  const o = (t.outputs || []).find((x) => x.title === 'r')
  return { t, formula: o ? String(o.formula) : null, refusals: (t.refusals || []) }
}

describe('R9 — the kept reduces fold, the rest refuse by name', () => {
  run('⭐⭐ `array.sum` over three literal slots folds to an ordinary expression', () => {
    // Slots are 0, 1, 2 — so the fold is a left-nested `+` chain over them, and the
    // whole point is that it is a tree of kinds already in NODE_TYPES.
    const { formula, refusals } = readOf('array.sum(a)')
    expect(refusals.map((r) => r.guard), 'nothing refuses').toEqual([])
    expect(formula).toBe('0 + 1 + 2')
  })

  run('⭐ `array.max` and `array.min` fold too, through the same slot resolution', () => {
    expect(readOf('array.max(a)').formula).toBe('max(max(0, 1), 2)')
    expect(readOf('array.min(a)').formula).toBe('min(min(0, 1), 2)')
  })

  // ── the members that do NOT fold ─────────────────────────────────────────
  // ⚠️ SYNTHETIC AND LABELLED, of necessity: the a5 census measured every corpus use
  // of these members to be masked by an earlier refusal or unreachable, so no corpus
  // fixture can exercise the call site.
  for (const [member, call, uses, reaching] of [
    ['avg', 'array.avg(a)', 14, 0],
    ['indexof', 'array.indexof(a, 1)', 18, 0],
    ['sort', 'array.sort(a)', 10, 0],
    ['includes', 'array.includes(a, 1)', 5, 0],
    ['stdev', 'array.stdev(a)', 4, 0],
  ]) {
    run(`⛔ SYNTHETIC · \`array.${member}\` refuses by name, carrying its number`, () => {
      const { refusals } = readOf(call)
      // ⛔ REPLACED, NOT JOINED — one cause, one refusal (precedent 1.1).
      expect(refusals.length, 'exactly one refusal').toBe(1)
      const r = refusals[0]
      expect(r.guard).toBe('pine:collection')
      const text = String(r.detail || r.message || '')
      expect(text, 'names the member').toContain(`array.${member}`)
      expect(text, 'carries its census number').toContain(`${uses}`)
      expect(text, 'and the binding constraint the census found')
        .toMatch(/reach (a plot|an output)/i)
      expect(text.toLowerCase()).not.toContain('not supported')
    })
  }

  // ── controls, permanent ──────────────────────────────────────────────────
  it('⛔⛔ CONTROL — `get` and `size` still fold, so a2 is untouched', () => {
    // If R9 broke slot resolution, these move first. They are the shape every reduce
    // depends on, and they were green before R9.
    expect(readOf('array.get(a, 1)').formula).toBe('1')
    expect(readOf('array.size(a)').formula).toBe('3')
  })

  run('⛔⛔ the declared set and the implemented set AGREE', () => {
    // ⚰️ THIS IS THE CHECK THAT WOULD HAVE CAUGHT `avg`. `REDUCE_MEMBERS` named four
    // and the fold implemented three, so `HANDLED` promised a member that refused like
    // an unhandled one — a set claiming more than the code does, which is exactly the
    // "documented but unreachable" defect this repo keeps paying for.
    for (const member of REDUCE_MEMBERS) {
      const { refusals } = readOf(`array.${member}(a)`)
      expect(refusals.map((r) => r.guard),
        `\`array.${member}\` is in REDUCE_MEMBERS, so it must not refuse`).toEqual([])
    }
    // …and every REDUCE member is inside HANDLED, which is what the set is for.
    for (const member of REDUCE_MEMBERS) expect(HANDLED.has(member)).toBe(true)
  })
})

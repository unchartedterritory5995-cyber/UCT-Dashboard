// app/src/components/chart/engine/ast/pine.dayofweek.test.js
//
// ─── ⚰️ THE BARE NAME WORKED AND THE DOTTED ONES DID NOT ─────────────────────
//
//     dayofweek == 6                  ->  translates
//     dayofweek == dayofweek.friday   ->  pine:builtin
//
// and `pine:builtin` says "this Pine built-in names something the engine grammar
// does not hold", which is false of a name whose own series the manifest declares.
// The clock landed 2026-08-26 and the bare lane was swept the day after; the
// dotted lane was not, so a guard's sentence quietly became untrue.
//
// ⭐⭐ THE NUMBERS ARE NOT TYPED INTO THIS FILE, THEY ARE READ OUT OF THE
// MANIFEST. `closedTable.json::clock.dayofweek` states the convention in prose —
// "1 on Sunday through 7 on Saturday" — and this test parses that sentence and
// derives all seven from it. A hand-typed set under a declared convention is
// exactly how `pine.js` has gone stale before, which is the defect above.
//
// ⛔ AND THE DERIVATION CHECKS ITSELF. The sentence names BOTH ends; the second
// is used to confirm the first rather than ignored, so a rewrite that changed the
// numbering to something these constants no longer match fails here.

import { describe, it, expect } from 'vitest'

import { translatePine } from './pine.js'
import { TABLE } from './parse.js'

const WEEK = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

/** The manifest's own sentence, turned into seven numbers. */
function declaredNumbering() {
  const sentence = TABLE.clock.dayofweek.sentence
  const m = sentence.match(/(\d+)\s+on\s+(\w+)\s+through\s+(\d+)\s+on\s+(\w+)/i)
  expect(m, `clock.dayofweek no longer states its numbering: "${sentence}"`).toBeTruthy()
  const [, firstN, firstDay, lastN, lastDay] = m
  const start = WEEK.indexOf(String(firstDay).toLowerCase())
  expect(start, `"${firstDay}" is not a day this table knows`).toBeGreaterThanOrEqual(0)
  const map = {}
  WEEK.forEach((d, i) => { map[d] = Number(firstN) + ((i - start + 7) % 7) })
  // ⛔ THE SELF-CHECK: the sentence names the other end too, and it has to agree.
  expect(map[String(lastDay).toLowerCase()],
    `the sentence says ${firstN} on ${firstDay} AND ${lastN} on ${lastDay}, which do not `
    + 'describe one numbering').toBe(Number(lastN))
  return map
}

const screen = (body) =>
  translatePine(`//@version=6\nindicator("s")\nplot(${body} ? 1 : 0)\n`)
const formulaOf = (out) => {
  expect(out.ok, out.ok ? '' : `${out.refusal.guard}: ${out.refusal.message}`).toBe(true)
  return out.outputs[out.selected].formula
}

describe('dayofweek.<name> resolves to the manifest’s own numbering', () => {
  it('⭐ the manifest still states a numbering this rail can read', () => {
    const map = declaredNumbering()
    expect(Object.keys(map)).toHaveLength(7)
    expect(new Set(Object.values(map)).size, 'two days share a number').toBe(7)
  })

  it('⭐⭐ all seven translate to the number the manifest declares', () => {
    const map = declaredNumbering()
    for (const day of WEEK) {
      expect(formulaOf(screen(`dayofweek == dayofweek.${day}`)),
        `dayofweek.${day}`).toBe(`dayofweek == ${map[day]} ? 1 : 0`)
    }
  })

  it('⛔ an unknown day still refuses — this did not become a blanket', () => {
    // ⭐ NON-VACUITY. Without this, a change that resolved every `dayofweek.*` to
    // some number would pass the case above.
    const out = screen('dayofweek == dayofweek.frogday')
    expect(out.ok).toBe(false)
    expect(out.refusal.guard).toBe('pine:builtin')
  })

  it('⛔ the bare name is untouched', () => {
    expect(formulaOf(screen('dayofweek == 6'))).toBe('dayofweek == 6 ? 1 : 0')
  })

  it('⭐ it composes into the screen someone would actually write', () => {
    const map = declaredNumbering()
    expect(formulaOf(screen(
      'dayofweek != dayofweek.saturday and dayofweek != dayofweek.sunday')))
      .toBe(`dayofweek != ${map.saturday} && dayofweek != ${map.sunday} ? 1 : 0`)
  })
})

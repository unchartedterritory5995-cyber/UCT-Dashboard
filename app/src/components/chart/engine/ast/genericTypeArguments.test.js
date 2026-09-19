// app/src/components/chart/engine/ast/genericTypeArguments.test.js
//
// ─── `array.new<string>()` IS A LINE THIS ENGINE CAN READ ───────────────────
//
// Pine writes a collection's element type in angle brackets. This grammar has no
// type arguments, and every consumer downstream reads `<` and `>` as
// comparisons, so the whole statement came back as `pine:statement` — "this Pine
// line is not a shape the translator reads". That is a refusal about a LINE when
// the truth is a refusal about a CAPABILITY: we do not do collections yet. The
// first tells a member nothing and tells us nothing; the second has a name and a
// place in the census.
//
// ⛔⛔ THE CONTROLS ARE THE POINT OF THIS FILE. `a < b > c` lexes identically
// apart from its head token, so a matcher taking "any ident followed by `<`"
// would silently rewrite a comparison chain — a mistranslation that parses,
// lints, saves and scans. The head list is closed to six names for that reason.
import { describe, it, expect } from 'vitest'
import { lexPine, translatePine } from './pine.js'
import { buildRuntimeIr } from './pineRuntimeFrontend.js'

const H = '//@version=6\nindicator("t", overlay = true)\n'
const shape = (src) => lexPine(H + src + '\n').tokens.map((t) => `${t.kind}:${t.value}`).join(' ')
const headOf = (src, value) => lexPine(H + src + '\n').tokens.find((t) => t.value === value)

describe('generic collection type arguments', () => {
  it('drops the type argument of a constructor and keeps it on the head token', () => {
    expect(shape('a = array.new<float>()')).not.toMatch(/punct:</)
    expect(headOf('a = array.new<float>()', 'array.new').typeArgs).toEqual(['float'])
  })

  it('drops the type argument of a typed declaration', () => {
    expect(shape('array<string> toks = str.split(s, ",")')).not.toMatch(/punct:</)
    expect(headOf('array<string> toks = str.split(s, ",")', 'array').typeArgs).toEqual(['string'])
  })

  it('handles a nested type argument and the `>>` it ends with', () => {
    expect(shape('m = map.new<string, array<float>>()')).not.toMatch(/punct:</)
    expect(headOf('m = map.new<string, array<float>>()', 'map.new').typeArgs)
      .toEqual(['string', 'array<float>'])
  })

  it('CONTROL: leaves a comparison chain completely alone', () => {
    expect(shape('x = a < b > c ? 1 : 0')).toContain('punct:< ident:b punct:>')
  })

  it('CONTROL: leaves a comparison whose head is a dotted builtin alone', () => {
    expect(shape('x = ta.sma(close, 5) < high ? 1 : 0')).toMatch(/punct:</)
  })

  it('CONTROL: an unterminated `<` is left alone rather than eating the line', () => {
    expect(shape('a = array.new<float')).toMatch(/punct:</)
  })

  it('CONTROL: `array.size(a) < 3` is a comparison, not a type argument', () => {
    expect(shape('x = array.size(a) < 3 ? 1 : 0')).toMatch(/punct:</)
  })

  it('the generic LINE is understood; the script is refused by its collection', () => {
    // ⛔ THE ASSERTION IS PER LINE, AND DELIBERATELY SO. Line 3 is the generic
    // declaration this file is about; line 4 is `array.push(a, close)`, a
    // mutator call in STATEMENT position, which is a different gap in a
    // different wave (the collections plan). Asserting over the whole script
    // would either fail for a reason this change does not own, or tempt someone
    // to weaken it until it says nothing.
    const src = H + 'a = array.new<float>()\narray.push(a, close)\nplot(array.get(a, 0))\n'
    const host = translatePine(src, { strict: true })
    expect(host.ok).toBe(false)

    const all = [...(host.refusals || []), ...(host.notes || [])].filter((r) => r && r.message)
    const atLine3 = all.filter((r) => r.line === 3).map((r) => r.message).join(' | ')
    expect(atLine3).not.toMatch(/not a shape the translator reads/)
    expect(atLine3).toMatch(/array|vector|collection/i)

    // And the script as a whole still refuses, by a collection sentence.
    const sentences = all.map((r) => r.message).join(' | ')
    expect(sentences).toMatch(/array|matrix|map|collection/i)

    const rt = buildRuntimeIr(src)
    expect(rt.ok).toBe(false)
    expect(rt.refusal.message).toMatch(/array|collection/i)
  })

  it('records what is still unread on a collection line: a mutator in statement position', () => {
    // ⭐ A MEASUREMENT, NOT A WISH. `array.push(a, close)` on its own line is
    // still `pine:statement` after this change, and both RVOL-slice acceptance
    // scripts use that form inside their loops. Pinning it here means the
    // collections wave inherits a failing-by-name fact instead of rediscovering
    // it, and this test turns into a green one the day that wave lands.
    const src = H + 'a = array.new<float>()\narray.push(a, close)\nplot(array.get(a, 0))\n'
    const host = translatePine(src, { strict: true })
    const atLine4 = [...(host.refusals || []), ...(host.notes || [])]
      .filter((r) => r && r.line === 4).map((r) => r.message).join(' | ')
    expect(atLine4).toMatch(/not a shape the translator reads/)
  })
})

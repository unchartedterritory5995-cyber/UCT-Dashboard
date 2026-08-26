import { describe, it, expect } from 'vitest'
// ⭐ THE ONE PARSER AND THE ONE HASH, imported by the test for the same reason
// the module imports them: a tree built any other way is a second grammar (D-A1),
// and a hash typed here would be comparing this file's copy to itself.
import { parseFormula, astHash, TABLE, KEY_RE, RECURRENCE_BINDINGS } from './parse'
import { prepareSource, LET_GUARDS } from './letPrepass'
import { readFormulaSource, detectDialect } from './pcf'
import { validateDefinition } from '../defSchema'

const LET_MACD = [
  'let fast = ema(close, 12)',
  'let slow = ema(close, 26)',
  'let line = fast - slow;',
  'line - ema(line, 9)',
].join('\n')
const HAND = '(ema(close, 12) - ema(close, 26)) - ema(ema(close, 12) - ema(close, 26), 9)'

describe('let bindings are SUGAR — the tree and the hash are the hand-inlined formula\'s', () => {
  it('the inlined source hashes to the hand-inlined formula', () => {
    const pre = prepareSource(LET_MACD)
    expect(pre.ok, pre.error).toBe(true)
    expect(pre.bindings.map((b) => b.name)).toEqual(['fast', 'slow', 'line'])
    expect(astHash(parseFormula(pre.source).ast)).toBe(astHash(parseFormula(HAND).ast))
  })

  it('a source with no `let` is returned UNTOUCHED — invisible to every formula ever saved', () => {
    expect(prepareSource('sma(close, 20)')).toEqual({ ok: true, source: 'sma(close, 20)', bindings: [] })
  })

  it('substitution is whole-identifier: `fast` never touches `fastest`', () => {
    expect(prepareSource('let fast = 2\nfastest + fast').source).toBe('fastest + (2)')
  })

  it('a later binding may use an earlier one, and the substitution is PARENTHESISED', () => {
    // ⛔ THE PARENTHESES ARE THE WHOLE REASON THIS IS SAFE. `let d = a - b` then
    // `d * 2` must be `(a - b) * 2`, never `a - b * 2` — a precedence bug that
    // computes, and computes something else.
    const pre = prepareSource('let d = high - low\nd * 2')
    expect(pre.ok, pre.error).toBe(true)
    expect(astHash(parseFormula(pre.source).ast)).toBe(astHash(parseFormula('(high - low) * 2').ast))
  })

  it('shadowing a TABLE name refuses let:shadow at the token', () => {
    const r = prepareSource('let close = open\nclose')
    expect(r).toMatchObject({ ok: false, guard: 'let:shadow', line: 1, column: 5, token: 'close' })
  })

  it('shadowing a DECLARED INPUT refuses let:shadow', () => {
    const r = prepareSource('let period = 5\nsma(close, period)', { period: true })
    expect(r).toMatchObject({ ok: false, guard: 'let:shadow', token: 'period' })
    expect(prepareSource('let period = 5\nsma(close, period)').ok).toBe(true)   // no scope handed in ⇒ not a shadow
  })

  it('binding the same name twice refuses let:shadow at the SECOND one', () => {
    const r = prepareSource('let a = 1\nlet a = 2\na')
    expect(r).toMatchObject({ ok: false, guard: 'let:shadow', line: 2, token: 'a' })
  })

  it('use-before-define and self-reference refuse let:undefined', () => {
    expect(prepareSource('let a = b + 1\nlet b = close\na')).toMatchObject({ ok: false, guard: 'let:undefined', line: 1, token: 'b' })
    expect(prepareSource('let a = a + 1\na')).toMatchObject({ ok: false, guard: 'let:undefined', line: 1, token: 'a' })
  })

  it('the refused token\'s COLUMN is the token\'s own column on its line — DERIVED, never counted', () => {
    // ⛔ The obvious implementation (`name column + name.length + 3`) assumes
    // exactly one space either side of `=`. It is right for `let a = b + 1` and
    // wrong for every other spacing, and a lint mark on the wrong character is
    // worse than none — so the position comes off the MATCH, not off arithmetic.
    const spaced = prepareSource('let a = b + 1\nlet b = close\na')
    const tight = prepareSource('let a=b + 1\nlet b = close\na')
    expect('let a = b + 1'.indexOf('b') + 1, 'the fixture itself').toBe(9)
    expect('let a=b + 1'.indexOf('b') + 1, 'the fixture itself').toBe(7)
    expect(spaced.column).toBe(9)
    expect(tight.column).toBe(7)
  })

  it('a `let` after the expression, a `let` with no expression, and a missing final expression refuse let:syntax', () => {
    expect(prepareSource('close\nlet a = 1')).toMatchObject({ ok: false, guard: 'let:syntax', line: 2 })
    expect(prepareSource('let a =\na')).toMatchObject({ ok: false, guard: 'let:syntax', line: 1, token: 'a' })
    expect(prepareSource('let a = 1')).toMatchObject({ ok: false, guard: 'let:syntax' })
  })

  it('a `let` line that is not `let <name> = <expression>` refuses let:syntax', () => {
    expect(prepareSource('let = 1\nclose')).toMatchObject({ ok: false, guard: 'let:syntax', line: 1 })
    expect(prepareSource('let a b = 1\na')).toMatchObject({ ok: false, guard: 'let:syntax', line: 1 })
  })

  it('a binding name is the repo\'s ONE key grammar — a name KEY_RE refuses, this refuses', () => {
    // ⛔ NOT A SECOND GRAMMAR. The shadow check compares a binding name against
    // DECLARED INPUT keys, and those are KEY_RE-shaped; a `let` grammar that
    // admitted `_x` while an input never could would be two answers to "what is
    // a name in a formula" — this repo's most repeated defect.
    for (const bad of ['1a', '_x', 'é']) {
      expect(KEY_RE.test(bad), `the fixture ${bad} must be one KEY_RE refuses`).toBe(false)
      expect(prepareSource(`let ${bad} = 1\n${bad}`), bad)
        .toMatchObject({ ok: false, guard: 'let:syntax', line: 1, token: bad })
    }
    expect(KEY_RE.test('ok_1')).toBe(true)
    expect(prepareSource('let ok_1 = 1\nok_1').ok, 'and a key-shaped name is accepted').toBe(true)
  })

  it('every refusal names a guard from the CLOSED set', () => {
    expect(LET_GUARDS).toEqual(['let:syntax', 'let:shadow', 'let:undefined'])
    for (const src of ['let close = 1\nclose', 'let a = b\nlet b = 1\na', 'close\nlet a = 1']) {
      const r = prepareSource(src)
      expect(r.ok).toBe(false)
      expect(LET_GUARDS).toContain(r.guard)
      expect(r, 'a refusal names its token AND its position').toMatchObject({
        source: null, bindings: [], line: expect.any(Number), column: expect.any(Number), token: expect.any(String),
      })
      expect(r.error.length, 'and says why in words').toBeGreaterThan(20)
    }
  })

  it('NEVER THROWS on a non-string — the empty source is the PARSER\'s refusal to name, not this one\'s', () => {
    for (const junk of [null, undefined, 42, {}, []]) {
      expect(prepareSource(junk)).toEqual({ ok: true, source: '', bindings: [] })
    }
    expect(readFormulaSource(null).result).toMatchObject({ ok: false, guard: 'canonicalise:empty' })
  })
})

describe('⛔ the shadow set is DERIVED from the manifest — a section added tomorrow is covered the day it lands', () => {
  const SECTIONS = Object.keys(TABLE).filter((k) => !k.startsWith('_') && TABLE[k] && typeof TABLE[k] === 'object')

  it('every manifest section with an identifier-shaped name contributes to let:shadow', () => {
    let covered = 0
    for (const section of SECTIONS) {
      const name = Object.keys(TABLE[section]).find((k) => KEY_RE.test(k))
      if (!name) continue        // `operators` has none — a symbol can never be a binding name
      covered += 1
      expect(prepareSource(`let ${name} = 1\n${name}`), `${section}.${name}`)
        .toMatchObject({ ok: false, guard: 'let:shadow', token: name })
    }
    // non-vacuity: the loop must actually have run against several sections
    expect(SECTIONS.length, 'readdir of the manifest found no sections').toBeGreaterThan(3)
    expect(covered, 'no section contributed a name — the loop measured nothing').toBeGreaterThan(2)
  })

  it('…and a RECURRENCE BINDING is reserved too, though it is in NO section', () => {
    // ⭐ THE SAME LINE `interpret.js` ALREADY CARRIES FOR INPUTS, for the same
    // reason: `self` is not in `scope` and not in `functions`, so without it
    // `let self = 5` would textually rewrite every `self` inside an `accum`
    // body to `(5)` — a formula that still computes, and computes the wrong
    // thing. ⚠️ The set is DERIVED from the manifest's `recurrence` entries.
    for (const bound of RECURRENCE_BINDINGS) {
      expect(SECTIONS.some((s) => Object.keys(TABLE[s]).includes(bound)),
        `${bound} is in a section — then the RECURRENCE_BINDINGS term proves nothing`).toBe(false)
      expect(prepareSource(`let ${bound} = 1\n${bound}`), bound)
        .toMatchObject({ ok: false, guard: 'let:shadow', token: bound })
    }
    expect(RECURRENCE_BINDINGS.length, 'the manifest declares no recurrence — this case measured nothing')
      .toBeGreaterThan(0)
  })
})

describe('HB-1 — the ONE read door applies the pre-pass, so `let` reaches the box, the schema and Save', () => {
  it('readFormulaSource parses a `let` source as native', () => {
    const { dialect, result } = readFormulaSource(LET_MACD)
    expect(dialect).toBe('native')
    expect(result.ok, result.error).toBe(true)
    expect(astHash(result.ast)).toBe(astHash(parseFormula(HAND).ast))
  })

  it('⛔ the `let` NATIVE MARKER is load-bearing — without it TC2000 claims the source on its `=`', () => {
    // Strip the `let` and the very same text is DETECTED as pcf, because a bare
    // `=` is a TC2000 marker. That is the whole reason the marker exists: a
    // `let` source handed to the wrong reader is refused for a reason that has
    // nothing to do with what the member typed.
    expect(detectDialect('fast = ema(close, 12)')).toBe('pcf')
    expect(detectDialect(LET_MACD)).toBe('native')
    expect(detectDialect('let fast = 2\nfastest + fast')).toBe('native')
  })

  it('a refusal comes back in parseFormula\'s tagged shape, with the let guard', () => {
    const { result } = readFormulaSource('let close = 1\nclose')
    expect(result).toMatchObject({ ok: false, guard: 'let:shadow' })
    expect(result.error, 'and the door reports the refusing gate\'s own sentence').toMatch(/close/)
  })

  it('a source with no `let` reads BYTE-IDENTICALLY to parseFormula — the door gained nothing to break', () => {
    for (const src of ['sma(close, 20)', 'close > open && volume > 1000', 'ema(close, ']) {
      expect(readFormulaSource(src).result).toEqual(parseFormula(src))
    }
  })

  it('a stored document whose source uses `let` passes rule 2 against the INLINED tree', () => {
    const ast = parseFormula(HAND).ast
    const r = validateDefinition({
      schemaVersion: 1, id: 'u_0123456789ab', version: 1,
      compute: { kind: 'ast', fn: astHash(ast), rev: 1, ast, source: LET_MACD },
      meta: { name: 'Let MACD', tier: 'premium', repaint: 'non-repainting', freshness: 'live' },
      placement: { target: 'pane' },
      plots: [{ key: 'value', style: 'line', color: '#c9a84c' }],
    })
    expect(r.ok, JSON.stringify(r.errors)).toBe(true)
  })
})

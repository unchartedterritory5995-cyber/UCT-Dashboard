import { describe, it, expect } from 'vitest'
// ⭐ THE ONE PARSER AND THE ONE HASH, imported by the test for the same reason
// the module imports them: a tree built any other way is a second grammar (D-A1),
// and a hash typed here would be comparing this file's copy to itself.
import { parseFormula, astHash, TABLE, KEY_RE, RECURRENCE_BINDINGS } from './parse.js'
import { prepareSource, LET_GUARDS } from './letPrepass.js'
import { readFormulaSource, detectDialect } from './pcf.js'
import { validateDefinition } from '../defSchema.js'

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
    expect(prepareSource('sma(close, 20)'))
      .toEqual({ ok: true, source: 'sma(close, 20)', bindings: [], lineOffset: 0 })
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
      expect(prepareSource(junk)).toEqual({ ok: true, source: '', bindings: [], lineOffset: 0 })
    }
    expect(readFormulaSource(null).result).toMatchObject({ ok: false, guard: 'canonicalise:empty' })
  })

  it('⛔ an EXCLUDED name is still a legal binding — the `_` prefix test is not tidiness', () => {
    // `_functions_excluded` and `_scalars_excluded` are OBJECTS, not prose.
    // Without the prefix test their ~107 keys would be reserved, and a member
    // would be refused `let:shadow` for naming a binding after something this
    // engine cannot compute at all — the exact opposite of the gate's purpose.
    const live = new Set(Object.keys(TABLE)
      .filter((k) => !k.startsWith('_') && TABLE[k] && typeof TABLE[k] === 'object')
      .flatMap((k) => Object.keys(TABLE[k])))
    // ⛔ DERIVED, and it must be a name the live sections do NOT also declare —
    // W2a is promoting excluded names into `functions` as it lands the clock
    // section, so a typed fixture here would rot into a vacuous pass.
    const excluded = ['_functions_excluded', '_scalars_excluded']
      .flatMap((k) => Object.keys(TABLE[k] || {}))
      .filter((n) => KEY_RE.test(n) && !live.has(n))
    expect(excluded.length, 'no excluded name is available — this case measured nothing')
      .toBeGreaterThan(10)
    for (const name of excluded.slice(0, 6)) {
      expect(prepareSource(`let ${name} = 1\n${name}`).ok, `${name} is excluded, so it is free`).toBe(true)
    }
  })
})

describe('⛔⛔ THE ONE REAL COST — a parser offset stops indexing the member\'s text', () => {
  const TYPO = 'let fast = ema(close, 12)\nlet slow = ema(close, 26)\nfast - slow('

  it('the reported character indexes the INLINED string, and corresponds to nothing typed', () => {
    const authored = TYPO.lastIndexOf('(')            // the `(` the member actually mistyped
    expect(authored, 'the fixture itself').toBe(63)   // 0-based ⇒ "character 64"
    const { result } = readFormulaSource(TYPO)
    expect(result).toMatchObject({ ok: false, guard: 'parser' })
    const reported = Number(/character (\d+)/.exec(result.error)[1])
    // ⚠️ PINNED AS A KNOWN FACT, NOT ASSERTED AS CORRECT. It is inherent:
    // substitution changes the length of the text before the error, so no
    // offset survives it. The fix is `lineOffset` below, plus the header's
    // instruction that a caller must not place a mark from a raw offset.
    //
    // ⛔ `+ 1` BECAUSE THE TWO NUMBERS ARE COUNTED FROM DIFFERENT PLACES, and
    // without it this case could not fail for the reason it exists. The parser
    // reports 1-BASED ("character 36"); `lastIndexOf` is 0-BASED (63). Comparing
    // them raw asserted `36 !== 63`, which is true of any two unequal numbers —
    // and would have stayed true if the offset were ever CORRECTED to 64, so the
    // case would have gone on passing while its own name says the offset no
    // longer points at the typo. The correct-offset value is what it must differ
    // from, and that value is `authored + 1`.
    // …and the 1-based claim is MEASURED, not assumed: the same typo in a source
    // with no `let` line at all reports `its own 0-based index + 1`. Without this
    // control the `+ 1` above would be a hand-typed convention, which is exactly
    // the kind of number that goes stale beside the code that owns it.
    const plain = 'close - sma('
    const plainReported = Number(/character (\d+)/.exec(readFormulaSource(plain).result.error)[1])
    expect(plainReported, 'the parser is not 1-based — re-derive the +1 above')
      .toBe(plain.lastIndexOf('(') + 1)
    expect(reported, 'the offset no longer points at the typo').not.toBe(authored + 1)
    expect(reported, 'it indexes the inlined text').toBeLessThanOrEqual(prepareSource(TYPO).source.length)
  })

  it('⭐ the LINE is exactly recoverable: authorLine = inlinedLine + lineOffset', () => {
    expect(prepareSource(TYPO).lineOffset, 'two `let` lines came off the top').toBe(2)
    // inlined line 1 is the member's line 3 — the line the typo is on
    expect(prepareSource(TYPO).source.split('\n').length).toBe(1)
    expect(TYPO.split('\n')[1 + 2 - 1]).toBe('fast - slow(')
  })

  it('⛔ a BLANK LINE INSIDE the expression is KEPT, or the mapping is a lie', () => {
    const pre = prepareSource('let a = 2\na +\n\n1')
    expect(pre.source, 'the gap survives').toBe('(2) +\n\n1')
    expect(pre.lineOffset).toBe(1)
    const authorLines = 'let a = 2\na +\n\n1'.split('\n')
    // every inlined line maps back onto the member's own line, all the way down
    pre.source.split('\n').forEach((_, idx) => {
      expect(authorLines[idx + pre.lineOffset], `inlined line ${idx + 1}`).toBeDefined()
    })
    expect(authorLines[0 + pre.lineOffset]).toBe('a +')
    expect(authorLines[2 + pre.lineOffset]).toBe('1')
  })

  it('blank lines ABOVE the expression cost nothing — the offset already counts them', () => {
    const pre = prepareSource('\n\nlet a = 2\n\na + 1')
    expect(pre.ok, pre.error).toBe(true)
    expect(pre.source).toBe('(2) + 1')
    expect(pre.lineOffset, 'the expression is the member\'s line 5').toBe(4)
    expect('\n\nlet a = 2\n\na + 1'.split('\n')[pre.lineOffset]).toBe('a + 1')
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

  it('the EXPLICIT-dialect path pre-passes too — `FormulaField` names its dialect and must not skip the gate', () => {
    // `FormulaField.jsx` calls `readFormulaSource(source, dialect)`. That path
    // bypasses `detectDialect` entirely, so it would bypass the pre-pass with it
    // if the hook lived in the detector instead of in the READER.
    const { dialect, result } = readFormulaSource(LET_MACD, 'native')
    expect(dialect).toBe('native')
    expect(result.ok, result.error).toBe(true)
    expect(astHash(result.ast)).toBe(astHash(parseFormula(HAND).ast))
    expect(readFormulaSource('let close = 1\nclose', 'native').result)
      .toMatchObject({ ok: false, guard: 'let:shadow' })
  })

  it('⛔⛔ NO SCOPE AT THE DOOR ⇒ a declared input can be SHADOWED INTO INERTNESS, and the schema accepts it', () => {
    // The cost of `readFormulaSource` passing no input scope, stated as a fact
    // rather than a worry: this document SAVES, and its `period` knob does
    // nothing, because the pre-pass rewrote every `period` to `(5)`.
    // ⛔ W1b.5's save gate is what must hand `declaredInputs(def)` in.
    const src = 'let period = 5\nsma(close, period)'
    expect(prepareSource(src, { period: true }).ok, 'WITH the scope it refuses').toBe(false)
    const { result } = readFormulaSource(src)
    expect(result.ok, 'but the door has no scope, so it parses').toBe(true)
    const ast = result.ast
    const r = validateDefinition({
      schemaVersion: 1, id: 'u_0123456789ab', version: 1,
      compute: { kind: 'ast', fn: astHash(ast), rev: 1, ast, source: src },
      meta: { name: 'Inert knob', tier: 'premium', repaint: 'non-repainting', freshness: 'live' },
      placement: { target: 'pane' },
      inputs: [{ key: 'period', type: 'int', label: 'Length', default: 20, min: 2, max: 200 }],
      plots: [{ key: 'value', style: 'line', color: '#c9a84c' }],
    })
    expect(r.ok, 'TODAY the schema accepts it — the gate lives at the save door, not here').toBe(true)
    expect(astHash(ast), 'and the stored tree has no `period` in it at all')
      .toBe(astHash(parseFormula('sma(close, (5))').ast))
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

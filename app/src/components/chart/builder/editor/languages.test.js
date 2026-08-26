// ⛔ THE FORMULA VOCABULARY IS THE TABLE. Every function the manifest declares
// colours as a function, a planted name colours as unknown, and the sizes are
// pinned in BOTH directions so a hand list can never stand in for the manifest.
// Tokenization is measured WITHOUT a view (`parser.parse` + `highlightTree`),
// so these cases cannot pass on a styling accident.
import { describe, it, expect } from 'vitest'
import { highlightTree } from '@lezer/highlight'
import { TABLE } from '../../engine/ast/parse'
import { PINE_CALL_SHAPES } from '../../engine/ast/pine'
import { PCF_CALLS, PCF_FUSED, PCF_DIFFERENT_FORMULA, priceLetters } from '../../engine/ast/pcf'
import { DIALECTS, FORMULA_VOCAB, languageFor, highlightStyle, formulaLanguage, vocabularyOf } from './languages'

const CLASSES = Object.freeze({
  fn: 'fn', series: 'series', scalar: 'scalar', input: 'input', let: 'let', literal: 'literal',
  unknown: 'unknown', keyword: 'keyword', namespace: 'namespace', string: 'string', comment: 'comment',
  operator: 'operator', punctuation: 'punctuation', number: 'number', name: 'name',
})
const style = highlightStyle(CLASSES)

function spans(language, text, withStyle = style) {
  const tree = language.parser.parse(text)
  const out = []
  highlightTree(tree, withStyle, (from, to, cls) => out.push([text.slice(from, to), cls]))
  return out
}
const classOf = (language, text, token) => (spans(language, text).find(([t]) => t === token) || [])[1]

describe('the formula dialect', () => {
  const lang = languageFor('formula')

  it('EVERY table function colours as a function — the manifest is the list', () => {
    for (const name of Object.keys(TABLE.functions)) {
      expect(classOf(lang, `${name}(close, 3)`, name), name).toBe('fn')
    }
  })

  it('⛔ a planted name no table version will carry does not', () => {
    expect(TABLE.functions.nosuchfn).toBeUndefined()
    expect(classOf(lang, 'nosuchfn(close, 3)', 'nosuchfn')).toBe('unknown')
  })

  it('series, scalars, literals, operators, brackets and numbers each wear their own class', () => {
    // ⛔ The scalar is DERIVED, never typed: W2a re-partitions this section, and a
    // hand-typed name would keep asserting about a column the manifest had moved
    // to `_scalars_excluded`. Take the first name the table declares that nothing
    // else in it shadows.
    const scalar = Object.keys(TABLE.scalars).find((n) => !TABLE.functions[n] && !TABLE.series[n])
    expect(scalar, 'the manifest declares no unshadowed scalar').toBeTypeOf('string')
    const src = `close > sma(close, 20) && ${scalar} > 1e9 ? true : false`
    expect(classOf(lang, src, 'close')).toBe('series')
    expect(classOf(lang, src, scalar)).toBe('scalar')
    expect(classOf(lang, src, 'true')).toBe('literal')
    expect(classOf(lang, src, '&&')).toBe('operator')
    expect(classOf(lang, src, '?')).toBe('operator')
    expect(classOf(lang, src, '(')).toBe('punctuation')
    expect(classOf(lang, src, '1e9')).toBe('number')
    expect(classOf(lang, 'close[1]', '[')).toBe('punctuation')
  })

  it('a declared input is an input; the same word undeclared is unknown', () => {
    expect(classOf(languageFor('formula', { period: true }), 'close * period', 'period')).toBe('input')
    expect(classOf(languageFor('formula'), 'close * period', 'period')).toBe('unknown')
  })

  it('a `let` name is a binding where it is declared and where it is used', () => {
    const src = 'let fast = sma(close, 10)\nfast > close'
    const all = spans(lang, src)
    expect(all.filter(([t, c]) => t === 'fast' && c === 'let')).toHaveLength(2)
    expect(classOf(lang, src, 'let')).toBe('keyword')
  })

  it('⛔ the binding `=` is SYNTAX, not the error colour a planted name gets', () => {
    // The manifest declares no `=`, and this file derives its symbol list from
    // that section alone — so the `=` on every correct binding line fell through
    // to `tags.invalid`, the same class `nosuchfn` wears.
    expect(TABLE.operators['=']).toBeUndefined()
    expect(classOf(lang, 'let fast = sma(close, 10)', '=')).toBe('operator')
    // `==` IS declared, and must still lex as the table's own operator
    expect(classOf(lang, 'close == 5', '==')).toBe('operator')
    expect(classOf(lang, 'let fast = close == 5', '==')).toBe('operator')
    // CONTROL: outside the binding form a lone `=` is not syntax this dialect has,
    // so the branch cannot be a blanket "colour every `=`".
    expect(classOf(lang, 'close = 5', '=')).toBe('unknown')
  })

  it('⛔ the vocabulary sizes ARE the table sizes, both directions', () => {
    expect(FORMULA_VOCAB.functions.size).toBe(Object.keys(TABLE.functions).length)
    expect(FORMULA_VOCAB.series.size).toBe(Object.keys(TABLE.series).length)
    expect(FORMULA_VOCAB.scalars.size).toBe(Object.keys(TABLE.scalars).length)
    expect(FORMULA_VOCAB.operators.size).toBe(Object.keys(TABLE.operators).length)
    expect([...FORMULA_VOCAB.literals].sort()).toEqual(['false', 'true'])
  })
})

describe('the foreign dialects', () => {
  it('pine: every call pine.js maps to our table is a function; a keyword is a keyword; a member variable is a name', () => {
    const lang = languageFor('pine')
    for (const name of Object.keys(PINE_CALL_SHAPES)) {
      expect(classOf(lang, `x = ta.${name}(close, 14)`, name), name).toBe('fn')
    }
    const src = '//@version=5\nindicator("t")\nfast = ta.sma(close, 9)\nplot(fast > close ? 1 : 0)'
    expect(classOf(lang, src, 'indicator')).toBe('keyword')
    expect(classOf(lang, src, 'ta')).toBe('namespace')
    expect(classOf(lang, src, 'close')).toBe('series')
    expect(classOf(lang, src, 'fast')).toBe('name')
    expect(classOf(lang, src, '//@version=5')).toBe('comment')
    expect(classOf(lang, src, '"t"')).toBe('string')
  })

  it('pcf: price letters come from the table, a Worden call is a function, a stranger is unknown', () => {
    const lang = languageFor('pcf')
    for (const letter of priceLetters(TABLE).keys()) {
      expect(classOf(lang, `${letter} > ${letter}1`, letter), letter).toBe('series')
    }
    // ⛔ EACH MAP IS DRIVEN THROUGH THE SHAPE THAT MAP DESCRIBES. `PCF_FUSED` is
    // the fused spelling — a price letter only when the family declares `field`,
    // exactly the branch `pcf.js` readFused takes. `PCF_CALLS` is the PAREN call.
    // Driving PCF_CALLS through the fused shape (as this loop first did) asserted
    // that `SQRC50`, `ABSC50` and `GREATESTC50` are functions — none of them valid
    // TC2000 — and passed only because the old rule was an unanchored prefix test.
    for (const [name, family] of Object.entries(PCF_FUSED)) {
      const token = family.field ? `${name}C50` : `${name}50`
      expect(classOf(lang, `${token} > 0`, token), token).toBe('fn')
    }
    for (const call of Object.keys(PCF_CALLS)) {
      expect(classOf(lang, `${call}(C, 50) > 0`, call), call).toBe('fn')
    }
    expect(classOf(lang, 'C > AVGC50 AND XYZZY', 'AND')).toBe('keyword')
    expect(classOf(lang, 'C > AVGC50 AND XYZZY', 'XYZZY')).toBe('unknown')
  })

  it('⛔ pcf: a NEAR-MISS is not a function — the colour agrees with pcf.js name for name', () => {
    const lang = languageFor('pcf')
    // Each of these shares a leading run with a real spelling and is refused by
    // `pcf.js` (`pcf:name`). Under an unanchored prefix rule every one coloured `fn`.
    for (const near of ['SUMMER', 'SQRC50', 'DIPLUSX', 'MSFT', 'ABSOLUTE']) {
      expect(classOf(lang, `${near} > 0`, near), near).toBe('unknown')
    }
    // ⛔ A LOOK-ALIKE pcf.js REFUSES BY NAME must not wear the function colour
    // either — `RSI14` gets its own sentence ("TC2000's RSI is not Wilder's…"),
    // and colouring it `fn` would promise a translation that cannot happen.
    for (const name of Object.keys(PCF_DIFFERENT_FORMULA)) {
      expect(classOf(lang, `${name}14 > 0`, `${name}14`), name).toBe('unknown')
    }
    // A CALL name with neither its parenthesis nor fused params is not a call —
    // `AVG` alone reaches pcf.js's refusal exactly as `AVGC50`/`AVG(` do not.
    expect(classOf(lang, 'AVG > 0', 'AVG')).toBe('unknown')
    // CONTROL: the real spellings still colour, so the refusals above are not a
    // tokenizer that has simply stopped recognising anything.
    expect(classOf(lang, 'AVGC50 > 0', 'AVGC50')).toBe('fn')
    expect(classOf(lang, 'SUM(C, 50) > 0', 'SUM')).toBe('fn')
    expect(classOf(lang, 'WRSI14 > 0', 'WRSI14')).toBe('fn')
    // and the dotted tail is parameters, not part of the name
    expect(classOf(lang, 'AVGC50.2 > 0', 'AVGC50.2')).toBe('fn')
  })

  it('thinkscript: keywords, a call shape, a comment — and NO claim on our table until W3 lands its map', () => {
    const lang = languageFor('thinkscript')
    const src = '# rsi\ndef r = RSI(length = 14);\nplot signal = r < 30;'
    expect(classOf(lang, src, 'def')).toBe('keyword')
    expect(classOf(lang, src, 'plot')).toBe('keyword')
    expect(classOf(lang, src, 'RSI')).toBe('fn')
    expect(classOf(lang, src, '# rsi')).toBe('comment')
  })

  it('the dialect list is closed and an unknown dialect falls back to the formula tokenizer', () => {
    expect([...DIALECTS]).toEqual(['formula', 'pine', 'thinkscript', 'pcf'])
    expect(classOf(languageFor('klingon'), 'sma(close, 3)', 'sma')).toBe('fn')
  })
})

describe('derivation and stability', () => {
  it('⭐ a section the manifest gains later (`clock`, closed-table v2) colours the day it lands — read by name, never typed', () => {
    // Today's manifest carries no `clock`, so the vocabulary reads an empty set
    // — pinned both directions against the artifact, whatever it holds.
    expect(FORMULA_VOCAB.clock.size).toBe(Object.keys(TABLE.clock || {}).length)
    // CONTROL: the same word, the same tokenizer, with and without the section.
    // A planted section is the perturbation; without it the word stays unknown.
    const planted = vocabularyOf({ ...TABLE, clock: { barindex: { doc: 'planted' } } })
    expect(classOf(formulaLanguage(undefined, planted), 'barindex > 10', 'barindex')).toBe('series')
    expect(classOf(formulaLanguage(undefined, vocabularyOf({ ...TABLE })), 'barindex > 10', 'barindex')).toBe('unknown')
  })

  it('the same declared inputs hand back the SAME formula language (a define per keystroke leaks a node type each)', () => {
    expect(languageFor('formula')).toBe(languageFor('formula'))
    expect(languageFor('formula', { period: true })).toBe(languageFor('formula', { period: true }))
    expect(languageFor('formula', { period: true })).not.toBe(languageFor('formula'))
  })

  it('a class map missing a key styles nothing for that token instead of taking the box down', () => {
    const partial = highlightStyle({ fn: 'fn' })
    const out = spans(languageFor('formula'), 'sma(close, 3)', partial)
    expect(out).toEqual([['sma', 'fn']])
    expect(() => highlightStyle(undefined)).not.toThrow()
  })
})

// ⛔ THE FORMULA VOCABULARY IS THE TABLE. Every function the manifest declares
// colours as a function, a planted name colours as unknown, and the sizes are
// pinned in BOTH directions so a hand list can never stand in for the manifest.
// Tokenization is measured WITHOUT a view (`parser.parse` + `highlightTree`),
// so these cases cannot pass on a styling accident.
import { describe, it, expect } from 'vitest'
import { highlightTree } from '@lezer/highlight'
import { TABLE } from '../../engine/ast/parse'
import { PINE_CALL_SHAPES } from '../../engine/ast/pine'
import {
  PCF_CALLS, PCF_FUSED, PCF_DIFFERENT_FORMULA, PCF_VOCABULARY, priceLetters, parsePcf,
} from '../../engine/ast/pcf'
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
    // `columns` is series-kind read by SHAPE, so it holds `series` ∪ `clock` today
    // and absorbs a section shaped like them tomorrow.
    expect([...FORMULA_VOCAB.columns].sort())
      .toEqual([...new Set([...FORMULA_VOCAB.series, ...FORMULA_VOCAB.clock])].sort())
  })

  it('⭐ a name-bearing section the manifest gains is COLOURED by shape — not by a list of section names', () => {
    // ⛔ THE DEFECT THIS CLOSES: `vocabularyOf` read five section names as literals
    // while `completions.js` walked every section, so a sixth would have been
    // OFFERED in the popup and painted `tags.invalid` in the same editor.
    const planted = vocabularyOf({
      ...TABLE,
      omens: {
        nosuchomen: { lookback: 0, yields: 'num', sentence: 'a planted series-kind read' },
        nosuchcall: { args: ['series', 'int'], argRoles: ['source', 'period'], lookback: 'arg1', sentence: 'a planted call' },
        nosuchfund: { cadence: 'nightly', yields: 'num', sentence: 'a planted fundamental' },
      },
    })
    const lang = formulaLanguage(undefined, planted)
    expect(classOf(lang, 'nosuchomen > 10', 'nosuchomen')).toBe('series')
    expect(classOf(lang, 'nosuchcall(close, 3)', 'nosuchcall')).toBe('fn')
    expect(classOf(lang, 'nosuchfund > 10', 'nosuchfund')).toBe('scalar')
    // ⛔ `args` DECIDES BEFORE `cadence` — closed-table v2 gives every function a
    // cadence, and the other order turns all fifty calls into scalars in silence.
    const v2 = vocabularyOf({
      ...TABLE,
      functions: { ...TABLE.functions, sma: { ...TABLE.functions.sma, cadence: 'nightly' } },
    })
    expect(classOf(formulaLanguage(undefined, v2), 'sma(close, 3)', 'sma')).toBe('fn')
    // CONTROL: without the perturbation the same three names are strangers.
    const bare = formulaLanguage(undefined, vocabularyOf({ ...TABLE }))
    for (const name of ['nosuchomen', 'nosuchcall', 'nosuchfund']) {
      expect(classOf(bare, `${name} > 10`, name), name).toBe('unknown')
    }
    // …and a section keyed by SYMBOLS is still not a vocabulary of names.
    for (const op of Object.keys(TABLE.operators)) {
      expect(FORMULA_VOCAB.columns.has(op), op).toBe(false)
      expect(FORMULA_VOCAB.functions.has(op), op).toBe(false)
    }
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

  it('⛔ pcf: whitespace before the parenthesis is STILL a call — pcf.js decides on the next TOKEN', () => {
    const lang = languageFor('pcf')
    // `pcf.js` `tokenize` eats spaces before it emits a token, and `atom` asks
    // whether the NEXT TOKEN is `(` — so `AVG (C, 50)` is the same call as
    // `AVG(C, 50)`. A single-character peek called the first one `tags.invalid`,
    // which tells a member their WORKING formula is broken.
    for (const call of Object.keys(PCF_CALLS)) {
      expect(classOf(lang, `${call} (C, 50) > 0`, call), call).toBe('fn')
    }
    expect(parsePcf('AVG (C, 50) > C').ok, 'the engine refuses spaced calls — fix the case').toBe(true)
    // CONTROL, both halves: with no parenthesis ahead the same word is NOT a call,
    // and `pcf.js` refuses it, so the colour is agreeing rather than blanket-passing.
    expect(classOf(lang, 'AVG > 0', 'AVG')).toBe('unknown')
    expect(parsePcf('AVG > 0').ok).toBe(false)
  })

  it('⛔ pcf: a fused family asks for a price letter THIS TABLE declares — shape alone is not the test', () => {
    const lang = languageFor('pcf')
    const letters = priceLetters(TABLE)
    const stranger = 'ZQXJKW'.split('').find((l) => !letters.has(l))
    expect(stranger, 'every letter this case could plant is a declared price letter').toBeTypeOf('string')
    const declared = [...letters.keys()][0]
    let families = 0
    for (const [name, family] of Object.entries(PCF_FUSED)) {
      if (!family.field) continue
      families += 1
      // `AVGZ50` matches `^AVG([A-Z])(\d*)$` and is REFUSED BY NAME at that token
      // (`pcf.js` readFused: "this table declares O, H, L, C, V").
      const bad = `${name}${stranger}50`
      const refusal = parsePcf(`${bad} > 0`)
      expect(refusal.ok, bad).toBe(false)
      expect(refusal.token, bad).toBe(bad)
      expect(classOf(lang, `${bad} > 0`, bad), bad).toBe('unknown')
      // CONTROL: the same family with a DECLARED letter reads AND colours.
      const good = `${name}${declared}50`
      expect(parsePcf(`${good} > 0`).ok, good).toBe(true)
      expect(classOf(lang, `${good} > 0`, good), good).toBe('fn')
    }
    expect(families, 'no PCF family declares a price letter — this case measured nothing').toBeGreaterThan(0)
  })

  it('⛔⛔ pcf: a formula the ENGINE READS carries no error colour, and a name it refuses BY NAME wears one', () => {
    const lang = languageFor('pcf')
    // ⭐ THE VERDICT COMES FROM `pcf.js`, NOT FROM THIS FILE. Every source below is
    // run through `parsePcf` first; the colour is asserted against what the reader
    // actually said. Half of these were `tags.invalid` because `PCF_STATEFUL`,
    // `PCF_SCALARS`, `IIF` and `MOD` were module-private — legal TC2000 spellings
    // the tokenizer could not see.
    const reads = [
      'AVG (C, 50) > C', 'AVGC50 > C', 'XAVG(C, 10) > C', 'C(3) > O', 'AVGC50.2 > 0',
      'CountTrue(C > O, 10) > 3', 'SinceTrue(C > O, 10) > 3', 'TrueInRow(C > O, 10) > 3',
      'Capitalization > 250', 'MarketCap > 250',
      'IIF(C > O, 1, 0) > 0', 'V MOD 100 > 0',
      'C > O AND V > 100', 'C > O OR V > 100', 'C > O XOR V > 100',
      'C > O NAND V > 100', 'C > O NOR V > 100', 'C > O XNOR V > 100',
      'NOT (C > O)', 'C ^ 2 > 100', 'C <> O',
    ]
    for (const src of reads) {
      expect(parsePcf(src).ok, `the engine refuses \`${src}\` — fix the case, not the tokenizer`).toBe(true)
      expect(spans(lang, src).filter(([, cls]) => cls === 'unknown'), src).toEqual([])
    }
    // …and the other direction, driven by the refusal's OWN token.
    const refused = [
      'AVGZ50 > C', 'AVGC50(C, 5) > 0', 'NOSUCHFN(C, 5) > 1', 'SUMMER > 0', 'RSI14 > 0',
      // ⛔ `TRUE`/`FALSE` were hand-typed into this tokenizer's keyword set and PCF
      // has no such literals — the hand copy was wrong in BOTH directions at once.
      'TRUE', 'FALSE',
    ]
    // ⚠️ THE GUARD IS THE SHAPE OF THE COLLECTED VERDICTS, NOT A COUNTER. A tally
    // incremented inside the loop can only fail after an assertion above it has
    // already failed — it reads as a non-vacuity guard while proving nothing.
    // Collecting first and asserting on the collection is the real thing.
    const verdicts = refused.map((src) => ({ src, r: parsePcf(src) }))
    expect(verdicts.map(({ src, r }) => `${src} → ${r.ok ? 'ok' : r.guard}`))
      .toEqual(refused.map((src) => `${src} → pcf:name`))
    for (const { src, r } of verdicts) {
      expect(classOf(lang, src, r.token), `${src} → ${r.token}`).toBe('unknown')
    }
  })

  it('⛔ pcf: the tokenizer\'s vocabulary IS pcf.js\'s — every word it accepts is read off the module', () => {
    const lang = languageFor('pcf')
    for (const call of PCF_VOCABULARY.calls) {
      expect(classOf(lang, `${call}(C, 50, 1) > 0`, call), call).toBe('fn')
    }
    for (const bare of PCF_VOCABULARY.bare) {
      expect(classOf(lang, `${bare} > 250`, bare), bare).toBe('scalar')
    }
    for (const word of PCF_VOCABULARY.words) {
      expect(classOf(lang, `C > O ${word} V > 1`, word), word).toBe('keyword')
    }
    for (const sym of PCF_VOCABULARY.symbols) {
      expect(classOf(lang, `C ${sym} O`, sym), sym).toBe('operator')
    }
    // ⛔ SIZES PINNED SO A HAND SET CAN NEVER STAND IN FOR THE MODULE. `IIF` is in
    // no map — it is a branch of `buildCall` — so `calls` is strictly larger than
    // the two maps it unions, and `words` carries the four DERIVED_LOGIC spellings
    // (`XOR`/`NAND`/`NOR`/`XNOR`) the old hand list was missing three of.
    expect(PCF_VOCABULARY.calls.length).toBeGreaterThan(Object.keys(PCF_CALLS).length)
    expect(new Set(PCF_VOCABULARY.calls).size).toBe(PCF_VOCABULARY.calls.length)
    for (const call of Object.keys(PCF_CALLS)) expect(PCF_VOCABULARY.calls).toContain(call)
    for (const word of ['AND', 'OR', 'NOT', 'XOR', 'NAND', 'NOR', 'XNOR', 'MOD']) {
      expect(PCF_VOCABULARY.words, word).toContain(word)
    }
    expect(PCF_VOCABULARY.words).not.toContain('TRUE')
    // longest first, or `>=` is split by `>`
    const lengths = PCF_VOCABULARY.symbols.map((s) => s.length)
    expect(lengths).toEqual([...lengths].sort((a, b) => b - a))
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
    // Whatever the manifest holds today — pinned both directions against the artifact.
    expect(FORMULA_VOCAB.clock.size).toBe(Object.keys(TABLE.clock || {}).length)
    // ⛔ THE PLANTED NAME IS ONE NO TABLE VERSION WILL CARRY. This case planted
    // `barindex`, which was safe until it wasn't: W2a landed the real `clock`
    // section, and the control arm — "the same word, WITHOUT the section, stays
    // unknown" — started asserting that a name the manifest now declares is not
    // one. The claim under test is that the section is read BY NAME, so the
    // perturbation must be a name only the perturbation can supply.
    const planted = vocabularyOf({ ...TABLE, clock: { ...(TABLE.clock || {}), nosuchclock: { doc: 'planted' } } })
    expect(classOf(formulaLanguage(undefined, planted), 'nosuchclock > 10', 'nosuchclock')).toBe('series')
    const without = vocabularyOf({ ...TABLE, clock: {} })
    expect(classOf(formulaLanguage(undefined, without), 'nosuchclock > 10', 'nosuchclock')).toBe('unknown')
    // …and the promise DELIVERED: every name the real section carries colours,
    // with not one line of the tokenizer having changed to admit it.
    for (const name of Object.keys(TABLE.clock || {})) {
      expect(classOf(languageFor('formula'), `${name} > 10`, name), name).toBe('series')
    }
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

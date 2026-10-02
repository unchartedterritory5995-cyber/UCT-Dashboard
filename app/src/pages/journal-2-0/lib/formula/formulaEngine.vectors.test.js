// @vitest-environment node
/**
 * Wave 11 (lane 11B): the CLIENT formula engine against the SHARED vectors.
 *
 * `formulaVectors.json` is read by this file and by the server's
 * tests/test_formula_engine.py — one set of hand-written answers, two engines.
 * A case that passes here and fails there (or the reverse) is a disagreement
 * between the editor's live preview and the server that sorts the table.
 */
import { describe, it, expect } from 'vitest'
import vectors from './formulaVectors.json'
import {
  FormulaError, FormulaEvalError, MAX_DEPTH, MAX_LENGTH, MAX_NUMBER_CHARS, MAX_ROUND_PLACES, MAX_TOKENS,
  evaluate, parse, refsOf, roundHalfAway, toDisplay, toStored,
} from './formulaEngine'

const build = (c) => (c.gen ? c.gen.map(([text, n]) => text.repeat(n)).join('') : c.expr)

export function runCase(c) {
  let text = build(c)
  const values = c.values || {}
  try {
    // ⛔ A Map and Object.hasOwn — never `key in values`: `'__proto__' in {}` is TRUE.
    if (c.names) text = toStored(text, new Map(Object.entries(c.names)))
    const node = parse(text)
    const lookup = (kind, key) => {
      if (kind !== 'id' || !Object.hasOwn(values, key)) throw new FormulaEvalError('unknown_ref', 'unknown')
      const v = values[key]
      if (v === null) throw new FormulaEvalError('missing', 'empty')
      return v
    }
    return { value: evaluate(node, lookup) }
  } catch (e) {
    if (e instanceof FormulaError || e instanceof FormulaEvalError) return { error: e.code }
    throw e
  }
}

describe('the shared formula vectors (client engine)', () => {
  it('NON-VACUITY: the file is the real one, both kinds of answer, and the same limits', () => {
    expect(vectors.cases.length).toBeGreaterThanOrEqual(120)
    const kinds = new Set(vectors.cases.flatMap((c) => Object.keys(c.expect)))
    expect([...kinds].sort()).toEqual(['error', 'value'])
    expect(vectors.limits).toEqual({
      maxLength: MAX_LENGTH, maxTokens: MAX_TOKENS, maxDepth: MAX_DEPTH,
      maxNumberChars: MAX_NUMBER_CHARS, maxRoundPlaces: MAX_ROUND_PLACES,
    })
  })

  it.each(vectors.cases.map((c) => [c.name, c]))('%s', (_name, c) => {
    const got = runCase(c)
    if ('value' in c.expect) {
      expect(got).toHaveProperty('value')
      expect(Number.isFinite(got.value)).toBe(true)
      expect(Object.is(got.value, -0)).toBe(false)
      expect(got.value).toBe(c.expect.value)
    } else {
      expect(got).toEqual({ error: c.expect.error })
    }
  })
})

describe('engine properties beyond the vectors', () => {
  it('refsOf lists each reference once, in order', () => {
    expect(refsOf(parse('{@b} + {@a} * {@b} - if({@c} > 0, {@a}, 1)'))).toEqual([
      { kind: 'id', key: 'b' }, { kind: 'id', key: 'a' }, { kind: 'id', key: 'c' },
    ])
  })

  it('toStored keeps the text outside the braces; toDisplay reverses it', () => {
    const stored = toStored('( {Exit} - {Entry} ) / 2', new Map([['exit', 'x1'], ['entry', 'e1']]))
    expect(stored).toBe('( {@x1} - {@e1} ) / 2')
    expect(toDisplay(stored, new Map([['x1', 'Exit'], ['e1', 'Entry']]))).toBe('( {Exit} - {Entry} ) / 2')
  })

  it('toDisplay leaves the id of a deleted property in place', () => {
    expect(toDisplay('{@gone} + 1', new Map())).toBe('{@gone} + 1')
  })

  it('a parse error says where, in words', () => {
    expect(() => parse('1 + * 2')).toThrow(/character 5/)
  })

  it('an unknown word tells the member how to name a property', () => {
    expect(() => parse('Entry - Stop')).toThrow(/\{Entry\}/)
  })

  it('round half away from zero matches the decimal a person sees (same cases as the server test)', () => {
    for (const [x, n, want] of [[2.675, 2, 2.68], [1.45, 1, 1.5], [-0.5, 0, -1], [0.125, 2, 0.13], [1e-7, 7, 1e-7]]) {
      expect(roundHalfAway(x, n)).toBe(want)
    }
  })
})

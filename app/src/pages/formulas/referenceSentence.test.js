// app/src/pages/formulas/referenceSentence.test.js
//
// The reference page printed the manifest's sentence TEMPLATE to members:
// "the absolute value of {0}". These rails hold the fix and prove each can fail.

import { describe, it, expect } from 'vitest'
import { referenceArgs, referenceSentence } from './referenceSentence'
import { buildVocabulary } from '../../components/chart/engine/ast/vocabulary'

const PLACEHOLDER = /\{\d+\}/

const entries = () => buildVocabulary().groups.flatMap((s) => s.items || [])

describe('referenceSentence', () => {
  it('names each placeholder after the signature shown above it', () => {
    const item = {
      kind: 'function', signature: 'atr(high, low, close, period)',
      sentence: 'the {3}-bar average true range of {0}, {1} and {2}',
    }
    expect(referenceSentence(item)).toBe('the period-bar average true range of high, low and close')
  })

  it('an operator names its operands a and b', () => {
    expect(referenceSentence({ kind: 'operator', signature: '+', sentence: '{0} plus {1}' })).toBe('a plus b')
  })

  it('a placeholder with no argument to name it is left as it is, never given an invented word', () => {
    const item = { kind: 'function', signature: 'f(series)', sentence: '{0} against {1}' }
    expect(referenceSentence(item)).toBe('series against {1}')
  })

  it('a sentence with no placeholder is returned unchanged; a missing one is empty', () => {
    expect(referenceSentence({ kind: 'scalar', signature: 'beta', sentence: 'the stock beta' })).toBe('the stock beta')
    expect(referenceSentence({ kind: 'scalar', signature: 'beta' })).toBe('')
    expect(referenceSentence(null)).toBe('')
  })

  it('referenceArgs reads the names between the outer parentheses, in order', () => {
    expect(referenceArgs({ kind: 'function', signature: 'macd(series, fastPeriod, slowPeriod)' }))
      .toEqual(['series', 'fastPeriod', 'slowPeriod'])
    expect(referenceArgs({ kind: 'scalar', signature: 'beta' })).toEqual([])
  })
})

describe('over the engine\'s real vocabulary', () => {
  it('control: the manifest sentences DO carry placeholders (so the rail below can see one)', () => {
    const carrying = entries().filter((it) => PLACEHOLDER.test(it.sentence || ''))
    expect(carrying.length).toBeGreaterThan(50)
    expect(carrying.every((it) => it.kind === 'function')).toBe(true)
  })

  it('the vocabulary already names an operator\'s operands, so none arrives as a template', () => {
    // Measured on the first run of this file: `vocabulary.js` fills an operator's
    // `{0}`/`{1}` with `a`/`b` itself. The defect on the page was the functions'.
    const operators = entries().filter((it) => it.kind === 'operator')
    expect(operators.length).toBeGreaterThan(0)
    expect(operators.filter((it) => PLACEHOLDER.test(it.sentence || ''))).toEqual([])
  })

  it('no entry reaches the page with a placeholder still in its sentence', () => {
    const left = entries()
      .map((it) => ({ name: it.name, kind: it.kind, said: referenceSentence(it) }))
      .filter((x) => PLACEHOLDER.test(x.said))
    expect(left, JSON.stringify(left.slice(0, 5))).toEqual([])
  })

  it('every name a sentence uses is a name its own signature shows', () => {
    for (const it of entries().filter((x) => x.kind === 'function')) {
      const used = [...(it.sentence || '').matchAll(/\{(\d+)\}/g)].map((m) => Number(m[1]))
      const args = referenceArgs(it)
      for (const n of used) expect(args[n], `${it.name} {${n}}`).toBeTruthy()
    }
  })
})

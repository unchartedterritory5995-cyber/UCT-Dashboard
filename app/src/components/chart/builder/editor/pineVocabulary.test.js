/* global process, __dirname */
// A6 — the Pine Editor's vocabulary is DERIVED (engine tables × the committed
// corpus) and FROZEN; these rails re-derive it, ask the translator to resolve
// every spelling, and pin the editor behaviour that reads it.
//
// Regenerate after a deliberate table/corpus change:
//   UPDATE_PINE_VOCAB=1 npx vitest run src/components/chart/builder/editor/pineVocabulary.test.js
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { EditorState } from '@codemirror/state'
import { CompletionContext } from '@codemirror/autocomplete'

import { deriveVocabulary, translatorResolves } from './pineVocabularyDerive'
import {
  PINE_VOCABULARY, pineVocabularyFor, pineVersionOf, pineCompletionSource, pineDocFor, pineRowAt,
  pineFoldRange,
} from './pineVocabulary'
import { TABLE } from '../../engine/ast/parse'

const REPO = path.resolve(__dirname, '../../../../../..')
const JSON_PATH = path.join(__dirname, 'pineVocabulary.json')
const CORPUS_DIRS = ['corpus/committed', 'tests/fixtures/pine_community']

function corpusSources() {
  return CORPUS_DIRS.flatMap((d) => fs.readdirSync(path.join(REPO, d))
    .filter((f) => f.endsWith('.pine')).sort()
    .map((f) => fs.readFileSync(path.join(REPO, d, f), 'utf8')))
}

const resolves = translatorResolves
const labels = (v) => pineVocabularyFor(v).map((r) => r.label)

describe('A6 — the vocabulary is derived, never typed', () => {
  it('⛔⛔ the frozen list IS the derivation from the engine tables and the corpus (drift fails)', () => {
    const sources = corpusSources()
    expect(sources.length).toBeGreaterThan(200)
    const derived = deriveVocabulary(sources)
    if (process.env.UPDATE_PINE_VOCAB === '1') {
      fs.writeFileSync(JSON_PATH, `${JSON.stringify(derived, null, 1)}\n`)
    }
    expect(PINE_VOCABULARY.map((r) => ({ ...r }))).toEqual(derived)
  })

  it('⛔ non-vacuous: real names, in each version\'s own spelling', () => {
    expect(PINE_VOCABULARY.length).toBeGreaterThan(100)
    // v4 spells value functions bare; v5/v6 namespaced — measured off the corpus.
    expect(labels(4)).toContain('sma')
    expect(labels(4)).not.toContain('ta.sma')
    for (const v of [5, 6]) {
      expect(labels(v)).toContain('ta.sma')
      expect(labels(v)).not.toContain('sma')
      expect(labels(v)).toContain('math.abs')
      // `math.max` is the engine's own full spelling; Pine's `ta.max(x)` is a
      // different function and must not be offered as the same table `max`.
      expect(labels(v)).toContain('math.max')
      expect(labels(v)).not.toContain('ta.max')
    }
  })

  it('⛔⛔ every key-backed row names a function the closed table declares', () => {
    const backed = PINE_VOCABULARY.filter((r) => r.key)
    expect(backed.length).toBeGreaterThan(30)
    for (const r of backed) expect(TABLE.functions, r.label).toHaveProperty([r.key])
  })

  it('⛔⛔ the translator resolves every spelling the editor offers, in that version', () => {
    const failures = []
    for (const r of PINE_VOCABULARY) {
      for (const v of r.versions) if (!resolves(r.label, v)) failures.push(`${r.label} @v${v}`)
    }
    expect(failures).toEqual([])
  })

  it('⛔ the probe can fail: names the engine does not hold resolve in NONE of its shapes', () => {
    for (const fake of ['ta.notarealname', 'math.notarealname', 'notarealname', 'str.notarealname', 'barstate.notreal']) {
      for (const v of [4, 5, 6]) expect(resolves(fake, v), `${fake} @v${v}`).toBe(false)
    }
  })
})

function complete(doc, pos = doc.length, explicit = false) {
  const state = EditorState.create({ doc })
  return pineCompletionSource()(new CompletionContext(state, pos, explicit))
}

describe('A6 — completions are version-aware', () => {
  it('reads the version off the script with the engine\'s lexer', () => {
    expect(pineVersionOf('//@version=6\nindicator("x")')).toBe(6)
    expect(pineVersionOf('//@version=5\nindicator("x")')).toBe(5)
    expect(pineVersionOf('//@version=4\nstudy("x")')).toBe(4)
    expect(pineVersionOf('study("x")')).toBe(4)
    // a half-typed line elsewhere cannot make the read throw
    expect(pineVersionOf('//@version=5\nx = ta.sma(close, "')).toBe(5)
  })

  it('v5: `ta.s` offers `ta.sma(` with the engine\'s own sentence; never bare `sma`', () => {
    const res = complete('//@version=5\nindicator("x")\nplot(ta.s')
    const sma = res.options.find((o) => o.label === 'ta.sma')
    expect(sma).toBeTruthy()
    expect(sma.apply).toBe('ta.sma(')
    expect(sma.detail).toBe('(source, length)')
    expect(sma.info).toContain(TABLE.functions.sma.sentence.replace('{1}', 'period').replace('{0}', 'source'))
    const bare = complete('//@version=5\nindicator("x")\nplot(sm')
    expect(bare === null || !bare.options.some((o) => o.label === 'sma')).toBe(true)
  })

  it('v4: `sm` offers bare `sma(`; never the namespaced spelling', () => {
    const res = complete('//@version=4\nstudy("x")\nplot(sm')
    expect(res.options.map((o) => o.label)).toContain('sma')
    const ns = complete('//@version=4\nstudy("x")\nplot(ta.s')
    expect(ns === null || !ns.options.some((o) => o.label === 'ta.sma')).toBe(true)
  })

  it('nothing is offered inside a comment or a string', () => {
    expect(complete('//@version=5\n// ta.s')).toBeNull()
    expect(complete('//@version=5\nindicator("ta.s')).toBeNull()
  })
})

describe('A6 — hover docs are the engine\'s own words', () => {
  it('a measured permutation shows PINE\'s argument order (`ta.stoch`)', () => {
    const row = PINE_VOCABULARY.find((r) => r.label === 'ta.stoch')
    expect(row).toBeTruthy()
    // PINE_CALL_SHAPES.stoch builds table (high, low, close, period) from Pine (1, 2, 0, 3)
    expect(pineDocFor(row).signature).toBe('ta.stoch(close, high, low, period)')
  })

  it('a deliberate vendor difference is said on hover (`vendorNote`)', () => {
    // v4's bare `barssince` reaches the table entry that carries one; the
    // host lane refuses v5's `ta.barssince` shape, so it is not offered there.
    const row = PINE_VOCABULARY.find((r) => r.label === 'barssince')
    expect(row && row.key).toBe('barssince')
    expect(row.versions).toEqual([4])
    expect(pineDocFor(row).note).toBe(TABLE.functions.barssince.vendorNote)
  })

  it('the row under the caret is found by its full dotted spelling', () => {
    const state = EditorState.create({ doc: '//@version=5\nindicator("x")\nplot(ta.sma(close, 14))' })
    const at = state.doc.toString().indexOf('sma') + 1
    expect(pineRowAt(state.doc, at).row.label).toBe('ta.sma')
    expect(pineRowAt(state.doc, state.doc.toString().indexOf('14'))).toBeNull()
  })
})

describe('A6 — indentation folding', () => {
  it('an `if` block folds over its deeper lines and stops at the dedent', () => {
    const doc = '//@version=5\nindicator("x")\nif close > open\n    a = 1\n\n    b = 2\nplot(close)'
    const state = EditorState.create({ doc })
    const ifLine = state.doc.line(3)
    const r = pineFoldRange(state, ifLine.from)
    expect(state.doc.sliceString(r.from, r.to)).toBe('\n    a = 1\n\n    b = 2')
    expect(pineFoldRange(state, state.doc.line(7).from)).toBeNull()
  })
})

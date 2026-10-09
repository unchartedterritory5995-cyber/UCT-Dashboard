// app/src/components/chart/builder/FormulaField.functionReadback.test.js
//
// ⭐ THE LEGACY "NEW FORMULA" SHEET SAYS A FORMULA FUNCTION BY NAME (2026-10-09).
// `linreg(close, 50)` is stored expanded (sum, wma, a constant); the sheet's read-back
// used to say that arithmetic back. It now says "the 50-bar linear regression of close"
// — for a formula typed fresh AND for a saved one reopened from the store (sorted keys).
// Pinned alongside: the maths, the stored tree and every function-free sentence are
// UNCHANGED, and the conversational builder still opens the saved document.
import { describe, it, expect } from 'vitest'
import { evaluateFormula as evaluateAny, SHEET } from './FormulaField'
import { buildDefinition, storedSourceFor } from './BuilderSheet'
import { sentenceFor } from '../engine/ast/sentence'
import { astHash } from '../engine/ast/parse'
import { interpret } from '../engine/ast/interpret'
import { openAuthoringState } from './authoring'
import { compactView } from './authoring/compactView'

// the sheet's own reading — its FormulaField and its reopen pass SHEET
const evaluateFormula = (src, inputs) => evaluateAny(src, inputs, undefined, SHEET)

const N = 120
const BARS = Array.from({ length: N }, (_, i) => {
  const c = 100 + 0.2 * i + 6 * Math.sin(i / 7) + 2 * Math.cos(i / 2.9)
  return { t: 1_700_000_000 + i * 86400, o: c - 0.4, h: c + 1.5 + Math.abs(Math.sin(i)), l: c - 1.3 - Math.abs(Math.cos(i)), c, v: 1_000_000 + 37_000 * ((i * 5) % 11) }
})
const SPY = BARS.map((b, i) => ({ ...b, c: 50 + 0.1 * i + 3 * Math.sin(i / 5) }))
const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys)
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v)
const run = (ast) => Array.from(interpret(ast, BARS, {}, undefined, undefined, { tf: 'D', symbols: { SPY } }))
const same = (a, b) => a.length === b.length && a.every((x, i) => (Number.isNaN(x) && Number.isNaN(b[i])) || x === b[i])

const CASES = [
  ['linreg(close, 50)', 'the 50-bar linear regression of close'],
  ['linreg(close, 50, 2)', 'the 50-bar linear regression of close, read 2 bars back'],
  ['correlation(close, sym("SPY", close), 20)', 'the 20-bar correlation of close with SPY’s close'],
  ['vwma(close, 20)', 'the 20-bar volume-weighted average of close'],
  ['roc(close, 14)', 'the 14-bar rate of change of close, in percent'],
  ['mom(close, 14)', 'the 14-bar momentum of close'],
  ['kcMiddle(close, 20)', 'the 20-bar Keltner Channel middle line of close'],
  ['kcUpper(close, 20, 2)', 'the upper Keltner Channel band of close (20 bars, 2 × the average true range)'],
  ['kcLower(close, 20, 1.5)', 'the lower Keltner Channel band of close (20 bars, 1.5 × the average true range)'],
  ['close > linreg(close, 20)', '1 when close is greater than (the 20-bar linear regression of close) and 0 otherwise'],
  ['roc(close, 14) + roc(close, 11)', '(the 14-bar rate of change of close, in percent) plus (the 11-bar rate of change of close, in percent)'],
]
const says = (text, want) => expect(text).toBe(want)

describe('the legacy formula sheet names formula functions', () => {
  for (const [src, want] of CASES) {
    it(`${src} — typed, saved, reopened from the store: one readable sentence, same maths`, () => {
      const ev = evaluateFormula(src)
      expect(ev.ok, ev.error).toBe(true)
      says(ev.readback, want)
      // nothing of the expansion leaks into the sentence
      expect(ev.readback).not.toMatch(/sum of close|times 0\.\d|weighted average of close\)\) minus|absolute value/)

      // save exactly as the sheet does, then the store's round trip (sorted keys)
      const def = buildDefinition({ defId: 'u_0123456789ab', name: 'Probe', source: ev.source, ast: ev.ast,
        mode: ev.verdict.mode, readback: ev.readback })
      expect(def.meta.description).toBe(ev.readback)
      const stored = sortKeys(JSON.parse(JSON.stringify(def)))

      // reopen in the legacy sheet: the box is filled from the stored source
      const text = storedSourceFor(stored.compute, 'value', 0)
      expect(text).toBe(src)
      const again = evaluateFormula(text)
      expect(again.readback).toBe(ev.readback)
      // ⛔ the maths are the stored tree's, untouched
      expect(astHash(again.ast)).toBe(astHash(ev.ast))
      expect(same(run(again.ast), run(ev.ast))).toBe(true)
    })
  }
})

describe('nothing else moves', () => {
  it('every other caller keeps sentenceFor exactly — conversational saves do not move', () => {
    for (const [src] of CASES) {
      const ev = evaluateAny(src)
      expect(ev.ok, src).toBe(true)
      expect(ev.readback, src).toBe(sentenceFor(ev.ast, undefined))
      expect(astHash(ev.ast)).toBe(astHash(evaluateFormula(src).ast))
    }
  })

  it('a formula with no function says sentenceFor’s sentence byte for byte', () => {
    for (const src of ['rsi(close, 14)', 'sma(close, 20) - ema(close, 50)', 'close - close[14]', 'ema(close, 20)',
      'close > highest(high, 20)[1] && volume > 2 * sma(volume, 50)', 'wma(close, 10) + sum(close, 5) / 5']) {
      const ev = evaluateFormula(src)
      expect(ev.ok, `${src}: ${ev.error}`).toBe(true)
      expect(ev.readback, src).toBe(sentenceFor(ev.ast, undefined))
    }
  })

  it('a hand-written difference or EMA is not renamed — only what the member wrote is', () => {
    expect(evaluateFormula('close - close[14]').readback).not.toMatch(/momentum/)
    expect(evaluateFormula('ema(close, 20)').readback).not.toMatch(/Keltner/)
    // the same tree typed as the function IS named — the source says the member wrote it
    expect(astHash(evaluateFormula('mom(close, 14)').ast)).toBe(astHash(evaluateFormula('close - close[14]').ast))
  })

  it('a formula with a declared input keeps its input wording, beside a named function', () => {
    const inputs = { shift: { kind: 'number', default: 1 } }
    const plain = evaluateFormula('close + shift', inputs)
    expect(plain.ok, plain.error).toBe(true)
    expect(plain.readback).toBe(sentenceFor(plain.ast, inputs))
    const mixed = evaluateFormula('linreg(close, 20) + shift', inputs)
    expect(mixed.ok, mixed.error).toBe(true)
    expect(mixed.readback).toMatch(/the 20-bar linear regression of close/)
    expect(mixed.readback).toMatch(/shift/)
  })

  it('the conversational builder opens a sheet-saved function definition by its function', () => {
    const ev = evaluateFormula('linreg(close, 50)')
    const stored = sortKeys(JSON.parse(JSON.stringify(buildDefinition({ defId: 'u_0123456789ab', name: 'Probe',
      source: ev.source, ast: ev.ast, mode: ev.verdict.mode, readback: ev.readback }))))
    const st = openAuthoringState(stored, { defId: stored.id, version: 1 })
    const view = compactView(st.working, st, { tf: 'D', symbol: 'AAPL' })
    expect(view.definition.outputs[0].readback).toMatch(/50-bar linear regression of close/)
  })
})

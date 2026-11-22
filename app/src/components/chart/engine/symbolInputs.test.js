// app/src/components/chart/engine/symbolInputs.test.js
//
// SETTINGS PARITY (symbol): a symbol a script reads through an input is a setting. RS Rating's
// "Comparative Symbol for Line" (`lineTicker`, default `SP:SPX`).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from './ast/pine'
import { memberPaneDefinition } from '../builder/memberPane/memberPaneDefinition'
import { projectMemberDocument } from './memberDocumentProjection'
import { stripParamInputs } from './paramInputs'
import { symbolInputSpecs, specializeSymbols, originalDocumentOf, instanceDocumentForFetch } from './symbolInputs'
import { fetchableOtherSymbols, symTickersOf } from './otherSymbols'
import { runtimeBuildInputs } from './runtime/runtimeInputs'
import { runHalfRunInputs } from './runHalfInputs'
import { __permitRuntimePaneForTests, __resetRuntimePanePermission } from './runtimePaneGate'
import { __allowEveryRuntimeScriptForTests, setRuntimeKillList } from './runtimeKill'

const REPO = path.resolve(process.cwd(), '..')
const RS = fs.readFileSync(path.join(REPO, 'docs/pine/rs-rating/rs-rating-fred6724__pziQwiT2.pine'), 'utf8')
const LF = String.fromCharCode(10)
const script = (...lines) => ['//@version=5', 'indicator("x")', ...lines].join(LF)

beforeEach(() => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  __permitRuntimePaneForTests()
  __allowEveryRuntimeScriptForTests()
  setRuntimeKillList([])
})
afterEach(() => {
  __resetRuntimePanePermission()
  vi.unstubAllEnvs()
})

describe('the translator records a symbol read through ONE input', () => {
  it('an input read as a request symbol is recorded with its default and title', () => {
    const t = translatePine(script("t = input('SP:SPX', title = 'Against')", 'plot(request.security(t, timeframe.period, close))'))
    expect(t.symbolInputs).toEqual([{ input: 't', ticker: 'SPX', venue: 'SP', default: 'SP:SPX', title: 'Against', pass: 'plots' }])
  })

  it('⛔ CONTROL: a ticker the same side also reads through a literal records nothing', () => {
    const t = translatePine(script("t = input('SP:SPX', title = 'X')", "f = 'SP:SPX'",
      'plot(request.security(t, timeframe.period, close))', 'plot(request.security(f, timeframe.period, close))'))
    expect(t.symbolInputs).toBeUndefined()
  })

  it('RS Rating: `lineTicker` on both sides; the rating\'s fixed `SP:SPX` is no plot\'s', () => {
    const d = memberPaneDefinition({ source: RS, id: 'u_si1', name: 'RS' }).definition
    expect(d.meta.symbolInputs.map((r) => [r.input, r.ticker, r.default, r.pass])).toEqual([
      ['lineTicker', 'SPX', 'SP:SPX', 'plots'], ['lineTicker', 'SPX', 'SP:SPX', 'objects']])
  })
})

describe('the setting, on load and at compute', () => {
  const rs = () => projectMemberDocument(memberPaneDefinition({ source: RS, id: 'u_si2', name: 'RS' }).definition)

  it('declared once as a text setting at the author\'s symbol, and never stored', () => {
    const def = rs()
    expect(symbolInputSpecs(def)).toEqual([expect.objectContaining({ key: 'lineTicker', type: 'string', default: 'SP:SPX',
      label: 'Comparative Symbol for Line', fromSymbol: 'lineTicker' })])
    expect(def.inputs.filter((i) => i.key === 'lineTicker')).toHaveLength(1)
    expect(stripParamInputs(def).inputs.some((i) => i.key === 'lineTicker')).toBe(false)
  })

  it('at the default (any spelling of it) nothing changes', () => {
    const def = rs()
    expect(specializeSymbols(def, {}).def).toBe(def)
    expect(specializeSymbols(def, { lineTicker: ' sp:spx ' }).def).toBe(def)
  })

  it('AMEX:SPY: the plots read SPY, the chart fetches it, and SPX stays fetched for the rest', () => {
    const def = rs()
    const s = specializeSymbols(def, { lineTicker: 'AMEX:SPY' })
    expect(s.ok).toBe(true)
    expect(symTickersOf({ compute: s.def.compute })).toEqual(['SPY'])
    expect(symTickersOf({ compute: def.compute })).toEqual(['SPX'])            // the stored document is untouched
    expect(s.def.meta.otherSymbols.find((r) => r.ticker === 'SPY')).toEqual({ ticker: 'SPY', spellings: ['AMEX'] })
    expect(s.def.meta.otherSymbols.some((r) => r.ticker === 'SPX')).toBe(true)
    expect(specializeSymbols(def, { lineTicker: 'AMEX:SPY' })).toBe(s)        // memoised: one object per choice
    expect(originalDocumentOf(s.def)).toBe(def)
    const fetched = fetchableOtherSymbols(instanceDocumentForFetch(def, { inputs: { lineTicker: 'AMEX:SPY' } }))
    expect(fetched).toEqual(expect.arrayContaining(['SPY', 'SPX']))
    expect(fetchableOtherSymbols(instanceDocumentForFetch(def, { inputs: {} }))).not.toContain('SPY')
  })

  it('⛔ a choice no binding can serve is refused by name, and fetches nothing new', () => {
    const def = rs()
    const foreign = specializeSymbols(def, { lineTicker: 'LSE:VOD' })
    expect(foreign).toMatchObject({ ok: false, key: 'lineTicker' })
    expect(foreign.message).toMatch(/^Comparative Symbol for Line: /)
    expect(specializeSymbols(def, { lineTicker: '???' })).toMatchObject({ ok: false, key: 'lineTicker' })
    expect(instanceDocumentForFetch(def, { inputs: { lineTicker: 'LSE:VOD' } })).toBe(def)
  })

  it('the drawings\' run is handed the member\'s text, which becomes the input\'s default node', () => {
    const def = rs()
    const r = runHalfRunInputs(def, { lineTicker: 'AMEX:SPY' })
    expect(r).toMatchObject({ ok: true, values: { lineTicker: 'AMEX:SPY' } })
    expect(r.needsEvidence).toContain('lineTicker')                           // the label sits on the RS line
    const runDef = { inputs: [{ key: 'lineTicker', type: 'string', default: 'SP:SPX' }] }
    expect(runtimeBuildInputs(runDef, { lineTicker: 'AMEX:SPY' })).toEqual({
      inputs: { lineTicker: 'AMEX:SPY' }, inputDefaults: { lineTicker: 'AMEX:SPY' } })
  })
})

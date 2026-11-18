// Custom header stats (owner 11-16) — the compute: the registry's own `computeFor`, the shared info-value gate, the
// legend's text. Synthetic bars only (never real market values).
import { describe, it, expect, afterEach } from 'vitest'
import * as registry from '../nativeRegistry'
import { installUserDefinitions, clearUserDefinitions, computeFor, getDefinition, AST_LANE_TIER } from '../nativeRegistry'
import { SCHEMA_VERSION } from '../defSchema'
import { parseFormula, astHash } from '../ast/parse'
import {
  computeCustomStat, computeCustomStats, customStatChoices, customStatOutputs, customStatOutputRefusal,
  customStatDefRefusal, sanitizeStatInputs, customStatLabel, customStatSigned, CUSTOM_STAT_STATES,
} from '../customStatCompute'

const BARS = (() => {
  const out = []
  for (let i = 0; i < 300; i++) {
    const mid = 100 + 8 * Math.sin(i / 9) + 3 * Math.sin(i / 2.3) + i * 0.05
    const d = new Date(Date.UTC(2024, 0, 1) + i * 86400000).toISOString().slice(0, 10)
    out.push({ t: d, o: mid - 0.3, h: mid + 1.1, l: mid - 1.2, c: mid + 0.2, v: 1e6 + (i * 7919) % 400000 })
  }
  return out
})()
const ctx = { sym: 'TEST', tf: 'D' }
const entry = (over) => ({ id: 'c1', defId: 'movingAverage', plotKey: 'ma', inputs: { maType: 'ema', period: 21 }, ...over })

const lastOf = (col) => col[col.length - 1]

describe('computeCustomStat — the same column the chart draws', () => {
  it('EMA 21 is the registry column\'s newest value, printed with the plot\'s decimals', () => {
    const r = computeCustomStat(entry(), BARS, ctx)
    const def = getDefinition('movingAverage')
    const col = computeFor(def, BARS, { maType: 'ema', period: 21 }, { source: BARS.map((b) => b.c) }).ma
    expect(r.state).toBe(CUSTOM_STAT_STATES.VALUE)
    expect(r.key).toBe('cx:c1')
    expect(r.value).toBeCloseTo(lastOf(col), 10)
    expect(r.text).toBe(lastOf(col).toFixed(2))
    expect(r.label).toBe('EMA 21')
    expect(r.signed).toBe(false)
  })

  it('a source input reads the chosen bar field (HL2 differs from Close)', () => {
    const close = computeCustomStat(entry(), BARS, ctx)
    const hl2 = computeCustomStat(entry({ inputs: { maType: 'ema', period: 21, source: 'hl2' } }), BARS, ctx)
    expect(hl2.state).toBe('value')
    expect(hl2.value).not.toBeCloseTo(close.value, 6)
  })

  it('RSI 14 prints one decimal; % From MA is signed (it declares a 0 guide)', () => {
    const rsi = computeCustomStat(entry({ defId: 'rsi', plotKey: 'rsi', inputs: { period: 14 } }), BARS, ctx)
    expect(rsi.state).toBe('value')
    expect(rsi.text).toMatch(/^\d+\.\d$/)
    expect(rsi.label).toBe('RSI 14')
    const pct = computeCustomStat(entry({ defId: 'percentFromMa', plotKey: 'pct', inputs: { period: 50 } }), BARS, ctx)
    expect(pct.state).toBe('value')
    expect(pct.signed).toBe(true)
  })

  it('a multi-output indicator names the output: MACD · SIG', () => {
    const r = computeCustomStat(entry({ defId: 'macd', plotKey: 'signal', inputs: {} }), BARS, ctx)
    expect(r.state).toBe('value')
    expect(r.label).toBe('MACD · SIG')
  })

  it('a newest bar with no value is unknown (—), never an earlier value', () => {
    const short = BARS.slice(0, 10)   // fewer bars than the period: every value is warm-up NaN
    const r = computeCustomStat(entry({ inputs: { maType: 'sma', period: 50 } }), short, ctx)
    expect(r.state).toBe(CUSTOM_STAT_STATES.UNKNOWN)
    expect(r.text).toBe('—')
  })

  it('no bars yet → pending; a definition that is gone → missing, under its stored name', () => {
    expect(computeCustomStat(entry(), [], ctx).state).toBe('pending')
    const r = computeCustomStat(entry({ defId: 'u_gone', name: 'My thing' }), BARS, ctx)
    expect(r.state).toBe(CUSTOM_STAT_STATES.MISSING)
    expect(r.label).toBe('My thing')
    expect(r.text).toBe('—')
  })

  it('out-of-range and unknown inputs fall back to the default (never reach the compute)', () => {
    const def = getDefinition('movingAverage')
    expect(sanitizeStatInputs(def, { period: 99999, maType: 'nope', source: 'sym:QQQ:close', color: '#fff', junk: 1 })).toEqual({})
    expect(sanitizeStatInputs(def, { period: 21, maType: 'ema', source: 'hlc3' })).toEqual({ period: 21, maType: 'ema', source: 'hlc3' })
    expect(sanitizeStatInputs(def, { period: 2.5 })).toEqual({})
  })

  it('memoised per bars array: the same bars and entries compute once', () => {
    const a = computeCustomStats([entry()], BARS, ctx)
    const b = computeCustomStats([entry()], BARS, ctx)
    expect(b['cx:c1']).toBe(a['cx:c1'])
    const c = computeCustomStats([entry()], BARS.slice(), ctx)
    expect(c['cx:c1']).not.toBe(a['cx:c1'])
    expect(c['cx:c1'].value).toBe(a['cx:c1'].value)
  })
})

describe('what can be a header stat', () => {
  it('refuses the server lane, guides, profiles and the data-series passthrough', () => {
    expect(customStatDefRefusal(getDefinition('rsLine'))).toMatch(/server/)
    expect(customStatOutputRefusal(getDefinition('macd'), 'zero')).toMatch(/guide/)
    expect(customStatOutputRefusal(getDefinition('awesome'), 'rising')).toMatch(/helper/)
    expect(customStatDefRefusal(getDefinition('dataSeries'))).toBeTruthy()
    const r = computeCustomStat(entry({ defId: 'rsLine', plotKey: 'rsLine', inputs: {} }), BARS, ctx)
    expect(r.state).toBe('refused')
    expect(r.text).toBe('n/a')
  })

  it('the offer lists shipped indicators with their valid outputs, never a refused one', () => {
    const choices = customStatChoices()
    const ids = choices.map((c) => c.defId)
    expect(ids).toEqual(expect.arrayContaining(['movingAverage', 'rsi', 'atr', 'percentFromMa', 'macd']))
    expect(ids).not.toContain('rsLine')
    expect(ids).not.toContain('dataSeries')
    expect(choices.find((c) => c.defId === 'macd').outputs.map((o) => o.key)).toEqual(['macd', 'signal', 'histogram'])
    expect(customStatOutputs(getDefinition('awesome')).map((o) => o.key)).toEqual(['ao'])
    expect(customStatSigned(getDefinition('rsi'))).toBe(false)
  })
})

describe("a member's saved formula", () => {
  afterEach(() => { clearUserDefinitions() })
  const formula = (source, id) => {
    const parsed = parseFormula(source)
    if (!parsed.ok) throw new Error(parsed.error)
    return {
      schemaVersion: SCHEMA_VERSION, id, version: 1,
      compute: { kind: 'ast', fn: astHash(parsed.ast), rev: 1, ast: parsed.ast, source },
      meta: { name: 'Close vs SMA', shortName: 'CvS', category: 'Custom', tier: AST_LANE_TIER, repaint: 'non-repainting', freshness: 'live' },
      placement: { target: 'pane', pane: { height: 0.15 } },
      inputs: [{ key: 'color', type: 'color', label: 'Color', default: 'token:info' }],
      plots: [{ key: 'out', label: 'CvS', style: 'line', color: '$color', width: 1, role: 'primary' }],
    }
  }

  it('is offered under My indicators and computes through the same door', () => {
    const id = 'u_0123456789ab'
    const inst = installUserDefinitions([formula('close - sma(close, 20)', id)])
    expect(inst.errors).toEqual([])
    const c = customStatChoices(registry).find((x) => x.defId === id)
    expect(c && c.mine).toBe(true)
    const r = computeCustomStat({ id: 'c2', defId: id, plotKey: 'out', inputs: {} }, BARS, ctx)
    const col = computeFor(getDefinition(id), BARS, {}, {}).out
    expect(r.state).toBe('value')
    expect(r.value).toBeCloseTo(lastOf(col), 10)
    expect(customStatLabel(getDefinition(id), { plotKey: 'out', inputs: {} }).label).toBeTruthy()
  })

  it('a yes/no formula is not a number and is refused', () => {
    const id = 'u_0123456789ac'
    expect(installUserDefinitions([formula('close > sma(close, 20)', id)]).errors).toEqual([])
    expect(customStatOutputRefusal(getDefinition(id), 'out')).toMatch(/yes\/no/)
    expect(customStatChoices(registry).some((x) => x.defId === id)).toBe(false)
  })
})

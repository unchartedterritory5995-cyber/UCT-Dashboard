// ⭐ TARGET DECLARATIONS — Phase 2 prep: the shadow sink (UNWIRED). Real planner, real fixture board; no panel, no model.
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerBuiltins } from './builtins'
import { makeBoard } from './__fixtures__/board'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { planOps, collectTargets } from './executor'
import { declareTargets, validateDeclaration } from './targetDecl'
import { __tdShadowSink, recordShadow, readShadow, resetShadow, SINK_MAX } from './targetDeclShadow'

registerBuiltins()
const HERE = path.dirname(fileURLToPath(import.meta.url))

const settings = () => ({ settings: mergeChartSettings(null) })
const SPY_NVDA = () => {
  const b = makeBoard([['c1', 0], ['c2', 12]].map(([id, x]) => ({ id, type: 'chart', x, y: 0, w: 12, h: 20, color: 'N', opts: settings() })), { 'N:c1': 'SPY', 'N:c2': 'NVDA' })
  return { ...b.host, charts: { ...b.host.charts, selected: () => 'c1' } }
}
const shadow = (words, ops, path) => {
  const host = SPY_NVDA()
  const plan = planOps(collectTargets(host, ['chart', 'board']), ops, {}, { surface: 'charts' })
  const decl = declareTargets({ words, host, ops })
  return recordShadow(validateDeclaration(plan, decl, { host, words }), decl, { path })
}
const setSym = (target, symbol) => ({ action: 'chart.setSymbol', target, args: { symbol } })
const grid = (symbols, extra = {}) => ({ action: 'chartGrid.set', target: 'board', args: { symbols, timeframe: null, layout: 'grid', new_charts: null, watchlist: null, replace: null, ...extra } })

beforeEach(() => resetShadow())

describe('the shadow sink (Phase 2 prep, unwired)', () => {
  it('records { path, verdict, kinds } per validation, oldest first; the sink array is readable directly', () => {
    expect(shadow('show AAPL', [setSym('c1', 'AAPL')], 'fast')).toBe(true)
    expect(shadow('Add AAPL and MSFT to my charts, but keep SPY and NVDA . All four in a grid', [grid(['SPY', 'NVDA', 'AAPL', 'MSFT'], { new_charts: true })], 'model')).toBe(true)
    expect(__tdShadowSink).toEqual([
      { path: 'fast', verdict: 'match', kinds: { chart: 'm', final: 'm' } },
      { path: 'model', verdict: 'mismatch', kinds: { final: 'x' } },
    ])
    expect(readShadow()).toEqual(__tdShadowSink)
  })
  it('readShadow is a copy: changing it never changes the sink', () => {
    shadow('show AAPL', [setSym('c1', 'AAPL')], 'fast')
    const copy = readShadow()
    copy[0].kinds.chart = 'x'
    copy.push({})
    expect(__tdShadowSink).toEqual([{ path: 'fast', verdict: 'match', kinds: { chart: 'm', final: 'm' } }])
  })
  it('resetShadow empties it; the sink is bounded at SINK_MAX (oldest dropped)', () => {
    for (let i = 0; i < SINK_MAX + 5; i++) recordShadow({ verdict: 'none', kinds: {} }, null, { path: i < 5 ? 'model' : 'fast' })
    expect(__tdShadowSink.length).toBe(SINK_MAX)
    expect(__tdShadowSink.every(e => e.path === 'fast')).toBe(true)
    resetShadow()
    expect(__tdShadowSink).toEqual([])
  })
  it('an unknown path is "other"; a malformed result records a "none" entry and never throws', () => {
    expect(recordShadow(null, null, { path: 'free text the member typed' })).toBe(true)
    expect(__tdShadowSink).toEqual([{ path: 'other', verdict: 'none', kinds: {} }])
  })
  it('NO LEAK (permanent rail): no member words, symbols or ids reach the sink', () => {
    shadow('Add AAPL and MSFT to my charts, but keep SPY and NVDA . All four in a grid', [grid(['SPY', 'NVDA', 'AAPL', 'MSFT'], { new_charts: true })], 'model')
    shadow('change SPY to AAPL', [setSym('c1', 'AAPL')], 'approved')
    const s = JSON.stringify(__tdShadowSink)
    for (const leak of ['SPY', 'NVDA', 'AAPL', 'MSFT', 'c1', 'c2', 'keep', 'Add', 'grid', 'change']) expect(s).not.toContain(leak)
    for (const e of __tdShadowSink) expect(Object.keys(e)).toEqual(['path', 'verdict', 'kinds'])
  })
  it('UNWIRED: nothing in the Agent runtime imports the sink yet (railOf wiring waits for #1247 and #1261)', () => {
    for (const f of ['useAgent.js', 'AgentPanel.jsx', 'chartRail.js', 'executor.js']) {
      expect(readFileSync(path.join(HERE, f), 'utf8'), f).not.toMatch(/from\s+['"]\.\/targetDecl/)
    }
  })
})

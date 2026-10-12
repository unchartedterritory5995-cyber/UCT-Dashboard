// UIE PHASE 6 (OPEN-FINDINGS-2026-10 §1) — "RSI with level lines" can carry an alert. The browser
// preflight (evaluability, lane alert) mirrors alert_user_series: an `hlines` guide is refused for
// ITSELF (gate `presentation`), its data siblings are not, and the refusal speaks member words.
// (Both lanes over the same cases: tests/fixtures/ast/p1_evaluability_alert.json.)
import { describe, it, expect } from 'vitest'
import { evaluability, LANES, STATUS } from './evaluability'

const RSI = { type: 'call', name: 'rsi', args: [{ type: 'series', name: 'close' }, { type: 'num', value: 14 }] }
const MA = { type: 'call', name: 'sma', args: [RSI, { type: 'num', value: 9 }] }
const rsiWithLevels = () => ({
  id: 'u_0000000000c1', name: 'RSI + MA', version: 1,
  plots: [{ key: 'rsi', style: 'line' }, { key: 'ma', style: 'line' }, { key: 'levels', style: 'hlines', levels: [70, 30] }],
  compute: { kind: 'ast', fn: 'u_0000000000c1', ast: RSI, trees: { rsi: RSI, ma: MA }, scanPlot: 'rsi' },
})

describe('alert lane: level lines are a guide, not a blocker', () => {
  it('the RSI line and its MA are alertable — the guide no longer refuses its siblings', () => {
    for (const key of ['rsi', 'ma']) {
      const a = evaluability(rsiWithLevels(), key, LANES.ALERT)
      expect(a.status, key).toBe(STATUS.SUPPORTED)
      expect(String(a.reason || '')).not.toMatch(/sibling plot/)
    }
  })
  it('an alert on the guide itself is refused by name, in member words that point to the line', () => {
    const a = evaluability(rsiWithLevels(), 'levels', LANES.ALERT)
    expect(a.status).toBe(STATUS.REFUSED)
    expect(a.gate).toBe('presentation')
    expect(a.guard).toBe('alert:presentation')
    expect(a.reason).toMatch(/level lines — a guide drawn at fixed values/)
    expect(a.reason).toMatch(/Alert on the indicator's own line instead/)
    expect(a.reason).not.toMatch(/tree|lane admits a definition whole/)       // no engine language
  })
  it('a single-tree document\'s guide is refused too (it used to answer with the formula\'s own number)', () => {
    const d = { ...rsiWithLevels(), plots: [{ key: 'value', style: 'line' }, { key: 'levels', style: 'hlines', levels: [70, 30] }], compute: { kind: 'ast', fn: 'u_0000000000c1', ast: RSI } }
    expect(evaluability(d, 'value', LANES.ALERT).status).toBe(STATUS.SUPPORTED)
    expect(evaluability(d, 'levels', LANES.ALERT).gate).toBe('presentation')
  })
  it('unchanged: a DATA plot with no tree still refuses the whole definition (gate plot)', () => {
    const d = rsiWithLevels()
    d.plots.push({ key: 'signal', style: 'line' })
    const a = evaluability(d, 'rsi', LANES.ALERT)
    expect(a.status).toBe(STATUS.REFUSED)
    expect(a.gate).toBe('plot')
  })
  it('the chart lane is untouched — it already called the guide a guide (identical on master)', () => {
    const a = evaluability(rsiWithLevels(), 'levels', LANES.CHART, {})
    expect(a.reason).toBe('This is a guide line, which carries no value per bar.')
    expect(evaluability(rsiWithLevels(), 'rsi', LANES.CHART, {}).status).toBe(STATUS.SUPPORTED)
  })
})

// The strict repaint check after the definitions pre-warm (prewarm.mjs): which charts count as untouched, and a chart missing from
// the count fails as "not measured" (AUDIT gaps a and b). Pure: no browser.
import { describe, it, expect } from 'vitest'
import { grade, untargetedRoles } from './oracle.mjs'

const roles = { TL: { id: 'c-tl' }, TR: { id: 'c-tr' }, BL: { id: 'c-bl' }, BR: { id: 'c-br' } }
const before = { charts: { TL: { sym: 'SPY' }, TR: { sym: 'QQQ' }, BL: { sym: 'NVDA' }, BR: { sym: 'TSLA' } } }
const req = (ops, select = null) => ({ board: 'FOUR', select, turns: [{ say: 'x', plan: { ops } }] })

describe('untargetedRoles', () => {
  it('every chart the ops do not target, by role', () => {
    expect(untargetedRoles(req([{ action: 'chart.setTimeframe', target: '$chart:TR' }]), {}, roles, before)).toEqual(['TL', 'BL', 'BR'])
  })
  it('`sel` is the chart clicked last', () => {
    expect(untargetedRoles(req([{ action: 'drawing.addLevel', target: '$dr:sel' }], 'BL'), { clicks: ['c-bl'] }, roles, before)).toEqual(['TL', 'TR', 'BR'])
  })
  it('an alert touches the charts that show its symbol', () => {
    expect(untargetedRoles(req([{ action: 'alert.create', target: '$list:alertLibrary', args: { symbol: 'QQQ' } }]), {}, roles, before)).toEqual(['TL', 'BL', 'BR'])
  })
  it('a board, workspace or layout op leaves no chart provably untouched', () => {
    expect(untargetedRoles(req([{ action: 'widget.add', target: '$list:workspace' }]), {}, roles, before)).toEqual([])
  })
})

describe('the strict repaint check', () => {
  const board = (charts) => ({ charts, widgets: [], wl: {}, drawings: {}, alerts: [], ialerts: [], layouts: [] })
  const charts = { TL: { sym: 'SPY', tf: 'D' }, TR: { sym: 'QQQ', tf: 'D' }, BL: { sym: 'NVDA', tf: 'D' }, BR: { sym: 'TSLA', tf: 'D' } }
  const ev = (repaints) => ({ before: board(charts), after: board({ ...charts, TR: { sym: 'QQQ', tf: 'W' } }), turns: [{ newReceipt: true, last: 'done' }], prewarm: { ok: true }, repaints })
  const request = { board: 'FOUR', turns: [{ say: 'x', plan: { ops: [{ action: 'chart.setTimeframe', target: '$chart:TR' }] } }], oracle: { outcome: 'change', expect: [['TR.tf', 'eq', 'W']] } }
  it('a change with no `only` checks every chart the plan does not target', () => {
    const r = grade(request, ev({ 'c-tl': [0, 0], 'c-tr': [2, 2], 'c-bl': [0, 1], 'c-br': [0, 0] }))
    expect(r.checks.filter(c => c.tag === 'repaint').map(c => [c.name, c.pass])).toEqual([['TL did not repaint', true], ['BL did not repaint', false], ['BR did not repaint', true]])
  })
  it('a chart missing from the count fails as not measured', () => {
    const r = grade(request, ev({ 'c-tl': [0], 'c-tr': [1] }))
    const miss = r.checks.filter(c => c.tag === 'repaint' && !c.pass)
    expect(miss.map(c => c.name)).toEqual(['BL did not repaint', 'BR did not repaint'])
    expect(miss[0].detail).toMatch(/not measured/)
  })
})

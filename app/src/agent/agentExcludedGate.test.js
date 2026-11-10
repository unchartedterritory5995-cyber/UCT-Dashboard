// #988 (AUDIT GO on 08fb7314ba): the excluded-chart gate (spatialCheck.withoutExcludedCharts) — the ONE check execute() runs on
// every path (an approved card included) and runFollowUps runs on every follow-up. A chart the words exclude is dropped from
// an op's TARGET and from the charts in its ARGS (an indicator Save's `addTo`, which lands later as follow-ups); idempotent.
// LOCAL / SIMULATED (BROWSER-MOCK-MODEL): unit, a scripted board.
import { describe, it, expect } from 'vitest'
import { withoutExcludedCharts } from './spatialCheck'

const W = 8, H = 10
const IDS = [['TL', 'TM', 'TR'], ['ML', 'MM', 'MR'], ['BL', 'BM', 'BR']]
const SYMS = ['SPY', 'QQQ', 'NVDA', 'TSLA', 'SPY', 'QQQ', 'NVDA', 'TSLA', 'AMD']
const POS = { T: 'top', M: 'middle', B: 'bottom', L: 'left', R: 'right' }
const charts = IDS.flatMap((ids, r) => ids.map((id, c) => ({ ref: id, label: `Chart (${id})`, symbol: SYMS[r * 3 + c], position: `${POS[id[0]]}-${id[1] === 'M' ? 'middle' : POS[id[1]]}`, cell: { x: c * W, y: r * H, w: W, h: H } })))
const host = (sel) => ({ charts: { list: () => charts, selected: () => sel } })
const KINDS = {
  chart: { name: 'chart', list: () => charts.map(c => ({ ref: c.ref })) },
  ixe: { name: 'ixe', list: () => charts.map(c => ({ ref: `ixe:${c.ref}`, chartRef: c.ref })) },
  draft: { name: 'draft', list: () => [{ ref: 'd1' }] },
}
const CAPS = { 'chart.setScale': { target: 'chart' }, 'indicator.add': { target: 'ixe' }, 'indicator.saveDraft': { target: 'draft' }, 'chart.describe': { target: 'chart', query: true } }
const deps = (sel) => ({ host: host(sel), getCapability: (a) => CAPS[a] || null, getTargetKind: (k) => KINDS[k] || null })
const scale = (id) => ({ action: 'chart.setScale', target: id, args: { scale: 'log' } })

describe('the excluded-chart gate', () => {
  it.each([['ML', 'ML'], ['MM', 'ML'], ['BL', 'BM']])('"this row except the TSLA one" (clicked %s): %s dropped from targets', (sel, ex) => {
    const row = IDS.find(r => r.includes(sel))
    const g = withoutExcludedCharts(row.map(scale), ['log on this row except the TSLA one'], deps(sel))
    expect(g.dropped).toBe(1)
    expect(g.ops.map(o => o.target)).toEqual(row.filter(id => id !== ex))
    // idempotent: the gated plan passes unchanged (an approved card built behind the gate is never refused)
    const again = withoutExcludedCharts(g.ops, ['log on this row except the TSLA one'], deps(sel))
    expect(again.dropped).toBe(0)
    expect(again.ops).toBe(g.ops)
  })
  it('an indicator Save\'s addTo loses the excluded chart (its follow-up adds never reach it)', () => {
    const op = { action: 'indicator.saveDraft', target: 'd1', args: { name: null, addTo: ['ML', 'MM', 'ixe:MR'] } }
    const g = withoutExcludedCharts([op], ['save it and add it to this row except the TSLA one'], deps('MM'))
    expect(g.dropped).toBe(1)
    expect(g.ops[0].args.addTo).toEqual(['MM', 'ixe:MR'])
    expect(op.args.addTo).toEqual(['ML', 'MM', 'ixe:MR'])                    // the plan it was given is not mutated
  })
  it('a follow-up add on an excluded chart (target ixe:<chart>) is dropped', () => {
    const g = withoutExcludedCharts([{ action: 'indicator.add', target: 'ixe:ML', args: { defId: 'x' } }], ['add it to this row except the TSLA one'], deps('MM'))
    expect(g.dropped).toBe(1)
    expect(g.ops).toEqual([])
  })
  it('queries, non-chart ops and words with no exclusion pass untouched', () => {
    const ops = [scale('ML'), { action: 'chart.describe', target: 'ML', args: {} }, { action: 'widget.addCharts', target: 'workspace', args: {} }]
    expect(withoutExcludedCharts(ops, ['log on this row'], deps('ML'))).toEqual({ ops, dropped: 0 })
    const g = withoutExcludedCharts(ops, ['log on this row except the TSLA one'], deps('ML'))
    expect(g.ops.map(o => o.action)).toEqual(['chart.describe', 'widget.addCharts'])
  })
  it('an exclusion the board cannot place is left to the constraint check (asked there), never guessed here', () => {
    // "the TSLA one" with no line in scope: TSLA is on two charts
    const g = withoutExcludedCharts([scale('ML'), scale('BM')], ['log on everything except the TSLA one'], deps('TL'))
    expect(g.dropped).toBe(0)
  })
})

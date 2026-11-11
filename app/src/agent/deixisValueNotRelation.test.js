// #988 (AUDIT on c01bab958c, the #1022 deixis baseline diff): "crosses above the 20 on this chart" is a VALUE ("the 20" = an
// average's period, a level) on the click — NO relation, as deixis.js has always said of "under 30 on this chart". #988's
// structural rule read "above the 20 on this chart" as an unplaced relation anchored on the click (an over-ask on a board of
// several charts). The family: a spatial word followed by a NUMBER (bare, "the", $, %, a decimal) and then the click is never a
// chart relation; a spatial word followed by a CHART noun still is. LOCAL: unit.
import { describe, it, expect } from 'vitest'
import { relationMatch } from './deixis'

const SPATIAL = ['above', 'below', 'under', 'over', 'beneath', 'underneath']
const VALUE = ['the 20', '20', 'the 200', '$150', '70', '30%', '1.5', 'the 50']
const CLICK = ['on this chart', 'on this one', 'on that chart', 'in this chart', 'here on this chart']
const LEAD = ['alert me when the 9 ema crosses', 'mark when price closes', 'tell me when rsi goes', 'ping me if it drops']
const VALUES = LEAD.flatMap(l => SPATIAL.flatMap(sp => VALUE.flatMap(v => CLICK.map(c => `${l} ${sp} ${v} ${c}`))))
const RELATIONS = ['the chart above this one', 'make the chart below this one weekly', 'log on the one under this chart',
  'the chart beneath this one', 'make the one above this chart weekly', 'two above this one',
  // AUDIT controls: a number BEFORE the spatial word, an ordinal, or words between the spatial word and the number stay relations
  'make the chart two above this weekly', 'log on the one 2 to the right of it', 'make the three charts below this one weekly',
  'make the 2nd one above this weekly', 'make the 2nd chart above this weekly', 'log on the 3rd one to the right of this',
  'make the 2nd one below this one weekly', 'make the 2nd one above weekly', 'log on the one above this, the 50 day']
// AUDIT controls: bare values with a spatial word and no click are no relation either
const BARE_VALUES = ['alert me when it goes above 20', 'tell me when it closes below the 50', 'ping me if rsi is under 30 on this chart',
  'alert me when it crosses over 200', 'mark it when price is above the 200 here']

describe('a value on the click is not a chart relation', () => {
  it.each(VALUES)('"%s" → no relation', (s) => {
    const m = relationMatch(s)
    expect(m && [m.index, m[0]], s).toBeNull()
  })
  it.each(BARE_VALUES)('control: "%s" → no relation', (s) => {
    const m = relationMatch(s)
    expect(m && [m.index, m[0]], s).toBeNull()
  })
  it.each(RELATIONS)('control: "%s" is still a relation', (s) => {
    expect(relationMatch(s), s).not.toBeNull()
  })
})

// AUDIT control (unit, the exclusion reader): ", not <X>" / "rather than <X>" excludes a chart or a position, never a value or a
// setting — even when the value word also DESCRIBES a chart on the board ("the weekly" = the one weekly chart, here the click).
// (The panel over-asks on these on master and on this head by another path — a follow-up, not this rail's claim.)
import { excludedCharts } from './spatialCheck'
const mk = (ref, x, y, position, tf, symbol) => ({ ref, label: `Chart (${ref})`, cell: { x, y, w: 8, h: 10 }, position, tf, symbol })
const BOARD = [mk('c0', 0, 0, 'top-left', 'D', 'SPY'), mk('c1', 8, 0, 'top-right', 'W', 'QQQ'), mk('c2', 0, 10, 'bottom-left', 'D', 'NVDA'), mk('c3', 8, 10, 'bottom-right', 'D', 'TSLA')]
describe('", not <a value>" excludes nothing; ", not <a chart>" excludes it', () => {
  it.each(['log scale on this one, not the weekly', 'put this one on log scale rather than the weekly', 'make it log, not linear',
    'make this weekly, not daily', 'show the 50, not the 200', 'log scale on this one instead of the weekly'])('"%s" → no exclusion', (t) => {
    expect([...excludedCharts(t, BOARD, 'c1')], t).toEqual([])
  })
  it.each([['make this weekly, not the left one', null], ['log on this one, not the top-left one', 'c0'], ['log on this one, not the bottom-left', 'c2'],
    ['log on this one rather than the NVDA one', 'c2'], ['log on this one, not TSLA', 'c3']])('"%s" → excludes %s', (t, ex) => {
    const out = [...excludedCharts(t, BOARD, 'c1')]
    if (ex) expect(out, t).toContain(ex)
    else expect(out.length, t).toBeGreaterThan(0)
  })
})

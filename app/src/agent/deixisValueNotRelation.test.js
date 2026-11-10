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
  'the chart beneath this one', 'make the one above this chart weekly', 'two above this one']

describe('a value on the click is not a chart relation', () => {
  it.each(VALUES)('"%s" → no relation', (s) => {
    const m = relationMatch(s)
    expect(m && [m.index, m[0]], s).toBeNull()
  })
  it.each(RELATIONS)('control: "%s" is still a relation', (s) => {
    expect(relationMatch(s), s).not.toBeNull()
  })
})

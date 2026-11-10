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

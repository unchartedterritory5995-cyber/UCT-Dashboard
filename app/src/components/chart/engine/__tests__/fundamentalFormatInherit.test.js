import { describe, it, expect, beforeEach } from 'vitest'
import { fundamentalFormatOfInstance } from '../fundamentalFormat'
import { primeFundamentalsCatalog, _resetFundamentalsForTests } from '../fundamentalSeries'

const DEFS = {
  dataSeries: { id: 'dataSeries' },
  movingAverage: { id: 'movingAverage', domainBehavior: 'inherit' },
  spread: { id: 'spread' },                                     // makes no inherit claim
}
const defOf = (id) => DEFS[id] || null
const fund = { instanceId: 'inst:dataSeries:1', defId: 'dataSeries', inputs: { source: 'fund:net_margin' } }
const ma = (id, src) => ({ instanceId: id, defId: 'movingAverage', inputs: { source: src } })

describe('fundamentalFormatOfInstance -- an average of a percent is a percent', () => {
  beforeEach(() => {
    _resetFundamentalsForTests()
    primeFundamentalsCatalog({ metrics: [{ id: 'net_margin', series: 'net_margin_ttm', fmt: 'pct1', unit: 'percent' }] })
  })

  it('a fundamental reads in its own unit', () => {
    expect(fundamentalFormatOfInstance(fund, defOf, [fund])).toBe('pct1')
  })

  it('MA(fundamental) and MA(MA(fundamental)) inherit it through the chain', () => {
    const a = ma('inst:movingAverage:1', '@inst:dataSeries:1::value')
    const b = ma('inst:movingAverage:2', '@inst:movingAverage:1::ma')
    expect(fundamentalFormatOfInstance(a, defOf, [fund, a, b])).toBe('pct1')
    expect(fundamentalFormatOfInstance(b, defOf, [fund, a, b])).toBe('pct1')
  })

  it('a definition with no inherit claim, a bar-field MA and a cycle all inherit nothing', () => {
    const s = { instanceId: 'inst:spread:1', defId: 'spread', inputs: { source: '@inst:dataSeries:1::value' } }
    expect(fundamentalFormatOfInstance(s, defOf, [fund, s])).toBe(null)
    expect(fundamentalFormatOfInstance(ma('m', 'close'), defOf, [fund])).toBe(null)
    const x = ma('x', '@y::ma'), y = ma('y', '@x::ma')
    expect(fundamentalFormatOfInstance(x, defOf, [x, y])).toBe(null)
  })
})

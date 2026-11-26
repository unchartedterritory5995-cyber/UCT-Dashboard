// A cloud that changes colour, written from a member's words, is translucent unless they name an opacity (2026-11-26).
//
// The fifty-set probe (live, admin measurement only): "plot the 10 day and 50 day rate of change ... and fill between
// them green when the 10 day is above the 50 day and red when it is below" drew a SOLID two-colour cloud: the words
// door's `set_fill` wrote colorAbove / colorBelow and no opacity, and a per-bar band paints its colours as given.
// Held here: such a cloud gets the static band's default opacity (`FILL_DEFAULT_OPACITY`, one constant for both), the
// readback says so, an opacity the member names or a band already has is kept, and the renderer still paints an
// imported (Pine) colour-changing band exactly as the script wrote it.
import { describe, it, expect } from 'vitest'
import { parseFormula } from '../ast/parse'
import { applyPatch } from '../../builder/authoring'
import { readback } from '../../builder/authoring/readback'
import { FILL_DEFAULT_OPACITY, fillOpacityOf, fillPaint, staticFillOf } from '../fillPaint'
import { withAlphaByte } from '../../designTokens'

const P = (src) => {
  const r = parseFormula(src)
  if (!r.ok) throw new Error(`${src}: ${JSON.stringify(r)}`)
  return r.ast
}
const GATE = { tf: 'D', symbol: 'AAPL' }
const env = (ops) => ({ contract: 'uct.authoring.patch/1', baseRevision: 0, ops, assumptions: [] })
const apply = (def, ops) => applyPatch(def, env(ops), { gateCtx: GATE })
const ok = (r) => { if (r.status !== 'applied') throw new Error(JSON.stringify(r.errors)); return r.definition }
const plotOf = (d, k) => d.plots.find((p) => p.key === k)
const TWO_ROC = () => ok(apply(null, [{ op: 'create', name: 'ROC cloud', outputs: [
  { key: 'fast', tree: P('roc(close, 10)') }, { key: 'slow', tree: P('roc(close, 50)') }] }]))
const CLOUD = { op: 'set_fill', output: 'fast', with: 'slow', colorAbove: '#089981', colorBelow: '#F23645' }

describe('a colour-changing cloud from words is translucent unless an opacity is named', () => {
  it('THE REQUEST FOUND LIVE: green above, red below -> painted at the default opacity, never solid', () => {
    const d = ok(apply(TWO_ROC(), [CLOUD]))
    const p = plotOf(d, 'fast')
    expect(p.fill).toMatchObject({ with: 'slow', colorUp: '#089981', colorDown: '#F23645' })
    expect(fillOpacityOf(p)).toBe(FILL_DEFAULT_OPACITY)
    expect(FILL_DEFAULT_OPACITY).toBeGreaterThan(0)
    expect(FILL_DEFAULT_OPACITY).toBeLessThan(1)
    // the exact paint each side gets (the per-bar band paints through `fillPaint` at the band's opacity)
    expect(fillPaint('#089981', fillOpacityOf(p))).toBe(withAlphaByte('#089981', FILL_DEFAULT_OPACITY))
    expect(fillPaint('#089981', fillOpacityOf(p))).not.toBe('#089981')
  })

  it('ONE constant: the colour-changing cloud and a plain band paint at the same default opacity', () => {
    const banded = ok(apply(TWO_ROC(), [{ op: 'set_fill', output: 'fast', with: 'slow' }]))
    expect(staticFillOf(plotOf(banded, 'fast')).opacity).toBe(fillOpacityOf(plotOf(ok(apply(TWO_ROC(), [CLOUD])), 'fast')))
  })

  it('the readback tells the member how see-through the cloud is', () => {
    const d = ok(apply(TWO_ROC(), [CLOUD]))
    const look = readback(d, {}, GATE).lines.find((l) => /area between/.test(l))
    expect(look).toMatch(/green where .* is above .*, red where below/)
    expect(look).toContain(`, ${Math.round(FILL_DEFAULT_OPACITY * 100)}% opaque`)
  })

  it('an opacity the member NAMES wins, solid included', () => {
    expect(fillOpacityOf(plotOf(ok(apply(TWO_ROC(), [{ ...CLOUD, opacity: 0.4 }])), 'fast'))).toBe(0.4)
    expect(fillOpacityOf(plotOf(ok(apply(TWO_ROC(), [{ ...CLOUD, opacity: 1 }])), 'fast'))).toBe(1)
  })

  it('a band that already has an opacity keeps it when it becomes a colour-changing cloud', () => {
    const banded = ok(apply(TWO_ROC(), [{ op: 'set_fill', output: 'fast', with: 'slow', color: '#2962FF', opacity: 0.3 }]))
    expect(fillOpacityOf(plotOf(ok(apply(banded, [CLOUD])), 'fast'))).toBe(0.3)
  })

  it('CONTROL: a NEW plain band still stores no opacity of its own (the renderer default paints it)', () => {
    const p = plotOf(ok(apply(TWO_ROC(), [{ op: 'set_fill', output: 'fast', with: 'slow' }])), 'fast')
    expect(p).not.toHaveProperty('fillOpacity')
    expect(staticFillOf(p).opacity).toBe(FILL_DEFAULT_OPACITY)
  })

  it('CONTROL: an imported colour-changing band with no opacity is still painted exactly as its script wrote it', () => {
    // (the renderer is unchanged: a Pine `fill(..., color = c ? color.green : color.red)` is opaque on TradingView)
    expect(fillOpacityOf({ fill: { with: 'b', colorMode: 'column:c', colorUp: '#00FF00', colorDown: '#FF0000' } })).toBe(null)
    expect(fillPaint('#00FF00', null)).toBe('#00FF00')
  })
})

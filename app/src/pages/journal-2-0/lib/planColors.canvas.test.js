// Fix round 1, review Critical 1: a chart CANVAS cannot paint `var(--…)`. Canvas 2D ignores an unparseable
// strokeStyle and strokes in whatever the context last held, so the trade-plan canvas drew its stop and target in an
// arbitrary colour (it read LEVEL_ROLES' CSS values). This rail calls EVERY builder that hands a colour to a chart --
// price lines and drawing annotations -- and fails if any value is a CSS function rather than a real colour.
// `var()` stays only where CSS reads it (the level chips' `--level-color`).
import { describe, expect, it } from 'vitest'
import { colorPlanAnnotations, planLineColor, PLAN_ROLE_FALLBACK } from './planColors'
import { levelAnnotations, LEVEL_ROLES } from './tradeCanvas'
import { planPriceLines as boardLines } from '../components/notebook/BoardCard'
import { planPriceLines as tradeLines } from '../components/trade/TradeBeforeAfter'

const isPaintable = (c) => typeof c === 'string' && /^(#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\()/.test(c.trim())
const ROLES = ['entry', 'stop', 'target', 'custom']

describe('every colour handed to a chart is a colour a canvas can paint', () => {
  it('the trade-plan canvas levels (all four roles)', () => {
    const levels = ROLES.map((role, i) => ({ id: `l${i}`, role, price: 100 + i }))
    const anns = levelAnnotations(levels)
    expect(anns).toHaveLength(4)
    for (const a of anns) expect(a.color, `${a.id}: ${a.color}`).toSatisfy(isPaintable)
    // and gain stays green, loss stays red
    expect(anns[1].color).toBe(PLAN_ROLE_FALLBACK.stop)
    expect(anns[2].color).toBe(PLAN_ROLE_FALLBACK.target)
  })

  it('the Setups board and the trade page price lines', () => {
    const plan = { entry: 10, stop: 9, target: 12 }
    for (const l of [...boardLines(plan), ...tradeLines(plan)]) expect(l.color).toSatisfy(isPaintable)
  })

  it('the chart embed role lines, and the line colour for a role with no plan colour', () => {
    for (const a of colorPlanAnnotations([{ id: 'a', role: 'entry' }, { id: 'b', role: 'stop' }])) expect(a.color).toSatisfy(isPaintable)
    for (const r of ROLES) expect(planLineColor(r)).toSatisfy(isPaintable)
  })

  it('CONTROL: the CSS values the chips read ARE var() -- the predicate would catch them on a chart', () => {
    for (const r of LEVEL_ROLES) expect(r.color).not.toSatisfy(isPaintable)
  })
})

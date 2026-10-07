// Wave 13 lane 13H-1 — lib/chartPlan.js: the `ta` shape, plan roles on drawings, and the sizing
// arithmetic at its boundaries (long, short, a stop above the entry, zero risk).
import { describe, expect, it } from 'vitest'
import {
  SETUP_TAG_MAX, SIZED_BY, SIZED_BY_LABEL, TA_VERSION, UNIQUE_PLAN_ROLES,
  accountRiskDollars, canCarryPlanRole, drawingLevelPrice, evaluateStarter, normalizeTa, planSide,
  rewardToRisk, riskPerShare, setPlanRole, sizePlan, starterPositionSize, withFingerprint,
  withPlanRole, withPlanShares, withSetupTag,
} from './chartPlan'
import { STARTER_FORMULAS, evaluateFormula } from './formula/computed'
import { PRICE_ROLES } from './planLevels'

const line = (id, price, extra = {}) => ({ id, type: 'horizontal', points: [{ time: 1, price }], ...extra })

describe('the `ta` attr', () => {
  it('holds nothing as null — never an empty object the schema guard would count', () => {
    expect(normalizeTa(null)).toBe(null)
    expect(normalizeTa({})).toBe(null)
    expect(normalizeTa({ setupTag: '   ', fingerprint: {}, planBlock: { shares: 0 } })).toBe(null)
    expect(normalizeTa('nope')).toBe(null)
    expect(normalizeTa([1])).toBe(null)
  })

  it('keeps only its four keys, stamps the version, and caps the tag at 13I\'s 80', () => {
    const ta = normalizeTa({ setupTag: `  ${'x'.repeat(100)}  `, other: 1, planBlock: { shares: 200, sizedBy: 'starter', extra: 9 } })
    expect(Object.keys(ta).sort()).toEqual(['planBlock', 'setupTag', 'v'])
    expect(ta.v).toBe(TA_VERSION)
    expect(ta.setupTag).toHaveLength(SETUP_TAG_MAX)
    expect(ta.planBlock).toEqual({ shares: 200, sizedBy: 'starter' })
  })

  it('a planBlock is 13A\'s shape: positive shares, and the engine label only beside them', () => {
    expect(withPlanShares(null, 150, SIZED_BY.COMPASS)).toEqual({ v: 1, planBlock: { shares: 150, sizedBy: 'compass' } })
    expect(withPlanShares(null, '150', 'invented')).toEqual({ v: 1, planBlock: { shares: 150 } })
    expect(withPlanShares({ v: 1, setupTag: 'VCP', planBlock: { shares: 9 } }, 0, 'starter')).toEqual({ v: 1, setupTag: 'VCP' })
  })

  it('a frozen fingerprint stays frozen unless a re-freeze is explicit', () => {
    const first = withFingerprint(null, { v: 1, adr_pct: 5 })
    expect(withFingerprint(first, { v: 1, adr_pct: 9 }).fingerprint.adr_pct).toBe(5)
    expect(withFingerprint(first, { v: 1, adr_pct: 9 }, { replace: true }).fingerprint.adr_pct).toBe(9)
  })

  it('setting and clearing the tag keeps the rest', () => {
    const ta = withSetupTag(withPlanShares(null, 100, 'starter'), 'Episodic Pivot')
    expect(ta).toEqual({ v: 1, setupTag: 'Episodic Pivot', planBlock: { shares: 100, sizedBy: 'starter' } })
    expect(withSetupTag(ta, '')).toEqual({ v: 1, planBlock: { shares: 100, sizedBy: 'starter' } })
  })
})

describe('plan roles ride the drawing (13A\'s write interface)', () => {
  it('only a flat level in the price pane at a real price can carry a role', () => {
    expect(canCarryPlanRole(line('a', 50))).toBe(true)
    expect(canCarryPlanRole(line('a', 50, { type: 'hray' }))).toBe(true)
    expect(canCarryPlanRole(line('a', 50, { pane: 'price' }))).toBe(true)
    expect(canCarryPlanRole(line('a', 30, { pane: 'pane1' }))).toBe(false)     // an RSI line
    expect(canCarryPlanRole(line('a', 9e6, { pane: 'volume' }))).toBe(false)
    expect(canCarryPlanRole(line('a', 50, { type: 'trendline' }))).toBe(false)
    expect(canCarryPlanRole({ id: 'a', type: 'horizontal', points: [] })).toBe(false)
    expect(canCarryPlanRole(line('a', -1))).toBe(false)
  })

  it('sets the role and NO price copy — the anchor follows the line, a copy would not', () => {
    const d = withPlanRole(line('a', 50, { price: 47, color: '#fff' }), 'stop')
    expect(d).toEqual({ id: 'a', type: 'horizontal', points: [{ time: 1, price: 50 }], color: '#fff', role: 'stop' })
    expect(withPlanRole(d, null)).toEqual({ id: 'a', type: 'horizontal', points: [{ time: 1, price: 50 }], color: '#fff' })
  })

  it('refuses what a plan cannot be', () => {
    expect(() => withPlanRole(line('a', 50), 'shares')).toThrow(/not a plan role/)
    expect(() => withPlanRole(line('a', 30, { pane: 'pane1' }), 'stop')).toThrow(/price pane/)
    expect(() => withPlanRole(null, 'stop')).toThrow()
    // the vocabulary is 13A's (planLevels.PRICE_ROLES), not a copy
    for (const r of PRICE_ROLES) expect(withPlanRole(line('a', 50), r).role).toBe(r)
  })

  it('reads `price` when there is no anchor — `planLevels.planAnnotation(role, price)`\'s own '
     + 'shape (no `drawing` given), the one `plan_extract.py`\'s `_annotation_price` also accepts '
     + 'first — never just a `points` reading (found by the wave-13 integration walk: a level '
     + 'seeded this exact way, the shape 13A/13J\'s own fixtures already use, rendered zero rows '
     + 'in the chart-plan panel before this fix)', () => {
    const priceOnly = { id: 'a', type: 'horizontal', role: 'entry', price: 42 }
    expect(canCarryPlanRole(priceOnly)).toBe(true)
    expect(drawingLevelPrice(priceOnly)).toBe(42)
    // An anchored drawing still reads its anchor, never a stale `price` left beside it.
    expect(drawingLevelPrice(line('a', 50))).toBe(50)
    // Precedence matches the backend's exactly (price first) for the one case `withPlanRole`
    // promises never to produce on its own: both fields present at once.
    expect(drawingLevelPrice({ ...line('a', 50), price: 47 })).toBe(47)
    // No anchor and no usable price: still absent, never a thrown error or a zero.
    expect(drawingLevelPrice({ id: 'a', type: 'horizontal' })).toBe(null)
    expect(canCarryPlanRole({ id: 'a', type: 'horizontal', role: 'entry', price: -1 })).toBe(false)
  })

  it('one entry and one stop per block; targets stack as scale-outs', () => {
    expect(UNIQUE_PLAN_ROLES).toEqual(['entry', 'stop'])
    let anns = [line('a', 50), line('b', 48), line('c', 56), line('d', 60), { id: 't', type: 'text', points: [] }]
    anns = setPlanRole(anns, 'a', 'stop')
    anns = setPlanRole(anns, 'b', 'stop')            // moves: 'a' loses it
    anns = setPlanRole(anns, 'c', 'target')
    anns = setPlanRole(anns, 'd', 'target')          // stacks
    expect(anns.map((d) => d.role ?? null)).toEqual([null, 'stop', 'target', 'target', null])
    expect(setPlanRole(anns, 'nope', 'entry')).toBe(anns)
    const before = JSON.stringify(anns)
    setPlanRole(anns, 'a', 'entry')
    expect(JSON.stringify(anns)).toBe(before)          // never mutates its input
  })
})

describe('sizing — the starter formulas, evaluated, never restated', () => {
  it('evaluates the SAME expression the property editor runs (computed.evaluateFormula)', () => {
    const defs = [
      { id: 'e', name: 'Entry', type: 'number' }, { id: 's', name: 'Stop', type: 'number' },
      { id: 'x', name: 'Exit', type: 'number' }, { id: 'r', name: 'Account risk', type: 'number' },
    ]
    const ids = { Entry: '{@e}', Stop: '{@s}', Exit: '{@x}', 'Account risk': '{@r}' }
    const props = { e: 50.37, s: 48.11, x: 57.9, r: 1234 }
    for (const f of STARTER_FORMULAS.filter((g) => ['r_multiple', 'risk_per_share', 'position_size'].includes(g.id))) {
      const stored = f.expression.replace(/\{([^}]+)\}/g, (_, n) => ids[n])
      const viaEditor = evaluateFormula(stored, defs, props).value
      const viaPlan = evaluateStarter(f.id, { Entry: 50.37, Stop: 48.11, Exit: 57.9, 'Account risk': 1234 }).value
      expect(viaPlan, f.id).toBe(viaEditor)
      expect(viaPlan, f.id).not.toBe(null)
    }
  })

  it('LONG: stop under entry', () => {
    const p = sizePlan({ entry: 50, stop: 48, target: 56, accountSize: 100000, riskPct: 1 })
    expect(p).toMatchObject({ side: 'long', riskPerShare: 2, rewardToRisk: 3, accountRisk: 1000, shares: 500,
      sizedBy: 'starter', label: SIZED_BY_LABEL.starter, reason: null })
  })

  it('SHORT, and a stop ABOVE the entry is how a short reads', () => {
    expect(planSide({ entry: 50, stop: 52 })).toBe('short')
    const p = sizePlan({ entry: 50, stop: 52, target: 44, accountSize: 100000, riskPct: 1 })
    expect(p).toMatchObject({ side: 'short', riskPerShare: 2, rewardToRisk: 3, shares: 500, sizedBy: 'starter' })
  })

  it('ZERO RISK: entry equals stop sizes nothing, and says why — never Infinity or NaN', () => {
    const p = sizePlan({ entry: 50, stop: 50, target: 56, accountSize: 100000, riskPct: 1 })
    expect(p.side).toBe(null)
    expect(p.shares).toBe(null)
    expect(p.riskPerShare).toBe(0)
    expect(p.rewardToRisk).toBe(null)
    expect(p.rewardToRiskReason).toMatch(/Division by zero/)
    expect(p.reason).toMatch(/no risk/)
    expect(starterPositionSize({ entry: 50, stop: 50, accountRisk: 1000 })).toEqual({ value: null, reason: 'Division by zero' })
  })

  it('a target on the wrong side reads a NEGATIVE R:R — the truth about that plan', () => {
    expect(rewardToRisk({ entry: 50, stop: 48, target: 46 }).value).toBe(-2)
  })

  it('rounds shares with the formula\'s own round() (half away from zero)', () => {
    expect(sizePlan({ entry: 50, stop: 47, accountSize: 100000, riskPct: 1 }).shares).toBe(333)    // 333.33
    expect(sizePlan({ entry: 50, stop: 49.2, accountSize: 1000, riskPct: 1 }).shares).toBe(13)     // 12.5 -> 13
  })

  it('missing pieces: no stop, no account size, no risk % — a reason, never a guess', () => {
    expect(sizePlan({ entry: 50 }).reason).toMatch(/Draw an entry and a stop/)
    expect(sizePlan({ entry: 50, stop: 48, riskPct: 1 }).reason).toBe('No account size is set')
    expect(sizePlan({ entry: 50, stop: 48, accountSize: 1e5 }).reason).toBe('No max risk per trade is set')
    expect(sizePlan({ entry: 50, stop: 48, accountSize: 1e5, riskPct: 1 }).rewardToRiskReason).toBe('No target is drawn')
    expect(accountRiskDollars({ accountSize: 0, riskPct: 1 }).value).toBe(null)
    expect(riskPerShare({ entry: 50 }).value).toBe(null)
  })

  it('COMPASS sizes a long when it answered, and the label says so', () => {
    const p = sizePlan({ entry: 50, stop: 48, accountSize: 1e5, riskPct: 1, compass: { ok: true, shares: 420.7 } })
    expect(p).toMatchObject({ shares: 420, sizedBy: 'compass', label: SIZED_BY_LABEL.compass })
    // its "do not size" (0 shares) is an answer, not a failure
    expect(sizePlan({ entry: 50, stop: 48, accountSize: 1e5, riskPct: 1, compass: { ok: true, shares: 0 } }).shares).toBe(0)
  })

  it('falls back to the starter when Compass cannot answer, and never asks it about a short', () => {
    for (const compass of [null, { ok: false, error: 'brain not available' }, { ok: true }, { ok: true, shares: -3 }]) {
      expect(sizePlan({ entry: 50, stop: 48, accountSize: 1e5, riskPct: 1, compass }).sizedBy).toBe('starter')
    }
    const short = sizePlan({ entry: 50, stop: 52, accountSize: 1e5, riskPct: 1, compass: { ok: true, shares: 999 } })
    expect(short).toMatchObject({ sizedBy: 'starter', shares: 500 })
  })

  it('every answer that sized names its engine; one that did not names neither', () => {
    const sized = sizePlan({ entry: 10, stop: 9, accountSize: 5000, riskPct: 2 })
    expect(Object.values(SIZED_BY)).toContain(sized.sizedBy)
    expect(sized.label).toBe(SIZED_BY_LABEL[sized.sizedBy])
    const unsized = sizePlan({ entry: 10, stop: 10 })
    expect([unsized.sizedBy, unsized.label]).toEqual([null, null])
  })
})

// lib/planGradeText.js: the WORDS for a plan grade, shared by the trade page's card and the
// review note. A member reads these sentences as a judgement of their own discipline, so each
// one is pinned against the grade the SERVER really sends (contract fixtures), plus the edge
// inputs a formatter has to survive.
import { describe, it, expect } from 'vitest'
import { LABEL_TEXT, TIER_TEXT, px, checkVerdict, checkDetail } from './planGradeText'
import { contractBody, contractNames } from '../__fixtures__/contract'

const planned = () => contractBody('plan-grades.trade.planned')
const placeholder = () => contractBody('plan-grades.trade.placeholder-stop')

describe('px: a price, in the precision a trader reads', () => {
  it('prints two decimals at a dollar and above, four below it', () => {
    expect(px(100)).toBe('100.00')
    expect(px(101.456)).toBe('101.46')
    expect(px(1)).toBe('1.00')
    expect(px(0.9999)).toBe('0.9999')
    expect(px(0.5)).toBe('0.5000')
  })

  it('keeps a penny stock readable instead of rounding it to 0.00', () => {
    expect(px(0.0123)).toBe('0.0123')
  })

  it('judges the precision by size, not sign', () => {
    expect(px(-3.5)).toBe('-3.50')
    expect(px(-0.25)).toBe('-0.2500')
  })

  it('prints zero as a number, because zero is a real price in a delta', () => {
    expect(px(0)).toBe('0.0000')
  })

  it('does not switch to exponent form for a very large value', () => {
    expect(px(1_000_000_000)).toBe('1000000000.00')
    expect(px(123456.789)).toBe('123456.79')
  })

  it.each([
    ['null', null], ['undefined', undefined], ['a numeric string', '100'], ['an empty string', ''],
    ['NaN', NaN], ['Infinity', Infinity], ['-Infinity', -Infinity], ['an object', {}], ['an array', [100]],
    ['a boolean', true],
  ])('shows a dash for %s, never "NaN", "undefined" or a coerced number', (_label, v) => {
    expect(px(v)).toBe('—')
  })
})

describe('checkVerdict: the one word and its tone', () => {
  it('words the four checks of the grade the server really sends', () => {
    const { checks } = planned()
    expect(checkVerdict('entry', checks.entry)).toEqual({ word: 'Kept', tone: 'good' })
    expect(checkVerdict('stop', checks.stop)).toEqual({ word: 'Not honoured', tone: 'bad' })
    expect(checkVerdict('size', checks.size)).toEqual({ word: 'Oversized', tone: 'bad' })
    // The best price reached is computed overnight: until then the server says `unknown`,
    // and the card shows a dash, never "Not reached".
    expect(checks.target.state).toBe('unknown')
    expect(checkVerdict('target', checks.target)).toEqual({ word: '—', tone: 'muted' })
  })

  it('words a stop that was honoured', () => {
    expect(checkVerdict('stop', placeholder().checks.stop)).toEqual({ word: 'Honoured', tone: 'good' })
  })

  it('tells oversized from undersized by the sign of the server fraction', () => {
    expect(checkVerdict('size', { state: 'missed', deltaPct: 0.5 })).toEqual({ word: 'Oversized', tone: 'bad' })
    expect(checkVerdict('size', { state: 'missed', deltaPct: -0.5 })).toEqual({ word: 'Undersized', tone: 'bad' })
    expect(checkVerdict('size', { state: 'kept', deltaPct: 0.02 })).toEqual({ word: 'Kept', tone: 'good' })
  })

  it('does not call a missed size "Oversized" when the delta is missing or zero', () => {
    expect(checkVerdict('size', { state: 'missed' }).word).toBe('Undersized')
    expect(checkVerdict('size', { state: 'missed', deltaPct: 0 }).word).toBe('Undersized')
  })

  it('words every target state', () => {
    expect(checkVerdict('target', { state: 'hit' })).toEqual({ word: 'Hit', tone: 'good' })
    expect(checkVerdict('target', { state: 'reached_not_taken' })).toEqual({ word: 'Reached, not taken', tone: 'warn' })
    expect(checkVerdict('target', { state: 'not_reached' })).toEqual({ word: 'Not reached', tone: 'muted' })
  })

  it('never invents a verdict for a check that was not graded', () => {
    for (const key of ['entry', 'stop', 'size', 'target']) {
      expect(checkVerdict(key, { state: 'none' })).toEqual({ word: '—', tone: 'muted' })
      expect(checkVerdict(key, {})).toEqual({ word: '—', tone: 'muted' })
      expect(checkVerdict(key, null)).toEqual({ word: '—', tone: 'muted' })
      expect(checkVerdict(key, undefined)).toEqual({ word: '—', tone: 'muted' })
    }
  })

  it('says a plan with two readings is unreadable, for every check', () => {
    for (const key of ['entry', 'stop', 'size', 'target']) {
      expect(checkVerdict(key, { state: 'unreadable' })).toEqual({ word: 'Unreadable', tone: 'warn' })
    }
  })

  it('reads "missed" as Missed for the entry, never as a pass', () => {
    expect(checkVerdict('entry', { state: 'missed' })).toEqual({ word: 'Missed', tone: 'bad' })
  })
})

describe('checkDetail: planned against actual, in the member\'s units', () => {
  it('writes the four lines of the grade the server really sends', () => {
    const { checks, plan } = planned()
    expect(checkDetail('entry', checks.entry, plan)).toBe('Planned 100.00 · filled 100.50 (+0.13R)')
    expect(checkDetail('stop', checks.stop, plan)).toBe('Stop 96.00 · exit 94.50 · line 95.00')
    expect(checkDetail('size', checks.size, plan)).toBe('Planned 100 · entered 150 (+50.0%)')
    expect(checkDetail('target', checks.target, plan))
      .toBe('Target 120.00 · the best price reached is computed overnight.')
  })

  it('reads the size delta as a FRACTION: 0.5 is fifty percent, not half a percent', () => {
    expect(planned().checks.size.deltaPct).toBe(0.5)
    expect(checkDetail('size', { state: 'missed', planned: 100, actual: 150, deltaPct: 0.5 })).toContain('(+50.0%)')
    expect(checkDetail('size', { state: 'missed', planned: 100, actual: 50, deltaPct: -0.5 })).toContain('(-50.0%)')
    expect(checkDetail('size', { state: 'kept', planned: 100, actual: 100, deltaPct: 0 })).toContain('(0.0%)')
  })

  it('a broker trade with a placeholder stop is graded on the plan\'s stop, and says so', () => {
    const g = placeholder()
    // The stored stop equalled the entry (200 / 200). The server graded against the plan's 192.
    expect(g.labels).toContain('stop_from_plan')
    expect(g.checks.stop.planned).toBe(192)
    expect(checkDetail('stop', g.checks.stop, g.plan)).toBe('Stop 192.00 · exit 210.00 · line 190.00')
    expect(LABEL_TEXT.stop_from_plan).toBe('Your broker sent no stop, so the stop is your plan’s')
    // Filled exactly on the plan: zero R of chase, printed as zero, with no sign.
    expect(checkDetail('entry', g.checks.entry, g.plan)).toBe('Planned 200.00 · filled 200.00 (0.00R)')
    // Twice the planned size: the fraction 1.0 is one hundred percent.
    expect(checkDetail('size', g.checks.size, g.plan)).toBe('Planned 50 · entered 100 (+100.0%)')
  })

  it('signs a chase the right way round', () => {
    expect(checkDetail('entry', { state: 'missed', planned: 100, actual: 102, chaseR: 0.5 })).toContain('(+0.50R)')
    expect(checkDetail('entry', { state: 'kept', planned: 100, actual: 99.5, chaseR: -0.125 })).toContain('(-0.13R)')
  })

  it('prints fractional shares without inventing precision for whole ones', () => {
    expect(checkDetail('size', { state: 'kept', planned: 0.5, actual: 0.75, deltaPct: 0.5 }))
      .toBe('Planned 0.50 · entered 0.75 (+50.0%)')
    expect(checkDetail('size', { state: 'kept', planned: 100, actual: 100, deltaPct: 0 }))
      .toBe('Planned 100 · entered 100 (0.0%)')
  })

  it('adds the best price only when the server has computed it', () => {
    expect(checkDetail('target', { state: 'hit', planned: 120, exit: 121, mfePrice: 123.4 }))
      .toBe('Target 120.00 · exit 121.00 · best 123.40')
    expect(checkDetail('target', { state: 'not_reached', planned: 120, exit: 110, mfePrice: null }))
      .toBe('Target 120.00 · exit 110.00')
    expect(checkDetail('target', { state: 'not_reached', planned: 120, exit: 110 }))
      .toBe('Target 120.00 · exit 110.00')
  })

  it('a best price of zero is still a price', () => {
    expect(checkDetail('target', { state: 'not_reached', planned: 1, exit: 0.5, mfePrice: 0 }))
      .toBe('Target 1.00 · exit 0.5000 · best 0.0000')
  })

  it('explains a check that was not graded instead of printing empty numbers', () => {
    expect(checkDetail('entry', { state: 'none' })).toBe('No planned entry with a stop.')
    expect(checkDetail('stop', { state: 'none' })).toBe('No planned stop with a stop.')
    expect(checkDetail('size', { state: 'none' })).toBe('No planned shares.')
    expect(checkDetail('target', { state: 'none' })).toBe('No planned target.')
    expect(checkDetail('entry', null)).toBe('No planned entry with a stop.')
    expect(checkDetail('size', undefined)).toBe('No planned shares.')
  })

  it('says the plan points the other way when the server says so', () => {
    expect(checkDetail('stop', { state: 'none', reason: 'side_mismatch' })).toBe('Not graded: the plan points the other way.')
    expect(checkDetail('target', { state: 'none', reason: 'side_mismatch' })).toBe('Not graded: the plan points the other way.')
  })

  it('names what a plan gave two of', () => {
    expect(checkDetail('entry', { state: 'unreadable' })).toBe('Your plan names more than one entry.')
    expect(checkDetail('stop', { state: 'unreadable' })).toBe('Your plan names more than one stop.')
    expect(checkDetail('size', { state: 'unreadable' })).toBe('Your plan names more than one share count.')
    expect(checkDetail('target', { state: 'unreadable' })).toBe('Your plan names more than one target.')
  })

  it('never prints "undefined" or "NaN" when a graded check is missing a number', () => {
    for (const [key, c] of [
      ['entry', { state: 'kept' }], ['stop', { state: 'missed' }], ['size', { state: 'missed' }],
      ['target', { state: 'hit' }], ['target', { state: 'unknown' }],
    ]) {
      const text = checkDetail(key, c)
      expect(text).not.toMatch(/undefined|NaN|null/)
      expect(text).toContain('—')
    }
  })
})

describe('the vocabulary covers what the server sends', () => {
  const grades = () => contractNames()
    .filter((n) => n.startsWith('plan-grades.trade.') || n.startsWith('plan-grades.relink.'))
    .map((n) => contractBody(n))
    .filter((b) => b && typeof b === 'object' && 'status' in b)

  it('has a sentence for every label on every recorded grade', () => {
    const seen = new Set(grades().flatMap((g) => g.labels || []))
    expect(seen.size).toBeGreaterThan(0)                       // non-vacuity: the fixtures carry labels
    for (const label of seen) expect(LABEL_TEXT[label], `no sentence for the label "${label}"`).toBeTruthy()
  })

  it('has words for every match tier on every recorded grade and candidate', () => {
    const tiers = new Set()
    for (const g of grades()) {
      if (g.plan?.matchTier) tiers.add(g.plan.matchTier)
      for (const c of g.candidates || []) if (c.tier) tiers.add(c.tier)
    }
    expect(tiers.size).toBeGreaterThan(1)                      // window and member, at least
    for (const tier of tiers) expect(TIER_TEXT[tier], `no words for the tier "${tier}"`).toBeTruthy()
  })

  it('every label sentence is a full, distinct sentence', () => {
    const texts = Object.values(LABEL_TEXT)
    expect(new Set(texts).size).toBe(texts.length)
    for (const t of texts) expect(t.length).toBeGreaterThan(15)
    expect(Object.keys(LABEL_TEXT).sort()).toEqual(
      ['date_only', 'edited_after_entry', 'side_mismatch', 'size_from_closes', 'stop_from_plan'])
    expect(Object.keys(TIER_TEXT).sort()).toEqual(['explicit', 'member', 'verdict', 'window'])
  })
})

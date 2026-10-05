import { describe, it, expect } from 'vitest'
import { normalizeDock, DEFAULT_RIGHT_W } from './chartDock'
import {
  EARNINGS_STRIP, COMPANY_INFO, chartFeaturesOf, addFeature, removeFeature, setFeatureOpen,
} from './chartFeatures'

const byId = (dock) => Object.fromEntries(chartFeaturesOf(dock).map(f => [f.id, f]))

describe('normalizeDock — Company Info added vs expanded', () => {
  it('a panel open today stays added and expanded', () => {
    const d = normalizeDock({ open: true })
    expect(d.company).toBe(true)
    expect(d.open).toBe(true)
  })

  it('a panel closed today starts as not added', () => {
    expect(normalizeDock({ open: false }).company).toBe(false)
    expect(normalizeDock({}).company).toBe(false)
    expect(normalizeDock(null).company).toBe(false)
  })

  it('an added, collapsed panel stays added and collapsed', () => {
    const d = normalizeDock({ company: true, open: false })
    expect(d.company).toBe(true)
    expect(d.open).toBe(false)
  })

  it('an explicit removal wins over a stale open flag', () => {
    expect(normalizeDock({ company: false, open: true }).company).toBe(false)
  })

  it('the legacy right: shape keeps migrating, now to added + expanded', () => {
    const news = normalizeDock({ right: 'news' })
    expect(news).toMatchObject({ company: true, open: true, tab: 'news' })
    const profile = normalizeDock({ right: 'profile' })
    expect(profile).toMatchObject({ company: true, open: true, tab: 'overview' })
  })

  it('leaves the strip fields exactly as they were', () => {
    expect(normalizeDock({ strip: true, stripH: 118 })).toMatchObject({ strip: true, stripH: 118 })
  })
})

describe('chartFeatures — descriptors', () => {
  it('describes exactly the two Research features, both singletons', () => {
    const f = chartFeaturesOf(normalizeDock({}))
    expect(f.map(x => x.id)).toEqual([EARNINGS_STRIP, COMPANY_INFO])
    expect(f.every(x => x.singleton)).toBe(true)
    expect(f.map(x => x.place)).toEqual(['Below the chart', 'Side panel'])
  })

  it('reads enabled / open from the dock', () => {
    const f = byId(normalizeDock({ strip: true, company: true, open: false }))
    expect(f[EARNINGS_STRIP].enabled).toBe(true)
    expect(f[COMPANY_INFO]).toMatchObject({ enabled: true, open: false })
  })
})

describe('chartFeatures — Earnings Strip lifecycle', () => {
  it('add turns the strip on', () => {
    expect(addFeature(normalizeDock({}), EARNINGS_STRIP).strip).toBe(true)
  })

  it('a duplicate add is refused (same object, nothing to persist)', () => {
    const d = normalizeDock({ strip: true })
    expect(addFeature(d, EARNINGS_STRIP)).toBe(d)
  })

  it('remove turns it off and keeps the dragged height', () => {
    const d = removeFeature(normalizeDock({ strip: true, stripH: 140 }), EARNINGS_STRIP)
    expect(d.strip).toBe(false)
    expect(d.stripH).toBe(140)
  })

  it('has no open state to set', () => {
    const d = normalizeDock({ strip: true })
    expect(setFeatureOpen(d, EARNINGS_STRIP, false)).toBe(d)
  })
})

describe('chartFeatures — Company Info lifecycle', () => {
  it('add = added + expanded at the default width', () => {
    const d = addFeature(normalizeDock({ rightW: 520 }), COMPANY_INFO)
    expect(d).toMatchObject({ company: true, open: true, rightW: DEFAULT_RIGHT_W })
  })

  it('a duplicate add is refused and does not reset a chosen width', () => {
    const d = normalizeDock({ company: true, open: false, rightW: 520 })
    expect(addFeature(d, COMPANY_INFO)).toBe(d)
  })

  it('collapse keeps it added and keeps the width', () => {
    const d = setFeatureOpen(normalizeDock({ company: true, open: true, rightW: 520 }), COMPANY_INFO, false)
    expect(d).toMatchObject({ company: true, open: false, rightW: 520 })
  })

  it('expand keeps it added and restores the width', () => {
    const d = setFeatureOpen(normalizeDock({ company: true, open: false, rightW: 520 }), COMPANY_INFO, true)
    expect(d).toMatchObject({ company: true, open: true, rightW: 520 })
  })

  it('cannot expand a panel that is not added', () => {
    const d = normalizeDock({})
    expect(setFeatureOpen(d, COMPANY_INFO, true)).toBe(d)
  })

  it('remove differs from collapse: the feature is gone', () => {
    const base = normalizeDock({ company: true, open: true, rightW: 520 })
    const collapsed = setFeatureOpen(base, COMPANY_INFO, false)
    const removed = removeFeature(base, COMPANY_INFO)
    expect(byId(collapsed)[COMPANY_INFO].enabled).toBe(true)
    expect(byId(removed)[COMPANY_INFO].enabled).toBe(false)
    expect(removed.open).toBe(false)
  })

  it('re-adding after a remove resets to the default width', () => {
    const removed = removeFeature(normalizeDock({ company: true, open: true, rightW: 520 }), COMPANY_INFO)
    expect(addFeature(removed, COMPANY_INFO).rightW).toBe(DEFAULT_RIGHT_W)
  })

  it('a removed panel survives a reload as removed', () => {
    const removed = removeFeature(normalizeDock({ company: true, open: true }), COMPANY_INFO)
    expect(normalizeDock(JSON.parse(JSON.stringify(removed))).company).toBe(false)
  })
})

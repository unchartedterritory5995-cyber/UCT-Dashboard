import { describe, it, expect } from 'vitest'
import {
  applyFilters,
  countActiveSections,
  isEmptyFilters,
  EMPTY_FILTERS,
  filtersFromSearchParams,
  writeFiltersToSearchParams,
} from './useJ2Filters'

function t(overrides = {}) {
  return {
    id: overrides.id || Math.random().toString(),
    userId: 'u1',
    positionId: 'p',
    symbol: 'NVDA',
    side: 'Long',
    shares: 100,
    entryPrice: 500,
    entryDate: '2026-03-15T00:00:00Z',
    exitPrice: 520,
    exitDate: '2026-03-16T00:00:00Z',
    originalStop: 490,
    setup: 'VCP',
    notes: null,
    pnlDollar: 2000,
    pnlPercent: 0.04,
    rMultiple: 2.0,
    holdDays: 1,
    result: 'Win',
    createdAt: '2026-03-16T00:00:00Z',
    ...overrides,
  }
}

function emptyFilters() {
  return {
    ...EMPTY_FILTERS,
    sides: new Set(),
    setups: new Set(),
  }
}

describe('isEmptyFilters', () => {
  it('true on empty filters', () => {
    expect(isEmptyFilters(emptyFilters())).toBe(true)
  })

  it('false when any scalar is set', () => {
    const f = { ...emptyFilters(), symbol: 'nvda' }
    expect(isEmptyFilters(f)).toBe(false)
  })

  it('false when any set is non-empty', () => {
    const f = { ...emptyFilters(), sides: new Set(['Long']) }
    expect(isEmptyFilters(f)).toBe(false)
  })
})

describe('countActiveSections (spec §12.2 badge count)', () => {
  it('0 for empty', () => {
    expect(countActiveSections(emptyFilters())).toBe(0)
  })

  it('date range counts once even when both from + to set', () => {
    const f = { ...emptyFilters(), dateFrom: '2026-01-01', dateTo: '2026-06-01' }
    expect(countActiveSections(f)).toBe(1)
  })

  it('sums across independent sections', () => {
    const f = {
      ...emptyFilters(),
      symbol: 'nvda',
      sides: new Set(['Long']),
      setups: new Set(['VCP']),
    }
    expect(countActiveSections(f)).toBe(3)
  })
})

describe('applyFilters — empty filters returns all trades unchanged', () => {
  it('returns the same reference (short-circuit)', () => {
    const trades = [t(), t()]
    expect(applyFilters(trades, emptyFilters())).toBe(trades)
  })
})

describe('applyFilters — date range', () => {
  const trades = [
    t({ entryDate: '2026-01-01T00:00:00Z' }),
    t({ entryDate: '2026-04-15T00:00:00Z' }),
    t({ entryDate: '2026-07-30T00:00:00Z' }),
  ]
  it('dateFrom inclusive', () => {
    const f = { ...emptyFilters(), dateFrom: '2026-04-15' }
    expect(applyFilters(trades, f).length).toBe(2)
  })
  it('dateTo inclusive', () => {
    const f = { ...emptyFilters(), dateTo: '2026-04-15' }
    expect(applyFilters(trades, f).length).toBe(2)
  })
  it('dateFrom + dateTo (range, inclusive both ends)', () => {
    const f = { ...emptyFilters(), dateFrom: '2026-04-15', dateTo: '2026-04-15' }
    expect(applyFilters(trades, f).length).toBe(1)
  })
})

describe('applyFilters — symbol (starts-with, case-insensitive)', () => {
  const trades = [
    t({ symbol: 'NVDA' }),
    t({ symbol: 'NFLX' }),
    t({ symbol: 'TSLA' }),
  ]
  it('matches starts-with', () => {
    const f = { ...emptyFilters(), symbol: 'n' }
    const got = applyFilters(trades, f)
    expect(got.map((x) => x.symbol).sort()).toEqual(['NFLX', 'NVDA'])
  })
  it('case-insensitive', () => {
    const f = { ...emptyFilters(), symbol: 'tsla' }
    expect(applyFilters(trades, f).map((x) => x.symbol)).toEqual(['TSLA'])
  })
  it('no match returns empty', () => {
    const f = { ...emptyFilters(), symbol: 'z' }
    expect(applyFilters(trades, f)).toEqual([])
  })
})

describe('applyFilters — side (OR within group)', () => {
  const trades = [t({ side: 'Long' }), t({ side: 'Short' })]
  it('Long only', () => {
    const f = { ...emptyFilters(), sides: new Set(['Long']) }
    expect(applyFilters(trades, f).length).toBe(1)
  })
  it('both → OR → all', () => {
    const f = { ...emptyFilters(), sides: new Set(['Long', 'Short']) }
    expect(applyFilters(trades, f).length).toBe(2)
  })
})

describe('applyFilters — setup (null setup excluded)', () => {
  const trades = [
    t({ setup: 'VCP' }),
    t({ setup: 'Breakout' }),
    t({ setup: null }),
  ]
  it('selects matching setups', () => {
    const f = { ...emptyFilters(), setups: new Set(['VCP']) }
    expect(applyFilters(trades, f).length).toBe(1)
  })
  it('null setup excluded when filter set', () => {
    const f = { ...emptyFilters(), setups: new Set(['VCP', 'Breakout']) }
    expect(applyFilters(trades, f).length).toBe(2)
  })
})

describe('applyFilters — AND across sections', () => {
  const trades = [
    t({ side: 'Long', setup: 'VCP' }),
    t({ side: 'Long', setup: 'Breakout' }),
    t({ side: 'Short', setup: 'VCP' }),
  ]
  it('side=Long AND setups=VCP → 1 match', () => {
    const f = {
      ...emptyFilters(),
      sides: new Set(['Long']),
      setups: new Set(['VCP']),
    }
    expect(applyFilters(trades, f).length).toBe(1)
  })
})

describe('filtersFromSearchParams / writeFiltersToSearchParams (round-trip)', () => {
  it('empty URL → empty filters', () => {
    const sp = new URLSearchParams()
    const f = filtersFromSearchParams(sp)
    expect(isEmptyFilters(f)).toBe(true)
  })

  it('scalar round-trip', () => {
    const f = {
      ...emptyFilters(),
      dateFrom: '2026-01-01',
      dateTo: '2026-06-01',
      symbol: 'nvda',
    }
    const sp = writeFiltersToSearchParams(f, new URLSearchParams())
    const back = filtersFromSearchParams(sp)
    expect(back.dateFrom).toBe('2026-01-01')
    expect(back.dateTo).toBe('2026-06-01')
    expect(back.symbol).toBe('nvda')
  })

  it('set round-trip', () => {
    const f = {
      ...emptyFilters(),
      sides: new Set(['Long', 'Short']),
      setups: new Set(['VCP', 'Breakout']),
    }
    const sp = writeFiltersToSearchParams(f, new URLSearchParams())
    const back = filtersFromSearchParams(sp)
    expect(back.sides).toEqual(new Set(['Long', 'Short']))
    expect(back.setups).toEqual(new Set(['VCP', 'Breakout']))
  })

  it('preserves non-filter params (e.g. view=j2)', () => {
    const existing = new URLSearchParams('view=j2&other=keep')
    const f = { ...emptyFilters(), symbol: 'nvda' }
    const sp = writeFiltersToSearchParams(f, existing)
    expect(sp.get('view')).toBe('j2')
    expect(sp.get('other')).toBe('keep')
    expect(sp.get('sym')).toBe('nvda')
  })

  it('removes filter params that become empty', () => {
    const existing = new URLSearchParams('sym=nvda&sides=Long')
    const f = { ...emptyFilters() }
    const sp = writeFiltersToSearchParams(f, existing)
    expect(sp.get('sym')).toBeNull()
    expect(sp.get('sides')).toBeNull()
  })

  it('handles URL-encoded setup names with commas safely', () => {
    const f = {
      ...emptyFilters(),
      setups: new Set(['A,B', 'Plain']),
    }
    const sp = writeFiltersToSearchParams(f, new URLSearchParams())
    const back = filtersFromSearchParams(sp)
    expect(back.setups).toEqual(new Set(['A,B', 'Plain']))
  })
})

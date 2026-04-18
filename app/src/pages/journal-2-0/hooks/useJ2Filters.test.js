import { describe, it, expect } from 'vitest'
import {
  applyFilters,
  countActiveSections,
  isEmptyFilters,
  EMPTY_FILTERS,
  filtersFromSearchParams,
  writeFiltersToSearchParams,
} from './useJ2Filters'

// ── helpers ──────────────────────────────────────────────────────────────────

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
    contextAtEntry: {
      navCount: 3,
      rallyDay: 'D7',
      powerTrend: 'On',
      breadthValue: 55,
      breadthMetricName: 'NASI RSI',
      indexName: 'NYA',
      igRank: 42,
      rsRating: 85,
      ...overrides.context,
    },
    createdAt: '2026-03-16T00:00:00Z',
    ...overrides,
  }
}

function emptyFilters() {
  return {
    ...EMPTY_FILTERS,
    sides: new Set(),
    setups: new Set(),
    navBuckets: new Set(),
    powerTrends: new Set(),
  }
}

// ── isEmptyFilters + activeCount ────────────────────────────────────────────

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

  it('NASI only counts when BOTH dir and threshold are set', () => {
    let f = { ...emptyFilters(), nasiDir: 'Above' }
    expect(countActiveSections(f)).toBe(0)
    f = { ...emptyFilters(), nasiDir: 'Above', nasiThreshold: '60' }
    expect(countActiveSections(f)).toBe(1)
  })

  it('sums across independent sections', () => {
    const f = {
      ...emptyFilters(),
      symbol: 'nvda',
      sides: new Set(['Long']),
      rallyDay: 'D7',
    }
    expect(countActiveSections(f)).toBe(3)
  })
})

// ── applyFilters: each section in isolation ─────────────────────────────────

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

describe('applyFilters — RS min (null excluded)', () => {
  const trades = [
    t({ context: { rsRating: 50 } }),
    t({ context: { rsRating: 90 } }),
    t({ context: { rsRating: null } }),
  ]
  it('filters out below threshold', () => {
    const f = { ...emptyFilters(), rsMin: '80' }
    expect(applyFilters(trades, f).length).toBe(1)
  })
  it('excludes null rsRating when filter is set', () => {
    const f = { ...emptyFilters(), rsMin: '0' }
    // Threshold 0 would pass ≥0; null still excluded
    expect(applyFilters(trades, f).length).toBe(2)
  })
  it('null rsRating passes when filter not set', () => {
    expect(applyFilters(trades, emptyFilters()).length).toBe(3)
  })
})

describe('applyFilters — NASI (breadth value) Above/Below', () => {
  const trades = [
    t({ context: { breadthValue: 40 } }),
    t({ context: { breadthValue: 60 } }),
    t({ context: { breadthValue: null } }),
  ]
  it('Above', () => {
    const f = { ...emptyFilters(), nasiDir: 'Above', nasiThreshold: '50' }
    expect(applyFilters(trades, f).map((x) => x.contextAtEntry.breadthValue)).toEqual([60])
  })
  it('Below', () => {
    const f = { ...emptyFilters(), nasiDir: 'Below', nasiThreshold: '50' }
    expect(applyFilters(trades, f).map((x) => x.contextAtEntry.breadthValue)).toEqual([40])
  })
  it('null breadthValue excluded when filter set', () => {
    const f = { ...emptyFilters(), nasiDir: 'Above', nasiThreshold: '0' }
    expect(applyFilters(trades, f).length).toBe(2)
  })
  it('only Above without threshold → section inactive (all pass)', () => {
    const f = { ...emptyFilters(), nasiDir: 'Above' }
    expect(applyFilters(trades, f).length).toBe(3)
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

describe('applyFilters — nav count buckets (0-2 / 3-4 / 5+)', () => {
  const trades = [
    t({ context: { navCount: 0 } }),
    t({ context: { navCount: 2 } }),
    t({ context: { navCount: 3 } }),
    t({ context: { navCount: 4 } }),
    t({ context: { navCount: 5 } }),
    t({ context: { navCount: 10 } }),
    t({ context: { navCount: null } }),
  ]
  it('light 0-2 inclusive', () => {
    const f = { ...emptyFilters(), navBuckets: new Set(['light']) }
    expect(applyFilters(trades, f).length).toBe(2)
  })
  it('moderate 3-4 inclusive', () => {
    const f = { ...emptyFilters(), navBuckets: new Set(['moderate']) }
    expect(applyFilters(trades, f).length).toBe(2)
  })
  it('heavy 5+', () => {
    const f = { ...emptyFilters(), navBuckets: new Set(['heavy']) }
    expect(applyFilters(trades, f).length).toBe(2)
  })
  it('light + heavy (OR within group)', () => {
    const f = { ...emptyFilters(), navBuckets: new Set(['light', 'heavy']) }
    expect(applyFilters(trades, f).length).toBe(4)
  })
  it('null navCount excluded when filter set', () => {
    const f = {
      ...emptyFilters(),
      navBuckets: new Set(['light', 'moderate', 'heavy']),
    }
    expect(applyFilters(trades, f).length).toBe(6)
  })
})

describe('applyFilters — power trend', () => {
  const trades = [
    t({ context: { powerTrend: 'On' } }),
    t({ context: { powerTrend: 'Off' } }),
    t({ context: { powerTrend: null } }),
  ]
  it('On only', () => {
    const f = { ...emptyFilters(), powerTrends: new Set(['On']) }
    expect(applyFilters(trades, f).length).toBe(1)
  })
  it('null excluded when filter set', () => {
    const f = { ...emptyFilters(), powerTrends: new Set(['On', 'Off']) }
    expect(applyFilters(trades, f).length).toBe(2)
  })
})

describe('applyFilters — rally day (exact, case-insensitive)', () => {
  const trades = [
    t({ context: { rallyDay: 'D7' } }),
    t({ context: { rallyDay: 'D12' } }),
    t({ context: { rallyDay: null } }),
  ]
  it('matches exact', () => {
    const f = { ...emptyFilters(), rallyDay: 'D7' }
    expect(applyFilters(trades, f).length).toBe(1)
  })
  it('case-insensitive', () => {
    const f = { ...emptyFilters(), rallyDay: 'd7' }
    expect(applyFilters(trades, f).length).toBe(1)
  })
  it('null rallyDay excluded when set', () => {
    const f = { ...emptyFilters(), rallyDay: 'D7' }
    expect(applyFilters(trades, f).find((x) => x.contextAtEntry.rallyDay === null)).toBeUndefined()
  })
})

// ── AND across sections ─────────────────────────────────────────────────────

describe('applyFilters — AND across sections', () => {
  const trades = [
    t({ side: 'Long', setup: 'VCP', context: { rsRating: 90 } }),
    t({ side: 'Long', setup: 'Breakout', context: { rsRating: 40 } }),
    t({ side: 'Short', setup: 'VCP', context: { rsRating: 95 } }),
  ]
  it('side=Long AND rsMin=80 → 1 match', () => {
    const f = {
      ...emptyFilters(),
      sides: new Set(['Long']),
      rsMin: '80',
    }
    expect(applyFilters(trades, f).length).toBe(1)
  })
  it('side=Long AND setups=VCP → 1 match', () => {
    const f = {
      ...emptyFilters(),
      sides: new Set(['Long']),
      setups: new Set(['VCP']),
    }
    expect(applyFilters(trades, f).length).toBe(1)
  })
})

// ── Performance (spec §15.5: <100ms on 1,000 trades) ────────────────────────

describe('applyFilters — performance', () => {
  it('completes in < 50ms on 1,000 random trades with 5 active sections', () => {
    const trades = []
    for (let i = 0; i < 1000; i++) {
      trades.push(
        t({
          id: String(i),
          side: i % 2 === 0 ? 'Long' : 'Short',
          entryDate: `2026-0${(i % 9) + 1}-15T00:00:00Z`,
          context: {
            rsRating: i % 100,
            breadthValue: 30 + (i % 50),
            navCount: i % 8,
            powerTrend: i % 3 === 0 ? 'On' : i % 3 === 1 ? 'Off' : null,
            rallyDay: `D${(i % 20) + 1}`,
          },
          setup: ['VCP', 'Breakout', 'Pullback'][i % 3],
        }),
      )
    }
    const f = {
      ...emptyFilters(),
      sides: new Set(['Long']),
      rsMin: '50',
      nasiDir: 'Above',
      nasiThreshold: '40',
      navBuckets: new Set(['light', 'moderate']),
      powerTrends: new Set(['On']),
    }
    const t0 = performance.now()
    applyFilters(trades, f)
    const dt = performance.now() - t0
    expect(dt).toBeLessThan(50)
  })
})

// ── URL-state persistence ───────────────────────────────────────────────────

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
      rsMin: '80',
      nasiDir: 'Above',
      nasiThreshold: '55',
      rallyDay: 'D7',
    }
    const sp = writeFiltersToSearchParams(f, new URLSearchParams())
    const back = filtersFromSearchParams(sp)
    expect(back.dateFrom).toBe('2026-01-01')
    expect(back.dateTo).toBe('2026-06-01')
    expect(back.symbol).toBe('nvda')
    expect(back.rsMin).toBe('80')
    expect(back.nasiDir).toBe('Above')
    expect(back.nasiThreshold).toBe('55')
    expect(back.rallyDay).toBe('D7')
  })

  it('set round-trip', () => {
    const f = {
      ...emptyFilters(),
      sides: new Set(['Long', 'Short']),
      setups: new Set(['VCP', 'Breakout']),
      navBuckets: new Set(['light', 'heavy']),
      powerTrends: new Set(['On']),
    }
    const sp = writeFiltersToSearchParams(f, new URLSearchParams())
    const back = filtersFromSearchParams(sp)
    expect(back.sides).toEqual(new Set(['Long', 'Short']))
    expect(back.setups).toEqual(new Set(['VCP', 'Breakout']))
    expect(back.navBuckets).toEqual(new Set(['light', 'heavy']))
    expect(back.powerTrends).toEqual(new Set(['On']))
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

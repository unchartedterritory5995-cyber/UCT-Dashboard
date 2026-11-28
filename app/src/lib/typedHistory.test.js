// What this member opens, for the typed candidate pool (lib/typedHistory.js, zero-network plan 1.4).
import { describe, it, expect, beforeEach } from 'vitest'
import { noteOpened, historyScore, HALF_LIFE_MS, SHOWN_WEIGHT, MAX_ENTRIES, __resetTypedHistoryForTests, __flushTypedHistoryForTests } from './typedHistory'

const T0 = Date.UTC(2026, 10, 28)
beforeEach(() => { __resetTypedHistoryForTests() })

describe('typedHistory', () => {
  it('a typed open counts 1, a shown symbol a quarter; never opened is 0', () => {
    noteOpened('crbg', { nowMs: T0 })
    noteOpened('NVDA', { weight: SHOWN_WEIGHT, nowMs: T0 })
    expect(historyScore('CRBG', T0)).toBe(1)
    expect(historyScore('NVDA', T0)).toBe(0.25)
    expect(historyScore('AMZN', T0)).toBe(0)
  })

  it('a score halves every 14 days, and a new open adds to what is left', () => {
    noteOpened('CRBG', { nowMs: T0 })
    expect(historyScore('CRBG', T0 + HALF_LIFE_MS)).toBeCloseTo(0.5, 6)
    expect(historyScore('CRBG', T0 + 2 * HALF_LIFE_MS)).toBeCloseTo(0.25, 6)
    noteOpened('CRBG', { nowMs: T0 + HALF_LIFE_MS })
    expect(historyScore('CRBG', T0 + HALF_LIFE_MS)).toBeCloseTo(1.5, 6)
    // this week's name passes last month's
    noteOpened('OLD', { nowMs: T0 - 4 * HALF_LIFE_MS }); noteOpened('OLD', { nowMs: T0 - 4 * HALF_LIFE_MS })
    noteOpened('NEW', { weight: SHOWN_WEIGHT, nowMs: T0 })
    expect(historyScore('NEW', T0)).toBeGreaterThan(historyScore('OLD', T0))
  })

  it('kept in this browser across a reload', () => {
    noteOpened('CRBG', { nowMs: T0 })
    __flushTypedHistoryForTests()
    __resetTypedHistoryForTests({ cache: false })
    expect(historyScore('CRBG', T0)).toBe(1)
  })

  it("bounded: past MAX_ENTRIES the weakest OTHER name is dropped (S1, the oldest), never the one just opened", () => {
    for (let i = 0; i < MAX_ENTRIES; i++) noteOpened(`S${i}`, { nowMs: T0 + i })
    noteOpened('S0', { nowMs: T0 + MAX_ENTRIES })            // S0 is now strong
    noteOpened('NEWEST', { weight: SHOWN_WEIGHT, nowMs: T0 + MAX_ENTRIES + 1 })
    expect(historyScore('NEWEST', T0 + MAX_ENTRIES + 1)).toBeGreaterThan(0)
    expect(historyScore('S0', T0 + MAX_ENTRIES + 1)).toBeGreaterThan(1)
    expect(historyScore('S1', T0 + MAX_ENTRIES + 1)).toBe(0)
    expect(historyScore('S2', T0 + MAX_ENTRIES + 1)).toBeGreaterThan(0)
  })

  it('a broken copy reads as no history, never throws', () => {
    localStorage.setItem('uct.typedHistory', '{not json')
    __resetTypedHistoryForTests({ cache: false })
    expect(historyScore('CRBG', T0)).toBe(0)
    expect(() => noteOpened('', { nowMs: T0 })).not.toThrow()
  })
})

/**
 * V2-3 rails — honest coverage (A-10) and the era note (A-11 "Era comparability").
 *
 * ⛔ THE FAILURE THESE GUARD AGAINST IS SILENCE. Every one of them is a case where the
 * chart would render something plausible and say nothing true: a series that has not
 * started reading as flat, a reconstructed block reading as measured, a count panel
 * compared across a universe that grew 74 %.
 */
import { describe, it, expect } from 'vitest'
import {
  seriesCoverage, notRecordedRegion, reconstructedRuns, eraNote, coverageModel,
  ERA_GROWTH_THRESHOLD_PCT, RATIO_SWAP,
} from './coverage'

const D = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05']

describe('A-10 · where a series begins', () => {
  it('finds the first real reading, not the first index', () => {
    const cov = seriesCoverage(D, { a: [null, null, 3, 4, 5] }, ['a'])
    expect(cov.a.startIndex).toBe(2)
    expect(cov.a.startDate).toBe('2026-09-03')
    expect(cov.a.present).toBe(3)
    expect(cov.a.absent).toBe(2)
  })

  it('⛔ a series with NO readings is -1 — a reportable state, not index 0', () => {
    // Defaulting to 0 would claim the series starts at the window's left edge and is
    // merely flat, which is the exact lie A-10 names.
    const cov = seriesCoverage(D, { a: [null, null, null, null, null] }, ['a'])
    expect(cov.a.startIndex).toBe(-1)
    expect(cov.a.startDate).toBeNull()
  })

  it('a full series has no "not recorded" region — no zero-width band', () => {
    const cov = seriesCoverage(D, { a: [1, 2, 3, 4, 5] }, ['a'])
    expect(notRecordedRegion(D, cov.a)).toBeNull()
  })

  it('a late-starting series gets a region ending the session BEFORE its first reading', () => {
    const cov = seriesCoverage(D, { a: [null, null, 3, 4, 5] }, ['a'])
    const r = notRecordedRegion(D, cov.a)
    expect(r).toEqual({ fromIndex: 0, toIndex: 1, from: '2026-09-01', to: '2026-09-02' })
  })

  it('a series with no readings at all gets no region either', () => {
    const cov = seriesCoverage(D, { a: [null, null, null, null, null] }, ['a'])
    expect(notRecordedRegion(D, cov.a)).toBeNull()
  })
})

describe('A-10 · reconstructed sessions are RUNS, not a count', () => {
  it('groups contiguous reconstructed sessions', () => {
    const runs = reconstructedRuns(D, ['2026-09-01', '2026-09-02', '2026-09-04'])
    expect(runs).toEqual([
      { fromIndex: 0, toIndex: 1, from: '2026-09-01', to: '2026-09-02' },
      { fromIndex: 3, toIndex: 3, from: '2026-09-04', to: '2026-09-04' },
    ])
  })

  it('closes a run that reaches the end of the window', () => {
    const runs = reconstructedRuns(D, ['2026-09-04', '2026-09-05'])
    expect(runs).toEqual([{ fromIndex: 3, toIndex: 4, from: '2026-09-04', to: '2026-09-05' }])
  })

  it('nothing reconstructed ⇒ no runs', () => {
    expect(reconstructedRuns(D, [])).toEqual([])
    expect(reconstructedRuns(D, undefined)).toEqual([])
  })
})

describe('A-11 · the era note', () => {
  it('⛔ does NOT fire at or below the threshold', () => {
    const flat = [1000, 1050, 1100, 1150, 1199]     // +19.9 %
    expect(eraNote(flat)).toBeNull()
  })

  it('fires above it, with the WINDOW\'S OWN numbers', () => {
    const grew = [1521, 1800, 2100, 2400, 2648]     // +74.1 %
    const n = eraNote(grew)
    expect(n).not.toBeNull()
    expect(n.from).toBe(1521)
    expect(n.to).toBe(2648)
    expect(n.growthPct).toBeGreaterThan(ERA_GROWTH_THRESHOLD_PCT)
    // ⛔ The audit's illustrative pair must be COMPUTED, not pasted.
    expect(n.text).toContain('1,521')
    expect(n.text).toContain('2,648')
    expect(n.text).toContain('% versions compare across years')
  })

  it('⭐ the numbers track the DATA, so a different window says something different', () => {
    const other = eraNote([800, 2000])
    expect(other.text).toContain('800')
    expect(other.text).toContain('2,000')
    expect(other.text).not.toContain('1,521')
  })

  it('offers the ratio swap only when the panel holds a metric that HAS one', () => {
    const grew = [1000, 3000]
    expect(eraNote(grew, ['new_52w_highs']).swap)
      .toEqual({ from: 'new_52w_highs', to: RATIO_SWAP.new_52w_highs })
    expect(eraNote(grew, ['adv_decline']).swap).toBeNull()
  })

  it('⛔ without `universe_count` it returns NULL rather than guessing', () => {
    // /series caps at 8 keys, so the note genuinely cannot be computed if it was not
    // requested. A note that quietly stops appearing is worse than no note.
    expect(eraNote(undefined)).toBeNull()
    expect(eraNote([])).toBeNull()
    expect(eraNote([1500])).toBeNull()          // one point is not an end-to-end change
  })

  it('a SHRINKING universe past the threshold also fires', () => {
    // The audit says "changes by more than 20 %", not "grows".
    expect(eraNote([3000, 1000])).not.toBeNull()
  })
})

describe('⛔⛔ coverageModel returns NULL when there is nothing honest to say', () => {
  it('full series, nothing reconstructed, flat universe ⇒ null', () => {
    const m = coverageModel({
      dates: D,
      valuesByKey: { a: [1, 2, 3, 4, 5], universe_count: [1000, 1001, 1002, 1003, 1004] },
      keys: ['a'],
      reconstructed: [],
      panels: [{ unit: 'count', keys: ['a'] }],
    })
    expect(m, 'V2-3 must be able to render EXACTLY what V2-2 renders').toBeNull()
  })

  it('no dates or no keys ⇒ null', () => {
    expect(coverageModel({ dates: [], valuesByKey: {}, keys: ['a'] })).toBeNull()
    expect(coverageModel({ dates: D, valuesByKey: {}, keys: [] })).toBeNull()
  })

  it('⭐ CONTROL — it is not ALWAYS null, or the rail above is vacuous', () => {
    const m = coverageModel({
      dates: D,
      valuesByKey: { a: [null, null, 3, 4, 5] },
      keys: ['a'],
      reconstructed: ['2026-09-01'],
      panels: [],
    })
    expect(m).not.toBeNull()
    expect(m.regions.a).toBeTruthy()
    expect(m.runs.length).toBe(1)
  })

  it('any ONE of the three signals is enough to produce a model', () => {
    const base = { dates: D, keys: ['a'], panels: [{ unit: 'count', keys: ['a'] }] }
    const lateStart = coverageModel({
      ...base, valuesByKey: { a: [null, 2, 3, 4, 5] }, reconstructed: [],
    })
    const recon = coverageModel({
      ...base, valuesByKey: { a: [1, 2, 3, 4, 5] }, reconstructed: ['2026-09-02'],
    })
    const era = coverageModel({
      ...base,
      valuesByKey: { a: [1, 2, 3, 4, 5], universe_count: [1000, 1500, 2000, 2500, 3000] },
      reconstructed: [],
    })
    expect(lateStart).not.toBeNull()
    expect(recon).not.toBeNull()
    expect(era?.era).not.toBeNull()
  })
})

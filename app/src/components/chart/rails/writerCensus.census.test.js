// P0 rail — SINGLE-WRITER CENSUS RATCHET (chart-data consolidation program).
//
// The target architecture (ARCH-PLAN P2/P3) is ONE BarStore that owns every bar cache and
// ONE renderer that paints its snapshot. Today the chart has several developing-bar writers
// (A/B/C/D/E/F), several bar caches (mem LRU, IDB, SWR, prefetch, packs) and a family of
// rollout-percentage gates frozen at 0/100. This census counts them, in CODE only, per file:
//
//   setData / seriesUpdate / candleWrites — series write call sites
//   liveRefAssign                          — writes to liveBarRef / lastBarRef (live-writer state)
//   barCacheImports / swrCaches / idbOpen  — independent bar-cache usages
//   pctConstants                           — `const *_PCT = 0|100` rollout gates
//
// against `writerCensus.baseline.json`. SHRINK-ONLY:
//   * a count above its baseline FAILS (a new writer / cache / gate needs a design decision,
//     not a quiet addition — route it through the BarStore instead);
//   * a count below its baseline also fails until you LOWER the baseline in the same change,
//     so the ratchet tightens and cannot silently regrow to the old number.
// Edit the baseline by hand (or run with RAILS_WRITE_BASELINE=1 ONLY after a reduction, and
// review the diff: every line must go down).
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { writerCensus, rolloutPctConstants, diffMultisets, WRITER_METRICS } from './railScan'
import { REPO_ROOT } from './railSupport'

const BASELINE_REL = 'app/src/components/chart/rails/writerCensus.baseline.json'
const BASELINE_PATH = path.join(REPO_ROOT, BASELINE_REL)

const now = writerCensus()
const pct = rolloutPctConstants()
const totals = Object.fromEntries(Object.keys(WRITER_METRICS).map((k) =>
  [k, Object.values(now).reduce((a, r) => a + (r[k] || 0), 0)]))

if (process.env.RAILS_WRITE_BASELINE === '1') {
  fs.writeFileSync(BASELINE_PATH, JSON.stringify({
    '//': [
      'P0 single-writer census ratchet. SHRINK-ONLY: lower a count (or delete a row) when the BarStore',
      'refactor removes a writer / cache / gate; never raise one. See writerCensus.census.test.js.',
    ],
    totals, files: now, pctConstants: pct,
  }, null, 2) + '\n')
}
const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'))

describe('single-writer census (shrink-only ratchet)', () => {
  it('sees the known writers (the scan is not blind)', () => {
    const sc = now['components/StockChart.jsx']
    expect(sc, 'StockChart.jsx must be in the census').toBeTruthy()
    expect(sc.candleWrites).toBeGreaterThan(5)
    expect(sc.setData).toBeGreaterThan(5)
    expect(sc.liveRefAssign).toBeGreaterThan(0)
    expect(now['utils/barsIDB.js']?.idbOpen).toBe(1)
  })

  it('no series writer, live-writer region, or bar cache was ADDED', () => {
    const { grew } = diffMultisets(now, baseline.files)
    expect(grew, 'new bar writer / cache sites — route them through the BarStore, do not add another:').toEqual([])
  })

  it('a removed site is taken off the baseline in the same change (the ratchet tightens)', () => {
    const { shrank } = diffMultisets(now, baseline.files)
    expect(shrank, `lower these counts in ${BASELINE_REL}:`).toEqual([])
  })

  it('totals match the per-file rows', () => {
    expect(baseline.totals).toEqual(Object.fromEntries(Object.keys(WRITER_METRICS).map((k) =>
      [k, Object.values(baseline.files).reduce((a, r) => a + (r[k] || 0), 0)])))
    expect(totals).toEqual(baseline.totals)
  })

  it('no NEW rollout-percentage gate (`const *_PCT = 0|100`); removed ones leave the list', () => {
    const added = pct.filter((x) => !baseline.pctConstants.includes(x))
    const gone = baseline.pctConstants.filter((x) => !pct.includes(x))
    expect(added, 'new rollout PCT gate — owner policy is ship ON, no new dark flags').toEqual([])
    expect(gone, `remove these from pctConstants in ${BASELINE_REL}`).toEqual([])
  })
})

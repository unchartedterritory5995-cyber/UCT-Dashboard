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
// against `writerCensus.baseline.json`. ONE-DIRECTIONAL RATCHET:
//   * a count above its baseline FAILS (a new writer / cache / gate needs a design decision,
//     not a quiet addition — route it through the BarStore instead);
//   * a count below its baseline PASSES and prints a reminder to lower the baseline, so
//     parallel cleanup PRs (BarStore P3) are never blocked. Lower it soon after: until you
//     do, that slack is room for a writer to regrow unnoticed.
// How to update: see ./README.md.
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
      'P0 single-writer census ratchet. Growth FAILS; a drop passes with a reminder. Lower a count (or delete',
      'a row) when a writer / cache / gate is removed; never raise one. How to update: rails/README.md.',
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

  it('a removed site passes, with a reminder to lower the baseline', () => {
    const { shrank } = diffMultisets(now, baseline.files)
    if (shrank.length) console.warn(`[rails] writer census went DOWN — lower ${BASELINE_REL} (see rails/README.md):`, shrank)
    expect(Array.isArray(shrank)).toBe(true)
  })

  it('baseline totals match its per-file rows, and no total grew', () => {
    expect(baseline.totals).toEqual(Object.fromEntries(Object.keys(WRITER_METRICS).map((k) =>
      [k, Object.values(baseline.files).reduce((a, r) => a + (r[k] || 0), 0)])))
    const grewTotals = Object.keys(totals).filter((k) => totals[k] > (baseline.totals[k] || 0))
    expect(grewTotals, 'these totals grew past the baseline').toEqual([])
  })

  it('no NEW rollout-percentage gate (`const *_PCT = 0|100`); a removed one only warns', () => {
    const added = pct.filter((x) => !baseline.pctConstants.includes(x))
    const gone = baseline.pctConstants.filter((x) => !pct.includes(x))
    expect(added, 'new rollout PCT gate — owner policy is ship ON, no new dark flags').toEqual([])
    if (gone.length) console.warn(`[rails] rollout gates removed — delete from pctConstants in ${BASELINE_REL}: ${gone.join(', ')}`)
  })
})

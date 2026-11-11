// P0 rail — ONE CACHE KEY / ONE BARS URL BUILDER / ONE FRESHNESS CONTRACT.
//
// DURABILITY RULES: one owner per concern. Today a bar cache key is spelled inline as
// `${sym}_${tf}` at dozens of sites, `/api/bars/…` URLs are templated by hand in many
// files, and freshness is judged by several classifiers. P1/P2 move each concern to one
// owner (server-issued cache key, BarStore URL builder, one freshness contract in
// utils/marketSession.js). Until then THIS LIST CAN ONLY SHRINK:
//
//   keyBuilders — template pieces `${sym…}_${tf…}` / `${sym…}:${tf…}` (inline bar keys)
//   barsUrls    — literals that start an `/api/bars/` or `/api/bars-history/` URL
//   freshness   — definitions of functions whose name judges bar freshness / staleness
//                 (bar-data scope: StockChart, components/chart, utils, lib, hooks, pages/charts)
//
// Every current site is allowlisted in `oneKey.baseline.json` as {file: {snippet: {n, at}}}
// (`at` = file:line of the first occurrence, informational — matching is by file + exact
// snippet so unrelated edits that shift line numbers never trip the rail). A NEW site fails;
// a removed one must be deleted from the baseline in the same change.
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { oneKeyCensus, diffMultisets, lineOf } from './railScan'
import { REPO_ROOT } from './railSupport'

const BASELINE_REL = 'app/src/components/chart/rails/oneKey.baseline.json'
const BASELINE_PATH = path.join(REPO_ROOT, BASELINE_REL)
const now = oneKeyCensus()

const OWNERS = {
  keyBuilders: 'utils/barsMemCache.js + utils/barsIDB.js (cacheKey) -> P1: server-issued key',
  barsUrls: 'utils/prefetchBars.js (_url) -> P2: BarStore',
  freshness: 'utils/marketSession.js',
}

if (process.env.RAILS_WRITE_BASELINE === '1') {
  const withAt = (cat) => Object.fromEntries(Object.entries(now[cat]).map(([f, items]) =>
    [f, Object.fromEntries(Object.entries(items).map(([k, n]) => [k, { n, at: `${f}:${lineOf(f, k)}` }]))]))
  fs.writeFileSync(BASELINE_PATH, JSON.stringify({
    '//': [
      'P0 one-key / one-url / one-freshness allowlist. SHRINK-ONLY: delete an entry (or lower n) when a',
      'site moves onto its owning module; never add one. `at` is informational. See oneKey.census.test.js.',
    ],
    owners: OWNERS,
    keyBuilders: withAt('keyBuilders'), barsUrls: withAt('barsUrls'), freshness: withAt('freshness'),
  }, null, 2) + '\n')
}
const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'))

describe('one key / one url / one freshness (shrink-only allowlists)', () => {
  it('the scan sees the owning modules (it is not blind)', () => {
    expect(now.keyBuilders['utils/barsMemCache.js']).toBeTruthy()
    expect(now.barsUrls['utils/prefetchBars.js']).toBeTruthy()
    expect(Object.keys(now.freshness['utils/marketSession.js'] || {})).toContain('classifyIntradayTail')
  })

  for (const cat of ['keyBuilders', 'barsUrls', 'freshness']) {
    it(`${cat}: no NEW site outside the allowlist (owner: ${OWNERS[cat]})`, () => {
      const { grew } = diffMultisets(now[cat], baseline[cat])
      expect(grew, `new ${cat} site(s) — use the owning module (${OWNERS[cat]}) instead:`).toEqual([])
    })
    it(`${cat}: a removed site leaves the allowlist in the same change`, () => {
      const { shrank } = diffMultisets(now[cat], baseline[cat])
      expect(shrank, `delete / lower these in ${BASELINE_REL}:`).toEqual([])
    })
  }
})

import { describe, it, expect } from 'vitest'
import path from 'node:path'
import baseline from './swallowedFetch.baseline.json'
import fs from 'node:fs'
import os from 'node:os'
import { stripComments } from '../components/chart/engine/__tests__/sourceScan'

// TERM-033 (FB-A8-02) — the census of the idiom that told a member NVDA had "no recent
// news" while the endpoint was returning 15 KB of it (2026-08-23):
//
//     fetch(u).then(...).catch(() => null)
//
// A swallowed failure becomes the same `null` as a genuinely empty answer, and the UI
// then states the emptiness as a fact. `components/research/sections/sectionFetch.js`
// is the fix for one directory; this census is the rail for the rest of `app/src`.
// Counted in CODE only (comments stripped), per file, against a shrink-only baseline:
// `swallowedFetch.baseline.json`.
//
// ⛔ WHAT THE WALK SKIPS, AND WHY: test files (`*.test.*`, anything under `__tests__/`) and,
// since 2026-11-17, any directory named `testing/`. `app/src/testing/` is the repo's test
// infrastructure (harnesses, dev-only rigs; `components/screener/reachable.test.js` TEST_INFRA
// names it) and no member reads anything it says, so a swallowed read there cannot tell a
// member that an empty answer is a fact. The first `testing/` site this walk saw was the dev-only
// browser acceptance rig (`testing/agent/acceptance/lib.mjs`, "never bundled (nothing imports it)").
// A file merely NAMED like it (`pages/testingTools.js`) is still counted; the control below holds both.
const SKIP_DIRS = new Set(['node_modules', 'testing'])

const SWALLOW_RE = /\.catch\(\s*\(\s*\)\s*=>\s*(?:null|undefined)\s*\)/g

function countIn(src) {
  return (stripComments(src).match(SWALLOW_RE) || []).length
}

function census(root, stats = {}) {
  const out = {}
  stats.scanned = 0
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue
      if (e.isDirectory() && SKIP_DIRS.has(e.name)) continue
      const p = path.join(dir, e.name)
      if (e.isDirectory()) { walk(p); continue }
      if (!/\.(jsx?|mjs)$/.test(e.name) || /\.test\.(jsx?|mjs)$/.test(e.name)) continue
      if (/__tests__/.test(p)) continue
      stats.scanned += 1
      const n = countIn(fs.readFileSync(p, 'utf8'))
      if (n) out[path.relative(root, p).split(path.sep).join('/')] = n
    }
  }
  walk(root)
  return out
}

const SRC = path.resolve(__dirname, '..')

describe('TERM-033: `.catch(() => null)` is a shrink-only census', () => {
  const stats = {}
  const now = census(SRC, stats)

  // ⭐ The population control used to be "more than 20 FILES carry a site". The drain
  // (lane f-l7, 37 -> 2) made that unsatisfiable by succeeding, so the control now asks
  // what it always meant: did the walk actually read app/src (a broken walk reads nothing
  // and passes everything), and does it still SEE the sites it keeps?
  it('the scan sees the population (a broken walk would pass everything)', () => {
    expect(stats.scanned, 'source files read by the walk').toBeGreaterThan(1000)
    for (const f of Object.keys(baseline.files)) {
      expect(now[f] || 0, `${f} is on the baseline; the walk must see its sites`).toBeGreaterThan(0)
    }
  })

  it('no file gains a site, and no new file adopts the idiom', () => {
    const grew = Object.entries(now)
      .filter(([f, n]) => n > (baseline.files[f] || 0))
      .map(([f, n]) => `${f}: ${baseline.files[f] || 0} -> ${n}`)
    expect(grew, 'use sectionFetcher (throws on failure) instead of swallowing it').toEqual([])
  })

  it('a migrated site is taken off the baseline in the same change (it cannot be re-added silently)', () => {
    const stale = Object.entries(baseline.files)
      .filter(([f, n]) => (now[f] || 0) < n)
      .map(([f, n]) => `${f}: baseline ${n}, now ${now[f] || 0}`)
    expect(stale, 'lower these counts in swallowedFetch.baseline.json').toEqual([])
  })

  it('the stated total is the sum of the per-file counts', () => {
    expect(baseline.total).toBe(Object.values(baseline.files).reduce((a, b) => a + b, 0))
  })

  it('skips a testing/ directory at any depth, and ONLY a directory by that name (control)', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'term033-walk-'))
    try {
      const plant = (rel) => {
        const p = path.join(root, ...rel.split('/'))
        fs.mkdirSync(path.dirname(p), { recursive: true })
        fs.writeFileSync(p, 'export const r = fetch(u).catch(() => null)\n')
      }
      plant('testing/agent/rig.mjs')          // the repo's test infrastructure: skipped
      plant('pages/feature/testing/kit.js')   // a nested testing/ directory: skipped
      plant('pages/real.js')                  // product code: counted
      plant('pages/testingTools.js')          // a FILE named like it: still counted
      const st = {}
      expect(census(root, st)).toEqual({ 'pages/real.js': 1, 'pages/testingTools.js': 1 })
      expect(st.scanned).toBe(2)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
    // ...and the exclusion is doing work in the real tree: app/src/testing holds code files.
    const real = fs.readdirSync(path.join(SRC, 'testing'), { recursive: true })
    expect(real.filter((f) => /\.(jsx?|mjs)$/.test(String(f))).length).toBeGreaterThan(0)
  })

  it('counts code only: the idiom inside a comment is not a site, and spacing variants are', () => {
    expect(countIn('// fetch(u).catch(() => null)\n/* .catch(() => null) */')).toBe(0)
    expect(countIn('fetch(u).catch(() => null); g().catch(()=>undefined)')).toBe(2)
    expect(countIn('fetch(u).catch((e) => { throw e })')).toBe(0)
  })
})

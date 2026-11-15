// Test-only support for the P0 chart-data rails (app/src/components/chart/rails/*.test.js).
// Never imported by product code.
import fs from 'node:fs'
import path from 'node:path'

/** The repo root, walked up from the vitest cwd (import.meta.url is not a file: URL here). */
export const REPO_ROOT = (() => {
  let dir = process.cwd()
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'app', 'src', 'components', 'StockChart.jsx'))) return dir
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  throw new Error(`chart rails: could not find the repo root from ${process.cwd()}`)
})()

export const APP_SRC = path.join(REPO_ROOT, 'app', 'src')

/** Deterministic PRNG (mulberry32). Same seed -> same sequence on every box. */
export function rng(seed) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const r = {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),   // inclusive
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
    float: (lo, hi) => lo + next() * (hi - lo),
  }
  return r
}

/** Run `fn(r, seed)` for `n` seeds; on a throw, rethrow naming the seed so it replays. */
export function forSeeds(n, base, fn) {
  for (let i = 0; i < n; i++) {
    const seed = base + i
    try { fn(rng(seed), seed) } catch (e) {
      e.message = `[seed ${seed}] ${e.message}`
      throw e
    }
  }
}

/** Throwing assert (cheaper than expect() inside hot fuzz loops). */
export function check(cond, msg) {
  if (!cond) throw new Error(typeof msg === 'function' ? msg() : msg)
}

export function readRepo(rel) {
  return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8')
}

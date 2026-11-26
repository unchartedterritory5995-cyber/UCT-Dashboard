// app/src/components/chart/engine/ast/translateDepthCap.test.js
//
// ─── ⭐⭐ (e100, coordinator ruling 2026-11-26) — THE DEPTH BOUND IS REACHED BEFORE ANY HOST STACK ──────────────────
//
// `PINE_TRANSLATE_MAX_DEPTH` was 400, and on Node 20 (the CI image) five committed scripts overflowed the host stack
// first, at 218-382 levels. `resolveBinding` turns an overflow into the same depth refusal, so no result moved, but
// WHERE the refusal fired depended on the JIT's frame sizes: a cold run and a warm run of one script took different
// steps. Measured (`translateDepth.measure.test.js`): the deepest resolution any committed script completes is 43
// (screener-mean-reversion-channel), so the bound is 100. These rails hold:
//   1. each script that trips the bound (cc-yata, ict-killzone, momentum-based-zigzag, parabolic-sar, smoothed-
//      gaussian) translates with ZERO host-stack overflows, cold, warm and with 40% of the stack already used, and
//      all three take the same steps and give the same answer: the refusal is a function of the script;
//   2. the deepest legitimate script resolves exactly as at a bound of 43, and NOT as at 42 (the measurement is real);
//   3. the overflow counter counts: with the bound out of reach, cc-yata's overflow is counted (so rail 1's zero can fail),
//      and an overflow inside a nested window still reaches the outer call's count.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { translatePine, lastTranslateWindow, beginTranslateBudget, endTranslateBudget, PINE_TRANSLATE_MAX_DEPTH } from './pine.js'
import { probeObjectRuntime } from '../runtime/runtimeColumns.js'
import { __resetHostKnownDivergence } from '../hostKnownDivergence.js'
import { __resetHeldWithholds } from '../heldWithholds.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '../../../../../..')
const read = (slug) => fs.readFileSync(path.join(REPO, 'corpus/committed', `${slug}.pine`), 'utf8')

// the member door's host-lane call with the runtime fallback off: the shape every tripping script trips in
const FLAGS = ['VITE_PINE_MEMBER_PANE_ENABLED', 'VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', 'VITE_PINE_EDITOR_STATUS',
  'VITE_PINE_STRATEGY_BROKER_ENABLED', 'VITE_RS_SPLIT_ENABLED']
beforeAll(() => { for (const f of FLAGS) vi.stubEnv(f, '1'); vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '') })
afterAll(() => vi.unstubAllEnvs())
const DOOR = { paramManifest: true, strict: true, enumInputs: true, declareInputs: 'all', objectRuntimeCheck: probeObjectRuntime }
function translate(source, extra) {
  __resetHostKnownDivergence(); __resetHeldWithholds()
  const t = translatePine(source, { ...DOOR, ...(extra || {}) })
  const w = lastTranslateWindow()
  return { json: JSON.stringify(t), steps: w.steps, stackTrips: w.stackTrips }
}

// ── the stack, partly taken away (as `pine.stackOverflow.test.js` does) ──
let reached = 0
function burn(left, fn) {
  reached += 1
  if (left === 0) return fn()
  const r = burn(left - 1, fn)
  return r
}
function framesAvailable() {
  let n = 0
  for (let i = 0; i < 3; i += 1) {
    reached = 0
    try { burn(Number.MAX_SAFE_INTEGER, null) } catch { /* the overflow is the measurement */ }
    n = reached
  }
  return n
}
function withStackKept(keep, fn) {
  const total = framesAvailable()
  let left = 0
  const value = burn(Math.floor(total * (1 - keep)), () => {
    const r = fn()
    reached = 0
    try { burn(Number.MAX_SAFE_INTEGER, null) } catch { /* measured */ }
    left = reached
    return r
  })
  return { value, keptFraction: left / total }
}

const TRIPPERS = ['cc-yata__bd898a1af0', 'ict-killzone-index-version__28962c02dd', 'momentum-based-zigzag__38d39d2d6c',
  'parabolic-sar__xoeoPMOWGJ', 'smoothed-gaussian-trend-filter-algoalpha__69de2e99a0']

describe('the depth bound is reached before any host stack', () => {
  it('the bound: 100', () => { expect(PINE_TRANSLATE_MAX_DEPTH).toBe(100) })

  for (const slug of TRIPPERS) {
    it(`1. ⛔⛔ ${slug.split('__')[0]}: the host stack never decides — 0 overflows, cold = warm = 40% of the stack used`, () => {
      const src = read(slug)
      const cold = translate(src)
      const warm = translate(src)
      const { value: starved, keptFraction } = withStackKept(0.6, () => translate(src))
      // non-vacuity: the stack really was taken, and the script did work
      expect(keptFraction).toBeLessThan(0.7)
      expect(cold.steps).toBeGreaterThan(1000)
      for (const [what, r] of [['cold', cold], ['warm', warm], ['starved', starved]]) {
        expect(r.stackTrips, `${what}: host-stack overflows`).toBe(0)
      }
      expect([warm.steps, starved.steps], 'steps: cold, then warm and starved').toEqual([cold.steps, cold.steps])
      expect(warm.json).toBe(cold.json)
      expect(starved.json).toBe(cold.json)
    }, 120000)
  }

  it('2. the deepest legitimate script resolves as at a bound of 43, and not as at 42', () => {
    const src = read('screener-mean-reversion-channel__nTK2sHWDlB')
    const shipped = translate(src)
    expect(shipped.stackTrips).toBe(0)
    expect(shipped.json).not.toMatch(/nested past \d+ levels/)
    expect(translate(src, { maxDepth: 43 }).json).toBe(shipped.json)
    expect(translate(src, { maxDepth: 42 }).json, 'the 43rd level is used').not.toBe(shipped.json)
  }, 120000)

  it('3. the overflow counter counts: with the bound out of reach, cc-yata overflows and it is counted', () => {
    const r = translate(read('cc-yata__bd898a1af0'), { maxDepth: 1e9 })
    expect(r.stackTrips).toBeGreaterThan(0)
    expect(r.json).toMatch(/nested past 1000000000 levels/)
  }, 120000)

  it('3b. the overflow counter counts: an overflow in a nested window reaches the outer call', () => {
    __resetHostKnownDivergence(); __resetHeldWithholds()
    beginTranslateBudget(60000, 'outer.pine')
    try { translatePine(read('cc-yata__bd898a1af0'), { ...DOOR, maxDepth: 1e9 }) } finally { endTranslateBudget() }
    expect(lastTranslateWindow().stackTrips).toBeGreaterThan(0)
  }, 120000)
})

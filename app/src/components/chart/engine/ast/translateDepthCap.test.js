// app/src/components/chart/engine/ast/translateDepthCap.test.js
//
// ─── ⭐⭐ (e100 fix C, coordinator ruling 2026-11-26) — THE DEPTH BOUND IS REACHED BEFORE ANY HOST STACK ──────────────
//
// `PINE_TRANSLATE_MAX_DEPTH` is 400. On Node 20 (the CI image), with a cold JIT and the default stack, five committed
// scripts and two licence-held ones overflowed the host stack first, at 206-355 levels. `resolveBinding` turns an
// overflow into the same depth refusal, but WHERE it fired depended on the JIT's frame sizes, so a cold run and a warm
// run of one script took different steps. A lower bound had no margin on either side: the deepest legitimate
// resolution measured is 156 levels (licence-held), the shallowest overflow 206.
//
// ⭐ THE FIX MAKES EACH LEVEL COST FEWER STACK BYTES, not the bound smaller. Measured on Node 20, cold: an interpreter
// frame costs (registers + arguments + 7) x 8 bytes, and that model predicted the stack to within 2%. `resolve`'s
// switch gave its frame a slot for every case's locals (72 registers), and `resolve` was half the frames on the deepest
// chain. Every case, arm and early answer on that chain now runs in its own method, so the frame that stays live while
// an operand resolves holds only what that operand needs. First overflow (cold, default stack, no bound), before ->
// after: momentum-based-zigzag 206 -> 558, cc-yata 273 -> 863+, parabolic-sar 337 -> 949+, smoothed-gaussian 346 ->
// 1014+, ict-killzone 355 -> 725+ (the licence-held two: 276 -> 720+, 275 -> 678+).
//
// These rails hold:
//   1. ⛔⛔ THE FRAME BUDGET. momentum-based-zigzag has the most frames per level of any script measured. Translated
//      FIRST in this file (a cold JIT) with only 400/468 of the stack left, it reaches the bound with no overflow,
//      i.e. on a whole stack its overflow sits at 468 levels or deeper (3x the deepest legitimate 156; 1.17x the
//      bound). A refactor that grows a frame on the chain again (a local, a wide call, a case put back inline in
//      `resolve`) fails HERE, by name;
//   2. each committed script that reaches the bound translates with ZERO host-stack overflows starved, cold-ish and
//      warm, with the same steps and the same answer: the refusal is a function of the script;
//   3. the overflow counter counts (so rails 1-2's zero can fail), also from inside a nested window.
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
  // Held in a local, not returned directly: every level keeps its frame.
  const r = burn(left - 1, fn)
  return r
}
/** How many `burn` frames the stack left here holds, measured three times so `burn` is at the tier it runs at. */
function framesAvailable() {
  let n = 0
  for (let i = 0; i < 3; i += 1) {
    reached = 0
    try { burn(Number.MAX_SAFE_INTEGER, null) } catch { /* the overflow is the measurement */ }
    n = reached
  }
  return n
}
/** `fn()` run with only `keep` of the stack left here; also reports how much was. */
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

/** 400 levels in this fraction of the stack <=> a whole stack holds 468: 3x the deepest legitimate resolution (156). */
const LEGIT_DEEPEST = 156
const OVERFLOW_FLOOR = 3 * LEGIT_DEEPEST
const KEEP = PINE_TRANSLATE_MAX_DEPTH / OVERFLOW_FLOOR

const WORST = 'momentum-based-zigzag__38d39d2d6c'
const OTHERS = ['cc-yata__bd898a1af0', 'ict-killzone-index-version__28962c02dd',
  'parabolic-sar__xoeoPMOWGJ', 'smoothed-gaussian-trend-filter-algoalpha__69de2e99a0']

function heldAtTheBound(slug) {
  const src = read(slug)
  // starved FIRST: the coldest JIT this file gives, with the largest frames
  const { value: starved, keptFraction } = withStackKept(KEEP, () => translate(src))
  const full = translate(src)
  const warm = translate(src)
  // non-vacuity: the stack really was taken, the script did work, and it reached the bound
  expect(keptFraction, 'the stack was really taken').toBeLessThan(KEEP + 0.05)
  expect(full.steps).toBeGreaterThan(1000)
  // …and it REACHES the bound: one level fewer takes different steps (a probe may swallow the refusal itself)
  expect(translate(src, { maxDepth: PINE_TRANSLATE_MAX_DEPTH - 1 }).steps, 'reaches the bound').not.toBe(full.steps)
  for (const [what, r] of [['starved', starved], ['full', full], ['warm', warm]]) {
    expect(r.stackTrips, `${what}: host-stack overflows (stack kept ${keptFraction.toFixed(3)})`).toBe(0)
  }
  expect([full.steps, warm.steps], 'steps: starved, then full and warm').toEqual([starved.steps, starved.steps])
  expect(full.json).toBe(starved.json)
  expect(warm.json).toBe(starved.json)
}

describe('the depth bound is reached before any host stack', () => {
  // ⛔ FIRST IN THE FILE, so the JIT is cold: rail 1 is the frame budget, and a cold frame is the largest.
  it(`1. ⛔⛔ the frame budget: ${WORST.split('__')[0]} (most frames per level) reaches the bound in ${PINE_TRANSLATE_MAX_DEPTH}/${OVERFLOW_FLOOR} of the stack — its overflow sits at ${OVERFLOW_FLOOR}+ levels`, () => {
    heldAtTheBound(WORST)
  }, 120000)

  it('the bound: 400', () => { expect(PINE_TRANSLATE_MAX_DEPTH).toBe(400) })

  for (const slug of OTHERS) {
    it(`2. ${slug.split('__')[0]}: the host stack never decides — 0 overflows, starved = full = warm`, () => {
      heldAtTheBound(slug)
    }, 120000)
  }

  it('3. the overflow counter counts: with 30% of the stack, cc-yata overflows before the bound and it is counted', () => {
    const { value: r } = withStackKept(0.3, () => translate(read('cc-yata__bd898a1af0')))
    expect(r.stackTrips).toBeGreaterThan(0)
    expect(r.json).toMatch(/nested past 400 levels/)
  }, 120000)

  it('3b. the overflow counter counts: an overflow in a nested window reaches the outer call', () => {
    const { value: trips } = withStackKept(0.3, () => {
      __resetHostKnownDivergence(); __resetHeldWithholds()
      beginTranslateBudget(60000, 'outer.pine')
      try { translatePine(read('cc-yata__bd898a1af0'), DOOR) } finally { endTranslateBudget() }
      return lastTranslateWindow().stackTrips
    })
    expect(trips).toBeGreaterThan(0)
  }, 120000)
})

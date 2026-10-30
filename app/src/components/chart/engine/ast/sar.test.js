// Parabolic SAR as a formula — `sar(step, maxStep)` / `sarDirection(step, maxStep)`,
// the expansion over `accum4` (`callExpansions.js::sarTrees`, 2026-10-30).
//
// ⛔ THE REFERENCE IS THE CHART'S OWN SAR, AND IT IS INDEPENDENT OF THIS EXPANSION.
// `indicators.js::computeParabolicSAR` is a separate, full-history loop the chart
// already draws; it shares no code with the formula engine. The claim this file
// holds the expansion to is the one the expansion makes: inside the measured domain
// it equals that full-history SAR on every bar it publishes.
//
// ⭐ AND IT RE-MEASURES ON REAL BARS EVERY RUN — every distinct TradingView capture
// under `tests/fixtures/vendor/harness/` with enough history. Only counts are asserted.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseFormula, astHash, vendorNotesForTree } from './parse.js'
import { interpret } from './interpret.js'
import { checkBudget } from './budget.js'
import { astReach } from './lint.js'
import { computeParabolicSAR } from '../../indicators.js'
import { nameOfTree } from '../../builder/authoring/derivedName.js'
import { describeTree } from '../../builder/authoring/expansionWords.js'
import {
  sarTrees, SAR_WARMUP, SAR_MIN_STEP, SAR_MIN_MAX_STEP, SAR_NOTE, expandCall, expansionProblem,
  recogniseExpansion, collapseExpansions,
} from './callExpansions.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const HARNESS = path.resolve(HERE, '../../../../../../tests/fixtures/vendor/harness')

function walk(n, seed, { drift = 0, vol = 0.04, nanAt = [] } = {}) {
  let x = seed
  const rnd = () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648 }
  let c = 100
  const out = []
  for (let i = 0; i < n; i++) {
    const o = c
    c = c * (1 + (rnd() - 0.5) * vol + drift)
    const h = Math.max(o, c) * (1 + rnd() * 0.01)
    const l = Math.min(o, c) * (1 - rnd() * 0.01)
    out.push({ t: i, o, h, l: nanAt.includes(i) ? NaN : l, c, v: 1 })
  }
  return out
}
const ast = (s) => {
  const r = parseFormula(s)
  if (!r.ok) throw new Error(`${s}: ${r.error}`)
  return r.ast
}
const run = (s, bars) => Array.from(interpret(ast(s), bars, {}))

/** Bars where the formula publishes a value, and how many of those disagree. */
function grade(bars, step, max) {
  const value = run(`sar(${step}, ${max})`, bars)
  const dir = run(`sarDirection(${step}, ${max})`, bars)
  const full = computeParabolicSAR(bars, step, max)
  let published = 0
  let bad = 0
  for (let i = 0; i < bars.length; i++) {
    if (!Number.isFinite(value[i])) continue
    published += 1
    const ref = full[i]
    if (Math.abs(value[i] - ref.value) > 1e-9 * Math.abs(ref.value)) bad += 1
    if (dir[i] !== (ref.isUptrend ? 1 : -1)) bad += 1
  }
  return { published, bad }
}

function realSeries() {
  const out = []
  const seen = new Set()
  for (const f of fs.readdirSync(HARNESS).filter((n) => n.endsWith('.json')).sort()) {
    const d = JSON.parse(fs.readFileSync(path.join(HARNESS, f), 'utf8'))
    const rows = d && d.bars && d.bars.rows
    if (!Array.isArray(rows) || rows.length < 450) continue
    const key = `${d.symbol}|${d.timeframe}|${rows.length}|${rows[0][0]}`
    if (seen.has(key)) continue
    seen.add(key)
    const ix = Object.fromEntries(d.bars.fields.map((k, i) => [k, i]))
    out.push(rows.map((r, i) => ({ t: i, o: r[ix.open], h: r[ix.high], l: r[ix.low], c: r[ix.close], v: r[ix.volume] })))
  }
  return out
}

describe('the chart\'s own Parabolic SAR, bar for bar', () => {
  const SETTINGS = [[0.02, 0.2], [0.03, 0.3], [0.02, 0.4], [0.1, 0.5]]

  it('synthetic: trending, grinding and choppy series, every in-domain setting', () => {
    const regimes = [{}, { drift: 0.004, vol: 0.02 }, { drift: -0.004, vol: 0.02 }, { drift: 0.001, vol: 0.005 }, { vol: 0.06 }]
    let published = 0
    for (const [step, max] of SETTINGS) {
      for (const [r, opts] of regimes.entries()) {
        for (let s = 1; s <= 4; s++) {
          const g = grade(walk(900, s * 7919 + r, opts), step, max)
          expect(g.bad, `step ${step} max ${max} regime ${r} seed ${s}`).toBe(0)
          published += g.published
        }
      }
    }
    expect(published).toBeGreaterThan(40000)
  }, 120000)

  it('real: every distinct captured series in the vendor harness', () => {
    const series = realSeries()
    // ⛔ NON-VACUITY — the harness must actually be there.
    expect(series.length).toBeGreaterThan(20)
    let published = 0
    for (const bars of series) {
      const g = grade(bars, 0.02, 0.2)
      expect(g.bad).toBe(0)
      published += g.published
    }
    expect(published).toBeGreaterThan(5000)
  }, 120000)

  it('direction flips really happen in the graded data (the reversal arms are exercised)', () => {
    const dir = run('sarDirection(0.02, 0.2)', walk(900, 31))
    let flips = 0
    for (let i = 1; i < dir.length; i++) if (Number.isFinite(dir[i - 1]) && dir[i] !== dir[i - 1]) flips += 1
    expect(flips).toBeGreaterThan(10)
  })
})

describe('bounded, honest about its left edge, and window-independent', () => {
  it('publishes from bar W + 1, never before', () => {
    const v = run('sar(0.02, 0.2)', walk(500, 3))
    expect(v.slice(0, SAR_WARMUP + 1).every((x) => !Number.isFinite(x))).toBe(true)
    expect(Number.isFinite(v[SAR_WARMUP + 1])).toBe(true)
  })

  it('a later fetch start gives the same value on every shared bar (panning)', () => {
    const b = walk(800, 5)
    const full = run('sar(0.02, 0.2)', b)
    const later = run('sar(0.02, 0.2)', b.slice(150))
    for (let i = 150 + SAR_WARMUP + 1; i < b.length; i++) expect(later[i - 150]).toBe(full[i])
  })

  it('a missing low withholds the windows that contain it, and the value comes back', () => {
    const b = walk(700, 9, { nanAt: [400] })
    const v = run('sar(0.02, 0.2)', b)
    expect(Number.isFinite(v[399])).toBe(true)
    expect(Number.isFinite(v[400])).toBe(false)
    expect(Number.isFinite(v[400 + SAR_WARMUP + 3])).toBe(true)
  })

  it('reads 202 bars back, never ahead, and fits the default budget', () => {
    const a = ast('sar(0.02, 0.2)')
    expect(astReach(a)).toMatchObject({ back: SAR_WARMUP + 2, forward: 0 })
    expect(checkBudget(a).ok).toBe(true)
  })
})

describe('the domain is the MEASURED one, and everything outside it is refused by name', () => {
  it('declines a slow step, a low maximum, max < step, max > 1 and a computed argument', () => {
    const n = (v) => ({ type: 'num', value: v })
    expect(sarTrees(n(SAR_MIN_STEP), n(SAR_MIN_MAX_STEP))).not.toBe(null)
    for (const [s, m] of [[0.01, 0.2], [0.02, 0.1], [0.3, 0.2], [0.02, 1.5], [0, 0.2], [-0.02, 0.2]]) {
      expect(sarTrees(n(s), n(m)), `${s}, ${m}`).toBe(null)
    }
    expect(sarTrees({ type: 'series', name: 'close' }, n(0.2))).toBe(null)
    const why = expansionProblem({ type: 'call', name: 'sar', args: [n(0.01), n(0.2)] })
    expect(why).toContain(String(SAR_MIN_STEP))
    expect(why).toContain('Parabolic SAR indicator')
  })

  it('a member typing a slow setting gets that sentence, not a number', () => {
    const r = parseFormula('sar(0.005, 0.05)')
    expect(r.ok).toBe(false)
    expect(r.error).toContain(String(SAR_MIN_STEP))
  })
})

describe('a saved definition carries only the expansion, and it round-trips', () => {
  it('the same call is the same tree (one astHash) however it is reached', () => {
    const viaText = ast('sar(0.02, 0.2)')
    const viaBuilder = expandCall({ type: 'call', name: 'sar', args: [{ type: 'num', value: 0.02 }, { type: 'num', value: 0.2 }] })
    expect(astHash(viaText)).toBe(astHash(viaBuilder))
    // stored as JSON and read back
    expect(astHash(JSON.parse(JSON.stringify(viaText)))).toBe(astHash(viaText))
  })

  it('a stored tree reads back as the call a member wrote (recognised structurally)', () => {
    for (const [name, step, max] of [['sar', 0.02, 0.2], ['sarDirection', 0.03, 0.3], ['sar', 0.1, 0.5]]) {
      const tree = ast(`${name}(${step}, ${max})`)
      expect(recogniseExpansion(tree)).toEqual({ name, args: [{ type: 'num', value: step }, { type: 'num', value: max }] })
    }
    const collapsed = collapseExpansions(ast('sar(0.02, 0.2) > close'))
    expect(collapsed.args[0]).toEqual({ type: 'call', name: 'sar', args: [{ type: 'num', value: 0.02 }, { type: 'num', value: 0.2 }] })
  })

  it('discloses its vendor note wherever notes are read', () => {
    const notes = vendorNotesForTree(ast('sar(0.02, 0.2) > close'))
    expect(JSON.stringify(notes)).toContain(SAR_NOTE.slice(0, 40))
  })
})

describe('a member reads it in plain words', () => {
  it('the derived name and the named read-back say Parabolic SAR, never SARDIRECTION', () => {
    expect(nameOfTree(ast('sar(0.02, 0.2)'))).toBe('Parabolic SAR 0.02,0.2')
    expect(nameOfTree(ast('close > sar(0.02, 0.2)'))).toBe('Close above Parabolic SAR 0.02,0.2')
    expect(nameOfTree(ast('sarDirection(0.03, 0.3)'))).toBe('Parabolic SAR trend 0.03,0.3')
    expect(describeTree(ast('close > sar(0.02, 0.2)'))).toBe(
      '1 when close is greater than the Parabolic SAR (step 0.02, maximum 0.2) and 0 otherwise')
  })
})

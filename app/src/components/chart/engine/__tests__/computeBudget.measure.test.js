// app/src/components/chart/engine/__tests__/computeBudget.measure.test.js
//
// ─── C2A: WHAT ACTUALLY HAPPENS WHEN ONE COLUMN IS TOO EXPENSIVE ────────────
//
// A MEASUREMENT, not a rail. It prints; it asserts only what it has proved.
//
// The C0R report left a hypothesis: 3 of `master-line-lite`'s 7 columns evaluate
// cleanly at 5,000 bars in isolation while the chart reports all 7 empty, so one
// expensive column MAY be taking the document down with it. This file settles it
// against production code — `nativeRegistry.computeFor`, the same call the binder
// makes — rather than against a re-implementation of it.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from '../ast/pine'
import { interpret } from '../ast/interpret'
import { DEFAULT_BUDGET } from '../ast/budget'
import { computeFor } from '../nativeRegistry'
import { memberInputTranslation } from '../../builder/builderInputs'

const OOS = path.resolve(process.cwd(), '../tools/c0_oos_fixtures')

/** The bar count a chart actually loads for a daily symbol. */
const N_CHART = 5000

function bars(n) {
  return Array.from({ length: n }, (_, i) => ({
    t: 1500000000 + i * 86400,
    o: 100 + Math.sin(i / 11) * 8,
    h: 104 + Math.sin(i / 11) * 8,
    l: 96 + Math.sin(i / 11) * 8,
    c: 100 + Math.sin(i / 7) * 9,
    v: 1_000_000 + (i % 53) * 5000,
  }))
}

/** The carried columns of a script, in document order, with their inputs. */
function documentOf(file) {
  const src = fs.readFileSync(path.join(OOS, `${file}.pine`), 'utf8')
  const t = memberInputTranslation(translatePine, src, {})
  const outs = (t.outputs || []).filter((o) => o && o.ast && o.formula && !o.hidden).slice(0, 12)
  const inputs = {}
  for (const o of outs) for (const r of (o.memberInputs || [])) inputs[r.key] = r.default
  const trees = {}
  const keys = []
  outs.forEach((o, i) => {
    const k = i === 0 ? 'value' : `out${i + 1}`
    keys.push(k)
    trees[k] = o.ast
  })
  return {
    id: 'u_measure',
    schemaVersion: 2,
    label: file,
    inputs: [],
    plots: keys.map((k) => ({ key: k, label: k, style: 'line', legend: { decimals: 2 } })),
    compute: { kind: 'ast', fn: 'sha256:measure', trees, budget: DEFAULT_BUDGET },
    __inputs: inputs,
    __titles: outs.map((o) => o.title),
  }
}

const finite = (col) => (col || []).filter(Number.isFinite).length

function timed(fn) {
  const t0 = Date.now()
  try {
    const value = fn()
    return { ok: true, value, ms: Date.now() - t0 }
  } catch (e) {
    return { ok: false, guard: e.guard || e.name, message: String(e.message).slice(0, 110), ms: Date.now() - t0 }
  }
}

  // ⚠️ AN EXPLICIT TIMEOUT, BECAUSE R-Q MADE THIS FILE DO THE WORK IT USED TO
  // SKIP. These columns refused instantly while the ceiling was 1,000,000; at
  // the derived 12,000,000 they COMPUTE, which is the point — and a measurement
  // file that trips vitest's 15s default reports as a failure of the thing it
  // measures. Naming the number keeps a slow measurement legible as slow.
describe('C2A — master-line-lite, column by column', () => {
  const def = documentOf('mid_engagement__14-master-line-lite')
  const B = bars(N_CHART)

  it('each column ALONE at 5,000 bars', { timeout: 300_000 }, () => {
    const lines = []
    def.plots.forEach((p, i) => {
      const r = timed(() => interpret(def.compute.trees[p.key], B, def.__inputs, def.compute.budget))
      lines.push(`  [${i}] ${p.key.padEnd(6)} ${String(def.__titles[i]).slice(0, 18).padEnd(19)}`
        + (r.ok ? `OK   finite=${finite(r.value)}/${N_CHART}  ${r.ms}ms`
          : `FAIL ${r.guard}  ${r.ms}ms  ${r.message}`))
    })
    // eslint-disable-next-line no-console
    console.log(`\n=== ${def.label} — ${def.plots.length} columns, ${N_CHART} bars ===\n${lines.join('\n')}`)
    expect(def.plots.length).toBeGreaterThan(1)
  })

  it('⭐⭐ THE DOCUMENT: growing subsets through the REAL computeFor', { timeout: 300_000 }, () => {
    const lines = []
    for (let n = 1; n <= def.plots.length; n += 1) {
      const sub = {
        ...def,
        plots: def.plots.slice(0, n),
        compute: {
          ...def.compute,
          trees: Object.fromEntries(def.plots.slice(0, n).map((p) => [p.key, def.compute.trees[p.key]])),
        },
      }
      const r = timed(() => computeFor(sub, B, def.__inputs, {}))
      lines.push(`  first ${n} column(s): `
        + (r.ok
          ? `OK  columns=${Object.keys(r.value).length} finite=[${Object.values(r.value).map(finite).join(',')}]  ${r.ms}ms`
          : `THREW ${r.guard} — ${r.message}`))
    }
    // eslint-disable-next-line no-console
    console.log(`\n=== the document, via computeFor ===\n${lines.join('\n')}`)
    expect(lines.length).toBe(def.plots.length)
  })

  it('⚰⚰ THE MIXED DOCUMENT IS GONE — R-Q made every column of it affordable', { timeout: 300_000 }, () => {
    // ⚰⚰ THIS CASE USED TO PROVE CONTAINMENT ON A REAL SCRIPT, AND IT CANNOT ANY
    // MORE, WHICH IS THE RESULT RATHER THAN A REGRESSION. `master-line-lite` was
    // the corpus' one MIXED document: three columns affordable, four refusing
    // `interpret:steps` at the 5,000 bars a chart loads. R-Q derived the ceiling
    // from what real scripts need (`recurrenceSteps.measure.test.js`) and moved
    // it 1,000,000 → 12,000,000, so all seven now compute — a member who imported
    // this script used to lose four of its seven plots and no longer does.
    //
    // ⛔ THE FILE'S OWN WARNING FIRED: *"If it ever becomes all-cheap or
    // all-expensive this file stops measuring what it claims to."* It became
    // all-cheap. So this case records THAT, and the containment MECHANISM is
    // proved in `computeContainment.test.js`, whose expensive column is derived
    // from `MAX_RECURRENCE_STEPS` and therefore cannot go cheap under it again.
    const whole = timed(() => computeFor(def, B, def.__inputs, {}))
    const alone = def.plots.map((p) => timed(
      () => interpret(def.compute.trees[p.key], B, def.__inputs, def.compute.budget)))
    const okAlone = alone.filter((r) => r.ok).length
    // eslint-disable-next-line no-console
    console.log(`
=== containment ===
  whole document: ${whole.ok ? 'OK' : `THREW ${whole.guard}`}`
      + `
  columns that succeed ALONE: ${okAlone}/${def.plots.length}`)
    // ⭐ EVERY COLUMN, ALONE AND TOGETHER.
    expect(okAlone).toBe(def.plots.length)
    expect(whole.ok).toBe(true)
    expect(Object.keys(whole.value)).toHaveLength(def.plots.length)
    // ⛔ AND NO COLUMN CAME BACK EMPTY — 'it computed' must mean values, or this
    // would pass over seven columns of NaN.
    for (const key of Object.keys(whole.value)) {
      expect(finite(whole.value[key]), key).toBeGreaterThan(0)
    }
  })
})

describe('C2A — the same shape on the other compute-blocked script', () => {
  it('spma-trend, column by column', { timeout: 300_000 }, () => {
    const def = documentOf('mid_engagement__13-spma-trend')
    const B = bars(N_CHART)
    const lines = []
    def.plots.forEach((p, i) => {
      const r = timed(() => interpret(def.compute.trees[p.key], B, def.__inputs, def.compute.budget))
      lines.push(`  [${i}] ${p.key.padEnd(6)} `
        + (r.ok ? `OK   finite=${finite(r.value)}/${N_CHART}  ${r.ms}ms`
          : `FAIL ${r.guard}  ${r.message}`))
    })
    const whole = timed(() => computeFor(def, B, def.__inputs, {}))
    // eslint-disable-next-line no-console
    console.log(`\n=== ${def.label} — ${def.plots.length} columns ===\n${lines.join('\n')}`
      + `\n  whole document: ${whole.ok ? 'OK' : `THREW ${whole.guard}`}`)
    expect(def.plots.length).toBeGreaterThan(0)
  })
})

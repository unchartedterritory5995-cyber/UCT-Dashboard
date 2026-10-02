// app/src/components/chart/engine/ast/paramIdSourceStability.test.js
//
// ─── C46 — FOLDING MORE OR LESS OF A SCRIPT RENUMBERS NOTHING ────────────────
//
// The property the source rule exists for, proved on the corpus rather than
// argued: translate every script with an arbitrary subset of its top-level
// blocks artificially REFUSED (`opts.testRefuseBlock`, a test-only hook in
// `translatePine` that sends the block down the same catch a real unfoldable
// block takes) and require that every input which still mints holds the SAME id.
//
// ⛔ WHY A HOOK AND NOT A SECOND CORPUS. What moved saved ids three times in two
// days was never a different script — it was the SAME script folding a block it
// used to refuse (C31), serving an index it used to refuse (C38), collapsing an
// arm it used to walk (C41). Refusing blocks that fold today is that change run
// backwards, on demand, over every script.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from './pine.js'
import { memberInputTranslation } from '../../builder/builderInputs.js'

const REPO = path.resolve(__dirname, '../../../../../..')
const SOURCES = ['corpus/committed', 'tests/fixtures/pine_oos', 'tests/fixtures/member']
const STRICT = { strict: true, paramManifest: true }

/** mulberry32 — a seeded PRNG, so "arbitrary" is the same subset on every run. */
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const seedOf = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i += 1) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0 }

const entries = (t) => (t.inputParams || []).map((p) => ({ id: p.id, ordinal: p.ordinal, name: p.sourceName }))

/** The baseline translation, the block lines the hook was asked about, and the
 *  same script translated under each refusal subset. */
function variantsOf(name, src, translate) {
  const lines = []
  let base
  try {
    base = translate(src, { testRefuseBlock: (line) => { if (!lines.includes(line)) lines.push(line); return false } })
  } catch { return null }
  if (!lines.length) return { base: entries(base), runs: [], blocks: 0 }
  const rand = rng(seedOf(name))
  const subsets = [new Set(lines)]
  for (let k = 0; k < 2; k += 1) {
    const s = new Set(lines.filter(() => rand() < 0.5))
    if (s.size && s.size < lines.length) subsets.push(s)
  }
  const runs = []
  for (const subset of subsets) {
    try {
      runs.push({ refused: subset.size, got: entries(translate(src, { testRefuseBlock: (line) => subset.has(line) })) })
    } catch { /* a variant that throws mints nothing to compare */ }
  }
  return { base: entries(base), runs, blocks: lines.length }
}

/** Every (script, input call) that held two ids, or id that addressed two calls. */
function conflictsOf(name, v) {
  const byOrdinal = new Map()
  const byId = new Map()
  const out = []
  for (const set of [v.base, ...v.runs.map((r) => r.got)]) {
    for (const e of set) {
      if (byOrdinal.has(e.ordinal) && byOrdinal.get(e.ordinal) !== e.id) {
        out.push({ script: name, input: e.name, ordinal: e.ordinal, ids: [byOrdinal.get(e.ordinal), e.id] })
      }
      if (byId.has(e.id) && byId.get(e.id) !== e.ordinal) {
        out.push({ script: name, id: e.id, ordinals: [byId.get(e.id), e.ordinal] })
      }
      byOrdinal.set(e.ordinal, e.id)
      byId.set(e.id, e.ordinal)
    }
  }
  return out
}

/** A variant dropped an input that is NOT the last one in id order — the exact
 *  case a dense counter renumbers (everything after the dropped one moves down). */
function counterWouldRenumber(v) {
  const baseIds = v.base.map((e) => e.id)
  return v.runs.some((r) => {
    const kept = new Set(r.got.map((e) => e.id))
    const firstLost = baseIds.findIndex((id) => !kept.has(id))
    return firstLost >= 0 && baseIds.slice(firstLost + 1).some((id) => kept.has(id))
  })
}

const SCRIPTS = []
for (const dir of SOURCES) {
  const abs = path.join(REPO, dir)
  if (!fs.existsSync(abs)) continue
  for (const f of fs.readdirSync(abs).filter((x) => x.endsWith('.pine')).sort()) {
    SCRIPTS.push({ name: `${dir}/${f}`, src: fs.readFileSync(path.join(abs, f), 'utf8') })
  }
}

describe('C46 — a parameter id does not depend on how much of the script folds', () => {
  it('⛔⛔ the minimal case: refusing the block that reaches `a` leaves `b` where it was', () => {
    const src = '//@version=5\nindicator("t")\n'
      + 'a = input.int(5, "A")\nb = input.int(7, "B")\n'
      + 'x = 0.0\nif close > open\n    x := ta.sma(close, a)\n'
      + 'plot(x)\nplot(ta.sma(close, b))\n'
    const ids = (opts) => translatePine(src, { ...STRICT, ...opts }).inputParams.map((p) => [p.id, p.sourceName])
    const folded = ids({})
    const refused = ids({ testRefuseBlock: () => true })
    expect(folded).toEqual([['__uct_param_1001', 'a'], ['__uct_param_1002', 'b']])
    // the first plot refuses with its block, so `a` is never reached — and `b`,
    // which a counter would now call the first parameter, is still the second.
    expect(refused).toEqual([['__uct_param_1002', 'b']])
  })

  it('⛔⛔ EVERY CORPUS SCRIPT: any subset of blocks refused, the inputs that survive keep their ids', () => {
    const conflicts = []
    let measured = 0
    let changedSet = 0
    let wouldRenumber = 0
    for (const { name, src } of SCRIPTS) {
      const v = variantsOf(name, src, (s, extra) => translatePine(s, { ...STRICT, ...extra }))
      if (!v || !v.runs.length || !v.base.length) continue
      measured += 1
      conflicts.push(...conflictsOf(name, v))
      const baseKey = v.base.map((e) => e.id).join()
      if (v.runs.some((r) => r.got.map((e) => e.id).join() !== baseKey)) changedSet += 1
      if (counterWouldRenumber(v)) wouldRenumber += 1
    }
    if (process.env.C46_STABILITY_PRINT) console.log('C46-STABILITY', JSON.stringify({ scripts: SCRIPTS.length, measured, changedSet, wouldRenumber }))
    expect(conflicts, `an id depended on what folded:\n${JSON.stringify(conflicts.slice(0, 20), null, 2)}`).toEqual([])
    // ⛔ NON-VACUITY, three ways. The corpus is here; the hook really does change
    // what translates; and it produces the case the old counter got wrong.
    expect(SCRIPTS.length).toBeGreaterThan(290)
    expect(measured, 'no script has both a parameter and a refusable block').toBeGreaterThan(100)
    // Measured 2026-10-01: 299 scripts, 120 measurable, 29 whose minted set a
    // refusal changes, 14 where a dense counter would have renumbered a survivor.
    expect(changedSet, 'refusing blocks changed nothing — the hook is not reaching the walk').toBeGreaterThanOrEqual(20)
    expect(wouldRenumber, 'no variant drops a non-last input — a counter would pass this rail too').toBeGreaterThanOrEqual(10)
  }, 900000)

  it('⛔ the same property through the MEMBER door, on the scripts the C31 step-over moved', () => {
    const NAMES = ['anchored-vwap-pinch', 'delta-imbalance-map', 'kalman-price-filter', 'uncharted-volume-v2', 'artemis-oscillator-pro']
    const picked = SCRIPTS.filter((s) => NAMES.some((n) => path.basename(s.name).startsWith(n)))
    expect(NAMES.filter((n) => !picked.some((s) => path.basename(s.name).startsWith(n))), 'a named specimen left the corpus').toEqual([])
    const conflicts = []
    let withRuns = 0
    for (const { name, src } of picked) {
      const v = variantsOf(name, src, (s, extra) => memberInputTranslation(translatePine, s, { ...STRICT, ...extra }))
      if (!v || !v.runs.length) continue
      withRuns += 1
      conflicts.push(...conflictsOf(name, v))
    }
    expect(withRuns).toBeGreaterThanOrEqual(3)
    expect(conflicts).toEqual([])
  }, 600000)
})

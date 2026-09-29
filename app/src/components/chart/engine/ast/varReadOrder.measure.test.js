// app/src/components/chart/engine/ast/varReadOrder.measure.test.js
//
// ─── ⭐⭐ COLUMNAR vs RUNTIME, OUTPUT BY OUTPUT — the var-read-order instrument (opt-in) ──
//
// `pine.js` resolves a `var` read by WHERE it sits in the bar (2026-09-28: an
// output reads a reassigned name as it stands at the output's own line; a read
// between two reassignments is those above it applied to the previous bar's
// FINAL value). That changes formulas across the corpus, and every changed
// column has to be justified against something that is not the translator
// itself. Where a TradingView capture exists the vendor harness grades it; for
// everything else the reference is the RUNTIME lane — the per-bar VM, which
// executes statements in source order and is therefore the ordering rule by
// construction.
//
//   cd app && VAR_READ_CENSUS=1 VAR_READ_CENSUS_OUT=<path.json> \
//     node node_modules/vitest/vitest.mjs run \
//     src/components/chart/engine/ast/varReadOrder.measure.test.js
//
// Two runs (translator before / after) are diffed by the caller. Per output it
// records the formula's text hash, the refusal guard, and how many bars the
// columnar column agrees with the runtime lane's column on, past the columnar
// warm-up (`accum`'s 250 bars — before that the column is not computable, and
// counting those bars would measure the warm-up rather than the rule).
//
// ⛔ IT ASSERTS NO COUNT. It prints and writes. Outputs are aligned by call kind
// and ordinal (the 3rd `plotshape` of one lane against the 3rd of the other);
// both lanes push outputs in source order.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'

import { translatePine } from './pine.js'
import { interpret } from './interpret.js'
import { parseFormula } from './parse.js'
import { buildRuntimeIr } from './pineRuntimeFrontend.js'
import { lowerIrProgram } from '../runtime/lowerIr.js'
import { execute } from '../runtime/vm.js'

const REPO = path.resolve(process.cwd(), '..')
const DIRS = [
  path.join(REPO, 'corpus', 'committed'),
  path.join(REPO, 'tests', 'fixtures', 'pine_oos'),
  path.join(REPO, 'tests', 'fixtures', 'pine'),
  path.join(REPO, 'tests', 'fixtures', 'member'),
]
const BARS_FILE = path.join(REPO, 'tests', 'fixtures', 'vendor', 'harness',
  'inside-bar-range-mother-candle-breakoutbreakdown-with-volume-confirmat-rddt-1d-2026-09-28.json')

const RUN = process.env.VAR_READ_CENSUS === '1'
const OUT = process.env.VAR_READ_CENSUS_OUT || path.join(os.tmpdir(), 'var_read_census.json')
const ONLY = process.env.VAR_READ_CENSUS_ONLY ? new Set(process.env.VAR_READ_CENSUS_ONLY.split(',')) : null
const FROM_BAR = 251

const sha = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 12)

function scripts() {
  const out = []
  for (const dir of DIRS) {
    if (!fs.existsSync(dir)) continue
    for (const name of fs.readdirSync(dir).sort()) {
      if (!name.endsWith('.pine') && !name.endsWith('.txt')) continue
      if (ONLY && !ONLY.has(name)) continue
      out.push({ dir: path.relative(REPO, dir).split(path.sep).join('/'), name, file: path.join(dir, name) })
    }
  }
  return out
}

function runtimeColumns(source, bars) {
  try {
    const built = buildRuntimeIr(source, {
      bars, inputs: {}, objectTrees: [], basePeriod: 'D', newestBarIsForming: false,
      interpretOpts: { tf: 'D', newestBarIsForming: false },
    })
    if (!built.ok) return { refused: (built.refusal && built.refusal.guard) || 'refused' }
    const program = lowerIrProgram(built.ir)
    const series = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(bars.map((b) => b[k])))
    const res = execute(program, {
      bars: bars.length, series, columns: program.columns, confirmed: true,
      barTimes: bars.map((b) => b.t),
    })
    return { outputs: program.outputs.map((o, k) => ({ call: o.call, col: res.outputs[k] })) }
  } catch (err) {
    return { refused: `threw:${String((err && err.message) || err).slice(0, 60)}` }
  }
}

/** Same number, or both not-a-number. A plotshape/plotchar is a mark or no
 *  mark: 0 and `na` both draw nothing, on both sides. */
function agreeOn(kind, a, b) {
  if (kind === 'plotshape' || kind === 'plotchar') {
    const ma = Number.isFinite(a) && a !== 0
    const mb = Number.isFinite(b) && b !== 0
    return ma === mb
  }
  if (!Number.isFinite(a) && !Number.isFinite(b)) return true
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b))
}

describe.skipIf(!RUN)('var-read-order census (opt-in)', () => {
  it('compares every columnar output with the runtime lane', () => {
    const cap = JSON.parse(fs.readFileSync(BARS_FILE, 'utf8'))
    const bars = cap.bars.rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
    const all = scripts()
    expect(all.length).toBeGreaterThan(0)
    const rows = []
    for (const s of all) {
      const source = fs.readFileSync(s.file, 'utf8')
      let t
      try {
        t = translatePine(source, { strict: true, basePeriod: 'D' })
      } catch (err) {
        rows.push({ dir: s.dir, name: s.name, threw: String(err && err.message).slice(0, 80) })
        continue
      }
      const rt = runtimeColumns(source, bars)
      const rtByKind = {}
      for (const o of rt.outputs || []) (rtByKind[o.call] = rtByKind[o.call] || []).push(o.col)
      const seen = {}
      const outputs = (t.outputs || []).map((o) => {
        const k = o.kind
        const ord = (seen[k] = (seen[k] || 0) + 1) - 1
        const row = { kind: k, title: o.title || null, ord }
        if (!o.formula) { row.refused = (o.refusal && o.refusal.guard) || 'none'; return row }
        row.text = sha(o.formula)
        row.len = o.formula.length
        let col
        try {
          col = Array.from(interpret(parseFormula(o.formula).ast, bars, {}, undefined, undefined,
            { tf: 'D', newestBarIsForming: false }))
        } catch (err) {
          row.evalError = String(err && err.message).slice(0, 60)
          return row
        }
        row.values = sha(col.map((v) => (Number.isFinite(v) ? v.toPrecision(12) : 'na')).join(','))
        const ref = rtByKind[k] && rtByKind[k][ord]
        if (!ref) { row.runtime = rt.refused || 'no-output'; return row }
        let cmp = 0; let ok = 0; let first = null
        for (let i = FROM_BAR; i < bars.length; i++) {
          cmp += 1
          if (agreeOn(k, col[i], ref[i])) ok += 1
          else if (first === null) first = { bar: i, ours: col[i], runtime: ref[i] }
        }
        row.runtime = { cmp, ok, first }
        return row
      })
      rows.push({
        dir: s.dir, name: s.name, ok: t.ok, refusals: (t.refusals || []).map((r) => r.guard),
        runtime: rt.refused ? { refused: rt.refused } : { outputs: (rt.outputs || []).length },
        outputs,
      })
    }
    fs.writeFileSync(OUT, JSON.stringify({ scripts: rows.length, fromBar: FROM_BAR, rows }, null, 1))
    // eslint-disable-next-line no-console
    console.log(`var-read census -> ${OUT} (${rows.length} scripts)`)
  }, 1800000)
})

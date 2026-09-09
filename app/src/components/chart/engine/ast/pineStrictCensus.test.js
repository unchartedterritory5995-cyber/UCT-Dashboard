// app/src/components/chart/engine/ast/pineStrictCensus.test.js
//
// ─── ⭐⭐⭐ THE TWO NUMBERS, AND WHY ONLY ONE OF THEM MOVED ─────────────
//
// This corpus is a REGRESSION NET, never a target. What it is asked here is one
// question: how many of 169 real scripts does each door read COMPLETELY.
//
// ⛔⛔ THE ANSWER SURPRISED THE EXPECTATION AND THE MEASUREMENT WINS.
// `translatePine` fell 82 → 58 when strict mode landed. 25 scripts (30% of the
// scripts it used to accept) now refuse, for two reasons that are both real:
// most were SILENT PARTIALS — reported as successes while some of their plots
// came back with a `null` formula — and the rest lean on a `barstate.*` fold
// that is exact for a closed-bar screener and wrong on a pane's forming bar.
//
// `buildRuntimeIr` did NOT move: 27 before, 27 after, and 0 scripts where it
// built a program while dropping a plot the source declares. It never had the
// defect, because it is all-or-nothing by construction — it lowers the whole
// script or refuses. So "27 executing end-to-end" was always honest, and the
// number to carry forward is still 27.
//
// ⭐ THE HOSTING BASELINE IS THE INTERSECTION, and it is also 27: every script
// that builds a runtime program also translates strictly. The two failure modes
// do not overlap at all, which is worth knowing — fixing the lenient bug bought
// no reach, and was never going to.
//
// ⚠️ `declaredPlots` IS A SOURCE REGEX, and it is a proxy. It counts plot-ish
// call sites in the text to ask "did the runtime drop any of them". It will
// miscount a multi-line `plot(` or one inside a comment. It is here to detect a
// PARTIAL, not to be an authority on plot counts — and it reports zero, which is
// the claim being made.

import { it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from './pine.js'
import { buildRuntimeIr } from './pineRuntimeFrontend.js'

const CORPORA = [
  ['oos1', '../tests/fixtures/pine_oos'],
  ['blind', '../tests/fixtures/pine_blind'],
  ['community', '../tests/fixtures/pine_community'],
  ['parity', '../tests/fixtures/oos2_parity'],
  ['curated', '../tests/fixtures/pine'],
]
const N = 120
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400, o: 100 + i, h: 102 + i, l: 98 + i,
  c: 100 + Math.sin(i / 3) * 8 + i * 0.4, v: 1e6 + i * 1000,
}))
/** How many plot-ish outputs the SCRIPT declares, counted from its own source. */
const declaredPlots = (src) => (src.match(/^\s*(?:\w+\s*=\s*)?(?:plot|plotshape|plotchar|plotarrow|plotcandle|plotbar|alertcondition)\s*\(/gm) || []).length

it('strict census', () => {
  const rows = []
  for (const [label, rel] of CORPORA) {
    const dir = path.resolve(process.cwd(), rel)
    if (!fs.existsSync(dir)) continue
    for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.pine')).sort()) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8')
      const row = { corpus: label, name: f }
      try { const l = translatePine(src); row.lenient = l.ok; row.outs = (l.outputs||[]).length; row.nulls = (l.outputs||[]).filter(o=>o.formula==null).length }
      catch (e) { row.lenient = false; row.threw = 'translate' }
      try { row.strict = translatePine(src, { strict: true }).ok } catch (e) { row.strict = false }
      try { const b = buildRuntimeIr(src, { bars: BARS, inputs: {} }); row.rt = b.ok; row.rtOuts = b.ok ? (b.ir.outputs||[]).length : 0 }
      catch (e) { row.rt = false; row.threw = (row.threw||'') + '|runtime' }
      row.declared = declaredPlots(src)
      rows.push(row)
    }
  }
  const n = rows.length
  const lenientOk = rows.filter(r => r.lenient).length
  const strictOk = rows.filter(r => r.strict).length
  const rtOk = rows.filter(r => r.rt).length
  // runtime STRICT: built a program AND produced an output for every plot the script declares
  const rtStrict = rows.filter(r => r.rt && r.declared > 0 && r.rtOuts >= r.declared).length
  const rtPartial = rows.filter(r => r.rt && r.declared > 0 && r.rtOuts < r.declared)
  const lenientButNotStrict = rows.filter(r => r.lenient && !r.strict)
  console.log(JSON.stringify({
    scripts: n,
    translate_lenient_ok: lenientOk,
    translate_strict_ok: strictOk,
    translate_lenient_only: lenientButNotStrict.length,
    runtime_ok: rtOk,
    runtime_ok_and_all_plots_present: rtStrict,
    runtime_ok_but_dropped_plots: rtPartial.length,
    HOSTABLE_strict_translate_AND_runtime: rows.filter(r => r.strict && r.rt).length,
    runtime_ok_but_translate_lenient_only: rows.filter(r => r.rt && r.lenient && !r.strict).length,
  }, null, 1))
  console.log('\n-- lenient-but-not-strict (silent partials), first 12 --')
  for (const r of lenientButNotStrict.slice(0, 12)) console.log(`   ${r.corpus}/${r.name}  outputs=${r.outs} null=${r.nulls}`)
  console.log('\n-- runtime ok but DROPPED plots, first 12 --')
  for (const r of rtPartial.slice(0, 12)) console.log(`   ${r.corpus}/${r.name}  declared=${r.declared} emitted=${r.rtOuts}`)
})

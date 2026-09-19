// app/src/components/chart/engine/ast/historyDemandCensus.test.js
//
// ─── ⭐⭐ 2F-2 — HOW MUCH RUNTIME HISTORY DOES THE CORPUS ACTUALLY WANT? ─────
//
// §34 asks for the TOTAL demand, and warns against assuming the six scripts 2F-1
// happened to expose are the whole population. They are not, and the two numbers
// this instrument reports are different questions:
//
//   EARLIEST BLOCKER   how many scripts stop AT `runtime:history-variable` today.
//                      This is what the completion matrix reports, and it is a
//                      LOWER BOUND: a script blocked earlier on a tuple may want
//                      history just as badly and cannot say so yet.
//
//   SYNTACTIC DEMAND   how many scripts CONTAIN `x[n]` over a name the script
//                      itself mutates — measured from `pine.js`'s own lexer and
//                      `scanMutability`, independent of what stops them first.
//                      This is the population the capability finally serves.
//
// ⛔ IT PINS NO NUMBER. An instrument that asserts today's census freezes it
// (`lesson_an_arming_condition_that_names_a_test_expires`); the assertions here
// are non-vacuity and internal-consistency only — the report is the output.
//
//   HISTORY_CENSUS_OUT   write the JSON report here

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { lexPine, blockStatements } from './pine.js'
import { scanMutability, buildRuntimeIr } from './pineRuntimeFrontend.js'

const CORPORA = [
  ['oos1', '../tests/fixtures/pine_oos'],
  ['blind', '../tests/fixtures/pine_blind'],
  ['community', '../tests/fixtures/pine_community'],
  ['parity', '../tests/fixtures/oos2_parity'],
  ['curated', '../tests/fixtures/pine'],
]
const OUT = process.env.HISTORY_CENSUS_OUT
  ? path.resolve(process.cwd(), process.env.HISTORY_CENSUS_OUT) : null

const N = 120
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400, o: 100 + i, h: 101 + i, l: 99 + i, c: 100 + i, v: 1000 + i,
}))

/** Every `name[` where `name` is a token the script MUTATES.
 *
 *  ⭐ THE MUTABILITY SET IS `pineRuntimeFrontend`'s OWN, not a regex guess — the
 *  same pre-scan the front end routes on. A name the front end does not consider
 *  mutable is a COLUMN's history, which already works.
 *
 *  ⚠️ IT IS A SYNTACTIC MEASURE AND SAYS SO. It cannot see whether the offset is
 *  literal or dynamic, and it counts a shadowed name once. That is the right
 *  precision for sizing a wave; it is not evidence about any one script. */
function historyOverMutable(src) {
  let lexed
  try { lexed = lexPine(src) } catch { return null }
  let stmts
  try { stmts = blockStatements(lexed.tokens, lexed.indents, 0) } catch { return null }
  let mut
  try { mut = scanMutability(stmts) } catch { return null }
  const toks = lexed.tokens
  const hits = new Map()
  let maxLiteral = 0
  let dynamic = 0
  for (let i = 0; i < toks.length - 1; i += 1) {
    const t = toks[i]
    const nxt = toks[i + 1]
    if (!t || t.kind !== 'ident' || !mut.mutated.has(t.value)) continue
    if (!nxt || nxt.kind !== 'punct' || nxt.value !== '[') continue
    hits.set(t.value, (hits.get(t.value) || 0) + 1)
    // the offset token, when it is a bare number
    const off = toks[i + 2]
    const close = toks[i + 3]
    if (off && off.kind === 'number' && close && close.kind === 'punct' && close.value === ']') {
      maxLiteral = Math.max(maxLiteral, Number(off.value) || 0)
    } else {
      dynamic += 1
    }
  }
  return {
    names: [...hits.keys()].sort(),
    sites: [...hits.values()].reduce((s, v) => s + v, 0),
    maxLiteralOffset: maxLiteral,
    nonLiteralOffsets: dynamic,
    mutatedNames: mut.mutated.size,
    persistentNames: mut.persistent.size,
  }
}

const REPORT = { corpora: {}, totals: {} }
for (const [label, rel] of CORPORA) {
  const dir = path.resolve(process.cwd(), rel)
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.pine')).sort()
  const rows = files.map((f) => {
    const src = fs.readFileSync(path.join(dir, f), 'utf8')
    const demand = historyOverMutable(src)
    let blocker = 'EXECUTED'
    try {
      const built = buildRuntimeIr(src, { bars: BARS, inputs: {} })
      if (!built.ok) blocker = built.refusal.guard
    } catch (e) { blocker = 'frontend-threw' }
    return { name: f.replace(/\.pine$/, ''), blocker, demand }
  })
  REPORT.corpora[label] = {
    n: rows.length,
    earliestBlockerIsHistory: rows.filter((r) => r.blocker === 'runtime:history-variable').length,
    syntacticDemand: rows.filter((r) => r.demand && r.demand.sites > 0).length,
    unlexable: rows.filter((r) => r.demand === null).length,
    rows,
  }
}
const all = Object.values(REPORT.corpora)
REPORT.totals = {
  scripts: all.reduce((s, c) => s + c.n, 0),
  earliestBlockerIsHistory: all.reduce((s, c) => s + c.earliestBlockerIsHistory, 0),
  syntacticDemand: all.reduce((s, c) => s + c.syntacticDemand, 0),
  maxLiteralOffsetSeen: Math.max(0, ...all.flatMap((c) => c.rows.map(
    (r) => (r.demand ? r.demand.maxLiteralOffset : 0)))),
  scriptsWithNonLiteralOffset: all.reduce((s, c) => s + c.rows.filter(
    (r) => r.demand && r.demand.nonLiteralOffsets > 0).length, 0),
}
if (OUT) fs.writeFileSync(OUT, JSON.stringify(REPORT, null, 2))

describe('2F-2 — runtime history demand across every corpus', () => {
  it('reports both numbers, and they are different questions', () => {
    /* eslint-disable no-console */
    console.log(`\n  ${'corpus'.padEnd(11)} ${'n'.padStart(3)}  earliest-blocker  syntactic-demand`)
    for (const [label, c] of Object.entries(REPORT.corpora)) {
      console.log(`  ${label.padEnd(11)} ${String(c.n).padStart(3)}  `
        + `${String(c.earliestBlockerIsHistory).padStart(16)}  ${String(c.syntacticDemand).padStart(16)}`)
    }
    console.log(`  ${'TOTAL'.padEnd(11)} ${String(REPORT.totals.scripts).padStart(3)}  `
      + `${String(REPORT.totals.earliestBlockerIsHistory).padStart(16)}  `
      + `${String(REPORT.totals.syntacticDemand).padStart(16)}`)
    console.log(`\n  deepest literal offset over a mutable name: ${REPORT.totals.maxLiteralOffsetSeen}`)
    console.log(`  scripts with a NON-literal offset:          ${REPORT.totals.scriptsWithNonLiteralOffset}`)
    /* eslint-enable no-console */
    expect(REPORT.totals.scripts).toBeGreaterThan(150)
  })

  it('⛔ the syntactic measure is a SUPERSET of the earliest-blocker measure', () => {
    // ⭐ THE INTERNAL-CONSISTENCY CHECK THAT MAKES THE REPORT TRUSTWORTHY. Every
    // script whose earliest blocker IS history must contain history over a
    // mutable name — if one did not, the front end and this instrument would
    // disagree about what `runtime:history-variable` means, and the census would
    // be measuring something other than the capability being built.
    const contradictions = []
    for (const [label, c] of Object.entries(REPORT.corpora)) {
      for (const r of c.rows) {
        if (r.blocker !== 'runtime:history-variable') continue
        if (!r.demand || r.demand.sites === 0) contradictions.push(`${label}/${r.name}`)
      }
    }
    expect(contradictions).toEqual([])
    expect(REPORT.totals.syntacticDemand)
      .toBeGreaterThanOrEqual(REPORT.totals.earliestBlockerIsHistory)
  })

  it('⛔ NON-VACUITY — the measure discriminates, on sources with a known answer', () => {
    expect(historyOverMutable('//@version=5\nindicator("t")\nvar x = 0.0\nx := close\nplot(x[1])\n'))
      .toMatchObject({ names: ['x'], sites: 1, maxLiteralOffset: 1 })
    // a COLUMN's history is not this capability — `close` is not mutated
    expect(historyOverMutable('//@version=5\nindicator("t")\nplot(close[1])\n'))
      .toMatchObject({ names: [], sites: 0 })
    // depth is read, not assumed
    expect(historyOverMutable('//@version=5\nindicator("t")\nvar x = 0.0\nx := close\nplot(x[7])\n'))
      .toMatchObject({ maxLiteralOffset: 7 })
    // a non-literal offset is COUNTED SEPARATELY, never folded into the depth
    expect(historyOverMutable('//@version=5\nindicator("t")\nn = 3\nvar x = 0.0\nx := close\nplot(x[n])\n'))
      .toMatchObject({ sites: 1, maxLiteralOffset: 0, nonLiteralOffsets: 1 })
  })
})

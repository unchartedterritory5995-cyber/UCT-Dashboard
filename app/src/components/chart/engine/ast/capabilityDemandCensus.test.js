// app/src/components/chart/engine/ast/capabilityDemandCensus.test.js
//
// ─── ⭐⭐⭐ FIRST BLOCKER IS NOT DEMAND (§7) ─────────────────────────────────
//
// The completion matrix has always priced a capability by "how many scripts stop
// HERE today". That number is structurally a LOWER BOUND, because an earlier gap
// hides everything behind it — and this wave measured the gap twice:
//
//   runtime history   first blocker  7   ·  actually used by  35
//   `else if`         first blocker  1   ·  actually used by  30
//
// Thirty times. A capability the matrix priced at one script was the difference
// between working and not for a fifth of the corpus.
//
// ⛔ SO EVERY FAMILY GETS TWO NUMBERS FROM NOW ON. This instrument reports:
//
//   TOTAL_DEMAND    the construct is PRESENT in the source, whatever stops the
//                   script first. This is what completion actually costs.
//   FIRST_BLOCKER   the script stops here today. This is what the next wave
//                   would clear, and nothing more.
//
// ⚠️ THE DETECTORS ARE SYNTACTIC AND SAY SO. They run over `pine.js`'s own lexer
// (so a keyword inside a comment or a string cannot be counted) but they do not
// type-check: `array.new` in a branch that never executes is still demand, and a
// windowed call over a mutated name is matched by NAME INTERSECTION rather than
// by dataflow. That is the right precision for SIZING A WAVE and it is not
// evidence about any one script — which is exactly what the earliest-blocker
// number was being used for, wrongly.
//
// ⛔ IT PINS NO NUMBER (`lesson_an_arming_condition_that_names_a_test_expires`).
// The assertions are non-vacuity and internal consistency; the report is the
// output.
//
//   CAPABILITY_CENSUS_OUT   write the JSON report here

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { lexPine, blockStatements } from './pine.js'
import { scanMutability, buildRuntimeIr } from './pineRuntimeFrontend.js'
import { TABLE, isPointwise } from './parse.js'

const CORPORA = [
  ['oos1', '../tests/fixtures/pine_oos'],
  ['blind', '../tests/fixtures/pine_blind'],
  ['community', '../tests/fixtures/pine_community'],
  ['parity', '../tests/fixtures/oos2_parity'],
  ['curated', '../tests/fixtures/pine'],
]
const OUT = process.env.CAPABILITY_CENSUS_OUT
  ? path.resolve(process.cwd(), process.env.CAPABILITY_CENSUS_OUT) : null

const N = 120
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400, o: 100 + i, h: 101 + i, l: 99 + i, c: 100 + i, v: 1000 + i,
}))

/** Which closed-table functions are NOT pointwise — the series-shaped ones. Read
 *  from the table rather than listed here, so the census cannot drift from the
 *  engine's own classification the way a hand-typed roster would. */
const WINDOWED = new Set(Object.keys(TABLE.functions).filter((k) => !isPointwise(TABLE.functions[k])))

const ident = (t) => t && t.kind === 'ident'
const punct = (t, v) => t && t.kind === 'punct' && t.value === v

/** Every capability detector, over one script's tokens + statement tree.
 *  Each returns a count of SITES; a script counts as demanding the family when
 *  its count is > 0. */
function detect(src) {
  let lexed; let stmts; let mut
  try {
    lexed = lexPine(src)
    stmts = blockStatements(lexed.tokens, lexed.indents, 0)
    mut = scanMutability(stmts)
  } catch (e) { return null }
  const T = lexed.tokens
  const mutated = mut.mutated
  const d = {}
  const bump = (k, n = 1) => { d[k] = (d[k] || 0) + n }

  // ⭐ USER FUNCTION NAMES, collected first — because "fed by runtime state" is
  // wider than "mentions a mutated name". `needsRuntime` in the front end routes
  // a subtree to the runtime if it reads a slot OR CALLS A UDF, so a windowed
  // call over a helper's result refuses `call-windowed-state` in a script with
  // ZERO mutated names. ⚰️ The first draft of this detector missed exactly that
  // and reported DEMAND 4 against FIRST_BLOCKER 11 — an impossible ordering that
  // the internal-consistency rail below caught. A detector narrower than the
  // guard it is compared against does not under-report politely; it inverts the
  // relationship the whole instrument exists to show.
  const udfNames = new Set()
  const collectUdfs = (list) => {
    for (const st of list) {
      const h = st.header || []
      for (let k = 0; k < h.length; k += 1) {
        if (punct(h[k], '=>')) { if (ident(h[0])) udfNames.add(h[0].value); break }
      }
      if (st.sub && st.sub.length) collectUdfs(st.sub)
    }
  }
  collectUdfs(stmts)
  const runtimeProduced = (name) => mutated.has(name) || udfNames.has(name)

  // statement-tree walks (indent-aware, so `else if` is a HEADER not a substring)
  const walk = (list) => {
    for (const st of list) {
      const h = st.header || []
      const w = ident(h[0]) ? h[0].value : null
      if (w === 'else' && ident(h[1]) && h[1].value === 'if') bump('elseIf')
      if (w === 'if') bump('if')
      if (w === 'for') bump('loop')
      if (w === 'while') bump('loop')
      if (w === 'switch') bump('switch')
      if (w === 'type') bump('udt')
      if (w === 'var' || w === 'varip') bump('state')
      if (w === 'varip') bump('varip')
      // `f(x) =>` at the head of a statement is a user function definition
      // the lexer emits `=>` as ONE punct token, not `=` then `>`
      for (let k = 0; k < h.length; k += 1) if (punct(h[k], '=>')) { bump('udf'); break }
      if (punct(h[0], '[')) bump('tuple')
      if (st.sub && st.sub.length) walk(st.sub)
    }
  }
  walk(stmts)

  for (let i = 0; i < T.length; i += 1) {
    const t = T[i];
    const nxt = T[i + 1]
    if (!ident(t)) continue
    const v = t.value
    if (punct(nxt, ':') || punct(nxt, '=')) { /* fallthrough */ }
    // `:=` reassignment
    if (punct(nxt, ':=')) bump('state')
    // namespaced families — the namespace token is lexed as one ident with a dot
    if (/^request\./.test(v)) bump('mtf')
    if (/^(array|matrix|map)\./.test(v)) bump('collection')
    if (/^(line|label|box|table|polyline|linefill)\./.test(v)) bump('object')
    if (/^str\./.test(v)) bump('text')
    if (v === 'int' || v === 'float' || v === 'bool') { if (punct(nxt, '(')) bump('conversion') }
    if (/^(plot|plotshape|plotchar|plotarrow|plotcandle|plotbar|fill|bgcolor|barcolor|hline|alertcondition|alert)$/.test(v)
      && punct(nxt, '(')) bump('presentation')
    // history over a MUTATED name
    if (punct(nxt, '[') && mutated.has(v)) bump('history')
    // a WINDOWED table function anywhere — the total surface, regardless of what
    // feeds it
    const bare = v.replace(/^(ta|math)\./, '')
    if (WINDOWED.has(bare) && punct(nxt, '(')) bump('windowedBuiltin')
  }

  // ── ⭐⭐ WINDOWED-OVER-RUNTIME-STATE NEEDS SCOPE, NOT A FLAT TOKEN SCAN ──
  //
  // ⚰️⚰️ THE FIRST TWO DRAFTS OF THIS DETECTOR HAD **ZERO OVERLAP** WITH THE
  // SCRIPTS THAT ACTUALLY BLOCK ON `runtime:call-windowed-state`. It flagged six
  // scripts; the guard fires on eleven; not one was in both sets. Measuring the
  // overlap — rather than trusting that "demand 6 vs blocker 11" was mild
  // under-reporting — is what exposed it.
  //
  // ⭐ AND THE REAL SHAPE IS THE FINDING. The guard is dominated by windowed
  // calls INSIDE A UDF BODY over that function's PARAMETERS — `HMA(src, len) =>
  // wma(src, len)` — not by windowed calls over a top-level `var`. A parameter is
  // a frame slot, so `needsRuntime` routes it to the runtime lane exactly as a
  // mutated global would. That makes 2F-2B's real target "a finite window over a
  // series produced inside a call frame", which is a harder shape than the
  // top-level one and would have been mis-sized by the flat scan.
  const windowedOver = (list, runtimeNames) => {
    for (const st of list) {
      const h = st.header || []
      // a UDF definition introduces its parameters as runtime-produced names
      let inner = runtimeNames
      const arrow = h.findIndex((t) => punct(t, '=>'))
      if (arrow > 0) {
        inner = new Set(runtimeNames)
        for (let k = 1; k < arrow; k += 1) if (ident(h[k])) inner.add(h[k].value)
      }
      const scan = (toks, names) => {
        for (let k = 0; k < toks.length - 1; k += 1) {
          const t = toks[k]
          if (!ident(t) || !punct(toks[k + 1], '(')) continue
          if (!WINDOWED.has(t.value.replace(/^(ta|math)\./, ''))) continue
          let depth = 0
          for (let j = k + 1; j < toks.length; j += 1) {
            if (punct(toks[j], '(')) depth += 1
            else if (punct(toks[j], ')')) { depth -= 1; if (depth === 0) break }
            else if (ident(toks[j]) && names.has(toks[j].value)) { bump('windowedOverState'); break }
          }
        }
      }
      scan(h, inner)
      if (st.sub && st.sub.length) windowedOver(st.sub, inner)
    }
  }
  windowedOver(stmts, new Set([...mutated, ...udfNames]))
  return d
}

const FAMILIES = ['state', 'history', 'udf', 'elseIf', 'switch', 'loop', 'tuple', 'collection',
  'object', 'mtf', 'text', 'conversion', 'presentation', 'udt', 'varip',
  'windowedBuiltin', 'windowedOverState']

/** The refusal family a first blocker belongs to, so the two numbers can be put
 *  side by side. ⚠️ A MAPPING, not an equality: `pine:block` covers several
 *  constructs, so a family with no listed guard reports FIRST_BLOCKER 0 rather
 *  than pretending. */
const GUARD_FOR = {
  history: ['runtime:history-variable', 'runtime:history-expression',
    'runtime:history-dynamic-offset', 'runtime:history-function-local'],
  loop: ['runtime:loop'],
  tuple: ['runtime:tuple'],
  collection: ['runtime:array', 'pine:collection'],
  object: ['runtime:object-op', 'pine:drawing'],
  mtf: ['runtime:request-with-state', 'pine:request'],
  text: ['runtime:call-text-state', 'pine:text-value'],
  conversion: ['runtime:call-conversion-state'],
  presentation: ['runtime:presentation'],
  udt: ['runtime:udt'],
  varip: ['runtime:varip'],
  switch: ['runtime:switch'],
  udf: ['runtime:function', 'runtime:function-global-state'],
  windowedOverState: ['runtime:call-windowed-state'],
}

const rows = []
for (const [label, rel] of CORPORA) {
  const dir = path.resolve(process.cwd(), rel)
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.pine')).sort()) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8')
    let blocker = 'EXECUTED'
    try {
      const b = buildRuntimeIr(src, { bars: BARS, inputs: {} })
      if (!b.ok) blocker = b.refusal.guard
    } catch (e) { blocker = 'frontend-threw' }
    rows.push({ corpus: label, name: f.replace(/\.pine$/, ''), blocker, d: detect(src) })
  }
}

const REPORT = { scripts: rows.length, families: {} }
for (const fam of FAMILIES) {
  const demand = rows.filter((r) => r.d && (r.d[fam] || 0) > 0)
  const guards = GUARD_FOR[fam] || []
  const first = rows.filter((r) => guards.includes(r.blocker))
  REPORT.families[fam] = {
    totalDemand: demand.length,
    totalSites: demand.reduce((s, r) => s + r.d[fam], 0),
    firstBlocker: guards.length ? first.length : null,
    executedWithDemand: demand.filter((r) => r.blocker === 'EXECUTED').length,
    byCorpus: Object.fromEntries(CORPORA.map(([l]) => [l, demand.filter((r) => r.corpus === l).length])),
  }
}
REPORT.executed = rows.filter((r) => r.blocker === 'EXECUTED').length
if (OUT) fs.writeFileSync(OUT, JSON.stringify({ report: REPORT, rows }, null, 2))

describe('⭐⭐⭐ capability demand — total, not just first blocker (§7)', () => {
  it('reports both numbers for every family', () => {
    /* eslint-disable no-console */
    const p = (v, w) => String(v === null ? '—' : v).padStart(w)
    console.log(`\n  ${rows.length} scripts, ${REPORT.executed} executing end-to-end\n`)
    console.log(`  ${'family'.padEnd(19)}${'DEMAND'.padStart(7)}${'sites'.padStart(7)}`
      + `${'1st-blk'.padStart(9)}${'exec'.padStart(6)}   hidden`)
    console.log('  ' + '-'.repeat(62))
    for (const fam of FAMILIES) {
      const f = REPORT.families[fam]
      const hidden = f.firstBlocker === null ? '—' : (f.totalDemand - f.firstBlocker)
      console.log(`  ${fam.padEnd(19)}${p(f.totalDemand, 7)}${p(f.totalSites, 7)}`
        + `${p(f.firstBlocker, 9)}${p(f.executedWithDemand, 6)}   ${hidden}`)
    }
    /* eslint-enable no-console */
    expect(REPORT.scripts).toBeGreaterThan(150)
  })

  it('⛔ DEMAND is a superset of FIRST BLOCKER for every family that has a guard', () => {
    // ⭐ THE INTERNAL-CONSISTENCY CHECK. If a family ever reported more scripts
    // stopping at its guard than contain the construct at all, the detector and
    // the front end would disagree about what the family IS — and the report
    // would be measuring something other than the capability.
    const bad = []
    for (const fam of FAMILIES) {
      const f = REPORT.families[fam]
      if (f.firstBlocker === null) continue
      if (f.firstBlocker > f.totalDemand) bad.push(`${fam}: first ${f.firstBlocker} > demand ${f.totalDemand}`)
    }
    expect(bad).toEqual([])
  })

  it('⛔ NON-VACUITY — the detectors discriminate, on sources with a known answer', () => {
    const head = '//@version=5\nindicator("t")\n'
    expect(detect(`${head}var x = 0.0\nif close > 1\n    x := 1\nelse if close > 2\n    x := 2\nplot(x)\n`).elseIf).toBe(1)
    expect(detect(`${head}var x = 0.0\nif close > 1\n    x := 1\nelse\n    x := 2\nplot(x)\n`).elseIf).toBeUndefined()
    expect(detect(`${head}var x = 0.0\nx := close\nplot(x[1])\n`).history).toBe(1)
    expect(detect(`${head}plot(close[1])\n`).history).toBeUndefined()
    expect(detect(`${head}f(a) => a * 2\nplot(f(close))\n`).udf).toBe(1)
    expect(detect(`${head}for i = 0 to 3\n    a = i\nplot(close)\n`).loop).toBe(1)
    expect(detect(`${head}var x = 0.0\nx := close\nplot(ta.sma(x, 5))\n`).windowedOverState).toBe(1)
    expect(detect(`${head}plot(ta.sma(close, 5))\n`).windowedOverState).toBeUndefined()
    // ⛔ a keyword inside a COMMENT or a STRING is not demand — the detector runs
    // over the lexer's tokens, which is why this is true rather than hoped.
    expect(detect(`${head}// else if this were a regex it would count\nplot(close)\n`).elseIf).toBeUndefined()
    expect(detect(`${head}plot(close, "else if")\n`).elseIf).toBeUndefined()
  })

  it('⭐⭐ the two numbers genuinely differ — which is the whole point', () => {
    // If DEMAND and FIRST_BLOCKER agreed everywhere, this instrument would be
    // redundant and the matrix would have been right all along. They do not.
    const gaps = FAMILIES
      .map((f) => ({ f, ...REPORT.families[f] }))
      .filter((x) => x.firstBlocker !== null && x.totalDemand > x.firstBlocker)
    expect(gaps.length, 'families whose demand exceeds their first-blocker count').toBeGreaterThan(3)
  })
})

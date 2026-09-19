// app/src/components/chart/engine/ast/runtimeFrontendCoverage.test.js
//
// ─── ⭐⭐ 2D-2 COVERAGE — where real scripts get to now ──────────────────────
//
// §37's metric, and it is the one that matters during a runtime foundation:
// acceptance is the wrong number while the dependency block is open (§48), so
// this measures HOW FAR each real script travels and WHAT STOPS IT.
//
//   PARSED          the shared lexer + statement tree read it
//   LOWERED         it became a semantic IR program
//   EXECUTABLE      the IR lowered to a runnable program
//   BLOCKED BY X    the exact next capability family
//
// ⛔ THIS IS A MEASUREMENT INSTRUMENT FIRST. Its assertions are non-vacuity only
// — it must not pin numbers a wave has not yet adjudicated
// (`lesson_an_arming_condition_that_names_a_test_expires`).
//
//   RUNTIME_CORPUS_DIR   corpus to measure (default: the frozen OOS-1 corpus)
//   RUNTIME_COVERAGE_OUT where to write the JSON report

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { translatePine } from './pine.js'
import { parseFormula } from './parse.js'
import { interpret } from './interpret.js'
import { buildRuntimeIr } from './pineRuntimeFrontend.js'
import { lowerIrProgram } from '../runtime/lowerIr.js'
import { execute } from '../runtime/vm.js'

const DIR = path.resolve(process.cwd(), process.env.RUNTIME_CORPUS_DIR || '../tests/fixtures/pine_oos')
const OUT = process.env.RUNTIME_COVERAGE_OUT
  ? path.resolve(process.cwd(), process.env.RUNTIME_COVERAGE_OUT) : null

const N = 120
const BARS = (() => {
  const out = []
  let p = 100
  for (let i = 0; i < N; i += 1) {
    p += Math.sin(i / 5) * 1.2 + Math.cos(i / 11) * 0.5
    out.push({ t: 1700000000 + i * 86400, o: p - 0.3, h: p + 1, l: p - 1, c: p, v: 1000 + i })
  }
  return out
})()
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))

const FILES = fs.readdirSync(DIR).filter((f) => f.endsWith('.pine')).sort()

const ROWS = FILES.map((f) => {
  const name = f.replace(/\.pine$/, '')
  const src = fs.readFileSync(path.join(DIR, f), 'utf8')

  // What the SHIPPED door says today.
  let before = null
  try {
    const t = translatePine(src)
    before = t.ok ? null : (t.refusal ? t.refusal.guard : 'unknown')
  } catch (e) { before = 'threw' }

  // What the new front end says.
  let stage = 'lowered'
  let after = null
  let built = null
  try {
    built = buildRuntimeIr(src, { bars: BARS, inputs: {} })
  } catch (e) {
    return { name, before, after: 'frontend-threw', stage: 'parsed', detail: String(e.message).slice(0, 160) }
  }
  if (!built.ok) {
    return { name, before, after: built.refusal.guard, stage: 'parsed', detail: String(built.refusal.message).slice(0, 160) }
  }
  try {
    const program = lowerIrProgram(built.ir)
    stage = 'executable'
    execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true })
    stage = 'executed'
  } catch (e) {
    after = e.kind ? `lowering:${e.kind}` : `execute:${e.name}`
    return { name, before, after, stage, detail: String(e.message).slice(0, 160) }
  }
  // ⭐⭐ AND IF IT EXECUTED, IS IT RIGHT? (§32) Executing is not transferring.
  // For a script the SHIPPED door also accepts, both lanes describe the same
  // indicator, so the runtime's first output must equal the columnar lane's —
  // and a difference here is a silent wrong number, the one outcome that would
  // make this wave a regression rather than progress.
  let differential = null
  try {
    const t = translatePine(src)
    if (t.ok) {
      const shipped = t.outputs || []
      // ⚰️⚰️ PAIRED BY INDEX, AND THE FIRST DRAFT WAS NOT. It took the shipped
      // door's first NON-HIDDEN output and compared it to the runtime's first
      // SOURCE-ORDER output — on `02-wavetrend-oscillator-lazybear` that is
      // output 5 against output 0, and it reported `worst: 54` as though the
      // runtime were wrong. It was the rail that was wrong. A differential that
      // compares two different things is worse than none: it manufactures
      // findings and, on the day a real one appears, has already taught everyone
      // to discount it.
      //
      // ⛔ SO THE COUNTS MUST MATCH BEFORE ANYTHING IS COMPARED. Different
      // rosters mean the two lanes disagree about WHAT THE OUTPUTS ARE, which is
      // a structural fact worth recording separately — never something to paper
      // over by picking whichever pair happens to line up.
      const program = lowerIrProgram(built.ir)
      const { outputs } = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true })
      if (shipped.length !== outputs.length) {
        differential = { rosterMismatch: `${shipped.length} shipped vs ${outputs.length} runtime` }
      } else {
        let worst = 0
        let nanMismatch = 0
        let compared = 0
        for (let k = 0; k < shipped.length; k += 1) {
          const row = shipped[k]
          if (!row || !row.formula || row.refusal) continue
          const parsed = parseFormula(row.formula)
          if (!parsed.ok) continue
          const columnar = interpret(parsed.ast, BARS, {})
          const mine = outputs[k]
          compared += 1
          for (let i = 0; i < N; i += 1) {
            const a = typeof columnar === 'number' ? columnar : columnar[i]
            const b = mine[i]
            if (Number.isNaN(a) !== Number.isNaN(b)) { nanMismatch += 1; continue }
            if (!Number.isNaN(a)) worst = Math.max(worst, Math.abs(a - b))
          }
        }
        differential = compared ? { worst, nanMismatch, compared } : null
      }
    }
  } catch (e) { differential = { error: String(e.message).slice(0, 120) } }

  return {
    name, before, after: null, stage,
    slots: built.ir.slots.length, columns: built.ir.columns.length, differential,
  }
})

const count = (pred) => ROWS.filter(pred).length
const SUMMARY = {
  corpus: DIR,
  scripts: ROWS.length,
  executed: count((r) => r.stage === 'executed'),
  executableNotRun: count((r) => r.stage === 'executable'),
  loweredOnly: count((r) => r.stage === 'lowered'),
  stoppedAtFrontEnd: count((r) => r.stage === 'parsed'),
}
const byAfter = {}
for (const r of ROWS) {
  const k = r.after || 'EXECUTED'
  byAfter[k] = (byAfter[k] || 0) + 1
}
// The transition that matters: scripts the shipped door stops on state or
// reassignment, and where the runtime path takes them instead.
const STATE_BLOCKED = ROWS.filter((r) => r.before === 'pine:reassign' || r.before === 'pine:state')
const transitions = STATE_BLOCKED.map((r) => ({ name: r.name, before: r.before, after: r.after || 'EXECUTED', stage: r.stage }))

if (OUT) {
  fs.writeFileSync(OUT, JSON.stringify({ summary: SUMMARY, byAfter, transitions, rows: ROWS }, null, 2))
}

const DIFFED = ROWS.filter((r) => r.differential && r.differential.worst !== undefined)
const AGREE = DIFFED.filter((r) => r.differential.worst < 1e-9 && r.differential.nanMismatch === 0)

/** ⚰️⚰️ ONE KNOWN, NAMED DIVERGENCE — enumerated so everything else stays a hard
 *  gate. It is NOT a lowering bug and it is NOT (yet) a proven product defect.
 *
 *  `recency-pullback-down-streak` writes a run-length counter:
 *      var int downRun = 0
 *      downRun := close < close[1] ? downRun + 1 : 0
 *      plot(downRun >= n and inTrend and washed and notBroken ? 1 : 0)
 *
 *  The SHIPPED door rewrites `downRun >= 3` into the bounded identity
 *  `close < close[1] && (close < close[1])[1] && (close < close[1])[2]`. On bars
 *  0-1 the `[2]` term reads before history exists, so it is `na`, and this
 *  engine's `logical` PROPAGATES NaN by design (`nanLaundering.test.js` argues
 *  that choice deliberately) — the conjunction is `na` and the plot is `na`.
 *
 *  The RUNTIME keeps the actual counter: `close < na` is 0 (this engine's `cmp`
 *  answers 0, "the one place JS and Python agree by luck"), so `downRun` is 0,
 *  `0 >= 3` is 0, and `0 && anything` is 0. It plots 0.
 *
 *  ⛔ BOTH LANES ARE INTERNALLY CONSISTENT AND THE TIE IS PINE'S TO BREAK. Pine
 *  documents comparison against `na` as false, which would make the runtime
 *  right and put a two-bar warm-up difference into every script using the
 *  bounded run-length rewrite — but that is a claim about the VENDOR and this
 *  wave captured no vendor evidence. Recorded in the gap register as an open
 *  item for the §55 capture programme, exempted here BY NAME with its reason
 *  rather than by loosening the tolerance for everyone. */
const KNOWN_DIVERGENCE = Object.freeze({
  'recency-pullback-down-streak':
    'bounded run-length rewrite: `na` propagates through the shipped lane `&&` on bars 0-1 '
    + 'where the counter answers 0. Needs a vendor pin.',
})

describe('2D-2 — how far real Pine gets through the runtime front end', () => {
  it('reports the coverage ladder', () => {
    // eslint-disable-next-line no-console
    console.log(`\n  corpus ${path.basename(DIR)} — ${SUMMARY.scripts} scripts`)
    // eslint-disable-next-line no-console
    console.log(`  executed ${SUMMARY.executed} · stopped at front end ${SUMMARY.stoppedAtFrontEnd}`)
    // eslint-disable-next-line no-console
    console.log('  next blocker: ' + Object.entries(byAfter)
      .sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(' · '))
    expect(SUMMARY.scripts).toBeGreaterThan(0)
  })

  it('⭐⭐ where BOTH lanes describe the indicator, they agree', () => {
    // eslint-disable-next-line no-console
    console.log(`  differential: ${AGREE.length}/${DIFFED.length} agree to 1e-9`)
    const bad = DIFFED
      .filter((r) => !(r.differential.worst < 1e-9 && r.differential.nanMismatch === 0))
      .filter((r) => !KNOWN_DIVERGENCE[r.name])
      .map((r) => `${r.name} worst=${r.differential.worst} nan=${r.differential.nanMismatch}`)
    expect(bad, 'runtime disagrees with the columnar lane').toEqual([])
  })

  it('⛔ the known divergence is still THERE — an exemption nobody checks is a hole', () => {
    // If the exempted script starts agreeing, the exemption is stale and must be
    // deleted rather than left standing as permanent permission to differ.
    for (const name of Object.keys(KNOWN_DIVERGENCE)) {
      const row = ROWS.find((r) => r.name === name)
      if (!row || !row.differential || row.differential.worst === undefined) continue
      const agrees = row.differential.worst < 1e-9 && row.differential.nanMismatch === 0
      expect(agrees, `${name} now AGREES — delete its exemption`).toBe(false)
    }
  })

  it('⛔ every script reaches a NAMED outcome — none disappears', () => {
    for (const r of ROWS) {
      expect(typeof r.stage, r.name).toBe('string')
      if (r.stage !== 'executed') expect(r.after, r.name).toBeTruthy()
    }
  })

  it('⛔ no script is accepted by the runtime path while the shipped door refuses it for a reason the runtime does not model', () => {
    // A false acceptance is the one outcome that would make this whole wave a
    // regression: the runtime executing a program whose meaning it changed.
    for (const r of ROWS) {
      if (r.stage !== 'executed') continue
      // If the runtime executed it, the shipped door must not have refused it
      // for a VALUE-lane reason the runtime silently skipped.
      expect(['pine:reassign', 'pine:state', null, undefined]).toContain(r.before)
    }
  })
})

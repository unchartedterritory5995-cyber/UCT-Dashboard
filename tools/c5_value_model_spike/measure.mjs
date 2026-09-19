// tools/c5_value_model_spike/measure.mjs
//
// Agreement FIRST, then timing — the order C4 Phase 2A set, and the reason it
// could quote a 33x figure that meant something: two implementations that
// disagree are not two measurements of one thing.
//
//   node tools/c5_value_model_spike/measure.mjs
//   node tools/c5_value_model_spike/measure.mjs --self-check
//
// `--self-check` perturbs one candidate and proves the comparator REPORTS it. A
// comparator nobody has seen fail is not evidence of agreement.
import { buildProgram, buildSeries, OP, OUTPUT_COUNT, K } from './program.mjs'
import * as boxed from './vm_boxed.mjs'
import * as nanbox from './vm_nanbox.mjs'
import * as split from './vm_split.mjs'

const BARS = 5000
const REPEATS = 20

/** Bit-identical, NaN positions included. ⛔ NOT 1e-9: the arithmetic is the
 *  same in all three, so any difference is STRUCTURAL and a tolerance would hide
 *  exactly the off-by-one this control exists to catch. */
function compare(a, b) {
  const diffs = []
  for (let o = 0; o < OUTPUT_COUNT; o += 1) {
    const x = a.outputs[o]
    const y = b.outputs[o]
    for (let i = 0; i < x.length; i += 1) {
      const bothNaN = Number.isNaN(x[i]) && Number.isNaN(y[i])
      if (!bothNaN && x[i] !== y[i]) {
        diffs.push(`output ${o} bar ${i}: ${x[i]} vs ${y[i]}`)
        if (diffs.length > 4) return diffs
      }
    }
  }
  if (a.lastString !== b.lastString) diffs.push(`lastString: ${a.lastString} vs ${b.lastString}`)
  return diffs
}

function countInstructions(code, series, bars) {
  // One counting pass so "per instruction" means something. Uses the boxed VM's
  // shape; every candidate executes the same original triples.
  let n = 0
  for (let bar = 0; bar < bars; bar += 1) {
    let pc = 0
    let i = 0
    const stack = []
    // A cheap structural walk: follow the real control flow without doing work.
    while (pc < code.length) {
      const [op, a] = code[pc]
      n += 1
      if (op === OP.JMP) { pc = a; continue }
      if (op === OP.JMP_IF_FALSE) { pc = (i < K) ? pc + 1 : a; continue }
      if (op === OP.STORE && a === 2) i += 1                    // slot 2 is the loop counter
      if (op === OP.STORE && a === 0) i = 0
      pc += 1
      stack.length = 0
    }
  }
  return n
}

/**
 * Median of interleaved rounds.
 *
 * ⚰️ THE FIRST VERSION TIMED EACH CANDIDATE ONCE, IN ORDER, AFTER ONE WARM RUN —
 * and the ranking flipped between invocations: A fastest, then C, then C again
 * with A 1.37x behind. Run-to-run noise was larger than every difference being
 * reported, so each individual ranking was an artifact
 * (`lesson_two_points_do_not_establish_a_rate`).
 *
 * ⭐ THREE FIXES, ALL NECESSARY: warm until the JIT has tiered up, run ROUNDS
 * and take the median rather than a mean (one GC pause cannot then move the
 * answer), and INTERLEAVE the candidates across rounds so a machine that gets
 * slower during the measurement penalises all of them equally instead of
 * whichever ran last.
 */
function timeAll(entries, repeats, rounds = 7, warm = 5) {
  const samples = new Map(entries.map(([name]) => [name, []]))
  for (const [, fn] of entries) for (let w = 0; w < warm; w += 1) fn()
  for (let round = 0; round < rounds; round += 1) {
    for (const [name, fn] of entries) {
      const t0 = process.hrtime.bigint()
      for (let r = 0; r < repeats; r += 1) fn()
      const t1 = process.hrtime.bigint()
      samples.get(name).push(Number(t1 - t0) / repeats / 1e6)
    }
  }
  return entries.map(([name]) => {
    const xs = samples.get(name).slice().sort((a, b) => a - b)
    return [name, xs[Math.floor(xs.length / 2)], xs[0], xs[xs.length - 1]]
  })
}

/** A numeric-only program: the same recurrence and loop with no strings and no
 *  collections. ⭐ IT IS THE CONTROL FOR THE NUMERIC PATH — the question "what
 *  does this value model cost a script that never touches a string" has to be
 *  asked separately, or a mixed benchmark lets a candidate hide a tax on the
 *  common case. */
function buildNumericProgram() {
  const code = []
  const push = (...t) => { code.push(t); return code.length - 1 }
  push(OP.LOAD, 0, 0); push(OP.PUSH_CONST, 0, 0); push(OP.MUL, 0, 0)
  push(OP.PUSH_SERIES, 3, 0); push(OP.PUSH_CONST, 1, 0); push(OP.MUL, 0, 0)
  push(OP.ADD, 0, 0); push(OP.STORE, 0, 0)
  push(OP.PUSH_CONST, 2, 0); push(OP.STORE, 2, 0)
  const top = code.length
  push(OP.LOAD, 2, 0); push(OP.PUSH_CONST, 5, 0); push(OP.LT, 0, 0)
  const exit = push(OP.JMP_IF_FALSE, 0, 0)
  push(OP.PUSH_SERIES, 3, 0); push(OP.LOAD, 2, 0); push(OP.PUSH_CONST, 3, 0)
  push(OP.ADD, 0, 0); push(OP.MUL, 0, 0); push(OP.PUSH_CONST, 4, 0); push(OP.DIV, 0, 0)
  push(OP.STORE, 3, 0)
  push(OP.LOAD, 2, 0); push(OP.PUSH_CONST, 3, 0); push(OP.ADD, 0, 0); push(OP.STORE, 2, 0)
  push(OP.JMP, top, 0)
  code[exit] = [OP.JMP_IF_FALSE, code.length, 0]
  push(OP.LOAD, 0, 0); push(OP.EMIT, 0, 0)
  push(OP.LOAD, 3, 0); push(OP.EMIT, 1, 0)
  push(OP.LOAD, 3, 0); push(OP.EMIT, 2, 0)
  return code
}

const selfCheck = process.argv.includes('--self-check')
const code = buildProgram()
const series = buildSeries(BARS)

console.log('# Value-model spike — agreement first\n')

const survival = nanbox.payloadSurvival()
console.log('NaN payload survival (candidate B), on this engine:')
for (const [path, ok] of Object.entries(survival)) {
  console.log(`  ${path.padEnd(16)} ${ok ? 'SURVIVES' : 'LOST — payload did not come back'}`)
}
const survives = Object.values(survival).every(Boolean)
console.log(`  => ${survives ? 'B is representable here' : 'B IS OUT ON CORRECTNESS, whatever it times'}\n`)

const runs = {
  [boxed.NAME]: boxed.run(code, series, BARS),
  [split.NAME]: split.run(code, series, BARS),
}
if (survives) runs[nanbox.NAME] = nanbox.run(code, series, BARS)

if (selfCheck) {
  // ⛔ PROVE THE COMPARATOR CAN FAIL — on BOTH of its branches.
  //
  // ⚰️ The first version perturbed output 0 at the last bar by 1e-9 and the
  // comparator said nothing, which read exactly like a broken comparator. It was
  // not: that output was NaN there (the planted na had poisoned the recurrence),
  // and NaN-vs-NaN is a match by design. The perturbation has to land on a value
  // that is not NaN, and the NaN branch needs its own probe — a candidate that
  // turned `na` into 0 must be caught, and only this second perturbation proves
  // the comparator would catch it.
  const victim = Object.keys(runs)[1]
  runs[victim].outputs[1][BARS - 1] += 1e-9          // a finite value: the != branch
  const naBar = 3
  runs[victim].outputs[2][naBar] = Number.isNaN(runs[victim].outputs[2][naBar])
    ? 0                                              // na turned into 0: the NaN branch
    : NaN                                            // or a number turned into na
  console.log(`--self-check: perturbed "${victim}" — output 1 at the last bar (finite), and output 2 at bar ${naBar} (na boundary)`)
}

const names = Object.keys(runs)
let agreed = true
for (let i = 1; i < names.length; i += 1) {
  const diffs = compare(runs[names[0]], runs[names[i]])
  if (diffs.length) {
    agreed = false
    console.log(`DISAGREE: ${names[0]}\n      vs: ${names[i]}`)
    diffs.forEach((d) => console.log(`   ${d}`))
  }
}
console.log(agreed
  ? `AGREEMENT: ${names.length} candidates, ${BARS} bars, bit-identical outputs and identical strings.`
  : 'AGREEMENT: FAILED — no timing number below means anything until this is green.')
if (selfCheck) {
  console.log(agreed
    ? '\n--self-check FAILED: the comparator did not notice a perturbation.'
    : '\n--self-check OK: the comparator reported the perturbation.')
  process.exit(agreed ? 1 : 0)
}
if (!agreed) process.exit(1)

const instructions = countInstructions(code, series, BARS)
console.log(`\n# Timing — ${BARS} bars, ${K} inner iterations, ${instructions.toLocaleString()} instructions per run, ${REPEATS} repeats\n`)

const compiledSplit = split.compile(code)
const mixed = [
  [boxed.NAME, () => boxed.run(code, series, BARS)],
  [split.NAME, () => split.run(code, series, BARS, compiledSplit)],
]
if (survives) mixed.splice(1, 0, [nanbox.NAME, () => nanbox.run(code, series, BARS)])

const mixedResults = timeAll(mixed, REPEATS)
const fastest = Math.min(...mixedResults.map((r) => r[1]))
console.log('MIXED program (numbers + strings + collections) - median of 7 rounds, [min-max]:')
for (const [name, med, lo, hi] of mixedResults) {
  console.log(`  ${name.padEnd(46)} ${med.toFixed(1).padStart(7)} ms  [${lo.toFixed(1)}-${hi.toFixed(1)}]   ${((med * 1e6) / instructions).toFixed(1).padStart(5)} ns/ins   ${(med / fastest).toFixed(2)}x`)
}

const numCode = buildNumericProgram()
const numInstructions = countInstructions(numCode, series, BARS)
const compiledNum = split.compile(numCode)
const numeric = [
  [boxed.NAME, () => boxed.run(numCode, series, BARS)],
  [split.NAME, () => split.run(numCode, series, BARS, compiledNum)],
]
if (survives) numeric.splice(1, 0, [nanbox.NAME, () => nanbox.run(numCode, series, BARS)])

const numResults = timeAll(numeric, REPEATS)
const numFastest = Math.min(...numResults.map((r) => r[1]))
console.log('\nNUMERIC-ONLY control (what each model costs a script with no strings):')
for (const [name, med, lo, hi] of numResults) {
  console.log(`  ${name.padEnd(46)} ${med.toFixed(1).padStart(7)} ms  [${lo.toFixed(1)}-${hi.toFixed(1)}]   ${((med * 1e6) / numInstructions).toFixed(1).padStart(5)} ns/ins   ${(med / numFastest).toFixed(2)}x`)
}

if (survives) {
  const one = nanbox.run(code, series, BARS)
  console.log(`\nSide tables after one run (candidate B): ${one.sideTableSize.toLocaleString()} entries — every string and collection ever made, none reclaimed.`)
}

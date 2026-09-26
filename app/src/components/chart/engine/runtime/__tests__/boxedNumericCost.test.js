// app/src/components/chart/engine/runtime/__tests__/boxedNumericCost.test.js
//
// ─── WHAT BOXING COST, MEASURED ON THIS VM ──────────────────────────────────
//
// The value-model spike predicted ~1.2x on a numeric-only program when slots
// are boxed. That was a different VM — a standalone ISA in `tools/`, not this
// one. This records the real figure so the next reader has a measurement rather
// than a prediction, and so a later change that makes it much worse is caught.
//
// ⛔ THE ASSERTION IS A CEILING, NOT A COMPARISON. A tight timing assertion on
// a shared machine fails for reasons that have nothing to do with the code, and
// a test that fails for unrelated reasons gets muted — taking the real signal
// with it. This box runs six-shard gates and browser rigs concurrently; the
// ceiling is set where only a real collapse can reach it.
//
// ⭐ THE RATIO ITSELF IS NOT MEASURABLE FROM HERE, deliberately. Answering "what
// did boxing cost" needs the unboxed VM to compare against, and that VM no
// longer exists — so the A/B was run ONCE, by swapping the three containers
// back under this same program, interleaved, median of 5.
//
// ⭐⭐ THE ANSWER: **1.003x — no measurable cost.** Boxed median 201.93
// ns/instruction [150.13–217.86], unboxed 201.38 [155.41–227.46] (2026-09-19).
// The two ranges overlap almost entirely, and the spread WITHIN each arm is far
// larger than the gap between them. The spike's ~1.2x prediction does not
// reproduce on this VM.
//
// ⛔⛔ AND THE ABSOLUTE FIGURE IS NOT A CLEAN BENCHMARK — it was taken with this
// box at 99.5% CPU across 28 node processes, which is why a single arm varies
// by ~25% between rounds. The INTERLEAVED RATIO survives that (the contention
// lands in both arms); the absolute number does not, and must not be quoted as
// "this VM runs at 200 ns/instruction". It is also ~100x slower than a switch
// -dispatch loop should be, which is a real question about the per-bar
// bookkeeping and belongs to a performance task, not to this one. Recorded so
// the next reader has the observation rather than rediscovering it.
import { describe, it, expect } from 'vitest'
import { makeProgram, OP } from '../program.js'
import { makeContext, execute } from '../vm.js'

const BARS = 20000
// ⛔ SET FROM THE MEASUREMENT, ~10x the observed median, and the reasoning is
// the point. The plan proposed 500 against a PREDICTED ~1–3 ns; the real figure
// is ~200 ns on a loaded box, so 500 is barely 2.5x the median and would fire
// on a busy afternoon — the "fails for unrelated reasons, then gets muted"
// failure the header warns about, arriving through the guard rather than around
// it. This ceiling exists to catch a COLLAPSE (a 10x regression), which it
// still does; it was never able to police a 2x drift.
const NS_PER_INSTRUCTION_CEILING = 2000

describe('the cost of boxed slots on numeric work', () => {
  it('stays under a generous per-instruction ceiling, and reports the figure', () => {
    const close = new Float64Array(BARS)
    for (let i = 0; i < BARS; i += 1) close[i] = 100 + Math.sin(i / 9)
    const zeros = () => new Float64Array(BARS)
    const ctx = makeContext({
      bars: BARS,
      series: [zeros(), zeros(), zeros(), close, zeros()],
      columns: [],
    })

    // ⭐ A RECURRENCE, not a stream of independent arithmetic: `acc := acc*0.9 +
    // close*0.1` reads and writes a PERSISTENT slot every bar, which is exactly
    // the traffic boxing was predicted to tax. A program that never touched a
    // slot would measure the dispatch loop and report nothing about the change.
    // ⛔⛔ THE SEED IS NOT OPTIONAL, AND LEAVING IT OUT MADE THE FIRST VERSION OF
    // THIS TEST MEASURE NOTHING. A persistent slot starts at `na`; without bar
    // 0's seed, `acc * 0.9` is NaN and every later bar stays NaN — the timing
    // still printed a confident figure while the program computed nothing. The
    // same shape cost the value-model spike its first set of timings. The
    // output assertion below is what caught it here.
    const code = [
      // bar 0 only: acc := close
      OP.JUMP_IF_INIT, 0, 3,
      OP.READ_SERIES, 3, 0,
      OP.STORE_PERSIST, 0, 0,
      // acc := acc * 0.9 + close * 0.1
      OP.LOAD_PERSIST, 0, 0,
      OP.CONST, 0, 0,
      OP.MUL, 0, 0,
      OP.READ_SERIES, 3, 0,
      OP.CONST, 1, 0,
      OP.MUL, 0, 0,
      OP.ADD, 0, 0,
      OP.STORE_PERSIST, 0, 0,
      OP.LOAD_PERSIST, 0, 0,
      OP.EMIT, 0, 0,
      OP.HALT, 0, 0,
    ]
    const instructions = code.length / 3
    const p = makeProgram({ code, consts: [0.9, 0.1], persists: 1, outputs: ['acc'] })

    execute(p, ctx, {}) // warm — the first run pays for JIT, not for boxing
    const t0 = process.hrtime.bigint()
    const out = execute(p, ctx, {})
    const ns = Number(process.hrtime.bigint() - t0)

    const perInstruction = ns / (BARS * instructions)
    // eslint-disable-next-line no-console
    console.log(
      `boxed numeric cost: ${perInstruction.toFixed(2)} ns/instruction `
      + `(${(ns / 1e6).toFixed(1)} ms over ${BARS} bars x ${instructions} instructions)`)

    // ⛔ THE OUTPUT IS CHECKED, NOT JUST THE CLOCK. A program that refused on
    // bar 0 would be very fast and would satisfy a timing ceiling perfectly.
    const want = (() => {
      let acc = close[0]
      for (let i = 0; i < BARS; i += 1) acc = acc * 0.9 + close[i] * 0.1
      return acc
    })()
    expect(Number.isFinite(out.outputs[0][BARS - 1])).toBe(true)
    expect(out.outputs[0][BARS - 1]).toBeCloseTo(want, 6)
    expect(perInstruction).toBeLessThan(NS_PER_INSTRUCTION_CEILING)
  })
})

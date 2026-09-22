// app/src/components/chart/engine/ast/distanceToWorking.measure.test.js
//
// ─── ⭐⭐ HOW FAR IS THE GOAL, IN CAPABILITIES ──────────────────────────────
//
// Every census in this repo answers "where does a script die FIRST". None
// answers the question that decides whether the programme is weeks or years
// from done: **how many different walls does ONE script have behind that?**
//
// ⛔⛔ A FIRST-BLOCKER CENSUS SYSTEMATICALLY UNDERSTATES THE WORK, and six
// waves have paid for it. A build stops at the first refusal, so clearing a
// guard does not make a script draw — it reveals the next wall. Every wave so
// far cleared its row and moved the drawing number by zero, because the
// capability was a SECOND wall for almost every script it touched. A queue
// built from first blockers cannot see that, and keeps predicting movement
// that never arrives.
//
//     cd app && node node_modules/vitest/vitest.mjs run \
//       src/components/chart/engine/ast/distanceToWorking.measure.test.js
//
// ⭐⭐ THE METHOD: PEEL, AND LET THE ENGINE DO THE JUDGING. Build the script.
// If it refuses at a line, neutralise THAT LINE and build again. Count how many
// lines had to be neutralised before it builds. That count is the script's
// distance, and every step of it is the engine's own verdict — not a guess
// about what it supports.
//
// ⚰️⚰️ TWO EARLIER VERSIONS OF THIS FILE PROBED NAMES INSTEAD, AND BOTH WERE
// WRONG — their numbers were nearly published:
//
//   · v1 probed every name through `buildRuntimeIr` with `plot(<name>)` bodies.
//     `label.new` refuses `runtime:object-op` there BY DESIGN — drawing belongs
//     to the object pass — so it reported `label.new` blocking 129 scripts,
//     `line.new` 117, `box.new` 64. All three are served.
//   · v2 added the object lane and per-namespace shapes, and still reported
//     `table.cell`, `label.delete` and `line.style_dashed` as blockers. An enum
//     CONSTANT is not a call, and a method needs a handle its shape did not
//     supply. Its own control then caught a third fault: an invented colour
//     read as SUPPORTED.
//
// ⭐ The lesson is not "write better shapes". It is that a probe which
// CONSTRUCTS its own usage measures the construction. Peeling uses the script's
// own lines, so there is nothing to get wrong about how a name is used.
//
// ⚠️ WHAT PEELING IS NOT, said plainly: neutralising a line changes the
// program, so a later refusal may be a consequence of the edit rather than an
// independent wall. The count is therefore an ESTIMATE OF ORDER, honest about
// direction — a script at 1 really is close, a script at 15 really is far —
// and not a work ticket. `UNREACHED` means it did not build within the cap.
import { describe, it, expect } from 'vitest'
// ⭐ THE PEELER ITSELF LIVES IN `peelToBuilding.js`, shared with
// `nearestToWorking.measure.test.js`. It was extracted VERBATIM; the controls
// below are its rails and still exercise every line of it. Two copies of a walk
// with this file's error history would be two opinions about what "distance"
// means (`lesson_a_second_authority_over_one_value`).
import { peel, SCRIPTS, readScript, DEFAULT_CAP as CAP } from './peelToBuilding.js'

const LF = String.fromCharCode(10)

describe('⭐⭐ how far the corpus is from building, measured by peeling', () => {
  it('⛔ CONTROL — the corpus is on disk', () => {
    expect(SCRIPTS.length).toBeGreaterThan(200)
  })

  it('⛔⛔ CONTROL — peeling really is what makes the difference', () => {
    const q = String.fromCharCode(34)
    const H = `//@version=6${LF}indicator(${q}t${q}, overlay = true)${LF}`
    // a script that already builds is distance 0, and nothing is neutralised
    // ⛔ THE CELL IS COMPUTED, NOT A LITERAL. An all-literal table has no
    // computed output and is refused `runtime:no-output` — which is correct,
    // and is a trap this repo has already paid for once. A control fixture
    // that trips it measures the fixture.
    const clean = `${H}var t = table.new(position.top_right, 1, 1)${LF}`
      + `if barstate.islast${LF}    table.cell(t, 0, 0, str.tostring(close))${LF}`
    expect(peel(clean).distance, 'a clean script was not distance 0').toBe(0)
    expect(peel(clean).reached).toBe(true)

    // ⭐ ONE planted bad line must cost EXACTLY one peel — if it cost zero the
    // peeler is not peeling, and if it cost more it is cascading.
    const oneBad = `${H}var t = table.new(position.top_right, 1, 1)${LF}`
      // ⛔ A PLOT, NOT A BINDING. An UNUSED binding is elided before it can
      // refuse, so `x = ta.notarealfunction(...)` costs zero peels and the
      // control would be measuring dead-code removal instead of peeling.
      + `plot(ta.notarealfunction(close, 5))${LF}`
      + `if barstate.islast${LF}    table.cell(t, 0, 0, str.tostring(close))${LF}`
    const p = peel(oneBad)
    expect(p.reached, `one planted line did not peel clean: ${p.stuck}`).toBe(true)
    expect(p.distance, 'one bad line did not cost exactly one peel').toBe(1)
  })

  it('⛔⛔ CONTROL — keeping a binding never peels WORSE, and sometimes better', () => {
    // ⭐ WHAT THIS GUARDS. Blanking a failing line removes the NAME as well as the
    // capability, so a later line that reads it refuses `pine:undefined` and
    // costs another peel. Replacing it with `name = 0.0` keeps the name.
    //
    // ⚰️⚰️ MY FIRST TWO FIXTURES FOR THIS WERE BOTH WRONG, and the second
    // one is the instructive failure. A PURE top-level binding is INLINED by
    // this engine as a macro, so an unreadable right-hand side surfaces at every
    // USE site and the binding line is never the refusal line at all — a planted
    // `k = ta.notarealfunction(...)` refuses at `plot(k + close)`, and the
    // replacement path never runs. (The first fixture was worse: its consumers
    // folded to constants once `k` became `0.0` and were refused
    // `runtime:no-output`, so it measured the substitution's own bias.)
    // The improvement is real and fires where the refusal lands ON a binding —
    // a `var` slot, a `:=` reassignment — which is not a shape worth faking.
    //
    // ⭐⭐ SO THE CONTROL ASSERTS THE RELATION, NOT A NUMBER. Over real
    // scripts: keeping the binding must never reach LESS far, and must reach
    // strictly further for at least one. Both halves matter — the first is the
    // safety claim, the second is why the change was made. Pinning the measured
    // distances instead is the mistake `nearestToWorking` already paid for: a
    // rail that breaks every time the engine improves.
    const LOOK = 20
    const named = [
      'position-size-calc__a42db1a620.pine',
      'vold-market-breadth__9c5cde9557.pine',
      'wyckoff-accumulation-distribution__d9ae726e21.pine',
    ]
    for (const n of named) {
      expect(SCRIPTS.includes(n), `control fixture missing from the corpus: ${n}`).toBe(true)
    }
    const reach = (r) => (r.reached ? r.distance : Number.POSITIVE_INFINITY)
    let strictlyBetter = 0
    for (const n of named) {
      const src = readScript(n)
      const kept = reach(peel(src, LOOK, true))
      const blanked = reach(peel(src, LOOK, false))
      expect(kept, `keeping the binding peeled WORSE on ${n}`).toBeLessThanOrEqual(blanked)
      if (kept < blanked) strictlyBetter += 1
    }
    expect(strictlyBetter, 'keeping bindings made no difference anywhere — the replacement is inert')
      .toBeGreaterThan(0)

    // ⛔⛔ AND THE DEFAULT IS WHAT EVERY PUBLISHED NUMBER USES. The three
    // assertions above pass the flag EXPLICITLY, so they watch the parameter
    // and not the default — measured: flipping `preserveBindings` to `false`
    // in the signature left all four tests in this file GREEN while the
    // histogram below, `nearestToWorking`'s queue and every distance ever
    // quoted silently reverted. A guard on the argument is not a guard on the
    // caller (`lesson_a_guard_that_tests_the_adjacent_thing`).
    const probe = readScript(named[0])
    expect(JSON.stringify(peel(probe, LOOK)),
      'the DEFAULT no longer preserves bindings — every distance here just moved')
      .toBe(JSON.stringify(peel(probe, LOOK, true)))
  })

  it('⭐⭐ prints the distance histogram and what is hit on the way', () => {
    const results = []
    for (const name of SCRIPTS) {
      const src = readScript(name)
      results.push({ name, ...peel(src) })
    }

    const hist = new Map()
    const bump = (k) => hist.set(k, (hist.get(k) || 0) + 1)
    for (const r of results) {
      if (!r.reached) { bump('UNREACHED'); continue }
      bump(r.distance >= 10 ? '10+' : String(r.distance))
    }
    const order = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10+', 'UNREACHED']
    let running = 0
    const rows = order.map((k) => {
      const n = hist.get(k) || 0
      if (k !== 'UNREACHED') running += n
      return `${k.padStart(9)}  ${String(n).padStart(4)} scripts`
        + (k === 'UNREACHED' ? '' : `   cumulative ${String(running).padStart(4)}`
          + `  (${((running / SCRIPTS.length) * 100).toFixed(1)}%)`)
    })

    // what the peels hit, across every script and every step
    const hitCount = new Map()
    for (const r of results) {
      for (const g of r.guards) hitCount.set(g, (hitCount.get(g) || 0) + 1)
    }
    const stuckCount = new Map()
    for (const r of results) {
      if (!r.reached && r.stuck) stuckCount.set(r.stuck, (stuckCount.get(r.stuck) || 0) + 1)
    }
    const top = (m, k) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, k)

    // eslint-disable-next-line no-console
    console.log([
      '',
      `DISTANCE TO BUILDING — ${SCRIPTS.length} scripts, peel cap ${CAP}`,
      '⚠️ an estimate of ORDER, not a work ticket: neutralising a line changes the',
      '   program, so a later refusal can be a consequence of the edit. What it is',
      '   honest about is DIRECTION — 1 really is close, 15 really is far.',
      '',
      'lines to neutralise before it builds',
      ...rows,
      '',
      'guards hit across ALL peels (how much work each one really represents):',
      ...top(hitCount, 18).map(([g, n]) => `${String(n).padStart(5)}  ${g}`),
      '',
      'where the unreachable ones STOP (no line to peel, or cap):',
      ...top(stuckCount, 10).map(([g, n]) => `${String(n).padStart(5)}  ${g}`),
      '',
    ].join(LF))

    // ⛔ NON-VACUITY BOTH WAYS: a peeler that neutralised everything would put
    // every script at the cap; one that peeled nothing would put them all at 0.
    expect(results.some((r) => r.reached && r.distance > 0)).toBe(true)
    expect(results.some((r) => r.distance === 0 || !r.reached)).toBe(true)
    expect(results.length).toBe(SCRIPTS.length)
  }, 600000)
})

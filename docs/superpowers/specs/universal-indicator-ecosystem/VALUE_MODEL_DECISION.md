# The value model — decision

**Wave:** Pine runtime lane, plan 2 of 7 (RVOL slice).
**Instrument:** `tools/c5_value_model_spike/` — `isa.md`, one program, three
implementations, `measure.mjs` (`--self-check` proves the comparator can fail).
**Measured:** 2026-09-19, Node on this box, 5,000 bars × 8 inner iterations,
1,305,000 instructions per run, 20 repeats per timing, four independent runs.

## The question

The VM holds `Float64Array` series and outputs. Strings, arrays, booleans and
object handles have no representation, and every remaining capability in the wave
needs one. C4 left the choice open as "value tags vs NaN-boxing".

## The answer

**Candidate A — boxed values: one JS array of JS values, per slot and per stack
position.** Numbers stay doubles, `na` stays `NaN`, a string is a string, a
collection is a JS array.

⭐ **The numeric hot path is untouched by this decision.** Series and the
columnar lane's outputs remain `Float64Array`, and `READ_COLUMN` still reads a
precomputed column — the 70 closed-table builtins are evaluated once by
`interpret.js` exactly as they are today. This decision governs SLOTS and the
operand stack, which is where state, strings and collections live.

## What was measured

Agreement ran first and had to be green before any timing was quoted. It was not
green on the first attempt, which is the point of running it first:

> ⚰️ **The first run disagreed at bar 0 — `NaN` against `0.9`** — because the
> boxed candidate left an unassigned slot `undefined` while a `Float64Array` slot
> starts at `0`. That is Pine's `var float acc = 0.0` against an unassigned name:
> a SEMANTIC question the ISA has to answer, not something each implementation
> may answer for itself. The initial value is now part of the ISA. A benchmark
> started before that would have compared three different programs.

⚰️ **AND THE FIRST TIMINGS WERE WITHDRAWN, FOR A SECOND INSTRUMENT DEFECT THE
SELF-CHECK FOUND.** The planted `na` sat in `close`, which feeds the recurrence,
so `acc` went NaN at bar 3 and stayed NaN for the remaining 4,996 bars. Two
costs: agreement on that output was **vacuous** after bar 3 (NaN equals NaN and
the comparator rightly skips it), and the timing was measuring NaN arithmetic
rather than the arithmetic a real script runs. Moving the `na` onto the string
and collection path — which is what a missing bar in a requested symbol actually
looks like — moved every number materially. The earlier figures are withdrawn
rather than footnoted.

⚠️ **The ranking also flipped between early runs, because the first timing
harness took one sample per candidate after a single warm-up.** Run-to-run noise
was larger than every difference being reported. The harness now warms five runs,
takes the **median of seven interleaved rounds**, and reports the range.

| median of 7 rounds | mixed (numbers + strings + collections) | numeric-only control |
|---|---|---|
| **A — boxed** | 27.3 ms [26.2–32.9] | 9.8 ms [9.3–10.3] |
| **B — NaN-boxed** | 33.2 ms [30.8–34.3] — **1.24×, slowest** | 8.3 ms [7.9–8.6] |
| **C — split banks** | 26.7 ms [24.9–33.0] | 8.2 ms [7.7–8.6] — fastest |

**The spread is at most 1.24×.** For comparison, the number that decided C4's
host-language question was **33×**. Nothing here is disqualified on speed, and
nothing here earns a more complicated design by being faster.

A and C are indistinguishable on the mixed program — their ranges overlap almost
completely. C is ~20% faster on the numeric-only control, where it ties B. B is
slowest on the workload that represents a real dashboard, and fastest only on the
control with no strings in it.

## Why A rather than B

1. **B's correctness rests on an engine detail.** The payload survival control
   measured all five paths this VM moves values through — a `Float64Array` store,
   a local, a function argument, a JS array element and the operand stack — and
   the payload survived every one, on this engine today. That is not a guarantee
   from the language: a NaN may be canonicalised, and a canonicalised NaN has
   silently become a different string or none. The endzone's bar is "no known
   wrong values"; a representation whose correctness depends on an engine
   implementation detail that could change under us fails it in the worst way,
   quietly.
2. **B needs a reclamation story nothing else needs.** One run left **205,003**
   side-table entries — every string and collection ever created, none reclaimed,
   because a payload index is not a reference and the garbage collector cannot
   see it. A and C get lifetime management free from the host.
3. **B is slowest exactly where a member's script lives.** Its win is on the
   numeric-only control, and the numeric path is already columnar.

## Why A rather than C

C is the better *idea* — route each slot to a numeric or a boxed bank at compile
time, so nothing carries a tag — and it is a real option because Pine's types are
known statically. On the measurements it ties A on the mixed program and is ~20%
faster on the numeric-only control.

**It is not chosen because 20% on the control does not pay for the failure mode
it introduces.** C needs a compile pass that is right about the type of every
slot and every stack position; a slot routed to the wrong bank reads a number out
of a string array, and that is the silent kind of wrong — no exception, no NaN,
just a value that is not what the member wrote. A is a simpler thing to be right
about, and the numeric hot path in the real runtime is columnar anyway, which is
exactly where C's advantage would have applied.

⭐ **C is the designated escalation**, in the same sense WASM is for the runtime:
if a measured performance gate later fails on a real script, C is the first thing
to build, and this spike already contains a working implementation of it to start
from.

## What this commits us to

- A slot is a JS value. `na` for a number is `NaN` — the same spelling the
  columnar lane uses, so the shared scalar operators keep working untouched.
- A Pine `bool` is a JS boolean and is never `na` (v6 semantics).
- A string is a JS string; a collection is an object the host can collect.
- Series and columns stay `Float64Array`. This decision does not touch them.
- The compile-time type information is still recorded (the front end knows
  `array<string>` from `array<float>`), because C needs it if it is ever built,
  and because the collections work needs element types regardless. The lexer
  already carries them as `typeArgs` from plan 1.

## ⭐⭐ WHAT IT ACTUALLY COST, MEASURED ON THE REAL VM (2026-09-19)

The spike above predicted about **1.2x** on a numeric-only program. That was a
standalone ISA in `tools/c5_value_model_spike/`, not this engine. Re-measured on
`engine/runtime/vm.js` itself, on a persistent-slot recurrence
(`acc := acc * 0.9 + close * 0.1`) over 20,000 bars, by swapping the three
containers back to `Float64Array` and running the two arms **interleaved, median
of 5**:

| arm | median ns/instruction | range |
|---|---|---|
| boxed (shipped) | **201.93** | 150.13 – 217.86 |
| unboxed (what it replaced) | **201.38** | 155.41 – 227.46 |

**Ratio 1.003x — no measurable cost.** The ranges overlap almost entirely and
the spread WITHIN each arm is larger than the gap between them. The prediction
does not reproduce here; boxing the slots is free on numeric work in this VM.

⛔ **The ABSOLUTE figure is not a benchmark and must not be quoted as one.** It
was taken with the box at 99.5% CPU across 28 node processes, which is why one
arm varies ~25% between rounds. Interleaving is what makes the RATIO survive
that — the contention lands in both arms. A later run on a quieter box read
124.65 ns/instruction for the same program, which is the same finding about the
measurement, not a different finding about the code.

⚠️ **An open question this raised, out of scope and recorded rather than
chased:** ~200 ns/instruction is roughly 100x slower than a switch-dispatch loop
should manage, and that is true of BOTH arms, so it is not about the value
model. It points at per-bar bookkeeping (history rings, window buffers, budget
charging) running even for a program that uses none of it. That belongs to a
performance task.

Standing rail: `engine/runtime/__tests__/boxedNumericCost.test.js`, which
asserts a collapse ceiling rather than a stored comparison.

## Open, and deliberately not settled here

- **Object handles** (`table`, `line`, `label`, `box`) are ids into the C3B
  object program, not JS references, and that stays true under A. The object
  runtime owns their lifetime; the VM only carries the id.
- **A limit on total boxed allocation per run** belongs with the other runtime
  limits, not in the value model. `limits.js` already bounds array elements and
  operations.

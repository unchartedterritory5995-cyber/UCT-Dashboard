# Engine 94: no answer depends on how fast the machine is (the deterministic budgets; evidence, 2026-11-21 / 2026-11-22)

Branch `fix/pine-e94-deterministic-budgets` (its working name was "e93"; engine 93 shipped with other content, so the
unit's files say e94), merged with master `6770c111a9`. It ships in train e94; its engine number is the train's.
Licence-held scripts are never committed: per-script rows stay in private evidence (the coordinator has them). This page
carries the method, the aggregates and the verdicts; a script is named by its rank and its timing only.

## 1. Answer first

- **The defect.** On master, a served script's drawn document and PasteBox's report can depend on how fast the machine
  got through the call. Measured (master `4dae9f9e06`, 852 scripts: the 679 line plus the 215 slow-served, every clock
  frozen vs this PC's real clock): **production lane, 2 drawn documents and 4 reports differ; runtime-on lane, 3 and
  3; 0 verdicts move on either lane** (section 4). #2254's first browser trace saw the same thing as a drawing refused
  on 2 runs of 3.
- **The cause.** The translator's 10 s window (`PINE_TRANSLATE_BUDGET_MS`) is read at many points; a check that trips
  throws `pine:timeout`, and a `catch` that takes a throw for "this step does not translate" swallows it, so the call
  goes on with parts missing. Which parts depends on where the window ran out. Inside the member door, the VM's
  `WALL_TIME` (5 s) stops a slow probe run, which reads as "not read": a different document (section 2).
- **The fix.**
  - A deterministic step budget per `translatePine` call (`PINE_TRANSLATE_CALL_MAX_STEPS = 500,000,000`, 2.17x the most
    step-hungry served script's 230,299,396), the same on every machine; past it the whole script refuses by name.
  - The wall clock kept only as the last resort, LATCHED: once the window trips, every read of it says so and the call
    answers the whole script by name (`tripWindow`), so no `catch` can make a part of it. **18 minutes** (1,080,000 ms).
  - The member door's whole-call deadline (#2225) raised with it: **25 minutes** (1,500,000 ms).
  - Inside the member door every runtime clock stands still (`withMemberDoorClock`): the door decides on the
    instruction limits, never on time.
  - Both stops by RULING (C) (coordinator 2026-11-21, amended 2026-11-22): a last-resort stop is proportional to the
    UNCUT work at the shipped code, in whole minutes, rounded up: the door stop >= 2.5x the slowest served script's
    single uncut door call, the wall stop >= 3.5x its slowest single uncut translate call (section 4).
- **Acceptance.** In train e94's PR: the scoped acceptance (the rows that reached the old 300 s door deadline or came
  within 10% of it) and the held regrade, both lanes, against master. Bar: 0 served -> refused.
- **Order.** This changes how long a heavy script translates (the 10 s window cut a call; e94 lets it finish or refuses
  it whole), so it ships in the same train as every member path that translates moving off the page's main thread:
  #2254 (paste, editor, report, status), #2364 (saved-script upgrade), #2367 (Indicator House copy, inspect-a-bar), and
  the train's interim main-thread cap on the one path still on the page (the authoring script check, 10 s, refused by
  name past it), which goes when that check moves to the door's worker.

## 2. Root cause, reproduced

On master, in node, with the real bundle: a clock scaled k times slower turns the same script from drawn to refused; a
frozen clock gives one answer every run.
1. **The window, swallowed.** `PINE_TRANSLATE_BUDGET_MS` is one window per `translatePine`, read at the output loop,
   the notes pass, the object pass and every Resolver's sampled clock check (every 4,096 steps). Inside the object pass
   a sampled check that trips throws `pine:timeout` into a `catch { return null }`, the step is dropped, and the object
   program's loss list then refuses the drawing (`pine:object-removal-lost`).
2. **The VM's wall time in the door's probes.** The door runs the program to learn which colour inputs the run reads;
   `WALL_TIME` stops a slow probe, and a stopped probe reads as "not read".

## 3. The mechanism

- `countCallStep` counts every resolution step and printer tick of the call (`CALL_STEPS`); past
  `PINE_TRANSLATE_CALL_MAX_STEPS` it throws the whole-call refusal ("gave up after N resolution steps for the whole
  script"). Windows nest safely (`beginTranslateBudget` / `endTranslateBudget`); `lastTranslateWindow()` reports a
  call's steps and trip.
- Every read of the window's clock (`translateBudgetExpired`, `tickTranslateBudget`, `checkClock`) latches through
  `tripWindow`; `translatePine` answers a tripped window as the whole script refused by name.
- `runtimeColumns.withMemberDoorClock(fn)` holds the runtime columns' clock and the VM's ambient clock still for the
  member door's call (`vm.withAmbientRunClock`); the VM's one allowed wall-clock line (`defaultNow`, the runtime
  closure's H5 rule) is unchanged, the still clock routes beside it.

## 4. Census and the stops' basis

**Master frozen vs today** (`4dae9f9e06`): as section 1.

**The basis of the two last-resort stops.** Measured on train e94's own code (`d079b3ac22`: the step budget as shipped,
the door's runtime clocks held still), with only the two last-resort stops lifted to 1 h in the measurement snapshot,
lane 1, one run per script (by the amended ruling: a single run, with a margin for run-to-run variance), every call
timed and flushed as it ended:

| rank | report call | door call | translate calls (ms, slowest first) | lane |
|---|---:|---:|---|---|
| 1 by door | 0.2 s | **592,223 ms** | 158,441 / 157,297 / 92,506 / 91,585 / 89,637 (door path) | host |
| 1 by call | 525,381 ms | 456,126 ms | **294,832** / 230,545 (report path), 233,160 / 222,856 (door path) | runtime |

- door stop: 2.5 x 592,223 ms = 1,480,558 ms, rounded up to **25 minutes** (1,500,000 ms, 2.53x);
- wall stop: 3.5 x 294,832 ms = 1,031,912 ms, rounded up to **18 minutes** (1,080,000 ms, 3.66x).

**A harness lesson (2026-11-22).** A first basis pass measured MASTER's code with the translator's window and the door's
deadline lifted, and found the rank-1 door call about 2x the numbers recorded before (581-716 s against 266-288 s). It
was not a master regression: a node probe of `translatePine` alone found master within 1.03x of the e93-era base
(`3ee3986f28`) on that script (0.98x on a median-cost script, 1.02x on a p90 one), and the same harness on `3ee3986f28`
measured 599 s. That pass lifted the translator but left the VM's 5 s `WALL_TIME` in the door's probes on the wall
clock. **A door measured with its translator lifted but its VM probes on the wall clock is neither the member's door nor
e94's, and its numbers measure the harness.** The basis above is e94's own code, clocks as it ships them.

**Measured and unexplained, for a later look.** On the cheapest script of that probe a `translatePine` call took 0.6 ms
at `3ee3986f28` and 1.1-1.5 ms at master (3 of 3 runs): a sub-millisecond delta, not bisected.

**Also for a later look (translator performance, not this unit).** The same rank-1 door call measured 270 s on the
budgets applied to the e93-era base and 592 s on e94's code; where the difference entered is a separate bisect.

## 5. Rails and mutants

`engine/ast/pine.e94.test.js`: the latch (a window that trips at ANY clock read answers the whole script by name,
including a trip planted at a resolution's sampled check inside a swallowing `catch`); the step budget (whole-call, by
name, the same count on every run); the member door's runs on a racing host clock (a probe completes inside the door and
the VM stops it outside: the control; the whole door byte-identical); the shipped budgets are the basis's, never a
placeholder or a measurement's lift. `engine/ast/pine.timeout.test.js`: the wall stop >= 3.5x the slowest served call;
`builder/memberPane/doorDeadline.test.js`: the door deadline >= 2.5x the slowest served door call, in whole minutes, not
#2225's 5 minutes. `tools/pine_runtime_closure.mjs --check`: the runtime closure stays host-neutral.

Mutants `ci/mutants/u-e94.json`: E1 the latch ignored; E2 a trip not latched; E3 the step count not kept; E4 the door's
runtime clock not held still; E5 the step budget shipped as a placeholder; E6 the wall stop shipped as a measurement's
lift; E7 the wall stop back at 10 s; E8 the door deadline back at #2225's 5 minutes. `ci/mutants/u-door-deadline.json` D1
re-anchored on the door's call as it now reads (inside `withMemberDoorClock`).

## 6. Known gaps and follow-ups

- **The compile-probe freeze, dropped (census-decided).** Holding the clock still for the IR builds inside the door's
  probe compiles was built and removed: no committed or census script reaches a Resolver's sampled check in a probe
  compile, so its rail could not be made to fail. If a census ever finds one, it comes back with a rail that can.
- **Slow served scripts (translator performance).** Under e94 a heavy served script translates in full: the slowest
  need minutes per door call (section 4), off the main thread by the train's order. A translator performance unit.
